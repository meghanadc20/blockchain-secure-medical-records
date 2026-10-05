'use strict';
require('./setupEnv');
const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const { setupTestDB, teardownTestDB, startServer, call } = require('./helpers');
const { startTestChain, freshWallet, linkWallet, share } = require('./chain');
const { createApp } = require('../src/app');
const { getSupabase } = require('../src/config/supabase');
const { ensureBucket } = require('../scripts/setupStorage');
const { encryptBuffer } = require('../src/services/crypto.service');

const BUCKET = process.env.SUPABASE_BUCKET;
const inMin = (m) => new Date(Date.now() + m * 60_000).toISOString();
const sha = (b) => crypto.createHash('sha256').update(b).digest('hex');
const pdf = (tag) => Buffer.concat([Buffer.from(`%PDF-1.4\n% ${tag}\n`), crypto.randomBytes(700), Buffer.from('\n%%EOF\n')]);

async function upload(url, token, title, file = pdf(title)) {
  const fd = new FormData();
  fd.append('title', title); fd.append('recordType', 'LAB_REPORT');
  fd.append('file', new Blob([file], { type: 'application/pdf' }), `${title}.pdf`);
  const r = await fetch(`${url}/api/records`, { method: 'POST', headers: { Authorization: `Bearer ${token}` }, body: fd });
  const j = await r.json(); assert.equal(r.status, 201, JSON.stringify(j));
  return { id: j.data.record.id, file, anchoring: j.data.anchoring };
}
async function download(url, token, id) {
  const r = await fetch(`${url}/api/records/${id}/file`, { headers: { Authorization: `Bearer ${token}` } });
  const buf = Buffer.from(await r.arrayBuffer());
  let body = null; if (r.status !== 200) { try { body = JSON.parse(buf.toString()); } catch { /* */ } }
  return { status: r.status, buf, headers: r.headers, body };
}
const verify = (url, token, id) => call(url, 'POST', `/api/records/${id}/verify`, { token });
async function rawStored(M, id) {
  const db = await M.MedicalRecord.findById(id).lean();
  const { data } = await getSupabase().storage.from(BUCKET).download(db.storagePath);
  return { db, bytes: Buffer.from(await data.arrayBuffer()) };
}
const overwrite = (key, bytes) => getSupabase().storage.from(BUCKET).upload(key, bytes, { upsert: true, contentType: 'application/octet-stream' });

describe('Phase 9 — Module 6: SHA-256 integrity verification & audit trail', () => {
  let M; let srv; let ch;
  const t = {}; const id = {}; const w = {};
  const reg = async (kind, body) => {
    const r = await call(srv.url, 'POST', `/api/auth/register/${kind}`, { body: { password: 'Secret123', phone: '9876543210', ...body } });
    assert.equal(r.status, 201); return r.body.data;
  };

  before(async () => {
    M = await setupTestDB();
    ch = await startTestChain();
    await ensureBucket(BUCKET); await getSupabase().storage.emptyBucket(BUCKET);
    srv = await startServer(createApp());
    await M.User.create({ name: 'Admin', email: 'admin@example.com', role: 'ADMIN', passwordHash: await bcrypt.hash('AdminPass123', 4) });
    t.admin = (await call(srv.url, 'POST', '/api/auth/login', { body: { email: 'admin@example.com', password: 'AdminPass123' } })).body.data.token;
    let d = await reg('patient', { name: 'Asha', email: 'asha@example.com' }); t.patient = d.token; id.patient = d.user.id;
    d = await reg('patient', { name: 'Bina', email: 'bina@example.com' }); t.other = d.token; id.other = d.user.id;
    d = await reg('doctor', { name: 'Ravi', email: 'ravi@example.com', specialization: 'Cardiology', licenseNumber: 'K-1', hospital: 'City' }); t.doctor = d.token; id.doctor = d.user.id;
    d = await reg('doctor', { name: 'Nina', email: 'nina@example.com', specialization: 'ENT', licenseNumber: 'K-2', hospital: 'City' }); t.doctor2 = d.token;
    for (const doc of [id.doctor, d.user.id]) await call(srv.url, 'PATCH', `/api/admin/doctors/${doc}/approve`, { token: t.admin });
    const rel = await call(srv.url, 'POST', '/api/relations/requests', { token: t.doctor, body: { patientEmail: 'asha@example.com' } });
    await call(srv.url, 'PATCH', `/api/relations/${rel.body.data.relation.id}/approve`, { token: t.patient });
    w.patient = freshWallet(ch.provider);
    assert.equal((await linkWallet(srv.url, t.patient, w.patient)).status, 200);
    const u = await upload(srv.url, t.patient, 'Blood test'); id.rec = u.id; id.file = u.file;
    assert.equal(u.anchoring, 'ANCHORED');
    const g = await share(srv.url, t.patient, w.patient, { recordId: id.rec, doctorId: id.doctor, expiresAt: inMin(120) });
    assert.equal(g.status, 201, JSON.stringify(g.body));
  });

  after(async () => {
    await srv.close(); await ch.stop();
    try { await getSupabase().storage.emptyBucket(BUCKET); await new Promise((r) => setTimeout(r, 1500)); await getSupabase().storage.deleteBucket(BUCKET); } catch (e) { console.error('bucket cleanup', e.message); }
    await teardownTestDB();
  });

  describe('19. hash verification', () => {
    it('verify: retrieved file SHA-256 == on-chain fingerprint == stored hash → INTEGRITY_VERIFIED (BLOCKCHAIN)', async () => {
      const r = await verify(srv.url, t.patient, id.rec);
      assert.equal(r.status, 200, JSON.stringify(r.body));
      const v = r.body.data.integrity;
      assert.equal(v.status, 'INTEGRITY_VERIFIED');
      assert.equal(v.trustedSource, 'BLOCKCHAIN');
      assert.equal(v.algorithm, 'SHA-256');
      assert.equal(v.currentHash, sha(id.file));
      assert.equal(v.blockchainHash, sha(id.file));
      assert.equal(v.storedHash, sha(id.file));
      assert.match(v.anchorTransactionHash, /^0x[0-9a-f]{64}$/);
      assert.ok(await M.AuditLog.exists({ action: 'HASH_VERIFICATION', recordId: id.rec, 'metadata.result': 'INTEGRITY_VERIFIED' }));
    });

    it('every download is verified first; result is reported in headers', async () => {
      const r = await download(srv.url, t.patient, id.rec);
      assert.equal(r.status, 200); assert.deepEqual(r.buf, id.file);
      assert.equal(r.headers.get('x-integrity-status'), 'INTEGRITY_VERIFIED');
      assert.equal(r.headers.get('x-integrity-source'), 'BLOCKCHAIN');
      assert.equal(r.headers.get('x-file-sha256'), sha(id.file));
      assert.ok(await M.AuditLog.exists({ action: 'HASH_VERIFICATION', recordId: id.rec, 'metadata.purpose': 'DOWNLOAD' }));
    });

    it('authorized doctor can verify and download; unauthorized users cannot', async () => {
      assert.equal((await verify(srv.url, t.doctor, id.rec)).body.data.integrity.status, 'INTEGRITY_VERIFIED');
      assert.equal((await download(srv.url, t.doctor, id.rec)).headers.get('x-integrity-status'), 'INTEGRITY_VERIFIED');
      assert.equal((await verify(srv.url, t.doctor2, id.rec)).status, 403);
      assert.equal((await verify(srv.url, t.other, id.rec)).status, 404);
      assert.equal((await verify(srv.url, t.admin, id.rec)).status, 403);
    });

    it('record list shows the latest integrity check', async () => {
      const r = await call(srv.url, 'GET', '/api/records', { token: t.patient });
      const rec = r.body.data.items.find((x) => x.id === id.rec);
      assert.equal(rec.lastIntegrityCheck.status, 'INTEGRITY_VERIFIED');
      assert.equal(rec.lastIntegrityCheck.trustedSource, 'BLOCKCHAIN');
      const d = await call(srv.url, 'GET', '/api/permissions/doctor', { token: t.doctor });
      assert.equal(d.body.data.items[0].record.lastIntegrityCheck.status, 'INTEGRITY_VERIFIED');
    });
  });

  describe('20. tampered file detection', () => {
    it('ciphertext modified in storage → TAMPER_DETECTED (stage DECRYPTION); download refused', async () => {
      const u = await upload(srv.url, t.patient, 'Ciphertext tamper');
      const { db, bytes } = await rawStored(M, u.id);
      bytes[50] ^= 0x01;
      assert.equal((await overwrite(db.storagePath, bytes)).error, null);
      const v = (await verify(srv.url, t.patient, u.id)).body.data.integrity;
      assert.equal(v.status, 'TAMPER_DETECTED'); assert.equal(v.stage, 'DECRYPTION');
      const d = await download(srv.url, t.patient, u.id);
      assert.equal(d.status, 409); assert.equal(d.body.error.code, 'TAMPER_DETECTED');
      assert.ok(await M.AuditLog.exists({ action: 'TAMPER_DETECTED', recordId: u.id, 'metadata.stage': 'DECRYPTION' }));
    });

    it('file replaced by an insider who has the encryption key → SHA-256 ≠ on-chain fingerprint → TAMPER_DETECTED (stage FILE_HASH)', async () => {
      const u = await upload(srv.url, t.patient, 'Content tamper');
      const forged = pdf('FORGED CONTENT');
      const enc = encryptBuffer(forged);
      const db = await M.MedicalRecord.findById(u.id).lean();
      assert.equal((await overwrite(db.storagePath, enc.ciphertext)).error, null);
      // the insider also updates the encryption parameters so decryption succeeds
      await M.MedicalRecord.updateOne({ _id: u.id }, { encryptionIv: enc.iv, encryptionAuthTag: enc.authTag });
      const v = (await verify(srv.url, t.patient, u.id)).body.data.integrity;
      assert.equal(v.status, 'TAMPER_DETECTED'); assert.equal(v.stage, 'FILE_HASH');
      assert.equal(v.currentHash, sha(forged));
      assert.equal(v.blockchainHash, sha(u.file));
      const d = await download(srv.url, t.patient, u.id);
      assert.equal(d.status, 409);
      assert.ok(!d.buf.includes(Buffer.from('FORGED CONTENT')), 'tampered content is never delivered');
    });

    it('…even if the insider ALSO rewrites the hash in MongoDB, the on-chain fingerprint exposes it', async () => {
      const u = await upload(srv.url, t.patient, 'Full insider tamper');
      const forged = pdf('FORGED AGAIN'); const enc = encryptBuffer(forged);
      const db = await M.MedicalRecord.findById(u.id).lean();
      await overwrite(db.storagePath, enc.ciphertext);
      await M.MedicalRecord.updateOne({ _id: u.id }, { encryptionIv: enc.iv, encryptionAuthTag: enc.authTag, sha256Hash: sha(forged) });
      const v = (await verify(srv.url, t.patient, u.id)).body.data.integrity;
      assert.equal(v.status, 'TAMPER_DETECTED'); assert.equal(v.stage, 'FILE_HASH');
      assert.equal(v.trustedSource, 'BLOCKCHAIN');
      assert.equal(v.storedHash, sha(forged)); assert.equal(v.blockchainHash, sha(u.file));
    });

    it('only the MongoDB hash altered (file intact) → TAMPER_DETECTED (stage METADATA_HASH)', async () => {
      const u = await upload(srv.url, t.patient, 'Metadata tamper');
      await M.MedicalRecord.updateOne({ _id: u.id }, { sha256Hash: 'f'.repeat(64) });
      const v = (await verify(srv.url, t.patient, u.id)).body.data.integrity;
      assert.equal(v.status, 'TAMPER_DETECTED'); assert.equal(v.stage, 'METADATA_HASH');
    });

    it('a doctor opening a tampered shared record is refused too', async () => {
      const { db, bytes } = await rawStored(M, id.rec);
      const original = Buffer.from(bytes);
      bytes[10] ^= 0xff;
      await overwrite(db.storagePath, bytes);
      try {
        const d = await download(srv.url, t.doctor, id.rec);
        assert.equal(d.status, 409); assert.equal(d.body.error.code, 'TAMPER_DETECTED');
        assert.ok(await M.AuditLog.exists({ action: 'TAMPER_DETECTED', recordId: id.rec, doctorId: id.doctor }));
      } finally { await overwrite(db.storagePath, original); }
      assert.equal((await verify(srv.url, t.doctor, id.rec)).body.data.integrity.status, 'INTEGRITY_VERIFIED', 'restored file verifies again');
    });
  });

  describe('fallbacks are reported honestly', () => {
    it('chain unreachable → verified against the database copy, with a warning', async () => {
      const real = process.env.BLOCKCHAIN_RPC_URL;
      process.env.BLOCKCHAIN_RPC_URL = 'http://127.0.0.1:9';
      try {
        const v = (await verify(srv.url, t.patient, id.rec)).body.data.integrity;
        assert.equal(v.status, 'INTEGRITY_VERIFIED'); assert.equal(v.trustedSource, 'DATABASE');
        assert.match(v.warning, /unavailable/); assert.equal(v.blockchainHash, null);
      } finally { process.env.BLOCKCHAIN_RPC_URL = real; }
    });
  });

  describe('21. audit trail', () => {
    it('patient sees the full history of events about their data, newest first, without IP addresses', async () => {
      const r = await call(srv.url, 'GET', '/api/audit?limit=200', { token: t.patient });
      assert.equal(r.status, 200);
      const actions = new Set(r.body.data.items.map((i) => i.action));
      for (const a of ['REGISTER', 'WALLET_LINKED', 'RECORD_UPLOAD', 'RECORD_HASH_ANCHORED', 'ACCESS_REQUEST', 'ACCESS_GRANTED', 'RECORD_VIEW', 'HASH_VERIFICATION', 'TAMPER_DETECTED', 'ACCESS_DENIED']) {
        assert.ok(actions.has(a), `missing ${a}`);
      }
      const ts = r.body.data.items.map((i) => new Date(i.timestamp).getTime());
      assert.deepEqual(ts, [...ts].sort((a, b) => b - a));
      assert.ok(!JSON.stringify(r.body).includes('ipAddress'));
      const view = r.body.data.items.find((i) => i.action === 'RECORD_VIEW' && i.actor.role === 'DOCTOR');
      assert.equal(view.actor.name, 'Ravi'); assert.equal(view.record.title, 'Blood test');
      const grant = r.body.data.items.find((i) => i.action === 'ACCESS_GRANTED' && i.details.scope === 'RECORD');
      assert.match(grant.blockchainTransactionHash, /^0x[0-9a-f]{64}$/);
    });

    it('a doctor\'s denied attempt appears in the patient\'s trail', async () => {
      await verify(srv.url, t.doctor2, id.rec);
      const r = await call(srv.url, 'GET', '/api/audit?category=SECURITY', { token: t.patient });
      assert.ok(r.body.data.items.some((i) => i.action === 'ACCESS_DENIED' && i.details.reason === 'PERMISSION_DENIED'));
      assert.ok(r.body.data.items.every((i) => ['ACCESS_DENIED', 'TAMPER_DETECTED'].includes(i.action)));
    });

    it('filters by record, action and date; validates input', async () => {
      const r = await call(srv.url, 'GET', `/api/audit?recordId=${id.rec}&action=HASH_VERIFICATION`, { token: t.patient });
      assert.ok(r.body.data.total >= 3);
      assert.ok(r.body.data.items.every((i) => i.record.id === id.rec && i.action === 'HASH_VERIFICATION'));
      const tomorrow = new Date(Date.now() + 86400000).toISOString().slice(0, 10);
      assert.equal((await call(srv.url, 'GET', `/api/audit?from=${tomorrow}`, { token: t.patient })).body.data.total, 0);
      assert.equal((await call(srv.url, 'GET', '/api/audit?category=NOPE', { token: t.patient })).status, 400);
      assert.equal((await call(srv.url, 'GET', '/api/audit?from=xyz', { token: t.patient })).status, 400);
    });

    it('patients only see their own trail; doctors and admins have no access', async () => {
      const r = await call(srv.url, 'GET', '/api/audit?limit=200', { token: t.other });
      assert.ok(r.body.data.items.every((i) => !i.record || i.record.title !== 'Blood test'));
      assert.equal((await call(srv.url, 'GET', '/api/audit', { token: t.doctor })).status, 403);
      assert.equal((await call(srv.url, 'GET', '/api/audit', { token: t.admin })).status, 403);
      assert.equal((await call(srv.url, 'GET', '/api/audit')).status, 401);
    });

    it('summary counts doctor views, denied attempts, integrity checks and tamper alerts', async () => {
      const r = await call(srv.url, 'GET', '/api/audit/summary', { token: t.patient });
      assert.ok(r.body.data.last30Days.doctorViews >= 1);
      assert.ok(r.body.data.last30Days.deniedAttempts >= 1);
      assert.ok(r.body.data.last30Days.integrityChecks >= 3);
      assert.ok(r.body.data.tamperAlerts >= 4);
    });

    it('audit entries cannot be modified or deleted', async () => {
      const log = await M.AuditLog.findOne({ action: 'TAMPER_DETECTED' });
      await assert.rejects(M.AuditLog.deleteOne({ _id: log._id }), /append-only/);
      await assert.rejects(M.AuditLog.updateOne({ _id: log._id }, { action: 'LOGIN' }), /append-only/);
    });
  });
});

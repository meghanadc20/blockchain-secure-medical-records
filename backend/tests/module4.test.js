'use strict';
require('./setupEnv');
const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const { setupTestDB, teardownTestDB, startServer, call } = require('./helpers');
const { createApp } = require('../src/app');
const { getSupabase } = require('../src/config/supabase');
const { ensureBucket } = require('../scripts/setupStorage');
const { expireDuePermissions } = require('../src/services/permission.service');
const { startTestChain, freshWallet, linkWallet, share, revokeShare, revokeRelation } = require('./chain');

const BUCKET = process.env.SUPABASE_BUCKET;
const PDF = Buffer.concat([Buffer.from('%PDF-1.4\n'), crypto.randomBytes(1024), Buffer.from('\n%%EOF\n')]);
const inMin = (m) => new Date(Date.now() + m * 60_000).toISOString();

async function upload(url, token, title) {
  const fd = new FormData();
  fd.append('title', title); fd.append('recordType', 'LAB_REPORT');
  fd.append('file', new Blob([PDF], { type: 'application/pdf' }), `${title}.pdf`);
  const r = await fetch(`${url}/api/records`, { method: 'POST', headers: { Authorization: `Bearer ${token}` }, body: fd });
  const j = await r.json(); assert.equal(r.status, 201, JSON.stringify(j)); return j.data.record.id;
}
async function file(url, token, id) {
  const r = await fetch(`${url}/api/records/${id}/file`, { headers: { Authorization: `Bearer ${token}` } });
  const buf = Buffer.from(await r.arrayBuffer());
  let code = null; if (r.status !== 200) { try { code = JSON.parse(buf.toString()).error.code; } catch { /* */ } }
  return { status: r.status, buf, code };
}

describe('Phase 7 — Module 4: record sharing & access control (grants signed on Ganache)', () => {
  let M; let srv; let ch;
  const t = {}; const id = {}; const w = {};
  // Every successful grant/revoke is a real patient-signed blockchain transaction (Module 5).
  const walletFor = (token) => (token === t.patient ? w.patient : token === t.other ? w.other : undefined);
  const grantApi = (token, body) => share(srv.url, token, walletFor(token), body);
  const revokeApi = (token, permissionId) => revokeShare(srv.url, token, walletFor(token), permissionId);
  const reg = async (kind, body) => {
    const r = await call(srv.url, 'POST', `/api/auth/register/${kind}`, { body: { password: 'Secret123', phone: '9876543210', ...body } });
    assert.equal(r.status, 201); return r.body.data;
  };
  const relate = async (docTok, patTok, email) => {
    const r = await call(srv.url, 'POST', '/api/relations/requests', { token: docTok, body: { patientEmail: email } });
    await call(srv.url, 'PATCH', `/api/relations/${r.body.data.relation.id}/approve`, { token: patTok });
    return r.body.data.relation.id;
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
    d = await reg('doctor', { name: 'Nina', email: 'nina@example.com', specialization: 'Neuro', licenseNumber: 'K-2', hospital: 'Metro' }); t.doctor2 = d.token; id.doctor2 = d.user.id;
    d = await reg('doctor', { name: 'Omar', email: 'omar@example.com', specialization: 'ENT', licenseNumber: 'K-3', hospital: 'Metro' }); t.doctor3 = d.token; id.doctor3 = d.user.id;
    for (const doc of [id.doctor, id.doctor2, id.doctor3]) await call(srv.url, 'PATCH', `/api/admin/doctors/${doc}/approve`, { token: t.admin });
    id.rel1 = await relate(t.doctor, t.patient, 'asha@example.com');
    id.rel2 = await relate(t.doctor2, t.patient, 'asha@example.com');
    await call(srv.url, 'POST', '/api/relations/requests', { token: t.doctor3, body: { patientEmail: 'asha@example.com' } }); // pending only
    w.patient = freshWallet(ch.provider); w.other = freshWallet(ch.provider);
    assert.equal((await linkWallet(srv.url, t.patient, w.patient)).status, 200);
    assert.equal((await linkWallet(srv.url, t.other, w.other)).status, 200);
    id.rec1 = await upload(srv.url, t.patient, 'Blood test');
    id.rec2 = await upload(srv.url, t.patient, 'X-ray');
    id.recOther = await upload(srv.url, t.other, 'Other');
  });

  after(async () => {
    await srv.close();
    await ch.stop();
    try { await getSupabase().storage.emptyBucket(BUCKET); await new Promise((r) => setTimeout(r, 1500)); await getSupabase().storage.deleteBucket(BUCKET); } catch (e) { console.error('bucket cleanup', e.message); }
    await teardownTestDB();
  });

  describe('grant', () => {
    it('9/16. without a permission an approved doctor cannot read the record (403 PERMISSION_DENIED)', async () => {
      const r = await file(srv.url, t.doctor, id.rec1);
      assert.equal(r.status, 403); assert.equal(r.code, 'PERMISSION_DENIED');
    });

    it('patient grants time-limited access → 201 ACTIVE, audited', async () => {
      const r = await grantApi(t.patient, { recordId: id.rec1, doctorId: id.doctor, expiresAt: inMin(60) });
      assert.equal(r.status, 201, JSON.stringify(r.body));
      const p = r.body.data.permission;
      assert.equal(p.status, 'ACTIVE'); assert.equal(p.storedStatus, 'GRANTED');
      assert.match(p.blockchainTransactionHash, /^0x[0-9a-f]{64}$/);
      assert.equal(p.record.title, 'Blood test'); assert.equal(p.doctor.name, 'Ravi');
      assert.ok(p.grantedAt && p.expiresAt);
      id.perm1 = p.id;
      assert.ok(await M.AuditLog.exists({ action: 'ACCESS_GRANTED', 'metadata.scope': 'RECORD', recordId: id.rec1 }));
    });

    it('authorized doctor reads metadata and the decrypted file (audited RECORD_VIEW)', async () => {
      const meta = await call(srv.url, 'GET', `/api/records/${id.rec1}`, { token: t.doctor });
      assert.equal(meta.status, 200); assert.equal(meta.body.data.record.title, 'Blood test');
      assert.ok(meta.body.data.record.access.expiresAt);
      const f = await file(srv.url, t.doctor, id.rec1);
      assert.equal(f.status, 200); assert.deepEqual(f.buf, PDF);
      assert.ok(await M.AuditLog.exists({ action: 'RECORD_VIEW', recordId: id.rec1, doctorId: id.doctor }));
    });

    it('a permission covers only that record and only that doctor', async () => {
      assert.equal((await file(srv.url, t.doctor, id.rec2)).status, 403);
      assert.equal((await file(srv.url, t.doctor2, id.rec1)).status, 403);
    });

    it('doctor-to-doctor sharing goes through the patient: second doctor gets its own grant', async () => {
      const r = await grantApi(t.patient, { recordId: id.rec1, doctorId: id.doctor2, expiresAt: inMin(30) });
      assert.equal(r.status, 201);
      assert.equal((await file(srv.url, t.doctor2, id.rec1)).status, 200);
    });

    it('rejects a duplicate active grant (409 ALREADY_GRANTED)', async () => {
      const r = await grantApi(t.patient, { recordId: id.rec1, doctorId: id.doctor, expiresAt: inMin(90) });
      assert.equal(r.status, 409); assert.equal(r.body.error.code, 'ALREADY_GRANTED');
    });

    it('validates expiry: past, < 5 minutes, > 1 year, invalid', async () => {
      for (const expiresAt of [inMin(-10), inMin(2), inMin(60 * 24 * 400), 'not-a-date']) {
        const r = await grantApi(t.patient, { recordId: id.rec2, doctorId: id.doctor, expiresAt });
        assert.equal(r.status, 400, expiresAt);
      }
    });

    it('cannot grant to a doctor without an APPROVED relationship, or to a non-doctor', async () => {
      let r = await grantApi(t.patient, { recordId: id.rec2, doctorId: id.doctor3, expiresAt: inMin(60) });
      assert.equal(r.status, 409); assert.equal(r.body.error.code, 'RELATION_NOT_APPROVED');
      r = await grantApi(t.patient, { recordId: id.rec2, doctorId: id.other, expiresAt: inMin(60) });
      assert.equal(r.status, 404);
    });

    it('cannot share someone else\'s record (404); doctors/admins cannot grant (403)', async () => {
      let r = await grantApi(t.patient, { recordId: id.recOther, doctorId: id.doctor, expiresAt: inMin(60) });
      assert.equal(r.status, 404);
      r = await grantApi(t.doctor, { recordId: id.rec2, doctorId: id.doctor, expiresAt: inMin(60) });
      assert.equal(r.status, 403);
      r = await grantApi(t.admin, { recordId: id.rec2, doctorId: id.doctor, expiresAt: inMin(60) });
      assert.equal(r.status, 403);
    });

    it('patient record list shows the number of active shares', async () => {
      const r = await call(srv.url, 'GET', '/api/records', { token: t.patient });
      assert.equal(r.body.data.items.find((x) => x.id === id.rec1).activeShares, 2);
      assert.equal(r.body.data.items.find((x) => x.id === id.rec2).activeShares, 0);
    });

    it('doctor\'s authorised-records list shows only own permissions', async () => {
      const r = await call(srv.url, 'GET', '/api/permissions/doctor', { token: t.doctor });
      assert.equal(r.status, 200); assert.equal(r.body.data.total, 1);
      assert.equal(r.body.data.items[0].record.title, 'Blood test');
      assert.equal(r.body.data.items[0].patient.name, 'Asha');
    });
  });

  describe('13. revoke', () => {
    it('patient revokes → doctor denied immediately with PERMISSION_REVOKED (audited)', async () => {
      const r = await revokeApi(t.patient, id.perm1);
      assert.equal(r.status, 200); assert.equal(r.body.data.permission.status, 'REVOKED');
      assert.ok(r.body.data.permission.revokedAt);
      const f = await file(srv.url, t.doctor, id.rec1);
      assert.equal(f.status, 403); assert.equal(f.code, 'PERMISSION_REVOKED');
      assert.equal((await call(srv.url, 'GET', `/api/records/${id.rec1}`, { token: t.doctor })).status, 403);
      assert.ok(await M.AuditLog.exists({ action: 'ACCESS_REVOKED', 'metadata.scope': 'RECORD' }));
      assert.ok(await M.AuditLog.exists({ action: 'ACCESS_DENIED', 'metadata.reason': 'PERMISSION_REVOKED' }));
      // the other doctor's grant is unaffected
      assert.equal((await file(srv.url, t.doctor2, id.rec1)).status, 200);
    });

    it('revoking twice is 409; another patient cannot revoke (404)', async () => {
      assert.equal((await revokeApi(t.patient, id.perm1)).status, 409);
      const p2 = (await call(srv.url, 'GET', `/api/permissions?doctorId=${id.doctor2}`, { token: t.patient })).body.data.items[0];
      assert.equal((await revokeApi(t.other, p2.id)).status, 404);
    });

    it('patient can grant again after revoking (new permission, history kept)', async () => {
      const r = await grantApi(t.patient, { recordId: id.rec1, doctorId: id.doctor, expiresAt: inMin(60) });
      assert.equal(r.status, 201);
      assert.equal(await M.AccessPermission.countDocuments({ recordId: id.rec1, doctorId: id.doctor }), 2);
      assert.equal((await file(srv.url, t.doctor, id.rec1)).status, 200);
    });
  });

  describe('17. expired access', () => {
    it('access ends at expiresAt even before any sweep runs (PERMISSION_EXPIRED, audited)', async () => {
      const r = await grantApi(t.patient, { recordId: id.rec2, doctorId: id.doctor, expiresAt: inMin(10) });
      assert.equal(r.status, 201);
      assert.equal((await file(srv.url, t.doctor, id.rec2)).status, 200);
      // Simulate the passage of time: move expiry into the past.
      await M.AccessPermission.updateOne({ _id: r.body.data.permission.id }, { $set: { expiresAt: new Date(Date.now() - 1000), grantedAt: new Date(Date.now() - 60_000) } });
      const f = await file(srv.url, t.doctor, id.rec2);
      assert.equal(f.status, 403); assert.equal(f.code, 'PERMISSION_EXPIRED');
      const stored = await M.AccessPermission.findById(r.body.data.permission.id).lean();
      assert.equal(stored.status, 'EXPIRED', 'lazily marked EXPIRED');
      assert.ok(await M.AuditLog.exists({ action: 'ACCESS_EXPIRED', recordId: id.rec2, 'metadata.detectedBy': 'ACCESS_CHECK' }));
      assert.equal((await file(srv.url, t.doctor, id.rec2)).code, 'PERMISSION_EXPIRED', 'still expired on retry');
    });

    it('the periodic sweep expires due permissions and audits them as SYSTEM', async () => {
      const p = await M.AccessPermission.findOne({ doctorId: id.doctor2, status: 'GRANTED' });
      await M.AccessPermission.updateOne({ _id: p._id }, { $set: { expiresAt: new Date(Date.now() - 1000), grantedAt: new Date(Date.now() - 60_000) } });
      const n = await expireDuePermissions();
      assert.equal(n, 1);
      assert.equal((await M.AccessPermission.findById(p._id)).status, 'EXPIRED');
      assert.ok(await M.AuditLog.exists({ action: 'ACCESS_EXPIRED', actorRole: 'SYSTEM', 'metadata.detectedBy': 'SWEEP' }));
      assert.equal((await file(srv.url, t.doctor2, id.rec1)).code, 'PERMISSION_EXPIRED');
    });

    it('lists filter by ACTIVE / EXPIRED / REVOKED', async () => {
      const get = async (s) => (await call(srv.url, 'GET', `/api/permissions?status=${s}`, { token: t.patient })).body.data.items.map((x) => x.status);
      assert.deepEqual([...new Set(await get('ACTIVE'))], ['ACTIVE']);
      assert.deepEqual([...new Set(await get('EXPIRED'))], ['EXPIRED']);
      assert.deepEqual([...new Set(await get('REVOKED'))], ['REVOKED']);
      assert.equal((await call(srv.url, 'GET', '/api/permissions?status=FOO', { token: t.patient })).status, 400);
    });

    it('an expired permission can be replaced by a new grant', async () => {
      await ch.increaseTime(11 * 60); // the on-chain grant (10 min) must also have expired
      const r = await grantApi(t.patient, { recordId: id.rec2, doctorId: id.doctor, expiresAt: inMin(60) });
      assert.equal(r.status, 201);
      assert.equal((await file(srv.url, t.doctor, id.rec2)).status, 200);
    });
  });

  describe('relationship and verification still apply', () => {
    it('revoking the relationship revokes all record permissions for that doctor', async () => {
      assert.equal((await revokeRelation(srv.url, t.patient, w.patient, id.rel1)).status, 200);
      assert.equal(await M.AccessPermission.countDocuments({ doctorId: id.doctor, status: 'GRANTED' }), 0);
      const f = await file(srv.url, t.doctor, id.rec2);
      assert.equal(f.status, 403);
      assert.equal((await call(srv.url, 'GET', '/api/permissions/doctor', { token: t.doctor })).body.data.total, 0);
    });

    it('a doctor rejected by the admin loses access even with a live permission', async () => {
      const r = await grantApi(t.patient, { recordId: id.rec2, doctorId: id.doctor2, expiresAt: inMin(60) });
      assert.equal(r.status, 201);
      assert.equal((await file(srv.url, t.doctor2, id.rec2)).status, 200);
      await call(srv.url, 'PATCH', `/api/admin/doctors/${id.doctor2}/reject`, { token: t.admin });
      const f = await file(srv.url, t.doctor2, id.rec2);
      assert.equal(f.status, 403); assert.equal(f.code, 'DOCTOR_NOT_VERIFIED');
    });

    it('admins can never read records or list permissions', async () => {
      assert.equal((await file(srv.url, t.admin, id.rec2)).status, 403);
      assert.equal((await call(srv.url, 'GET', '/api/permissions', { token: t.admin })).status, 403);
      assert.equal((await call(srv.url, 'GET', '/api/permissions/doctor', { token: t.admin })).status, 403);
    });
  });
});

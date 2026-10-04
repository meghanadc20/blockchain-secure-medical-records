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
const storage = require('../src/services/storage.service');

const BUCKET = process.env.SUPABASE_BUCKET;
const PDF = Buffer.concat([Buffer.from('%PDF-1.4\n% Test medical report\n'), Buffer.from('Patient: Asha. Haemoglobin 13.2 g/dL. CONFIDENTIAL-MARKER\n'), crypto.randomBytes(2048), Buffer.from('\n%%EOF\n')]);
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), crypto.randomBytes(512)]);
const sha = (b) => crypto.createHash('sha256').update(b).digest('hex');

async function uploadAs(url, token, { file = PDF, name = 'blood-test.pdf', type = 'application/pdf', fields = {} } = {}) {
  const fd = new FormData();
  for (const [k, v] of Object.entries({ title: 'Blood test', recordType: 'LAB_REPORT', ...fields })) fd.append(k, v);
  if (file) fd.append('file', new Blob([file], { type }), name);
  const res = await fetch(`${url}/api/records`, { method: 'POST', headers: token ? { Authorization: `Bearer ${token}` } : {}, body: fd });
  return { status: res.status, body: await res.json().catch(() => null) };
}
async function fetchFile(url, token, id, q = '') {
  const res = await fetch(`${url}/api/records/${id}/file${q}`, { headers: token ? { Authorization: `Bearer ${token}` } : {} });
  const buf = Buffer.from(await res.arrayBuffer());
  return { status: res.status, headers: res.headers, buf, json: () => JSON.parse(buf.toString()) };
}

describe('Phase 6 — Module 3: encrypted off-chain storage (real Supabase)', () => {
  let M; let srv;
  const t = {}; const id = {};
  const reg = async (kind, body) => {
    const r = await call(srv.url, 'POST', `/api/auth/register/${kind}`, { body: { password: 'Secret123', phone: '9876543210', ...body } });
    assert.equal(r.status, 201); return r.body.data;
  };

  before(async () => {
    M = await setupTestDB();
    await ensureBucket(BUCKET);
    await getSupabase().storage.emptyBucket(BUCKET);
    srv = await startServer(createApp());
    await M.User.create({ name: 'Admin', email: 'admin@example.com', role: 'ADMIN', passwordHash: await bcrypt.hash('AdminPass123', 4) });
    t.admin = (await call(srv.url, 'POST', '/api/auth/login', { body: { email: 'admin@example.com', password: 'AdminPass123' } })).body.data.token;
    let d = await reg('patient', { name: 'Asha', email: 'asha@example.com' }); t.patient = d.token; id.patient = d.user.id;
    d = await reg('patient', { name: 'Bina', email: 'bina@example.com' }); t.other = d.token; id.other = d.user.id;
    d = await reg('doctor', { name: 'Ravi', email: 'ravi@example.com', specialization: 'Cardiology', licenseNumber: 'K-1', hospital: 'City' }); t.doctor = d.token; id.doctor = d.user.id;
    d = await reg('doctor', { name: 'Nina', email: 'nina@example.com', specialization: 'ENT', licenseNumber: 'K-2', hospital: 'City' }); t.doctor2 = d.token; id.doctor2 = d.user.id;
    d = await reg('doctor', { name: 'Pend', email: 'pend@example.com', specialization: 'ENT', licenseNumber: 'K-3', hospital: 'City' }); t.pending = d.token;
    for (const doc of [id.doctor, id.doctor2]) await call(srv.url, 'PATCH', `/api/admin/doctors/${doc}/approve`, { token: t.admin });
    const rel = await call(srv.url, 'POST', '/api/relations/requests', { token: t.doctor, body: { patientEmail: 'asha@example.com' } });
    await call(srv.url, 'PATCH', `/api/relations/${rel.body.data.relation.id}/approve`, { token: t.patient });
  });

  after(async () => {
    await srv.close();
    try { await getSupabase().storage.emptyBucket(BUCKET); await getSupabase().storage.deleteBucket(BUCKET); } catch (e) { console.error('bucket cleanup', e.message); }
    await teardownTestDB();
  });

  it('bucket is private', async () => {
    const { data } = await getSupabase().storage.getBucket(BUCKET);
    assert.equal(data.public, false);
  });

  it('14. patient uploads a PDF → 201, metadata in MongoDB, SHA-256 of the original', async () => {
    const r = await uploadAs(srv.url, t.patient, { fields: { description: 'Annual check' } });
    assert.equal(r.status, 201, JSON.stringify(r.body));
    const rec = r.body.data.record;
    id.rec = rec.id;
    assert.equal(rec.sha256Hash, sha(PDF));
    assert.equal(rec.fileSize, PDF.length);
    assert.equal(rec.mimeType, 'application/pdf');
    assert.equal(rec.fileName, 'blood-test.pdf');
    assert.equal(rec.hasFile, true);
    const raw = JSON.stringify(r.body);
    for (const k of ['storagePath', 'encryptionIv', 'encryptionAuthTag', 'encrypted-file']) assert.ok(!raw.includes(k), k);
    const db = await M.MedicalRecord.findById(rec.id).select('+encryptionIv +encryptionAuthTag').lean();
    assert.equal(db.storagePath, `${id.patient}/${rec.id}/encrypted-file`);
    assert.ok(db.encryptionIv && db.encryptionAuthTag);
    assert.ok(await M.AuditLog.exists({ action: 'RECORD_UPLOAD', recordId: rec.id }));
  });

  it('file is stored off-chain in Supabase ENCRYPTED (no plaintext at rest)', async () => {
    const db = await M.MedicalRecord.findById(id.rec).lean();
    const { data, error } = await getSupabase().storage.from(BUCKET).download(db.storagePath);
    assert.equal(error, null);
    const stored = Buffer.from(await data.arrayBuffer());
    assert.equal(stored.length, PDF.length, 'GCM ciphertext has the same length');
    assert.notDeepEqual(stored, PDF);
    assert.ok(!stored.includes(Buffer.from('%PDF')), 'no PDF header at rest');
    assert.ok(!stored.includes(Buffer.from('CONFIDENTIAL-MARKER')), 'no plaintext content at rest');
  });

  it('the private object is not reachable through a public URL', async () => {
    const db = await M.MedicalRecord.findById(id.rec).lean();
    const { data } = getSupabase().storage.from(BUCKET).getPublicUrl(db.storagePath);
    const res = await fetch(data.publicUrl);
    assert.ok(res.status >= 400, `public URL returned ${res.status}`);
  });

  it('15. owner downloads → decrypted bytes identical to the original', async () => {
    const r = await fetchFile(srv.url, t.patient, id.rec);
    assert.equal(r.status, 200);
    assert.deepEqual(r.buf, PDF);
    assert.equal(r.headers.get('content-type'), 'application/pdf');
    assert.match(r.headers.get('content-disposition'), /^attachment; filename="blood-test.pdf"/);
    assert.match(r.headers.get('cache-control'), /no-store/);
    assert.ok(await M.AuditLog.exists({ action: 'RECORD_VIEW', recordId: id.rec, 'metadata.type': 'FILE' }));
    const inline = await fetchFile(srv.url, t.patient, id.rec, '?disposition=inline');
    assert.match(inline.headers.get('content-disposition'), /^inline/);
  });

  it('PNG upload works', async () => {
    const r = await uploadAs(srv.url, t.patient, { file: PNG, name: 'scan.png', type: 'image/png', fields: { recordType: 'IMAGING', title: 'Scan' } });
    assert.equal(r.status, 201);
    assert.deepEqual((await fetchFile(srv.url, t.patient, r.body.data.record.id)).buf, PNG);
  });

  it('16. unauthorized retrieval is denied: other patient 404, doctor without permission 403, admin 403, anonymous 401', async () => {
    assert.equal((await fetchFile(srv.url, t.other, id.rec)).status, 404);
    const d = await fetchFile(srv.url, t.doctor, id.rec);
    assert.equal(d.status, 403); assert.equal(d.json().error.code, 'PERMISSION_DENIED');
    assert.equal((await fetchFile(srv.url, t.admin, id.rec)).status, 403);
    assert.equal((await fetchFile(srv.url, null, id.rec)).status, 401);
    assert.ok(await M.AuditLog.exists({ action: 'ACCESS_DENIED', recordId: id.rec, 'metadata.operation': 'READ_RECORD' }));
  });

  it('rejects disallowed types, spoofed content, oversize files and missing files', async () => {
    let r = await uploadAs(srv.url, t.patient, { file: Buffer.from('MZ\x90\x00 fake exe'), name: 'virus.exe', type: 'application/x-msdownload' });
    assert.equal(r.status, 400); assert.equal(r.body.error.code, 'UNSUPPORTED_FILE_TYPE');
    r = await uploadAs(srv.url, t.patient, { file: Buffer.from('MZ\x90\x00 not really a pdf'), name: 'report.pdf', type: 'application/pdf' });
    assert.equal(r.status, 400); assert.equal(r.body.error.code, 'FILE_CONTENT_MISMATCH');
    r = await uploadAs(srv.url, t.patient, { file: Buffer.concat([Buffer.from('%PDF-'), Buffer.alloc(10 * 1024 * 1024 + 10)]), name: 'big.pdf' });
    assert.equal(r.status, 413); assert.equal(r.body.error.code, 'FILE_TOO_LARGE');
    r = await uploadAs(srv.url, t.patient, { file: null });
    assert.equal(r.status, 400); assert.equal(r.body.error.code, 'FILE_REQUIRED');
    r = await uploadAs(srv.url, t.patient, { fields: { title: '', recordType: 'NOPE' } });
    assert.equal(r.status, 400); assert.equal(r.body.error.code, 'VALIDATION_ERROR');
  });

  it('patients cannot upload into another patient\'s records', async () => {
    const r = await uploadAs(srv.url, t.patient, { fields: { patientId: id.other } });
    assert.equal(r.status, 403);
  });

  it('doctor with APPROVED relationship uploads on behalf of the patient', async () => {
    const r = await uploadAs(srv.url, t.doctor, { fields: { patientId: id.patient, title: 'ECG report' } });
    assert.equal(r.status, 201, JSON.stringify(r.body));
    assert.equal(r.body.data.record.patientId, id.patient);
    assert.equal(r.body.data.record.uploadedBy.role, 'DOCTOR');
    // the patient owns and can read it
    assert.equal((await fetchFile(srv.url, t.patient, r.body.data.record.id)).status, 200);
  });

  it('doctor without relationship, unverified doctor, admin and anonymous cannot upload', async () => {
    let r = await uploadAs(srv.url, t.doctor2, { fields: { patientId: id.patient } });
    assert.equal(r.status, 403); assert.equal(r.body.error.code, 'PERMISSION_DENIED');
    r = await uploadAs(srv.url, t.doctor, { fields: {} });
    assert.equal(r.status, 400, 'doctor must name the patient');
    assert.equal((await uploadAs(srv.url, t.pending, { fields: { patientId: id.patient } })).status, 403);
    assert.equal((await uploadAs(srv.url, t.admin, {})).status, 403);
    assert.equal((await uploadAs(srv.url, null, {})).status, 401);
  });

  it('storage failure → 502 STORAGE_ERROR and nothing saved in MongoDB', async () => {
    const before = await M.MedicalRecord.countDocuments();
    const original = storage.upload;
    storage.upload = async () => { const ApiError = require('../src/utils/ApiError'); throw new ApiError(502, 'Secure file storage is unavailable. Please try again later.', 'STORAGE_ERROR'); };
    try {
      const r = await uploadAs(srv.url, t.patient);
      assert.equal(r.status, 502); assert.equal(r.body.error.code, 'STORAGE_ERROR');
    } finally { storage.upload = original; }
    assert.equal(await M.MedicalRecord.countDocuments(), before);
  });

  it('database failure after upload removes the orphaned encrypted object', async () => {
    const removed = [];
    const origRemove = storage.remove;
    storage.remove = async (key) => { removed.push(key); return origRemove.call(storage, key); };
    const origCreate = M.MedicalRecord.create;
    M.MedicalRecord.create = async () => { throw new Error('simulated database failure'); };
    try {
      const r = await uploadAs(srv.url, t.patient);
      assert.equal(r.status, 500);
      assert.ok(!JSON.stringify(r.body).includes('simulated'), 'internal error text is not exposed');
    } finally { M.MedicalRecord.create = origCreate; storage.remove = origRemove; }
    assert.equal(removed.length, 1);
    const folder = removed[0].split('/').slice(0, 2).join('/');
    const { data } = await getSupabase().storage.from(BUCKET).list(folder);
    assert.equal(data.length, 0, 'object was deleted from storage');
  });

  it('a modified ciphertext in storage is refused (FILE_INTEGRITY_FAILED, audited TAMPER_DETECTED)', async () => {
    const r0 = await uploadAs(srv.url, t.patient, { fields: { title: 'To be tampered' } });
    const db = await M.MedicalRecord.findById(r0.body.data.record.id).lean();
    const { data } = await getSupabase().storage.from(BUCKET).download(db.storagePath);
    const bytes = Buffer.from(await data.arrayBuffer());
    bytes[100] ^= 0xff; // flip one byte
    const up = await getSupabase().storage.from(BUCKET).upload(db.storagePath, bytes, { upsert: true, contentType: 'application/octet-stream' });
    assert.equal(up.error, null);
    const r = await fetchFile(srv.url, t.patient, db._id);
    assert.equal(r.status, 409);
    assert.equal(r.json().error.code, 'FILE_INTEGRITY_FAILED');
    assert.ok(await M.AuditLog.exists({ action: 'TAMPER_DETECTED', recordId: db._id }));
  });

  it('a record without a file returns 404 FILE_NOT_FOUND', async () => {
    const rec = await M.MedicalRecord.create({ patientId: id.patient, uploadedBy: id.patient, title: 'No file', recordType: 'OTHER' });
    const r = await fetchFile(srv.url, t.patient, rec._id);
    assert.equal(r.status, 404); assert.equal(r.json().error.code, 'FILE_NOT_FOUND');
  });
});

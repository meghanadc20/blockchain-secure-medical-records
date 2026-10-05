'use strict';
require('./setupEnv');
const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const { setupTestDB, teardownTestDB, startServer, call } = require('./helpers');
const { startTestChain, freshWallet, linkWallet, share, revokeShare } = require('./chain');
const { createApp } = require('../src/app');
const { getSupabase } = require('../src/config/supabase');
const { ensureBucket } = require('../scripts/setupStorage');
const chainSvc = require('../src/services/blockchain.service');

const BUCKET = process.env.SUPABASE_BUCKET;
const inMin = (m) => new Date(Date.now() + m * 60_000).toISOString();
const pdf = () => Buffer.concat([Buffer.from('%PDF-1.4\n'), crypto.randomBytes(600), Buffer.from('\n%%EOF\n')]);

async function upload(url, token, title) {
  const fd = new FormData();
  fd.append('title', title); fd.append('recordType', 'LAB_REPORT');
  fd.append('file', new Blob([pdf()], { type: 'application/pdf' }), `${title}.pdf`);
  const r = await fetch(`${url}/api/records`, { method: 'POST', headers: { Authorization: `Bearer ${token}` }, body: fd });
  const j = await r.json(); assert.equal(r.status, 201, JSON.stringify(j)); return j.data.record.id;
}
async function read(url, token, id) {
  const r = await fetch(`${url}/api/records/${id}/file`, { headers: { Authorization: `Bearer ${token}` } });
  const buf = Buffer.from(await r.arrayBuffer());
  let code = null; if (r.status !== 200) { try { code = JSON.parse(buf.toString()).error.code; } catch { /* */ } }
  return { status: r.status, code };
}

describe('Phase 10 — Module 7: time-limited access', () => {
  let M; let srv; let ch;
  const t = {}; const id = {}; let wallet;
  const reg = async (kind, body) => {
    const r = await call(srv.url, 'POST', `/api/auth/register/${kind}`, { body: { password: 'Secret123', phone: '9876543210', ...body } });
    assert.equal(r.status, 201); return r.body.data;
  };
  const chainNow = async () => (await ch.provider.getBlock('latest')).timestamp;

  before(async () => {
    M = await setupTestDB();
    ch = await startTestChain();
    await ensureBucket(BUCKET); await getSupabase().storage.emptyBucket(BUCKET);
    srv = await startServer(createApp());
    await M.User.create({ name: 'Admin', email: 'admin@example.com', role: 'ADMIN', passwordHash: await bcrypt.hash('AdminPass123', 4) });
    t.admin = (await call(srv.url, 'POST', '/api/auth/login', { body: { email: 'admin@example.com', password: 'AdminPass123' } })).body.data.token;
    let d = await reg('patient', { name: 'Asha', email: 'asha@example.com' }); t.patient = d.token; id.patient = d.user.id;
    d = await reg('doctor', { name: 'Ravi', email: 'ravi@example.com', specialization: 'Cardiology', licenseNumber: 'K-1', hospital: 'City' }); t.doctor = d.token; id.doctor = d.user.id;
    await call(srv.url, 'PATCH', `/api/admin/doctors/${id.doctor}/approve`, { token: t.admin });
    const rel = await call(srv.url, 'POST', '/api/relations/requests', { token: t.doctor, body: { patientEmail: 'asha@example.com' } });
    await call(srv.url, 'PATCH', `/api/relations/${rel.body.data.relation.id}/approve`, { token: t.patient });
    wallet = freshWallet(ch.provider);
    assert.equal((await linkWallet(srv.url, t.patient, wallet)).status, 200);
    id.rec1 = await upload(srv.url, t.patient, 'Blood test');
    id.rec2 = await upload(srv.url, t.patient, 'X-ray');
    id.rec3 = await upload(srv.url, t.patient, 'ECG');
  });

  after(async () => {
    await srv.close(); await ch.stop();
    try { await getSupabase().storage.emptyBucket(BUCKET); await new Promise((r) => setTimeout(r, 1500)); await getSupabase().storage.deleteBucket(BUCKET); } catch (e) { console.error('bucket cleanup', e.message); }
    await teardownTestDB();
  });

  it('22. grant time and expiry time are tracked for doctor, patient and record — identical in MongoDB and on-chain (to the second)', async () => {
    const r = await share(srv.url, t.patient, wallet, { recordId: id.rec1, doctorId: id.doctor, expiresAt: inMin(15) });
    assert.equal(r.status, 201, JSON.stringify(r.body));
    const p = r.body.data.permission; id.p1 = p.id;
    assert.equal(p.record.id, id.rec1); assert.equal(p.doctor.id, id.doctor); assert.equal(p.patient.id, id.patient);
    const g = await chainSvc.getGrant(id.rec1, id.doctor);
    assert.equal(new Date(p.expiresAt).getTime(), g.expiresAt * 1000, 'expiry identical');
    assert.equal(new Date(p.grantedAt).getTime(), g.grantedAt * 1000, 'grant time identical');
    assert.ok(p.secondsRemaining > 14 * 60 && p.secondsRemaining <= 15 * 60);
    assert.equal(p.expiringSoon, true);
  });

  it('15-minute shares are allowed; under 5 minutes is refused', async () => {
    const r = await call(srv.url, 'POST', '/api/permissions/prepare', { token: t.patient, body: { recordId: id.rec2, doctorId: id.doctor, expiresAt: inMin(3) } });
    assert.equal(r.status, 400);
  });

  it('lists report ACTIVE with secondsRemaining and the server time; EXPIRING filter', async () => {
    const r = await call(srv.url, 'GET', '/api/permissions?status=ACTIVE', { token: t.patient });
    assert.ok(r.body.data.serverTime);
    assert.equal(r.body.data.items[0].status, 'ACTIVE');
    const long = await share(srv.url, t.patient, wallet, { recordId: id.rec2, doctorId: id.doctor, expiresAt: inMin(3 * 24 * 60) });
    assert.equal(long.status, 201); id.p2 = long.body.data.permission.id;
    assert.equal(long.body.data.permission.expiringSoon, false);
    const exp = await call(srv.url, 'GET', '/api/permissions?status=EXPIRING', { token: t.patient });
    assert.deepEqual(exp.body.data.items.map((x) => x.id), [id.p1]);
    const dexp = await call(srv.url, 'GET', '/api/permissions/doctor?status=EXPIRING', { token: t.doctor });
    assert.equal(dexp.body.data.total, 1);
  });

  it('summaries for dashboards (patient and doctor)', async () => {
    const p = await call(srv.url, 'GET', '/api/permissions/summary', { token: t.patient });
    assert.equal(p.body.data.active, 2); assert.equal(p.body.data.expiringSoon, 1);
    assert.equal(new Date(p.body.data.nextExpiry).getTime(), new Date((await M.AccessPermission.findById(id.p1)).expiresAt).getTime());
    const d = await call(srv.url, 'GET', '/api/permissions/doctor/summary', { token: t.doctor });
    assert.equal(d.body.data.active, 2); assert.equal(d.body.data.expiringSoon, 1);
    assert.equal((await call(srv.url, 'GET', '/api/permissions/summary', { token: t.doctor })).status, 403);
  });

  it('on-chain boundary: active one minute before expiry, inactive right after', async () => {
    const g = await chainSvc.getGrant(id.rec1, id.doctor);
    const now = await chainNow();
    await ch.increaseTime(g.expiresAt - now - 60);
    assert.equal(await chainSvc.hasAccess(id.rec1, id.doctor), true);
    assert.equal((await read(srv.url, t.doctor, id.rec1)).status, 200);
    await ch.increaseTime(61);
    assert.equal(await chainSvc.hasAccess(id.rec1, id.doctor), false);
  });

  it('after expiry BOTH layers deny: MongoDB (wall clock) → PERMISSION_EXPIRED; blockchain alone → BLOCKCHAIN_PERMISSION_DENIED', async () => {
    // chain already expired, DB not yet → chain check denies
    let r = await read(srv.url, t.doctor, id.rec1);
    assert.equal(r.status, 403); assert.equal(r.code, 'BLOCKCHAIN_PERMISSION_DENIED');
    // now the database clock reaches expiry too
    await M.AccessPermission.updateOne({ _id: id.p1 }, { $set: { expiresAt: new Date(Date.now() - 1000) } });
    r = await read(srv.url, t.doctor, id.rec1);
    assert.equal(r.status, 403); assert.equal(r.code, 'PERMISSION_EXPIRED');
    const p = await M.AccessPermission.findById(id.p1);
    assert.equal(p.status, 'EXPIRED');
    const list = await call(srv.url, 'GET', `/api/permissions?recordId=${id.rec1}`, { token: t.patient });
    assert.equal(list.body.data.items[0].status, 'EXPIRED'); assert.equal(list.body.data.items[0].secondsRemaining, 0);
  });

  it('an expired grant cannot be revoked (409 PERMISSION_EXPIRED)', async () => {
    const r = await call(srv.url, 'PATCH', `/api/permissions/${id.p1}/revoke`, { token: t.patient, body: {} });
    assert.equal(r.status, 409);
  });

  it('a grant whose expiry passes while still GRANTED in MongoDB is marked EXPIRED when revoked', async () => {
    const g = await share(srv.url, t.patient, wallet, { recordId: id.rec3, doctorId: id.doctor, expiresAt: inMin(30) });
    assert.equal(g.status, 201);
    await M.AccessPermission.updateOne({ _id: g.body.data.permission.id }, { $set: { expiresAt: new Date(Date.now() - 1000) } });
    const r = await call(srv.url, 'GET', `/api/permissions/${g.body.data.permission.id}/revoke/prepare`, { token: t.patient });
    assert.equal(r.status, 409); assert.equal(r.body.error.code, 'PERMISSION_EXPIRED');
    assert.equal((await M.AccessPermission.findById(g.body.data.permission.id)).status, 'EXPIRED');
    await ch.increaseTime(31 * 60); // keep the chain consistent for later tests
  });

  it('changing the expiry = revoke (tx 1) + new grant (tx 2): old REVOKED, new ACTIVE with the new expiry, access continues', async () => {
    const before = await M.AccessPermission.findById(id.p2).lean();
    const rv = await revokeShare(srv.url, t.patient, wallet, id.p2);
    assert.equal(rv.status, 200, JSON.stringify(rv.body));
    const ng = await share(srv.url, t.patient, wallet, { recordId: id.rec2, doctorId: id.doctor, expiresAt: inMin(7 * 24 * 60) });
    assert.equal(ng.status, 201, JSON.stringify(ng.body));
    const after = ng.body.data.permission;
    assert.ok(new Date(after.expiresAt) > new Date(before.expiresAt));
    assert.equal((await M.AccessPermission.findById(id.p2)).status, 'REVOKED');
    assert.equal((await chainSvc.getGrant(id.rec2, id.doctor)).expiresAt * 1000, new Date(after.expiresAt).getTime());
    assert.equal((await read(srv.url, t.doctor, id.rec2)).status, 200);
  });

  it('expired access appears in the patient audit trail as ACCESS_EXPIRED', async () => {
    const r = await call(srv.url, 'GET', '/api/audit?action=ACCESS_EXPIRED', { token: t.patient });
    assert.ok(r.body.data.total >= 2);
  });
});

'use strict';
require('./setupEnv');
const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const { parseEther } = require('ethers');
const { setupTestDB, teardownTestDB, startServer, call } = require('./helpers');
const { startTestChain, freshWallet, linkWallet, signPrepared, share, revokeShare, revokeRelation } = require('./chain');
const { createApp } = require('../src/app');
const { getSupabase } = require('../src/config/supabase');
const { ensureBucket } = require('../scripts/setupStorage');
const chainSvc = require('../src/services/blockchain.service');

const BUCKET = process.env.SUPABASE_BUCKET;
const inMin = (m) => new Date(Date.now() + m * 60_000).toISOString();
const sha = (b) => crypto.createHash('sha256').update(b).digest('hex');
const pdf = () => Buffer.concat([Buffer.from('%PDF-1.4\n'), crypto.randomBytes(800), Buffer.from('\n%%EOF\n')]);

async function upload(url, token, title, file = pdf()) {
  const fd = new FormData();
  fd.append('title', title); fd.append('recordType', 'LAB_REPORT');
  fd.append('file', new Blob([file], { type: 'application/pdf' }), `${title}.pdf`);
  const r = await fetch(`${url}/api/records`, { method: 'POST', headers: { Authorization: `Bearer ${token}` }, body: fd });
  const j = await r.json(); assert.equal(r.status, 201, JSON.stringify(j));
  return { id: j.data.record.id, anchoring: j.data.anchoring, record: j.data.record, file };
}
async function read(url, token, id) {
  const r = await fetch(`${url}/api/records/${id}/file`, { headers: { Authorization: `Bearer ${token}` } });
  const buf = Buffer.from(await r.arrayBuffer());
  let code = null; if (r.status !== 200) { try { code = JSON.parse(buf.toString()).error.code; } catch { /* */ } }
  return { status: r.status, code, buf };
}

describe('Phase 8 — Module 5: blockchain & smart-contract layer (real Ganache transactions)', () => {
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
    await call(srv.url, 'PATCH', `/api/admin/doctors/${id.doctor}/approve`, { token: t.admin });
    const rel = await call(srv.url, 'POST', '/api/relations/requests', { token: t.doctor, body: { patientEmail: 'asha@example.com' } });
    id.rel = rel.body.data.relation.id;
    await call(srv.url, 'PATCH', `/api/relations/${id.rel}/approve`, { token: t.patient });
    w.patient = freshWallet(ch.provider); w.other = freshWallet(ch.provider);
  });

  after(async () => {
    await srv.close(); await ch.stop();
    try { await getSupabase().storage.emptyBucket(BUCKET); await new Promise((r) => setTimeout(r, 1500)); await getSupabase().storage.deleteBucket(BUCKET); } catch (e) { console.error('bucket cleanup', e.message); }
    await teardownTestDB();
  });

  describe('network & contract', () => {
    it('health reports a reachable local test chain with the deployed contract, owned by the backend signer', async () => {
      const r = await call(srv.url, 'GET', '/api/health');
      const b = r.body.data.blockchain;
      assert.equal(b.reachable, true); assert.equal(b.contractDeployed, true); assert.equal(b.signerIsOwner, true);
      assert.equal(b.chainId, 1337); assert.equal(b.localTestNetwork, true);
    });

    it('contract config for the browser contains the address and ABI but no secrets', async () => {
      const r = await call(srv.url, 'GET', '/api/blockchain/config', { token: t.patient });
      assert.equal(r.status, 200);
      assert.equal(r.body.data.contractAddress, ch.address);
      const raw = JSON.stringify(r.body);
      assert.ok(!raw.toLowerCase().includes(process.env.PRIVATE_KEY.slice(2).toLowerCase()), 'private key never exposed');
      assert.ok(!/mnemonic|privateKey|PRIVATE_KEY/i.test(raw));
    });
  });

  describe('patient wallet linking', () => {
    it('rejects a signature from a different wallet', async () => {
      const ch1 = await call(srv.url, 'POST', '/api/blockchain/wallet/challenge', { token: t.patient, body: { address: w.patient.address } });
      const forged = await w.other.signMessage(ch1.body.data.message);
      const r = await call(srv.url, 'POST', '/api/blockchain/wallet/link', { token: t.patient, body: { address: w.patient.address, signature: forged, challengeToken: ch1.body.data.challengeToken } });
      assert.equal(r.status, 400); assert.equal(r.body.error.code, 'SIGNATURE_INVALID');
    });

    it('a challenge issued to one patient cannot be used by another', async () => {
      const ch1 = await call(srv.url, 'POST', '/api/blockchain/wallet/challenge', { token: t.patient, body: { address: w.patient.address } });
      const sig = await w.patient.signMessage(ch1.body.data.message);
      const r = await call(srv.url, 'POST', '/api/blockchain/wallet/link', { token: t.other, body: { address: w.patient.address, signature: sig, challengeToken: ch1.body.data.challengeToken } });
      assert.equal(r.status, 400); assert.equal(r.body.error.code, 'CHALLENGE_INVALID');
    });

    it('links with a valid signature: saved, registered on-chain (real tx), funded with TEST ether only', async () => {
      const before = await ch.provider.getBalance(w.patient.address);
      assert.equal(before, 0n);
      const r = await linkWallet(srv.url, t.patient, w.patient);
      assert.equal(r.status, 200, JSON.stringify(r.body));
      assert.match(r.body.data.registrationTxHash, /^0x[0-9a-f]{64}$/);
      const receipt = await ch.provider.getTransactionReceipt(r.body.data.registrationTxHash);
      assert.equal(receipt.status, 1);
      assert.equal(await chainSvc.getPatientWallet(id.patient), w.patient.address);
      assert.equal((await M.User.findById(id.patient)).walletAddress, w.patient.address.toLowerCase());
      assert.ok((await ch.provider.getBalance(w.patient.address)) >= parseEther('1'));
      assert.ok(await M.AuditLog.exists({ action: 'WALLET_LINKED', blockchainTransactionHash: r.body.data.registrationTxHash.toLowerCase() }));
    });

    it('the same wallet cannot be linked to a second account; doctors cannot link wallets', async () => {
      const r = await linkWallet(srv.url, t.other, w.patient);
      assert.equal(r.status, 409); assert.equal(r.body.error.code, 'WALLET_IN_USE');
      const d = await call(srv.url, 'POST', '/api/blockchain/wallet/challenge', { token: t.doctor, body: { address: w.other.address } });
      assert.equal(d.status, 403);
    });
  });

  describe('record hash anchoring', () => {
    it('upload anchors the SHA-256 fingerprint on-chain (owner tx, audited)', async () => {
      const u = await upload(srv.url, t.patient, 'Blood test');
      id.rec1 = u.id; id.rec1File = u.file;
      assert.equal(u.anchoring, 'ANCHORED');
      assert.match(u.record.blockchainTransactionHash, /^0x[0-9a-f]{64}$/);
      const onChain = await chainSvc.getRecord(u.id);
      assert.equal(onChain.exists, true);
      assert.equal(onChain.fileHash, sha(u.file));
      assert.equal(onChain.patientKey, chainSvc.patientKey(id.patient));
      assert.ok(await M.AuditLog.exists({ action: 'RECORD_HASH_ANCHORED', recordId: u.id }));
    });
  });

  describe('18. blockchain permissions (patient-signed grants verified by the backend)', () => {
    it('prepare requires a linked wallet', async () => {
      const u = await upload(srv.url, t.other, 'Other record');
      const r = await call(srv.url, 'POST', '/api/permissions/prepare', { token: t.other, body: { recordId: u.id, doctorId: id.doctor, expiresAt: inMin(60) } });
      assert.ok([409].includes(r.status)); // relation not approved or wallet not linked
    });

    it('prepare returns exactly what to sign; nothing is stored until a verified transaction is confirmed', async () => {
      const r = await call(srv.url, 'POST', '/api/permissions/prepare', { token: t.patient, body: { recordId: id.rec1, doctorId: id.doctor, expiresAt: inMin(60) } });
      assert.equal(r.status, 200, JSON.stringify(r.body));
      const p = r.body.data;
      assert.equal(p.method, 'grantAccess');
      assert.deepEqual(p.args.slice(0, 2), [chainSvc.recordKey(id.rec1), chainSvc.doctorKey(id.doctor)]);
      assert.equal(p.contractAddress, ch.address);
      assert.equal(await M.AccessPermission.countDocuments(), 0);
      id.prepared = p;
    });

    it('confirm rejects: missing/garbage hash, unrelated tx, tx for a different expiry', async () => {
      const body = { recordId: id.rec1, doctorId: id.doctor, expiresAt: id.prepared.expiresAt };
      let r = await call(srv.url, 'POST', '/api/permissions', { token: t.patient, body });
      assert.equal(r.status, 400); assert.equal(r.body.error.code, 'BLOCKCHAIN_TX_INVALID');
      r = await call(srv.url, 'POST', '/api/permissions', { token: t.patient, body: { ...body, txHash: `0x${'1'.repeat(64)}` } });
      assert.equal(r.status, 400);
      const transfer = await (await w.patient.sendTransaction({ to: w.other.address, value: 1n })).wait();
      r = await call(srv.url, 'POST', '/api/permissions', { token: t.patient, body: { ...body, txHash: transfer.hash } });
      assert.equal(r.status, 400); assert.match(r.body.error.message, /contract/);
    });

    it('a real grant with a different expiry cannot be passed off as the requested one', async () => {
      const otherExpiry = { ...id.prepared, args: [id.prepared.args[0], id.prepared.args[1], id.prepared.args[2] + 600] };
      const txHash = await signPrepared(otherExpiry, w.patient);
      const r = await call(srv.url, 'POST', '/api/permissions', { token: t.patient, body: { recordId: id.rec1, doctorId: id.doctor, expiresAt: id.prepared.expiresAt, txHash } });
      assert.equal(r.status, 400); assert.match(r.body.error.message, /expiry/);
      // clean up the on-chain grant made above so the real flow below can proceed
      const rev = await (await chainSvc.hasAccess(id.rec1, id.doctor));
      assert.equal(rev, true);
      const { Contract } = require('ethers');
      const artifact = require('../src/blockchain/MedicalAccessControl.json');
      await (await new Contract(ch.address, artifact.abi, w.patient).revokeAccess(chainSvc.recordKey(id.rec1), chainSvc.doctorKey(id.doctor))).wait();
    });

    it('full flow: patient signs grantAccess → backend verifies receipt → permission stored with tx hash', async () => {
      const r = await share(srv.url, t.patient, w.patient, { recordId: id.rec1, doctorId: id.doctor, expiresAt: inMin(60) });
      assert.equal(r.status, 201, JSON.stringify(r.body));
      id.perm = r.body.data.permission;
      assert.match(id.perm.blockchainTransactionHash, /^0x[0-9a-f]{64}$/);
      const receipt = await ch.provider.getTransactionReceipt(id.perm.blockchainTransactionHash);
      assert.equal(receipt.from, w.patient.address);
      assert.equal(await chainSvc.hasAccess(id.rec1, id.doctor), true);
      assert.ok(await M.AuditLog.exists({ action: 'ACCESS_GRANTED', blockchainTransactionHash: id.perm.blockchainTransactionHash }));
    });

    it('the same transaction cannot be confirmed twice', async () => {
      await M.AccessPermission.updateOne({ _id: id.perm.id }, { status: 'EXPIRED' }); // free the DB slot
      const r = await call(srv.url, 'POST', '/api/permissions', { token: t.patient, body: { recordId: id.rec1, doctorId: id.doctor, expiresAt: id.perm.expiresAt, txHash: id.perm.blockchainTransactionHash } });
      assert.equal(r.status, 409); assert.equal(r.body.error.code, 'TX_ALREADY_USED');
      await M.AccessPermission.updateOne({ _id: id.perm.id }, { status: 'GRANTED' });
    });

    it('doctor read succeeds only when BOTH MongoDB and the contract allow it', async () => {
      const ok = await read(srv.url, t.doctor, id.rec1);
      assert.equal(ok.status, 200); assert.deepEqual(ok.buf, id.rec1File);
    });

    it('a database-only permission (no on-chain grant) is refused', async () => {
      const u = await upload(srv.url, t.patient, 'X-ray');
      id.rec2 = u.id;
      const forged = await M.AccessPermission.create({ recordId: u.id, patientId: id.patient, doctorId: id.doctor, expiresAt: new Date(Date.now() + 3600e3), blockchainTransactionHash: `0x${'e'.repeat(64)}` });
      let r = await read(srv.url, t.doctor, u.id);
      assert.equal(r.status, 403); assert.equal(r.code, 'BLOCKCHAIN_PERMISSION_DENIED');
      await M.AccessPermission.updateOne({ _id: forged._id }, { $unset: { blockchainTransactionHash: 1 } });
      r = await read(srv.url, t.doctor, u.id);
      assert.equal(r.status, 403); assert.equal(r.code, 'PERMISSION_NOT_ON_CHAIN');
      await M.AccessPermission.deleteOne({ _id: forged._id });
    });

    it('on-chain expiry is enforced independently: chain time past expiry → denied even if MongoDB still says active', async () => {
      const r = await share(srv.url, t.patient, w.patient, { recordId: id.rec2, doctorId: id.doctor, expiresAt: inMin(10) });
      assert.equal(r.status, 201, JSON.stringify(r.body));
      assert.equal((await read(srv.url, t.doctor, id.rec2)).status, 200);
      await ch.increaseTime(11 * 60);
      const after = await read(srv.url, t.doctor, id.rec2);
      assert.equal(after.status, 403);
      assert.equal(after.code, 'BLOCKCHAIN_PERMISSION_DENIED');
    });

    it('13. revoking an on-chain grant requires the patient\'s transaction; then access ends on both layers', async () => {
      // rec1's grant (60 min) is still active on-chain despite the 11 min jump
      let r = await call(srv.url, 'PATCH', `/api/permissions/${id.perm.id}/revoke`, { token: t.patient, body: {} });
      assert.equal(r.status, 400); assert.equal(r.body.error.code, 'TX_REQUIRED');
      r = await revokeShare(srv.url, t.patient, w.patient, id.perm.id);
      assert.equal(r.status, 200, JSON.stringify(r.body));
      assert.equal(r.body.data.permission.status, 'REVOKED');
      assert.match(r.body.data.permission.revokeTransactionHash, /^0x[0-9a-f]{64}$/);
      assert.equal(await chainSvc.hasAccess(id.rec1, id.doctor), false);
      const f = await read(srv.url, t.doctor, id.rec1);
      assert.equal(f.status, 403); assert.equal(f.code, 'PERMISSION_REVOKED');
    });

    it('revoking the whole doctor relationship requires revokeDoctor() and invalidates every on-chain grant', async () => {
      const g = await share(srv.url, t.patient, w.patient, { recordId: id.rec1, doctorId: id.doctor, expiresAt: inMin(120) });
      assert.equal(g.status, 201);
      let r = await call(srv.url, 'PATCH', `/api/relations/${id.rel}/revoke`, { token: t.patient, body: {} });
      assert.equal(r.status, 400); assert.equal(r.body.error.code, 'TX_REQUIRED');
      r = await revokeRelation(srv.url, t.patient, w.patient, id.rel);
      assert.equal(r.status, 200, JSON.stringify(r.body));
      assert.equal(await chainSvc.hasAccess(id.rec1, id.doctor), false);
      const perm = await M.AccessPermission.findById(g.body.data.permission.id);
      assert.equal(perm.status, 'REVOKED'); assert.match(perm.revokeTransactionHash, /^0x/);
    });
  });

  describe('blockchain failure handling (fail closed)', () => {
    it('if the chain is unreachable: doctor reads are denied (503), sharing is refused, uploads still succeed with anchoring PENDING', async () => {
      // Re-approve and re-share so the doctor has a valid grant, then take the chain "offline".
      const rel = await call(srv.url, 'POST', '/api/relations/requests', { token: t.doctor, body: { patientEmail: 'asha@example.com' } });
      await call(srv.url, 'PATCH', `/api/relations/${rel.body.data.relation.id}/approve`, { token: t.patient });
      const g = await share(srv.url, t.patient, w.patient, { recordId: id.rec1, doctorId: id.doctor, expiresAt: inMin(60) });
      assert.equal(g.status, 201, JSON.stringify(g.body));
      assert.equal((await read(srv.url, t.doctor, id.rec1)).status, 200);

      const realUrl = process.env.BLOCKCHAIN_RPC_URL;
      process.env.BLOCKCHAIN_RPC_URL = 'http://127.0.0.1:9'; // nothing listens here
      try {
        const f = await read(srv.url, t.doctor, id.rec1);
        assert.equal(f.status, 503); assert.equal(f.code, 'BLOCKCHAIN_UNAVAILABLE');
        const u = await upload(srv.url, t.patient, 'Offline upload');
        id.pending = u.id;
        assert.equal(u.anchoring, 'PENDING');
        assert.equal(u.record.blockchainTransactionHash, null);
        const p = await call(srv.url, 'POST', '/api/permissions/prepare', { token: t.patient, body: { recordId: u.id, doctorId: id.doctor, expiresAt: inMin(60) } });
        assert.equal(p.status, 503);
        const h = await call(srv.url, 'GET', '/api/health');
        assert.equal(h.body.data.blockchain.reachable, false);
      } finally { process.env.BLOCKCHAIN_RPC_URL = realUrl; }
      assert.ok(await M.AuditLog.exists({ action: 'ACCESS_DENIED', 'metadata.reason': 'BLOCKCHAIN_UNAVAILABLE' }));
    });

    it('when the chain is back, sharing a pending record anchors it first', async () => {
      const r = await share(srv.url, t.patient, w.patient, { recordId: id.pending, doctorId: id.doctor, expiresAt: inMin(60) });
      assert.equal(r.status, 201, JSON.stringify(r.body));
      const rec = await M.MedicalRecord.findById(id.pending);
      assert.match(rec.blockchainTransactionHash, /^0x/);
      assert.equal((await chainSvc.getRecord(id.pending)).fileHash, rec.sha256Hash);
    });
  });
});

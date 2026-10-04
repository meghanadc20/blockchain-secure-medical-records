'use strict';
require('./setupEnv');
const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { keccak256, toUtf8Bytes } = require('ethers');
const { startTestChain } = require('./chain');
const artifact = require('../src/blockchain/MedicalAccessControl.json');

const key = (s) => keccak256(toUtf8Bytes(s));
const HASH = `0x${'ab'.repeat(32)}`;

describe('Phase 8 — MedicalAccessControl smart contract (Ganache)', () => {
  let ch; let owner; let patient; let attacker; let other;
  const P = key('patient:p1'); const R = key('record:r1'); const D = key('doctor:d1'); const D2 = key('doctor:d2');
  const now = async () => (await ch.provider.getBlock('latest')).timestamp;
  const { revertData } = require('../src/services/blockchain.service');
  const errName = (e) => { const d = revertData(e); try { return d ? ch.contract().interface.parseError(d).name : null; } catch { return null; } };
  const reverts = async (p, name) => assert.rejects(p, (e) => errName(e) === name || (e.revert && e.revert.name === name));

  before(async () => {
    ch = await startTestChain();
    [owner, patient, attacker, other] = ch.wallets;
  });
  after(async () => { await ch.stop(); });

  it('deployer is the owner', async () => {
    assert.equal(await ch.contract().owner(), owner.address);
  });

  it('ABI contains no functions or events that carry medical content (only keys, hashes, addresses, times)', () => {
    const types = artifact.abi.flatMap((x) => (x.inputs || []).concat(x.outputs || []).map((i) => i.type));
    assert.ok(types.every((t) => ['bytes32', 'address', 'uint64', 'bool'].includes(t)), types.join(','));
  });

  it('only the owner can register wallets and records', async () => {
    await reverts(ch.contract(attacker).registerPatientWallet(P, attacker.address), 'NotOwner');
    await reverts(ch.contract(attacker).registerRecord(R, P, HASH), 'NotOwner');
    await (await ch.contract(owner).registerPatientWallet(P, patient.address)).wait();
    await (await ch.contract(owner).registerRecord(R, P, HASH)).wait();
    assert.equal(await ch.contract().patientWallets(P), patient.address);
    const rec = await ch.contract().getRecord(R);
    assert.equal(rec.fileHash, HASH); assert.equal(rec.exists, true);
  });

  it('a record fingerprint can never be overwritten, and zero hashes are refused', async () => {
    await reverts(ch.contract(owner).registerRecord(R, P, `0x${'cd'.repeat(32)}`), 'RecordAlreadyRegistered');
    await reverts(ch.contract(owner).registerRecord(key('record:r2'), P, `0x${'00'.repeat(32)}`), 'InvalidHash');
  });

  it('only the patient wallet can grant; expiry must be in the future', async () => {
    const t = await now();
    await reverts(ch.contract(attacker).grantAccess(R, D, t + 3600), 'NotPatientWallet');
    await reverts(ch.contract(owner).grantAccess(R, D, t + 3600), 'NotPatientWallet');
    await reverts(ch.contract(patient).grantAccess(R, D, t - 1), 'InvalidExpiry');
    await reverts(ch.contract(patient).grantAccess(key('record:none'), D, t + 3600), 'RecordNotRegistered');
  });

  it('grant → hasAccess true for that doctor only, emits AccessGranted, duplicate refused', async () => {
    const t = await now();
    const receipt = await (await ch.contract(patient).grantAccess(R, D, t + 3600)).wait();
    const ev = receipt.logs.map((l) => { try { return ch.contract().interface.parseLog(l); } catch { return null; } }).find((e) => e && e.name === 'AccessGranted');
    assert.equal(ev.args.recordKey, R); assert.equal(ev.args.doctorKey, D); assert.equal(ev.args.patientWallet, patient.address);
    assert.equal(await ch.contract().hasAccess(R, D), true);
    assert.equal(await ch.contract().hasAccess(R, D2), false);
    await reverts(ch.contract(patient).grantAccess(R, D, t + 7200), 'AlreadyActive');
  });

  it('access expires on-chain when block time passes expiresAt', async () => {
    await ch.increaseTime(3601);
    assert.equal(await ch.contract().hasAccess(R, D), false);
    await reverts(ch.contract(patient).revokeAccess(R, D), 'NotActive');
  });

  it('after expiry a new grant is possible; revoke ends it immediately (only by the patient)', async () => {
    const t = await now();
    await (await ch.contract(patient).grantAccess(R, D, t + 3600)).wait();
    assert.equal(await ch.contract().hasAccess(R, D), true);
    await reverts(ch.contract(attacker).revokeAccess(R, D), 'NotPatientWallet');
    await (await ch.contract(patient).revokeAccess(R, D)).wait();
    assert.equal(await ch.contract().hasAccess(R, D), false);
    const g = await ch.contract().getGrant(R, D);
    assert.ok(Number(g.revokedAt) > 0);
  });

  it('revokeDoctor invalidates all earlier grants for that doctor; new grants work afterwards', async () => {
    const t = await now();
    await (await ch.contract(owner).registerRecord(key('record:r3'), P, HASH)).wait();
    await (await ch.contract(patient).grantAccess(R, D2, t + 3600)).wait();
    await (await ch.contract(patient).grantAccess(key('record:r3'), D2, t + 3600)).wait();
    await reverts(ch.contract(attacker).revokeDoctor(P, D2), 'NotPatientWallet');
    await (await ch.contract(patient).revokeDoctor(P, D2)).wait();
    assert.equal(await ch.contract().hasAccess(R, D2), false);
    assert.equal(await ch.contract().hasAccess(key('record:r3'), D2), false);
    await (await ch.contract(patient).grantAccess(R, D2, (await now()) + 3600)).wait();
    assert.equal(await ch.contract().hasAccess(R, D2), true);
  });

  it('re-linking a wallet moves control: the old wallet can no longer grant', async () => {
    await (await ch.contract(owner).registerPatientWallet(P, other.address)).wait();
    await reverts(ch.contract(patient).grantAccess(key('record:r3'), D, (await now()) + 3600), 'NotPatientWallet');
    await (await ch.contract(other).grantAccess(key('record:r3'), D, (await now()) + 3600)).wait();
    assert.equal(await ch.contract().hasAccess(key('record:r3'), D), true);
  });
});

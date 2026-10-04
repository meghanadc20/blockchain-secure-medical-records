'use strict';
/**
 * Blockchain layer (Module 5) — Ethers.js v6 against the LOCAL Ganache chain.
 *
 * Only pseudonymous identifiers and SHA-256 fingerprints go on-chain:
 *   patientKey = keccak256("patient:<mongoId>"), doctorKey = keccak256("doctor:<mongoId>"),
 *   recordKey  = keccak256("record:<mongoId>").
 * The backend (contract owner) signs only registerPatientWallet / registerRecord.
 * Grants and revocations are signed by the patient's own wallet (MetaMask); the backend only
 * VERIFIES those transactions from their receipts — it never trusts the browser's word.
 * Every failure is fail-closed: if the chain can't be reached, access is denied.
 */
const { JsonRpcProvider, Wallet, Contract, Interface, keccak256, toUtf8Bytes, getAddress, parseEther, formatEther } = require('ethers');
const artifact = require('../blockchain/MedicalAccessControl.json');
const ApiError = require('../utils/ApiError');

const LOCAL_CHAIN_IDS = [1337, 31337];
const CALL_TIMEOUT_MS = 8000;
const TX_TIMEOUT_MS = 30000;
const iface = new Interface(artifact.abi);

/* ------------------------------------------------------------------ config */

function config() {
  // Read at call time (not at require time) so tests and `npm run chain:deploy` updates take effect.
  return {
    rpcUrl: (process.env.BLOCKCHAIN_RPC_URL || '').trim(),
    chainId: Number(process.env.CHAIN_ID) || 1337,
    contractAddress: (process.env.CONTRACT_ADDRESS || '').trim(),
    privateKey: (process.env.PRIVATE_KEY || '').trim(),
  };
}

function isConfigured() {
  const c = config();
  return Boolean(c.rpcUrl && /^0x[0-9a-fA-F]{40}$/.test(c.contractAddress) && /^(0x)?[0-9a-fA-F]{64}$/.test(c.privateKey));
}

const unavailable = (detail) => {
  if (detail) console.error('[blockchain]', detail);
  return new ApiError(503, 'The blockchain network is unavailable, so this action cannot be verified. Please try again later.', 'BLOCKCHAIN_UNAVAILABLE');
};

let cache = { key: null };
function clients() {
  if (!isConfigured()) throw unavailable('blockchain is not configured (BLOCKCHAIN_RPC_URL / CONTRACT_ADDRESS / PRIVATE_KEY)');
  const c = config();
  const key = `${c.rpcUrl}|${c.contractAddress}|${c.privateKey.slice(-6)}|${c.chainId}`;
  if (cache.key !== key) {
    const provider = new JsonRpcProvider(c.rpcUrl, c.chainId, { staticNetwork: true, polling: true, pollingInterval: 250, cacheTimeout: -1 });
    const signer = new Wallet(c.privateKey, provider);
    cache = {
      key,
      provider,
      signer,
      read: new Contract(c.contractAddress, artifact.abi, provider),
      write: new Contract(c.contractAddress, artifact.abi, signer),
      contractAddress: getAddress(c.contractAddress),
      chainId: c.chainId,
    };
  }
  return cache;
}

function withTimeout(promise, ms, what) {
  let t;
  return Promise.race([
    promise,
    new Promise((_, reject) => { t = setTimeout(() => reject(new Error(`${what} timed out after ${ms} ms`)), ms); }),
  ]).finally(() => clearTimeout(t));
}

/** Extracts revert data from ethers errors, including Ganache's { data: { result } } format. */
function revertData(err) {
  const candidates = [err && err.data, err && err.info && err.info.error && err.info.error.data, err && err.error && err.error.data];
  for (const c of candidates) {
    if (typeof c === 'string' && c.startsWith('0x')) return c;
    if (c && typeof c === 'object' && typeof c.result === 'string' && c.result.startsWith('0x')) return c.result;
  }
  return null;
}

/** Converts ethers/network errors into API errors; contract reverts become 409 BLOCKCHAIN_REJECTED. */
function mapError(err, what) {
  if (err instanceof ApiError) return err;
  const data = revertData(err);
  if (data && typeof data === 'string' && data.length >= 10) {
    try {
      const parsed = iface.parseError(data);
      return new ApiError(409, `The smart contract rejected the transaction (${parsed.name}).`, 'BLOCKCHAIN_REJECTED', [{ field: 'contract', message: parsed.name }]);
    } catch { /* not a contract error */ }
  }
  if (err && err.code === 'CALL_EXCEPTION') return new ApiError(409, 'The smart contract rejected the transaction.', 'BLOCKCHAIN_REJECTED');
  return unavailable(`${what}: ${err && (err.shortMessage || err.message)}`);
}

/* -------------------------------------------------------------------- keys */

const patientKey = (id) => keccak256(toUtf8Bytes(`patient:${String(id)}`));
const doctorKey = (id) => keccak256(toUtf8Bytes(`doctor:${String(id)}`));
const recordKey = (id) => keccak256(toUtf8Bytes(`record:${String(id)}`));
const toBytes32Hash = (sha256Hex) => `0x${String(sha256Hex).toLowerCase()}`;

/* ------------------------------------------------------------------ status */

async function status() {
  if (!isConfigured()) return { configured: false, reachable: false };
  try {
    const { provider, contractAddress, chainId, read, signer } = clients();
    const [net, code, block, owner] = await withTimeout(Promise.all([
      provider.send('eth_chainId', []), provider.getCode(contractAddress), provider.getBlockNumber(), read.owner().catch(() => null),
    ]), 3000, 'status');
    const actualChainId = parseInt(net, 16);
    return {
      configured: true,
      reachable: true,
      chainId: actualChainId,
      chainIdMatches: actualChainId === chainId,
      localTestNetwork: LOCAL_CHAIN_IDS.includes(actualChainId),
      contractAddress,
      contractDeployed: code && code !== '0x',
      signerIsOwner: Boolean(owner) && getAddress(owner) === signer.address,
      blockNumber: block,
    };
  } catch (err) {
    return { configured: true, reachable: false, error: 'unreachable' };
  }
}

/* ------------------------------------------------------- owner (backend) */

async function sendOwnerTx(fnName, args) {
  try {
    const { write } = clients();
    const tx = await withTimeout(write[fnName](...args), CALL_TIMEOUT_MS, fnName);
    const receipt = await withTimeout(tx.wait(), TX_TIMEOUT_MS, `${fnName} confirmation`);
    if (!receipt || receipt.status !== 1) throw new ApiError(409, 'The blockchain transaction failed.', 'BLOCKCHAIN_REJECTED');
    return { txHash: receipt.hash, blockNumber: receipt.blockNumber };
  } catch (err) { throw mapError(err, fnName); }
}

/** Links a verified patient wallet on-chain. */
function registerPatientWallet(patientId, wallet) {
  return sendOwnerTx('registerPatientWallet', [patientKey(patientId), getAddress(wallet)]);
}

/** Anchors a record's SHA-256 fingerprint on-chain (idempotent: returns { alreadyRegistered: true } if present). */
async function registerRecord(recordId, patientId, sha256Hex) {
  const existing = await getRecord(recordId);
  if (existing.exists) return { alreadyRegistered: true, fileHash: existing.fileHash };
  return sendOwnerTx('registerRecord', [recordKey(recordId), patientKey(patientId), toBytes32Hash(sha256Hex)]);
}

/** Local test chain only: gives a newly linked patient wallet some TEST ether for gas. */
async function fundTestWallet(address, { minimum = '0.5', amount = '1' } = {}) {
  try {
    const { provider, signer, chainId } = clients();
    if (!LOCAL_CHAIN_IDS.includes(chainId)) return { funded: false, reason: 'not a local test chain' };
    const actual = parseInt(await withTimeout(provider.send('eth_chainId', []), CALL_TIMEOUT_MS, 'chainId'), 16);
    if (!LOCAL_CHAIN_IDS.includes(actual)) return { funded: false, reason: 'not a local test chain' };
    const balance = await withTimeout(provider.getBalance(address), CALL_TIMEOUT_MS, 'balance');
    if (balance >= parseEther(minimum)) return { funded: false, balance: formatEther(balance) };
    const tx = await withTimeout(signer.sendTransaction({ to: getAddress(address), value: parseEther(amount) }), CALL_TIMEOUT_MS, 'fund');
    const receipt = await withTimeout(tx.wait(), TX_TIMEOUT_MS, 'fund confirmation');
    return { funded: true, amount, txHash: receipt.hash };
  } catch (err) { throw mapError(err, 'fundTestWallet'); }
}

/* ------------------------------------------------------------------ views */

async function getRecord(recordId) {
  try {
    const { read } = clients();
    const [pk, fileHash, registeredAt, exists] = await withTimeout(read.getRecord(recordKey(recordId)), CALL_TIMEOUT_MS, 'getRecord');
    return { patientKey: pk, fileHash: exists ? fileHash.slice(2) : null, registeredAt: Number(registeredAt), exists };
  } catch (err) { throw mapError(err, 'getRecord'); }
}

async function getPatientWallet(patientId) {
  try {
    const { read } = clients();
    const w = await withTimeout(read.patientWallets(patientKey(patientId)), CALL_TIMEOUT_MS, 'patientWallets');
    return w === '0x0000000000000000000000000000000000000000' ? null : getAddress(w);
  } catch (err) { throw mapError(err, 'patientWallets'); }
}

/** On-chain access check (grant exists, not revoked, current doctor epoch, not expired). */
async function hasAccess(recordId, doctorId) {
  try {
    const { read } = clients();
    return await withTimeout(read.hasAccess(recordKey(recordId), doctorKey(doctorId)), CALL_TIMEOUT_MS, 'hasAccess');
  } catch (err) { throw mapError(err, 'hasAccess'); }
}

async function getGrant(recordId, doctorId) {
  try {
    const { read } = clients();
    const [grantedAt, expiresAt, revokedAt, epoch, exists] = await withTimeout(read.getGrant(recordKey(recordId), doctorKey(doctorId)), CALL_TIMEOUT_MS, 'getGrant');
    return { grantedAt: Number(grantedAt), expiresAt: Number(expiresAt), revokedAt: Number(revokedAt), epoch: Number(epoch), exists };
  } catch (err) { throw mapError(err, 'getGrant'); }
}

/* ------------------------------------------- verify patient-signed transactions */

const TX_HASH_RE = /^0x[0-9a-fA-F]{64}$/;
const rejected = (msg) => new ApiError(400, msg, 'BLOCKCHAIN_TX_INVALID');

/**
 * Loads a receipt and returns the decoded events of OUR contract.
 * Ensures: well-formed hash, mined, succeeded, sent to our contract, from `expectedFrom`.
 */
async function loadVerifiedReceipt(txHash, expectedFrom) {
  if (!TX_HASH_RE.test(String(txHash || ''))) throw rejected('A valid blockchain transaction hash is required.');
  let receipt; let tx;
  try {
    const { provider } = clients();
    [receipt, tx] = await withTimeout(Promise.all([provider.getTransactionReceipt(txHash), provider.getTransaction(txHash)]), CALL_TIMEOUT_MS, 'receipt');
  } catch (err) { throw mapError(err, 'receipt'); }
  const { contractAddress } = clients();
  if (!receipt || !tx) throw rejected('Transaction not found on the blockchain.');
  if (receipt.status !== 1) throw rejected('The blockchain transaction failed.');
  if (!receipt.to || getAddress(receipt.to) !== contractAddress) throw rejected('Transaction was not sent to the access-control contract.');
  if (getAddress(tx.from) !== getAddress(expectedFrom)) throw rejected('Transaction was not signed by your linked wallet.');
  const events = [];
  for (const log of receipt.logs) {
    if (getAddress(log.address) !== contractAddress) continue;
    try { events.push(iface.parseLog(log)); } catch { /* not ours */ }
  }
  return { receipt, events };
}

/** Verifies an AccessGranted event matching record, doctor, patient wallet and expiry. */
async function verifyGrantTx(txHash, { recordId, doctorId, wallet, expiresAtSec }) {
  const { receipt, events } = await loadVerifiedReceipt(txHash, wallet);
  const ev = events.find((e) => e.name === 'AccessGranted'
    && e.args.recordKey === recordKey(recordId)
    && e.args.doctorKey === doctorKey(doctorId)
    && getAddress(e.args.patientWallet) === getAddress(wallet));
  if (!ev) throw rejected('The transaction does not grant this doctor access to this record.');
  if (Number(ev.args.expiresAt) !== Number(expiresAtSec)) throw rejected('The on-chain expiry does not match the requested expiry.');
  return { txHash: receipt.hash, blockNumber: receipt.blockNumber, grantedAt: Number(ev.args.grantedAt), expiresAt: Number(ev.args.expiresAt) };
}

/** Verifies an AccessRevoked event for record + doctor from the patient's wallet. */
async function verifyRevokeTx(txHash, { recordId, doctorId, wallet }) {
  const { receipt, events } = await loadVerifiedReceipt(txHash, wallet);
  const ev = events.find((e) => e.name === 'AccessRevoked'
    && e.args.recordKey === recordKey(recordId) && e.args.doctorKey === doctorKey(doctorId));
  if (!ev) throw rejected('The transaction does not revoke this access.');
  return { txHash: receipt.hash, blockNumber: receipt.blockNumber, revokedAt: Number(ev.args.revokedAt) };
}

/** Verifies a DoctorRevoked event (all of this patient's grants to the doctor invalidated). */
async function verifyDoctorRevokeTx(txHash, { patientId, doctorId, wallet }) {
  const { receipt, events } = await loadVerifiedReceipt(txHash, wallet);
  const ev = events.find((e) => e.name === 'DoctorRevoked'
    && e.args.patientKey === patientKey(patientId) && e.args.doctorKey === doctorKey(doctorId));
  if (!ev) throw rejected('The transaction does not revoke this doctor.');
  return { txHash: receipt.hash, blockNumber: receipt.blockNumber, epoch: Number(ev.args.newEpoch) };
}

/** Public info the browser needs to build patient transactions (no secrets). */
function publicConfig() {
  const { contractAddress, chainId } = clients();
  return { contractAddress, chainId, rpcUrl: config().rpcUrl, abi: artifact.abi };
}

module.exports = {
  LOCAL_CHAIN_IDS, revertData,
  isConfigured, status, publicConfig,
  patientKey, doctorKey, recordKey, toBytes32Hash,
  registerPatientWallet, registerRecord, fundTestWallet,
  getRecord, getPatientWallet, hasAccess, getGrant,
  verifyGrantTx, verifyRevokeTx, verifyDoctorRevokeTx,
};

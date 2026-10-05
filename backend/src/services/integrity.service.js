'use strict';
/**
 * Hash-based integrity verification (Module 6).
 *
 *   stored ciphertext ─decrypt (AES-GCM)→ retrieved original ─SHA-256→ currentHash
 *   currentHash  ==  trusted hash (on-chain fingerprint, anchored at upload)  → INTEGRITY_VERIFIED
 *   otherwise                                                                → TAMPER_DETECTED
 *
 * Also detected as tampering: ciphertext altered (GCM auth tag fails) and the MongoDB copy of the
 * hash differing from the on-chain fingerprint. Hashing is a fingerprint, not encryption.
 * If a record is not anchored yet, or the chain is unreachable, the MongoDB hash is used and the
 * result says so (trustedSource: DATABASE).
 */
const storage = require('./storage.service');
const chain = require('./blockchain.service');
const { decryptBuffer } = require('./crypto.service');
const { sha256Hex } = require('./hash.service');
const { logAudit } = require('./audit.service');

const VERIFIED = 'INTEGRITY_VERIFIED';
const TAMPERED = 'TAMPER_DETECTED';

async function trustedHashFor(record) {
  if (!record.blockchainTransactionHash) {
    return { source: 'DATABASE', hash: record.sha256Hash, warning: 'Record fingerprint is not anchored on the blockchain yet.' };
  }
  try {
    const onChain = await chain.getRecord(record._id);
    if (!onChain.exists) {
      return { source: 'DATABASE', hash: record.sha256Hash, warning: 'The on-chain fingerprint was not found (was the local blockchain reset?).' };
    }
    return { source: 'BLOCKCHAIN', hash: onChain.fileHash, registeredAt: onChain.registeredAt };
  } catch (err) {
    return { source: 'DATABASE', hash: record.sha256Hash, warning: 'The blockchain is unavailable, so the database copy of the fingerprint was used.' };
  }
}

/**
 * Downloads, decrypts and verifies a record's file.
 * Always writes a HASH_VERIFICATION audit entry; tampering also writes TAMPER_DETECTED.
 * @returns {{ plain: Buffer|null, result: object }}
 */
async function verifyRecordFile(req, record, { purpose = 'VERIFY' } = {}) {
  const checkedAt = new Date();
  const trusted = await trustedHashFor(record);
  const base = {
    recordId: String(record._id),
    algorithm: 'SHA-256',
    storedHash: record.sha256Hash || null,          // MongoDB copy
    blockchainHash: trusted.source === 'BLOCKCHAIN' ? trusted.hash : null,
    trustedSource: trusted.source,
    anchorTransactionHash: record.blockchainTransactionHash || null,
    ...(trusted.warning ? { warning: trusted.warning } : {}),
    checkedAt,
  };

  const encrypted = await storage.download(record.storagePath);
  let plain = null; let result;
  try {
    plain = decryptBuffer(encrypted, record.encryptionIv, record.encryptionAuthTag);
  } catch (err) {
    if (err.code !== 'FILE_INTEGRITY_FAILED') throw err;
    result = { ...base, status: TAMPERED, currentHash: null, stage: 'DECRYPTION', reason: 'The stored encrypted file was modified (authentication tag mismatch).' };
  }

  if (!result) {
    const currentHash = sha256Hex(plain);
    if (currentHash !== String(trusted.hash).toLowerCase()) {
      result = { ...base, status: TAMPERED, currentHash, stage: 'FILE_HASH', reason: `The retrieved file's SHA-256 does not match the ${trusted.source === 'BLOCKCHAIN' ? 'on-chain' : 'stored'} fingerprint.` };
    } else if (trusted.source === 'BLOCKCHAIN' && String(record.sha256Hash).toLowerCase() !== currentHash) {
      result = { ...base, status: TAMPERED, currentHash, stage: 'METADATA_HASH', reason: 'The database copy of the fingerprint was altered; the file matches the on-chain fingerprint.' };
    } else {
      result = { ...base, status: VERIFIED, currentHash };
    }
  }

  const who = req.user.role === 'DOCTOR' ? { doctorId: req.user._id } : {};
  await logAudit({
    req, action: 'HASH_VERIFICATION', recordId: record._id, patientId: record.patientId, ...who,
    blockchainTransactionHash: record.blockchainTransactionHash,
    metadata: { result: result.status, trustedSource: result.trustedSource, purpose, ...(result.stage ? { stage: result.stage } : {}) },
  });
  if (result.status === TAMPERED) {
    await logAudit({
      req, action: 'TAMPER_DETECTED', recordId: record._id, patientId: record.patientId, ...who,
      blockchainTransactionHash: record.blockchainTransactionHash,
      metadata: { stage: result.stage, trustedSource: result.trustedSource, purpose },
    });
    plain = null; // a tampered file is never delivered
  }
  return { plain, result };
}

module.exports = { verifyRecordFile, VERIFIED, TAMPERED };

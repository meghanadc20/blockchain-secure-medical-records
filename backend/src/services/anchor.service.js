'use strict';
/**
 * Anchors a record's SHA-256 fingerprint on the blockchain (owner transaction).
 * Called right after upload; if the chain is unavailable then, it is retried automatically
 * before the record is shared (sharing requires an anchored record).
 */
const MedicalRecord = require('../models/MedicalRecord');
const ApiError = require('../utils/ApiError');
const chain = require('./blockchain.service');
const { logAudit } = require('./audit.service');

async function anchorRecord(record, { req } = {}) {
  if (record.blockchainTransactionHash) return { txHash: record.blockchainTransactionHash, already: true };
  if (!record.sha256Hash) throw ApiError.conflict('This record has no file, so it cannot be anchored or shared.', 'RECORD_HAS_NO_FILE');

  const result = await chain.registerRecord(record._id, record.patientId, record.sha256Hash);
  if (result.alreadyRegistered) {
    // Registered earlier but our DB write was lost: only accept if the on-chain fingerprint matches.
    if (result.fileHash !== String(record.sha256Hash).toLowerCase()) {
      throw new ApiError(409, 'The on-chain fingerprint does not match this record.', 'HASH_MISMATCH');
    }
    return { txHash: null, already: true };
  }
  await MedicalRecord.updateOne({ _id: record._id, blockchainTransactionHash: { $exists: false } }, { blockchainTransactionHash: result.txHash });
  await logAudit({
    ...(req ? { req } : { system: true }),
    action: 'RECORD_HASH_ANCHORED', recordId: record._id, patientId: record.patientId, blockchainTransactionHash: result.txHash,
    metadata: { blockNumber: result.blockNumber },
  });
  return { txHash: result.txHash, already: false };
}

module.exports = { anchorRecord };

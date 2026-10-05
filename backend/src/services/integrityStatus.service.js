'use strict';
const AuditLog = require('../models/AuditLog');

/** Latest integrity-check result per record (from the append-only audit trail). Map recordId → { status, checkedAt, trustedSource }. */
async function latestIntegrityChecks(recordIds) {
  if (!recordIds.length) return new Map();
  const rows = await AuditLog.aggregate([
    { $match: { action: 'HASH_VERIFICATION', recordId: { $in: recordIds } } },
    { $sort: { timestamp: -1 } },
    { $group: { _id: '$recordId', status: { $first: '$metadata.result' }, trustedSource: { $first: '$metadata.trustedSource' }, checkedAt: { $first: '$timestamp' } } },
  ]);
  return new Map(rows.map((r) => [String(r._id), { status: r.status, trustedSource: r.trustedSource, checkedAt: r.checkedAt }]));
}

module.exports = { latestIntegrityChecks };

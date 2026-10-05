'use strict';
const AuditLog = require('../models/AuditLog');
const ApiError = require('../utils/ApiError');
const { AUDIT_ACTIONS } = require('../utils/constants');
const { parsePagination, paginated } = require('../utils/pagination');

/**
 * Patient-facing audit trail: every event that concerns the signed-in patient's data —
 * uploads, shares, revocations, doctor views, denied attempts, integrity checks, tampering.
 * IP addresses and internal identifiers are not shown; metadata is reduced to a safe whitelist.
 */

const CATEGORIES = {
  ACCESS: ['ACCESS_REQUEST', 'ACCESS_GRANTED', 'ACCESS_REJECTED', 'ACCESS_REVOKED', 'ACCESS_EXPIRED'],
  VIEWS: ['RECORD_VIEW'],
  SECURITY: ['ACCESS_DENIED', 'TAMPER_DETECTED'],
  INTEGRITY: ['HASH_VERIFICATION', 'TAMPER_DETECTED', 'RECORD_HASH_ANCHORED'],
  RECORDS: ['RECORD_UPLOAD', 'RECORD_UPDATED', 'CONSULTATION_ADDED', 'RECORD_HASH_ANCHORED'],
  ACCOUNT: ['REGISTER', 'LOGIN', 'LOGOUT', 'PROFILE_UPDATED', 'WALLET_LINKED'],
};
const SAFE_METADATA = ['scope', 'reason', 'result', 'trustedSource', 'stage', 'purpose', 'type', 'operation', 'expiresAt', 'onChain', 'permissionsRevoked', 'fields', 'detectedBy', 'uploadedByRole', 'mimeType', 'fileSize', 'count', 'integrity', 'testEtherFunded'];

function toView(log) {
  const meta = {};
  for (const k of SAFE_METADATA) if (log.metadata && log.metadata[k] !== undefined) meta[k] = log.metadata[k];
  return {
    id: String(log._id),
    action: log.action,
    timestamp: log.timestamp,
    actor: log.actorId && log.actorId.name
      ? { role: log.actorRole, name: log.actorId.name }
      : { role: log.actorRole, name: log.actorRole === 'SYSTEM' ? 'System' : null },
    doctor: log.doctorId && log.doctorId.name ? { id: String(log.doctorId._id), name: log.doctorId.name } : null,
    record: log.recordId && log.recordId.title ? { id: String(log.recordId._id), title: log.recordId.title } : (log.recordId ? { id: String(log.recordId), title: null } : null),
    blockchainTransactionHash: log.blockchainTransactionHash || null,
    details: meta,
  };
}

function parseDate(v, label, endOfDay = false) {
  if (!v) return undefined;
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) throw ApiError.badRequest(`${label} is not a valid date`, 'VALIDATION_ERROR');
  return endOfDay ? new Date(d.getTime() + 86400000 - 1) : d;
}

/** GET /api/audit?category=&action=&recordId=&from=&to=&page=&limit= */
async function listForPatient(req, res) {
  const pg = parsePagination(req.query, { defaultLimit: 50 });
  const filter = { patientId: req.user._id };
  if (req.query.category) {
    const c = String(req.query.category).toUpperCase();
    if (!CATEGORIES[c]) throw ApiError.badRequest(`category must be one of: ${Object.keys(CATEGORIES).join(', ')}`, 'VALIDATION_ERROR');
    filter.action = { $in: CATEGORIES[c] };
  }
  if (req.query.action) {
    const a = String(req.query.action).toUpperCase();
    if (!AUDIT_ACTIONS.includes(a)) throw ApiError.badRequest('Unknown action', 'VALIDATION_ERROR');
    filter.action = a;
  }
  if (req.query.recordId) {
    if (!require('mongoose').isValidObjectId(req.query.recordId)) throw ApiError.badRequest('Invalid recordId', 'INVALID_ID');
    filter.recordId = req.query.recordId;
  }
  const from = parseDate(req.query.from, 'from'); const to = parseDate(req.query.to, 'to', true);
  if (from || to) filter.timestamp = { ...(from ? { $gte: from } : {}), ...(to ? { $lte: to } : {}) };

  const [items, total] = await Promise.all([
    AuditLog.find(filter).sort({ timestamp: -1 }).skip(pg.skip).limit(pg.limit)
      .populate('actorId', 'name').populate('doctorId', 'name').populate('recordId', 'title').lean(),
    AuditLog.countDocuments(filter),
  ]);
  res.json({ success: true, data: paginated(items.map(toView), total, pg) });
}

/** GET /api/audit/summary — counts for the patient dashboard (last 30 days + all-time tamper alerts). */
async function summary(req, res) {
  const since = new Date(Date.now() - 30 * 86400000);
  const [views, denied, tamper, verifications] = await Promise.all([
    AuditLog.countDocuments({ patientId: req.user._id, action: 'RECORD_VIEW', actorRole: 'DOCTOR', timestamp: { $gte: since } }),
    AuditLog.countDocuments({ patientId: req.user._id, action: 'ACCESS_DENIED', timestamp: { $gte: since } }),
    AuditLog.countDocuments({ patientId: req.user._id, action: 'TAMPER_DETECTED' }),
    AuditLog.countDocuments({ patientId: req.user._id, action: 'HASH_VERIFICATION', timestamp: { $gte: since } }),
  ]);
  res.json({ success: true, data: { last30Days: { doctorViews: views, deniedAttempts: denied, integrityChecks: verifications }, tamperAlerts: tamper } });
}

module.exports = { listForPatient, summary, CATEGORIES };

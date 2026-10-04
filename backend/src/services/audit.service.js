'use strict';
const AuditLog = require('../models/AuditLog');

/**
 * Appends an audit entry. Never throws: an audit failure must not break the user's request,
 * but it is reported in the server log.
 *
 * @param {object} p
 * @param {import('express').Request} [p.req]  used for actor + IP when given
 * @param {object} [p.actor]                   { _id, role } — defaults to req.user
 * @param {string} p.action                    one of AUDIT_ACTIONS
 * @param {*} [p.patientId] @param {*} [p.doctorId] @param {*} [p.recordId]
 * @param {string} [p.blockchainTransactionHash]
 * @param {object} [p.metadata]                must not contain medical content
 * @param {boolean} [p.system]                 true for automatic events (e.g. scheduled expiry)
 */
async function logAudit({ req, actor, action, patientId, doctorId, recordId, blockchainTransactionHash, metadata = {}, system = false }) {
  const who = actor || (req && req.user) || null;
  try {
    return await AuditLog.create({
      actorId: who ? who._id : undefined,
      actorRole: who ? who.role : (system ? 'SYSTEM' : 'ANONYMOUS'),
      action,
      patientId,
      doctorId,
      recordId,
      ipAddress: req ? req.ip : undefined,
      blockchainTransactionHash,
      metadata,
    });
  } catch (err) {
    console.error(`[audit] Failed to write ${action}:`, err.message);
    return null;
  }
}

module.exports = { logAudit };

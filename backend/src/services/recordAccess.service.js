'use strict';
/**
 * Single place that decides who may READ a medical record (metadata + file).
 *  - Patient: only their own records.
 *  - Doctor (already verified by route middleware): APPROVED relationship + live, unexpired,
 *    unrevoked record permission (permission.service).
 *  - Admin: never.
 */
const MedicalRecord = require('../models/MedicalRecord');
const ApiError = require('../utils/ApiError');
const { ROLES } = require('../utils/constants');
const { logAudit } = require('./audit.service');
const { checkDoctorRecordAccess } = require('./permission.service');

const STATUS_FOR = { PERMISSION_DENIED: 403, PERMISSION_EXPIRED: 403, PERMISSION_REVOKED: 403, PERMISSION_NOT_ON_CHAIN: 403, BLOCKCHAIN_PERMISSION_DENIED: 403 };

/** Loads the record (with encryption fields) and checks read access. Returns { record, permission? }. */
async function loadReadableRecord(req, recordId) {
  const rec = await MedicalRecord.findById(recordId).select('+encryptionIv +encryptionAuthTag').populate('uploadedBy', 'name role').lean();
  if (!rec) throw ApiError.notFound('Record not found.', 'RECORD_NOT_FOUND');

  if (req.user.role === ROLES.PATIENT) {
    if (String(rec.patientId) === String(req.user._id)) return { record: rec };
    await logAudit({ req, action: 'ACCESS_DENIED', recordId: rec._id, patientId: rec.patientId, metadata: { reason: 'NOT_RECORD_OWNER', operation: 'READ_RECORD' } });
    throw ApiError.notFound('Record not found.', 'RECORD_NOT_FOUND');
  }

  if (req.user.role === ROLES.DOCTOR) {
    let decision;
    try {
      decision = await checkDoctorRecordAccess(req.user._id, rec, { req });
    } catch (err) {
      await logAudit({ req, action: 'ACCESS_DENIED', recordId: rec._id, patientId: rec.patientId, doctorId: req.user._id, metadata: { reason: err.code || 'ERROR', operation: 'READ_RECORD' } });
      throw err; // e.g. 503 BLOCKCHAIN_UNAVAILABLE — fail closed
    }
    if (decision.allowed) return { record: rec, permission: decision.permission };
    await logAudit({
      req, action: 'ACCESS_DENIED', recordId: rec._id, patientId: rec.patientId, doctorId: req.user._id,
      metadata: { reason: decision.code, operation: 'READ_RECORD', ...(decision.permission ? { permissionId: String(decision.permission._id) } : {}) },
    });
    throw new ApiError(STATUS_FOR[decision.code] || 403, decision.message, decision.code);
  }

  await logAudit({ req, action: 'ACCESS_DENIED', recordId: rec._id, patientId: rec.patientId, metadata: { reason: 'ROLE_NOT_ALLOWED', operation: 'READ_RECORD' } });
  throw ApiError.forbidden('You do not have permission to access this record.', 'PERMISSION_DENIED');
}

module.exports = { loadReadableRecord };

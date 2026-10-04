'use strict';
/**
 * Single place that decides who may READ a medical record (metadata + file).
 * Module 3: only the owning patient. Module 4 extends this with doctor permissions
 * (APPROVED relationship + live, unexpired, unrevoked record permission).
 */
const MedicalRecord = require('../models/MedicalRecord');
const ApiError = require('../utils/ApiError');
const { ROLES } = require('../utils/constants');
const { logAudit } = require('./audit.service');

/** Loads the record (with encryption fields) and checks read access. Returns the record. */
async function loadReadableRecord(req, recordId) {
  const rec = await MedicalRecord.findById(recordId).select('+encryptionIv +encryptionAuthTag').populate('uploadedBy', 'name role').lean();
  if (!rec) throw ApiError.notFound('Record not found.', 'RECORD_NOT_FOUND');

  if (req.user.role === ROLES.PATIENT && String(rec.patientId) === String(req.user._id)) return rec;

  await logAudit({
    req, action: 'ACCESS_DENIED', recordId: rec._id, patientId: rec.patientId,
    ...(req.user.role === ROLES.DOCTOR ? { doctorId: req.user._id } : {}),
    metadata: { reason: req.user.role === ROLES.PATIENT ? 'NOT_RECORD_OWNER' : 'NO_PERMISSION', operation: 'READ_RECORD' },
  });
  if (req.user.role === ROLES.PATIENT) throw ApiError.notFound('Record not found.', 'RECORD_NOT_FOUND');
  throw ApiError.forbidden('You do not have permission to access this record.', 'PERMISSION_DENIED');
}

module.exports = { loadReadableRecord };

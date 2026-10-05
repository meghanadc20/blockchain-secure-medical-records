'use strict';
const MedicalRecord = require('../models/MedicalRecord');
const ApiError = require('../utils/ApiError');
const { RECORD_TYPES } = require('../utils/constants');
const { rules, validate, cleanString } = require('../utils/validators');
const { parsePagination, paginated } = require('../utils/pagination');
const { logAudit } = require('../services/audit.service');
const { toRecordView } = require('../services/record.service');

/**
 * Module 2 — medical-record metadata for the owning patient.
 * File upload/download (Module 3) and doctor access via permissions (Module 4) build on these.
 */

async function findOwnRecordOr404(req) {
  const rec = await MedicalRecord.findById(req.params.recordId).populate('uploadedBy', 'name role').lean();
  if (!rec || String(rec.patientId) !== String(req.user._id)) {
    if (rec) await logAudit({ req, action: 'ACCESS_DENIED', recordId: rec._id, metadata: { reason: 'NOT_RECORD_OWNER' } });
    throw ApiError.notFound('Record not found.', 'RECORD_NOT_FOUND');
  }
  return rec;
}

/** GET /api/records?type=&q=&page=&limit= — the patient's own records, newest first. */
async function listOwn(req, res) {
  const pg = parsePagination(req.query);
  const filter = { patientId: req.user._id };
  if (req.query.type) {
    const type = String(req.query.type).toUpperCase();
    if (!RECORD_TYPES.includes(type)) throw ApiError.badRequest(`type must be one of: ${RECORD_TYPES.join(', ')}`, 'VALIDATION_ERROR');
    filter.recordType = type;
  }
  const q = cleanString(req.query.q);
  if (q) filter.title = new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').slice(0, 100), 'i');

  const [items, total] = await Promise.all([
    MedicalRecord.find(filter).sort({ createdAt: -1 }).skip(pg.skip).limit(pg.limit).populate('uploadedBy', 'name role').lean(),
    MedicalRecord.countDocuments(filter),
  ]);
  // Number of doctors with ACTIVE (granted, unexpired) access per record — shown on record cards.
  const AccessPermission = require('../models/AccessPermission');
  const active = await AccessPermission.aggregate([
    { $match: { recordId: { $in: items.map((r) => r._id) }, status: 'GRANTED', expiresAt: { $gt: new Date() } } },
    { $group: { _id: '$recordId', n: { $sum: 1 } } },
  ]);
  const counts = new Map(active.map((a) => [String(a._id), a.n]));
  const { latestIntegrityChecks } = require('../services/integrityStatus.service');
  const checks = await latestIntegrityChecks(items.map((r) => r._id));
  res.json({ success: true, data: paginated(items.map((r) => ({
    ...toRecordView(r), activeShares: counts.get(String(r._id)) || 0, lastIntegrityCheck: checks.get(String(r._id)) || null,
  })), total, pg) });
}

/** GET /api/records/:recordId — metadata: owning patient, or a doctor with a live permission. */
async function getOwn(req, res) {
  // loadReadableRecord is required lazily to avoid a circular import at module load.
  const { loadReadableRecord: load } = require('../services/recordAccess.service');
  const { record, permission } = await load(req, req.params.recordId);
  const view = toRecordView(record);
  if (permission) view.access = { permissionId: String(permission._id), expiresAt: permission.expiresAt };
  res.json({ success: true, data: { record: view } });
}

/** PATCH /api/records/:recordId — edit title / description / recordType of an own record. File fields are immutable. */
async function updateOwn(req, res) {
  const body = req.body || {};
  const locked = ['patientId', 'uploadedBy', 'fileName', 'storagePath', 'mimeType', 'fileSize', 'sha256Hash', 'blockchainTransactionHash', 'encryptionIv', 'encryptionAuthTag']
    .filter((f) => f in body);
  if (locked.length) throw ApiError.badRequest(`These fields cannot be changed: ${locked.join(', ')}`, 'FIELD_NOT_EDITABLE');

  const errors = validate(body, {
    title: { label: 'Title', rules: [rules.string, rules.minLength(2), rules.maxLength(150)] },
    recordType: { label: 'Record type', rules: [rules.string, rules.oneOf(RECORD_TYPES)] },
    description: { label: 'Description', rules: [rules.string, rules.maxLength(2000)] },
  });
  if (errors.length) throw ApiError.badRequest('Please correct the highlighted fields.', 'VALIDATION_ERROR', errors);

  const update = {};
  if (body.title !== undefined) update.title = cleanString(body.title);
  if (body.recordType !== undefined) update.recordType = body.recordType;
  if (body.description !== undefined) update.description = cleanString(body.description);
  if (!Object.keys(update).length) throw ApiError.badRequest('Nothing to update.', 'NOTHING_TO_UPDATE');

  await findOwnRecordOr404(req);
  const rec = await MedicalRecord.findOneAndUpdate(
    { _id: req.params.recordId, patientId: req.user._id }, update, { returnDocument: 'after', runValidators: true }
  ).populate('uploadedBy', 'name role').lean();
  await logAudit({ req, action: 'RECORD_UPDATED', patientId: req.user._id, recordId: rec._id, metadata: { fields: Object.keys(update) } });
  res.json({ success: true, data: { record: toRecordView(rec) } });
}

module.exports = { listOwn, getOwn, updateOwn };

/* ======================= Module 3 — secure file storage ======================= */
const path = require('path');
const mongoose = require('mongoose');
const User = require('../models/User');
const { ROLES: R } = require('../utils/constants');
const { contentMatchesType } = require('../middleware/upload');
const { sha256Hex } = require('../services/hash.service');
const { encryptBuffer, decryptBuffer } = require('../services/crypto.service');
const storage = require('../services/storage.service');
const { hasApprovedRelation } = require('../services/relation.service');
const { loadReadableRecord } = require('../services/recordAccess.service');

function safeFileName(name, mimetype) {
  const base = path.basename(String(name || '')).replace(/[\u0000-\u001f\u007f"\\/<>:|?*]/g, '_').trim().slice(0, 200);
  const ext = { 'application/pdf': '.pdf', 'image/png': '.png', 'image/jpeg': '.jpg' }[mimetype] || '';
  return base || `medical-record${ext}`;
}

/**
 * POST /api/records  (multipart/form-data: file, title, recordType, description?, patientId? )
 * - Patient uploads for themselves.
 * - Verified doctor uploads on behalf of a patient with an APPROVED relationship (patientId required).
 * Original file → SHA-256 (integrity fingerprint) → AES-256-GCM encrypt → Supabase (private bucket) → metadata in MongoDB.
 */
async function upload(req, res) {
  if (!req.file) throw ApiError.badRequest('Choose a file to upload.', 'FILE_REQUIRED');
  const body = req.body || {};
  const errors = validate(body, {
    title: { label: 'Title', rules: [rules.required, rules.string, rules.minLength(2), rules.maxLength(150)] },
    recordType: { label: 'Record type', rules: [rules.required, rules.string, rules.oneOf(RECORD_TYPES)] },
    description: { label: 'Description', rules: [rules.string, rules.maxLength(2000)] },
    patientId: { label: 'Patient', rules: [rules.string, rules.objectId] },
  });
  if (req.user.role === R.DOCTOR && !body.patientId) errors.push({ field: 'patientId', message: 'Select the patient this record belongs to' });
  if (errors.length) throw ApiError.badRequest('Please correct the highlighted fields.', 'VALIDATION_ERROR', errors);

  let patientId = req.user._id;
  if (req.user.role === R.PATIENT) {
    if (body.patientId && String(body.patientId) !== String(req.user._id)) {
      throw ApiError.forbidden('Patients can only upload their own records.', 'FORBIDDEN');
    }
  } else {
    const patient = await User.findOne({ _id: body.patientId, role: R.PATIENT }).select('_id').lean();
    if (!patient) throw ApiError.notFound('Patient not found.', 'PATIENT_NOT_FOUND');
    if (!(await hasApprovedRelation(req.user._id, patient._id))) {
      await logAudit({ req, action: 'ACCESS_DENIED', patientId: patient._id, doctorId: req.user._id, metadata: { reason: 'NO_APPROVED_RELATION', operation: 'UPLOAD_RECORD' } });
      throw ApiError.forbidden('This patient has not approved your access.', 'PERMISSION_DENIED');
    }
    patientId = patient._id;
  }

  const file = req.file;
  if (!contentMatchesType(file.buffer, file.mimetype)) {
    throw ApiError.badRequest('The file content does not match its type. Only genuine PDF, JPEG and PNG files are accepted.', 'FILE_CONTENT_MISMATCH');
  }

  const recordId = new mongoose.Types.ObjectId();
  const key = storage.objectKey(patientId, recordId);
  const sha256Hash = sha256Hex(file.buffer);            // fingerprint of the original
  const { ciphertext, iv, authTag } = encryptBuffer(file.buffer);

  await storage.upload(key, ciphertext);                  // STORAGE_ERROR (502) on failure — nothing saved
  let rec;
  try {
    rec = await MedicalRecord.create({
      _id: recordId,
      patientId,
      uploadedBy: req.user._id,
      title: cleanString(body.title),
      recordType: body.recordType,
      description: cleanString(body.description) || undefined,
      fileName: safeFileName(file.originalname, file.mimetype),
      storagePath: key,
      mimeType: file.mimetype,
      fileSize: file.size,
      sha256Hash,
      encryptionIv: iv,
      encryptionAuthTag: authTag,
    });
  } catch (err) {
    // Keep storage and database consistent: remove the orphaned encrypted object.
    await storage.remove(key).catch((e) => console.error('[storage] cleanup failed:', e.message));
    throw err;
  }

  await logAudit({
    req, action: 'RECORD_UPLOAD', patientId, recordId: rec._id, ...(req.user.role === R.DOCTOR ? { doctorId: req.user._id } : {}),
    metadata: { mimeType: file.mimetype, fileSize: file.size, uploadedByRole: req.user.role },
  });
  // Anchor the SHA-256 fingerprint on-chain. If the chain is unavailable the upload still succeeds;
  // anchoring is retried automatically before the record can be shared.
  let anchoring = 'ANCHORED';
  try {
    const { anchorRecord } = require('../services/anchor.service');
    await anchorRecord(rec, { req });
  } catch (err) {
    anchoring = 'PENDING';
    console.warn('[blockchain] record anchoring deferred:', err.code || err.message);
  }

  const populated = await MedicalRecord.findById(rec._id).populate('uploadedBy', 'name role').lean();
  res.status(201).json({ success: true, data: { record: toRecordView(populated), anchoring } });
}

/**
 * GET /api/records/:recordId/file?disposition=inline|attachment
 * Controlled retrieval: access check → download ciphertext → decrypt → SHA-256 → compare with the
 * on-chain fingerprint. Only a verified file is delivered; tampering → 409 TAMPER_DETECTED.
 * Response headers report the result (X-Integrity-Status, X-Integrity-Source, X-File-SHA256).
 */
async function downloadFile(req, res) {
  const { record: rec } = await loadReadableRecord(req, req.params.recordId);
  if (!rec.storagePath) throw ApiError.notFound('This record has no file attached.', 'FILE_NOT_FOUND');

  const { verifyRecordFile } = require('../services/integrity.service');
  const { plain, result } = await verifyRecordFile(req, rec, { purpose: 'DOWNLOAD' });
  if (!plain) {
    throw new ApiError(409, 'TAMPER DETECTED: this file failed its integrity check and was not delivered.', 'TAMPER_DETECTED', [
      { field: 'integrity', message: result.reason }, { field: 'stage', message: result.stage },
    ]);
  }

  await logAudit({
    req, action: 'RECORD_VIEW', recordId: rec._id, patientId: rec.patientId,
    ...(req.user.role === R.DOCTOR ? { doctorId: req.user._id } : {}), metadata: { type: 'FILE', integrity: result.status, trustedSource: result.trustedSource },
  });

  const disposition = req.query.disposition === 'inline' ? 'inline' : 'attachment';
  const name = rec.fileName || 'medical-record';
  res.setHeader('Content-Type', rec.mimeType || 'application/octet-stream');
  res.setHeader('Content-Length', plain.length);
  res.setHeader('Content-Disposition', `${disposition}; filename="${name.replace(/[^\x20-\x7e]/g, '_')}"; filename*=UTF-8''${encodeURIComponent(name)}`);
  res.setHeader('Cache-Control', 'no-store, private');
  res.setHeader('Content-Security-Policy', "default-src 'none'; img-src 'self' data:; style-src 'unsafe-inline'; sandbox");
  res.setHeader('X-Integrity-Status', result.status);
  res.setHeader('X-Integrity-Source', result.trustedSource);
  res.setHeader('X-File-SHA256', result.currentHash);
  res.setHeader('Access-Control-Expose-Headers', 'X-Integrity-Status, X-Integrity-Source, X-File-SHA256, Content-Disposition');
  res.end(plain);
}

/**
 * POST /api/records/:recordId/verify — run the integrity check without downloading.
 * Returns { status: INTEGRITY_VERIFIED | TAMPER_DETECTED, currentHash, storedHash, blockchainHash, trustedSource, ... }.
 */
async function verifyIntegrity(req, res) {
  const { record: rec } = await loadReadableRecord(req, req.params.recordId);
  if (!rec.storagePath) throw ApiError.notFound('This record has no file attached.', 'FILE_NOT_FOUND');
  const { verifyRecordFile } = require('../services/integrity.service');
  const { result } = await verifyRecordFile(req, rec, { purpose: 'VERIFY' });
  res.json({ success: true, data: { integrity: result } });
}

module.exports.upload = upload;
module.exports.downloadFile = downloadFile;
module.exports.verifyIntegrity = verifyIntegrity;

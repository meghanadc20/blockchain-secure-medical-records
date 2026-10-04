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
  res.json({ success: true, data: paginated(items.map((r) => toRecordView(r)), total, pg) });
}

/** GET /api/records/:recordId — metadata of an own record. */
async function getOwn(req, res) {
  const rec = await findOwnRecordOr404(req);
  res.json({ success: true, data: { record: toRecordView(rec) } });
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

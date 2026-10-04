'use strict';
const MedicalRecord = require('../models/MedicalRecord');
const Consultation = require('../models/Consultation');
const DoctorProfile = require('../models/DoctorProfile');
const ApiError = require('../utils/ApiError');
const { toRecordView } = require('../services/record.service');

const MAX_ITEMS = 500;

function parseDate(v, label) {
  if (v === undefined || v === '') return undefined;
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) throw ApiError.badRequest(`${label} is not a valid date`, 'VALIDATION_ERROR');
  return d;
}

/**
 * GET /api/history?type=ALL|RECORD|CONSULTATION&from=YYYY-MM-DD&to=YYYY-MM-DD
 * The signed-in patient's complete medical-history timeline (records + consultations), newest first.
 * Each item: { kind: 'RECORD'|'CONSULTATION', date, ...details }.
 */
async function patientTimeline(req, res) {
  const type = String(req.query.type || 'ALL').toUpperCase();
  if (!['ALL', 'RECORD', 'CONSULTATION'].includes(type)) throw ApiError.badRequest('type must be ALL, RECORD or CONSULTATION', 'VALIDATION_ERROR');
  const from = parseDate(req.query.from, 'from');
  const toRaw = parseDate(req.query.to, 'to');
  const to = toRaw ? new Date(toRaw.getTime() + 24 * 60 * 60 * 1000 - 1) : undefined; // inclusive end of day
  if (from && to && from > to) throw ApiError.badRequest('from must be before to', 'VALIDATION_ERROR');

  const range = (field) => (from || to ? { [field]: { ...(from ? { $gte: from } : {}), ...(to ? { $lte: to } : {}) } } : {});
  const patientId = req.user._id;

  const [records, consultations] = await Promise.all([
    type === 'CONSULTATION' ? [] : MedicalRecord.find({ patientId, ...range('createdAt') }).sort({ createdAt: -1 }).limit(MAX_ITEMS).populate('uploadedBy', 'name role').lean(),
    type === 'RECORD' ? [] : Consultation.find({ patientId, ...range('consultationDate') }).sort({ consultationDate: -1 }).limit(MAX_ITEMS).populate('doctorId', 'name').lean(),
  ]);

  const profiles = new Map((await DoctorProfile.find({ userId: { $in: consultations.map((c) => c.doctorId._id) } }).lean())
    .map((p) => [String(p.userId), p]));

  const items = [
    ...records.map((r) => ({ kind: 'RECORD', date: r.createdAt, record: toRecordView(r) })),
    ...consultations.map((c) => {
      const p = profiles.get(String(c.doctorId._id));
      return {
        kind: 'CONSULTATION',
        date: c.consultationDate,
        consultation: {
          id: String(c._id),
          doctor: { id: String(c.doctorId._id), name: c.doctorId.name, specialization: p ? p.specialization : null, hospital: p ? p.hospital : null },
          recordId: c.recordId ? String(c.recordId) : null,
          consultationDate: c.consultationDate,
          diagnosis: c.diagnosis || '',
          prescription: c.prescription || '',
          treatmentNotes: c.treatmentNotes || '',
        },
      };
    }),
  ].sort((a, b) => new Date(b.date) - new Date(a.date)).slice(0, MAX_ITEMS);

  res.json({ success: true, data: { items, counts: { records: records.length, consultations: consultations.length }, truncated: records.length === MAX_ITEMS || consultations.length === MAX_ITEMS } });
}

module.exports = { patientTimeline };

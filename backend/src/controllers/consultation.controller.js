'use strict';
const mongoose = require('mongoose');
const Consultation = require('../models/Consultation');
const MedicalRecord = require('../models/MedicalRecord');
const User = require('../models/User');
const DoctorProfile = require('../models/DoctorProfile');
const ApiError = require('../utils/ApiError');
const { ROLES } = require('../utils/constants');
const { rules, validate, cleanString } = require('../utils/validators');
const { parsePagination, paginated } = require('../utils/pagination');
const { logAudit } = require('../services/audit.service');
const { hasApprovedRelation } = require('../services/relation.service');

/**
 * Consultations (diagnosis, prescription, treatment notes).
 *  - Create: verified doctor with an APPROVED relationship to the patient.
 *  - Read: the patient (all of their own); the authoring doctor only while the relationship is APPROVED.
 *  - Consultations are not editable or deletable — corrections are added as a new consultation,
 *    so the medical history cannot be silently rewritten.
 *  - Admins have no access.
 */

const MAX_FUTURE_MS = 24 * 60 * 60 * 1000; // allow clock/time-zone skew

async function toView(c, { doctorProfiles } = {}) {
  const doctor = c.doctorId && c.doctorId.name ? c.doctorId : null;
  const prof = doctorProfiles ? doctorProfiles.get(String(doctor ? doctor._id : c.doctorId)) : null;
  return {
    id: String(c._id),
    patient: c.patientId && c.patientId.name ? { id: String(c.patientId._id), name: c.patientId.name, email: c.patientId.email } : { id: String(c.patientId) },
    doctor: doctor ? { id: String(doctor._id), name: doctor.name, ...(prof ? { specialization: prof.specialization, hospital: prof.hospital } : {}) } : { id: String(c.doctorId) },
    recordId: c.recordId ? String(c.recordId) : null,
    consultationDate: c.consultationDate,
    diagnosis: c.diagnosis || '',
    prescription: c.prescription || '',
    treatmentNotes: c.treatmentNotes || '',
    createdAt: c.createdAt,
  };
}

async function profilesFor(list) {
  const ids = [...new Set(list.map((c) => String(c.doctorId && c.doctorId._id ? c.doctorId._id : c.doctorId)))];
  const profs = await DoctorProfile.find({ userId: { $in: ids } }).lean();
  return new Map(profs.map((p) => [String(p.userId), p]));
}

/** POST /api/consultations */
async function create(req, res) {
  const body = req.body || {};
  const errors = validate(body, {
    patientId: { label: 'Patient', rules: [rules.required, rules.string, rules.objectId] },
    consultationDate: { label: 'Consultation date', rules: [rules.required, rules.date] },
    diagnosis: { label: 'Diagnosis', rules: [rules.string, rules.maxLength(5000)] },
    prescription: { label: 'Prescription', rules: [rules.string, rules.maxLength(5000)] },
    treatmentNotes: { label: 'Treatment notes', rules: [rules.string, rules.maxLength(10000)] },
    recordId: { label: 'Record', rules: [rules.string, rules.objectId] },
  });
  const date = new Date(body.consultationDate);
  if (!errors.some((e) => e.field === 'consultationDate')) {
    if (date.getTime() > Date.now() + MAX_FUTURE_MS) errors.push({ field: 'consultationDate', message: 'Consultation date cannot be in the future' });
    if (date.getFullYear() < 1900) errors.push({ field: 'consultationDate', message: 'Consultation date is not valid' });
  }
  const diagnosis = cleanString(body.diagnosis) || '';
  const prescription = cleanString(body.prescription) || '';
  const treatmentNotes = cleanString(body.treatmentNotes) || '';
  if (!errors.length && !diagnosis && !prescription && !treatmentNotes) {
    errors.push({ field: 'diagnosis', message: 'Enter a diagnosis, prescription or treatment notes' });
  }
  if (errors.length) throw ApiError.badRequest('Please correct the highlighted fields.', 'VALIDATION_ERROR', errors);

  const patient = await User.findOne({ _id: body.patientId, role: ROLES.PATIENT }).lean();
  if (!patient) throw ApiError.notFound('Patient not found.', 'PATIENT_NOT_FOUND');

  if (!(await hasApprovedRelation(req.user._id, patient._id))) {
    await logAudit({ req, action: 'ACCESS_DENIED', patientId: patient._id, doctorId: req.user._id, metadata: { reason: 'NO_APPROVED_RELATION', operation: 'CREATE_CONSULTATION' } });
    throw ApiError.forbidden('This patient has not approved your access.', 'PERMISSION_DENIED');
  }

  let recordId;
  if (body.recordId) {
    const rec = await MedicalRecord.findById(body.recordId).select('patientId').lean();
    if (!rec || String(rec.patientId) !== String(patient._id)) {
      throw ApiError.badRequest('The linked record does not belong to this patient.', 'VALIDATION_ERROR', [{ field: 'recordId', message: 'Record not found for this patient' }]);
    }
    recordId = rec._id;
  }

  const c = await Consultation.create({
    patientId: patient._id, doctorId: req.user._id, recordId, consultationDate: date, diagnosis, prescription, treatmentNotes,
  });
  // Audit metadata never contains the medical text itself.
  await logAudit({ req, action: 'CONSULTATION_ADDED', patientId: patient._id, doctorId: req.user._id, recordId, metadata: { consultationId: String(c._id) } });

  const populated = await Consultation.findById(c._id).populate('doctorId', 'name').populate('patientId', 'name email').lean();
  res.status(201).json({ success: true, data: { consultation: await toView(populated, { doctorProfiles: await profilesFor([populated]) }) } });
}

/**
 * GET /api/consultations
 *  - patient: own consultations (optional ?doctorId=)
 *  - doctor: consultations they authored, only for patients whose relationship is currently APPROVED (optional ?patientId=)
 */
async function list(req, res) {
  const pg = parsePagination(req.query);
  const filter = {};
  if (req.user.role === ROLES.PATIENT) {
    filter.patientId = req.user._id;
    if (req.query.doctorId) {
      if (!mongoose.isValidObjectId(req.query.doctorId)) throw ApiError.badRequest('Invalid doctorId', 'INVALID_ID');
      filter.doctorId = req.query.doctorId;
    }
  } else {
    filter.doctorId = req.user._id;
    const DoctorPatientRelation = require('../models/DoctorPatientRelation');
    const approvedPatientIds = await DoctorPatientRelation.find({ doctorId: req.user._id, status: 'APPROVED' }).distinct('patientId');
    if (req.query.patientId) {
      if (!mongoose.isValidObjectId(req.query.patientId)) throw ApiError.badRequest('Invalid patientId', 'INVALID_ID');
      if (!approvedPatientIds.some((id) => String(id) === String(req.query.patientId))) {
        await logAudit({ req, action: 'ACCESS_DENIED', patientId: req.query.patientId, doctorId: req.user._id, metadata: { reason: 'NO_APPROVED_RELATION', operation: 'LIST_CONSULTATIONS' } });
        throw ApiError.forbidden('This patient has not approved your access.', 'PERMISSION_DENIED');
      }
      filter.patientId = req.query.patientId;
    } else {
      filter.patientId = { $in: approvedPatientIds };
    }
  }

  const [items, total] = await Promise.all([
    Consultation.find(filter).sort({ consultationDate: -1, createdAt: -1 }).skip(pg.skip).limit(pg.limit)
      .populate('doctorId', 'name').populate('patientId', 'name email').lean(),
    Consultation.countDocuments(filter),
  ]);
  if (req.user.role === ROLES.DOCTOR && items.length) {
    await logAudit({ req, action: 'RECORD_VIEW', doctorId: req.user._id, ...(req.query.patientId ? { patientId: req.query.patientId } : {}), metadata: { type: 'CONSULTATION_LIST', count: items.length } });
  }
  const profs = await profilesFor(items);
  res.json({ success: true, data: paginated(await Promise.all(items.map((c) => toView(c, { doctorProfiles: profs }))), total, pg) });
}

/** GET /api/consultations/:consultationId */
async function getOne(req, res) {
  const c = await Consultation.findById(req.params.consultationId).populate('doctorId', 'name').populate('patientId', 'name email').lean();
  const notFound = () => ApiError.notFound('Consultation not found.', 'CONSULTATION_NOT_FOUND');
  if (!c) throw notFound();

  if (req.user.role === ROLES.PATIENT) {
    if (String(c.patientId._id) !== String(req.user._id)) {
      await logAudit({ req, action: 'ACCESS_DENIED', metadata: { reason: 'NOT_OWNER', consultationId: String(c._id) } });
      throw notFound();
    }
  } else {
    const isAuthor = String(c.doctorId._id) === String(req.user._id);
    if (!isAuthor || !(await hasApprovedRelation(req.user._id, c.patientId._id))) {
      await logAudit({ req, action: 'ACCESS_DENIED', patientId: c.patientId._id, doctorId: req.user._id, metadata: { reason: isAuthor ? 'NO_APPROVED_RELATION' : 'NOT_AUTHOR', consultationId: String(c._id) } });
      throw isAuthor ? ApiError.forbidden('This patient no longer authorises your access.', 'PERMISSION_REVOKED') : notFound();
    }
    await logAudit({ req, action: 'RECORD_VIEW', patientId: c.patientId._id, doctorId: req.user._id, metadata: { type: 'CONSULTATION', consultationId: String(c._id) } });
  }
  res.json({ success: true, data: { consultation: await toView(c, { doctorProfiles: await profilesFor([c]) }) } });
}

module.exports = { create, list, getOne };

'use strict';
const User = require('../models/User');
const DoctorProfile = require('../models/DoctorProfile');
const DoctorPatientRelation = require('../models/DoctorPatientRelation');
const ApiError = require('../utils/ApiError');
const { ROLES, RELATION_STATUS, VERIFICATION_STATUS } = require('../utils/constants');
const { rules, validate, cleanString } = require('../utils/validators');
const { parsePagination, paginated } = require('../utils/pagination');
const { logAudit } = require('../services/audit.service');
const { TRANSITIONS, revokeAllPermissionsForPair, toRelationView } = require('../services/relation.service');

function parseStatusFilter(raw) {
  if (!raw) return undefined;
  const list = String(raw).toUpperCase().split(',').map((s) => s.trim()).filter(Boolean);
  const bad = list.filter((s) => !Object.values(RELATION_STATUS).includes(s));
  if (bad.length) throw ApiError.badRequest(`Unknown status: ${bad.join(', ')}`, 'VALIDATION_ERROR');
  return { $in: list };
}

async function attachDoctorProfiles(relations) {
  const ids = relations.map((r) => r.doctorId && r.doctorId._id).filter(Boolean);
  const profiles = await DoctorProfile.find({ userId: { $in: ids } }).lean();
  const byUser = new Map(profiles.map((p) => [String(p.userId), p]));
  return relations.map((r) => ({ ...r, doctorProfile: byUser.get(String(r.doctorId._id)) }));
}

/* ------------------------------ Doctor ------------------------------ */

/**
 * POST /api/relations/requests  { patientEmail }
 * Verified doctors only. Re-requesting after REJECTED/REVOKED re-opens the same relation as PENDING.
 */
async function requestAccess(req, res) {
  const errors = validate(req.body, { patientEmail: { label: 'Patient email', rules: [rules.required, rules.string, rules.email] } });
  if (errors.length) throw ApiError.badRequest('Please enter a valid patient email.', 'VALIDATION_ERROR', errors);

  const email = cleanString(req.body.patientEmail).toLowerCase();
  const patient = await User.findOne({ email, role: ROLES.PATIENT }).lean();
  if (!patient) throw ApiError.notFound('No patient account was found with that email.', 'PATIENT_NOT_FOUND');

  const doctorId = req.user._id;
  const existing = await DoctorPatientRelation.findOne({ doctorId, patientId: patient._id });
  if (existing && existing.status === RELATION_STATUS.PENDING) {
    throw ApiError.conflict('You already have a pending request with this patient.', 'REQUEST_ALREADY_PENDING');
  }
  if (existing && existing.status === RELATION_STATUS.APPROVED) {
    throw ApiError.conflict('This patient has already approved your access.', 'ALREADY_APPROVED');
  }

  let relation;
  if (existing) {
    relation = await DoctorPatientRelation.findOneAndUpdate(
      { _id: existing._id, status: existing.status },
      { status: RELATION_STATUS.PENDING, requestedAt: new Date(), $unset: { approvedAt: 1, revokedAt: 1 } },
      { returnDocument: 'after' }
    );
    if (!relation) throw ApiError.conflict('Request changed concurrently. Refresh and try again.', 'CONCURRENT_UPDATE');
  } else {
    try {
      relation = await DoctorPatientRelation.create({ doctorId, patientId: patient._id });
    } catch (err) {
      if (err.code === 11000) throw ApiError.conflict('You already have a request with this patient.', 'REQUEST_ALREADY_PENDING');
      throw err;
    }
  }

  await logAudit({ req, action: 'ACCESS_REQUEST', doctorId, patientId: patient._id, metadata: { scope: 'RELATION', relationId: String(relation._id), reopened: Boolean(existing) } });
  const populated = await DoctorPatientRelation.findById(relation._id).populate('patientId', 'name email').lean();
  res.status(existing ? 200 : 201).json({ success: true, data: { relation: toRelationView(populated) } });
}

/** GET /api/relations/doctor?status=PENDING,APPROVED — the doctor's own requests/patients. */
async function listForDoctor(req, res) {
  const pg = parsePagination(req.query);
  const filter = { doctorId: req.user._id };
  const status = parseStatusFilter(req.query.status);
  if (status) filter.status = status;
  const [items, total] = await Promise.all([
    DoctorPatientRelation.find(filter).sort({ updatedAt: -1 }).skip(pg.skip).limit(pg.limit).populate('patientId', 'name email').lean(),
    DoctorPatientRelation.countDocuments(filter),
  ]);
  res.json({ success: true, data: paginated(items.map(toRelationView), total, pg) });
}

/* ------------------------------ Patient ------------------------------ */

/** GET /api/relations/patient?status=… — requests and authorised doctors for the signed-in patient. */
async function listForPatient(req, res) {
  const pg = parsePagination(req.query);
  const filter = { patientId: req.user._id };
  const status = parseStatusFilter(req.query.status);
  if (status) filter.status = status;
  const [items, total] = await Promise.all([
    DoctorPatientRelation.find(filter).sort({ updatedAt: -1 }).skip(pg.skip).limit(pg.limit).populate('doctorId', 'name email').lean(),
    DoctorPatientRelation.countDocuments(filter),
  ]);
  const withProfiles = await attachDoctorProfiles(items);
  res.json({ success: true, data: paginated(withProfiles.map(toRelationView), total, pg) });
}

/** PATCH /api/relations/:relationId/(approve|reject|revoke) — patient decides on their own relation only. */
function transition(kind) {
  const { from, to, audit } = TRANSITIONS[kind];
  return async function patientDecision(req, res) {
    const relation = await DoctorPatientRelation.findById(req.params.relationId).lean();
    // Not found and "not yours" look the same, so ids of other patients' relations are not revealed.
    if (!relation || String(relation.patientId) !== String(req.user._id)) {
      if (relation) {
        await logAudit({ req, action: 'ACCESS_DENIED', metadata: { reason: 'NOT_RELATION_OWNER', relationId: String(relation._id) } });
      }
      throw ApiError.notFound('Access request not found.', 'RELATION_NOT_FOUND');
    }
    if (relation.status !== from) {
      throw ApiError.conflict(`Only ${from} requests can be ${kind === 'revoke' ? 'revoked' : `${kind}d`} (current status: ${relation.status}).`, 'INVALID_STATUS_TRANSITION');
    }

    if (kind === 'approve') {
      const profile = await DoctorProfile.findOne({ userId: relation.doctorId }).lean();
      if (!profile || profile.verificationStatus !== VERIFICATION_STATUS.APPROVED) {
        throw ApiError.conflict('This doctor is no longer verified, so access cannot be approved.', 'DOCTOR_NOT_VERIFIED');
      }
    }

    const now = new Date();
    const update = { status: to };
    if (kind === 'approve') { update.approvedAt = now; update.$unset = { revokedAt: 1 }; }
    if (kind === 'revoke') update.revokedAt = now;

    // Atomic: only applies if the status is still what we checked.
    const updated = await DoctorPatientRelation.findOneAndUpdate(
      { _id: relation._id, patientId: req.user._id, status: from },
      update,
      { returnDocument: 'after' }
    ).populate('doctorId', 'name email').lean();
    if (!updated) throw ApiError.conflict('Request changed concurrently. Refresh and try again.', 'CONCURRENT_UPDATE');

    let permissionsRevoked = 0;
    if (kind === 'revoke') permissionsRevoked = await revokeAllPermissionsForPair(relation.doctorId, req.user._id, now);

    await logAudit({
      req, action: audit, patientId: req.user._id, doctorId: relation.doctorId,
      metadata: { scope: 'RELATION', relationId: String(relation._id), ...(kind === 'revoke' ? { permissionsRevoked } : {}) },
    });
    const [view] = await attachDoctorProfiles([updated]);
    res.json({ success: true, data: { relation: toRelationView(view), ...(kind === 'revoke' ? { permissionsRevoked } : {}) } });
  };
}

module.exports = {
  requestAccess,
  listForDoctor,
  listForPatient,
  approve: transition('approve'),
  reject: transition('reject'),
  revoke: transition('revoke'),
};

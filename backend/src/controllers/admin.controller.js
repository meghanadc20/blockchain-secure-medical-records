'use strict';
const User = require('../models/User');
const DoctorProfile = require('../models/DoctorProfile');
const ApiError = require('../utils/ApiError');
const { ROLES, VERIFICATION_STATUS } = require('../utils/constants');
const { cleanString } = require('../utils/validators');
const { parsePagination, paginated } = require('../utils/pagination');
const { logAudit } = require('../services/audit.service');

/**
 * Admin endpoints are limited to doctor verification and platform counts.
 * There are deliberately NO admin endpoints for medical records, consultations or permissions.
 */

function toAdminDoctorView(profile) {
  const u = profile.userId || {};
  return {
    doctorId: String(u._id),
    name: u.name,
    email: u.email,
    phone: u.phone || null,
    specialization: profile.specialization,
    licenseNumber: profile.licenseNumber,
    hospital: profile.hospital,
    verificationStatus: profile.verificationStatus,
    verifiedAt: profile.verifiedAt || null,
    registeredAt: profile.createdAt,
    updatedAt: profile.updatedAt,
  };
}

/** GET /api/admin/stats */
async function stats(req, res) {
  const [pending, approved, rejected, patients] = await Promise.all([
    DoctorProfile.countDocuments({ verificationStatus: VERIFICATION_STATUS.PENDING }),
    DoctorProfile.countDocuments({ verificationStatus: VERIFICATION_STATUS.APPROVED }),
    DoctorProfile.countDocuments({ verificationStatus: VERIFICATION_STATUS.REJECTED }),
    User.countDocuments({ role: ROLES.PATIENT }),
  ]);
  res.json({ success: true, data: { doctors: { pending, approved, rejected, total: pending + approved + rejected }, patients } });
}

/** GET /api/admin/doctors?status=PENDING|APPROVED|REJECTED&q=&page=&limit= */
async function listDoctors(req, res) {
  const status = String(req.query.status || VERIFICATION_STATUS.PENDING).toUpperCase();
  if (!Object.values(VERIFICATION_STATUS).includes(status)) {
    throw ApiError.badRequest('status must be PENDING, APPROVED or REJECTED', 'VALIDATION_ERROR');
  }
  const pg = parsePagination(req.query);
  const filter = { verificationStatus: status };

  const q = cleanString(req.query.q);
  if (q) {
    const rx = new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').slice(0, 100), 'i');
    const userIds = await User.find({ role: ROLES.DOCTOR, $or: [{ name: rx }, { email: rx }] }).distinct('_id');
    filter.$or = [{ userId: { $in: userIds } }, { licenseNumber: rx }, { hospital: rx }, { specialization: rx }];
  }

  // Oldest pending first (review queue); newest first for decided lists.
  const sort = status === VERIFICATION_STATUS.PENDING ? { createdAt: 1 } : { updatedAt: -1 };
  const [profiles, total] = await Promise.all([
    DoctorProfile.find(filter).sort(sort).skip(pg.skip).limit(pg.limit).populate('userId', 'name email phone').lean(),
    DoctorProfile.countDocuments(filter),
  ]);
  res.json({ success: true, data: paginated(profiles.map(toAdminDoctorView), total, pg) });
}

async function findProfileOr404(doctorId) {
  const profile = await DoctorProfile.findOne({ userId: doctorId }).populate('userId', 'name email phone role').lean();
  if (!profile || !profile.userId || profile.userId.role !== ROLES.DOCTOR) {
    throw ApiError.notFound('Doctor not found.', 'DOCTOR_NOT_FOUND');
  }
  return profile;
}

/** GET /api/admin/doctors/:doctorId */
async function getDoctor(req, res) {
  const profile = await findProfileOr404(req.params.doctorId);
  res.json({ success: true, data: { doctor: toAdminDoctorView(profile) } });
}

function decide(newStatus) {
  const action = newStatus === VERIFICATION_STATUS.APPROVED ? 'DOCTOR_APPROVED' : 'DOCTOR_REJECTED';
  return async function decideVerification(req, res) {
    const reason = cleanString((req.body || {}).reason);
    if (reason && reason.length > 500) throw ApiError.badRequest('Reason must be at most 500 characters', 'VALIDATION_ERROR');

    const before = await findProfileOr404(req.params.doctorId);
    if (before.verificationStatus === newStatus) {
      throw ApiError.conflict(`Doctor is already ${newStatus}.`, 'ALREADY_IN_STATUS');
    }

    const update = newStatus === VERIFICATION_STATUS.APPROVED
      ? { verificationStatus: newStatus, verifiedAt: new Date() }
      : { verificationStatus: newStatus, $unset: { verifiedAt: 1 } };
    // Conditional update: only applies if nobody changed the status in the meantime.
    const updated = await DoctorProfile.findOneAndUpdate(
      { _id: before._id, verificationStatus: before.verificationStatus },
      update,
      { returnDocument: 'after' }
    ).populate('userId', 'name email phone').lean();
    if (!updated) throw ApiError.conflict('Verification status changed concurrently. Refresh and try again.', 'CONCURRENT_UPDATE');

    await logAudit({
      req, action, doctorId: updated.userId._id,
      metadata: { from: before.verificationStatus, to: newStatus, ...(reason ? { reason } : {}) },
    });
    res.json({ success: true, data: { doctor: toAdminDoctorView(updated) } });
  };
}

module.exports = {
  stats,
  listDoctors,
  getDoctor,
  approveDoctor: decide(VERIFICATION_STATUS.APPROVED),
  rejectDoctor: decide(VERIFICATION_STATUS.REJECTED),
};

'use strict';
const DoctorPatientRelation = require('../models/DoctorPatientRelation');
const AccessPermission = require('../models/AccessPermission');
const { PERMISSION_STATUS } = require('../utils/constants');

/**
 * Patient-level relationship (Module 1). Record-level, time-limited permissions (Module 4)
 * are only possible while the relationship is APPROVED.
 */

/** Allowed transitions: from → to. */
const TRANSITIONS = {
  approve: { from: 'PENDING', to: 'APPROVED', audit: 'ACCESS_GRANTED' },
  reject: { from: 'PENDING', to: 'REJECTED', audit: 'ACCESS_REJECTED' },
  revoke: { from: 'APPROVED', to: 'REVOKED', audit: 'ACCESS_REVOKED' },
};

/** True when the doctor currently has an APPROVED relationship with the patient. */
async function hasApprovedRelation(doctorId, patientId) {
  return Boolean(await DoctorPatientRelation.exists({ doctorId, patientId, status: 'APPROVED' }));
}

/**
 * When a relationship is revoked, every live record permission for that pair is revoked too,
 * so access stops immediately. (On-chain revocation is added with the blockchain layer.)
 * Returns the number of permissions revoked.
 */
async function revokeAllPermissionsForPair(doctorId, patientId, now = new Date()) {
  const res = await AccessPermission.updateMany(
    { doctorId, patientId, status: PERMISSION_STATUS.GRANTED },
    { status: PERMISSION_STATUS.REVOKED, revokedAt: now }
  );
  return res.modifiedCount || 0;
}

function toRelationView(rel) {
  const view = {
    id: String(rel._id),
    status: rel.status,
    requestedAt: rel.requestedAt,
    approvedAt: rel.approvedAt || null,
    revokedAt: rel.revokedAt || null,
    updatedAt: rel.updatedAt,
  };
  if (rel.doctorId && rel.doctorId.name) {
    view.doctor = {
      id: String(rel.doctorId._id),
      name: rel.doctorId.name,
      email: rel.doctorId.email,
      ...(rel.doctorProfile ? {
        specialization: rel.doctorProfile.specialization,
        hospital: rel.doctorProfile.hospital,
        licenseNumber: rel.doctorProfile.licenseNumber,
        verificationStatus: rel.doctorProfile.verificationStatus,
      } : {}),
    };
  }
  if (rel.patientId && rel.patientId.name) {
    view.patient = { id: String(rel.patientId._id), name: rel.patientId.name, email: rel.patientId.email };
  }
  return view;
}

module.exports = { TRANSITIONS, hasApprovedRelation, revokeAllPermissionsForPair, toRelationView };

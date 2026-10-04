'use strict';
const DoctorProfile = require('../models/DoctorProfile');
const { ROLES } = require('../utils/constants');

/** Where each role lands after login. Admin path is returned only to admins — it is never linked publicly. */
const DASHBOARD = {
  [ROLES.PATIENT]: '/patient/dashboard',
  [ROLES.DOCTOR]: '/doctor/dashboard',
  [ROLES.ADMIN]: '/admin/dashboard',
};

/** Safe public shape of a user (never includes passwordHash). */
async function toPublicUser(user) {
  const base = {
    id: String(user._id),
    name: user.name,
    email: user.email,
    role: user.role,
    phone: user.phone || null,
    walletAddress: user.walletAddress || null,
    createdAt: user.createdAt,
  };
  if (user.role === ROLES.DOCTOR) {
    const profile = await DoctorProfile.findOne({ userId: user._id }).lean();
    base.doctorProfile = profile
      ? {
        specialization: profile.specialization,
        licenseNumber: profile.licenseNumber,
        hospital: profile.hospital,
        verificationStatus: profile.verificationStatus,
        verifiedAt: profile.verifiedAt || null,
      }
      : null;
  }
  return base;
}

module.exports = { DASHBOARD, toPublicUser };

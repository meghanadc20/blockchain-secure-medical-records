'use strict';
const User = require('../models/User');
const DoctorProfile = require('../models/DoctorProfile');
const ApiError = require('../utils/ApiError');
const { ROLES } = require('../utils/constants');
const { rules, validate, cleanString } = require('../utils/validators');
const { logAudit } = require('../services/audit.service');
const { toPublicUser } = require('../services/user.service');

/** GET /api/profile — the signed-in user's own profile (any role). */
async function getProfile(req, res) {
  res.json({ success: true, data: { user: await toPublicUser(req.user) } });
}

/**
 * PATCH /api/profile — update own profile.
 * All roles: name, phone. Doctors also: specialization, hospital.
 * Email, role, licence number and verification status cannot be changed here.
 */
async function updateProfile(req, res) {
  const body = req.body || {};
  const isDoctor = req.user.role === ROLES.DOCTOR;

  const forbidden = ['email', 'role', 'password', 'passwordHash', 'licenseNumber', 'verificationStatus', 'verifiedAt', 'walletAddress']
    .filter((f) => f in body);
  if (forbidden.length) {
    throw ApiError.badRequest(`These fields cannot be changed here: ${forbidden.join(', ')}`, 'FIELD_NOT_EDITABLE');
  }

  const schema = {
    name: { label: 'Name', rules: [rules.string, rules.minLength(2), rules.maxLength(100)] },
    phone: { label: 'Phone', rules: [rules.string, rules.phone] },
  };
  if (isDoctor) {
    schema.specialization = { label: 'Specialization', rules: [rules.string, rules.minLength(2), rules.maxLength(100)] };
    schema.hospital = { label: 'Hospital', rules: [rules.string, rules.minLength(2), rules.maxLength(150)] };
  } else if ('specialization' in body || 'hospital' in body) {
    throw ApiError.badRequest('Only doctors have professional details.', 'FIELD_NOT_EDITABLE');
  }
  const errors = validate(body, schema);
  if (errors.length) throw ApiError.badRequest('Please correct the highlighted fields.', 'VALIDATION_ERROR', errors);

  const userUpdate = {};
  if (body.name !== undefined) userUpdate.name = cleanString(body.name);
  if (body.phone !== undefined) userUpdate.phone = cleanString(body.phone);
  const profileUpdate = {};
  if (isDoctor && body.specialization !== undefined) profileUpdate.specialization = cleanString(body.specialization);
  if (isDoctor && body.hospital !== undefined) profileUpdate.hospital = cleanString(body.hospital);

  if (!Object.keys(userUpdate).length && !Object.keys(profileUpdate).length) {
    throw ApiError.badRequest('Nothing to update.', 'NOTHING_TO_UPDATE');
  }

  const user = Object.keys(userUpdate).length
    ? await User.findByIdAndUpdate(req.user._id, userUpdate, { returnDocument: 'after', runValidators: true }).lean()
    : req.user;
  if (Object.keys(profileUpdate).length) {
    await DoctorProfile.updateOne({ userId: req.user._id }, profileUpdate, { runValidators: true });
  }

  await logAudit({ req, action: 'PROFILE_UPDATED', metadata: { fields: [...Object.keys(userUpdate), ...Object.keys(profileUpdate)] } });
  res.json({ success: true, data: { user: await toPublicUser(user) } });
}

module.exports = { getProfile, updateProfile };

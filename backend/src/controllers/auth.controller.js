'use strict';
const bcrypt = require('bcryptjs');
const mongoose = require('mongoose');
const User = require('../models/User');
const DoctorProfile = require('../models/DoctorProfile');
const ApiError = require('../utils/ApiError');
const { env } = require('../config/env');
const { ROLES } = require('../utils/constants');
const { rules, validate, cleanString } = require('../utils/validators');
const { signToken } = require('../services/token.service');
const { logAudit } = require('../services/audit.service');
const { DASHBOARD, toPublicUser } = require('../services/user.service');

// Used when the email does not exist, so login takes similar time either way (prevents user enumeration by timing).
const DUMMY_HASH = bcrypt.hashSync('timing-equaliser-not-a-real-password', 10);

const baseSchema = {
  name: { label: 'Name', rules: [rules.required, rules.string, rules.minLength(2), rules.maxLength(100)] },
  email: { label: 'Email', rules: [rules.required, rules.string, rules.email, rules.maxLength(254)] },
  password: { label: 'Password', rules: [rules.required, rules.string, rules.password] },
  phone: { label: 'Phone', rules: [rules.required, rules.string, rules.phone] },
};

const doctorSchema = {
  ...baseSchema,
  specialization: { label: 'Specialization', rules: [rules.required, rules.string, rules.maxLength(100)] },
  licenseNumber: { label: 'License number', rules: [rules.required, rules.string, rules.maxLength(50)] },
  hospital: { label: 'Hospital', rules: [rules.required, rules.string, rules.maxLength(150)] },
};

function assertValid(body, schema) {
  const errors = validate(body, schema);
  if (errors.length) throw ApiError.badRequest('Please correct the highlighted fields.', 'VALIDATION_ERROR', errors);
}

async function assertEmailFree(email) {
  if (await User.exists({ email })) {
    throw ApiError.conflict('An account with this email already exists.', 'DUPLICATE_EMAIL');
  }
}

function duplicateKeyToApiError(err) {
  if (err && err.code === 11000) {
    if (err.keyPattern && err.keyPattern.licenseNumber) {
      return ApiError.conflict('This license number is already registered.', 'DUPLICATE_LICENSE');
    }
    return ApiError.conflict('An account with this email already exists.', 'DUPLICATE_EMAIL');
  }
  return err;
}

async function issueSession(req, res, user, status = 200) {
  const token = signToken(user);
  res.status(status).json({
    success: true,
    data: { token, expiresIn: env.jwtExpiresIn, user: await toPublicUser(user), redirectTo: DASHBOARD[user.role] },
  });
}

/** POST /api/auth/register/patient — role is ALWAYS PATIENT (any `role` in the body is ignored). */
async function registerPatient(req, res) {
  assertValid(req.body, baseSchema);
  const email = cleanString(req.body.email).toLowerCase();
  await assertEmailFree(email);

  let user;
  try {
    user = await User.create({
      name: cleanString(req.body.name),
      email,
      phone: cleanString(req.body.phone),
      passwordHash: await bcrypt.hash(req.body.password, env.bcryptRounds),
      role: ROLES.PATIENT,
    });
  } catch (err) {
    throw duplicateKeyToApiError(err);
  }

  await logAudit({ req, actor: user, action: 'REGISTER', patientId: user._id, metadata: { role: ROLES.PATIENT } });
  await issueSession(req, res, user, 201);
}

/** POST /api/auth/register/doctor — creates user (DOCTOR) + doctorProfile (PENDING) atomically. */
async function registerDoctor(req, res) {
  assertValid(req.body, doctorSchema);
  const email = cleanString(req.body.email).toLowerCase();
  const licenseNumber = cleanString(req.body.licenseNumber).toUpperCase();
  await assertEmailFree(email);
  if (await DoctorProfile.exists({ licenseNumber })) {
    throw ApiError.conflict('This license number is already registered.', 'DUPLICATE_LICENSE');
  }

  const passwordHash = await bcrypt.hash(req.body.password, env.bcryptRounds);
  const session = await mongoose.startSession();
  let user;
  try {
    await session.withTransaction(async () => {
      [user] = await User.create([{
        name: cleanString(req.body.name), email, phone: cleanString(req.body.phone), passwordHash, role: ROLES.DOCTOR,
      }], { session });
      await DoctorProfile.create([{
        userId: user._id,
        specialization: cleanString(req.body.specialization),
        licenseNumber,
        hospital: cleanString(req.body.hospital),
      }], { session });
    });
  } catch (err) {
    throw duplicateKeyToApiError(err);
  } finally {
    await session.endSession();
  }

  await logAudit({ req, actor: user, action: 'REGISTER', doctorId: user._id, metadata: { role: ROLES.DOCTOR } });
  await issueSession(req, res, user, 201);
}

/** POST /api/auth/login — one endpoint for all roles; the response tells the client where to go. */
async function login(req, res) {
  assertValid(req.body, {
    email: { label: 'Email', rules: [rules.required, rules.string, rules.email] },
    password: { label: 'Password', rules: [rules.required, rules.string] },
  });
  const email = cleanString(req.body.email).toLowerCase();
  const user = await User.findOne({ email }).select('+passwordHash');
  const ok = await bcrypt.compare(req.body.password, user ? user.passwordHash : DUMMY_HASH);

  if (!user || !ok) {
    await logAudit({ req, actor: user || undefined, action: 'LOGIN_FAILED', metadata: { email } });
    throw ApiError.unauthorized('Invalid email or password.', 'INVALID_CREDENTIALS');
  }

  await logAudit({ req, actor: user, action: 'LOGIN' });
  await issueSession(req, res, user);
}

/** GET /api/auth/me */
async function me(req, res) {
  res.json({ success: true, data: { user: await toPublicUser(req.user), redirectTo: DASHBOARD[req.user.role] } });
}

/**
 * POST /api/auth/logout — JWTs are stateless: the client discards its token and the
 * logout is audited. Tokens are short-lived (JWT_EXPIRES_IN) to limit exposure.
 */
async function logout(req, res) {
  await logAudit({ req, action: 'LOGOUT' });
  res.json({ success: true, data: { message: 'Logged out.' } });
}

module.exports = { registerPatient, registerDoctor, login, me, logout };

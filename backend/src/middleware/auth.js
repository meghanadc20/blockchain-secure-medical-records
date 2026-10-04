'use strict';
const ApiError = require('../utils/ApiError');
const { verifyToken } = require('../services/token.service');
const { logAudit } = require('../services/audit.service');
const User = require('../models/User');
const DoctorProfile = require('../models/DoctorProfile');
const { ROLES, VERIFICATION_STATUS } = require('../utils/constants');

/**
 * Requires a valid `Authorization: Bearer <JWT>`.
 * The user is re-loaded from the database on every request, so a deleted account
 * or a changed role takes effect immediately (the token's role claim is not trusted alone).
 */
async function authenticate(req, res, next) {
  const header = req.headers.authorization || '';
  const [scheme, token] = header.split(' ');
  if (scheme !== 'Bearer' || !token) {
    throw ApiError.unauthorized('Authentication required. Please log in.', 'NO_TOKEN');
  }

  let payload;
  try {
    payload = verifyToken(token);
  } catch (err) {
    if (err.name === 'TokenExpiredError') {
      throw ApiError.unauthorized('Your session has expired. Please log in again.', 'TOKEN_EXPIRED');
    }
    throw ApiError.unauthorized('Invalid authentication token. Please log in again.', 'INVALID_TOKEN');
  }

  const user = await User.findById(payload.sub).lean();
  if (!user) throw ApiError.unauthorized('Account no longer exists.', 'INVALID_TOKEN');

  req.user = user;
  next();
}

/** Allows only the given roles. Denials are written to the audit log. */
function authorize(...allowedRoles) {
  return async function roleGuard(req, res, next) {
    if (!req.user) throw ApiError.unauthorized();
    if (!allowedRoles.includes(req.user.role)) {
      await logAudit({
        req, action: 'ACCESS_DENIED',
        metadata: { reason: 'ROLE_NOT_ALLOWED', path: req.originalUrl, method: req.method, required: allowedRoles },
      });
      throw ApiError.forbidden('You do not have permission to perform this action.', 'FORBIDDEN_ROLE');
    }
    next();
  };
}

/**
 * Doctors only, and only when an admin has APPROVED them.
 * Attaches req.doctorProfile.
 */
async function requireVerifiedDoctor(req, res, next) {
  if (!req.user) throw ApiError.unauthorized();
  if (req.user.role !== ROLES.DOCTOR) {
    throw ApiError.forbidden('Only doctors can perform this action.', 'FORBIDDEN_ROLE');
  }
  const profile = await DoctorProfile.findOne({ userId: req.user._id }).lean();
  if (!profile || profile.verificationStatus !== VERIFICATION_STATUS.APPROVED) {
    await logAudit({
      req, action: 'ACCESS_DENIED', doctorId: req.user._id,
      metadata: { reason: 'DOCTOR_NOT_VERIFIED', status: profile ? profile.verificationStatus : 'NO_PROFILE', path: req.originalUrl },
    });
    throw ApiError.forbidden(
      profile && profile.verificationStatus === VERIFICATION_STATUS.REJECTED
        ? 'Your doctor verification was rejected. You cannot access patient records.'
        : 'Your doctor account is pending verification by an administrator.',
      'DOCTOR_NOT_VERIFIED'
    );
  }
  req.doctorProfile = profile;
  next();
}

module.exports = { authenticate, authorize, requireVerifiedDoctor };

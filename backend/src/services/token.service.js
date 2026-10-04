'use strict';
const jwt = require('jsonwebtoken');
const { env, requireEnv } = require('../config/env');

const ISSUER = 'medical-data-sharing-api';
const AUDIENCE = 'medical-data-sharing-web';

function signToken(user) {
  requireEnv(['auth']);
  return jwt.sign({ role: user.role }, env.jwtSecret, {
    subject: String(user._id),
    expiresIn: env.jwtExpiresIn,
    issuer: ISSUER,
    audience: AUDIENCE,
    algorithm: 'HS256',
  });
}

/** Throws jsonwebtoken errors (TokenExpiredError / JsonWebTokenError) on failure. */
function verifyToken(token) {
  requireEnv(['auth']);
  return jwt.verify(token, env.jwtSecret, { issuer: ISSUER, audience: AUDIENCE, algorithms: ['HS256'] });
}

module.exports = { signToken, verifyToken };

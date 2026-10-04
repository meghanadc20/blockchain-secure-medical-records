'use strict';
const { Router } = require('express');
const ctrl = require('../controllers/auth.controller');
const { authenticate } = require('../middleware/auth');
const { rateLimit } = require('../middleware/rateLimit');
const { env } = require('../config/env');

// Integration tests make many requests from one IP; the limiter itself is unit-tested separately.
const skip = () => env.nodeEnv === 'test';

const router = Router();

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  keyFn: (req) => `${req.ip}|${String((req.body && req.body.email) || '').toLowerCase()}`,
  message: 'Too many login attempts. Please wait a few minutes and try again.',
  skip,
});
const registerLimiter = rateLimit({ windowMs: 60 * 60 * 1000, max: 20, skip });

router.post('/register/patient', registerLimiter, ctrl.registerPatient);
router.post('/register/doctor', registerLimiter, ctrl.registerDoctor);
router.post('/login', loginLimiter, ctrl.login);
router.get('/me', authenticate, ctrl.me);
router.post('/logout', authenticate, ctrl.logout);

module.exports = router;

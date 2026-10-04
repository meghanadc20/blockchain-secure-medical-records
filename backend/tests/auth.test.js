'use strict';
require('./setupEnv');
const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { setupTestDB, teardownTestDB, startServer, call } = require('./helpers');
const { createApp } = require('../src/app');
const { authenticate, authorize, requireVerifiedDoctor } = require('../src/middleware/auth');
const { errorHandler } = require('../src/middleware/errorHandler');
const { rateLimit } = require('../src/middleware/rateLimit');
const { env } = require('../src/config/env');

const PATIENT = { name: 'Asha Patient', email: 'asha@example.com', password: 'Secret123', phone: '+91 98765 43210' };
const DOCTOR = {
  name: 'Ravi Doctor', email: 'ravi@example.com', password: 'Secret123', phone: '9876543210',
  specialization: 'Cardiology', licenseNumber: 'KMC-1001', hospital: 'City Hospital',
};
const ADMIN = { email: 'admin@example.com', password: 'AdminPass123' };

describe('Phase 3 — Authentication & authorization', () => {
  let M; let srv; let guarded;
  const tokens = {};

  before(async () => {
    M = await setupTestDB();
    srv = await startServer(createApp());

    // A small app that mounts the real middleware on test routes to check role restrictions.
    const g = express();
    g.get('/any', authenticate, (req, res) => res.json({ success: true, data: { role: req.user.role } }));
    g.get('/patient-only', authenticate, authorize('PATIENT'), (req, res) => res.json({ success: true }));
    g.get('/admin-only', authenticate, authorize('ADMIN'), (req, res) => res.json({ success: true }));
    g.get('/verified-doctor', authenticate, requireVerifiedDoctor, (req, res) => res.json({ success: true }));
    g.use(errorHandler);
    guarded = await startServer(g);

    await M.User.create({ name: 'Site Admin', email: ADMIN.email, role: 'ADMIN', passwordHash: await bcrypt.hash(ADMIN.password, 4) });
  });

  after(async () => { await srv.close(); await guarded.close(); await teardownTestDB(); });

  describe('registration', () => {
    it('1. registers a patient (201, token, PATIENT role, redirect)', async () => {
      const r = await call(srv.url, 'POST', '/api/auth/register/patient', { body: PATIENT });
      assert.equal(r.status, 201);
      assert.equal(r.body.data.user.role, 'PATIENT');
      assert.equal(r.body.data.redirectTo, '/patient/dashboard');
      assert.ok(r.body.data.token);
      assert.equal(r.body.data.user.passwordHash, undefined);
    });

    it('stores the password as a bcrypt hash, never plaintext', async () => {
      const u = await M.User.findOne({ email: PATIENT.email }).select('+passwordHash');
      assert.notEqual(u.passwordHash, PATIENT.password);
      assert.match(u.passwordHash, /^\$2[aby]\$/);
    });

    it('2. registers a doctor with a PENDING profile', async () => {
      const r = await call(srv.url, 'POST', '/api/auth/register/doctor', { body: DOCTOR });
      assert.equal(r.status, 201);
      assert.equal(r.body.data.user.role, 'DOCTOR');
      assert.equal(r.body.data.user.doctorProfile.verificationStatus, 'PENDING');
      assert.equal(r.body.data.redirectTo, '/doctor/dashboard');
      tokens.doctor = r.body.data.token;
    });

    it('rejects a duplicate email with 409 DUPLICATE_EMAIL', async () => {
      const r = await call(srv.url, 'POST', '/api/auth/register/patient', { body: { ...PATIENT, email: 'ASHA@example.com' } });
      assert.equal(r.status, 409);
      assert.equal(r.body.error.code, 'DUPLICATE_EMAIL');
    });

    it('rejects a duplicate license number and leaves no orphan user (transaction)', async () => {
      const r = await call(srv.url, 'POST', '/api/auth/register/doctor', { body: { ...DOCTOR, email: 'other@example.com', licenseNumber: 'kmc-1001' } });
      assert.equal(r.status, 409);
      assert.equal(r.body.error.code, 'DUPLICATE_LICENSE');
      assert.equal(await M.User.exists({ email: 'other@example.com' }), null);
    });

    it('never lets a registrant choose ADMIN (role in body is ignored)', async () => {
      const r = await call(srv.url, 'POST', '/api/auth/register/patient', { body: { ...PATIENT, email: 'sneaky@example.com', role: 'ADMIN' } });
      assert.equal(r.status, 201);
      assert.equal(r.body.data.user.role, 'PATIENT');
    });

    it('returns 400 with field details for invalid input', async () => {
      const r = await call(srv.url, 'POST', '/api/auth/register/patient', { body: { name: 'A', email: 'not-an-email', password: 'short', phone: 'abc' } });
      assert.equal(r.status, 400);
      assert.equal(r.body.error.code, 'VALIDATION_ERROR');
      const fields = r.body.error.details.map((d) => d.field).sort();
      assert.deepEqual(fields, ['email', 'name', 'password', 'phone']);
    });

    it('rejects doctor registration missing professional details', async () => {
      const { specialization, ...rest } = DOCTOR;
      const r = await call(srv.url, 'POST', '/api/auth/register/doctor', { body: { ...rest, email: 'x@example.com', licenseNumber: 'NEW-1' } });
      assert.equal(r.status, 400);
      assert.ok(r.body.error.details.some((d) => d.field === 'specialization'));
    });
  });

  describe('login', () => {
    it('5. valid patient login returns a token and patient redirect', async () => {
      const r = await call(srv.url, 'POST', '/api/auth/login', { body: { email: PATIENT.email, password: PATIENT.password } });
      assert.equal(r.status, 200);
      assert.equal(r.body.data.redirectTo, '/patient/dashboard');
      tokens.patient = r.body.data.token;
    });

    it('3. admin logs in through the same endpoint and is sent to the admin dashboard', async () => {
      const r = await call(srv.url, 'POST', '/api/auth/login', { body: ADMIN });
      assert.equal(r.status, 200);
      assert.equal(r.body.data.user.role, 'ADMIN');
      assert.equal(r.body.data.redirectTo, '/admin/dashboard');
      tokens.admin = r.body.data.token;
    });

    it('6. invalid password and unknown email give the same 401 message', async () => {
      const a = await call(srv.url, 'POST', '/api/auth/login', { body: { email: PATIENT.email, password: 'Wrong1234' } });
      const b = await call(srv.url, 'POST', '/api/auth/login', { body: { email: 'nobody@example.com', password: 'Wrong1234' } });
      assert.equal(a.status, 401); assert.equal(b.status, 401);
      assert.equal(a.body.error.code, 'INVALID_CREDENTIALS');
      assert.equal(a.body.error.message, b.body.error.message);
    });

    it('rejects NoSQL operator injection in credentials', async () => {
      const r = await call(srv.url, 'POST', '/api/auth/login', { body: { email: { $ne: null }, password: { $ne: null } } });
      assert.equal(r.status, 400);
    });

    it('writes LOGIN and LOGIN_FAILED audit entries', async () => {
      assert.ok(await M.AuditLog.exists({ action: 'LOGIN', actorRole: 'PATIENT' }));
      assert.ok(await M.AuditLog.exists({ action: 'LOGIN_FAILED' }));
    });
  });

  describe('protected routes', () => {
    it('7. rejects requests with no token (401 NO_TOKEN)', async () => {
      const r = await call(srv.url, 'GET', '/api/auth/me');
      assert.equal(r.status, 401);
      assert.equal(r.body.error.code, 'NO_TOKEN');
    });

    it('rejects a tampered/invalid token (401 INVALID_TOKEN)', async () => {
      const r = await call(srv.url, 'GET', '/api/auth/me', { token: `${tokens.patient}x` });
      assert.equal(r.status, 401);
      assert.equal(r.body.error.code, 'INVALID_TOKEN');
    });

    it('rejects a token signed with another secret', async () => {
      const forged = jwt.sign({ role: 'ADMIN' }, 'not-the-secret', { subject: 'x', issuer: 'medical-data-sharing-api', audience: 'medical-data-sharing-web' });
      const r = await call(srv.url, 'GET', '/api/auth/me', { token: forged });
      assert.equal(r.status, 401);
    });

    it('rejects an expired token (401 TOKEN_EXPIRED)', async () => {
      const u = await M.User.findOne({ email: PATIENT.email });
      const expired = jwt.sign({ role: 'PATIENT' }, env.jwtSecret, {
        subject: String(u._id), expiresIn: -10, issuer: 'medical-data-sharing-api', audience: 'medical-data-sharing-web',
      });
      const r = await call(srv.url, 'GET', '/api/auth/me', { token: expired });
      assert.equal(r.status, 401);
      assert.equal(r.body.error.code, 'TOKEN_EXPIRED');
    });

    it('returns the current user for a valid token', async () => {
      const r = await call(srv.url, 'GET', '/api/auth/me', { token: tokens.patient });
      assert.equal(r.status, 200);
      assert.equal(r.body.data.user.email, PATIENT.email);
    });

    it('logout is accepted and audited', async () => {
      const r = await call(srv.url, 'POST', '/api/auth/logout', { token: tokens.patient });
      assert.equal(r.status, 200);
      assert.ok(await M.AuditLog.exists({ action: 'LOGOUT' }));
    });
  });

  describe('8. role restrictions', () => {
    it('patient can use patient-only route; doctor gets 403', async () => {
      assert.equal((await call(guarded.url, 'GET', '/patient-only', { token: tokens.patient })).status, 200);
      const r = await call(guarded.url, 'GET', '/patient-only', { token: tokens.doctor });
      assert.equal(r.status, 403);
      assert.equal(r.body.error.code, 'FORBIDDEN_ROLE');
    });

    it('patient and doctor get 403 on admin-only routes; admin gets 200', async () => {
      assert.equal((await call(guarded.url, 'GET', '/admin-only', { token: tokens.patient })).status, 403);
      assert.equal((await call(guarded.url, 'GET', '/admin-only', { token: tokens.doctor })).status, 403);
      assert.equal((await call(guarded.url, 'GET', '/admin-only', { token: tokens.admin })).status, 200);
    });

    it('role is read from the database, not trusted from the token', async () => {
      const u = await M.User.findOne({ email: PATIENT.email });
      const lying = jwt.sign({ role: 'ADMIN' }, env.jwtSecret, {
        subject: String(u._id), expiresIn: 60, issuer: 'medical-data-sharing-api', audience: 'medical-data-sharing-web',
      });
      assert.equal((await call(guarded.url, 'GET', '/admin-only', { token: lying })).status, 403);
    });

    it('denied attempts are audited as ACCESS_DENIED', async () => {
      assert.ok(await M.AuditLog.exists({ action: 'ACCESS_DENIED', 'metadata.reason': 'ROLE_NOT_ALLOWED' }));
    });

    it('unverified doctor is blocked (403 DOCTOR_NOT_VERIFIED); approved doctor passes; rejected is blocked', async () => {
      let r = await call(guarded.url, 'GET', '/verified-doctor', { token: tokens.doctor });
      assert.equal(r.status, 403);
      assert.equal(r.body.error.code, 'DOCTOR_NOT_VERIFIED');

      const doc = await M.User.findOne({ email: DOCTOR.email });
      await M.DoctorProfile.updateOne({ userId: doc._id }, { verificationStatus: 'APPROVED', verifiedAt: new Date() });
      r = await call(guarded.url, 'GET', '/verified-doctor', { token: tokens.doctor });
      assert.equal(r.status, 200);

      await M.DoctorProfile.updateOne({ userId: doc._id }, { verificationStatus: 'REJECTED' });
      r = await call(guarded.url, 'GET', '/verified-doctor', { token: tokens.doctor });
      assert.equal(r.status, 403);
    });

    it('patients cannot pass the verified-doctor check', async () => {
      assert.equal((await call(guarded.url, 'GET', '/verified-doctor', { token: tokens.patient })).status, 403);
    });
  });

  describe('rate limiter', () => {
    it('returns 429 after the limit is exceeded', async () => {
      const app = express();
      app.get('/x', rateLimit({ windowMs: 60_000, max: 2 }), (req, res) => res.json({ success: true }));
      app.use(errorHandler);
      const s = await startServer(app);
      try {
        assert.equal((await call(s.url, 'GET', '/x')).status, 200);
        assert.equal((await call(s.url, 'GET', '/x')).status, 200);
        const r = await call(s.url, 'GET', '/x');
        assert.equal(r.status, 429);
        assert.equal(r.body.error.code, 'TOO_MANY_REQUESTS');
      } finally { await s.close(); }
    });
  });
});

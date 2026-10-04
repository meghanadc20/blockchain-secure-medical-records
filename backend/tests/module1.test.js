'use strict';
require('./setupEnv');
const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const bcrypt = require('bcryptjs');
const { setupTestDB, teardownTestDB, startServer, call } = require('./helpers');
const { createApp } = require('../src/app');

const pw = 'Secret123';

describe('Phase 4 — Module 1: profiles, doctor verification, doctor–patient relationships', () => {
  let M; let srv;
  const t = {}; const id = {};

  const register = async (kind, body) => {
    const r = await call(srv.url, 'POST', `/api/auth/register/${kind}`, { body: { password: pw, phone: '9876543210', ...body } });
    assert.equal(r.status, 201, JSON.stringify(r.body));
    return r.body.data;
  };

  before(async () => {
    M = await setupTestDB();
    srv = await startServer(createApp());
    await M.User.create({ name: 'Admin', email: 'admin@example.com', role: 'ADMIN', passwordHash: await bcrypt.hash('AdminPass123', 4) });
    t.admin = (await call(srv.url, 'POST', '/api/auth/login', { body: { email: 'admin@example.com', password: 'AdminPass123' } })).body.data.token;

    let d = await register('patient', { name: 'Asha Patient', email: 'asha@example.com' }); t.patient = d.token; id.patient = d.user.id;
    d = await register('patient', { name: 'Bina Other', email: 'bina@example.com' }); t.other = d.token; id.other = d.user.id;
    d = await register('doctor', { name: 'Ravi Doctor', email: 'ravi@example.com', specialization: 'Cardiology', licenseNumber: 'KMC-1', hospital: 'City' });
    t.doctor = d.token; id.doctor = d.user.id;
    d = await register('doctor', { name: 'Nina Doctor', email: 'nina@example.com', specialization: 'Neurology', licenseNumber: 'KMC-2', hospital: 'Metro' });
    t.doctor2 = d.token; id.doctor2 = d.user.id;
  });

  after(async () => { await srv.close(); await teardownTestDB(); });

  describe('profiles', () => {
    it('returns own profile', async () => {
      const r = await call(srv.url, 'GET', '/api/profile', { token: t.patient });
      assert.equal(r.status, 200);
      assert.equal(r.body.data.user.email, 'asha@example.com');
    });

    it('patient updates name and phone', async () => {
      const r = await call(srv.url, 'PATCH', '/api/profile', { token: t.patient, body: { name: 'Asha K', phone: '+91 90000 00000' } });
      assert.equal(r.status, 200);
      assert.equal(r.body.data.user.name, 'Asha K');
      assert.ok(await M.AuditLog.exists({ action: 'PROFILE_UPDATED' }));
    });

    it('doctor updates professional details but not licence or status', async () => {
      let r = await call(srv.url, 'PATCH', '/api/profile', { token: t.doctor, body: { hospital: 'General Hospital' } });
      assert.equal(r.status, 200);
      assert.equal(r.body.data.user.doctorProfile.hospital, 'General Hospital');
      r = await call(srv.url, 'PATCH', '/api/profile', { token: t.doctor, body: { verificationStatus: 'APPROVED' } });
      assert.equal(r.status, 400); assert.equal(r.body.error.code, 'FIELD_NOT_EDITABLE');
      r = await call(srv.url, 'PATCH', '/api/profile', { token: t.doctor, body: { licenseNumber: 'NEW' } });
      assert.equal(r.status, 400);
    });

    it('cannot change role or email', async () => {
      const r = await call(srv.url, 'PATCH', '/api/profile', { token: t.patient, body: { role: 'ADMIN', email: 'x@example.com' } });
      assert.equal(r.status, 400);
      assert.equal((await M.User.findById(id.patient)).role, 'PATIENT');
    });

    it('validates input', async () => {
      const r = await call(srv.url, 'PATCH', '/api/profile', { token: t.patient, body: { phone: 'not a phone!' } });
      assert.equal(r.status, 400); assert.equal(r.body.error.code, 'VALIDATION_ERROR');
    });

    it('requires authentication', async () => {
      assert.equal((await call(srv.url, 'GET', '/api/profile')).status, 401);
    });
  });

  describe('admin doctor verification', () => {
    it('patients and doctors cannot use admin APIs (403)', async () => {
      for (const tok of [t.patient, t.doctor]) {
        assert.equal((await call(srv.url, 'GET', '/api/admin/doctors', { token: tok })).status, 403);
        assert.equal((await call(srv.url, 'PATCH', `/api/admin/doctors/${id.doctor}/approve`, { token: tok })).status, 403);
      }
    });

    it('unauthenticated admin API call is 401', async () => {
      assert.equal((await call(srv.url, 'GET', '/api/admin/stats')).status, 401);
    });

    it('lists pending doctors with registration details', async () => {
      const r = await call(srv.url, 'GET', '/api/admin/doctors?status=PENDING', { token: t.admin });
      assert.equal(r.status, 200);
      assert.equal(r.body.data.total, 2);
      const d = r.body.data.items.find((x) => x.email === 'ravi@example.com');
      for (const k of ['name', 'email', 'specialization', 'licenseNumber', 'hospital', 'registeredAt', 'verificationStatus']) assert.ok(d[k], k);
    });

    it('searches doctors', async () => {
      const r = await call(srv.url, 'GET', '/api/admin/doctors?status=PENDING&q=neuro', { token: t.admin });
      assert.equal(r.body.data.total, 1);
      assert.equal(r.body.data.items[0].email, 'nina@example.com');
    });

    it('stats contain counts only', async () => {
      const r = await call(srv.url, 'GET', '/api/admin/stats', { token: t.admin });
      assert.deepEqual(r.body.data, { doctors: { pending: 2, approved: 0, rejected: 0, total: 2 }, patients: 2 });
    });

    it('4. approves a doctor (APPROVED + verifiedAt + audit)', async () => {
      const r = await call(srv.url, 'PATCH', `/api/admin/doctors/${id.doctor}/approve`, { token: t.admin });
      assert.equal(r.status, 200);
      assert.equal(r.body.data.doctor.verificationStatus, 'APPROVED');
      assert.ok(r.body.data.doctor.verifiedAt);
      assert.ok(await M.AuditLog.exists({ action: 'DOCTOR_APPROVED', doctorId: id.doctor }));
    });

    it('approving twice is a 409', async () => {
      const r = await call(srv.url, 'PATCH', `/api/admin/doctors/${id.doctor}/approve`, { token: t.admin });
      assert.equal(r.status, 409);
    });

    it('rejects a doctor with a reason', async () => {
      const r = await call(srv.url, 'PATCH', `/api/admin/doctors/${id.doctor2}/reject`, { token: t.admin, body: { reason: 'Licence could not be verified' } });
      assert.equal(r.status, 200);
      assert.equal(r.body.data.doctor.verificationStatus, 'REJECTED');
      const log = await M.AuditLog.findOne({ action: 'DOCTOR_REJECTED', doctorId: id.doctor2 });
      assert.equal(log.metadata.reason, 'Licence could not be verified');
    });

    it('lists approved and rejected doctors', async () => {
      assert.equal((await call(srv.url, 'GET', '/api/admin/doctors?status=APPROVED', { token: t.admin })).body.data.total, 1);
      assert.equal((await call(srv.url, 'GET', '/api/admin/doctors?status=REJECTED', { token: t.admin })).body.data.total, 1);
    });

    it('404 for unknown doctor, 400 for malformed id, 404 for a patient id', async () => {
      assert.equal((await call(srv.url, 'GET', '/api/admin/doctors/64b7f0c2a1b2c3d4e5f60718', { token: t.admin })).status, 404);
      assert.equal((await call(srv.url, 'GET', '/api/admin/doctors/not-an-id', { token: t.admin })).status, 400);
      assert.equal((await call(srv.url, 'GET', `/api/admin/doctors/${id.patient}`, { token: t.admin })).status, 404);
    });

    it('admin has no access to relationship APIs', async () => {
      assert.equal((await call(srv.url, 'GET', '/api/relations/patient', { token: t.admin })).status, 403);
      assert.equal((await call(srv.url, 'POST', '/api/relations/requests', { token: t.admin, body: { patientEmail: 'asha@example.com' } })).status, 403);
    });
  });

  describe('doctor–patient relationship', () => {
    it('rejected (unverified) doctor cannot request access', async () => {
      const r = await call(srv.url, 'POST', '/api/relations/requests', { token: t.doctor2, body: { patientEmail: 'asha@example.com' } });
      assert.equal(r.status, 403); assert.equal(r.body.error.code, 'DOCTOR_NOT_VERIFIED');
    });

    it('patients cannot create access requests', async () => {
      const r = await call(srv.url, 'POST', '/api/relations/requests', { token: t.patient, body: { patientEmail: 'bina@example.com' } });
      assert.equal(r.status, 403);
    });

    it('404 PATIENT_NOT_FOUND for unknown email or a non-patient email', async () => {
      let r = await call(srv.url, 'POST', '/api/relations/requests', { token: t.doctor, body: { patientEmail: 'nobody@example.com' } });
      assert.equal(r.status, 404); assert.equal(r.body.error.code, 'PATIENT_NOT_FOUND');
      r = await call(srv.url, 'POST', '/api/relations/requests', { token: t.doctor, body: { patientEmail: 'nina@example.com' } });
      assert.equal(r.status, 404);
    });

    it('10. verified doctor requests access (PENDING + audit)', async () => {
      const r = await call(srv.url, 'POST', '/api/relations/requests', { token: t.doctor, body: { patientEmail: 'ASHA@example.com' } });
      assert.equal(r.status, 201);
      assert.equal(r.body.data.relation.status, 'PENDING');
      assert.equal(r.body.data.relation.patient.email, 'asha@example.com');
      id.rel = r.body.data.relation.id;
      assert.ok(await M.AuditLog.exists({ action: 'ACCESS_REQUEST', doctorId: id.doctor, patientId: id.patient }));
    });

    it('duplicate pending request is a 409', async () => {
      const r = await call(srv.url, 'POST', '/api/relations/requests', { token: t.doctor, body: { patientEmail: 'asha@example.com' } });
      assert.equal(r.status, 409); assert.equal(r.body.error.code, 'REQUEST_ALREADY_PENDING');
    });

    it('patient sees the request with doctor details', async () => {
      const r = await call(srv.url, 'GET', '/api/relations/patient?status=PENDING', { token: t.patient });
      assert.equal(r.body.data.total, 1);
      const rel = r.body.data.items[0];
      assert.equal(rel.doctor.specialization, 'Cardiology');
      assert.equal(rel.doctor.verificationStatus, 'APPROVED');
    });

    it('another patient cannot see or act on it (404, audited)', async () => {
      assert.equal((await call(srv.url, 'GET', '/api/relations/patient', { token: t.other })).body.data.total, 0);
      const r = await call(srv.url, 'PATCH', `/api/relations/${id.rel}/approve`, { token: t.other });
      assert.equal(r.status, 404);
      assert.ok(await M.AuditLog.exists({ action: 'ACCESS_DENIED', 'metadata.reason': 'NOT_RELATION_OWNER' }));
    });

    it('the doctor cannot approve their own request', async () => {
      assert.equal((await call(srv.url, 'PATCH', `/api/relations/${id.rel}/approve`, { token: t.doctor })).status, 403);
    });

    it('cannot revoke a request that is still PENDING (409)', async () => {
      const r = await call(srv.url, 'PATCH', `/api/relations/${id.rel}/revoke`, { token: t.patient });
      assert.equal(r.status, 409); assert.equal(r.body.error.code, 'INVALID_STATUS_TRANSITION');
    });

    it('11. patient approves (APPROVED + audit ACCESS_GRANTED)', async () => {
      const r = await call(srv.url, 'PATCH', `/api/relations/${id.rel}/approve`, { token: t.patient });
      assert.equal(r.status, 200);
      assert.equal(r.body.data.relation.status, 'APPROVED');
      assert.ok(r.body.data.relation.approvedAt);
      assert.ok(await M.AuditLog.exists({ action: 'ACCESS_GRANTED', 'metadata.scope': 'RELATION' }));
    });

    it('9. doctor sees the patient in their approved list; re-request is 409 ALREADY_APPROVED', async () => {
      const r = await call(srv.url, 'GET', '/api/relations/doctor?status=APPROVED', { token: t.doctor });
      assert.equal(r.body.data.total, 1);
      assert.equal(r.body.data.items[0].patient.email, 'asha@example.com');
      const again = await call(srv.url, 'POST', '/api/relations/requests', { token: t.doctor, body: { patientEmail: 'asha@example.com' } });
      assert.equal(again.status, 409); assert.equal(again.body.error.code, 'ALREADY_APPROVED');
    });

    it('13. patient revokes; live record permissions for the pair are revoked too', async () => {
      // A record permission that exists while the relationship is approved (Module 4 creates these).
      const rec = await M.MedicalRecord.create({ patientId: id.patient, uploadedBy: id.patient, title: 'Test', recordType: 'OTHER' });
      await M.AccessPermission.create({ recordId: rec._id, patientId: id.patient, doctorId: id.doctor, expiresAt: new Date(Date.now() + 3600_000) });

      const r = await call(srv.url, 'PATCH', `/api/relations/${id.rel}/revoke`, { token: t.patient });
      assert.equal(r.status, 200);
      assert.equal(r.body.data.relation.status, 'REVOKED');
      assert.equal(r.body.data.permissionsRevoked, 1);
      assert.equal(await M.AccessPermission.countDocuments({ doctorId: id.doctor, status: 'GRANTED' }), 0);
      assert.ok(await M.AuditLog.exists({ action: 'ACCESS_REVOKED', 'metadata.scope': 'RELATION' }));
    });

    it('doctor can re-request after revocation (same relation re-opened as PENDING)', async () => {
      const r = await call(srv.url, 'POST', '/api/relations/requests', { token: t.doctor, body: { patientEmail: 'asha@example.com' } });
      assert.equal(r.status, 200);
      assert.equal(r.body.data.relation.status, 'PENDING');
      assert.equal(r.body.data.relation.id, id.rel);
    });

    it('12. patient rejects; rejected request cannot then be approved', async () => {
      let r = await call(srv.url, 'PATCH', `/api/relations/${id.rel}/reject`, { token: t.patient });
      assert.equal(r.status, 200); assert.equal(r.body.data.relation.status, 'REJECTED');
      assert.ok(await M.AuditLog.exists({ action: 'ACCESS_REJECTED' }));
      r = await call(srv.url, 'PATCH', `/api/relations/${id.rel}/approve`, { token: t.patient });
      assert.equal(r.status, 409);
    });

    it('patient cannot approve a request from a doctor who has since been rejected by admin', async () => {
      await call(srv.url, 'POST', '/api/relations/requests', { token: t.doctor, body: { patientEmail: 'asha@example.com' } });
      await call(srv.url, 'PATCH', `/api/admin/doctors/${id.doctor}/reject`, { token: t.admin });
      const r = await call(srv.url, 'PATCH', `/api/relations/${id.rel}/approve`, { token: t.patient });
      assert.equal(r.status, 409); assert.equal(r.body.error.code, 'DOCTOR_NOT_VERIFIED');
    });

    it('rejects malformed ids and unknown status filters', async () => {
      assert.equal((await call(srv.url, 'PATCH', '/api/relations/xyz/approve', { token: t.patient })).status, 400);
      assert.equal((await call(srv.url, 'GET', '/api/relations/patient?status=WHATEVER', { token: t.patient })).status, 400);
    });
  });
});

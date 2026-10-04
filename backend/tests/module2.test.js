'use strict';
require('./setupEnv');
const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const bcrypt = require('bcryptjs');
const { setupTestDB, teardownTestDB, startServer, call } = require('./helpers');
const { createApp } = require('../src/app');

describe('Phase 5 — Module 2: medical records, consultations, patient history', () => {
  let M; let srv;
  const t = {}; const id = {};

  const reg = async (kind, body) => {
    const r = await call(srv.url, 'POST', `/api/auth/register/${kind}`, { body: { password: 'Secret123', phone: '9876543210', ...body } });
    assert.equal(r.status, 201, JSON.stringify(r.body)); return r.body.data;
  };
  const day = (n) => new Date(Date.now() - n * 86400_000).toISOString();

  before(async () => {
    M = await setupTestDB();
    srv = await startServer(createApp());
    await M.User.create({ name: 'Admin', email: 'admin@example.com', role: 'ADMIN', passwordHash: await bcrypt.hash('AdminPass123', 4) });
    t.admin = (await call(srv.url, 'POST', '/api/auth/login', { body: { email: 'admin@example.com', password: 'AdminPass123' } })).body.data.token;

    let d = await reg('patient', { name: 'Asha Patient', email: 'asha@example.com' }); t.patient = d.token; id.patient = d.user.id;
    d = await reg('patient', { name: 'Bina Other', email: 'bina@example.com' }); t.other = d.token; id.other = d.user.id;
    d = await reg('doctor', { name: 'Ravi Doctor', email: 'ravi@example.com', specialization: 'Cardiology', licenseNumber: 'K-1', hospital: 'City' }); t.doctor = d.token; id.doctor = d.user.id;
    d = await reg('doctor', { name: 'Nina Doctor', email: 'nina@example.com', specialization: 'Neurology', licenseNumber: 'K-2', hospital: 'Metro' }); t.doctor2 = d.token; id.doctor2 = d.user.id;
    d = await reg('doctor', { name: 'Pending Doc', email: 'pend@example.com', specialization: 'ENT', licenseNumber: 'K-3', hospital: 'Metro' }); t.pending = d.token;

    for (const doc of [id.doctor, id.doctor2]) await call(srv.url, 'PATCH', `/api/admin/doctors/${doc}/approve`, { token: t.admin });
    // Ravi: approved relationship with Asha. Nina: request pending only.
    const r1 = await call(srv.url, 'POST', '/api/relations/requests', { token: t.doctor, body: { patientEmail: 'asha@example.com' } });
    id.rel = r1.body.data.relation.id;
    await call(srv.url, 'PATCH', `/api/relations/${id.rel}/approve`, { token: t.patient });
    await call(srv.url, 'POST', '/api/relations/requests', { token: t.doctor2, body: { patientEmail: 'asha@example.com' } });

    // Records (file upload arrives in Module 3 — create metadata directly)
    id.rec1 = String((await M.MedicalRecord.create({ patientId: id.patient, uploadedBy: id.patient, title: 'Blood test', recordType: 'LAB_REPORT', description: 'CBC', createdAt: new Date(Date.now() - 10 * 86400_000) }))._id);
    id.rec2 = String((await M.MedicalRecord.create({ patientId: id.patient, uploadedBy: id.patient, title: 'Chest X-ray', recordType: 'IMAGING', storagePath: 'medical-records/x/y/encrypted-file', encryptionIv: 'iv', encryptionAuthTag: 'tag' }))._id);
    id.recOther = String((await M.MedicalRecord.create({ patientId: id.other, uploadedBy: id.other, title: 'Other patient record', recordType: 'OTHER' }))._id);
  });

  after(async () => { await srv.close(); await teardownTestDB(); });

  describe('medical records (metadata)', () => {
    it('patient lists own records only, newest first, no storage details', async () => {
      const r = await call(srv.url, 'GET', '/api/records', { token: t.patient });
      assert.equal(r.status, 200);
      assert.equal(r.body.data.total, 2);
      assert.equal(r.body.data.items[0].title, 'Chest X-ray');
      const raw = JSON.stringify(r.body);
      for (const k of ['storagePath', 'encryptionIv', 'encryptionAuthTag', 'encrypted-file']) assert.ok(!raw.includes(k), k);
      assert.equal(r.body.data.items[0].hasFile, true);
      assert.equal(r.body.data.items[0].uploadedBy.name, 'Asha Patient');
    });

    it('filters by type and search', async () => {
      assert.equal((await call(srv.url, 'GET', '/api/records?type=IMAGING', { token: t.patient })).body.data.total, 1);
      assert.equal((await call(srv.url, 'GET', '/api/records?q=blood', { token: t.patient })).body.data.total, 1);
      assert.equal((await call(srv.url, 'GET', '/api/records?type=SELFIE', { token: t.patient })).status, 400);
    });

    it('patient reads and edits own record metadata', async () => {
      let r = await call(srv.url, 'GET', `/api/records/${id.rec1}`, { token: t.patient });
      assert.equal(r.body.data.record.title, 'Blood test');
      r = await call(srv.url, 'PATCH', `/api/records/${id.rec1}`, { token: t.patient, body: { title: 'Full blood count', description: 'Annual check' } });
      assert.equal(r.status, 200);
      assert.equal(r.body.data.record.title, 'Full blood count');
      assert.ok(await M.AuditLog.exists({ action: 'RECORD_UPDATED', recordId: id.rec1 }));
    });

    it('file and hash fields cannot be edited', async () => {
      const r = await call(srv.url, 'PATCH', `/api/records/${id.rec1}`, { token: t.patient, body: { sha256Hash: 'a'.repeat(64) } });
      assert.equal(r.status, 400); assert.equal(r.body.error.code, 'FIELD_NOT_EDITABLE');
    });

    it('16. another patient\'s record is 404 (and audited)', async () => {
      assert.equal((await call(srv.url, 'GET', `/api/records/${id.recOther}`, { token: t.patient })).status, 404);
      assert.equal((await call(srv.url, 'PATCH', `/api/records/${id.recOther}`, { token: t.patient, body: { title: 'hacked' } })).status, 404);
      assert.equal((await M.MedicalRecord.findById(id.recOther)).title, 'Other patient record');
      assert.ok(await M.AuditLog.exists({ action: 'ACCESS_DENIED', 'metadata.reason': 'NOT_RECORD_OWNER' }));
    });

    it('doctors and admins cannot use the patient records API (record access for doctors comes with permissions)', async () => {
      assert.equal((await call(srv.url, 'GET', '/api/records', { token: t.doctor })).status, 403);
      assert.equal((await call(srv.url, 'GET', `/api/records/${id.rec1}`, { token: t.doctor })).status, 403);
      assert.equal((await call(srv.url, 'GET', '/api/records', { token: t.admin })).status, 403);
    });
  });

  describe('consultations', () => {
    it('doctor with an APPROVED relationship adds a consultation (201, audited without medical text)', async () => {
      const r = await call(srv.url, 'POST', '/api/consultations', { token: t.doctor, body: {
        patientId: id.patient, consultationDate: day(2), diagnosis: 'Hypertension stage 1', prescription: 'Amlodipine 5mg OD', treatmentNotes: 'Review in 4 weeks', recordId: id.rec1,
      } });
      assert.equal(r.status, 201, JSON.stringify(r.body));
      assert.equal(r.body.data.consultation.diagnosis, 'Hypertension stage 1');
      assert.equal(r.body.data.consultation.doctor.specialization, 'Cardiology');
      id.c1 = r.body.data.consultation.id;
      const log = await M.AuditLog.findOne({ action: 'CONSULTATION_ADDED' }).lean();
      assert.ok(log);
      assert.ok(!JSON.stringify(log).includes('Hypertension'), 'audit must not contain diagnosis text');
    });

    it('a second consultation (notes only) is accepted', async () => {
      const r = await call(srv.url, 'POST', '/api/consultations', { token: t.doctor, body: { patientId: id.patient, consultationDate: day(1), treatmentNotes: 'BP improving' } });
      assert.equal(r.status, 201); id.c2 = r.body.data.consultation.id;
    });

    it('validation: needs some clinical content, a valid non-future date and a valid patient', async () => {
      let r = await call(srv.url, 'POST', '/api/consultations', { token: t.doctor, body: { patientId: id.patient, consultationDate: day(0) } });
      assert.equal(r.status, 400);
      r = await call(srv.url, 'POST', '/api/consultations', { token: t.doctor, body: { patientId: id.patient, consultationDate: new Date(Date.now() + 5 * 86400_000).toISOString(), diagnosis: 'x' } });
      assert.equal(r.status, 400); assert.ok(r.body.error.details.some((d) => d.field === 'consultationDate'));
      r = await call(srv.url, 'POST', '/api/consultations', { token: t.doctor, body: { patientId: 'nope', consultationDate: day(0), diagnosis: 'x' } });
      assert.equal(r.status, 400);
      r = await call(srv.url, 'POST', '/api/consultations', { token: t.doctor, body: { patientId: id.doctor, consultationDate: day(0), diagnosis: 'x' } });
      assert.equal(r.status, 404); assert.equal(r.body.error.code, 'PATIENT_NOT_FOUND');
    });

    it('cannot link a record belonging to a different patient', async () => {
      const r = await call(srv.url, 'POST', '/api/consultations', { token: t.doctor, body: { patientId: id.patient, consultationDate: day(0), diagnosis: 'x', recordId: id.recOther } });
      assert.equal(r.status, 400);
    });

    it('doctor WITHOUT an approved relationship cannot add one (403, audited)', async () => {
      let r = await call(srv.url, 'POST', '/api/consultations', { token: t.doctor2, body: { patientId: id.patient, consultationDate: day(0), diagnosis: 'x' } });
      assert.equal(r.status, 403); assert.equal(r.body.error.code, 'PERMISSION_DENIED');
      r = await call(srv.url, 'POST', '/api/consultations', { token: t.doctor, body: { patientId: id.other, consultationDate: day(0), diagnosis: 'x' } });
      assert.equal(r.status, 403);
      assert.ok(await M.AuditLog.exists({ action: 'ACCESS_DENIED', 'metadata.operation': 'CREATE_CONSULTATION' }));
    });

    it('unverified doctors, patients and admins cannot add consultations', async () => {
      const body = { patientId: id.patient, consultationDate: day(0), diagnosis: 'x' };
      assert.equal((await call(srv.url, 'POST', '/api/consultations', { token: t.pending, body })).status, 403);
      assert.equal((await call(srv.url, 'POST', '/api/consultations', { token: t.patient, body })).status, 403);
      assert.equal((await call(srv.url, 'POST', '/api/consultations', { token: t.admin, body })).status, 403);
    });

    it('patient sees all own consultations; other patient sees none and gets 404 on direct access', async () => {
      const r = await call(srv.url, 'GET', '/api/consultations', { token: t.patient });
      assert.equal(r.body.data.total, 2);
      assert.equal(r.body.data.items[0].id, id.c2, 'newest first');
      assert.equal((await call(srv.url, 'GET', '/api/consultations', { token: t.other })).body.data.total, 0);
      assert.equal((await call(srv.url, 'GET', `/api/consultations/${id.c1}`, { token: t.other })).status, 404);
      assert.equal((await call(srv.url, 'GET', `/api/consultations/${id.c1}`, { token: t.patient })).status, 200);
    });

    it('authoring doctor reads own consultations (audited as RECORD_VIEW); other doctors cannot', async () => {
      let r = await call(srv.url, 'GET', `/api/consultations?patientId=${id.patient}`, { token: t.doctor });
      assert.equal(r.status, 200); assert.equal(r.body.data.total, 2);
      r = await call(srv.url, 'GET', `/api/consultations/${id.c1}`, { token: t.doctor });
      assert.equal(r.status, 200);
      assert.ok(await M.AuditLog.exists({ action: 'RECORD_VIEW', 'metadata.type': 'CONSULTATION' }));
      assert.equal((await call(srv.url, 'GET', `/api/consultations/${id.c1}`, { token: t.doctor2 })).status, 404);
      assert.equal((await call(srv.url, 'GET', `/api/consultations?patientId=${id.patient}`, { token: t.doctor2 })).status, 403);
      assert.equal((await call(srv.url, 'GET', '/api/consultations', { token: t.admin })).status, 403);
    });

    it('after the patient revokes, the doctor loses access to those consultations immediately', async () => {
      await call(srv.url, 'PATCH', `/api/relations/${id.rel}/revoke`, { token: t.patient });
      let r = await call(srv.url, 'GET', `/api/consultations/${id.c1}`, { token: t.doctor });
      assert.equal(r.status, 403); assert.equal(r.body.error.code, 'PERMISSION_REVOKED');
      r = await call(srv.url, 'GET', '/api/consultations', { token: t.doctor });
      assert.equal(r.body.data.total, 0);
      r = await call(srv.url, 'POST', '/api/consultations', { token: t.doctor, body: { patientId: id.patient, consultationDate: day(0), diagnosis: 'x' } });
      assert.equal(r.status, 403);
      // patient still has the full history
      assert.equal((await call(srv.url, 'GET', '/api/consultations', { token: t.patient })).body.data.total, 2);
    });

    it('consultations cannot be edited or deleted', async () => {
      assert.equal((await call(srv.url, 'PATCH', `/api/consultations/${id.c1}`, { token: t.patient, body: { diagnosis: 'x' } })).status, 404);
      assert.equal((await call(srv.url, 'DELETE', `/api/consultations/${id.c1}`, { token: t.patient })).status, 404);
    });
  });

  describe('patient history timeline', () => {
    it('merges records and consultations, newest first', async () => {
      const r = await call(srv.url, 'GET', '/api/history', { token: t.patient });
      assert.equal(r.status, 200);
      assert.deepEqual(r.body.data.counts, { records: 2, consultations: 2 });
      const dates = r.body.data.items.map((i) => new Date(i.date).getTime());
      assert.deepEqual(dates, [...dates].sort((a, b) => b - a));
      const kinds = r.body.data.items.map((i) => i.kind);
      assert.ok(kinds.includes('RECORD') && kinds.includes('CONSULTATION'));
      assert.ok(!JSON.stringify(r.body).includes('encrypted-file'));
    });

    it('filters by type and date range', async () => {
      assert.equal((await call(srv.url, 'GET', '/api/history?type=CONSULTATION', { token: t.patient })).body.data.items.length, 2);
      assert.equal((await call(srv.url, 'GET', '/api/history?type=RECORD', { token: t.patient })).body.data.items.length, 2);
      const from = new Date(Date.now() - 3 * 86400_000).toISOString().slice(0, 10);
      const r = await call(srv.url, 'GET', `/api/history?from=${from}`, { token: t.patient });
      assert.equal(r.body.data.items.length, 3, 'old blood test (10 days ago) excluded');
      assert.equal((await call(srv.url, 'GET', '/api/history?from=2026-13-40', { token: t.patient })).status, 400);
      assert.equal((await call(srv.url, 'GET', '/api/history?type=XYZ', { token: t.patient })).status, 400);
    });

    it('only contains the signed-in patient\'s data', async () => {
      const r = await call(srv.url, 'GET', '/api/history', { token: t.other });
      assert.deepEqual(r.body.data.counts, { records: 1, consultations: 0 });
    });

    it('doctors and admins cannot read a patient timeline', async () => {
      assert.equal((await call(srv.url, 'GET', '/api/history', { token: t.doctor })).status, 403);
      assert.equal((await call(srv.url, 'GET', '/api/history', { token: t.admin })).status, 403);
      assert.equal((await call(srv.url, 'GET', '/api/history')).status, 401);
    });
  });
});

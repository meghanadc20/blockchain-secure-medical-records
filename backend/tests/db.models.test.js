'use strict';
const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { setupTestDB, teardownTestDB } = require('./helpers');

const HASH = 'a'.repeat(64);
const TX = `0x${'b'.repeat(64)}`;

describe('Phase 2 — MongoDB models', () => {
  let M;
  let patient; let doctor; let admin; let record;

  before(async () => { M = await setupTestDB(); });
  after(async () => { await teardownTestDB(); });

  describe('users', () => {
    it('creates users for each role', async () => {
      patient = await M.User.create({ name: 'Pat Ient', email: 'Patient@Example.com', passwordHash: 'x', role: 'PATIENT', phone: '9999999999' });
      doctor = await M.User.create({ name: 'Doc Tor', email: 'doctor@example.com', passwordHash: 'x', role: 'DOCTOR' });
      admin = await M.User.create({ name: 'Ad Min', email: 'admin@example.com', passwordHash: 'x', role: 'ADMIN' });
      assert.equal(patient.email, 'patient@example.com', 'email is lower-cased');
      assert.ok(patient.createdAt && patient.updatedAt);
    });

    it('rejects a duplicate email (unique index)', async () => {
      await assert.rejects(
        M.User.create({ name: 'Dup', email: 'PATIENT@example.com', passwordHash: 'x', role: 'PATIENT' }),
        (e) => e.code === 11000
      );
    });

    it('rejects an invalid role', async () => {
      await assert.rejects(
        M.User.create({ name: 'Bad', email: 'bad@example.com', passwordHash: 'x', role: 'SUPERUSER' }),
        (e) => e.name === 'ValidationError'
      );
    });

    it('never returns passwordHash by default or in JSON', async () => {
      const found = await M.User.findById(patient._id);
      assert.equal(found.passwordHash, undefined);
      const withHash = await M.User.findById(patient._id).select('+passwordHash');
      assert.equal(withHash.passwordHash, 'x');
      assert.equal(withHash.toJSON().passwordHash, undefined);
    });

    it('reads, updates and deletes (CRUD)', async () => {
      const u = await M.User.create({ name: 'Temp', email: 'temp@example.com', passwordHash: 'x', role: 'PATIENT' });
      await M.User.updateOne({ _id: u._id }, { phone: '123' });
      assert.equal((await M.User.findById(u._id)).phone, '123');
      await M.User.deleteOne({ _id: u._id });
      assert.equal(await M.User.findById(u._id), null);
    });
  });

  describe('doctorProfiles', () => {
    it('defaults verificationStatus to PENDING', async () => {
      const p = await M.DoctorProfile.create({ userId: doctor._id, specialization: 'Cardiology', licenseNumber: 'kmc-123', hospital: 'City Hospital' });
      assert.equal(p.verificationStatus, 'PENDING');
      assert.equal(p.licenseNumber, 'KMC-123');
    });

    it('allows only one profile per doctor and unique licence numbers', async () => {
      await assert.rejects(M.DoctorProfile.create({ userId: doctor._id, specialization: 'X', licenseNumber: 'OTHER', hospital: 'H' }), (e) => e.code === 11000);
      const d2 = await M.User.create({ name: 'Doc Two', email: 'doc2@example.com', passwordHash: 'x', role: 'DOCTOR' });
      await assert.rejects(M.DoctorProfile.create({ userId: d2._id, specialization: 'X', licenseNumber: 'KMC-123', hospital: 'H' }), (e) => e.code === 11000);
    });
  });

  describe('doctorPatientRelations', () => {
    it('creates a PENDING request and enforces one document per pair', async () => {
      const r = await M.DoctorPatientRelation.create({ doctorId: doctor._id, patientId: patient._id });
      assert.equal(r.status, 'PENDING');
      assert.ok(r.requestedAt);
      await assert.rejects(M.DoctorPatientRelation.create({ doctorId: doctor._id, patientId: patient._id }), (e) => e.code === 11000);
    });
  });

  describe('medicalRecords', () => {
    it('stores metadata and hides storage/encryption fields from JSON', async () => {
      record = await M.MedicalRecord.create({
        patientId: patient._id, uploadedBy: patient._id, title: 'Blood test', recordType: 'LAB_REPORT',
        fileName: 'blood.pdf', storagePath: `medical-records/${patient._id}/r1/encrypted-file`, mimeType: 'application/pdf',
        fileSize: 1024, sha256Hash: HASH, encryptionIv: 'iv', encryptionAuthTag: 'tag',
      });
      const json = (await M.MedicalRecord.findById(record._id)).toJSON();
      assert.equal(json.sha256Hash, HASH);
      assert.equal(json.storagePath, undefined);
      assert.equal(json.encryptionIv, undefined);
    });

    it('rejects an invalid SHA-256 hash and unknown record type', async () => {
      await assert.rejects(M.MedicalRecord.create({ patientId: patient._id, uploadedBy: patient._id, title: 'x', recordType: 'LAB_REPORT', sha256Hash: 'nothex' }), (e) => e.name === 'ValidationError');
      await assert.rejects(M.MedicalRecord.create({ patientId: patient._id, uploadedBy: patient._id, title: 'x', recordType: 'SELFIE' }), (e) => e.name === 'ValidationError');
    });
  });

  describe('consultations', () => {
    it('stores diagnosis, prescription and treatment notes linked to users and record', async () => {
      const c = await M.Consultation.create({
        patientId: patient._id, doctorId: doctor._id, recordId: record._id, consultationDate: new Date(),
        diagnosis: 'Dx', prescription: 'Rx', treatmentNotes: 'Notes',
      });
      const populated = await M.Consultation.findById(c._id).populate('doctorId', 'name role');
      assert.equal(populated.doctorId.role, 'DOCTOR');
    });
  });

  describe('accessPermissions', () => {
    it('requires expiresAt after grantedAt', async () => {
      const now = new Date();
      await assert.rejects(
        M.AccessPermission.create({ recordId: record._id, patientId: patient._id, doctorId: doctor._id, grantedAt: now, expiresAt: new Date(now - 1000) }),
        (e) => e.name === 'ValidationError'
      );
    });

    it('isActive() is false once expiresAt has passed, even if status is still GRANTED', async () => {
      const p = new M.AccessPermission({ recordId: record._id, patientId: patient._id, doctorId: doctor._id, expiresAt: new Date(Date.now() + 60_000) });
      assert.equal(p.isActive(), true);
      assert.equal(p.isActive(new Date(Date.now() + 120_000)), false);
    });

    it('allows only one GRANTED permission per doctor+record, but keeps REVOKED history', async () => {
      const exp = new Date(Date.now() + 3600_000);
      const first = await M.AccessPermission.create({ recordId: record._id, patientId: patient._id, doctorId: doctor._id, expiresAt: exp, blockchainTransactionHash: TX });
      await assert.rejects(M.AccessPermission.create({ recordId: record._id, patientId: patient._id, doctorId: doctor._id, expiresAt: exp }), (e) => e.code === 11000);
      first.status = 'REVOKED'; first.revokedAt = new Date(); await first.save();
      const second = await M.AccessPermission.create({ recordId: record._id, patientId: patient._id, doctorId: doctor._id, expiresAt: exp });
      assert.equal(second.status, 'GRANTED');
    });
  });

  describe('auditLogs', () => {
    it('appends entries and blocks updates/deletes', async () => {
      const log = await M.AuditLog.create({ actorId: patient._id, actorRole: 'PATIENT', action: 'LOGIN', ipAddress: '127.0.0.1' });
      assert.ok(log.timestamp);
      await assert.rejects(M.AuditLog.updateOne({ _id: log._id }, { action: 'LOGOUT' }), /append-only/);
      await assert.rejects(M.AuditLog.deleteOne({ _id: log._id }), /append-only/);
      log.action = 'LOGOUT';
      await assert.rejects(log.save(), /append-only/);
      assert.equal((await M.AuditLog.findById(log._id)).action, 'LOGIN');
    });

    it('rejects unknown actions', async () => {
      await assert.rejects(M.AuditLog.create({ actorRole: 'ANONYMOUS', action: 'HACK' }), (e) => e.name === 'ValidationError');
    });
  });

  describe('indexes', () => {
    it('exist on every collection', async () => {
      const names = async (Model) => (await Model.collection.indexes()).map((i) => Object.keys(i.key).join('+'));
      assert.ok((await names(M.User)).includes('email'));
      assert.ok((await names(M.DoctorProfile)).includes('licenseNumber'));
      assert.ok((await names(M.DoctorPatientRelation)).includes('doctorId+patientId'));
      assert.ok((await names(M.MedicalRecord)).includes('patientId+createdAt'));
      assert.ok((await names(M.Consultation)).includes('patientId+consultationDate'));
      assert.ok((await names(M.AccessPermission)).includes('recordId+doctorId'));
      assert.ok((await names(M.AuditLog)).includes('patientId+timestamp'));
    });
  });
});

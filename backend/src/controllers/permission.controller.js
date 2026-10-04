'use strict';
const mongoose = require('mongoose');
const AccessPermission = require('../models/AccessPermission');
const MedicalRecord = require('../models/MedicalRecord');
const User = require('../models/User');
const DoctorProfile = require('../models/DoctorProfile');
const ApiError = require('../utils/ApiError');
const { ROLES, PERMISSION_STATUS, VERIFICATION_STATUS } = require('../utils/constants');
const { rules, validate } = require('../utils/validators');
const { parsePagination, paginated } = require('../utils/pagination');
const { logAudit } = require('../services/audit.service');
const { hasApprovedRelation } = require('../services/relation.service');
const { effectiveStatus, markExpired } = require('../services/permission.service');
const chain = require('../services/blockchain.service');
const { anchorRecord } = require('../services/anchor.service');

const MIN_DURATION_MS = 5 * 60 * 1000;            // 5 minutes
const MAX_DURATION_MS = 365 * 24 * 60 * 60 * 1000; // 1 year

function toView(p, now = new Date()) {
  const rec = p.recordId && p.recordId.title ? p.recordId : null;
  const doc = p.doctorId && p.doctorId.name ? p.doctorId : null;
  const pat = p.patientId && p.patientId.name ? p.patientId : null;
  return {
    id: String(p._id),
    status: effectiveStatus(p, now),            // ACTIVE | EXPIRED | REVOKED
    storedStatus: p.status,                     // GRANTED | EXPIRED | REVOKED (as in the database)
    grantedAt: p.grantedAt,
    expiresAt: p.expiresAt,
    revokedAt: p.revokedAt || null,
    blockchainTransactionHash: p.blockchainTransactionHash || null,
    revokeTransactionHash: p.revokeTransactionHash || null,
    record: rec ? { id: String(rec._id), title: rec.title, recordType: rec.recordType, hasFile: Boolean(rec.storagePath), fileName: rec.fileName || null, createdAt: rec.createdAt } : { id: String(p.recordId) },
    doctor: doc ? { id: String(doc._id), name: doc.name, email: doc.email } : { id: String(p.doctorId) },
    patient: pat ? { id: String(pat._id), name: pat.name, email: pat.email } : { id: String(p.patientId) },
  };
}

const populateAll = (q) => q.populate('recordId', 'title recordType storagePath fileName createdAt').populate('doctorId', 'name email').populate('patientId', 'name email');

function statusFilter(raw) {
  if (!raw) return {};
  const s = String(raw).toUpperCase();
  const now = new Date();
  if (s === 'ACTIVE') return { status: PERMISSION_STATUS.GRANTED, expiresAt: { $gt: now } };
  if (s === 'EXPIRED') return { $or: [{ status: PERMISSION_STATUS.EXPIRED }, { status: PERMISSION_STATUS.GRANTED, expiresAt: { $lte: now } }] };
  if (s === 'REVOKED') return { status: PERMISSION_STATUS.REVOKED };
  throw ApiError.badRequest('status must be ACTIVE, EXPIRED or REVOKED', 'VALIDATION_ERROR');
}

/**
 * Validates a grant request and loads everything it refers to.
 * minLeadMs: 5 minutes when preparing; 1 minute when confirming (the patient needed time to sign).
 */
async function validateGrantRequest(req, { minLeadMs = MIN_DURATION_MS } = {}) {
  const body = req.body || {};
  const errors = validate(body, {
    recordId: { label: 'Record', rules: [rules.required, rules.string, rules.objectId] },
    doctorId: { label: 'Doctor', rules: [rules.required, rules.string, rules.objectId] },
    expiresAt: { label: 'Expiry time', rules: [rules.required, rules.date] },
  });
  const now = Date.now();
  // Expiry is stored on-chain in whole seconds.
  const expiresAt = new Date(Math.floor(new Date(body.expiresAt).getTime() / 1000) * 1000);
  if (!errors.some((e) => e.field === 'expiresAt')) {
    if (expiresAt.getTime() < now + minLeadMs) errors.push({ field: 'expiresAt', message: 'Expiry must be at least 5 minutes from now' });
    else if (expiresAt.getTime() > now + MAX_DURATION_MS) errors.push({ field: 'expiresAt', message: 'Expiry can be at most 1 year from now' });
  }
  if (errors.length) throw ApiError.badRequest('Please correct the highlighted fields.', 'VALIDATION_ERROR', errors);

  const record = await MedicalRecord.findById(body.recordId).select('patientId title sha256Hash blockchainTransactionHash storagePath').lean();
  if (!record || String(record.patientId) !== String(req.user._id)) {
    if (record) await logAudit({ req, action: 'ACCESS_DENIED', recordId: record._id, metadata: { reason: 'NOT_RECORD_OWNER', operation: 'GRANT' } });
    throw ApiError.notFound('Record not found.', 'RECORD_NOT_FOUND');
  }
  if (!record.storagePath || !record.sha256Hash) throw ApiError.conflict('Only records with an uploaded file can be shared.', 'RECORD_HAS_NO_FILE');

  const doctor = await User.findOne({ _id: body.doctorId, role: ROLES.DOCTOR }).select('name').lean();
  if (!doctor) throw ApiError.notFound('Doctor not found.', 'DOCTOR_NOT_FOUND');
  const profile = await DoctorProfile.findOne({ userId: doctor._id }).select('verificationStatus').lean();
  if (!profile || profile.verificationStatus !== VERIFICATION_STATUS.APPROVED) {
    throw ApiError.conflict('This doctor is not verified, so access cannot be granted.', 'DOCTOR_NOT_VERIFIED');
  }
  if (!(await hasApprovedRelation(doctor._id, req.user._id))) {
    throw ApiError.conflict('Approve this doctor’s access request before sharing records.', 'RELATION_NOT_APPROVED');
  }

  const existing = await AccessPermission.findOne({ recordId: record._id, doctorId: doctor._id, status: PERMISSION_STATUS.GRANTED }).lean();
  if (existing) {
    if (new Date(existing.expiresAt) > new Date()) {
      throw ApiError.conflict('This doctor already has active access to this record. Revoke it first to change the expiry.', 'ALREADY_GRANTED');
    }
    await markExpired(existing, { req });
  }
  return { record, doctor, expiresAt };
}

/** The patient's wallet must be linked in the app AND registered on-chain. Returns the checksummed address. */
async function requireLinkedWallet(req) {
  const user = await User.findById(req.user._id).select('walletAddress').lean();
  if (!user.walletAddress) {
    throw ApiError.conflict('Link your MetaMask wallet on your Profile page before sharing records.', 'WALLET_NOT_LINKED');
  }
  const onChain = await chain.getPatientWallet(req.user._id);
  if (!onChain || onChain.toLowerCase() !== user.walletAddress) {
    throw ApiError.conflict('Your wallet is not registered on the blockchain. Link it again on your Profile page.', 'WALLET_NOT_LINKED');
  }
  return onChain;
}

/**
 * POST /api/permissions/prepare  { recordId, doctorId, expiresAt }
 * Validates the grant and returns what the patient's wallet must sign: grantAccess(recordKey, doctorKey, expiresAt).
 * Nothing is stored yet.
 */
async function prepareGrant(req, res) {
  const { record, doctor, expiresAt } = await validateGrantRequest(req);
  const wallet = await requireLinkedWallet(req);
  await anchorRecord(record, { req }); // ensure the record exists on-chain (retries a deferred anchor)
  const expiresAtSec = Math.floor(expiresAt.getTime() / 1000);
  const cfg = chain.publicConfig();
  res.json({ success: true, data: {
    contractAddress: cfg.contractAddress, chainId: cfg.chainId, wallet,
    method: 'grantAccess', args: [chain.recordKey(record._id), chain.doctorKey(doctor._id), expiresAtSec],
    expiresAt: expiresAt.toISOString(),
  } });
}

/**
 * POST /api/permissions  { recordId, doctorId, expiresAt, txHash }
 * Confirms a grant the patient signed in MetaMask. The backend loads the transaction receipt and
 * accepts it only if it is a successful AccessGranted event from the patient's own wallet for exactly
 * this record, doctor and expiry, and the contract's hasAccess() is now true.
 */
async function grant(req, res) {
  const { record, doctor, expiresAt } = await validateGrantRequest(req, { minLeadMs: 60 * 1000 });
  const wallet = await requireLinkedWallet(req);
  const txHash = String((req.body || {}).txHash || '').toLowerCase();
  if (txHash && await AccessPermission.exists({ $or: [{ blockchainTransactionHash: txHash }, { revokeTransactionHash: txHash }] })) {
    throw ApiError.conflict('This transaction has already been used.', 'TX_ALREADY_USED');
  }
  const verified = await chain.verifyGrantTx(txHash, {
    recordId: record._id, doctorId: doctor._id, wallet, expiresAtSec: Math.floor(expiresAt.getTime() / 1000),
  });
  if (!(await chain.hasAccess(record._id, doctor._id))) {
    throw ApiError.conflict('The blockchain does not show this access as active.', 'BLOCKCHAIN_STATE_MISMATCH');
  }

  let perm;
  try {
    perm = await AccessPermission.create({
      recordId: record._id, patientId: req.user._id, doctorId: doctor._id, status: PERMISSION_STATUS.GRANTED,
      grantedAt: new Date(verified.grantedAt * 1000), expiresAt: new Date(verified.expiresAt * 1000),
      blockchainTransactionHash: verified.txHash.toLowerCase(),
    });
  } catch (err) {
    if (err.code === 11000) throw ApiError.conflict('This doctor already has active access to this record.', 'ALREADY_GRANTED');
    throw err;
  }

  await logAudit({
    req, action: 'ACCESS_GRANTED', patientId: req.user._id, doctorId: doctor._id, recordId: record._id,
    blockchainTransactionHash: verified.txHash, metadata: { scope: 'RECORD', permissionId: String(perm._id), expiresAt: perm.expiresAt, blockNumber: verified.blockNumber },
  });
  const populated = await populateAll(AccessPermission.findById(perm._id)).lean();
  res.status(201).json({ success: true, data: { permission: toView(populated) } });
}

async function loadOwnGrantedPermission(req) {
  const perm = await AccessPermission.findById(req.params.permissionId).lean();
  if (!perm || String(perm.patientId) !== String(req.user._id)) {
    if (perm) await logAudit({ req, action: 'ACCESS_DENIED', recordId: perm.recordId, metadata: { reason: 'NOT_PERMISSION_OWNER', operation: 'REVOKE' } });
    throw ApiError.notFound('Permission not found.', 'PERMISSION_NOT_FOUND');
  }
  if (perm.status !== PERMISSION_STATUS.GRANTED) {
    throw ApiError.conflict(`This permission is already ${perm.status.toLowerCase()}.`, 'INVALID_STATUS_TRANSITION');
  }
  return perm;
}

/** GET /api/permissions/:permissionId/revoke/prepare — what to sign (or that no transaction is needed). */
async function prepareRevoke(req, res) {
  const perm = await loadOwnGrantedPermission(req);
  const activeOnChain = perm.blockchainTransactionHash ? await chain.hasAccess(perm.recordId, perm.doctorId) : false;
  if (!activeOnChain) return res.json({ success: true, data: { needsChainTx: false } });
  const wallet = await requireLinkedWallet(req);
  const cfg = chain.publicConfig();
  return res.json({ success: true, data: {
    needsChainTx: true, contractAddress: cfg.contractAddress, chainId: cfg.chainId, wallet,
    method: 'revokeAccess', args: [chain.recordKey(perm.recordId), chain.doctorKey(perm.doctorId)],
  } });
}

/**
 * PATCH /api/permissions/:permissionId/revoke  { txHash? }
 * If the grant is active on-chain, a verified AccessRevoked transaction from the patient's wallet is required.
 */
async function revoke(req, res) {
  const perm = await loadOwnGrantedPermission(req);
  const txHash = String((req.body || {}).txHash || '').toLowerCase();
  let verified = null;
  const activeOnChain = perm.blockchainTransactionHash ? await chain.hasAccess(perm.recordId, perm.doctorId) : false;
  if (activeOnChain || txHash) {
    if (!txHash) throw ApiError.badRequest('Revoking this access requires a blockchain transaction signed in MetaMask.', 'TX_REQUIRED');
    const wallet = await requireLinkedWallet(req);
    verified = await chain.verifyRevokeTx(txHash, { recordId: perm.recordId, doctorId: perm.doctorId, wallet });
    if (await chain.hasAccess(perm.recordId, perm.doctorId)) {
      throw ApiError.conflict('The blockchain still shows this access as active.', 'BLOCKCHAIN_STATE_MISMATCH');
    }
  }
  const updated = await AccessPermission.findOneAndUpdate(
    { _id: perm._id, status: PERMISSION_STATUS.GRANTED },
    { status: PERMISSION_STATUS.REVOKED, revokedAt: new Date(), ...(verified ? { revokeTransactionHash: verified.txHash.toLowerCase() } : {}) },
    { returnDocument: 'after' }
  );
  if (!updated) throw ApiError.conflict('Permission changed concurrently. Refresh and try again.', 'CONCURRENT_UPDATE');

  await logAudit({
    req, action: 'ACCESS_REVOKED', patientId: req.user._id, doctorId: perm.doctorId, recordId: perm.recordId,
    ...(verified ? { blockchainTransactionHash: verified.txHash } : {}),
    metadata: { scope: 'RECORD', permissionId: String(perm._id), onChain: Boolean(verified) },
  });
  const populated = await populateAll(AccessPermission.findById(perm._id)).lean();
  res.json({ success: true, data: { permission: toView(populated) } });
}

/** GET /api/permissions?recordId=&doctorId=&status=ACTIVE|EXPIRED|REVOKED — patient's own grants. */
async function listForPatient(req, res) {
  const pg = parsePagination(req.query, { defaultLimit: 50 });
  const filter = { patientId: req.user._id, ...statusFilter(req.query.status) };
  for (const k of ['recordId', 'doctorId']) {
    if (req.query[k]) {
      if (!mongoose.isValidObjectId(req.query[k])) throw ApiError.badRequest(`Invalid ${k}`, 'INVALID_ID');
      filter[k] = req.query[k];
    }
  }
  const [items, total] = await Promise.all([
    populateAll(AccessPermission.find(filter).sort({ grantedAt: -1 }).skip(pg.skip).limit(pg.limit)).lean(),
    AccessPermission.countDocuments(filter),
  ]);
  const now = new Date();
  res.json({ success: true, data: paginated(items.map((p) => toView(p, now)), total, pg) });
}

/**
 * GET /api/permissions/doctor?status= — the doctor's authorised records.
 * Only patients whose relationship is still APPROVED are included.
 */
async function listForDoctor(req, res) {
  const pg = parsePagination(req.query, { defaultLimit: 50 });
  const DoctorPatientRelation = require('../models/DoctorPatientRelation');
  const approvedPatients = await DoctorPatientRelation.find({ doctorId: req.user._id, status: 'APPROVED' }).distinct('patientId');
  const filter = { doctorId: req.user._id, patientId: { $in: approvedPatients }, ...statusFilter(req.query.status) };
  const [items, total] = await Promise.all([
    populateAll(AccessPermission.find(filter).sort({ grantedAt: -1 }).skip(pg.skip).limit(pg.limit)).lean(),
    AccessPermission.countDocuments(filter),
  ]);
  const now = new Date();
  res.json({ success: true, data: paginated(items.map((p) => toView(p, now)), total, pg) });
}

module.exports = { prepareGrant, grant, prepareRevoke, revoke, listForPatient, listForDoctor, toView, requireLinkedWallet };

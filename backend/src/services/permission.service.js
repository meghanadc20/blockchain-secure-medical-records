'use strict';
/**
 * Record-level, time-limited access permissions (Module 4).
 *
 * A doctor may read a patient's record only when ALL hold:
 *   1. the doctor is verified (checked by route middleware),
 *   2. the doctor–patient relationship is APPROVED,
 *   3. a permission for (record, doctor) has status GRANTED,
 *   4. expiresAt is in the future.
 * Expiry is enforced at the moment of access (not only by the periodic sweep), so access ends
 * exactly when the permission expires. Revocation takes effect on the next request.
 */
const AccessPermission = require('../models/AccessPermission');
const DoctorPatientRelation = require('../models/DoctorPatientRelation');
const { PERMISSION_STATUS } = require('../utils/constants');
const { logAudit } = require('./audit.service');

/** ACTIVE | EXPIRED | REVOKED — what the UI shows. GRANTED-but-past-expiry counts as EXPIRED. */
function effectiveStatus(perm, now = new Date()) {
  if (perm.status === PERMISSION_STATUS.REVOKED) return 'REVOKED';
  if (perm.status === PERMISSION_STATUS.EXPIRED) return 'EXPIRED';
  return new Date(perm.expiresAt) > now ? 'ACTIVE' : 'EXPIRED';
}

/** Marks one GRANTED permission as EXPIRED (idempotent, atomic) and audits it once. */
async function markExpired(perm, { req } = {}) {
  const updated = await AccessPermission.findOneAndUpdate(
    { _id: perm._id, status: PERMISSION_STATUS.GRANTED, expiresAt: { $lte: new Date() } },
    { status: PERMISSION_STATUS.EXPIRED },
    { returnDocument: 'after' }
  ).lean();
  if (updated) {
    await logAudit({
      ...(req ? { req } : { system: true }),
      action: 'ACCESS_EXPIRED', patientId: perm.patientId, doctorId: perm.doctorId, recordId: perm.recordId,
      metadata: { permissionId: String(perm._id), expiresAt: perm.expiresAt, detectedBy: req ? 'ACCESS_CHECK' : 'SWEEP' },
    });
  }
  return updated;
}

/**
 * Decides whether `doctorId` may read `record` right now.
 * @returns {{ allowed: true, permission } | { allowed: false, code, message, permission? }}
 */
async function checkDoctorRecordAccess(doctorId, record, { req } = {}) {
  const relationOk = await DoctorPatientRelation.exists({ doctorId, patientId: record.patientId, status: 'APPROVED' });
  if (!relationOk) {
    return { allowed: false, code: 'PERMISSION_DENIED', message: 'This patient has not approved your access.' };
  }

  const live = await AccessPermission.findOne({ recordId: record._id, doctorId, status: PERMISSION_STATUS.GRANTED }).lean();
  if (live) {
    if (new Date(live.expiresAt) > new Date()) return { allowed: true, permission: live };
    await markExpired(live, { req });
    return { allowed: false, code: 'PERMISSION_EXPIRED', message: 'Your access to this record has expired.', permission: live };
  }

  // No live permission — explain why using the most recent one, if any.
  const last = await AccessPermission.findOne({ recordId: record._id, doctorId }).sort({ updatedAt: -1 }).lean();
  if (last && last.status === PERMISSION_STATUS.REVOKED) {
    return { allowed: false, code: 'PERMISSION_REVOKED', message: 'The patient has revoked your access to this record.', permission: last };
  }
  if (last && last.status === PERMISSION_STATUS.EXPIRED) {
    return { allowed: false, code: 'PERMISSION_EXPIRED', message: 'Your access to this record has expired.', permission: last };
  }
  return { allowed: false, code: 'PERMISSION_DENIED', message: 'You do not have permission to access this record.' };
}

/** Periodic sweep: GRANTED permissions past their expiry become EXPIRED (each audited). */
async function expireDuePermissions() {
  const due = await AccessPermission.find({ status: PERMISSION_STATUS.GRANTED, expiresAt: { $lte: new Date() } }).limit(500).lean();
  let count = 0;
  for (const p of due) if (await markExpired(p)) count += 1;
  return count;
}

let timer = null;
function startExpirySweep(intervalMs = 60_000) {
  if (timer) return timer;
  timer = setInterval(() => {
    expireDuePermissions().then((n) => { if (n) console.log(`[permissions] ${n} permission(s) expired`); })
      .catch((e) => console.error('[permissions] expiry sweep failed:', e.message));
  }, intervalMs);
  timer.unref();
  return timer;
}
function stopExpirySweep() { if (timer) clearInterval(timer); timer = null; }

module.exports = { effectiveStatus, checkDoctorRecordAccess, expireDuePermissions, startExpirySweep, stopExpirySweep, markExpired };

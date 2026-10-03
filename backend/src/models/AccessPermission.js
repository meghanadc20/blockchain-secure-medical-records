'use strict';
const { Schema, model } = require('mongoose');
const safeJSON = require('./plugins/safeJSON');
const { PERMISSION_STATUS } = require('../utils/constants');

const TX_HASH = [/^0x[a-f0-9]{64}$/, 'Invalid transaction hash'];

/**
 * Record-level, time-limited permission for one doctor.
 * Created only after the patient's on-chain grant transaction has been verified (Module 5).
 */
const accessPermissionSchema = new Schema(
  {
    recordId: { type: Schema.Types.ObjectId, ref: 'MedicalRecord', required: true },
    patientId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    doctorId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    status: { type: String, enum: Object.values(PERMISSION_STATUS), default: PERMISSION_STATUS.GRANTED, required: true },
    grantedAt: { type: Date, default: Date.now, required: true },
    expiresAt: { type: Date, required: [true, 'Expiration time is required'] },
    revokedAt: { type: Date },
    blockchainTransactionHash: { type: String, lowercase: true, match: TX_HASH }, // grant tx
    revokeTransactionHash: { type: String, lowercase: true, match: TX_HASH },     // approved addition
  },
  { timestamps: true, collection: 'accessPermissions' }
);

accessPermissionSchema.path('expiresAt').validate(function validateExpiry(value) {
  return !this.grantedAt || value > this.grantedAt;
}, 'Expiration time must be after the grant time');

/** True only if GRANTED and not yet past expiresAt (expiry is enforced even before status is updated). */
accessPermissionSchema.methods.isActive = function isActive(now = new Date()) {
  return this.status === PERMISSION_STATUS.GRANTED && this.expiresAt > now;
};

// At most one live GRANTED permission per doctor per record.
accessPermissionSchema.index(
  { recordId: 1, doctorId: 1 },
  { unique: true, partialFilterExpression: { status: PERMISSION_STATUS.GRANTED } }
);
accessPermissionSchema.index({ doctorId: 1, status: 1, expiresAt: 1 });
accessPermissionSchema.index({ patientId: 1, status: 1 });

accessPermissionSchema.plugin(safeJSON);

module.exports = model('AccessPermission', accessPermissionSchema);

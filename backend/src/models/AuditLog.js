'use strict';
const { Schema, model } = require('mongoose');
const safeJSON = require('./plugins/safeJSON');
const { ROLES, AUDIT_ACTIONS } = require('../utils/constants');

/**
 * Append-only audit trail. Updates and deletes are blocked at the model level.
 * `metadata` must never contain medical content (diagnosis text, file bytes, passwords).
 */
const auditLogSchema = new Schema(
  {
    actorId: { type: Schema.Types.ObjectId, ref: 'User' }, // null for anonymous events (e.g. failed login)
    actorRole: { type: String, enum: [...Object.values(ROLES), 'ANONYMOUS'], required: true },
    action: { type: String, enum: AUDIT_ACTIONS, required: true },
    patientId: { type: Schema.Types.ObjectId, ref: 'User' },
    doctorId: { type: Schema.Types.ObjectId, ref: 'User' },
    recordId: { type: Schema.Types.ObjectId, ref: 'MedicalRecord' },
    timestamp: { type: Date, default: Date.now, required: true, immutable: true },
    ipAddress: { type: String },
    blockchainTransactionHash: { type: String, lowercase: true },
    metadata: { type: Schema.Types.Mixed, default: {} },
  },
  { collection: 'auditLogs' }
);

auditLogSchema.index({ patientId: 1, timestamp: -1 });
auditLogSchema.index({ actorId: 1, timestamp: -1 });
auditLogSchema.index({ recordId: 1, timestamp: -1 });
auditLogSchema.index({ action: 1, timestamp: -1 });

function blockMutation() {
  throw new Error('Audit logs are append-only');
}
auditLogSchema.pre(
  ['updateOne', 'updateMany', 'findOneAndUpdate', 'replaceOne', 'findOneAndReplace',
    'deleteOne', 'deleteMany', 'findOneAndDelete'],
  blockMutation
);
auditLogSchema.pre('save', function preventResave() {
  if (!this.isNew) throw new Error('Audit logs are append-only');
});

auditLogSchema.plugin(safeJSON);

module.exports = model('AuditLog', auditLogSchema);

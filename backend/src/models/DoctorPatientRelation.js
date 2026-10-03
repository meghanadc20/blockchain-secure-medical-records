'use strict';
const { Schema, model } = require('mongoose');
const safeJSON = require('./plugins/safeJSON');
const { RELATION_STATUS } = require('../utils/constants');

/**
 * A doctor's access request for a patient (patient-level).
 * Record-level, time-limited access is stored separately in accessPermissions.
 * One document per doctor–patient pair; a new request after REJECTED/REVOKED reuses it.
 */
const relationSchema = new Schema(
  {
    doctorId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    patientId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    status: { type: String, enum: Object.values(RELATION_STATUS), default: RELATION_STATUS.PENDING, required: true },
    requestedAt: { type: Date, default: Date.now, required: true },
    approvedAt: { type: Date },
    revokedAt: { type: Date },
  },
  { timestamps: true, collection: 'doctorPatientRelations' }
);

relationSchema.index({ doctorId: 1, patientId: 1 }, { unique: true });
relationSchema.index({ patientId: 1, status: 1 });
relationSchema.index({ doctorId: 1, status: 1 });

relationSchema.plugin(safeJSON);

module.exports = model('DoctorPatientRelation', relationSchema);

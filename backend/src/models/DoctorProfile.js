'use strict';
const { Schema, model } = require('mongoose');
const safeJSON = require('./plugins/safeJSON');
const { VERIFICATION_STATUS } = require('../utils/constants');

const doctorProfileSchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    specialization: { type: String, required: [true, 'Specialization is required'], trim: true, maxlength: 100 },
    licenseNumber: { type: String, required: [true, 'License number is required'], trim: true, uppercase: true, maxlength: 50 },
    hospital: { type: String, required: [true, 'Hospital is required'], trim: true, maxlength: 150 },
    verificationStatus: {
      type: String, enum: Object.values(VERIFICATION_STATUS), default: VERIFICATION_STATUS.PENDING, required: true,
    },
    verifiedAt: { type: Date },
  },
  { timestamps: true, collection: 'doctorProfiles' }
);

doctorProfileSchema.index({ userId: 1 }, { unique: true });          // one profile per doctor
doctorProfileSchema.index({ licenseNumber: 1 }, { unique: true });   // a licence can't be registered twice
doctorProfileSchema.index({ verificationStatus: 1, createdAt: -1 }); // admin queues

doctorProfileSchema.plugin(safeJSON);

module.exports = model('DoctorProfile', doctorProfileSchema);

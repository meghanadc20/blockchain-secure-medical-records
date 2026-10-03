'use strict';
const { Schema, model } = require('mongoose');
const safeJSON = require('./plugins/safeJSON');

const consultationSchema = new Schema(
  {
    patientId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    doctorId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    recordId: { type: Schema.Types.ObjectId, ref: 'MedicalRecord' }, // optional link to a related record
    consultationDate: { type: Date, required: [true, 'Consultation date is required'] },
    diagnosis: { type: String, trim: true, maxlength: 5000 },
    prescription: { type: String, trim: true, maxlength: 5000 },
    treatmentNotes: { type: String, trim: true, maxlength: 10000 },
  },
  { timestamps: true, collection: 'consultations' }
);

consultationSchema.index({ patientId: 1, consultationDate: -1 });
consultationSchema.index({ doctorId: 1, consultationDate: -1 });

consultationSchema.plugin(safeJSON);

module.exports = model('Consultation', consultationSchema);

'use strict';
const { Schema, model } = require('mongoose');
const safeJSON = require('./plugins/safeJSON');
const { RECORD_TYPES } = require('../utils/constants');

/**
 * Medical-record METADATA. The file itself lives (encrypted) in Supabase Storage at `storagePath`.
 * File fields are filled in by the upload service (Module 3).
 */
const medicalRecordSchema = new Schema(
  {
    patientId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    uploadedBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    title: { type: String, required: [true, 'Title is required'], trim: true, maxlength: 150 },
    recordType: { type: String, enum: RECORD_TYPES, required: [true, 'Record type is required'] },
    description: { type: String, trim: true, maxlength: 2000 },

    fileName: { type: String, trim: true, maxlength: 255 },
    storagePath: { type: String, trim: true },
    mimeType: { type: String, trim: true },
    fileSize: { type: Number, min: 0 },
    // SHA-256 of the ORIGINAL (unencrypted) file, hex.
    sha256Hash: { type: String, lowercase: true, match: [/^[a-f0-9]{64}$/, 'Invalid SHA-256 hash'] },

    // Approved additions — AES-256-GCM parameters (not secret on their own, but never sent to clients).
    encryptionIv: { type: String, select: false },
    encryptionAuthTag: { type: String, select: false },
    // Approved addition — tx that anchored sha256Hash on-chain (Module 6).
    blockchainTransactionHash: { type: String, lowercase: true, match: [/^0x[a-f0-9]{64}$/, 'Invalid transaction hash'] },
  },
  { timestamps: true, collection: 'medicalRecords' }
);

medicalRecordSchema.index({ patientId: 1, createdAt: -1 }); // patient history timeline
medicalRecordSchema.index({ uploadedBy: 1 });
medicalRecordSchema.index({ storagePath: 1 }, { unique: true, sparse: true });

medicalRecordSchema.plugin(safeJSON, { hidden: ['encryptionIv', 'encryptionAuthTag', 'storagePath'] });

module.exports = model('MedicalRecord', medicalRecordSchema);

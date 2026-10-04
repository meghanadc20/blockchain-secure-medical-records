'use strict';
/** Shared shaping for medical-record metadata. Storage details never leave the server. */

function toRecordView(rec, { uploader } = {}) {
  const up = uploader || (rec.uploadedBy && rec.uploadedBy.name ? rec.uploadedBy : null);
  return {
    id: String(rec._id),
    patientId: String(rec.patientId && rec.patientId._id ? rec.patientId._id : rec.patientId),
    title: rec.title,
    recordType: rec.recordType,
    description: rec.description || '',
    fileName: rec.fileName || null,
    mimeType: rec.mimeType || null,
    fileSize: rec.fileSize ?? null,
    hasFile: Boolean(rec.storagePath),
    sha256Hash: rec.sha256Hash || null,
    blockchainTransactionHash: rec.blockchainTransactionHash || null,
    uploadedBy: up
      ? { id: String(up._id), name: up.name, role: up.role }
      : { id: String(rec.uploadedBy) },
    createdAt: rec.createdAt,
    updatedAt: rec.updatedAt,
  };
}

module.exports = { toRecordView };

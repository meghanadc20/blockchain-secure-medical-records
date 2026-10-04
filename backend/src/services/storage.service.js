'use strict';
/**
 * Supabase Storage wrapper. Objects are already encrypted before they reach this layer.
 * Object key layout (inside the private bucket): {patientId}/{recordId}/encrypted-file
 * The service is an object so tests can substitute individual methods to simulate failures.
 */
const { getSupabase } = require('../config/supabase');
const { env } = require('../config/env');
const ApiError = require('../utils/ApiError');

function storageError(op, err) {
  console.error(`[storage] ${op} failed:`, err && err.message ? err.message : err);
  return new ApiError(502, 'Secure file storage is unavailable. Please try again later.', 'STORAGE_ERROR');
}

const storage = {
  bucket() { return env.supabaseBucket; },

  objectKey(patientId, recordId) { return `${patientId}/${recordId}/encrypted-file`; },

  async upload(key, encryptedBuffer) {
    const { error } = await getSupabase().storage.from(this.bucket())
      .upload(key, encryptedBuffer, { contentType: 'application/octet-stream', upsert: false, cacheControl: 'no-store' });
    if (error) throw storageError('upload', error);
  },

  async download(key) {
    const { data, error } = await getSupabase().storage.from(this.bucket()).download(key);
    if (error) {
      if (/not.?found|404/i.test(`${error.message} ${error.statusCode || ''}`)) {
        throw new ApiError(404, 'The stored file could not be found.', 'FILE_NOT_FOUND');
      }
      throw storageError('download', error);
    }
    return Buffer.from(await data.arrayBuffer());
  },

  async remove(key) {
    const { error } = await getSupabase().storage.from(this.bucket()).remove([key]);
    if (error) throw storageError('remove', error);
  },
};

module.exports = storage;

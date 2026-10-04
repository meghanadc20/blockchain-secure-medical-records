'use strict';
/**
 * File encryption at rest: AES-256-GCM (authenticated encryption).
 * A fresh random 96-bit IV is used for every file; the 128-bit auth tag detects any change to the
 * stored ciphertext. Encryption protects confidentiality; SHA-256 hashing (hash.service) is a
 * separate integrity fingerprint and is NOT encryption.
 */
const crypto = require('crypto');
const { env } = require('../config/env');
const ApiError = require('../utils/ApiError');

const ALGORITHM = 'aes-256-gcm';

function getKey() {
  const hex = String(env.fileEncryptionKey || '').trim();
  if (!/^[0-9a-fA-F]{64}$/.test(hex)) {
    throw new Error('FILE_ENCRYPTION_KEY must be 64 hex characters (32 bytes)');
  }
  return Buffer.from(hex, 'hex');
}

/** @returns {{ ciphertext: Buffer, iv: string, authTag: string }} iv/authTag base64 */
function encryptBuffer(plain) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv(ALGORITHM, getKey(), iv);
  const ciphertext = Buffer.concat([cipher.update(plain), cipher.final()]);
  return { ciphertext, iv: iv.toString('base64'), authTag: cipher.getAuthTag().toString('base64') };
}

/** Throws ApiError FILE_INTEGRITY_FAILED if the ciphertext, IV or tag were altered. */
function decryptBuffer(ciphertext, ivB64, authTagB64) {
  try {
    const decipher = crypto.createDecipheriv(ALGORITHM, getKey(), Buffer.from(ivB64, 'base64'));
    decipher.setAuthTag(Buffer.from(authTagB64, 'base64'));
    return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  } catch (err) {
    const e = new ApiError(409, 'The stored file failed its integrity check and was not returned.', 'FILE_INTEGRITY_FAILED');
    e.cause = err;
    throw e;
  }
}

module.exports = { encryptBuffer, decryptBuffer, ALGORITHM };

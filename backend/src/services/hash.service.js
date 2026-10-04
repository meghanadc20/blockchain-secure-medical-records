'use strict';
const crypto = require('crypto');

/** SHA-256 fingerprint (hex) of the ORIGINAL, unencrypted file. Hashing is not encryption. */
function sha256Hex(buffer) {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

module.exports = { sha256Hex };

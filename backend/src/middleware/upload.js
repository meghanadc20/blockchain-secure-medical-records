'use strict';
const multer = require('multer');
const ApiError = require('../utils/ApiError');

const MAX_FILE_BYTES = 10 * 1024 * 1024; // 10 MB

/** Allowed types. The declared MIME type is checked here; the real content is checked by magic bytes later. */
const ALLOWED = {
  'application/pdf': { ext: 'pdf', magic: (b) => b.length >= 5 && b.subarray(0, 5).toString('latin1') === '%PDF-' },
  'image/png': { ext: 'png', magic: (b) => b.length >= 8 && b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) },
  'image/jpeg': { ext: 'jpg', magic: (b) => b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
};

const singleFile = multer({
  storage: multer.memoryStorage(), // never written to the server's disk
  limits: { fileSize: MAX_FILE_BYTES, files: 1, fields: 10, fieldSize: 10 * 1024 },
  fileFilter(req, file, cb) {
    if (!ALLOWED[file.mimetype]) {
      return cb(ApiError.badRequest('Only PDF, JPEG and PNG files are allowed.', 'UNSUPPORTED_FILE_TYPE'));
    }
    return cb(null, true);
  },
}).single('file');

/** Wraps multer so its errors become consistent API errors. */
function uploadSingleFile(req, res, next) {
  singleFile(req, res, (err) => {
    if (!err) return next();
    if (err instanceof ApiError) return next(err);
    if (err.code === 'LIMIT_FILE_SIZE') return next(new ApiError(413, 'File is too large. The maximum size is 10 MB.', 'FILE_TOO_LARGE'));
    if (err.code === 'LIMIT_UNEXPECTED_FILE' || err.code === 'LIMIT_FILE_COUNT') return next(ApiError.badRequest('Upload exactly one file in the "file" field.', 'INVALID_UPLOAD'));
    return next(ApiError.badRequest('The upload could not be processed.', 'INVALID_UPLOAD'));
  });
}

/** True when the bytes really are the declared type (prevents renamed executables etc.). */
function contentMatchesType(buffer, mimetype) {
  return Boolean(ALLOWED[mimetype] && ALLOWED[mimetype].magic(buffer));
}

module.exports = { uploadSingleFile, contentMatchesType, MAX_FILE_BYTES, ALLOWED_TYPES: Object.keys(ALLOWED) };

'use strict';
const ApiError = require('../utils/ApiError');
const { env } = require('../config/env');

/** 404 for unknown API routes. */
function notFoundApi(req, res, next) {
  next(ApiError.notFound(`Route not found: ${req.method} ${req.originalUrl}`, 'ROUTE_NOT_FOUND'));
}

/**
 * Central error handler. Returns predictable JSON:
 *   { success: false, error: { code, message, details? } }
 * Stack traces and internal messages are never sent to clients.
 */
// eslint-disable-next-line no-unused-vars
function errorHandler(err, req, res, next) {
  let status = 500;
  let code = 'INTERNAL_ERROR';
  let message = 'Something went wrong. Please try again later.';
  let details;

  if (err instanceof ApiError) {
    ({ statusCode: status, message, details } = err);
    code = err.code || code;
  } else if (err && err.type === 'entity.parse.failed') {
    status = 400; code = 'INVALID_JSON'; message = 'Request body is not valid JSON';
  } else if (err && err.type === 'entity.too.large') {
    status = 413; code = 'PAYLOAD_TOO_LARGE'; message = 'Request body is too large';
  }

  if (status >= 500) {
    // Log server-side only (no request bodies — they may contain medical data or passwords).
    console.error(`[error] ${req.method} ${req.originalUrl}:`, env.nodeEnv === 'production' ? err.message : err);
  }

  res.status(status).json({ success: false, error: { code, message, ...(details ? { details } : {}) } });
}

module.exports = { notFoundApi, errorHandler };

'use strict';
/** Operational error with an HTTP status and a safe, user-facing message. */
class ApiError extends Error {
  constructor(statusCode, message, code = undefined, details = undefined) {
    super(message);
    this.name = 'ApiError';
    this.statusCode = statusCode;
    this.code = code; // machine-readable, e.g. PERMISSION_EXPIRED
    this.details = details;
  }

  static badRequest(msg = 'Bad request', code = 'BAD_REQUEST', details) { return new ApiError(400, msg, code, details); }
  static unauthorized(msg = 'Authentication required', code = 'UNAUTHORIZED') { return new ApiError(401, msg, code); }
  static forbidden(msg = 'Access denied', code = 'FORBIDDEN') { return new ApiError(403, msg, code); }
  static notFound(msg = 'Resource not found', code = 'NOT_FOUND') { return new ApiError(404, msg, code); }
  static conflict(msg = 'Conflict', code = 'CONFLICT') { return new ApiError(409, msg, code); }
}

module.exports = ApiError;

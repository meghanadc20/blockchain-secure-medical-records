'use strict';
const mongoose = require('mongoose');
const ApiError = require('../utils/ApiError');

/** Rejects malformed ObjectId route params with 400 before they reach a query. */
function validateId(...params) {
  return function checkIds(req, res, next) {
    for (const p of params) {
      if (!mongoose.isValidObjectId(req.params[p])) {
        throw ApiError.badRequest(`Invalid ${p}`, 'INVALID_ID');
      }
    }
    next();
  };
}

module.exports = { validateId };

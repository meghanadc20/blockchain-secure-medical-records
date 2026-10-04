'use strict';
const ApiError = require('../utils/ApiError');

/**
 * Minimal in-memory fixed-window rate limiter (no extra dependency).
 * Suitable for a single server instance; used to slow down password guessing.
 */
function rateLimit({ windowMs, max, keyFn = (req) => req.ip, message = 'Too many attempts. Please try again later.', skip = () => false }) {
  const hits = new Map();
  const timer = setInterval(() => {
    const now = Date.now();
    for (const [key, entry] of hits) if (entry.resetAt <= now) hits.delete(key);
  }, windowMs);
  timer.unref();

  return function limiter(req, res, next) {
    if (skip(req)) return next();
    const key = keyFn(req);
    const now = Date.now();
    let entry = hits.get(key);
    if (!entry || entry.resetAt <= now) {
      entry = { count: 0, resetAt: now + windowMs };
      hits.set(key, entry);
    }
    entry.count += 1;
    if (entry.count > max) {
      res.setHeader('Retry-After', Math.ceil((entry.resetAt - now) / 1000));
      throw new ApiError(429, message, 'TOO_MANY_REQUESTS');
    }
    next();
  };
}

module.exports = { rateLimit };

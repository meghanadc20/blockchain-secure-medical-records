'use strict';
/**
 * Small, dependency-free input validation helpers.
 * Each rule returns an error message string, or null when valid.
 */
const mongoose = require('mongoose');

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PHONE_RE = /^\+?[0-9\s-]{7,20}$/;

const rules = {
  required: (v, label) => (v === undefined || v === null || String(v).trim() === '' ? `${label} is required` : null),
  string: (v, label) => (v !== undefined && typeof v !== 'string' ? `${label} must be text` : null),
  maxLength: (n) => (v, label) => (typeof v === 'string' && v.trim().length > n ? `${label} must be at most ${n} characters` : null),
  minLength: (n) => (v, label) => (typeof v === 'string' && v.trim().length < n ? `${label} must be at least ${n} characters` : null),
  email: (v, label) => (typeof v === 'string' && v && !EMAIL_RE.test(v.trim()) ? `${label} is not a valid email address` : null),
  phone: (v, label) => (typeof v === 'string' && v && !PHONE_RE.test(v.trim()) ? `${label} is not a valid phone number` : null),
  password: (v, label) => {
    if (typeof v !== 'string') return null;
    if (v.length < 8) return `${label} must be at least 8 characters`;
    if (v.length > 72) return `${label} must be at most 72 characters`; // bcrypt limit
    if (!/[A-Za-z]/.test(v) || !/[0-9]/.test(v)) return `${label} must contain letters and numbers`;
    return null;
  },
  objectId: (v, label) => (v && !mongoose.isValidObjectId(v) ? `${label} is not a valid id` : null),
  oneOf: (values) => (v, label) => (v !== undefined && v !== '' && !values.includes(v) ? `${label} must be one of: ${values.join(', ')}` : null),
  date: (v, label) => (v !== undefined && v !== '' && Number.isNaN(new Date(v).getTime()) ? `${label} is not a valid date` : null),
};

/**
 * Validates `data` against a schema { field: { label, rules: [...] } }.
 * Returns an array of { field, message } (empty when valid).
 */
function validate(data, schema) {
  const errors = [];
  for (const [field, { label = field, rules: fieldRules }] of Object.entries(schema)) {
    for (const rule of fieldRules) {
      const message = rule(data ? data[field] : undefined, label);
      if (message) { errors.push({ field, message }); break; }
    }
  }
  return errors;
}

/** Returns a trimmed string or undefined (never passes objects through — prevents NoSQL operator injection). */
function cleanString(v) {
  return typeof v === 'string' ? v.trim() : undefined;
}

module.exports = { rules, validate, cleanString };

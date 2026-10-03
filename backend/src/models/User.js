'use strict';
const { Schema, model } = require('mongoose');
const safeJSON = require('./plugins/safeJSON');
const { ROLES } = require('../utils/constants');

const userSchema = new Schema(
  {
    name: { type: String, required: [true, 'Name is required'], trim: true, minlength: 2, maxlength: 100 },
    email: {
      type: String, required: [true, 'Email is required'], trim: true, lowercase: true, maxlength: 254,
      match: [/^[^\s@]+@[^\s@]+\.[^\s@]+$/, 'Email is invalid'],
    },
    passwordHash: { type: String, required: true, select: false }, // bcrypt hash only — never plaintext
    role: { type: String, enum: Object.values(ROLES), required: true },
    phone: { type: String, trim: true, maxlength: 20 },
    // Approved addition (hybrid signing): patient's MetaMask address, lower-cased.
    walletAddress: { type: String, trim: true, lowercase: true, match: [/^0x[a-f0-9]{40}$/, 'Invalid wallet address'] },
  },
  { timestamps: true, collection: 'users' }
);

userSchema.index({ email: 1 }, { unique: true });
userSchema.index({ walletAddress: 1 }, { unique: true, sparse: true });
userSchema.index({ role: 1 });

userSchema.plugin(safeJSON, { hidden: ['passwordHash'] });

module.exports = model('User', userSchema);

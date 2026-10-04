'use strict';
/**
 * Creates the internal ADMIN account from ADMIN_NAME / ADMIN_EMAIL / ADMIN_PASSWORD in .env.
 * There is no public admin registration — this script is the only way to create an admin.
 *
 *   npm run seed:admin                    create if missing (existing admin is left unchanged)
 *   npm run seed:admin -- --reset-password  also reset the existing admin's password from .env
 */
const bcrypt = require('bcryptjs');
const { env } = require('../src/config/env');
const { connectDB, disconnectDB } = require('../src/config/db');
const User = require('../src/models/User');
const { ROLES } = require('../src/utils/constants');
const { rules, validate } = require('../src/utils/validators');

const clean = (v) => (typeof v === 'string' ? v.trim() : v);

(async () => {
  const name = clean(process.env.ADMIN_NAME);
  const email = clean(process.env.ADMIN_EMAIL || '').toLowerCase();
  const password = process.env.ADMIN_PASSWORD;
  const reset = process.argv.includes('--reset-password');

  const errors = validate({ name, email, password }, {
    name: { label: 'ADMIN_NAME', rules: [rules.required, rules.minLength(2)] },
    email: { label: 'ADMIN_EMAIL', rules: [rules.required, rules.email] },
    password: { label: 'ADMIN_PASSWORD', rules: [rules.required, rules.password] },
  });
  if (errors.length) {
    console.error('Cannot seed admin:\n' + errors.map((e) => `  - ${e.message}`).join('\n'));
    process.exit(1);
  }

  try {
    await connectDB();
    const existing = await User.findOne({ email });
    if (existing && existing.role !== ROLES.ADMIN) {
      throw new Error(`${email} already belongs to a ${existing.role} account. Use a different ADMIN_EMAIL.`);
    }
    if (existing && !reset) {
      console.log(`Admin ${email} already exists — nothing changed. (Use --reset-password to update the password.)`);
    } else if (existing) {
      existing.passwordHash = await bcrypt.hash(password, env.bcryptRounds);
      existing.name = name;
      await existing.save();
      console.log(`Admin ${email} password reset.`);
    } else {
      await User.create({ name, email, role: ROLES.ADMIN, passwordHash: await bcrypt.hash(password, env.bcryptRounds) });
      console.log(`Admin ${email} created.`);
    }
  } catch (err) {
    console.error('Seed failed:', err.message);
    process.exitCode = 1;
  } finally {
    await disconnectDB();
  }
})();

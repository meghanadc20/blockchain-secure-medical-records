'use strict';
// Must be required FIRST in every test file (before any src/ module reads the environment).
process.env.NODE_ENV = 'test';
process.env.BCRYPT_ROUNDS = '4'; // fast hashing in tests only

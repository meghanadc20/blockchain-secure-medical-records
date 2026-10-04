'use strict';
// Must be required FIRST in every test file (before any src/ module reads the environment).
process.env.NODE_ENV = 'test';
process.env.BCRYPT_ROUNDS = '4'; // fast hashing in tests only
process.env.SUPABASE_BUCKET = 'medical-records-test'; // never touch the real bucket from tests
// Never touch the developer's real local chain from tests: blockchain tests start their own
// throw-away Ganache instance (tests/chain.js) and set these.
process.env.BLOCKCHAIN_RPC_URL = '';
process.env.CONTRACT_ADDRESS = '';
process.env.PRIVATE_KEY = '';
process.env.CHAIN_ID = '1337';

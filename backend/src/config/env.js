'use strict';
/**
 * Loads and validates environment variables from the project-root .env file.
 * Secrets are never logged — only the NAMES of missing variables.
 */
const path = require('path');
const dotenv = require('dotenv');

dotenv.config({ path: path.resolve(__dirname, '../../../.env'), quiet: true });

const env = {
  nodeEnv: process.env.NODE_ENV || 'development',
  port: Number(process.env.PORT) || 5000,
  corsOrigin: process.env.CORS_ORIGIN || 'http://localhost:5000',

  mongoUri: process.env.MONGO_URI,
  mongoDbName: process.env.MONGO_DB_NAME || 'medical_data_sharing',

  jwtSecret: process.env.JWT_SECRET,
  jwtExpiresIn: process.env.JWT_EXPIRES_IN || '2h',
  bcryptRounds: Math.min(Math.max(Number(process.env.BCRYPT_ROUNDS) || 12, 4), 15),

  supabaseUrl: process.env.SUPABASE_URL,
  supabaseAnonKey: process.env.SUPABASE_ANON_KEY,
  supabaseServiceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY,
  supabaseBucket: process.env.SUPABASE_BUCKET || 'medical-records',

  fileEncryptionKey: process.env.FILE_ENCRYPTION_KEY,

  blockchainRpcUrl: process.env.BLOCKCHAIN_RPC_URL,
  chainId: Number(process.env.CHAIN_ID) || 1337,
  contractAddress: process.env.CONTRACT_ADDRESS,
  privateKey: process.env.PRIVATE_KEY,
};

/**
 * Variables grouped by the phase that first needs them.
 * requireEnv(['database','auth']) throws if any variable in those groups is missing.
 */
const GROUPS = {
  database: ['MONGO_URI'],
  auth: ['JWT_SECRET'],
  storage: ['SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY', 'FILE_ENCRYPTION_KEY'],
  blockchain: ['BLOCKCHAIN_RPC_URL', 'CONTRACT_ADDRESS', 'PRIVATE_KEY'],
};

/** A variable counts as missing if empty or still holding a <placeholder> from .env.example. */
function isSet(name) {
  const v = process.env[name];
  return Boolean(v && v.trim() && !/<[^>]+>/.test(v));
}

function missingVars(groups = Object.keys(GROUPS)) {
  return groups.flatMap((g) => GROUPS[g] || []).filter((name) => !isSet(name));
}

function requireEnv(groups) {
  const missing = missingVars(groups);
  if (missing.length) {
    throw new Error(`Missing required environment variables: ${missing.join(', ')}`);
  }
}

/** Returns { group: true|false } without revealing any values. */
function envStatus() {
  return Object.fromEntries(
    Object.keys(GROUPS).map((g) => [g, missingVars([g]).length === 0])
  );
}

module.exports = { env, requireEnv, missingVars, envStatus };

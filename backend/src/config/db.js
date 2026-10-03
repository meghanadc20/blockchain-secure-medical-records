'use strict';
const mongoose = require('mongoose');
const { env, requireEnv } = require('./env');

mongoose.set('strictQuery', true);

/**
 * Connects to MongoDB. Never logs the connection string (it contains credentials).
 * @param {{ dbName?: string }} [opts] override database name (used by tests)
 */
async function connectDB(opts = {}) {
  requireEnv(['database']);
  const dbName = opts.dbName || env.mongoDbName;

  mongoose.connection.on('disconnected', () => console.warn('[db] MongoDB disconnected'));
  mongoose.connection.on('reconnected', () => console.log('[db] MongoDB reconnected'));
  mongoose.connection.on('error', (err) => console.error('[db] MongoDB error:', err.message));

  await mongoose.connect(env.mongoUri, {
    dbName,
    serverSelectionTimeoutMS: 20000,
    autoIndex: env.nodeEnv !== 'production', // production: run `npm run db:indexes`
  });
  console.log(`[db] Connected to MongoDB (database: ${dbName})`);
  return mongoose.connection;
}

async function disconnectDB() {
  await mongoose.disconnect();
}

/** 'connected' | 'connecting' | 'disconnected' | 'disconnecting' */
function dbState() {
  return ['disconnected', 'connected', 'connecting', 'disconnecting'][mongoose.connection.readyState] || 'unknown';
}

module.exports = { connectDB, disconnectDB, dbState };

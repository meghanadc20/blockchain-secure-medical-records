'use strict';
/** Shared test helpers: connect to an isolated *_test database and drop it afterwards. */
const mongoose = require('mongoose');
const { env } = require('../src/config/env');
const { connectDB, disconnectDB } = require('../src/config/db');

const TEST_DB = `${env.mongoDbName}_test`;

/** Drops every collection (the Atlas user has readWrite, which allows dropCollection but not dropDatabase). */
async function clearTestDB() {
  const collections = await mongoose.connection.db.listCollections().toArray();
  for (const { name } of collections) await mongoose.connection.db.dropCollection(name);
}

async function setupTestDB() {
  if (!TEST_DB.endsWith('_test')) throw new Error('Refusing to run tests against a non-test database');
  await connectDB({ dbName: TEST_DB });
  await clearTestDB();
  const models = require('../src/models');
  for (const Model of Object.values(models)) await Model.syncIndexes();
  return models;
}

async function teardownTestDB() {
  if (mongoose.connection.readyState === 1) await clearTestDB();
  await disconnectDB();
}

module.exports = { setupTestDB, teardownTestDB, clearTestDB, TEST_DB };

/** Starts an HTTP server for `app` on a random port. Returns { url, close }. */
function startServer(app) {
  return new Promise((resolve) => {
    const server = app.listen(0, () => {
      const { port } = server.address();
      resolve({ url: `http://127.0.0.1:${port}`, close: () => new Promise((r) => server.close(r)) });
    });
  });
}

/** fetch wrapper returning { status, body }. */
async function call(url, method, path, { body, token, headers = {} } = {}) {
  const res = await fetch(url + path, {
    method,
    headers: {
      ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...headers,
    },
    body: body === undefined ? undefined : (typeof body === 'string' ? body : JSON.stringify(body)),
  });
  let json = null;
  try { json = await res.json(); } catch { /* not JSON */ }
  return { status: res.status, body: json };
}

module.exports.startServer = startServer;
module.exports.call = call;

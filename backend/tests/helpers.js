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

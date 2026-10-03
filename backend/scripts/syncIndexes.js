'use strict';
/** Creates/updates all indexes declared in the models. Usage: npm run db:indexes */
const { connectDB, disconnectDB } = require('../src/config/db');
const models = require('../src/models');

(async () => {
  try {
    await connectDB();
    for (const [name, Model] of Object.entries(models)) {
      await Model.syncIndexes();
      const idx = await Model.collection.indexes();
      console.log(`${name.padEnd(22)} ${idx.map((i) => i.name).join(', ')}`);
    }
  } catch (err) {
    console.error('Index sync failed:', err.message);
    process.exitCode = 1;
  } finally {
    await disconnectDB();
  }
})();

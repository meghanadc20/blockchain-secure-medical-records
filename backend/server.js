'use strict';
const { env, missingVars } = require('./src/config/env');
const { connectDB, disconnectDB } = require('./src/config/db');
const { createApp } = require('./src/app');

async function start() {
  const missing = missingVars();
  if (missing.length) {
    // Names only — values are never printed.
    console.warn(`[config] Not yet configured: ${missing.join(', ')}`);
  }

  await connectDB();

  const app = createApp();
  const server = app.listen(env.port, () => {
    console.log(`[server] Listening on http://localhost:${env.port} (${env.nodeEnv})`);
  });

  const shutdown = (signal) => {
    console.log(`[server] ${signal} received, shutting down`);
    server.close(async () => {
      await disconnectDB();
      process.exit(0);
    });
  };
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

start().catch((err) => {
  console.error('[server] Failed to start:', err.message);
  process.exit(1);
});

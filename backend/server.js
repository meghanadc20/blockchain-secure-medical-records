'use strict';
const { env, missingVars } = require('./src/config/env');
const { createApp } = require('./src/app');

const app = createApp();

const missing = missingVars();
if (missing.length) {
  // Names only — values are never printed.
  console.warn(`[config] Not yet configured: ${missing.join(', ')} (needed by later phases)`);
}

const server = app.listen(env.port, () => {
  console.log(`[server] Listening on http://localhost:${env.port} (${env.nodeEnv})`);
});

function shutdown(signal) {
  console.log(`[server] ${signal} received, shutting down`);
  server.close(() => process.exit(0));
}
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

module.exports = server;

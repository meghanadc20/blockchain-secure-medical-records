'use strict';
const { Router } = require('express');
const { envStatus, env } = require('../config/env');
const { dbState } = require('../config/db');
const chain = require('../services/blockchain.service');

const router = Router();

// In production, cache the chain status briefly so frequent health checks (e.g. Render's)
// don't spend the free RPC quota.
let chainCache = { at: 0, value: null };
async function chainStatus() {
  if (env.nodeEnv !== 'production') return chain.status();
  if (!chainCache.value || Date.now() - chainCache.at > 60000) chainCache = { at: Date.now(), value: await chain.status() };
  return chainCache.value;
}

/** GET /api/health — liveness + which config groups are present (no values). */
router.get('/', async (req, res) => {
  res.json({
    success: true,
    data: {
      status: 'ok',
      database: dbState(),
      blockchain: await chainStatus(),
      environment: env.nodeEnv,
      uptimeSeconds: Math.round(process.uptime()),
      configLoaded: envStatus(),
    },
  });
});

module.exports = router;

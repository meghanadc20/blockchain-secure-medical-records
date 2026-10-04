'use strict';
const { Router } = require('express');
const { envStatus, env } = require('../config/env');
const { dbState } = require('../config/db');
const chain = require('../services/blockchain.service');

const router = Router();

/** GET /api/health — liveness + which config groups are present (no values). */
router.get('/', async (req, res) => {
  res.json({
    success: true,
    data: {
      status: 'ok',
      database: dbState(),
      blockchain: await chain.status(),
      environment: env.nodeEnv,
      uptimeSeconds: Math.round(process.uptime()),
      configLoaded: envStatus(),
    },
  });
});

module.exports = router;

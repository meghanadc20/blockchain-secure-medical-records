'use strict';
const { Router } = require('express');
const { envStatus, env } = require('../config/env');

const router = Router();

/** GET /api/health — liveness + which config groups are present (no values). */
router.get('/', (req, res) => {
  res.json({
    success: true,
    data: {
      status: 'ok',
      environment: env.nodeEnv,
      uptimeSeconds: Math.round(process.uptime()),
      configLoaded: envStatus(),
    },
  });
});

module.exports = router;

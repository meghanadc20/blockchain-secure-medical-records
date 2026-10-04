'use strict';
const { Router } = require('express');
const ctrl = require('../controllers/blockchain.controller');
const { authenticate, authorize } = require('../middleware/auth');
const { ROLES } = require('../utils/constants');

const router = Router();
router.use(authenticate);
router.get('/config', ctrl.getConfig);
router.post('/wallet/challenge', authorize(ROLES.PATIENT), ctrl.walletChallenge);
router.post('/wallet/link', authorize(ROLES.PATIENT), ctrl.walletLink);

module.exports = router;

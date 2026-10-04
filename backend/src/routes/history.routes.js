'use strict';
const { Router } = require('express');
const ctrl = require('../controllers/history.controller');
const { authenticate, authorize } = require('../middleware/auth');
const { ROLES } = require('../utils/constants');

const router = Router();
router.get('/', authenticate, authorize(ROLES.PATIENT), ctrl.patientTimeline);

module.exports = router;

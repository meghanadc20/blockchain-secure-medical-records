'use strict';
const { Router } = require('express');
const ctrl = require('../controllers/audit.controller');
const { authenticate, authorize } = require('../middleware/auth');
const { ROLES } = require('../utils/constants');

const router = Router();
router.use(authenticate, authorize(ROLES.PATIENT));
router.get('/summary', ctrl.summary);
router.get('/', ctrl.listForPatient);

module.exports = router;

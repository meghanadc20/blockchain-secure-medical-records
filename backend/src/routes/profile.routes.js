'use strict';
const { Router } = require('express');
const ctrl = require('../controllers/profile.controller');
const { authenticate } = require('../middleware/auth');

const router = Router();
router.use(authenticate);
router.get('/', ctrl.getProfile);
router.patch('/', ctrl.updateProfile);

module.exports = router;

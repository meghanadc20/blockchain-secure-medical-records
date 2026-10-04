'use strict';
const { Router } = require('express');
const ctrl = require('../controllers/record.controller');
const { authenticate, authorize } = require('../middleware/auth');
const { validateId } = require('../middleware/validateId');
const { ROLES } = require('../utils/constants');

const router = Router();
router.use(authenticate);

// Patient: own records (metadata). Upload/download and doctor access are added in Modules 3–4.
router.get('/', authorize(ROLES.PATIENT), ctrl.listOwn);
router.get('/:recordId', authorize(ROLES.PATIENT), validateId('recordId'), ctrl.getOwn);
router.patch('/:recordId', authorize(ROLES.PATIENT), validateId('recordId'), ctrl.updateOwn);

module.exports = router;

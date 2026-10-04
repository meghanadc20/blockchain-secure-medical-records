'use strict';
const { Router } = require('express');
const ctrl = require('../controllers/permission.controller');
const { authenticate, authorize, requireVerifiedDoctor } = require('../middleware/auth');
const { validateId } = require('../middleware/validateId');
const { ROLES } = require('../utils/constants');

const router = Router();
router.use(authenticate);

router.get('/doctor', requireVerifiedDoctor, ctrl.listForDoctor);
router.get('/', authorize(ROLES.PATIENT), ctrl.listForPatient);
router.post('/prepare', authorize(ROLES.PATIENT), ctrl.prepareGrant);
router.post('/', authorize(ROLES.PATIENT), ctrl.grant);
router.get('/:permissionId/revoke/prepare', authorize(ROLES.PATIENT), validateId('permissionId'), ctrl.prepareRevoke);
router.patch('/:permissionId/revoke', authorize(ROLES.PATIENT), validateId('permissionId'), ctrl.revoke);

module.exports = router;

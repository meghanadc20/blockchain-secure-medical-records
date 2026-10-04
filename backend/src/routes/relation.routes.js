'use strict';
const { Router } = require('express');
const ctrl = require('../controllers/relation.controller');
const { authenticate, authorize, requireVerifiedDoctor } = require('../middleware/auth');
const { validateId } = require('../middleware/validateId');
const { ROLES } = require('../utils/constants');

const router = Router();
router.use(authenticate);

// Doctor
router.post('/requests', requireVerifiedDoctor, ctrl.requestAccess);
router.get('/doctor', authorize(ROLES.DOCTOR), ctrl.listForDoctor);

// Patient
router.get('/patient', authorize(ROLES.PATIENT), ctrl.listForPatient);
router.patch('/:relationId/approve', authorize(ROLES.PATIENT), validateId('relationId'), ctrl.approve);
router.patch('/:relationId/reject', authorize(ROLES.PATIENT), validateId('relationId'), ctrl.reject);
router.patch('/:relationId/revoke', authorize(ROLES.PATIENT), validateId('relationId'), ctrl.revoke);

module.exports = router;

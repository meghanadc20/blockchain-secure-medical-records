'use strict';
const { Router } = require('express');
const ctrl = require('../controllers/consultation.controller');
const { authenticate, authorize, requireVerifiedDoctor } = require('../middleware/auth');
const { validateId } = require('../middleware/validateId');
const { ROLES } = require('../utils/constants');

const router = Router();
router.use(authenticate);

// Doctors must be verified for every consultation operation; patients read their own.
function patientOrVerifiedDoctor(req, res, next) {
  if (req.user.role === ROLES.DOCTOR) return requireVerifiedDoctor(req, res, next);
  return authorize(ROLES.PATIENT)(req, res, next);
}

router.post('/', requireVerifiedDoctor, ctrl.create);
router.get('/', patientOrVerifiedDoctor, ctrl.list);
router.get('/:consultationId', patientOrVerifiedDoctor, validateId('consultationId'), ctrl.getOne);

module.exports = router;

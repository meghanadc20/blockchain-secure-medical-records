'use strict';
const { Router } = require('express');
const ctrl = require('../controllers/record.controller');
const { authenticate, authorize, requireVerifiedDoctor } = require('../middleware/auth');
const { validateId } = require('../middleware/validateId');
const { uploadSingleFile } = require('../middleware/upload');
const { ROLES } = require('../utils/constants');

const router = Router();
router.use(authenticate);

/** Patients, or doctors who are verified (relationship is checked in the controller). */
function patientOrVerifiedDoctor(req, res, next) {
  if (req.user.role === ROLES.DOCTOR) return requireVerifiedDoctor(req, res, next);
  return authorize(ROLES.PATIENT)(req, res, next);
}

// Upload (Module 3): role check happens BEFORE the file body is read.
router.post('/', patientOrVerifiedDoctor, uploadSingleFile, ctrl.upload);

// Patient: own records (metadata)
router.get('/', authorize(ROLES.PATIENT), ctrl.listOwn);
router.get('/:recordId', authorize(ROLES.PATIENT), validateId('recordId'), ctrl.getOwn);
router.patch('/:recordId', authorize(ROLES.PATIENT), validateId('recordId'), ctrl.updateOwn);

// Controlled file retrieval (access decided by recordAccess.service)
router.get('/:recordId/file', patientOrVerifiedDoctor, validateId('recordId'), ctrl.downloadFile);

module.exports = router;

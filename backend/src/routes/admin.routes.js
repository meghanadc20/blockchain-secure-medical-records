'use strict';
const { Router } = require('express');
const ctrl = require('../controllers/admin.controller');
const { authenticate, authorize } = require('../middleware/auth');
const { validateId } = require('../middleware/validateId');
const { ROLES } = require('../utils/constants');

const router = Router();
router.use(authenticate, authorize(ROLES.ADMIN)); // every admin route: valid JWT + role ADMIN

router.get('/stats', ctrl.stats);
router.get('/doctors', ctrl.listDoctors);
router.get('/doctors/:doctorId', validateId('doctorId'), ctrl.getDoctor);
router.patch('/doctors/:doctorId/approve', validateId('doctorId'), ctrl.approveDoctor);
router.patch('/doctors/:doctorId/reject', validateId('doctorId'), ctrl.rejectDoctor);

module.exports = router;

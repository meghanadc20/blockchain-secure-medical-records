'use strict';
const path = require('path');
const express = require('express');
const cors = require('cors');
const { env } = require('./config/env');
const healthRoutes = require('./routes/health.routes');
const authRoutes = require('./routes/auth.routes');
const profileRoutes = require('./routes/profile.routes');
const adminRoutes = require('./routes/admin.routes');
const relationRoutes = require('./routes/relation.routes');
const recordRoutes = require('./routes/record.routes');
const consultationRoutes = require('./routes/consultation.routes');
const historyRoutes = require('./routes/history.routes');
const permissionRoutes = require('./routes/permission.routes');
const { notFoundApi, errorHandler } = require('./middleware/errorHandler');

const FRONTEND_DIR = path.resolve(__dirname, '../../frontend');

function createApp() {
  const app = express();

  app.disable('x-powered-by');
  app.set('trust proxy', 1); // so req.ip is meaningful behind Codespaces/proxies (used in audit logs)

  // Basic security headers (no extra dependency).
  app.use((req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Referrer-Policy', 'no-referrer');
    next();
  });

  app.use(cors({ origin: env.corsOrigin }));
  app.use(express.json({ limit: '100kb' }));

  // ---------- API ----------
  app.use('/api/health', healthRoutes);
  app.use('/api/auth', authRoutes);
  app.use('/api/profile', profileRoutes);
  app.use('/api/admin', adminRoutes);
  app.use('/api/relations', relationRoutes);
  app.use('/api/records', recordRoutes);
  app.use('/api/consultations', consultationRoutes);
  app.use('/api/history', historyRoutes);
  app.use('/api/permissions', permissionRoutes);
  app.use('/api', notFoundApi);

  // ---------- Frontend (plain HTML/CSS/JS) ----------
  // Clean URLs: /login -> login.html, /patient/dashboard -> patient/dashboard.html
  app.use(express.static(FRONTEND_DIR, { extensions: ['html'], index: 'index.html' }));
  app.use((req, res) => res.status(404).sendFile(path.join(FRONTEND_DIR, '404.html')));

  app.use(errorHandler);
  return app;
}

module.exports = { createApp };

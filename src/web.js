'use strict';
const express = require('express');
const path = require('path');
const config = require('./lib/config');
const logger = require('./lib/logger');

function basicAuth(req, res, next) {
  if (!config.webUsername || !config.webPassword) return next();
  const header = req.headers.authorization || '';
  const [scheme, encoded] = header.split(' ');
  if (scheme === 'Basic' && encoded) {
    const [u, p] = Buffer.from(encoded, 'base64').toString().split(':');
    if (u === config.webUsername && p === config.webPassword) return next();
  }
  res.set('WWW-Authenticate', 'Basic realm="TRAILER-MDX"');
  res.status(401).send('Authentication required');
}

function start(bot) {
  const app = express();
  app.use(express.json());

  // Health check must be before basicAuth so Railway can always reach it
  app.get('/healthz', (_req, res) => res.send('ok'));

  app.use(basicAuth);
  app.use(express.static(path.join(__dirname, '..', 'public')));

  app.get('/api/status', (_req, res) => {
    res.json({
      botName: config.botName,
      version: config.version,
      botNumber: config.botNumber,
      connected: bot.isConnected(),
      hasSession: bot.hasSession(),
      uptime: process.uptime(),
    });
  });

  app.post('/api/pair', async (req, res) => {
    try {
      const number = String(req.body.number || '').replace(/\D/g, '');
      if (!number || number.length < 8) {
        return res.status(400).json({ error: 'Please send a valid phone number with country code.' });
      }
      const code = await bot.requestPairing(number);
      res.json({ code });
    } catch (e) {
      logger.error({ err: e?.message }, 'pairing failed');
      res.status(500).json({ error: e?.message || 'Pairing failed. Try again in a few seconds.' });
    }
  });

  app.post('/api/logout', async (_req, res) => {
    try {
      await bot.logout();
      res.json({ ok: true });
    } catch (e) {
      res.status(500).json({ error: e?.message });
    }
  });

  app.listen(config.port, '0.0.0.0', () => {
    logger.info(`Web pairing UI listening on :${config.port}`);
  });

  return app;
}

module.exports = { start };

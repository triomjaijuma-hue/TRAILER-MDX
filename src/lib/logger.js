'use strict';
const pino = require('pino');

const logger = pino({
  level: process.env.LOG_LEVEL || 'info',
  base: undefined,
  transport: {
    target: 'pino/file',
    options: { destination: 1 },
  },
}).child({ app: 'TRAILER-MDX' });

module.exports = logger;

'use strict';
const config = require('./lib/config');
const logger = require('./lib/logger');
const bot = require('./bot');
const web = require('./web');

process.on('uncaughtException', (e) => logger.error({ err: e?.stack || e?.message }, 'uncaughtException'));
process.on('unhandledRejection', (e) => logger.error({ err: e?.stack || e?.message }, 'unhandledRejection'));

async function main() {
  logger.info(`Starting ${config.botName} v${config.version}`);
  web.start(bot);
  if (bot.hasSession()) {
    bot.start().catch((e) => logger.error({ err: e?.message }, 'bot.start failed'));
  } else {
    logger.info(`No session yet — open the web page on port ${config.port} to pair.`);
  }
}

main();

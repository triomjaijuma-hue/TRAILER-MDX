'use strict';
const config = require('./lib/config');
const logger = require('./lib/logger');
const sessionBackup = require('./lib/sessionBackup');
const bot = require('./bot');
const web = require('./web');

process.on('uncaughtException', (e) => logger.error({ err: e?.stack || e?.message }, 'uncaughtException'));
process.on('unhandledRejection', (e) => logger.error({ err: e?.stack || e?.message }, 'unhandledRejection'));

// Flush the session backup to GitHub before the container actually dies.
// Railway sends SIGTERM ~10s before killing the container on redeploys;
// catching it here gives us a chance to push the latest creds so the next
// container can restore them.
async function gracefulExit(signal) {
  logger.info(`Received ${signal} — flushing session backup before exit.`);
  try { await sessionBackup.flush(); } catch (_) {}
  process.exit(0);
}
process.on('SIGTERM', () => gracefulExit('SIGTERM'));
process.on('SIGINT',  () => gracefulExit('SIGINT'));

async function main() {
  logger.info(`Starting ${config.botName} v${config.version}`);

  // Start the web server immediately so Railway's /healthz check passes
  // right away — before the session restore (which involves a GitHub API call).
  web.start(bot);

  // Pull last known session from the encrypted GitHub backup BEFORE Baileys
  // looks for creds. No-op if a local session is already on disk, or if
  // SESSION_BACKUP_TOKEN / SESSION_SECRET aren't configured.
  await sessionBackup.restore();

  if (bot.hasSession()) {
    bot.start().catch((e) => logger.error({ err: e?.message }, 'bot.start failed'));
  } else {
    logger.info(`No session yet — open the web page on port ${config.port} to pair.`);
  }
}

main();

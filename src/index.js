'use strict';

// ═══════════════════════════════════════════════════════════════════════════════
// SUPERVISOR MODE
// ───────────────────────────────────────────────────────────────────────────────
// When Railway starts the container it runs "node src/index.js" as PID 1.
// That becomes the SUPERVISOR — a tiny always-on parent that:
//
//   1. Spawns the real bot as a child process (BOT_CHILD=1)
//   2. When the child exits for any reason (`.update`, crash, deliberate
//      restart), the supervisor immediately re-spawns it.
//   3. The supervisor itself never exits, so Railway never sees the service
//      go down, never hits its restart throttle, and the /healthz health-check
//      just keeps passing.
//
// This means .update works perfectly without any manual Railway redeploy:
//   child exits → supervisor detects it within ms → new child starts in 2s
//
// On a real Railway redeploy Railway sends SIGTERM to PID 1 (the supervisor),
// which forwards it to the child so the session backup can be flushed, then
// exits cleanly after 12 s.
// ═══════════════════════════════════════════════════════════════════════════════
if (!process.env.BOT_CHILD) {
  const { spawn } = require('child_process');
  const path      = require('path');

  let child    = null;
  let stopping = false;

  function startChild() {
    if (stopping) return;

    child = spawn(process.execPath, [path.resolve(__filename)], {
      env:     { ...process.env, BOT_CHILD: '1' },
      stdio:   'inherit',
      detached: false,
    });

    child.on('exit', (code, signal) => {
      if (stopping) return;
      console.log(
        `[supervisor] child exited (code=${code ?? '?'} signal=${signal ?? 'none'})` +
        ` — restarting in 2 s`
      );
      setTimeout(startChild, 2000);
    });

    child.on('error', (err) => {
      console.error('[supervisor] child spawn error:', err.message);
      if (!stopping) setTimeout(startChild, 2000);
    });
  }

  // Forward Railway's SIGTERM / SIGINT so the child flushes the session backup
  function handleSignal(sig) {
    stopping = true;
    console.log(`[supervisor] received ${sig} — forwarding to child then exiting in 12 s`);
    if (child && !child.killed) child.kill(sig);
    setTimeout(() => process.exit(0), 12000);
  }
  process.on('SIGTERM', () => handleSignal('SIGTERM'));
  process.on('SIGINT',  () => handleSignal('SIGINT'));

  startChild();

  // Supervisor's own uncaught-exception guard — should never fire, but just in
  // case something weird happens we log it and keep running.
  process.on('uncaughtException',   (e) => console.error('[supervisor] uncaughtException:', e));
  process.on('unhandledRejection',  (e) => console.error('[supervisor] unhandledRejection:', e));

  // Supervisor never returns — it lives as long as the container.
  return; // valid at CommonJS module top-level (exits the wrapper function)
}

// ═══════════════════════════════════════════════════════════════════════════════
// BOT (CHILD) MODE  —  only runs when BOT_CHILD=1
// ═══════════════════════════════════════════════════════════════════════════════
const config        = require('./lib/config');
const logger        = require('./lib/logger');
const sessionBackup = require('./lib/sessionBackup');
const bot           = require('./bot');
const web           = require('./web');

process.on('uncaughtException',  (e) => logger.error({ err: e?.stack || e?.message }, 'uncaughtException'));
process.on('unhandledRejection', (e) => logger.error({ err: e?.stack || e?.message }, 'unhandledRejection'));

// Flush the session backup to GitHub before the child actually dies.
// Railway sends SIGTERM to PID 1 (the supervisor), which forwards it here.
async function gracefulExit(signal) {
  logger.info(`Received ${signal} — flushing session backup before exit.`);
  try {
    await Promise.race([
      sessionBackup.flush(),
      new Promise(resolve => setTimeout(resolve, 8000)),
    ]);
  } catch (_) {}
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
  // looks for creds. No-op if a local session is already on disk.
  await sessionBackup.restore();

  if (bot.hasSession()) {
    bot.start().catch((e) => logger.error({ err: e?.message }, 'bot.start failed'));
  } else {
    logger.info(`No session yet — open the web page on port ${config.port} to pair.`);
  }
}

main();

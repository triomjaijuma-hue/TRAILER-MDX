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

  let child      = null;
  let stopping   = false;
  let restarting = false; // guard: only ONE restart may be pending at a time

  // Schedule a single restart 2 s from now.  Both the 'exit' and 'error'
  // events on a ChildProcess can fire for the same crash (Node.js allows it).
  // Without this guard, both would each call startChild() → two children →
  // two simultaneous WhatsApp sessions → session key conflicts → bot goes mad.
  function scheduleRestart(reason) {
    if (stopping || restarting) return;
    restarting = true;
    console.log(`[supervisor] ${reason} — restarting in 2 s`);
    setTimeout(() => {
      restarting = false;
      startChild();
    }, 2000);
  }

  function startChild() {
    if (stopping) return;

    // Safety net: if a previous child is somehow still alive, kill it before
    // spawning a new one so we never have two instances connected at once.
    if (child && !child.killed) {
      try { child.kill('SIGKILL'); } catch (_) {}
    }

    child = spawn(process.execPath, [path.resolve(__filename)], {
      env:     { ...process.env, BOT_CHILD: '1' },
      stdio:   'inherit',
      detached: false,
    });

    child.on('exit', (code, signal) => {
      if (stopping) return;
      scheduleRestart(`child exited (code=${code ?? '?'} signal=${signal ?? 'none'})`);
    });

    child.on('error', (err) => {
      console.error('[supervisor] child spawn error:', err.message);
      scheduleRestart(`child spawn error: ${err.message}`);
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

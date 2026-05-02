'use strict';
// .update — owner-only hot-pull from GitHub.
//
// Default behaviour ("hot pull"):
//   1. Download the latest tarball of the default branch from GitHub.
//   2. Extract over the current project, preserving runtime state
//      (auth_info/, node_modules/, .env, tmp/, *.log).
//   3. If package.json changed, run `npm install --omit=dev`.
//   4. process.exit(0). Railway's restart policy (ALWAYS) re-launches
//      the process inside the SAME container, so the WhatsApp session
//      in auth_info/ survives — NO new pairing code needed.
//
// .redeploy — owner-only true Railway redeploy via GraphQL API.
//   Useful only if the hot-pull path is broken. Spins up a fresh
//   container and will lose auth_info/ unless it sits on a Railway
//   persistent volume mounted at /app/auth_info.
//
// .restart — owner-only clean restart (no code update).

const axios = require('axios');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawnSync } = require('child_process');
const sessionBackup = require('../../lib/sessionBackup');

// Wraps process.exit so we always flush the encrypted session backup to
// GitHub first. Without this, .update / .restart / .redeploy on a host
// without persistent storage would lose the very session change that just
// happened in the last 30 seconds.
//
// Design notes:
//   - Flush is capped at 8 seconds so a slow GitHub API can never leave
//     the process frozen. process.exit() is always called promptly.
//   - Exit code 0 is used (not 1). Railway's ALWAYS restart policy
//     restarts on code 0. Using exit code 1 tells Railway the process
//     CRASHED, which triggers Railway's crash-throttle: if the service
//     restarts and crashes again quickly (e.g. user sends .update twice),
//     Railway's throttle kicks in and stops auto-restarting entirely.
//   - restartScheduled prevents a second call to exitAfterFlush within
//     the same process lifetime. Without this, sending .update twice in
//     quick succession causes two process.exit() calls and two rapid
//     Railway restarts, triggering the crash-throttle described above.
let restartScheduled = false;
async function exitAfterFlush(_code, ms) {
  if (restartScheduled) return; // already exiting — ignore duplicate calls
  restartScheduled = true;
  setTimeout(async () => {
    try {
      // Hard 8-second cap — flush must not block the restart indefinitely
      await Promise.race([
        sessionBackup.flush(),
        new Promise(resolve => setTimeout(resolve, 8000)),
      ]);
    } catch (_) {}
    process.exit(0); // Clean exit — Railway ALWAYS policy restarts on code 0
  }, ms);
}

const owner = true;

const REPO_USER   = process.env.UPDATE_REPO_USER   || 'triomjaijuma-hue';
const REPO_NAME   = process.env.UPDATE_REPO_NAME   || 'TRAILER-MDX';
const REPO_BRANCH = process.env.UPDATE_REPO_BRANCH || 'main';

// Project root = three levels up from this file (src/commands/owner/update.js)
const PROJECT_ROOT = path.resolve(__dirname, '..', '..', '..');

// Anything in this set is left untouched during the overlay.
// IMPORTANT: auth_info MUST stay here so the WhatsApp session is preserved.
const PRESERVE = new Set([
  'auth_info',
  'node_modules',
  'bin',           // keep downloaded yt-dlp binary
  '.env',
  '.env.local',
  '.env.production',
  'tmp',
  '.git',
  'logs',
]);

async function latestCommit() {
  try {
    const r = await axios.get(
      `https://api.github.com/repos/${REPO_USER}/${REPO_NAME}/commits/${REPO_BRANCH}`,
      { timeout: 10000, headers: { 'User-Agent': 'TRAILER-MDX' } }
    );
    return {
      sha: r.data.sha?.slice(0, 7),
      message: (r.data.commit?.message || '').split('\n')[0],
      author: r.data.commit?.author?.name,
    };
  } catch (_) {
    return null;
  }
}

// Pull the last N commits on the configured branch — used by .changelog so
// the owner can see what an .update is about to apply before pulling it.
async function recentCommits(n = 5) {
  try {
    const r = await axios.get(
      `https://api.github.com/repos/${REPO_USER}/${REPO_NAME}/commits`,
      {
        timeout: 10000,
        headers: { 'User-Agent': 'TRAILER-MDX' },
        params: { sha: REPO_BRANCH, per_page: n },
      }
    );
    return (r.data || []).map((c) => ({
      sha: c.sha?.slice(0, 7),
      message: (c.commit?.message || '').split('\n')[0],
      author: c.commit?.author?.name || c.author?.login || 'unknown',
      date: c.commit?.author?.date || c.commit?.committer?.date,
    }));
  } catch (_) {
    return null;
  }
}

// "2h ago" / "3d ago" — small helper so the changelog reads naturally.
function relativeTime(iso) {
  if (!iso) return '';
  const ms = Date.now() - new Date(iso).getTime();
  if (ms < 0 || isNaN(ms)) return '';
  const sec = Math.floor(ms / 1000);
  if (sec < 60)         return `${sec}s ago`;
  const min = Math.floor(sec / 60);
  if (min < 60)         return `${min}m ago`;
  const hr  = Math.floor(min / 60);
  if (hr  < 24)         return `${hr}h ago`;
  const day = Math.floor(hr / 24);
  if (day < 30)         return `${day}d ago`;
  const mo  = Math.floor(day / 30);
  if (mo  < 12)         return `${mo}mo ago`;
  return `${Math.floor(mo / 12)}y ago`;
}

function findRepoRootInTar(extractDir) {
  // GitHub tarballs unpack as `<repo>-<branch>/...`
  const entries = fs.readdirSync(extractDir, { withFileTypes: true });
  const dir = entries.find((e) => e.isDirectory());
  return dir ? path.join(extractDir, dir.name) : null;
}

function copyTree(src, dst) {
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const sp = path.join(src, entry.name);
    const dp = path.join(dst, entry.name);
    if (entry.isDirectory()) {
      fs.mkdirSync(dp, { recursive: true });
      copyTree(sp, dp);
    } else if (entry.isSymbolicLink()) {
      const target = fs.readlinkSync(sp);
      try { fs.unlinkSync(dp); } catch (_) {}
      try { fs.symlinkSync(target, dp); } catch (_) {}
    } else {
      fs.copyFileSync(sp, dp);
    }
  }
}

function syncFiles(srcRoot, dstRoot) {
  let pkgChanged = false;
  let touched = 0;
  for (const entry of fs.readdirSync(srcRoot, { withFileTypes: true })) {
    if (PRESERVE.has(entry.name)) continue;
    const sp = path.join(srcRoot, entry.name);
    const dp = path.join(dstRoot, entry.name);

    if (entry.name === 'package.json' || entry.name === 'package-lock.json') {
      const oldContent = fs.existsSync(dp) ? fs.readFileSync(dp, 'utf8') : '';
      const newContent = fs.readFileSync(sp, 'utf8');
      if (oldContent !== newContent) pkgChanged = true;
    }

    if (entry.isDirectory()) {
      // Mirror dirs so deleted files actually go away.
      try { fs.rmSync(dp, { recursive: true, force: true }); } catch (_) {}
      fs.mkdirSync(dp, { recursive: true });
      copyTree(sp, dp);
    } else {
      fs.copyFileSync(sp, dp);
    }
    touched++;
  }
  return { pkgChanged, touched };
}

async function hotPull(notify) {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'trailer-update-'));
  try {
    const tarUrl = `https://codeload.github.com/${REPO_USER}/${REPO_NAME}/tar.gz/refs/heads/${REPO_BRANCH}`;
    await notify(`📥 Downloading latest \`${REPO_BRANCH}\` from GitHub...`);
    const r = await axios.get(tarUrl, {
      responseType: 'arraybuffer',
      timeout: 60000,
      maxContentLength: 200 * 1024 * 1024,
      maxBodyLength: 200 * 1024 * 1024,
      validateStatus: (s) => s >= 200 && s < 400,
    });
    const tarPath = path.join(tmpDir, 'src.tgz');
    fs.writeFileSync(tarPath, Buffer.from(r.data));

    const extractDir = path.join(tmpDir, 'unpacked');
    fs.mkdirSync(extractDir);
    const x = spawnSync('tar', ['-xzf', tarPath, '-C', extractDir], { stdio: 'pipe' });
    if (x.status !== 0) {
      return { ok: false, message: `tar extract failed: ${(x.stderr || '').toString().slice(0, 200)}` };
    }

    const repoSrc = findRepoRootInTar(extractDir);
    if (!repoSrc) return { ok: false, message: 'tarball was empty' };

    await notify(`📂 Applying files into the running container...`);
    const { pkgChanged, touched } = syncFiles(repoSrc, PROJECT_ROOT);

    let depSummary = '';
    if (pkgChanged) {
      await notify(`📦 \`package.json\` changed — installing deps (this can take ~30s)...`);
      const npmStart = Date.now();
      const npm = spawnSync('npm', ['install', '--omit=dev', '--no-audit', '--no-fund'], {
        cwd: PROJECT_ROOT,
        stdio: 'pipe',
        timeout: 180000,
        env: { ...process.env, npm_config_loglevel: 'error' },
      });
      const took = Math.round((Date.now() - npmStart) / 1000);
      if (npm.status !== 0) {
        return {
          ok: false,
          message: `npm install failed after ${took}s.\n\n\`\`\`${(npm.stderr || npm.stdout || '').toString().slice(-500)}\`\`\``,
        };
      }
      depSummary = ` (deps refreshed in ${took}s)`;
    }
    return { ok: true, pkgChanged, touched, depSummary };
  } finally {
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch (_) {}
  }
}

async function railwayRedeploy() {
  const token = process.env.RAILWAY_API_TOKEN || process.env.RAILWAY_TOKEN;
  const serviceId = process.env.RAILWAY_SERVICE_ID;
  const environmentId = process.env.RAILWAY_ENVIRONMENT_ID;
  if (!token || !serviceId || !environmentId) {
    return {
      ok: false,
      reason: 'missing-token',
      message:
        '⚠️ Railway API not configured.\n\n' +
        'To enable `.redeploy` (full container rebuild):\n' +
        '1. Open https://railway.com/account/tokens → *Create Token*\n' +
        '2. In your Railway project → *Variables* → add `RAILWAY_API_TOKEN`\n' +
        '   (Railway auto-injects `RAILWAY_SERVICE_ID` and `RAILWAY_ENVIRONMENT_ID`.)\n\n' +
        '_Tip: prefer `.update` instead — it preserves your WhatsApp session._',
    };
  }
  const r = await axios.post(
    'https://backboard.railway.com/graphql/v2',
    {
      query: `mutation Redeploy($serviceId: String!, $environmentId: String!) {
        serviceInstanceRedeploy(serviceId: $serviceId, environmentId: $environmentId)
      }`,
      variables: { serviceId, environmentId },
    },
    {
      timeout: 20000,
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    }
  );
  if (r.data?.errors?.length) {
    return { ok: false, reason: 'api-error', message: r.data.errors.map((e) => e.message).join('; ') };
  }
  return { ok: true };
}

module.exports = [
  {
    name: 'update', aliases: ['upgrade', 'pull', 'hotpull'], owner,
    description: 'Hot-pull latest code from GitHub and restart (preserves session)',
    handler: async ({ reply }) => {
      const latest = await latestCommit();
      const header = latest
        ? `🔄 *Hot-updating to ${latest.sha}*\n_${latest.message}_\n_by ${latest.author}_\n\n`
        : `🔄 *Hot-updating from GitHub*\n\n`;
      try {
        await reply(header + '⏳ Pulling latest code into the running container — your session stays intact.');
        const r = await hotPull(reply);
        if (!r.ok) {
          return reply(`❌ Hot-update failed: ${r.message}\n\n_Try \`.redeploy\` for a full Railway rebuild instead._`);
        }
        if (restartScheduled) return reply('♻️ Already restarting — please wait.');
        await reply(`✅ Updated ${r.touched} top-level paths${r.depSummary}.\n♻️ Restarting in 2s — session backup is being flushed before exit.`);
        // Flush the encrypted session backup to GitHub, then exit. On the
        // next start, sessionBackup.restore() pulls it back into auth_info/
        // before Baileys looks for creds — so pairing is preserved even on
        // ephemeral hosts that destroy the container on restart.
        exitAfterFlush(0, 2000);
      } catch (e) {
        reply(`❌ Hot-update error: ${e?.message || e}`);
      }
    },
  },
  {
    name: 'restart', aliases: ['reboot'], owner,
    description: 'Restart the bot process (no code change)',
    handler: async ({ reply }) => {
      if (restartScheduled) return reply('♻️ Already restarting — please wait.');
      await reply('🔁 Restarting in 2s — flushing session backup before exit.');
      exitAfterFlush(0, 2000);
    },
  },
  {
    name: 'redeploy', owner,
    description: 'Full Railway rebuild (will reset session unless on a volume)',
    handler: async ({ reply }) => {
      const latest = await latestCommit();
      const header = latest
        ? `🔁 *Redeploying to ${latest.sha}*\n_${latest.message}_\n\n`
        : '🔁 *Redeploying...*\n\n';
      try {
        const result = await railwayRedeploy();
        if (result.ok) {
          await reply(header + '✅ Redeploy triggered. Bot will be back online in ~30s with a fresh container (session restored from backup).');
          exitAfterFlush(0, 3000);
          return;
        }
        return reply(header + result.message);
      } catch (e) {
        reply(`❌ Redeploy failed: ${e?.response?.data?.errors?.[0]?.message || e.message}`);
      }
    },
  },
  {
    name: 'changelog', aliases: ['commits', 'whatsnew'], owner,
    description: 'Show the last 5 GitHub commits (preview what .update will pull)',
    handler: async ({ reply, argText }) => {
      // Allow .changelog 10 to ask for a different count (1-20).
      const n = Math.max(1, Math.min(20, parseInt(argText, 10) || 5));
      const commits = await recentCommits(n);
      if (!commits) return reply('❌ Could not reach GitHub. Try again in a moment.');
      if (!commits.length) return reply('No commits found on this branch.');

      const lines = [
        `📜 *Last ${commits.length} commits on \`${REPO_BRANCH}\`*`,
        `_Run .update to apply the top one._`,
        '',
      ];
      for (const c of commits) {
        lines.push(`• \`${c.sha}\` — ${c.message}`);
        lines.push(`   _${c.author} · ${relativeTime(c.date)}_`);
      }
      reply(lines.join('\n'));
    },
  },
  {
    name: 'version', aliases: ['ver', 'about'], owner: false,
    description: 'Show bot version and the latest GitHub commit',
    handler: async ({ reply }) => {
      const config = require('../../lib/config');
      const latest = await latestCommit();
      const lines = [
        `🤖 *${config.botName}* v${config.version}`,
        `Node ${process.version} • Uptime ${Math.round(process.uptime() / 60)}m`,
      ];
      if (latest) lines.push('', `*Latest on GitHub:* ${latest.sha} — ${latest.message}`);
      reply(lines.join('\n'));
    },
  },
];

'use strict';
//
// Session auto-backup
// -------------------
// Encrypts the auth_info/ folder with SESSION_SECRET (AES-256-GCM) and stores
// the resulting blob as a file in a private GitHub repo. On every startup the
// blob is fetched, decrypted, and unpacked back into auth_info/ before
// Baileys looks for credentials.
//
// Net effect: the WhatsApp session survives container restarts on hosts that
// don't have persistent disks (Railway free/Trial, fly.io ephemeral, etc.) —
// no Volume needed.
//
// Required env vars (both must be set; otherwise the module no-ops):
//   SESSION_BACKUP_TOKEN — GitHub PAT with "Contents: Read and write" on the
//                          backup repo.
//   SESSION_SECRET       — encryption key. Already used elsewhere in the bot.
//
// Optional env vars:
//   SESSION_BACKUP_REPO   — "owner/repo". Defaults to UPDATE_REPO_USER /
//                           UPDATE_REPO_NAME (same repo as .update).
//   SESSION_BACKUP_BRANCH — defaults to "main".
//   SESSION_BACKUP_PATH   — defaults to ".session/backup.enc".
//
// Cadence:
//   - Pushes are debounced 30s, so bursts of creds.update events coalesce.
//   - A SHA-256 hash of the last-pushed blob is kept; identical re-pushes are
//     skipped, so quiet sessions don't generate noise commits.
//   - flush() is called from process signal handlers and from .update /
//     .restart / .redeploy so a graceful exit always pushes the latest state.

const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const axios = require('axios');
const { spawnSync } = require('child_process');
const config = require('./config');
const logger = require('./logger');

const TOKEN  = process.env.SESSION_BACKUP_TOKEN || '';
const SECRET = process.env.SESSION_SECRET || '';
const REPO   = process.env.SESSION_BACKUP_REPO   ||
  `${process.env.UPDATE_REPO_USER || 'triomjaijuma-hue'}/${process.env.UPDATE_REPO_NAME || 'TRAILER-MDX'}`;
const BRANCH = process.env.SESSION_BACKUP_BRANCH || 'main';
const REMOTE = process.env.SESSION_BACKUP_PATH   || '.session/backup.enc';
const AUTH_DIR = config.paths.auth;
const DEBOUNCE_MS = 30 * 1000;
const UA = 'TRAILER-MDX-session-backup';

function isEnabled() { return Boolean(TOKEN && SECRET); }

// AES-256 needs a 32-byte key; SHA-256 of any-length secret gives us that
// deterministically without dragging in a KDF dependency.
function deriveKey() {
  return crypto.createHash('sha256').update(SECRET).digest();
}

function encrypt(plain) {
  const iv  = crypto.randomBytes(12);
  const cph = crypto.createCipheriv('aes-256-gcm', deriveKey(), iv);
  const enc = Buffer.concat([cph.update(plain), cph.final()]);
  return Buffer.concat([iv, cph.getAuthTag(), enc]);
}

function decrypt(blob) {
  const iv  = blob.slice(0, 12);
  const tag = blob.slice(12, 28);
  const enc = blob.slice(28);
  const dec = crypto.createDecipheriv('aes-256-gcm', deriveKey(), iv);
  dec.setAuthTag(tag);
  return Buffer.concat([dec.update(enc), dec.final()]);
}

function tarFolder(folder) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sb-'));
  const tar = path.join(tmp, 'a.tgz');
  // -C parent so the archive contains relative paths "auth_info/..." that
  // unpack cleanly back to the same place.
  const r = spawnSync('tar', ['-czf', tar, '-C', path.dirname(folder), path.basename(folder)], { stdio: 'pipe' });
  if (r.status !== 0) {
    try { fs.rmSync(tmp, { recursive: true, force: true }); } catch (_) {}
    throw new Error(`tar failed: ${(r.stderr || '').toString().slice(0, 200)}`);
  }
  const buf = fs.readFileSync(tar);
  try { fs.rmSync(tmp, { recursive: true, force: true }); } catch (_) {}
  return buf;
}

function untarToParent(blob, destFolder) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sb-'));
  const tar = path.join(tmp, 'a.tgz');
  fs.writeFileSync(tar, blob);
  fs.mkdirSync(path.dirname(destFolder), { recursive: true });
  const r = spawnSync('tar', ['-xzf', tar, '-C', path.dirname(destFolder)], { stdio: 'pipe' });
  try { fs.rmSync(tmp, { recursive: true, force: true }); } catch (_) {}
  if (r.status !== 0) throw new Error(`tar -x failed: ${(r.stderr || '').toString().slice(0, 200)}`);
}

async function ghGet() {
  const url = `https://api.github.com/repos/${REPO}/contents/${encodeURIComponent(REMOTE).replace(/%2F/g, '/')}?ref=${encodeURIComponent(BRANCH)}`;
  const r = await axios.get(url, {
    headers: { Authorization: `token ${TOKEN}`, 'User-Agent': UA, Accept: 'application/vnd.github.v3+json' },
    timeout: 25000,
    validateStatus: () => true,
    maxContentLength: 50 * 1024 * 1024,
  });
  if (r.status === 404) return null;
  if (r.status >= 400)  throw new Error(`GitHub GET ${r.status}: ${JSON.stringify(r.data).slice(0, 200)}`);
  return r.data;
}

async function ghPut(b64Content, sha, message) {
  const url = `https://api.github.com/repos/${REPO}/contents/${encodeURIComponent(REMOTE).replace(/%2F/g, '/')}`;
  const body = { message, content: b64Content, branch: BRANCH };
  if (sha) body.sha = sha;
  const r = await axios.put(url, body, {
    headers: { Authorization: `token ${TOKEN}`, 'User-Agent': UA, 'Content-Type': 'application/json' },
    timeout: 30000,
    validateStatus: () => true,
  });
  if (r.status >= 400) throw new Error(`GitHub PUT ${r.status}: ${JSON.stringify(r.data).slice(0, 200)}`);
  return r.data;
}

function sha256hex(s) {
  return crypto.createHash('sha256').update(s).digest('hex');
}

// --- public API ---------------------------------------------------------

let lastHash = null;
let pending  = null;
let pushing  = false;

// Pull the latest backup from GitHub (if any) and unpack it into AUTH_DIR.
// Skipped if a local session already exists, so a hot-pull (.update) keeps
// using whatever was on the running container's disk.
async function restore() {
  if (!isEnabled()) {
    logger.warn('sessionBackup: disabled (set SESSION_BACKUP_TOKEN + SESSION_SECRET to enable). Sessions will not survive container restarts.');
    return { ok: false, reason: 'disabled' };
  }
  if (fs.existsSync(path.join(AUTH_DIR, 'creds.json'))) {
    logger.info('sessionBackup: local session present, skipping restore.');
    return { ok: true, reason: 'local-present' };
  }
  try {
    const meta = await ghGet();
    if (!meta) {
      logger.info('sessionBackup: no remote backup yet — first run on this account.');
      return { ok: false, reason: 'no-remote' };
    }
    const blob = decrypt(Buffer.from(meta.content, 'base64'));
    untarToParent(blob, AUTH_DIR);
    lastHash = sha256hex(meta.content);
    logger.info(`sessionBackup: restored session from ${REPO}/${REMOTE}.`);
    return { ok: true, reason: 'restored' };
  } catch (e) {
    logger.error({ err: e?.message }, 'sessionBackup.restore failed');
    return { ok: false, reason: 'error', error: e?.message };
  }
}

// Encrypt + push the current AUTH_DIR. Skips if the encrypted blob is
// byte-identical to the last one we pushed.
async function pushNow() {
  if (!isEnabled() || pushing) return;
  pushing = true;
  try {
    if (!fs.existsSync(path.join(AUTH_DIR, 'creds.json'))) return;
    const tar = tarFolder(AUTH_DIR);
    const enc = encrypt(tar);
    const b64 = enc.toString('base64');
    const newHash = sha256hex(b64);
    if (newHash === lastHash) return;
    let sha = null;
    try { sha = (await ghGet())?.sha || null; } catch (_) {}
    await ghPut(b64, sha, `chore(session): backup ${new Date().toISOString()}`);
    lastHash = newHash;
    logger.info(`sessionBackup: pushed ${b64.length} B blob to ${REPO}/${REMOTE}.`);
  } catch (e) {
    logger.warn({ err: e?.message }, 'sessionBackup.pushNow failed (will retry on next event)');
  } finally {
    pushing = false;
  }
}

// Debounced trigger for use from creds.update. Multiple calls within
// DEBOUNCE_MS coalesce into a single push.
function schedule() {
  if (!isEnabled() || pending) return;
  pending = setTimeout(() => {
    pending = null;
    pushNow();
  }, DEBOUNCE_MS);
  pending.unref?.();
}

// Sync flush for use in shutdown paths (.update / .restart / SIGTERM).
async function flush() {
  if (pending) { clearTimeout(pending); pending = null; }
  await pushNow();
}

module.exports = { restore, schedule, flush, pushNow, isEnabled };

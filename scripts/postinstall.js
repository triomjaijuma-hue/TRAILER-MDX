#!/usr/bin/env node
'use strict';
(async () => {
  const { execSync } = require('child_process');
  const fs   = require('fs');
  const path = require('path');
  const os   = require('os');

  const binDir = path.join(__dirname, '..', 'bin');
  const out    = path.join(binDir, 'yt-dlp');

  try { fs.mkdirSync(binDir, { recursive: true }); } catch (_) {}

  if (fs.existsSync(out) && fs.statSync(out).size > 1000000) {
    console.log('[postinstall] yt-dlp already present, skipping.');
    process.exit(0);
  }

  const isWin = os.platform() === 'win32';
  const url   = isWin
    ? 'https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp.exe'
    : 'https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp';

  try {
    execSync('curl -fsSL "' + url + '" -o "' + out + '"', { stdio: 'inherit' });
    if (!isWin) fs.chmodSync(out, 0o755);
    console.log('[postinstall] yt-dlp downloaded to ' + out);
  } catch (e) {
    console.warn('[postinstall] yt-dlp download failed (non-fatal):', e.message);
  }

  process.exit(0);
})();

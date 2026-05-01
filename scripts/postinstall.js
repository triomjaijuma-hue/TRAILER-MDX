#!/usr/bin/env node
'use strict';
const https = require('https');
const fs    = require('fs');
const path  = require('path');
const os    = require('os');
const { execSync } = require('child_process');

const binDir = path.join(__dirname, '..', 'bin');
const isWin  = os.platform() === 'win32';
const out    = path.join(binDir, isWin ? 'yt-dlp.exe' : 'yt-dlp');
const url    = isWin
  ? 'https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp.exe'
  : 'https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp';

try { fs.mkdirSync(binDir, { recursive: true }); } catch (_) {}

if (fs.existsSync(out) && fs.statSync(out).size > 1_000_000) {
  console.log('[postinstall] yt-dlp already present at', out);
  process.exit(0);
}

console.log('[postinstall] Downloading yt-dlp from', url, '...');

// Download using Node native https with redirect following
function download(resolvedUrl, destPath, redirects) {
  if (redirects > 5) return Promise.reject(new Error('too many redirects'));
  return new Promise((resolve, reject) => {
    https.get(resolvedUrl, { headers: { 'User-Agent': 'node-postinstall' } }, (res) => {
      if (res.statusCode === 301 || res.statusCode === 302 || res.statusCode === 307 || res.statusCode === 308) {
        return resolve(download(res.headers.location, destPath, redirects + 1));
      }
      if (res.statusCode !== 200) return reject(new Error('HTTP ' + res.statusCode));
      const tmp = destPath + '.tmp';
      const file = fs.createWriteStream(tmp);
      res.pipe(file);
      file.on('finish', () => {
        file.close(() => {
          fs.renameSync(tmp, destPath);
          resolve();
        });
      });
      file.on('error', (e) => { try { fs.unlinkSync(tmp); } catch (_) {} reject(e); });
    }).on('error', reject);
  });
}

(async () => {
  try {
    await download(url, out, 0);
    if (!isWin) fs.chmodSync(out, 0o755);
    const size = fs.statSync(out).size;
    if (size < 1_000_000) throw new Error('Downloaded file too small: ' + size + ' bytes');
    console.log('[postinstall] yt-dlp downloaded successfully to', out, '(' + (size / 1e6).toFixed(1) + ' MB)');
  } catch (e) {
    console.warn('[postinstall] Node download failed:', e.message);
    // Fallback to curl if available
    try {
      execSync('curl -fsSL "' + url + '" -o "' + out + '"', { stdio: 'inherit' });
      if (!isWin) fs.chmodSync(out, 0o755);
      console.log('[postinstall] yt-dlp downloaded via curl to', out);
    } catch (e2) {
      console.warn('[postinstall] curl fallback also failed:', e2.message);
      console.warn('[postinstall] yt-dlp will NOT be available — .play/.video commands will fail.');
    }
  }
  process.exit(0);
})();

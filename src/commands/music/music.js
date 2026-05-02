'use strict';
const yts     = require('yt-search');
const https   = require('https');
const http    = require('http');
const { execFile, exec } = require('child_process');
const fs      = require('fs');
const path    = require('path');
const helpers = require('../../lib/helpers');
const config  = require('../../lib/config');

const MIN_AUDIO_BYTES = 64 * 1024;   // 64 KB minimum for audio
const MIN_VIDEO_BYTES = 500 * 1024;  // 500 KB minimum for video
const MAX_VIDEO_BYTES = 60 * 1024 * 1024; // 60 MB WhatsApp cap

// ---------------------------------------------------------------------------
// Magic-byte audio validation — rejects HTML pages, JSON errors, stubs
// ---------------------------------------------------------------------------
function isAudioBuffer(buf) {
  if (!buf || buf.length < MIN_AUDIO_BYTES) return false;
  if (buf[0] === 0x49 && buf[1] === 0x44 && buf[2] === 0x33) return true; // ID3 MP3
  if (buf[0] === 0xFF && (buf[1] & 0xE0) === 0xE0) return true;           // MPEG sync
  if (buf.length > 11 && buf.slice(4, 8).toString('ascii') === 'ftyp') return true; // M4A/MP4
  if (buf[0] === 0x1A && buf[1] === 0x45 && buf[2] === 0xDF && buf[3] === 0xA3) return true; // WebM
  if (buf.slice(0, 4).toString('ascii') === 'OggS') return true;           // OGG
  if (buf.slice(0, 4).toString('ascii') === 'RIFF') return true;           // WAV
  if (buf.slice(0, 4).toString('ascii') === 'fLaC') return true;           // FLAC
  return false;
}

// ---------------------------------------------------------------------------
// Magic-byte video validation
// ---------------------------------------------------------------------------
function isVideoBuffer(buf) {
  if (!buf || buf.length < MIN_VIDEO_BYTES) return false;
  if (buf.length > 11 && buf.slice(4, 8).toString('ascii') === 'ftyp') return true; // MP4/M4V
  if (buf[0] === 0x1A && buf[1] === 0x45 && buf[2] === 0xDF && buf[3] === 0xA3) return true; // WebM/MKV
  if (buf.slice(0, 4).toString('ascii') === 'RIFF') return true; // AVI
  return false;
}

// ---------------------------------------------------------------------------
// Shared HTTP helper (follows redirects, returns status + headers + body)
// ---------------------------------------------------------------------------
function httpGet(url, maxRedir, extraHeaders) {
  maxRedir = maxRedir == null ? 8 : maxRedir;
  return new Promise((resolve, reject) => {
    let p;
    try { p = new URL(url); } catch (e) { return reject(e); }
    const mod = p.protocol === 'http:' ? http : https;
    const req = mod.get(
      {
        hostname: p.hostname,
        port: p.port || undefined,
        path: p.pathname + p.search,
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
          ...extraHeaders,
        },
        timeout: 30000,
      },
      res => {
        if ([301, 302, 307, 308].includes(res.statusCode) && res.headers.location) {
          if (maxRedir <= 0) return reject(new Error('too many redirects'));
          // Resolve relative redirects (e.g. "/path?x=1") against the current URL
          let next;
          try { next = new URL(res.headers.location, url).href; }
          catch (e) { return reject(new Error('bad redirect URL: ' + res.headers.location)); }
          return resolve(httpGet(next, maxRedir - 1, extraHeaders));
        }
        const chunks = [];
        res.on('data', d => chunks.push(d));
        res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks) }));
        res.on('error', reject);
      }
    );
    req.on('error', reject);
    req.on('timeout', () => req.destroy(new Error('timeout')));
  });
}

// ---------------------------------------------------------------------------
// YouTube search + result picker
// ---------------------------------------------------------------------------
async function ytSearch(q) {
  try { const r = await yts(q); if (r?.videos?.length) return r; } catch (_) {}
  try { const r = await ytScrape(q); if (r?.videos?.length) return r; } catch (_) {}
  return { videos: [] };
}

async function ytScrape(q) {
  const r = await httpGet(`https://www.youtube.com/results?search_query=${encodeURIComponent(q)}`);
  const m = r.body.toString().match(/var ytInitialData = (\{[\s\S]+?\});\s*<\/script>/);
  if (!m) return { videos: [] };
  const data = JSON.parse(m[1]);
  const out = [];
  for (const sec of (data?.contents?.twoColumnSearchResultsRenderer?.primaryContents
    ?.sectionListRenderer?.contents || [])) {
    for (const it of (sec?.itemSectionRenderer?.contents || [])) {
      const v = it?.videoRenderer;
      if (!v?.videoId) continue;
      const lt = v.lengthText?.simpleText || '';
      const secs = lt.split(':').map(Number).reduce((a, b) => a * 60 + b, 0);
      out.push({
        title: v.title?.runs?.[0]?.text || '',
        videoId: v.videoId,
        url: `https://www.youtube.com/watch?v=${v.videoId}`,
        author: { name: v.ownerText?.runs?.[0]?.text || '' },
        duration: { seconds: secs, timestamp: lt },
        timestamp: lt,
        views: Number((v.viewCountText?.simpleText || '0').replace(/\D/g, '')) || 0,
      });
      if (out.length >= 20) break;
    }
    if (out.length >= 20) break;
  }
  return { videos: out };
}

function pickBest(vids, q) {
  const tokens = q.toLowerCase().split(/\s+/).filter(Boolean);
  const score = v => {
    const t = (v.title || '').toLowerCase();
    const a = (v.author?.name || '').toLowerCase();
    let s = 0;
    tokens.forEach(k => { if (t.includes(k)) s += 3; if (a.includes(k)) s += 2; });
    if (/official\s+(audio|video|music)/i.test(v.title)) s += 3;
    if (/\btopic\b|vevo/i.test(v.author?.name || ''))    s += 3;
    if (/reaction|tutorial|cover|sped.up|nightcore|slowed/i.test(v.title)) s -= 3;
    const sec = v.duration?.seconds || 0;
    if (sec >= 45 && sec <= 720) s += 1; else if (sec > 720) s -= 2;
    s += Math.min(3, Math.log10((v.views || 1) + 1) / 2);
    return s;
  };
  return vids.slice(0, 15).map(v => ({ v, s: score(v) })).sort((a, b) => b.s - a.s)[0]?.v || vids[0];
}

// ---------------------------------------------------------------------------
// Strategy 1: yt-dlp
//
// The binary at /usr/local/bin/yt-dlp may be a Python zipapp with a bytecode
// mismatch that crashes on import. We test several invocation styles and pick
// whichever actually responds to --version.
//
// Priority: python3 -m yt_dlp  >  nix/postinstall binary  >  pip binary
// The python3 -m approach bypasses the broken zipapp entirely.
// ---------------------------------------------------------------------------
let _ytdlp = null; // { bin, prefix } — cached after first successful probe

function testCmd(bin, args) {
  return new Promise(r => {
    execFile(bin, args, { timeout: 10000 }, e => r(!e));
  });
}

async function getYtdlp() {
  if (_ytdlp) return _ytdlp;

  // 1. python3 -m yt_dlp  — works even when the standalone binary is broken
  if (await testCmd('python3', ['-m', 'yt_dlp', '--version'])) {
    _ytdlp = { bin: 'python3', prefix: ['-m', 'yt_dlp'] };
    return _ytdlp;
  }
  if (await testCmd('python', ['-m', 'yt_dlp', '--version'])) {
    _ytdlp = { bin: 'python', prefix: ['-m', 'yt_dlp'] };
    return _ytdlp;
  }

  // 2. Known binary paths — must be a regular FILE (not a directory)
  const candidates = [
    process.env.YTDLP_BIN,
    '/root/.nix-profile/bin/yt-dlp',               // nixpacks (highest priority)
    '/nix/var/nix/profiles/default/bin/yt-dlp',
    '/home/user/.nix-profile/bin/yt-dlp',
    path.join(__dirname, '../../../bin/yt-dlp'),    // postinstall.js download
    '/usr/local/bin/yt-dlp',                        // pip (broken zipapp — try last)
    '/usr/bin/yt-dlp',
    '/bin/yt-dlp',
    '/tmp/yt-dlp',
  ].filter(Boolean);

  for (const p of candidates) {
    try {
      const stat = fs.statSync(p);
      if (!stat.isFile()) continue;               // skip directories
      fs.accessSync(p, fs.constants.X_OK);
      if (await testCmd(p, ['--version'])) {
        _ytdlp = { bin: p, prefix: [] };
        return _ytdlp;
      }
    } catch (_) {}
  }

  // 3. PATH search
  const fromPath = await new Promise(r =>
    exec('which yt-dlp 2>/dev/null || command -v yt-dlp 2>/dev/null', { timeout: 8000 },
      (e, o) => r((o || '').trim() || null))
  );
  if (fromPath) {
    try {
      const stat = fs.statSync(fromPath);
      if (stat.isFile() && await testCmd(fromPath, ['--version'])) {
        _ytdlp = { bin: fromPath, prefix: [] };
        return _ytdlp;
      }
    } catch (_) {}
  }

  // 4. Nix store search
  const fromNix = await new Promise(r =>
    exec('find /nix /run -name yt-dlp -type f 2>/dev/null | head -1', { timeout: 30000 },
      (e, o) => r((o || '').trim() || null))
  );
  if (fromNix && await testCmd(fromNix, ['--version'])) {
    _ytdlp = { bin: fromNix, prefix: [] };
    return _ytdlp;
  }

  return null;
}
getYtdlp().catch(() => {}); // warm up on startup

function loadCookies() {
  const candidates = ['/tmp/yt-cookies.txt', path.join(__dirname, '../../../cookies.txt')];
  for (const f of candidates) {
    try { if (fs.statSync(f).size > 100) return f; } catch (_) {}
  }
  const b64 = process.env.YOUTUBE_COOKIES || process.env.YT_COOKIES;
  if (b64) {
    try {
      const decoded = Buffer.from(b64, 'base64').toString('utf8');
      if (decoded.includes('youtube.com')) {
        fs.writeFileSync('/tmp/yt-cookies.txt', decoded);
        return '/tmp/yt-cookies.txt';
      }
    } catch (_) {}
  }
  return null;
}

const YT_CLIENTS = [
  { client: 'ios',         ua: 'com.google.ios.youtube/19.45.4 (iPhone16,2; U; CPU iPhone OS 18_1_0 like Mac OS X)' },
  { client: 'tv_embedded', ua: 'Mozilla/5.0 (SMART-TV; Linux; Tizen 6.0) AppleWebKit/538.1' },
  { client: 'web',         ua: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' },
];

async function downloadWithYtdlp(videoUrl) {
  const ytdlp = await getYtdlp();
  if (!ytdlp) throw new Error('yt-dlp: not available (binary not found and python3 -m yt_dlp failed)');
  const cookiesFile = loadCookies();
  const errs = [];
  for (const { client, ua } of YT_CLIENTS) {
    try {
      const buf = await new Promise((resolve, reject) => {
        const id  = Date.now().toString(36) + Math.random().toString(36).slice(2, 5);
        const out = `/tmp/yt_${id}.mp3`;
        const args = [
          ...ytdlp.prefix,
          '-x', '--audio-format', 'mp3', '--audio-quality', '128K',
          '--no-playlist', '--no-warnings', '--no-check-certificate',
          '--extractor-args', `youtube:player_client=${client}`,
          '--user-agent', ua,
          '--max-filesize', '75m',
          '--socket-timeout', '30',
          '--retries', '2',
          ...(cookiesFile ? ['--cookies', cookiesFile] : []),
          '-o', out,
          videoUrl,
        ];
        execFile(ytdlp.bin, args, { timeout: 240000, maxBuffer: 80 * 1024 * 1024 }, (err, _so, se) => {
          if (err) {
            try { fs.unlinkSync(out); } catch (_) {}
            const msg = (se || err.message || '').split('\n').filter(Boolean).slice(-3).join(' ').slice(0, 200);
            return reject(new Error(`[${client}] ${msg}`));
          }
          try {
            const buf = fs.readFileSync(out);
            try { fs.unlinkSync(out); } catch (_) {}
            resolve(buf);
          } catch (e) { reject(e); }
        });
      });
      if (!isAudioBuffer(buf)) throw new Error(`[${client}] output not valid audio (${buf.length} bytes)`);
      return { buf, source: `yt-dlp[${client}]`, mime: 'audio/mpeg' };
    } catch (e) { errs.push((e.message || '').slice(0, 150)); }
  }
  throw new Error('yt-dlp: ' + errs.join(' | '));
}

// ---------------------------------------------------------------------------
// Strategy 2: SoundCloud
//
// SoundCloud does NOT block cloud IPs like YouTube does.
// We search SoundCloud for the same query and download from there.
// Client IDs are extracted from SoundCloud's own JS bundles.
// ---------------------------------------------------------------------------
let _scClientId = null;
let _scClientIdFetched = 0;

async function getSoundCloudClientId() {
  // Cache for 6 hours
  if (_scClientId && Date.now() - _scClientIdFetched < 6 * 3600 * 1000) return _scClientId;
  // Known working client IDs (rotated periodically by SoundCloud)
  const fallbackIds = [
    'iZIs9mchVcX5lhVRyQGGAYlNPVldzAoX',
    'a3e059563d7fd3372b49b37f00a00bcf',
    '2t9loNQH90kzJcsFCODdigxfp325aq4z',
  ];
  try {
    const home = await httpGet('https://soundcloud.com', 3);
    const html = home.body.toString();
    const scripts = [...html.matchAll(/https:\/\/a-v2\.sndcdn\.com\/assets\/[^"' ]+\.js/g)].map(m => m[0]);
    for (const url of scripts.slice(-5)) {
      try {
        const s = await httpGet(url, 3);
        const m = s.body.toString().match(/client_id\s*:\s*"([a-zA-Z0-9]{30,40})"/);
        if (m) {
          _scClientId = m[1];
          _scClientIdFetched = Date.now();
          return _scClientId;
        }
      } catch (_) {}
    }
  } catch (_) {}
  _scClientId = fallbackIds[0];
  _scClientIdFetched = Date.now();
  return _scClientId;
}

async function soundCloudSearch(q) {
  const clientId = await getSoundCloudClientId();
  const r = await httpGet(
    `https://api-v2.soundcloud.com/search/tracks?q=${encodeURIComponent(q)}&client_id=${clientId}&limit=5&offset=0`,
    5,
    { Accept: 'application/json' }
  );
  if (r.status !== 200) throw new Error(`SoundCloud search HTTP ${r.status}`);
  const data = JSON.parse(r.body.toString());
  return (data.collection || []).filter(t => t.streamable && t.duration < 720000);
}

async function downloadWithSoundCloud(query) {
  const clientId = await getSoundCloudClientId();
  const tracks = await soundCloudSearch(query);
  if (!tracks.length) throw new Error('SoundCloud: no results');
  const errs = [];
  for (const track of tracks.slice(0, 3)) {
    try {
      // Get the stream URL
      const streamUrl = track.stream_url
        || track.media?.transcodings?.find(t => t.format?.protocol === 'progressive')?.url;
      if (!streamUrl) continue;
      const resolved = await httpGet(`${streamUrl}?client_id=${clientId}`, 5, { Accept: 'application/json' });
      if (resolved.status !== 200) continue;
      const { url } = JSON.parse(resolved.body.toString());
      if (!url) continue;
      const dl = await httpGet(url, 5);
      if (!isAudioBuffer(dl.body)) continue;
      return {
        buf: dl.body,
        source: `soundcloud(${track.user?.username || 'unknown'})`,
        mime: 'audio/mpeg',
        title: `${track.user?.username || ''} — ${track.title}`,
      };
    } catch (e) { errs.push((e.message || '').slice(0, 80)); }
  }
  throw new Error('SoundCloud: ' + (errs.join(' | ') || 'no playable stream found'));
}

// ---------------------------------------------------------------------------
// Strategy 3: Invidious  — video-id-based audio proxy
// ---------------------------------------------------------------------------
const INVIDIOUS_INSTANCES = [
  'https://inv.nadeko.net',
  'https://inv.thepixora.com',
  'https://invidious.privacyredirect.com',
  'https://yewtu.be',
  'https://iv.ggtyler.dev',
  'https://invidious.fdn.fr',
];

async function downloadWithInvidious(videoUrl) {
  const vid = videoUrl.match(/(?:v=|youtu\.be\/)([A-Za-z0-9_-]{11})/)?.[1];
  if (!vid) throw new Error('invidious: cannot extract video ID');
  const errs = [];
  for (const base of INVIDIOUS_INSTANCES) {
    for (const itag of ['140', '251']) {
      try {
        const r = await httpGet(`${base}/latest_version?id=${vid}&itag=${itag}&local=true`);
        const ct = (r.headers['content-type'] || '').toLowerCase();
        if (ct.includes('html') || ct.includes('json') || ct.includes('text')) {
          errs.push(`${base.split('/')[2]}[${itag}]: got ${ct.split(';')[0]}`);
          continue;
        }
        if (!isAudioBuffer(r.body)) {
          errs.push(`${base.split('/')[2]}[${itag}]: invalid audio (${r.body.length}b)`);
          continue;
        }
        return { buf: r.body, source: `invidious(${base.split('/')[2]})`, mime: itag === '140' ? 'audio/mp4' : 'audio/webm' };
      } catch (e) { errs.push(`${base.split('/')[2]}: ${(e.message || '').slice(0, 50)}`); }
    }
  }
  throw new Error('invidious: ' + errs.join(' | '));
}

// ---------------------------------------------------------------------------
// Strategy 4: Cobalt
// ---------------------------------------------------------------------------
const COBALT_INSTANCES = [
  'https://api.cobalt.tools',
  'https://cobalt.catvibers.me',
  'https://cobalt.zt.ag',
  'https://dl.cgm.rs',
  'https://cobalt.lunar.icu',
  'https://cobalt.api.timelessnesses.me',
];

async function downloadWithCobalt(videoUrl) {
  for (const base of COBALT_INSTANCES) {
    try {
      const body = JSON.stringify({ url: videoUrl, downloadMode: 'audio', audioFormat: 'mp3', filenameStyle: 'basic' });
      const p = new URL(base);
      const res = await new Promise((resolve, reject) => {
        const req = https.request(
          { hostname: p.hostname, path: p.pathname || '/', method: 'POST',
            headers: { 'Content-Type': 'application/json', Accept: 'application/json', 'User-Agent': 'Mozilla/5.0', 'Content-Length': Buffer.byteLength(body) } },
          resp => { const c = []; resp.on('data', d => c.push(d)); resp.on('end', () => resolve({ status: resp.statusCode, body: Buffer.concat(c).toString() })); }
        );
        req.on('error', reject);
        req.setTimeout(20000, () => req.destroy(new Error('timeout')));
        req.write(body); req.end();
      });
      if (res.status !== 200) continue;
      const data = JSON.parse(res.body);
      if (!['tunnel', 'redirect', 'stream'].includes(data.status) || !data.url) continue;
      const dl = await httpGet(data.url);
      if (!isAudioBuffer(dl.body)) continue;
      return { buf: dl.body, source: `cobalt(${p.hostname})`, mime: 'audio/mpeg' };
    } catch (_) {}
  }
  throw new Error('cobalt: all instances failed');
}

// ---------------------------------------------------------------------------
// Video download strategies
// ---------------------------------------------------------------------------

async function downloadVideoWithYtdlp(videoUrl) {
  const ytdlp = await getYtdlp();
  if (!ytdlp) throw new Error('yt-dlp not available');
  const cookiesFile = loadCookies();
  const errs = [];
  for (const { client, ua } of YT_CLIENTS) {
    try {
      const buf = await new Promise((resolve, reject) => {
        const id  = Date.now().toString(36) + Math.random().toString(36).slice(2, 5);
        const out = `/tmp/vid_${id}.mp4`;
        const args = [
          ...ytdlp.prefix,
          // 480p MP4 — small enough for WhatsApp, good quality
          '-f', 'bestvideo[height<=480][ext=mp4]+bestaudio[ext=m4a]/best[height<=480][ext=mp4]/best[height<=480]/best',
          '--merge-output-format', 'mp4',
          '--no-playlist', '--no-warnings', '--no-check-certificate',
          '--extractor-args', `youtube:player_client=${client}`,
          '--user-agent', ua,
          '--max-filesize', '60m',
          '--socket-timeout', '45',
          '--retries', '2',
          ...(cookiesFile ? ['--cookies', cookiesFile] : []),
          '-o', out,
          videoUrl,
        ];
        execFile(ytdlp.bin, args, { timeout: 300000, maxBuffer: 80 * 1024 * 1024 }, (err, _so, se) => {
          if (err) {
            try { fs.unlinkSync(out); } catch (_) {}
            return reject(new Error(`[${client}] ${(se || err.message || '').split('\n').slice(-3).join(' ').slice(0, 200)}`));
          }
          try {
            const buf = fs.readFileSync(out);
            try { fs.unlinkSync(out); } catch (_) {}
            resolve(buf);
          } catch (e) { reject(e); }
        });
      });
      if (!isVideoBuffer(buf)) throw new Error(`[${client}] not valid video (${buf.length} bytes)`);
      if (buf.length > MAX_VIDEO_BYTES) throw new Error(`[${client}] too large for WhatsApp (${(buf.length / 1e6).toFixed(1)} MB)`);
      return { buf, source: `yt-dlp[${client}]`, mime: 'video/mp4' };
    } catch (e) { errs.push((e.message || '').slice(0, 150)); }
  }
  throw new Error('yt-dlp video: ' + errs.join(' | '));
}

async function downloadVideoWithCobalt(videoUrl) {
  const errs = [];
  for (const base of COBALT_INSTANCES) {
    try {
      const body = JSON.stringify({
        url: videoUrl,
        downloadMode: 'auto',
        videoQuality: '480',
        filenameStyle: 'basic',
      });
      const p = new URL(base);
      const res = await new Promise((resolve, reject) => {
        const req = https.request(
          { hostname: p.hostname, path: '/', method: 'POST',
            headers: { 'Content-Type': 'application/json', Accept: 'application/json', 'User-Agent': 'Mozilla/5.0', 'Content-Length': Buffer.byteLength(body) } },
          resp => { const c = []; resp.on('data', d => c.push(d)); resp.on('end', () => resolve({ status: resp.statusCode, body: Buffer.concat(c).toString() })); }
        );
        req.on('error', reject);
        req.setTimeout(30000, () => req.destroy(new Error('timeout')));
        req.write(body); req.end();
      });
      if (res.status !== 200) { errs.push(`${p.hostname}: HTTP ${res.status}`); continue; }
      let data;
      try { data = JSON.parse(res.body); } catch (_) { errs.push(`${p.hostname}: bad JSON`); continue; }
      // status 'tunnel' = Cobalt serves from its own server (cloud-IP safe)
      // status 'redirect' = direct YouTube CDN (may be blocked on Railway)
      if (!data.url) { errs.push(`${p.hostname}: ${data.status || 'no url'} ${data.error?.code || ''}`); continue; }
      const dl = await httpGet(data.url);
      if (!isVideoBuffer(dl.body)) { errs.push(`${p.hostname}: not video (${dl.body.length}b)`); continue; }
      if (dl.body.length > MAX_VIDEO_BYTES) { errs.push(`${p.hostname}: too large`); continue; }
      return { buf: dl.body, source: `cobalt(${p.hostname})`, mime: 'video/mp4' };
    } catch (e) { errs.push(`${new URL(base).hostname}: ${(e.message || '').slice(0, 60)}`); }
  }
  throw new Error('cobalt: ' + errs.join(' | '));
}

// Strategy: @distube/ytdl-core — pure JS, itag 18 = 360p MP4 combined (video+audio, no ffmpeg needed)
async function downloadVideoWithYtdlCore(videoUrl) {
  const ytdl = require('@distube/ytdl-core');
  return new Promise((resolve, reject) => {
    let done = false;
    const chunks = [];
    let totalBytes = 0;
    const timer = setTimeout(() => { if (!done) { done = true; stream.destroy(); reject(new Error('ytdl-core: timeout after 120s')); } }, 120000);
    let stream;
    try {
      stream = ytdl(videoUrl, {
        quality: 18,  // 360p MP4, combined video+audio — works without ffmpeg
        requestOptions: { headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' } },
      });
    } catch (e) { clearTimeout(timer); return reject(new Error('ytdl-core init: ' + (e.message || '').slice(0, 100))); }
    stream.on('data', chunk => {
      totalBytes += chunk.length;
      if (totalBytes > MAX_VIDEO_BYTES) {
        done = true; stream.destroy();
        clearTimeout(timer);
        return reject(new Error(`ytdl-core: file exceeds ${MAX_VIDEO_BYTES / 1e6} MB`));
      }
      chunks.push(chunk);
    });
    stream.on('end', () => {
      if (done) return;
      done = true; clearTimeout(timer);
      const buf = Buffer.concat(chunks);
      if (!isVideoBuffer(buf)) return reject(new Error(`ytdl-core: not valid video (${buf.length}b)`));
      resolve({ buf, source: 'ytdl-core(360p)', mime: 'video/mp4' });
    });
    stream.on('error', e => {
      if (done) return;
      done = true; clearTimeout(timer);
      reject(new Error('ytdl-core: ' + (e.message || '').slice(0, 150)));
    });
  });
}

// Invidious video — itag 18 = 360p MP4, itag 22 = 720p MP4 (may exceed size limit)
async function downloadVideoWithInvidious(videoUrl) {
  const vid = videoUrl.match(/(?:v=|youtu\.be\/)([A-Za-z0-9_-]{11})/)?.[1];
  if (!vid) throw new Error('cannot extract video ID');
  const errs = [];
  for (const base of INVIDIOUS_INSTANCES) {
    for (const itag of ['18', '22']) {
      try {
        const r = await httpGet(`${base}/latest_version?id=${vid}&itag=${itag}&local=true`);
        const ct = (r.headers['content-type'] || '').toLowerCase();
        if (ct.includes('html') || ct.includes('json') || ct.includes('text')) continue;
        if (!isVideoBuffer(r.body)) continue;
        if (r.body.length > MAX_VIDEO_BYTES) continue;
        return { buf: r.body, source: `invidious(${base.split('/')[2]})`, mime: 'video/mp4' };
      } catch (e) { errs.push(`${base.split('/')[2]}[${itag}]: ${(e.message || '').slice(0, 50)}`); }
    }
  }
  throw new Error('invidious video: ' + errs.join(' | '));
}

// ffmpeg: re-encode to H.264/AAC MP4 that WhatsApp accepts
function toMp4(buf, mime) {
  if ((mime || '').includes('mp4') && buf.length <= MAX_VIDEO_BYTES) return Promise.resolve(buf);
  return new Promise((resolve, reject) => {
    const id  = Date.now().toString(36) + Math.random().toString(36).slice(2, 5);
    const ext = (mime || '').includes('webm') ? 'webm' : 'mkv';
    const inp = `/tmp/vid_${id}.${ext}`;
    const out = `/tmp/vid_${id}.mp4`;
    fs.writeFileSync(inp, buf);
    execFile('ffmpeg', [
      '-y', '-i', inp,
      '-vf', 'scale=trunc(oh*a/2)*2:480',   // 480p, keep aspect ratio
      '-c:v', 'libx264', '-preset', 'fast', '-crf', '28',
      '-c:a', 'aac', '-b:a', '96k',
      '-movflags', '+faststart',              // streaming-ready
      '-fs', String(MAX_VIDEO_BYTES),         // hard size cap
      out,
    ], { timeout: 240000, maxBuffer: 100 * 1024 * 1024 }, err => {
      try { fs.unlinkSync(inp); } catch (_) {}
      if (err) {
        try { fs.unlinkSync(out); } catch (_) {}
        return reject(new Error('ffmpeg: ' + (err.message || '').slice(0, 150)));
      }
      try {
        const mp4 = fs.readFileSync(out);
        try { fs.unlinkSync(out); } catch (_) {}
        if (!isVideoBuffer(mp4)) return reject(new Error('ffmpeg: output not valid video'));
        resolve(mp4);
      } catch (e) { reject(e); }
    });
  });
}

// ---------------------------------------------------------------------------
// Audio + YouTube thumbnail → MP4 via ffmpeg
// Works 100% on Railway: audio from SoundCloud, thumb from YouTube CDN (public)
// ---------------------------------------------------------------------------
function combineAudioThumb(audioBuf, thumbBuf, audioMime) {
  return new Promise((resolve, reject) => {
    const id   = Date.now().toString(36) + Math.random().toString(36).slice(2, 5);
    const aExt = audioMime?.includes('webm') ? 'webm' : audioMime?.includes('ogg') ? 'ogg' : audioMime?.includes('m4a') ? 'm4a' : 'mp3';
    const aIn  = `/tmp/vaud_${id}.${aExt}`;
    const tIn  = `/tmp/vtmb_${id}.jpg`;
    const out  = `/tmp/vout_${id}.mp4`;
    fs.writeFileSync(aIn, audioBuf);
    fs.writeFileSync(tIn, thumbBuf);
    execFile('ffmpeg', [
      '-y',
      '-loop', '1', '-i', tIn,          // looping thumbnail as video source
      '-i', aIn,                          // audio
      '-c:v', 'libx264', '-tune', 'stillimage', '-preset', 'fast', '-crf', '28',
      '-vf', 'scale=1280:720:force_original_aspect_ratio=decrease,pad=1280:720:(ow-iw)/2:(oh-ih)/2,format=yuv420p',
      '-c:a', 'aac', '-b:a', '128k',
      '-shortest',                        // stop when audio ends
      '-movflags', '+faststart',
      out,
    ], { timeout: 300000, maxBuffer: 100 * 1024 * 1024 }, err => {
      try { fs.unlinkSync(aIn); } catch (_) {}
      try { fs.unlinkSync(tIn); } catch (_) {}
      if (err) {
        try { fs.unlinkSync(out); } catch (_) {}
        return reject(new Error('ffmpeg combineAudioThumb: ' + (err.message || '').slice(0, 150)));
      }
      try {
        const mp4 = fs.readFileSync(out);
        try { fs.unlinkSync(out); } catch (_) {}
        if (!isVideoBuffer(mp4)) return reject(new Error('ffmpeg: output not valid video'));
        resolve(mp4);
      } catch (e) { reject(e); }
    });
  });
}

async function downloadVideoAsAudioThumb(query, videoId) {
  // 1. Get audio via SoundCloud (same path that powers .play — works on Railway)
  const audio = await downloadWithSoundCloud(query);

  // 2. Get YouTube thumbnail (maxresdefault → hqdefault fallback)
  let thumbBuf;
  for (const q of ['maxresdefault', 'hqdefault', 'sddefault']) {
    try {
      const r = await httpGet(`https://img.youtube.com/vi/${videoId}/${q}.jpg`);
      if (r.status === 200 && r.body.length > 2000) { thumbBuf = r.body; break; }
    } catch (_) {}
  }
  if (!thumbBuf) throw new Error('could not fetch YouTube thumbnail');

  // 3. Merge
  const mp4 = await combineAudioThumb(audio.buf, thumbBuf, audio.mime);
  return { buf: mp4, source: 'audio+thumb', mime: 'video/mp4' };
}

async function downloadVideo(query, videoUrl, videoId) {
  const errs = [];

  // 1. yt-dlp real video (works when installed)
  try { return await downloadVideoWithYtdlp(videoUrl); }
  catch (e) { errs.push(`yt-dlp: ${(e.message || '').slice(0, 120)}`); }

  // 2. ytdl-core pure JS — itag 18 = 360p MP4 combined, no ffmpeg needed
  try { return await downloadVideoWithYtdlCore(videoUrl); }
  catch (e) { errs.push(`ytdl-core: ${(e.message || '').slice(0, 120)}`); }

  // 3. Cobalt — 'tunnel' responses go through Cobalt servers (not YouTube CDN), safe on Railway
  try { return await downloadVideoWithCobalt(videoUrl); }
  catch (e) { errs.push(`cobalt: ${(e.message || '').slice(0, 120)}`); }

  // 4. Invidious proxy
  try { return await downloadVideoWithInvidious(videoUrl); }
  catch (e) { errs.push(`invidious: ${(e.message || '').slice(0, 120)}`); }

  // 5. Last resort: audio + static thumbnail (honest fallback)
  try { return await downloadVideoAsAudioThumb(query, videoId); }
  catch (e) { errs.push(`audio+thumb: ${(e.message || '').slice(0, 120)}`); }

  throw new Error(errs.join('\n'));
}

// ---------------------------------------------------------------------------
// Main download orchestrator
// ---------------------------------------------------------------------------
async function downloadAudio(query, videoUrl) {
  const errs = [];

  // 1. yt-dlp (python3 -m yt_dlp first, then binary)
  try { return await downloadWithYtdlp(videoUrl); }
  catch (e) { errs.push('yt-dlp: ' + (e.message || '').slice(0, 150)); }

  // 2. SoundCloud — cloud-IP friendly, doesn't block Railway
  try { return await downloadWithSoundCloud(query); }
  catch (e) { errs.push('soundcloud: ' + (e.message || '').slice(0, 100)); }

  // 3. Invidious proxy
  try { return await downloadWithInvidious(videoUrl); }
  catch (e) { errs.push('invidious: ' + (e.message || '').slice(0, 100)); }

  // 4. Cobalt
  try { return await downloadWithCobalt(videoUrl); }
  catch (e) { errs.push('cobalt: ' + (e.message || '').slice(0, 100)); }

  throw new Error(errs.join('\n'));
}

// ---------------------------------------------------------------------------
// ffmpeg: convert non-MP3 audio → MP3
// ---------------------------------------------------------------------------
function toMp3(buf, mime) {
  if (!mime || mime.includes('mpeg') || mime.includes('mp3')) return Promise.resolve(buf);
  return new Promise((resolve, reject) => {
    const id  = Date.now().toString(36) + Math.random().toString(36).slice(2, 5);
    const ext = mime.includes('webm') ? 'webm' : 'm4a';
    const inp = `/tmp/play_${id}.${ext}`;
    const out = `/tmp/play_${id}.mp3`;
    fs.writeFileSync(inp, buf);
    execFile('ffmpeg', ['-y', '-i', inp, '-vn', '-ar', '44100', '-ac', '2', '-b:a', '128k', out],
      { timeout: 120000, maxBuffer: 80 * 1024 * 1024 },
      err => {
        try { fs.unlinkSync(inp); } catch (_) {}
        if (err) {
          try { fs.unlinkSync(out); } catch (_) {}
          return reject(new Error('ffmpeg: ' + (err.message || '').slice(0, 150)));
        }
        try {
          const mp3 = fs.readFileSync(out);
          try { fs.unlinkSync(out); } catch (_) {}
          if (!isAudioBuffer(mp3)) return reject(new Error('ffmpeg: output not valid audio'));
          resolve(mp3);
        } catch (e) { reject(e); }
      }
    );
  });
}

// ---------------------------------------------------------------------------
// Lyrics
// ---------------------------------------------------------------------------
async function fetchLyrics(q) {
  const parts  = q.split(/\s*-\s*/);
  const artist = parts.length > 1 ? parts[0].trim() : '';
  const song   = (parts.length > 1 ? parts.slice(1).join(' - ') : q).trim();
  const tryJson = async url => {
    try { const r = await httpGet(url); return r.status === 200 ? JSON.parse(r.body.toString()) : null; }
    catch (_) { return null; }
  };
  const d1 = await tryJson(`https://lrclib.net/api/search?q=${encodeURIComponent(q)}`);
  if (Array.isArray(d1)) {
    const h = d1.find(x => x.plainLyrics || x.syncedLyrics);
    if (h) {
      const text = h.plainLyrics || (h.syncedLyrics || '').replace(/\[\d{2}:\d{2}(?:\.\d+)?\]/g, '').trim();
      if (text) return { text, title: `${h.artistName} — ${h.trackName}` };
    }
  }
  if (artist && song) {
    const d2 = await tryJson(`https://lrclib.net/api/get?artist_name=${encodeURIComponent(artist)}&track_name=${encodeURIComponent(song)}`);
    if (d2?.plainLyrics) return { text: d2.plainLyrics, title: `${d2.artistName} — ${d2.trackName}` };
  }
  const d3 = await tryJson(`https://some-random-api.com/lyrics?title=${encodeURIComponent(q)}`);
  if (d3?.lyrics) return { text: d3.lyrics, title: d3.title ? `${d3.author || ''} — ${d3.title}` : null };
  return null;
}

// ---------------------------------------------------------------------------
// Commands
// ---------------------------------------------------------------------------
module.exports = [
  {
    name: 'play',
    aliases: ['song', 'mp3', 'ytmp3'],
    description: 'Search YouTube and send audio for a song',
    handler: async ({ argText, sock, jid, m, reply }) => {
      if (!argText) return reply('Usage: .play <song name>');

      await reply(`🔎 Searching *${argText}*...`);

      const r = await ytSearch(argText);
      const v = r.videos.length ? pickBest(r.videos, argText) : null;
      if (!v) return reply('❌ No results found on YouTube.');

      await reply(`🎵 Found: *${v.title}*\nDownloading audio…`);

      let result;
      try {
        result = await downloadAudio(argText, v.url);
      } catch (e) {
        return reply(`❌ Download failed:\n_${e.message?.slice(0, 500)}_`);
      }

      let { buf, source, mime } = result;

      try {
        buf = await toMp3(buf, mime);
      } catch (e) {
        return reply(`❌ Conversion failed:\n_${e.message?.slice(0, 200)}_`);
      }

      const displayTitle = result.title || `${v.title}\n${v.author?.name || ''} · ${v.timestamp || ''}`;
      await sock.sendMessage(jid, { audio: buf, mimetype: 'audio/mpeg', ptt: false }, { quoted: m });
      await reply(`🎵 *${displayTitle}*\n_via ${source}_`);
    },
  },

  {
    name: 'ytdlpcheck',
    aliases: ['musiccheck'],
    description: 'Diagnose yt-dlp and SoundCloud availability',
    handler: async ({ reply }) => {
      const ytdlp = await getYtdlp();
      let ytdlpStatus = '❌ not found';
      if (ytdlp) {
        const ver = await new Promise(r =>
          execFile(ytdlp.bin, [...ytdlp.prefix, '--version'], { timeout: 8000 }, (e, o) => r(e ? 'error' : o.trim()))
        );
        const mode = ytdlp.prefix.length ? `python3 -m yt_dlp` : ytdlp.bin;
        ytdlpStatus = `✅ ${mode} (${ver})`;
      }
      let scStatus = '❌ failed';
      try {
        const id = await getSoundCloudClientId();
        scStatus = `✅ client_id: ${id.slice(0, 8)}…`;
      } catch (_) {}
      const cookies = loadCookies();
      reply(
        `*Music Diagnostics*\n\n` +
        `yt-dlp: ${ytdlpStatus}\n` +
        `SoundCloud: ${scStatus}\n` +
        `Cookies: ${cookies ? `✅ \`${cookies}\`` : '❌ not set'}`
      );
    },
  },

  {
    name: 'ytsearch',
    aliases: ['ysearch'],
    description: 'Show YouTube search results',
    handler: async ({ argText, reply }) => {
      if (!argText) return reply('Usage: .ytsearch <query>');
      const r = await ytSearch(argText);
      const top = r.videos.slice(0, 6);
      if (!top.length) return reply('Nothing found.');
      reply(top.map(v => `• ${v.title}\n  ${v.timestamp || ''} · ${v.author?.name || ''}\n  ${v.url}`).join('\n\n'));
    },
  },

  {
    name: 'lyrics',
    description: 'Fetch song lyrics',
    handler: async ({ argText, reply }) => {
      if (!argText) return reply('Usage: .lyrics <song>  or  .lyrics Artist - Song');
      const r = await fetchLyrics(argText);
      if (!r) return reply('No lyrics found.');
      const header = r.title ? `🎤 *${r.title}*\n\n` : '';
      const body   = r.text.length > 3500 ? r.text.slice(0, 3500) + '\n\n_…truncated_' : r.text;
      reply(header + body);
    },
  },

  {
    name: 'video',
    aliases: ['ytmp4', 'vid', 'yvideo'],
    description: 'Search YouTube and send a video (480p, max 60 MB)',
    handler: async ({ argText, sock, jid, m, reply }) => {
      if (!argText) return reply('Usage: .video <song or video name>');

      await reply(`🔎 Searching *${argText}*...`);

      const r = await ytSearch(argText);
      const v = r.videos.length ? pickBest(r.videos, argText) : null;
      if (!v) return reply('❌ No results found on YouTube.');

      // Warn early if video is very long
      const dur = v.duration?.seconds || 0;
      if (dur > 600) return reply(`❌ *${v.title}* is ${v.timestamp} — too long for WhatsApp video.\nTry *.play* to get audio only.`);

      // Extract YouTube video ID
      const videoId = v.url.match(/(?:v=|youtu\.be\/)([A-Za-z0-9_-]{11})/)?.[1] || '';

      await reply(`🎬 Found: *${v.title}*\nGenerating video…`);

      let result;
      try {
        result = await downloadVideo(argText, v.url, videoId);
      } catch (e) {
        return reply(`❌ Video download failed:\n_${e.message?.slice(0, 500)}_`);
      }

      let { buf, source, mime } = result;

      // Re-encode to standard MP4 if needed
      if (!mime?.includes('mp4')) {
        try { buf = await toMp4(buf, mime); }
        catch (e) { return reply(`❌ Conversion failed:\n_${e.message?.slice(0, 200)}_`); }
      }

      if (buf.length > MAX_VIDEO_BYTES) {
        return reply(`❌ File too large (${(buf.length / 1e6).toFixed(1)} MB). WhatsApp limit is 60 MB.\nTry *.play* for audio only.`);
      }

      await sock.sendMessage(
        jid,
        { video: buf, mimetype: 'video/mp4', caption: `${source === 'audio+thumb' ? '🎵' : '🎬'} *${v.title}*\n${v.author?.name || ''} · ${v.timestamp || ''}${source === 'audio+thumb' ? '\n_Official Audio (real video unavailable on this server)_' : `\n_via ${source}_`}` },
        { quoted: m }
      );
    },
  },

  {
    name: 'ringtone',
    description: 'Ringtone search link',
    handler: async ({ argText, reply }) =>
      reply(`https://www.zedge.net/find/ringtones/${encodeURIComponent(argText || 'top')}`),
  },

  {
    name: 'scloud',
    description: 'SoundCloud search link',
    handler: async ({ argText, reply }) =>
      reply(`https://soundcloud.com/search?q=${encodeURIComponent(argText || 'top')}`),
  },
];

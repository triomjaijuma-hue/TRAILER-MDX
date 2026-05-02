'use strict';
const yts       = require('yt-search');
const https     = require('https');
const http      = require('http');
const { execFile, exec } = require('child_process');
const fs        = require('fs');
const path      = require('path');
const helpers   = require('../../lib/helpers');
const config    = require('../../lib/config');

const MIN_AUDIO_BYTES = 50 * 1024; // 50 KB — anything smaller is an error page or stub

// ---------------------------------------------------------------------------
// Magic-byte audio validation — rejects HTML pages, JSON errors, stubs
// ---------------------------------------------------------------------------
function isAudioBuffer(buf) {
  if (!buf || buf.length < MIN_AUDIO_BYTES) return false;
  // ID3-tagged MP3
  if (buf[0] === 0x49 && buf[1] === 0x44 && buf[2] === 0x33) return true;
  // MPEG sync (MP3 without ID3)
  if (buf[0] === 0xFF && (buf[1] & 0xE0) === 0xE0) return true;
  // M4A / MP4 — 'ftyp' at offset 4
  if (buf.length > 11 && buf.slice(4, 8).toString('ascii') === 'ftyp') return true;
  // WebM / Matroska (EBML header)
  if (buf[0] === 0x1A && buf[1] === 0x45 && buf[2] === 0xDF && buf[3] === 0xA3) return true;
  // OGG
  if (buf.slice(0, 4).toString('ascii') === 'OggS') return true;
  // WAV
  if (buf.slice(0, 4).toString('ascii') === 'RIFF') return true;
  // FLAC
  if (buf.slice(0, 4).toString('ascii') === 'fLaC') return true;
  return false;
}

// ---------------------------------------------------------------------------
// Shared HTTP helper — returns status, headers, and body
// ---------------------------------------------------------------------------
function httpGet(url, maxRedir) {
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
        headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' },
        timeout: 30000,
      },
      res => {
        if ([301, 302, 307, 308].includes(res.statusCode) && res.headers.location) {
          return maxRedir > 0
            ? resolve(httpGet(res.headers.location, maxRedir - 1))
            : reject(new Error('too many redirects'));
        }
        const chunks = [];
        res.on('data', d => chunks.push(d));
        res.on('end', () => resolve({
          status: res.statusCode,
          headers: res.headers,
          body: Buffer.concat(chunks),
        }));
        res.on('error', reject);
      }
    );
    req.on('error', reject);
    req.on('timeout', () => req.destroy(new Error('request timeout')));
  });
}

// ---------------------------------------------------------------------------
// YouTube search
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
// Strategy 1: yt-dlp  — installed via nixpacks / pip / postinstall.js
// Downloads directly as MP3 to skip ffmpeg re-encode step entirely.
// ---------------------------------------------------------------------------
let _ytdlpBin = null;
async function getYtdlp() {
  if (_ytdlpBin) return _ytdlpBin;
  const candidates = [
    process.env.YTDLP_BIN,
    '/usr/local/bin/yt-dlp',                         // Docker pip install
    path.join(__dirname, '../../../bin/yt-dlp'),      // postinstall.js download
    '/root/.nix-profile/bin/yt-dlp',                 // nixpacks profile
    '/nix/var/nix/profiles/default/bin/yt-dlp',
    '/home/user/.nix-profile/bin/yt-dlp',
    '/usr/bin/yt-dlp',
    '/bin/yt-dlp',
    '/tmp/yt-dlp',
  ].filter(Boolean);
  for (const p of candidates) {
    try { fs.accessSync(p, fs.constants.X_OK); _ytdlpBin = p; return p; } catch (_) {}
  }
  const fromPath = await new Promise(r =>
    exec('which yt-dlp 2>/dev/null || command -v yt-dlp 2>/dev/null', { timeout: 8000 },
      (e, o) => r((o || '').trim() || null))
  );
  if (fromPath) { _ytdlpBin = fromPath; return fromPath; }
  const fromNix = await new Promise(r =>
    exec('find /nix /run -name yt-dlp -type f 2>/dev/null | head -1', { timeout: 30000 },
      (e, o) => r((o || '').trim() || null))
  );
  if (fromNix) { _ytdlpBin = fromNix; return fromNix; }
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
  const bin = await getYtdlp();
  if (!bin) throw new Error('yt-dlp: binary not found');
  const cookiesFile = loadCookies();
  const errs = [];
  for (const { client, ua } of YT_CLIENTS) {
    try {
      const buf = await new Promise((resolve, reject) => {
        const id  = Date.now().toString(36) + Math.random().toString(36).slice(2, 5);
        const out = `/tmp/yt_${id}.mp3`;
        // -x --audio-format mp3: extract audio and encode as MP3 inside yt-dlp itself
        const args = [
          '-x', '--audio-format', 'mp3', '--audio-quality', '128K',
          '--no-playlist', '--no-warnings', '--no-check-certificate',
          '--extractor-args', `youtube:player_client=${client}`,
          '--user-agent', ua,
          '--max-filesize', '75m',
          '--socket-timeout', '45',
          '--retries', '2',
          ...(cookiesFile ? ['--cookies', cookiesFile] : []),
          '-o', out,
          videoUrl,
        ];
        execFile(bin, args, { timeout: 240000, maxBuffer: 80 * 1024 * 1024 }, (err, _so, se) => {
          if (err) {
            try { fs.unlinkSync(out); } catch (_) {}
            const msg = (se || err.message || '').split('\n').filter(Boolean).slice(-3).join(' ').slice(0, 250);
            return reject(new Error(msg || err.message));
          }
          try {
            // yt-dlp may rename .mp3 from .m4a — look for any mp3 with matching id
            let finalPath = out;
            if (!fs.existsSync(out)) {
              const tmp = `/tmp`;
              const match = fs.readdirSync(tmp).find(f => f.startsWith(`yt_${id}`) && f.endsWith('.mp3'));
              if (match) finalPath = path.join(tmp, match);
            }
            const buf = fs.readFileSync(finalPath);
            fs.unlinkSync(finalPath);
            resolve(buf);
          } catch (e) { reject(e); }
        });
      });
      if (!isAudioBuffer(buf)) throw new Error(`yt-dlp[${client}]: output is not valid audio (${buf.length} bytes)`);
      return { buf, source: `yt-dlp[${client}]`, mime: 'audio/mpeg' };
    } catch (e) { errs.push(`[${client}]: ${(e.message || '').slice(0, 120)}`); }
  }
  throw new Error('yt-dlp ' + errs.join(' | '));
}

// ---------------------------------------------------------------------------
// Strategy 2: Invidious  — proxies audio through Invidious servers.
// The 'local=true' flag makes Invidious stream the bytes to us, so
// Railway's cloud IP never touches YouTube CDN directly.
// ---------------------------------------------------------------------------
const INVIDIOUS_INSTANCES = [
  'https://inv.nadeko.net',
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
        // Reject HTML pages (Cloudflare challenges, error pages, etc.)
        if (ct.includes('html') || ct.includes('json')) {
          errs.push(`invidious[${itag}@${base.split('/')[2]}]: got ${ct}`);
          continue;
        }
        if (!isAudioBuffer(r.body)) {
          errs.push(`invidious[${itag}@${base.split('/')[2]}]: invalid audio (${r.body.length} bytes)`);
          continue;
        }
        return { buf: r.body, source: `invidious(${base.split('/')[2]})`, mime: itag === '140' ? 'audio/mp4' : 'audio/webm' };
      } catch (e) { errs.push(`invidious[${itag}@${base.split('/')[2]}]: ${(e.message || '').slice(0, 60)}`); }
    }
  }
  throw new Error(errs.join(' | ') || 'invidious: all instances failed');
}

// ---------------------------------------------------------------------------
// Strategy 3: Piped API  — open-source YouTube frontend with audio proxying
// ---------------------------------------------------------------------------
const PIPED_INSTANCES = [
  'https://pipedapi.kavin.rocks',
  'https://piped-api.garudalinux.org',
  'https://api.piped.projectsegfau.lt',
];

async function downloadWithPiped(videoUrl) {
  const vid = videoUrl.match(/(?:v=|youtu\.be\/)([A-Za-z0-9_-]{11})/)?.[1];
  if (!vid) throw new Error('piped: cannot extract video ID');
  for (const base of PIPED_INSTANCES) {
    try {
      const r = await httpGet(`${base}/streams/${vid}`);
      if (r.status !== 200) continue;
      const data = JSON.parse(r.body.toString());
      const streams = (data.audioStreams || []).sort((a, b) => (b.bitrate || 0) - (a.bitrate || 0));
      for (const s of streams) {
        if (!s.url) continue;
        try {
          const dl = await httpGet(s.url);
          const ct = (dl.headers['content-type'] || '').toLowerCase();
          if (ct.includes('html')) continue;
          if (!isAudioBuffer(dl.body)) continue;
          return { buf: dl.body, source: `piped(${base.split('/')[2]})`, mime: s.mimeType || 'audio/mp4' };
        } catch (_) {}
      }
    } catch (_) {}
  }
  throw new Error('piped: all instances failed');
}

// ---------------------------------------------------------------------------
// Strategy 4: Cobalt  — handles YouTube bot-check via external service
// ---------------------------------------------------------------------------
const COBALT_INSTANCES = [
  'https://api.cobalt.tools',
  'https://cobalt.catvibers.me',
];

async function downloadWithCobalt(videoUrl) {
  for (const base of COBALT_INSTANCES) {
    try {
      const body = JSON.stringify({ url: videoUrl, downloadMode: 'audio', audioFormat: 'mp3', filenameStyle: 'basic' });
      const p = new URL(base);
      const res = await new Promise((resolve, reject) => {
        const req = https.request(
          {
            hostname: p.hostname,
            path: p.pathname || '/',
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Accept: 'application/json',
              'User-Agent': 'Mozilla/5.0',
              'Content-Length': Buffer.byteLength(body),
            },
          },
          resp => {
            const chunks = [];
            resp.on('data', c => chunks.push(c));
            resp.on('end', () => resolve({ status: resp.statusCode, body: Buffer.concat(chunks).toString() }));
          }
        );
        req.on('error', reject);
        req.setTimeout(20000, () => req.destroy(new Error('cobalt timeout')));
        req.write(body);
        req.end();
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
// Main download orchestrator
// ---------------------------------------------------------------------------
async function downloadAudio(url) {
  const errs = [];
  for (const [label, fn] of [
    ['yt-dlp',    () => downloadWithYtdlp(url)],
    ['invidious', () => downloadWithInvidious(url)],
    ['piped',     () => downloadWithPiped(url)],
    ['cobalt',    () => downloadWithCobalt(url)],
  ]) {
    try { return await fn(); }
    catch (e) { errs.push(`${label}: ${(e.message || '').slice(0, 150)}`); }
  }
  throw new Error(errs.join('\n'));
}

// ---------------------------------------------------------------------------
// ffmpeg: convert any audio buffer → MP3 (only called for non-MP3 sources)
// ---------------------------------------------------------------------------
function toMp3(buf, mime) {
  // Already MP3 — skip conversion
  if ((mime || '').includes('mpeg') || (mime || '').includes('mp3')) return Promise.resolve(buf);
  return new Promise((resolve, reject) => {
    const id  = Date.now().toString(36) + Math.random().toString(36).slice(2, 5);
    const ext = (mime || '').includes('webm') ? 'webm' : 'm4a';
    const inp = `/tmp/play_${id}.${ext}`;
    const out = `/tmp/play_${id}.mp3`;
    fs.writeFileSync(inp, buf);
    execFile(
      'ffmpeg',
      ['-y', '-i', inp, '-vn', '-ar', '44100', '-ac', '2', '-b:a', '128k', out],
      { timeout: 120000, maxBuffer: 80 * 1024 * 1024 },
      err => {
        try { fs.unlinkSync(inp); } catch (_) {}
        if (err) {
          try { fs.unlinkSync(out); } catch (_) {}
          return reject(new Error('ffmpeg conversion failed: ' + (err.message || '').slice(0, 200)));
        }
        try {
          const mp3 = fs.readFileSync(out);
          fs.unlinkSync(out);
          if (!isAudioBuffer(mp3)) return reject(new Error('ffmpeg: output is not valid audio'));
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
  const tryUrl = async url => {
    try { const r = await httpGet(url); return r.status === 200 ? JSON.parse(r.body.toString()) : null; }
    catch (_) { return null; }
  };
  const d1 = await tryUrl(`https://lrclib.net/api/search?q=${encodeURIComponent(q)}`);
  if (Array.isArray(d1)) {
    const h = d1.find(x => x.plainLyrics || x.syncedLyrics);
    if (h) {
      const text = h.plainLyrics || (h.syncedLyrics || '').replace(/\[\d{2}:\d{2}(?:\.\d+)?\]/g, '').trim();
      if (text) return { text, title: `${h.artistName} — ${h.trackName}` };
    }
  }
  if (artist && song) {
    const d2 = await tryUrl(`https://lrclib.net/api/get?artist_name=${encodeURIComponent(artist)}&track_name=${encodeURIComponent(song)}`);
    if (d2?.plainLyrics) return { text: d2.plainLyrics, title: `${d2.artistName} — ${d2.trackName}` };
  }
  const d3 = await tryUrl(`https://some-random-api.com/lyrics?title=${encodeURIComponent(q)}`);
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

      let buf, source, mime;
      try {
        ({ buf, source, mime } = await downloadAudio(v.url));
      } catch (e) {
        return reply(`❌ Download failed:\n_${e.message?.slice(0, 500)}_`);
      }

      // Convert to MP3 only if the source isn't already MP3
      let finalBuf;
      try {
        finalBuf = await toMp3(buf, mime);
      } catch (e) {
        return reply(`❌ Audio conversion failed:\n_${e.message?.slice(0, 300)}_`);
      }

      await sock.sendMessage(jid, { audio: finalBuf, mimetype: 'audio/mpeg', ptt: false }, { quoted: m });
      await reply(`🎵 *${v.title}*\n${v.author?.name || ''} · ${v.timestamp || ''}\n_via ${source}_`);
    },
  },

  {
    name: 'ytdlpcheck',
    aliases: ['musiccheck'],
    description: 'Diagnose yt-dlp availability and audio validation',
    handler: async ({ reply }) => {
      const bin = await getYtdlp();
      if (!bin) return reply('❌ yt-dlp *not found*.\n\nCheck Railway build logs — nixpacks or postinstall may have failed.');
      const ver = await new Promise(r =>
        execFile(bin, ['--version'], { timeout: 8000 }, (e, o) => r(e ? 'error: ' + e.message : o.trim()))
      );
      const cookies = loadCookies();
      reply(
        `*Music Diagnostics*\n\n` +
        `yt-dlp: ✅ \`${bin}\`\n` +
        `Version: ${ver}\n` +
        `Cookies: ${cookies ? `✅ \`${cookies}\`` : '❌ not set (set YOUTUBE_COOKIES env var if blocked)'}\n` +
        `Min audio size: ${MIN_AUDIO_BYTES / 1024} KB`
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

'use strict';
const yts       = require('yt-search');
const https     = require('https');
const http      = require('http');
const { execFile, exec } = require('child_process');
const fs        = require('fs');
const path      = require('path');
const helpers   = require('../../lib/helpers');
const config    = require('../../lib/config');

// ---------------------------------------------------------------------------
// Shared HTTP helpers
// ---------------------------------------------------------------------------
function httpsGet(url, maxRedir) {
  maxRedir = maxRedir == null ? 8 : maxRedir;
  return new Promise((resolve, reject) => {
    let p;
    try { p = new URL(url); } catch (e) { return reject(e); }
    const mod = p.protocol === 'http:' ? http : https;
    mod.get(
      {
        hostname: p.hostname,
        port: p.port || undefined,
        path: p.pathname + p.search,
        headers: { 'User-Agent': 'Mozilla/5.0' },
        timeout: 30000,
      },
      res => {
        if ([301, 302, 307, 308].includes(res.statusCode) && res.headers.location) {
          return maxRedir > 0
            ? resolve(httpsGet(res.headers.location, maxRedir - 1))
            : reject(new Error('too many redirects'));
        }
        const chunks = [];
        res.on('data', d => chunks.push(d));
        res.on('end', () => resolve({ status: res.statusCode, body: Buffer.concat(chunks) }));
        res.on('error', reject);
      }
    ).on('error', reject).on('timeout', function () { this.destroy(new Error('request timeout')); });
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
  const r = await httpsGet(`https://www.youtube.com/results?search_query=${encodeURIComponent(q)}`);
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
// Strategy 1: yt-dlp  (installed by nixpacks, pip, and postinstall.js)
// This is the most reliable option when running on Railway.
// ---------------------------------------------------------------------------
let _ytdlpBin = null;
async function getYtdlp() {
  if (_ytdlpBin) return _ytdlpBin;
  const candidates = [
    process.env.YTDLP_BIN,
    '/usr/local/bin/yt-dlp',                          // Docker pip install
    path.join(__dirname, '../../../bin/yt-dlp'),       // postinstall download
    '/root/.nix-profile/bin/yt-dlp',                  // nixpacks profile
    '/nix/var/nix/profiles/default/bin/yt-dlp',
    '/home/user/.nix-profile/bin/yt-dlp',
    '/usr/bin/yt-dlp',
    '/bin/yt-dlp',
    '/tmp/yt-dlp',
  ].filter(Boolean);

  for (const p of candidates) {
    try { fs.accessSync(p, fs.constants.X_OK); _ytdlpBin = p; return p; } catch (_) {}
  }
  // Search PATH
  const fromPath = await new Promise(r =>
    exec('which yt-dlp 2>/dev/null || command -v yt-dlp 2>/dev/null', { timeout: 8000 },
      (e, o) => r((o || '').trim() || null))
  );
  if (fromPath) { _ytdlpBin = fromPath; return fromPath; }
  // Deep nix store search
  const fromNix = await new Promise(r =>
    exec('find /nix /run -name yt-dlp -type f 2>/dev/null | head -1', { timeout: 30000 },
      (e, o) => r((o || '').trim() || null))
  );
  if (fromNix) { _ytdlpBin = fromNix; return fromNix; }
  return null;
}
// Warm up early so first .play doesn't pay the search cost
getYtdlp().catch(() => {});

const YT_CLIENTS = [
  { client: 'ios',         ua: 'com.google.ios.youtube/19.45.4 (iPhone16,2; U; CPU iPhone OS 18_1_0 like Mac OS X)' },
  { client: 'tv_embedded', ua: 'Mozilla/5.0 (SMART-TV; Linux; Tizen 6.0) AppleWebKit/538.1' },
  { client: 'web',         ua: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' },
];

async function downloadWithYtdlp(videoUrl) {
  const bin = await getYtdlp();
  if (!bin) throw new Error('yt-dlp binary not found');

  // Load cookies if available
  let cookiesFile = null;
  const cookieCandidates = [
    '/tmp/yt-cookies.txt',
    path.join(__dirname, '../../../cookies.txt'),
  ];
  for (const f of cookieCandidates) {
    if (fs.existsSync(f) && fs.statSync(f).size > 0) { cookiesFile = f; break; }
  }
  if (!cookiesFile) {
    const b64 = process.env.YOUTUBE_COOKIES || process.env.YT_COOKIES;
    if (b64) {
      try {
        const decoded = Buffer.from(b64, 'base64').toString('utf8');
        if (decoded.includes('youtube.com')) {
          fs.writeFileSync('/tmp/yt-cookies.txt', decoded);
          cookiesFile = '/tmp/yt-cookies.txt';
        }
      } catch (_) {}
    }
  }

  const errs = [];
  for (const { client, ua } of YT_CLIENTS) {
    try {
      return await new Promise((resolve, reject) => {
        const id  = Date.now().toString(36) + Math.random().toString(36).slice(2, 5);
        const out = `/tmp/yt_${id}.m4a`;
        const args = [
          '-f', 'bestaudio[ext=m4a]/bestaudio/best',
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
        execFile(bin, args, { timeout: 180000, maxBuffer: 80 * 1024 * 1024 }, (err, _so, se) => {
          if (err) {
            try { fs.unlinkSync(out); } catch (_) {}
            return reject(new Error((se || err.message || '').split('\n').slice(-3).join(' ').slice(0, 250)));
          }
          try {
            const buf = fs.readFileSync(out);
            fs.unlinkSync(out);
            if (buf.length < 2048) return reject(new Error('output too small'));
            resolve({ buf, source: `yt-dlp[${client}]`, mime: 'audio/mp4' });
          } catch (e) { reject(e); }
        });
      });
    } catch (e) { errs.push(`yt-dlp[${client}]: ${(e.message || '').slice(0, 120)}`); }
  }
  throw new Error(errs.join(' | '));
}

// ---------------------------------------------------------------------------
// Strategy 2: Invidious  — proxies audio through Invidious servers.
// Cloud IPs can reach Invidious even when YouTube CDN is blocked.
// Uses itag=140 (audio/mp4 @128kbps) and local=true so audio flows
// through Invidious (not YouTube CDN).
// ---------------------------------------------------------------------------
const INVIDIOUS_INSTANCES = [
  'https://inv.nadeko.net',
  'https://invidious.privacyredirect.com',
  'https://yewtu.be',
  'https://iv.ggtyler.dev',
  'https://invidious.fdn.fr',
  'https://invidious.io',
];

async function downloadWithInvidious(videoUrl) {
  const vid = videoUrl.match(/(?:v=|youtu\.be\/)([A-Za-z0-9_-]{11})/)?.[1];
  if (!vid) throw new Error('cannot extract video ID');

  const errs = [];
  for (const base of INVIDIOUS_INSTANCES) {
    for (const itag of ['140', '251']) {
      try {
        const r = await httpsGet(`${base}/latest_version?id=${vid}&itag=${itag}&local=true`);
        if (r.status === 200 && r.body.length > 4096) {
          const mime = itag === '140' ? 'audio/mp4' : 'audio/webm';
          return { buf: r.body, source: `invidious(${base.split('/')[2]})`, mime };
        }
      } catch (e) { errs.push(`invidious[${base.split('/')[2]}][${itag}]: ${(e.message || '').slice(0, 60)}`); }
    }
  }
  throw new Error('invidious: all instances failed — ' + errs.slice(0, 3).join(', '));
}

// ---------------------------------------------------------------------------
// Strategy 3: Piped API  — another open-source YouTube frontend that proxies
// audio streams through its own servers.
// ---------------------------------------------------------------------------
const PIPED_INSTANCES = [
  'https://pipedapi.kavin.rocks',
  'https://piped-api.garudalinux.org',
  'https://api.piped.projectsegfau.lt',
];

async function downloadWithPiped(videoUrl) {
  const vid = videoUrl.match(/(?:v=|youtu\.be\/)([A-Za-z0-9_-]{11})/)?.[1];
  if (!vid) throw new Error('cannot extract video ID');

  for (const base of PIPED_INSTANCES) {
    try {
      const r = await httpsGet(`${base}/streams/${vid}`);
      if (r.status !== 200) continue;
      const data = JSON.parse(r.body.toString());
      const streams = (data.audioStreams || []).sort((a, b) => (b.bitrate || 0) - (a.bitrate || 0));
      for (const s of streams) {
        if (!s.url) continue;
        try {
          const dl = await httpsGet(s.url);
          if (dl.status === 200 && dl.body.length > 4096) {
            return { buf: dl.body, source: `piped(${base.split('/')[2]})`, mime: s.mimeType || 'audio/mp4' };
          }
        } catch (_) {}
      }
    } catch (_) {}
  }
  throw new Error('piped: all instances failed');
}

// ---------------------------------------------------------------------------
// Strategy 4: Cobalt API  — handles YouTube bot-check, no binary needed
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
      const dl = await httpsGet(data.url);
      if (dl.status === 200 && dl.body.length > 2048) {
        return { buf: dl.body, source: `cobalt(${p.hostname})`, mime: 'audio/mpeg' };
      }
    } catch (_) {}
  }
  throw new Error('cobalt: all instances failed');
}

// ---------------------------------------------------------------------------
// Main download orchestrator
// ---------------------------------------------------------------------------
async function downloadAudio(url) {
  const errs = [];

  // 1. yt-dlp — installed via nixpacks/pip/postinstall, works best on Railway
  try { return await downloadWithYtdlp(url); }
  catch (e) { errs.push(e.message?.slice(0, 150)); }

  // 2. Invidious — proxies through their servers, bypasses cloud IP blocks
  try { return await downloadWithInvidious(url); }
  catch (e) { errs.push(e.message?.slice(0, 100)); }

  // 3. Piped — another proxy frontend
  try { return await downloadWithPiped(url); }
  catch (e) { errs.push(e.message?.slice(0, 100)); }

  // 4. Cobalt — last resort
  try { return await downloadWithCobalt(url); }
  catch (e) { errs.push(e.message?.slice(0, 100)); }

  throw new Error(errs.join(' | '));
}

// ---------------------------------------------------------------------------
// ffmpeg: convert any audio buffer → MP3
// ---------------------------------------------------------------------------
function toMp3(buf, mime) {
  return new Promise(resolve => {
    const id  = Date.now().toString(36) + Math.random().toString(36).slice(2, 5);
    const ext = (mime || '').includes('webm') ? 'webm' : ((mime || '').includes('mpeg') ? 'mp3' : 'm4a');
    const inp = `/tmp/play_${id}.${ext}`;
    const out = `/tmp/play_${id}.mp3`;
    fs.writeFileSync(inp, buf);
    execFile(
      'ffmpeg',
      ['-y', '-i', inp, '-vn', '-ar', '44100', '-ac', '2', '-b:a', '128k', out],
      { timeout: 120000, maxBuffer: 80 * 1024 * 1024 },
      err => {
        try { fs.unlinkSync(inp); } catch (_) {}
        if (!err) {
          try { const mp3 = fs.readFileSync(out); fs.unlinkSync(out); resolve(mp3); return; } catch (_) {}
        }
        try { fs.unlinkSync(out); } catch (_) {}
        resolve(buf); // return original if ffmpeg fails
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
    try { const r = await httpsGet(url); return r.status === 200 ? JSON.parse(r.body.toString()) : null; } catch (_) { return null; }
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
        return reply(`❌ Download failed:\n_${e.message?.slice(0, 400)}_`);
      }

      const finalBuf = await toMp3(buf, mime);

      await sock.sendMessage(jid, { audio: finalBuf, mimetype: 'audio/mpeg', ptt: false }, { quoted: m });
      await reply(`🎵 *${v.title}*\n${v.author?.name || ''} · ${v.timestamp || ''}\n_via ${source}_`);
    },
  },

  {
    name: 'ytdlpcheck',
    aliases: ['musiccheck'],
    description: 'Diagnose yt-dlp availability',
    handler: async ({ reply }) => {
      const bin = await getYtdlp();
      if (!bin) return reply('❌ yt-dlp *not found*. Check Railway build logs.');
      const ver = await new Promise(r =>
        execFile(bin, ['--version'], { timeout: 6000 }, (e, o) => r(e ? 'error' : o.trim()))
      );
      reply(`✅ yt-dlp found\nPath: \`${bin}\`\nVersion: ${ver}`);
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

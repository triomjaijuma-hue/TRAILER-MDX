'use strict';
const yts   = require('yt-search');
const https = require('https');
const { execFile, exec } = require('child_process');
const fs    = require('fs');
const path  = require('path');
const helpers = require('../../lib/helpers');
const config  = require('../../lib/config');

const MAX_DL = 75 * 1024 * 1024;

// ---------------------------------------------------------------------------
// Cookies — set YOUTUBE_COOKIES env var in Railway (base64 of cookies.txt)
// Cookies bypass YouTube's cloud IP block. Without them yt-dlp may fail.
// ---------------------------------------------------------------------------
const COOKIES_FILE = '/tmp/yt-cookies.txt';
function ensureCookies() {
  if (fs.existsSync(COOKIES_FILE)) return COOKIES_FILE;
  const repoCookies = path.join(__dirname, '../../../cookies.txt');
  if (fs.existsSync(repoCookies)) { fs.copyFileSync(repoCookies, COOKIES_FILE); return COOKIES_FILE; }
  const b64 = process.env.YOUTUBE_COOKIES || process.env.YT_COOKIES;
  if (b64) {
    try {
      const decoded = Buffer.from(b64, 'base64').toString('utf8');
      if (decoded.includes('youtube.com')) { fs.writeFileSync(COOKIES_FILE, decoded); console.log('[music] cookies loaded from env'); return COOKIES_FILE; }
    } catch(_) {}
  }
  return null;
}
const COOKIES = ensureCookies();

// ---------------------------------------------------------------------------
// yt-dlp finder + self-installer
// ---------------------------------------------------------------------------
const YTDLP_TMP = '/tmp/yt-dlp';
const YTDLP_URL = 'https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp';

function testBin(p) { return new Promise(r => { if (!p) return r(false); execFile(p, ['--version'], { timeout: 8000 }, e => r(!e)); }); }
function sh(cmd)    { return new Promise(r => exec(cmd, { timeout: 8000 }, (e,o) => r(e?'':(o||'').trim().split('\n')[0]))); }

function httpsGet(url, maxRedir) {
  maxRedir = maxRedir == null ? 8 : maxRedir;
  return new Promise((resolve, reject) => {
    const p = new URL(url);
    https.get({ hostname: p.hostname, path: p.pathname + p.search, headers: { 'User-Agent': 'Mozilla/5.0' } }, res => {
      if ([301,302,307,308].includes(res.statusCode) && res.headers.location) {
        return maxRedir > 0 ? resolve(httpsGet(res.headers.location, maxRedir-1)) : reject(new Error('too many redirects'));
      }
      const c = []; res.on('data', d => c.push(d)); res.on('end', () => resolve({ status: res.statusCode, body: Buffer.concat(c) }));
    }).on('error', reject);
  });
}

function dlBin(url, dest) {
  return new Promise((resolve, reject) => {
    const p = new URL(url);
    https.get({ hostname: p.hostname, path: p.pathname + p.search, headers: { 'User-Agent': 'installer/1.0' } }, res => {
      if ([301,302,307,308].includes(res.statusCode)) return resolve(dlBin(res.headers.location, dest));
      if (res.statusCode !== 200) return reject(new Error('HTTP ' + res.statusCode));
      const tmp = dest + '.dl'; const file = fs.createWriteStream(tmp);
      res.pipe(file);
      file.on('finish', () => file.close(() => { try { fs.renameSync(tmp, dest); resolve(); } catch(e) { reject(e); } }));
      file.on('error', e => { try { fs.unlinkSync(tmp); } catch(_) {} reject(e); });
    }).on('error', reject);
  });
}

let _ytdlpReady = null;
function getYtdlp() {
  if (!_ytdlpReady) {
    _ytdlpReady = (async () => {
      // Check Docker path first (Dockerfile installs here), then fall back to others
      const candidates = [
        '/usr/local/bin/yt-dlp',
        process.env.YTDLP_BIN,
        path.join(__dirname, '../../../bin/yt-dlp'),
        '/usr/bin/yt-dlp', '/bin/yt-dlp',
      ].filter(Boolean);
      for (const p of candidates) if (await testBin(p)) { console.log('[music] yt-dlp at', p); return p; }
      const w = await sh('which yt-dlp 2>/dev/null || command -v yt-dlp 2>/dev/null');
      if (w && await testBin(w)) return w;
      const f = await sh('find /nix /run /usr -name yt-dlp -type f 2>/dev/null | head -1');
      if (f && await testBin(f)) return f;
      if (await testBin(YTDLP_TMP)) return YTDLP_TMP;
      // Self-download as last resort
      console.log('[music] Downloading yt-dlp...');
      try {
        await dlBin(YTDLP_URL, YTDLP_TMP);
        fs.chmodSync(YTDLP_TMP, 0o755);
        if (await testBin(YTDLP_TMP)) { console.log('[music] yt-dlp downloaded OK'); return YTDLP_TMP; }
      } catch(e) { console.error('[music] download failed:', e.message); }
      return null;
    })();
  }
  return _ytdlpReady;
}
getYtdlp(); // warm up immediately on startup (still used by .ytdlpcheck command)

// ---------------------------------------------------------------------------
// Cobalt API — free, handles YouTube nsig/bot-check, no binary needed
// ---------------------------------------------------------------------------
const COBALT_INSTANCES = [
  'https://api.cobalt.tools',
  'https://cobalt.catvibers.me',
  'https://co.wuk.sh',
];

async function cobaltDownload(videoUrl) {
  for (const base of COBALT_INSTANCES) {
    try {
      const res = await new Promise((resolve, reject) => {
        const body = JSON.stringify({ url: videoUrl, downloadMode: 'audio', audioFormat: 'mp3', filenameStyle: 'basic' });
        const p = new URL(base);
        const req = require('https').request({
          hostname: p.hostname, path: '/', method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Accept': 'application/json', 'User-Agent': 'Mozilla/5.0', 'Content-Length': Buffer.byteLength(body) },
        }, resp => {
          const chunks = []; resp.on('data', c => chunks.push(c));
          resp.on('end', () => resolve({ status: resp.statusCode, body: Buffer.concat(chunks).toString() }));
        });
        req.on('error', reject); req.setTimeout(20000, () => { req.destroy(new Error('cobalt timeout')); });
        req.write(body); req.end();
      });
      if (res.status !== 200) continue;
      const data = JSON.parse(res.body);
      // status can be "tunnel", "redirect", "stream" — all have a .url to download
      if (!['tunnel','redirect','stream'].includes(data.status) || !data.url) continue;
      const dl = await httpsGet(data.url);
      if (dl.status === 200 && dl.body.length > 2048) {
        return { buf: dl.body, source: `cobalt(${base.replace('https://','')})`, mime: 'audio/mpeg' };
      }
    } catch(_) {}
  }
  throw new Error('all cobalt instances failed');
}

// ---------------------------------------------------------------------------
// yt-dlp via shell exec — uses PATH, works in nix/Railway environments
// where execFile with hardcoded paths won't find the nix-installed binary
// ---------------------------------------------------------------------------
const YT_CLIENTS = [
  { client: 'ios',         ua: 'com.google.ios.youtube/19.45.4 (iPhone16,2; U; CPU iPhone OS 18_1_0 like Mac OS X)' },
  { client: 'tv_embedded', ua: 'Mozilla/5.0 (SMART-TV; Linux; Tizen 6.0) AppleWebKit/538.1' },
  { client: 'web',         ua: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' },
];

function ytdlpShell(videoUrl, client, ua, cookiesFile) {
  return new Promise((resolve, reject) => {
    helpers.ensureTmp();
    const id  = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
    const out = path.join(config.paths.tmp, `yt_${id}.m4a`);
    const cookPart = cookiesFile ? `--cookies "${cookiesFile}"` : '';
    // Use exec (shell) instead of execFile so nix/PATH-installed yt-dlp is found
    const cmd = [
      'yt-dlp',
      `-f "bestaudio[ext=m4a]/bestaudio/best"`,
      `--no-playlist --no-warnings --no-check-certificate`,
      `--extractor-args "youtube:player_client=${client}"`,
      `--user-agent "${ua}"`,
      `--max-filesize 75m --socket-timeout 45 --retries 2`,
      cookPart,
      `-o "${out}"`,
      `"${videoUrl}"`,
    ].filter(Boolean).join(' ');
    exec(cmd, { timeout: 240000, maxBuffer: 80 * 1024 * 1024 }, (err, _so, se) => {
      if (err) {
        try { fs.unlinkSync(out); } catch(_) {}
        const msg = (se || err.message || '').split('\n').filter(Boolean).slice(-3).join(' ').slice(0, 250);
        return reject(new Error(msg || err.message));
      }
      try {
        const buf = fs.readFileSync(out); fs.unlinkSync(out);
        if (buf.length < 2048) return reject(new Error('output too small'));
        resolve({ buf, source: `yt-dlp[${client}]`, mime: 'audio/mp4' });
      } catch(e) { reject(e); }
    });
  });
}

// Check if yt-dlp is available in the shell PATH (cached)
let _ytdlpInPath = null;
function checkYtdlpInPath() {
  if (_ytdlpInPath === null) {
    _ytdlpInPath = new Promise(r => {
      exec('yt-dlp --version', { timeout: 12000 }, e => r(!e));
    });
  }
  return _ytdlpInPath;
}
checkYtdlpInPath(); // warm up at startup

async function downloadAudio(url) {
  const errs = [];

  // Strategy 1: Cobalt API (no binary, handles YouTube nsig properly)
  try {
    return await cobaltDownload(url);
  } catch(e) { errs.push('cobalt: ' + (e.message||'').slice(0, 100)); }

  // Strategy 2: yt-dlp via shell PATH (works in nixpacks/Railway, Docker)
  const hasYtdlp = await checkYtdlpInPath();
  if (hasYtdlp) {
    const cookiesFile = ensureCookies();
    for (const { client, ua } of YT_CLIENTS) {
      try { return await ytdlpShell(url, client, ua, cookiesFile); }
      catch(e) { errs.push(`yt-dlp[${client}]: ${(e.message||'').slice(0, 100)}`); }
    }
  } else {
    errs.push('yt-dlp: not found in PATH');
  }

  // Strategy 3: Invidious public instances (updated list)
  const INVIDIOUS = [
    'https://inv.nadeko.net',
    'https://invidious.privacyredirect.com',
    'https://iv.ggtyler.dev',
    'https://invidious.fdn.fr',
    'https://yewtu.be',
  ];
  const vid = url.match(/[?&]v=([A-Za-z0-9_-]{11})/)?.[1];
  if (vid) {
    for (const base of INVIDIOUS) {
      try {
        const r = await httpsGet(`${base}/api/v1/videos/${vid}?fields=adaptiveFormats`);
        if (r.status !== 200) continue;
        const d = JSON.parse(r.body.toString());
        const streamUrl = (d.adaptiveFormats||[]).find(f => f.type?.includes('audio/mp4'))?.url;
        if (!streamUrl) continue;
        const dl = await httpsGet(streamUrl);
        if (dl.status === 200 && dl.body.length > 2048) return { buf: dl.body, source: 'invidious', mime: 'audio/mp4' };
      } catch(_) {}
    }
    errs.push('invidious: all instances failed');
  }

  throw new Error(errs.join(' | '));
}

// ---------------------------------------------------------------------------
// YouTube search
// ---------------------------------------------------------------------------
async function ytSearch(q) {
  for (const fn of [() => yts(q), ytScrape.bind(null, q)]) {
    try { const r = await fn(); if (r?.videos?.length) return r; } catch(_) {}
  }
  return { videos: [] };
}

async function ytScrape(q) {
  const r = await httpsGet(`https://www.youtube.com/results?search_query=${encodeURIComponent(q)}`);
  const m = r.body.toString().match(/var ytInitialData = (\{[\s\S]+?\});\s*<\/script>/);
  if (!m) return { videos: [] };
  const data = JSON.parse(m[1]); const out = [];
  for (const sec of (data?.contents?.twoColumnSearchResultsRenderer?.primaryContents?.sectionListRenderer?.contents || [])) {
    for (const it of (sec?.itemSectionRenderer?.contents || [])) {
      const v = it?.videoRenderer; if (!v?.videoId) continue;
      const lt = v.lengthText?.simpleText || '';
      const secs = lt.split(':').map(Number).reduce((a,b2) => a*60+b2, 0);
      out.push({ title: v.title?.runs?.[0]?.text || '', videoId: v.videoId, url: `https://www.youtube.com/watch?v=${v.videoId}`, author: { name: v.ownerText?.runs?.[0]?.text || '' }, duration: { seconds: secs, timestamp: lt }, timestamp: lt, views: Number((v.viewCountText?.simpleText||'0').replace(/\D/g,''))||0 });
      if (out.length >= 20) break;
    }
    if (out.length >= 20) break;
  }
  return { videos: out };
}

function pickBest(vids, q) {
  const tokens = q.toLowerCase().split(/\s+/).filter(Boolean);
  const score  = v => {
    const t = (v.title||'').toLowerCase(), a = (v.author?.name||'').toLowerCase();
    let s = 0;
    tokens.forEach(k => { if(t.includes(k)) s+=3; if(a.includes(k)) s+=2; });
    if (/official\s+(audio|video|music)/i.test(v.title)) s += 3;
    if (/\btopic\b|vevo/i.test(v.author?.name||''))       s += 3;
    if (/reaction|tutorial|cover|sped.up|nightcore|slowed/i.test(v.title)) s -= 3;
    const sec = v.duration?.seconds || 0;
    if (sec >= 45 && sec <= 720) s += 1; else if (sec > 720) s -= 2;
    s += Math.min(3, Math.log10((v.views||1)+1) / 2);
    return s;
  };
  return vids.slice(0, 15).map(v => ({ v, s: score(v) })).sort((a,b) => b.s-a.s)[0]?.v || vids[0];
}

// ---------------------------------------------------------------------------
// Lyrics
// ---------------------------------------------------------------------------
async function fetchLyrics(q) {
  const parts  = q.split(/\s*-\s*/);
  const artist = parts.length > 1 ? parts[0].trim() : '';
  const song   = (parts.length > 1 ? parts.slice(1).join(' - ') : q).trim();
  const tryUrl = async url => { try { const r = await httpsGet(url); return r.status===200 ? JSON.parse(r.body.toString()) : null; } catch(_) { return null; } };
  const d1 = await tryUrl(`https://lrclib.net/api/search?q=${encodeURIComponent(q)}`);
  if (Array.isArray(d1)) { const h = d1.find(x => x.plainLyrics || x.syncedLyrics); if (h) { const text = h.plainLyrics || (h.syncedLyrics||'').replace(/\[\d{2}:\d{2}(?:\.\d+)?\]/g,'').trim(); if (text) return { text, title: `${h.artistName} — ${h.trackName}` }; } }
  if (artist && song) { const d2 = await tryUrl(`https://lrclib.net/api/get?artist_name=${encodeURIComponent(artist)}&track_name=${encodeURIComponent(song)}`); if (d2?.plainLyrics) return { text: d2.plainLyrics, title: `${d2.artistName} — ${d2.trackName}` }; }
  const d3 = await tryUrl(`https://some-random-api.com/lyrics?title=${encodeURIComponent(q)}`);
  if (d3?.lyrics) return { text: d3.lyrics, title: d3.title ? `${d3.author||''} — ${d3.title}` : null };
  return null;
}

// ---------------------------------------------------------------------------
// Commands
// ---------------------------------------------------------------------------
module.exports = [
  {
    name: 'play', aliases: ['song', 'mp3', 'ytmp3'],
    description: 'Send audio for a song name',
    handler: async ({ argText, sock, jid, m, reply }) => {
      if (!argText) return reply('Usage: .play <song name>');
      await reply(`🔎 Searching *${argText}*...`);
      const r = await ytSearch(argText);
      const v = r.videos.length ? pickBest(r.videos, argText) : null;
      if (!v) return reply('❌ Not found on YouTube.');
      await reply(`🎵 Found: *${v.title}* — downloading audio…`);
      try {
        const { buf, source, mime } = await downloadAudio(v.url);
        await sock.sendMessage(jid, { audio: buf, mimetype: mime || 'audio/mp4', ptt: false }, { quoted: m });
        await reply(`🎵 *${v.title}*\n${v.author?.name||''} · ${v.timestamp||''}\n_via ${source}_`);
      } catch(e) {
        reply(`❌ Failed: *${v.title}*\n_${e.message?.slice(0, 300)}_`);
      }
    },
  },
  {
    name: 'ytdlpcheck', aliases: ['musiccheck', 'checkytdlp'],
    description: 'Diagnose yt-dlp and YouTube connectivity',
    handler: async ({ reply }) => {
      const bin = await getYtdlp();
      if (!bin) return reply('❌ yt-dlp: *not found*\n\nCheck Railway build logs — the Dockerfile install step may have failed.');
      const ver = await new Promise(r => execFile(bin, ['--version'], { timeout: 6000 }, (e,o) => r(e?'error':o.trim())));
      const cookies = ensureCookies();
      const cookieStatus = cookies ? `✅ loaded (${fs.statSync(cookies).size} bytes)` : '❌ not set — YouTube blocks cloud IPs without cookies';
      const ytTest = await new Promise(r => {
        const args = ['--get-url','--no-warnings','--extractor-args','youtube:player_client=ios','--user-agent','com.google.ios.youtube/19.45.4 (iPhone16,2; U; CPU iPhone OS 18_1_0 like Mac OS X)'];
        if (cookies) args.push('--cookies', cookies);
        args.push('https://www.youtube.com/watch?v=60ItHLz5WEA');
        execFile(bin, args, { timeout: 30000 }, (e,o,se) => {
          if (e) r('❌ Blocked:\n_' + (se||e.message||'unknown').slice(0,220) + '_\n\n*Set YOUTUBE_COOKIES in Railway to fix this.*');
          else r('✅ Working! YouTube is reachable.');
        });
      });
      reply(`*Music Diagnostics*\n\nPath: \`${bin}\`\nVersion: ${ver}\nCookies: ${cookieStatus}\n\nYouTube test: ${ytTest}`);
    },
  },
  {
    name: 'ytsearch', aliases: ['ysearch'],
    description: 'YouTube search results',
    handler: async ({ argText, reply }) => {
      if (!argText) return reply('Usage: .ytsearch <query>');
      const r = await ytSearch(argText);
      const top = r.videos.slice(0, 6);
      if (!top.length) return reply('Nothing found.');
      reply(top.map(v => `• ${v.title}\n  ${v.timestamp||''} · ${v.author?.name||''}\n  ${v.url}`).join('\n\n'));
    },
  },
  {
    name: 'lyrics', description: 'Fetch song lyrics',
    handler: async ({ argText, reply }) => {
      if (!argText) return reply('Usage: .lyrics <song>  or  .lyrics Artist - Song');
      const r = await fetchLyrics(argText);
      if (!r) return reply('No lyrics found.');
      const header = r.title ? `🎤 *${r.title}*\n\n` : '';
      const body   = r.text.length > 3500 ? r.text.slice(0, 3500) + '\n\n_…truncated_' : r.text;
      reply(header + body);
    },
  },
  { name: 'ringtone', description: 'Ringtone search link', handler: async ({ argText, reply }) => reply(`https://www.zedge.net/find/ringtones/${encodeURIComponent(argText||'top')}`) },
  { name: 'scloud',   description: 'SoundCloud search',    handler: async ({ argText, reply }) => reply(`https://soundcloud.com/search?q=${encodeURIComponent(argText||'top')}`) },
];

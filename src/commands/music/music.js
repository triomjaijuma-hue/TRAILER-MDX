'use strict';
const yts = require('yt-search');
const axios = require('axios');
const https = require('https');
const { execFile, exec } = require('child_process');
const fs = require('fs');
const path = require('path');
const helpers = require('../../lib/helpers');
const config = require('../../lib/config');

const MAX_MEDIA_BYTES = 50 * 1024 * 1024;
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

// ---------------------------------------------------------------------------
// yt-dlp self-installer
// Downloads the yt-dlp binary from GitHub at first use, stores in /tmp.
// Runs in the background so it's ready by the time a user sends .play.
// ---------------------------------------------------------------------------
const YTDLP_URL = 'https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp';
const YTDLP_TMP = '/tmp/yt-dlp';

function testBin(bin) {
  return new Promise((resolve) => {
    if (!bin) return resolve(false);
    execFile(bin, ['--version'], { timeout: 5000 }, (err) => resolve(!err));
  });
}

function shellOne(cmd) {
  return new Promise((resolve) => {
    exec(cmd, { timeout: 8000 }, (err, stdout) => {
      resolve(err ? '' : (stdout || '').trim().split('\n')[0].trim());
    });
  });
}

function downloadBinary(url, dest, redirects) {
  redirects = redirects || 0;
  if (redirects > 8) return Promise.reject(new Error('too many redirects'));
  return new Promise((resolve, reject) => {
    https.get(url, { headers: { 'User-Agent': 'node-ytdlp-installer' } }, (res) => {
      const loc = res.headers.location;
      if ([301, 302, 307, 308].includes(res.statusCode) && loc) {
        return resolve(downloadBinary(loc, dest, redirects + 1));
      }
      if (res.statusCode !== 200) return reject(new Error('HTTP ' + res.statusCode + ' from ' + url));
      const tmp = dest + '.dl';
      const file = fs.createWriteStream(tmp);
      res.pipe(file);
      file.on('finish', () => file.close(() => {
        try {
          fs.renameSync(tmp, dest);
          resolve();
        } catch (e) { reject(e); }
      }));
      file.on('error', (e) => { try { fs.unlinkSync(tmp); } catch (_) {} reject(e); });
    }).on('error', reject);
  });
}

let _ytdlpPath = null;   // resolved path once found/installed
let _ytdlpSetup = null;  // single shared Promise so we never double-download

async function setupYtdlp() {
  // 1. env var or known system paths
  const candidates = [
    process.env.YTDLP_BIN,
    path.join(__dirname, '../../../bin/yt-dlp'),
    '/usr/local/bin/yt-dlp',
    '/usr/bin/yt-dlp',
    '/bin/yt-dlp',
  ].filter(Boolean);
  for (const p of candidates) {
    if (await testBin(p)) { _ytdlpPath = p; return p; }
  }

  // 2. shell `which`
  const w = await shellOne('which yt-dlp 2>/dev/null || command -v yt-dlp 2>/dev/null');
  if (w && await testBin(w)) { _ytdlpPath = w; return w; }

  // 3. scan /nix (Railway nixpacks)
  const nix = await shellOne('find /nix /run -name yt-dlp -type f 2>/dev/null | head -1');
  if (nix && await testBin(nix)) { _ytdlpPath = nix; return nix; }

  // 4. already downloaded to /tmp on a previous call
  if (await testBin(YTDLP_TMP)) { _ytdlpPath = YTDLP_TMP; return YTDLP_TMP; }

  // 5. self-download from GitHub releases (~60 MB, one-time)
  console.log('[music] yt-dlp not found — downloading from GitHub...');
  await downloadBinary(YTDLP_URL, YTDLP_TMP, 0);
  fs.chmodSync(YTDLP_TMP, 0o755);
  if (await testBin(YTDLP_TMP)) {
    console.log('[music] yt-dlp ready at', YTDLP_TMP);
    _ytdlpPath = YTDLP_TMP;
    return YTDLP_TMP;
  }
  throw new Error('yt-dlp binary downloaded but failed to execute');
}

function getYtdlp() {
  if (!_ytdlpSetup) _ytdlpSetup = setupYtdlp().catch((e) => {
    console.error('[music] yt-dlp setup failed:', e.message);
    return null;
  });
  return _ytdlpSetup;
}

// Kick off setup immediately so it's ready before the first .play command
getYtdlp();

// ---------------------------------------------------------------------------
// yt-dlp download
// ---------------------------------------------------------------------------
const YT_CLIENTS = ['ios,web_embedded', 'ios', 'tv_embedded', 'web_embedded,web'];

function ytdlpDownload(bin, url, kind, client) {
  return new Promise((resolve, reject) => {
    helpers.ensureTmp();
    const id = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
    const ext = kind === 'audio' ? 'm4a' : 'mp4';
    const out = path.join(config.paths.tmp, `yt_${id}.${ext}`);
    const fmt = kind === 'audio'
      ? 'bestaudio[ext=m4a]/bestaudio/best'
      : 'best[ext=mp4][height<=480]/best[height<=480]/best[ext=mp4]/best';
    const cookiesPath = path.join(__dirname, '../../../cookies.txt');
    const cookiesArgs = fs.existsSync(cookiesPath) ? ['--cookies', cookiesPath] : [];
    const args = [
      '-f', fmt, '--no-playlist', '--no-warnings', '--no-check-certificate',
      '--extractor-args', `youtube:player_client=${client}`,
      '--user-agent', UA,
      '--max-filesize', String(MAX_MEDIA_BYTES),
      '--socket-timeout', '30', '--retries', '2',
      ...cookiesArgs, '-o', out, url,
    ];
    execFile(bin, args, { timeout: 180000, maxBuffer: 64 * 1024 * 1024 }, (err, _so, se) => {
      if (err) {
        try { fs.unlinkSync(out); } catch (_) {}
        const msg = (se || err.message || '').toString().split('\n').filter(Boolean).slice(-3).join(' ').slice(0, 250);
        return reject(new Error(msg || 'yt-dlp failed'));
      }
      try {
        const buf = fs.readFileSync(out);
        fs.unlinkSync(out);
        if (buf.length < 2048) return reject(new Error('output too small'));
        resolve(buf);
      } catch (e) { reject(e); }
    });
  });
}

async function ytdlpRun(url, kind) {
  const bin = await getYtdlp();
  if (!bin) throw new Error('yt-dlp unavailable');
  const errors = [];
  for (const client of YT_CLIENTS) {
    try {
      const buf = await ytdlpDownload(bin, url, kind, client);
      return { buf, source: `yt-dlp(${client})` };
    } catch (e) {
      errors.push(`${client}: ${e.message?.slice(0, 80)}`);
      if (!/(Sign in|bot|403|PO|token)/i.test(e.message)) break;
    }
  }
  throw new Error(errors.join(' | '));
}

// ---------------------------------------------------------------------------
// @distube/ytdl-core fallback
// ---------------------------------------------------------------------------
let _ytdl;
function getYtdl() {
  if (_ytdl !== undefined) return _ytdl;
  try { _ytdl = require('@distube/ytdl-core'); }
  catch (_) { try { _ytdl = require('ytdl-core'); } catch (__) { _ytdl = null; } }
  return _ytdl;
}

async function ytdlCoreDownload(url, kind) {
  const ytdl = getYtdl();
  if (!ytdl) throw new Error('ytdl-core not available');
  const agent = ytdl.createAgent ? ytdl.createAgent() : undefined;
  const info = await ytdl.getInfo(url, {
    requestOptions: { headers: { 'User-Agent': UA, 'Accept-Language': 'en-US,en;q=0.9' } },
    ...(agent ? { agent } : {}),
  });
  let format;
  if (kind === 'audio') {
    format = info.formats.filter(f => f.hasAudio && !f.hasVideo).sort((a, b) => (b.audioBitrate || 0) - (a.audioBitrate || 0))[0];
    if (!format) format = ytdl.chooseFormat(info.formats, { quality: 'highestaudio', filter: 'audioonly' });
  } else {
    format = info.formats.filter(f => f.hasVideo && f.hasAudio && f.container === 'mp4' && (f.height || 720) <= 480).sort((a, b) => (b.height || 0) - (a.height || 0))[0];
    if (!format) format = ytdl.chooseFormat(info.formats, { quality: '480p', filter: 'videoandaudio' });
  }
  if (!format?.url) throw new Error('no suitable format');
  const r = await axios.get(format.url, {
    responseType: 'arraybuffer', timeout: 90000,
    maxContentLength: MAX_MEDIA_BYTES, maxBodyLength: MAX_MEDIA_BYTES,
    headers: { 'User-Agent': UA },
  });
  const buf = Buffer.from(r.data);
  if (buf.length < 2048) throw new Error('stream too small');
  return buf;
}

// ---------------------------------------------------------------------------
// Invidious & Piped direct stream fallbacks
// ---------------------------------------------------------------------------
const INVIDIOUS_INSTANCES = [
  'https://invidious.nerdvpn.de', 'https://invidious.fdn.fr', 'https://yt.artemislena.eu',
  'https://inv.tux.pizza', 'https://yewtu.be', 'https://invidious.io',
  'https://invidious.lunar.icu', 'https://inv.nadeko.net', 'https://invidious.privacydev.net',
];
const PIPED_INSTANCES = [
  'https://pipedapi.kavin.rocks', 'https://pipedapi.adminforge.de',
  'https://piped-api.garudalinux.org', 'https://pipedapi.r4fo.com',
  'https://piped.video/api', 'https://piped.smnz.de/api',
];

function videoIdFromUrl(url) {
  const m = url.match(/[?&]v=([A-Za-z0-9_-]{11})/);
  return m ? m[1] : null;
}

async function downloadCapped(url) {
  const r = await axios.get(url, {
    responseType: 'arraybuffer', timeout: 120000,
    maxContentLength: MAX_MEDIA_BYTES, maxBodyLength: MAX_MEDIA_BYTES,
    headers: { 'User-Agent': UA },
  });
  const buf = Buffer.from(r.data);
  if (buf.length < 1024) throw new Error('payload too small');
  return buf;
}

async function invidiosFetch(ytUrl, kind) {
  const id = videoIdFromUrl(ytUrl);
  if (!id) throw new Error('bad url');
  for (const base of INVIDIOUS_INSTANCES) {
    try {
      const data = await helpers.getJson(`${base}/api/v1/videos/${id}?fields=formatStreams,adaptiveFormats`, { timeout: 10000, headers: { 'User-Agent': UA } });
      if (kind === 'video') {
        const s = (data?.formatStreams || []).filter(f => f.type?.includes('video/mp4'));
        const p = s.find(f => /480/.test(f.quality)) || s.find(f => /360/.test(f.quality)) || s[0];
        if (p?.url) return { directUrl: p.url };
      } else {
        const a = data?.adaptiveFormats || [];
        const p = a.find(f => f.type?.includes('audio/mp4')) || a.find(f => f.audioSampleRate);
        if (p?.url) return { directUrl: p.url };
      }
    } catch (_) {}
  }
  throw new Error('all invidious instances failed');
}

async function pipedFetch(ytUrl, kind) {
  const id = videoIdFromUrl(ytUrl);
  if (!id) throw new Error('bad url');
  for (const base of PIPED_INSTANCES) {
    try {
      const data = await helpers.getJson(`${base}/streams/${id}`, { timeout: 10000, headers: { 'User-Agent': UA } });
      if (kind === 'audio') {
        const s = (data?.audioStreams || []).sort((a, b) => (b.bitrate || 0) - (a.bitrate || 0));
        if (s[0]?.url) return { directUrl: s[0].url };
      } else {
        const s = (data?.videoStreams || []).filter(v => v.mimeType?.includes('mp4')).sort((a, b) => (b.height || 0) - (a.height || 0));
        const p = s.find(v => !v.videoOnly && (v.height || 0) <= 480) || s.find(v => !v.videoOnly) || s[0];
        if (p?.url) return { directUrl: p.url };
      }
    } catch (_) {}
  }
  throw new Error('all piped instances failed');
}

// ---------------------------------------------------------------------------
// Main download chain
// ---------------------------------------------------------------------------
async function fetchYouTubeMedia(url, kind) {
  const errors = [];

  // 1. yt-dlp (self-downloads if missing — most reliable)
  try { return await ytdlpRun(url, kind); }
  catch (e) { errors.push(`yt-dlp: ${e.message?.slice(0, 180)}`); }

  // 2. Invidious
  try {
    const { directUrl } = await invidiosFetch(url, kind);
    return { buf: await downloadCapped(directUrl), source: 'invidious' };
  } catch (e) { errors.push(`invidious: ${e.message?.slice(0, 80)}`); }

  // 3. Piped
  try {
    const { directUrl } = await pipedFetch(url, kind);
    return { buf: await downloadCapped(directUrl), source: 'piped' };
  } catch (e) { errors.push(`piped: ${e.message?.slice(0, 80)}`); }

  // 4. ytdl-core
  try { return { buf: await ytdlCoreDownload(url, kind), source: 'ytdl-core' }; }
  catch (e) { errors.push(`ytdl-core: ${e.message?.slice(0, 80)}`); }

  throw new Error(errors.join(' | '));
}

// ---------------------------------------------------------------------------
// Search
// ---------------------------------------------------------------------------
async function search(q) {
  const r = await ytSearchSafe(q);
  const vids = r?.videos || [];
  if (!vids.length) return null;
  const tokens = q.toLowerCase().split(/\s+/).filter(Boolean);
  const score = (v) => {
    const t = (v.title || '').toLowerCase(), a = (v.author?.name || '').toLowerCase();
    let s = 0;
    for (const tok of tokens) { if (t.includes(tok)) s += 3; if (a.includes(tok)) s += 2; }
    if (/official\s+(audio|video|music)/i.test(v.title)) s += 3;
    if (/\btopic\b|vevo/i.test(v.author?.name || '')) s += 3;
    if (/reaction|tutorial|cover|sped\s*up|nightcore|slowed/i.test(v.title)) s -= 3;
    const sec = v.duration?.seconds || 0;
    if (sec >= 45 && sec <= 720) s += 1; else if (sec > 720) s -= 2;
    s += Math.min(3, Math.log10((v.views || 1) + 1) / 2);
    return s;
  };
  return vids.slice(0, 15).map(v => ({ v, s: score(v) })).sort((a, b) => b.s - a.s)[0]?.v || vids[0];
}

async function ytSearchSafe(q) {
  try { const r = await yts(q); if (r?.videos?.length) return r; } catch (_) {}
  try { const r = await ytSearchScrape(q); if (r?.videos?.length) return r; } catch (_) {}
  try { return await ytSearchPiped(q); } catch (_) {}
  return { videos: [] };
}

async function ytSearchScrape(q) {
  const html = await helpers.getText(`https://www.youtube.com/results?search_query=${encodeURIComponent(q)}`, { timeout: 15000, headers: { 'User-Agent': UA, 'Accept-Language': 'en-US,en;q=0.9' } });
  const m = html.match(/var ytInitialData = (\{[\s\S]+?\});\s*<\/script>/);
  if (!m) return { videos: [] };
  let data; try { data = JSON.parse(m[1]); } catch { return { videos: [] }; }
  const out = [];
  for (const sec of (data?.contents?.twoColumnSearchResultsRenderer?.primaryContents?.sectionListRenderer?.contents || [])) {
    for (const it of (sec?.itemSectionRenderer?.contents || [])) {
      const v = it?.videoRenderer; if (!v?.videoId) continue;
      const lt = v.lengthText?.simpleText || '';
      const sec2 = lt.split(':').map(Number).reduce((a, b) => a * 60 + b, 0);
      out.push({ title: v.title?.runs?.[0]?.text || '', videoId: v.videoId, url: `https://www.youtube.com/watch?v=${v.videoId}`, author: { name: v.ownerText?.runs?.[0]?.text || '' }, duration: { seconds: sec2, timestamp: lt }, timestamp: lt, views: Number((v.viewCountText?.simpleText || '0').replace(/\D/g, '')) || 0 });
      if (out.length >= 20) break;
    }
    if (out.length >= 20) break;
  }
  return { videos: out };
}

async function ytSearchPiped(q) {
  for (const base of ['https://pipedapi.kavin.rocks', 'https://pipedapi.adminforge.de']) {
    try {
      const data = await helpers.getJson(`${base}/search?q=${encodeURIComponent(q)}&filter=videos`, { timeout: 12000 });
      const items = (data?.items || []).filter(x => x.url || x.videoId);
      if (!items.length) continue;
      return { videos: items.slice(0, 20).map(x => { const id = x.videoId || (x.url || '').split('?v=').pop(); return { title: x.title || '', videoId: id, url: `https://www.youtube.com/watch?v=${id}`, author: { name: x.uploaderName || '' }, duration: { seconds: x.duration || 0, timestamp: secsToStamp(x.duration) }, timestamp: secsToStamp(x.duration), views: x.views || 0 }; }) };
    } catch (_) {}
  }
  return { videos: [] };
}

function secsToStamp(s) {
  if (!s || s < 0) return '';
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
  return h ? `${h}:${String(m).padStart(2,'0')}:${String(sec).padStart(2,'0')}` : `${m}:${String(sec).padStart(2,'0')}`;
}

// ---------------------------------------------------------------------------
// Lyrics
// ---------------------------------------------------------------------------
async function fetchLyrics(q) {
  const parts = q.split(/\s*-\s*/), artist = parts.length > 1 ? parts[0].trim() : '', song = (parts.length > 1 ? parts.slice(1).join(' - ') : q).trim();
  try { const d = await helpers.getJson(`https://lrclib.net/api/search?q=${encodeURIComponent(q)}`, { timeout: 12000 }); const hit = Array.isArray(d) ? d.find(x => x.plainLyrics || x.syncedLyrics) : null; const text = hit?.plainLyrics || stripLrc(hit?.syncedLyrics); if (text) return { text, title: hit ? `${hit.artistName} — ${hit.trackName}` : null }; } catch (_) {}
  if (artist && song) { try { const d = await helpers.getJson(`https://lrclib.net/api/get?artist_name=${encodeURIComponent(artist)}&track_name=${encodeURIComponent(song)}`, { timeout: 12000 }); const text = d?.plainLyrics || stripLrc(d?.syncedLyrics); if (text) return { text, title: `${d.artistName} — ${d.trackName}` }; } catch (_) {} }
  try { const d = await helpers.getJson(`https://some-random-api.com/lyrics?title=${encodeURIComponent(q)}`, { timeout: 12000 }); if (d?.lyrics) return { text: d.lyrics, title: d.title ? `${d.author || ''} — ${d.title}` : null }; } catch (_) {}
  return null;
}
function stripLrc(s) { return s ? s.replace(/\[\d{2}:\d{2}(?:\.\d{1,3})?\]/g, '').trim() : ''; }

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
      let v; try { v = await search(argText); } catch (e) { return reply(`Search error: ${e.message?.slice(0, 100)}`); }
      if (!v) return reply('❌ Not found on YouTube.');
      await reply(`🎵 Found: *${v.title}* — downloading audio...`);
      try {
        const { buf, source } = await fetchYouTubeMedia(v.url, 'audio');
        await sock.sendMessage(jid, { audio: buf, mimetype: 'audio/mp4', ptt: false, fileName: `${v.title}.mp3` }, { quoted: m });
        await reply(`🎵 *${v.title}*\n${v.author?.name || ''} · ${v.timestamp || ''}\n_via ${source}_`);
      } catch (e) { reply(`❌ Download failed for *${v.title}*\n_${e.message?.slice(0, 300)}_`); }
    },
  },
  {
    name: 'video', aliases: ['ytmp4', 'ytvideo'],
    description: 'Send video for a song/clip name',
    handler: async ({ argText, sock, jid, m, reply }) => {
      if (!argText) return reply('Usage: .video <name>');
      await reply(`🔎 Searching *${argText}*...`);
      let v; try { v = await search(argText); } catch (e) { return reply(`Search error: ${e.message?.slice(0, 100)}`); }
      if (!v) return reply('❌ Not found on YouTube.');
      await reply(`🎬 Found: *${v.title}* — downloading video...`);
      try {
        const { buf, source } = await fetchYouTubeMedia(v.url, 'video');
        await sock.sendMessage(jid, { video: buf, mimetype: 'video/mp4', caption: `🎬 *${v.title}*\n_via ${source}_` }, { quoted: m });
      } catch (e) { reply(`❌ Download failed for *${v.title}*\n_${e.message?.slice(0, 300)}_\n\n_Try *.play ${argText}* for audio._`); }
    },
  },
  {
    name: 'ytsearch', aliases: ['ysearch'],
    description: 'YouTube search',
    handler: async ({ argText, reply }) => {
      if (!argText) return reply('Usage: .ytsearch <query>');
      try {
        const r = await ytSearchSafe(argText);
        const top = (r?.videos || []).slice(0, 6);
        if (!top.length) return reply('Nothing found.');
        reply(top.map(v => `• ${v.title}\n  ${v.timestamp || ''} · ${v.author?.name || ''}\n  ${v.url}`).join('\n\n'));
      } catch (e) { reply(`Search failed: ${e?.message?.slice(0, 200) || 'unknown'}`); }
    },
  },
  {
    name: 'ytdlpcheck', aliases: ['checkytdlp'],
    description: 'Check yt-dlp status',
    handler: async ({ reply }) => {
      const bin = await getYtdlp();
      reply(bin ? `✅ yt-dlp ready at: ${bin}` : '❌ yt-dlp failed to install. Check bot logs.');
    },
  },
  {
    name: 'lyrics', description: 'Fetch song lyrics',
    handler: async ({ argText, reply }) => {
      if (!argText) return reply('Usage: .lyrics <song>  or  .lyrics <artist> - <song>');
      try {
        const r = await fetchLyrics(argText);
        if (!r) return reply('No lyrics found.');
        const header = r.title ? `🎤 *${r.title}*\n\n` : '';
        const body = r.text.length > 3500 ? r.text.slice(0, 3500) + '\n\n_…truncated_' : r.text;
        reply(header + body);
      } catch (e) { reply(`Lyrics unavailable: ${e.message?.slice(0, 120)}`); }
    },
  },
  { name: 'ringtone', description: 'Search a ringtone', handler: async ({ argText, reply }) => reply(`https://www.zedge.net/find/ringtones/${encodeURIComponent(argText || 'top')}`) },
  { name: 'scloud', description: 'SoundCloud search', handler: async ({ argText, reply }) => reply(`https://soundcloud.com/search?q=${encodeURIComponent(argText || 'top')}`) },
];

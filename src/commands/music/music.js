'use strict';
const yts = require('yt-search');
const axios = require('axios');
const { execFile, exec } = require('child_process');
const fs = require('fs');
const path = require('path');
const helpers = require('../../lib/helpers');
const config = require('../../lib/config');

const MAX_MEDIA_BYTES = 50 * 1024 * 1024;
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

// --- yt-dlp discovery ----------------------------------------------------
// Searches every possible location: env var, known paths, `which`, and the
// entire /nix/store (covers Railway nixpacks builds where the binary lands
// somewhere like /nix/store/<hash>-yt-dlp-<ver>/bin/yt-dlp).

let ytdlpBin = null;
let ytdlpSearched = false;

function shellFind(cmd) {
  return new Promise((resolve) => {
    exec(cmd, { timeout: 8000 }, (err, stdout) => {
      resolve(err ? '' : (stdout || '').trim().split('\n')[0].trim());
    });
  });
}

function testBin(bin) {
  return new Promise((resolve) => {
    if (!bin) return resolve(false);
    execFile(bin, ['--version'], { timeout: 5000 }, (err) => resolve(!err));
  });
}

async function findYtdlp() {
  if (ytdlpSearched) return ytdlpBin;
  ytdlpSearched = true;

  const candidates = [
    process.env.YTDLP_BIN,
    '/usr/local/bin/yt-dlp',
    '/usr/bin/yt-dlp',
    '/bin/yt-dlp',
    path.join(__dirname, '../../../bin/yt-dlp'),
  ].filter(Boolean);

  // Try known paths first (fast)
  for (const p of candidates) {
    if (await testBin(p)) { ytdlpBin = p; return p; }
  }

  // Use shell `which` / `command -v` (catches PATH entries)
  const fromWhich = await shellFind('which yt-dlp 2>/dev/null || command -v yt-dlp 2>/dev/null');
  if (fromWhich && await testBin(fromWhich)) { ytdlpBin = fromWhich; return fromWhich; }

  // Scan /nix/store — covers Railway nixpacks where the path is a hash
  const fromNix = await shellFind('find /nix -name yt-dlp -type f 2>/dev/null | head -1');
  if (fromNix && await testBin(fromNix)) { ytdlpBin = fromNix; return fromNix; }

  // Scan /run (some nix profiles)
  const fromRun = await shellFind('find /run -name yt-dlp -type f 2>/dev/null | head -1');
  if (fromRun && await testBin(fromRun)) { ytdlpBin = fromRun; return fromRun; }

  return null;
}

// --- yt-dlp download -----------------------------------------------------
// Tries multiple YouTube player clients in order.
// The iOS client bypasses PO-token bot detection without cookies.
const YT_PLAYER_CLIENTS = [
  'ios,web_embedded',
  'ios',
  'tv_embedded',
  'web_embedded,web',
  'web',
];

function ytdlpDownload(bin, url, kind, clientStr) {
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
      '-f', fmt,
      '--no-playlist', '--no-warnings', '--no-check-certificate',
      '--extractor-args', `youtube:player_client=${clientStr}`,
      '--user-agent', UA,
      '--max-filesize', String(MAX_MEDIA_BYTES),
      '--socket-timeout', '30',
      '--retries', '2',
      ...cookiesArgs,
      '-o', out, url,
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
        if (buf.length < 2048) return reject(new Error('output file too small'));
        resolve(buf);
      } catch (e) { reject(e); }
    });
  });
}

async function ytdlpDownloadWithFallback(bin, url, kind) {
  const errors = [];
  for (const client of YT_PLAYER_CLIENTS) {
    try {
      const buf = await ytdlpDownload(bin, url, kind, client);
      return { buf, source: `yt-dlp(${client})` };
    } catch (e) {
      errors.push(`${client}: ${e.message?.slice(0, 80)}`);
      // If it's not a bot-detection error, no point retrying other clients
      if (!e.message?.includes('Sign in') && !e.message?.includes('bot') && !e.message?.includes('403')) break;
    }
  }
  throw new Error(errors.join(' | '));
}

// --- @distube/ytdl-core --------------------------------------------------
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
    format = info.formats
      .filter(f => f.hasAudio && !f.hasVideo && (f.container === 'm4a' || f.mimeType?.includes('audio/mp4')))
      .sort((a, b) => (b.audioBitrate || 0) - (a.audioBitrate || 0))[0];
    if (!format) format = ytdl.chooseFormat(info.formats, { quality: 'highestaudio', filter: 'audioonly' });
  } else {
    format = info.formats
      .filter(f => f.hasVideo && f.hasAudio && f.container === 'mp4' && (f.height || 720) <= 480)
      .sort((a, b) => (b.height || 0) - (a.height || 0))[0];
    if (!format) format = ytdl.chooseFormat(info.formats, { quality: '480p', filter: 'videoandaudio' });
    if (!format) format = ytdl.chooseFormat(info.formats, { filter: 'videoandaudio' });
  }
  if (!format?.url) throw new Error('no suitable format');
  const r = await axios.get(format.url, {
    responseType: 'arraybuffer', timeout: 90000,
    maxContentLength: MAX_MEDIA_BYTES, maxBodyLength: MAX_MEDIA_BYTES,
    headers: { 'User-Agent': UA, ...(format.requestHeaders || {}) },
  });
  const buf = Buffer.from(r.data);
  if (buf.length < 2048) throw new Error('stream too small');
  return buf;
}

// --- Invidious -----------------------------------------------------------
const INVIDIOUS_INSTANCES = [
  'https://invidious.nerdvpn.de',
  'https://invidious.fdn.fr',
  'https://yt.artemislena.eu',
  'https://invidious.lunar.icu',
  'https://inv.tux.pizza',
  'https://yewtu.be',
  'https://invidious.io',
  'https://inv.nadeko.net',
  'https://invidious.privacydev.net',
];

function videoIdFromUrl(url) {
  const m = url.match(/[?&]v=([A-Za-z0-9_-]{11})/);
  return m ? m[1] : null;
}

async function invidiosFetch(ytUrl, kind) {
  const videoId = videoIdFromUrl(ytUrl);
  if (!videoId) throw new Error('could not parse video id');
  for (const base of INVIDIOUS_INSTANCES) {
    try {
      const data = await helpers.getJson(
        `${base}/api/v1/videos/${videoId}?fields=formatStreams,adaptiveFormats`,
        { timeout: 10000, headers: { 'User-Agent': UA } },
      );
      if (kind === 'video') {
        const streams = (data?.formatStreams || []).filter(f => f.type?.includes('video/mp4'));
        const pick = streams.find(f => (f.quality || '').includes('480'))
                  || streams.find(f => (f.quality || '').includes('360'))
                  || streams[0];
        if (pick?.url) return { directUrl: pick.url, source: `invidious` };
      } else {
        const adaptives = data?.adaptiveFormats || [];
        const pick = adaptives.find(f => f.type?.includes('audio/mp4'))
                  || adaptives.find(f => f.audioSampleRate);
        if (pick?.url) return { directUrl: pick.url, source: `invidious` };
      }
    } catch (_) {}
  }
  throw new Error('all invidious instances failed');
}

// --- Piped ---------------------------------------------------------------
const PIPED_STREAM_INSTANCES = [
  'https://pipedapi.kavin.rocks',
  'https://pipedapi.adminforge.de',
  'https://piped-api.garudalinux.org',
  'https://pipedapi.r4fo.com',
  'https://piped.video/api',
  'https://piped.smnz.de/api',
  'https://piped.in.projectsegfau.lt/api',
];

async function pipedFetch(ytUrl, kind) {
  const videoId = videoIdFromUrl(ytUrl);
  if (!videoId) throw new Error('could not parse video id');
  for (const base of PIPED_STREAM_INSTANCES) {
    try {
      const data = await helpers.getJson(
        `${base}/streams/${videoId}`,
        { timeout: 10000, headers: { 'User-Agent': UA } },
      );
      if (kind === 'audio') {
        const streams = (data?.audioStreams || []).sort((a, b) => (b.bitrate || 0) - (a.bitrate || 0));
        if (streams[0]?.url) return { directUrl: streams[0].url, source: `piped` };
      } else {
        const streams = (data?.videoStreams || [])
          .filter(s => s.mimeType?.includes('mp4'))
          .sort((a, b) => (b.height || 0) - (a.height || 0));
        const pick = streams.find(s => !s.videoOnly && (s.height || 0) <= 480)
                  || streams.find(s => !s.videoOnly)
                  || streams[0];
        if (pick?.url) return { directUrl: pick.url, source: `piped` };
      }
    } catch (_) {}
  }
  throw new Error('all piped instances failed');
}

async function downloadCapped(url, cap = MAX_MEDIA_BYTES) {
  const r = await axios.get(url, {
    responseType: 'arraybuffer', timeout: 120000,
    maxContentLength: cap, maxBodyLength: cap,
    headers: { 'User-Agent': UA },
  });
  const buf = Buffer.from(r.data);
  if (buf.length < 1024) throw new Error('payload too small');
  return buf;
}

// --- Main download chain -------------------------------------------------
async function fetchYouTubeMedia(url, kind) {
  const errors = [];

  // 1. yt-dlp — searched dynamically across all known locations including /nix/store
  const bin = await findYtdlp();
  if (bin) {
    try {
      return await ytdlpDownloadWithFallback(bin, url, kind);
    } catch (e) { errors.push(`yt-dlp(${bin}): ${e.message?.slice(0, 180)}`); }
  } else {
    errors.push('yt-dlp: not found anywhere on this system');
  }

  // 2. Invidious direct stream URLs
  try {
    const { directUrl, source } = await invidiosFetch(url, kind);
    return { buf: await downloadCapped(directUrl), source };
  } catch (e) { errors.push(`invidious: ${e.message?.slice(0, 80)}`); }

  // 3. Piped direct stream URLs
  try {
    const { directUrl, source } = await pipedFetch(url, kind);
    return { buf: await downloadCapped(directUrl), source };
  } catch (e) { errors.push(`piped: ${e.message?.slice(0, 80)}`); }

  // 4. ytdl-core
  try { return { buf: await ytdlCoreDownload(url, kind), source: 'ytdl-core' }; }
  catch (e) { errors.push(`ytdl-core: ${e.message?.slice(0, 80)}`); }

  throw new Error(errors.join(' | '));
}

// --- Search --------------------------------------------------------------
async function search(q) {
  const r = await ytSearchSafe(q);
  const vids = r?.videos || [];
  if (!vids.length) return null;
  const tokens = q.toLowerCase().split(/\s+/).filter(Boolean);
  const scoreOf = (v) => {
    const title = (v.title || '').toLowerCase();
    const author = (v.author?.name || '').toLowerCase();
    let score = 0;
    for (const t of tokens) {
      if (title.includes(t)) score += 3;
      if (author.includes(t)) score += 2;
    }
    if (/official\s+(audio|video|music)/i.test(v.title)) score += 3;
    if (/lyrics?/i.test(v.title)) score += 1;
    if (/\btopic\b|vevo/i.test(v.author?.name || '')) score += 3;
    if (/reaction|tutorial|cover|sped\s*up|nightcore|slowed/i.test(v.title)) score -= 3;
    if (/mix|playlist|hours?/i.test(v.title)) score -= 1;
    const sec = v.duration?.seconds || 0;
    if (sec >= 45 && sec <= 720) score += 1;
    else if (sec > 720) score -= 2;
    score += Math.min(3, Math.log10((v.views || 1) + 1) / 2);
    return score;
  };
  return vids.slice(0, 15).map(v => ({ v, s: scoreOf(v) })).sort((a, b) => b.s - a.s)[0]?.v || vids[0];
}

async function ytSearchSafe(query) {
  try { const r = await yts(query); if (r?.videos?.length) return r; } catch (_) {}
  try { const r = await ytSearchScrape(query); if (r?.videos?.length) return r; } catch (_) {}
  try { return await ytSearchPiped(query); } catch (_) {}
  return { videos: [] };
}

async function ytSearchScrape(query) {
  const html = await helpers.getText(
    `https://www.youtube.com/results?search_query=${encodeURIComponent(query)}`,
    { timeout: 15000, headers: { 'User-Agent': UA, 'Accept-Language': 'en-US,en;q=0.9' } },
  );
  const m = html.match(/var ytInitialData = (\{[\s\S]+?\});\s*<\/script>/);
  if (!m) return { videos: [] };
  let data;
  try { data = JSON.parse(m[1]); } catch { return { videos: [] }; }
  const out = [];
  const sections = data?.contents?.twoColumnSearchResultsRenderer?.primaryContents?.sectionListRenderer?.contents || [];
  for (const sec of sections) {
    const items = sec?.itemSectionRenderer?.contents || [];
    for (const it of items) {
      const v = it?.videoRenderer;
      if (!v?.videoId) continue;
      const title = v.title?.runs?.[0]?.text || '';
      const lengthText = v.lengthText?.simpleText || '';
      const seconds = (() => { const p = lengthText.split(':').map(Number); return p.some(isNaN) ? 0 : p.reduce((a, b) => a * 60 + b, 0); })();
      out.push({
        title, videoId: v.videoId,
        url: `https://www.youtube.com/watch?v=${v.videoId}`,
        author: { name: v.ownerText?.runs?.[0]?.text || v.longBylineText?.runs?.[0]?.text || '' },
        duration: { seconds, timestamp: lengthText }, timestamp: lengthText,
        views: Number((v.viewCountText?.simpleText || '0').replace(/\D/g, '')) || 0,
      });
      if (out.length >= 20) break;
    }
    if (out.length >= 20) break;
  }
  return { videos: out };
}

const PIPED_INSTANCES = ['https://pipedapi.kavin.rocks', 'https://pipedapi.adminforge.de', 'https://pipedapi.r4fo.com'];
async function ytSearchPiped(query) {
  for (const base of PIPED_INSTANCES) {
    try {
      const data = await helpers.getJson(`${base}/search?q=${encodeURIComponent(query)}&filter=videos`, { timeout: 12000 });
      const items = (data?.items || []).filter(x => x.url || x.videoId);
      if (!items.length) continue;
      return {
        videos: items.slice(0, 20).map(x => {
          const id = x.videoId || (x.url || '').split('?v=').pop();
          return {
            title: x.title || '', videoId: id,
            url: `https://www.youtube.com/watch?v=${id}`,
            author: { name: x.uploaderName || x.uploader || '' },
            duration: { seconds: x.duration || 0, timestamp: secsToStamp(x.duration) },
            timestamp: secsToStamp(x.duration), views: x.views || 0,
          };
        }),
      };
    } catch (_) {}
  }
  return { videos: [] };
}

function secsToStamp(s) {
  if (!s || s < 0) return '';
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
  if (h) return `${h}:${String(m).padStart(2,'0')}:${String(sec).padStart(2,'0')}`;
  return `${m}:${String(sec).padStart(2,'0')}`;
}

// --- Lyrics --------------------------------------------------------------
async function fetchLyrics(query) {
  const parts = query.split(/\s*-\s*/);
  const artist = parts.length > 1 ? (parts[0] || '').trim() : '';
  const song = (parts.length > 1 ? parts.slice(1).join(' - ') : query).trim();
  try {
    const data = await helpers.getJson(`https://lrclib.net/api/search?q=${encodeURIComponent(query)}`, { timeout: 12000 });
    const hit = Array.isArray(data) ? data.find(x => x.plainLyrics || x.syncedLyrics) : null;
    const text = hit?.plainLyrics || stripLrcTimestamps(hit?.syncedLyrics);
    if (text) return { text, title: hit ? `${hit.artistName} — ${hit.trackName}` : null };
  } catch (_) {}
  if (artist && song) {
    try {
      const data = await helpers.getJson(`https://lrclib.net/api/get?artist_name=${encodeURIComponent(artist)}&track_name=${encodeURIComponent(song)}`, { timeout: 12000 });
      const text = data?.plainLyrics || stripLrcTimestamps(data?.syncedLyrics);
      if (text) return { text, title: `${data.artistName} — ${data.trackName}` };
    } catch (_) {}
  }
  try {
    const data = await helpers.getJson(`https://some-random-api.com/lyrics?title=${encodeURIComponent(query)}`, { timeout: 12000 });
    if (data?.lyrics) return { text: data.lyrics, title: data.title ? `${data.author || ''} — ${data.title}` : null };
  } catch (_) {}
  return null;
}

function stripLrcTimestamps(s) {
  if (!s) return '';
  return s.replace(/\[\d{2}:\d{2}(?:\.\d{1,3})?\]/g, '').trim();
}

// --- Commands ------------------------------------------------------------
module.exports = [
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
    name: 'play', aliases: ['song', 'mp3', 'ytmp3'],
    description: 'Send audio for a song name',
    handler: async ({ argText, sock, jid, m, reply }) => {
      if (!argText) return reply('Usage: .play <song name>');
      await reply(`🔎 Searching *${argText}*...`);
      let v;
      try { v = await search(argText); } catch (e) { return reply(`Search error: ${e.message?.slice(0, 100)}`); }
      if (!v) return reply('❌ Not found on YouTube.');
      await reply(`🎵 Found: *${v.title}* — downloading audio...`);
      try {
        const { buf, source } = await fetchYouTubeMedia(v.url, 'audio');
        await sock.sendMessage(jid, {
          audio: buf, mimetype: 'audio/mp4', ptt: false,
          fileName: `${v.title}.mp3`,
        }, { quoted: m });
        await reply(`🎵 *${v.title}*\n${v.author?.name || ''} · ${v.timestamp || ''}\n_via ${source}_`);
      } catch (e) {
        reply(`❌ Download failed for *${v.title}*\n_${e.message?.slice(0, 300)}_`);
      }
    },
  },
  {
    name: 'video', aliases: ['ytmp4', 'ytvideo'],
    description: 'Send video for a song/clip name',
    handler: async ({ argText, sock, jid, m, reply }) => {
      if (!argText) return reply('Usage: .video <name>');
      await reply(`🔎 Searching *${argText}*...`);
      let v;
      try { v = await search(argText); } catch (e) { return reply(`Search error: ${e.message?.slice(0, 100)}`); }
      if (!v) return reply('❌ Not found on YouTube.');
      await reply(`🎬 Found: *${v.title}* — downloading video...`);
      try {
        const { buf, source } = await fetchYouTubeMedia(v.url, 'video');
        await sock.sendMessage(jid, {
          video: buf, mimetype: 'video/mp4',
          caption: `🎬 *${v.title}*\n_via ${source}_`,
        }, { quoted: m });
      } catch (e) {
        reply(`❌ Download failed for *${v.title}*\n_${e.message?.slice(0, 300)}_\n\n_Try *.play ${argText}* for audio._`);
      }
    },
  },
  {
    name: 'ytdlpcheck', aliases: ['checkytdlp'],
    description: 'Check if yt-dlp is available on this server',
    handler: async ({ reply }) => {
      const bin = await findYtdlp();
      if (bin) {
        reply(`✅ yt-dlp found at: \`${bin}\`\nSet *YTDLP_BIN=${bin}* in your Railway env vars for faster startup.`);
      } else {
        reply('❌ yt-dlp not found anywhere on this server.\nIt must be installed in the Docker image or nixpacks config.');
      }
    },
  },
  {
    name: 'lyrics', description: 'Fetch song lyrics',
    handler: async ({ argText, reply }) => {
      if (!argText) return reply('Usage: .lyrics <song>  or  .lyrics <artist> - <song>');
      try {
        const result = await fetchLyrics(argText);
        if (!result) return reply('No lyrics found.');
        const header = result.title ? `🎤 *${result.title}*\n\n` : '';
        const body = result.text.length > 3500 ? result.text.slice(0, 3500) + '\n\n_…truncated_' : result.text;
        reply(header + body);
      } catch (e) { reply(`Lyrics unavailable: ${e.message?.slice(0, 120)}`); }
    },
  },
  {
    name: 'ringtone', description: 'Search a ringtone',
    handler: async ({ argText, reply }) => reply(`https://www.zedge.net/find/ringtones/${encodeURIComponent(argText || 'top')}`),
  },
  {
    name: 'scloud', description: 'SoundCloud search',
    handler: async ({ argText, reply }) => reply(`https://soundcloud.com/search?q=${encodeURIComponent(argText || 'top')}`),
  },
];

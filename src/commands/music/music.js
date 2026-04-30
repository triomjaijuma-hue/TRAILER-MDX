'use strict';
const yts = require('yt-search');
const axios = require('axios');
const { execFile } = require('child_process');
const fs = require('fs');
const path = require('path');
const helpers = require('../../lib/helpers');
const config = require('../../lib/config');

// WhatsApp's media upload practical ceiling is ~16 MB for inline audio/video.
// Hard-cap to be safe and tell the user to use the link instead when over.
const MAX_MEDIA_BYTES = 14 * 1024 * 1024;
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

// --- 2026 provider chain ------------------------------------------------
//
// The classic stack (`ytdl-core`, `@distube/ytdl-core`, `cobalt.tools`) is
// effectively dead in 2026: ytdl-core needs PoToken/visitorData, cobalt
// closed its public API behind Turnstile, and most community wrapper APIs
// (giftedtech, princetechn, davidcyril, dreaded, nyxs, savetube, ...) are
// either offline, rate-locked, or return "Failed to fetch video information".
//
// The ONLY reliable path on a server in 2026 is yt-dlp running locally.
// The Dockerfile / nixpacks already install it. We try the local binary
// first; if it isn't on PATH for some reason, we fall through to whatever
// wrapper APIs still respond — better than nothing.

const YTDLP_BIN = process.env.YTDLP_BIN || 'yt-dlp';
let ytdlpAvailable = null; // lazy probe
function probeYtdlp() {
  if (ytdlpAvailable !== null) return Promise.resolve(ytdlpAvailable);
  return new Promise((resolve) => {
    execFile(YTDLP_BIN, ['--version'], { timeout: 5000 }, (err) => {
      ytdlpAvailable = !err;
      resolve(ytdlpAvailable);
    });
  });
}

function ytdlpDownload(url, kind /* 'audio' | 'video' */) {
  return new Promise((resolve, reject) => {
    helpers.ensureTmp();
    const id = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
    const ext = kind === 'audio' ? 'm4a' : 'mp4';
    const out = path.join(config.paths.tmp, `yt_${id}.${ext}`);
    const fmt = kind === 'audio'
      ? 'bestaudio[ext=m4a]/bestaudio/best'
      : 'best[ext=mp4][height<=480]/best[height<=480]/best[ext=mp4]/best';
    const args = [
      '-f', fmt,
      '--no-playlist',
      '--no-warnings',
      '--no-check-certificate',
      '--max-filesize', String(MAX_MEDIA_BYTES),
      '--socket-timeout', '20',
      '--retries', '2',
      '-o', out,
      url,
    ];
    execFile(YTDLP_BIN, args, { timeout: 120000, maxBuffer: 16 * 1024 * 1024 }, (err, _so, se) => {
      if (err) {
        try { fs.unlinkSync(out); } catch (_) {}
        const msg = (se || err.message || '').toString().split('\n').filter(Boolean).slice(-2).join(' ').slice(0, 300);
        return reject(new Error(msg || 'yt-dlp failed'));
      }
      try {
        const buf = fs.readFileSync(out);
        fs.unlinkSync(out);
        if (buf.length < 2048) return reject(new Error('yt-dlp output too small'));
        resolve(buf);
      } catch (e) {
        reject(e);
      }
    });
  });
}

// Each provider exposes:
//   build(url): the GET endpoint to hit
//   pick(data): pulls the direct media URL out of the JSON response
const AUDIO_PROVIDERS = [
  {
    name: 'cobalt',
    method: 'POST',
    build: () => 'https://api.cobalt.tools/',
    body: (u) => ({ url: u, downloadMode: 'audio', audioFormat: 'mp3' }),
    pick: (d) => (d?.status === 'tunnel' || d?.status === 'redirect') ? d?.url : null,
  },
  {
    name: 'davidcyril',
    build: (u) => `https://api.davidcyriltech.xyz/download/ytmp3?url=${encodeURIComponent(u)}`,
    pick: (d) => d?.result?.download_url || d?.audio?.url || d?.url,
  },
  {
    name: 'dreaded',
    build: (u) => `https://api.dreaded.site/api/ytdl/audio?url=${encodeURIComponent(u)}`,
    pick: (d) => d?.result?.url || d?.url,
  },
];

const VIDEO_PROVIDERS = [
  {
    name: 'cobalt',
    method: 'POST',
    build: () => 'https://api.cobalt.tools/',
    body: (u) => ({ url: u, downloadMode: 'auto', videoQuality: '480' }),
    pick: (d) => (d?.status === 'tunnel' || d?.status === 'redirect') ? d?.url : null,
  },
  {
    name: 'davidcyril',
    build: (u) => `https://api.davidcyriltech.xyz/download/ytmp4?url=${encodeURIComponent(u)}`,
    pick: (d) => d?.result?.download_url || d?.video?.url || d?.url,
  },
  {
    name: 'dreaded',
    build: (u) => `https://api.dreaded.site/api/ytdl/video?url=${encodeURIComponent(u)}`,
    pick: (d) => d?.result?.url || d?.url,
  },
];

// Hit a provider, follow its JSON shape, and return the resolved download URL.
async function resolveDirectUrl(providers, ytUrl) {
  const errors = [];
  for (const p of providers) {
    try {
      const cfg = {
        timeout: 25000,
        headers: { 'User-Agent': UA, Accept: 'application/json', 'Content-Type': 'application/json' },
        validateStatus: () => true,
      };
      const r = p.method === 'POST'
        ? await axios.post(p.build(ytUrl), p.body(ytUrl), cfg)
        : await axios.get(p.build(ytUrl), cfg);
      if (r.status >= 400) { errors.push(`${p.name}: HTTP ${r.status}`); continue; }
      const direct = p.pick(r.data);
      if (direct && /^https?:\/\//.test(direct)) return { direct, source: p.name };
      errors.push(`${p.name}: no url in response`);
    } catch (e) {
      errors.push(`${p.name}: ${e.message?.slice(0, 80) || 'failed'}`);
    }
  }
  throw new Error(errors.join(' | ') || 'no provider responded');
}

// Stream a remote URL into a buffer with a hard size cap so we don't OOM.
async function downloadCapped(url, cap = MAX_MEDIA_BYTES) {
  const r = await axios.get(url, {
    responseType: 'arraybuffer',
    timeout: 90000,
    maxContentLength: cap,
    maxBodyLength: cap,
    headers: { 'User-Agent': UA },
  });
  const buf = Buffer.from(r.data);
  if (buf.length < 1024) throw new Error('downloaded payload too small');
  return buf;
}

// Top-level: try local yt-dlp first, then fall back to wrapper APIs.
async function fetchYouTubeMedia(url, kind /* 'audio' | 'video' */) {
  if (await probeYtdlp()) {
    try {
      const buf = await ytdlpDownload(url, kind);
      return { buf, source: 'yt-dlp' };
    } catch (e) {
      // fall through to API providers
      var ytdlpErr = e.message;
    }
  }
  const providers = kind === 'audio' ? AUDIO_PROVIDERS : VIDEO_PROVIDERS;
  try {
    const { direct, source } = await resolveDirectUrl(providers, url);
    const buf = await downloadCapped(direct);
    return { buf, source };
  } catch (e) {
    const reason = ytdlpErr ? `yt-dlp: ${ytdlpErr} | ${e.message}` : e.message;
    throw new Error(reason);
  }
}

// --- search -------------------------------------------------------------

// Pick the result that best matches the query, instead of blindly
// taking the first hit (which is often a remix / cover / reaction).
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
    if (/reaction|tutorial|cover|how to play|guitar lesson|piano lesson|sped\s*up|nightcore|slowed/i.test(v.title)) score -= 3;
    if (/mix|playlist|hours?/i.test(v.title)) score -= 1;
    const sec = v.duration?.seconds || 0;
    if (sec >= 45 && sec <= 720) score += 1;
    else if (sec > 720) score -= 2;
    score += Math.min(3, Math.log10((v.views || 1) + 1) / 2);
    return score;
  };

  const ranked = vids.slice(0, 15)
    .map(v => ({ v, s: scoreOf(v) }))
    .sort((a, b) => b.s - a.s);
  return ranked[0]?.v || vids[0];
}

// yt-search occasionally throws after YouTube tweaks its initialData
// payload. Wrap it and fall back to scraping the search results page so
// .ytsearch / .play don't dead-end on a TypeError. As a final fallback
// we use Piped/Invidious public mirrors which expose a stable JSON API.
async function ytSearchSafe(query) {
  try {
    const r = await yts(query);
    if (r?.videos?.length) return r;
  } catch (_) {}
  try {
    const r = await ytSearchScrape(query);
    if (r?.videos?.length) return r;
  } catch (_) {}
  try {
    return await ytSearchPiped(query);
  } catch (_) {}
  return { videos: [] };
}

async function ytSearchScrape(query) {
  const html = await helpers.getText(
    `https://www.youtube.com/results?search_query=${encodeURIComponent(query)}`,
    { timeout: 15000, headers: { 'User-Agent': UA, 'Accept-Language': 'en-US,en;q=0.9' } },
  );
  // Anchor on the closing `;</script>` so we capture the full nested JSON
  // instead of stopping at the first `}` (the old non-greedy regex did).
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
      const seconds = (() => {
        const parts = lengthText.split(':').map(Number);
        if (parts.some(isNaN)) return 0;
        return parts.reduce((a, b) => a * 60 + b, 0);
      })();
      out.push({
        title,
        videoId: v.videoId,
        url: `https://www.youtube.com/watch?v=${v.videoId}`,
        author: { name: v.ownerText?.runs?.[0]?.text || v.longBylineText?.runs?.[0]?.text || '' },
        duration: { seconds, timestamp: lengthText },
        timestamp: lengthText,
        views: Number((v.viewCountText?.simpleText || '0').replace(/\D/g, '')) || 0,
      });
      if (out.length >= 20) break;
    }
    if (out.length >= 20) break;
  }
  return { videos: out };
}

const PIPED_INSTANCES = [
  'https://pipedapi.kavin.rocks',
  'https://pipedapi.adminforge.de',
  'https://pipedapi.r4fo.com',
];

async function ytSearchPiped(query) {
  for (const base of PIPED_INSTANCES) {
    try {
      const data = await helpers.getJson(
        `${base}/search?q=${encodeURIComponent(query)}&filter=videos`,
        { timeout: 12000 },
      );
      const items = (data?.items || []).filter(x => x.url || x.videoId);
      if (!items.length) continue;
      return {
        videos: items.slice(0, 20).map(x => {
          const id = x.videoId || (x.url || '').split('?v=').pop();
          return {
            title: x.title || '',
            videoId: id,
            url: `https://www.youtube.com/watch?v=${id}`,
            author: { name: x.uploaderName || x.uploader || '' },
            duration: { seconds: x.duration || 0, timestamp: secsToStamp(x.duration) },
            timestamp: secsToStamp(x.duration),
            views: x.views || 0,
          };
        }),
      };
    } catch (_) {}
  }
  return { videos: [] };
}

function secsToStamp(s) {
  if (!s || s < 0) return '';
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (h) return `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
  return `${m}:${String(sec).padStart(2, '0')}`;
}

// --- lyrics -------------------------------------------------------------
//
// lrclib.net is a community-maintained karaoke-lyrics database with a free
// no-key API and is the most reliable option in 2026. We start with the
// search endpoint (works for loose queries) and fall back to /get for
// "artist - title" style queries, then lyrics.ovh as last resort.
async function fetchLyrics(query) {
  const parts = query.split(/\s*-\s*/);
  const artist = parts.length > 1 ? (parts[0] || '').trim() : '';
  const song   = (parts.length > 1 ? parts.slice(1).join(' - ') : query).trim();

  // 1) lrclib search — handles loose queries like "shape of you"
  try {
    const data = await helpers.getJson(
      `https://lrclib.net/api/search?q=${encodeURIComponent(query)}`,
      { timeout: 12000 },
    );
    const hit = Array.isArray(data) ? data.find(x => x.plainLyrics || x.syncedLyrics) : null;
    const text = hit?.plainLyrics || stripLrcTimestamps(hit?.syncedLyrics);
    if (text) return { text, title: hit ? `${hit.artistName} — ${hit.trackName}` : null };
  } catch (_) {}

  // 2) lrclib direct lookup — only when we have explicit artist + song
  if (artist && song) {
    try {
      const data = await helpers.getJson(
        `https://lrclib.net/api/get?artist_name=${encodeURIComponent(artist)}&track_name=${encodeURIComponent(song)}`,
        { timeout: 12000 },
      );
      const text = data?.plainLyrics || stripLrcTimestamps(data?.syncedLyrics);
      if (text) return { text, title: `${data.artistName} — ${data.trackName}` };
    } catch (_) {}
  }

  // 3) lyrics.ovh
  if (artist && song && artist !== song) {
    try {
      const data = await helpers.getJson(
        `https://api.lyrics.ovh/v1/${encodeURIComponent(artist)}/${encodeURIComponent(song)}`,
        { timeout: 12000 },
      );
      if (data?.lyrics) return { text: data.lyrics, title: `${artist} — ${song}` };
    } catch (_) {}
  }

  // 4) some-random-api
  try {
    const data = await helpers.getJson(
      `https://some-random-api.com/lyrics?title=${encodeURIComponent(query)}`,
      { timeout: 12000 },
    );
    if (data?.lyrics) return { text: data.lyrics, title: data.title ? `${data.author || ''} — ${data.title}` : null };
  } catch (_) {}

  return null;
}

function stripLrcTimestamps(s) {
  if (!s) return '';
  return s.replace(/\[\d{2}:\d{2}(?:\.\d{1,3})?\]\s?/g, '').trim();
}

// --- commands -----------------------------------------------------------
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
        reply(top.map(v => `• ${v.title}\n  ${v.timestamp || (v.duration?.timestamp || '')} · ${v.author?.name || ''}\n  ${v.url}`).join('\n\n'));
      } catch (e) {
        reply(`YouTube search failed: ${e?.message?.slice(0, 200) || 'unknown'}`);
      }
    },
  },
  {
    name: 'play', aliases: ['song', 'mp3', 'ytmp3'],
    description: 'Send audio for a song name',
    handler: async ({ argText, sock, jid, m, reply }) => {
      if (!argText) return reply('Usage: .play <song name>');
      await reply(`🔎 Searching for *${argText}*...`);
      const v = await search(argText);
      if (!v) return reply('Not found on YouTube.');
      try {
        const { buf, source } = await fetchYouTubeMedia(v.url, 'audio');
        await sock.sendMessage(jid, {
          audio: buf,
          mimetype: 'audio/mp4',
          ptt: false,
          fileName: `${v.title}.mp3`,
        }, { quoted: m });
        await reply(`🎵 *${v.title}*\n${v.author?.name || ''} · ${v.timestamp || v.duration?.timestamp || ''}\n${v.url}\n_via ${source}_`);
      } catch (e) {
        reply(`❌ Audio download failed.\n\n*${v.title}*\n${v.url}\n\n_${e.message?.slice(0, 250)}_`);
      }
    },
  },
  {
    name: 'video', aliases: ['ytmp4', 'ytvideo'],
    description: 'Send video for a song/clip name',
    handler: async ({ argText, sock, jid, m, reply }) => {
      if (!argText) return reply('Usage: .video <name>');
      await reply(`🔎 Searching for *${argText}*...`);
      const v = await search(argText);
      if (!v) return reply('Not found on YouTube.');
      try {
        const { buf, source } = await fetchYouTubeMedia(v.url, 'video');
        await sock.sendMessage(jid, { video: buf, mimetype: 'video/mp4', caption: `${v.title}\n_via ${source}_` }, { quoted: m });
      } catch (e) {
        reply(`❌ Video download failed.\n*${v.title}*\n${v.url}\n_${e.message?.slice(0, 250)}_\n\n_Long videos may exceed WhatsApp's 14 MB limit — try .play ${argText} for audio only._`);
      }
    },
  },
  {
    name: 'lyrics', description: 'Fetch lyrics',
    handler: async ({ argText, reply }) => {
      if (!argText) return reply('Usage: .lyrics <song name>  or  .lyrics <artist> - <song>');
      try {
        const result = await fetchLyrics(argText);
        if (!result) return reply('No lyrics found. Try a more specific query like `.lyrics <artist> - <song>`.');
        const header = result.title ? `🎤 *${result.title}*\n\n` : '';
        const body = result.text.length > 3500 ? result.text.slice(0, 3500) + '\n\n_…truncated_' : result.text;
        reply(header + body);
      } catch (e) {
        reply(`Lyrics service unavailable: ${e.message?.slice(0, 120)}`);
      }
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

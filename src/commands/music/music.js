'use strict';
const yts = require('yt-search');
const axios = require('axios');
const helpers = require('../../lib/helpers');

// WhatsApp's media upload practical ceiling is ~16 MB for inline audio/video.
// We hard-cap to be safe and tell the user to use the link instead when over.
const MAX_MEDIA_BYTES = 14 * 1024 * 1024;
const UA = 'Mozilla/5.0 (Linux; Android 13) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Mobile Safari/537.36';

// --- 2026 provider chain ------------------------------------------------
//
// The classic stack (`ytdl-core`, `@distube/ytdl-core`, `cobalt.tools`) is
// effectively dead in 2026: ytdl-core has been broken since YouTube's player
// JS overhaul, distube needs PoToken/visitorData and gets bot-flagged on
// shared IPs, and cobalt killed its public API. The WhatsApp-bot community
// has converged on a handful of wrapper services that proxy yt-dlp on the
// backend. None of them are guaranteed to be up at any given moment, so we
// just try them in order and use the first one that returns a usable URL.
//
// Each provider exposes:
//   build(url): the GET endpoint to hit
//   pick(data): pulls the direct media URL out of the JSON response
const AUDIO_PROVIDERS = [
  {
    name: 'giftedtech',
    build: (u) => `https://api.giftedtech.web.id/api/download/dlmp3?apikey=gifted&url=${encodeURIComponent(u)}`,
    pick: (d) => d?.result?.download_url || d?.result?.url || d?.url,
  },
  {
    name: 'princetechn',
    build: (u) => `https://api.princetechn.com/api/download/ytmp3?apikey=prince&url=${encodeURIComponent(u)}`,
    pick: (d) => d?.result?.download_url || d?.result?.url,
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
  {
    name: 'nyxs',
    build: (u) => `https://api.nyxs.pw/dl/yt-mp3?url=${encodeURIComponent(u)}`,
    pick: (d) => d?.result?.url || d?.url,
  },
];

const VIDEO_PROVIDERS = [
  {
    name: 'giftedtech',
    build: (u) => `https://api.giftedtech.web.id/api/download/dlmp4?apikey=gifted&url=${encodeURIComponent(u)}`,
    pick: (d) => d?.result?.download_url || d?.result?.url || d?.url,
  },
  {
    name: 'princetechn',
    build: (u) => `https://api.princetechn.com/api/download/ytmp4?apikey=prince&url=${encodeURIComponent(u)}`,
    pick: (d) => d?.result?.download_url || d?.result?.url,
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
  {
    name: 'nyxs',
    build: (u) => `https://api.nyxs.pw/dl/yt-mp4?url=${encodeURIComponent(u)}`,
    pick: (d) => d?.result?.url || d?.url,
  },
];

// Hit a provider, follow its JSON shape, and return the resolved download URL.
async function resolveDirectUrl(providers, ytUrl) {
  const errors = [];
  for (const p of providers) {
    try {
      const r = await axios.get(p.build(ytUrl), {
        timeout: 25000,
        headers: { 'User-Agent': UA, Accept: 'application/json' },
        validateStatus: () => true,
      });
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

// Stream a remote URL into a buffer with a hard size cap so we don't OOM
// on a 2-hour upload-as-audio mix.
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
// .ytsearch / .play don't dead-end on a TypeError.
async function ytSearchSafe(query) {
  try {
    return await yts(query);
  } catch (e) {
    return await ytSearchScrape(query);
  }
}

async function ytSearchScrape(query) {
  const html = await helpers.getText(`https://www.youtube.com/results?search_query=${encodeURIComponent(query)}`, { timeout: 15000 });
  const m = html.match(/var ytInitialData = (\{[\s\S]*?\});/);
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

// --- lyrics -------------------------------------------------------------
//
// lyrics.ovh has been intermittently down through 2025-26. lrclib.net is a
// community-maintained karaoke-lyrics database with a free no-key API and
// is the most reliable option in 2026. We fall through to lyrics.ovh and
// some-random-api as last resorts.
async function fetchLyrics(query) {
  const parts = query.split(/\s*-\s*/);
  const artist = (parts[0] || '').trim();
  const song   = (parts[1] || query).trim();

  // 1) lrclib.net
  try {
    const data = await helpers.getJson(
      `https://lrclib.net/api/get?artist_name=${encodeURIComponent(artist || song)}&track_name=${encodeURIComponent(song)}`,
      { timeout: 12000 },
    );
    const text = data?.plainLyrics || stripLrcTimestamps(data?.syncedLyrics);
    if (text) return text;
  } catch (_) {}

  // 1b) lrclib search (when the user gives a loose query)
  try {
    const data = await helpers.getJson(
      `https://lrclib.net/api/search?q=${encodeURIComponent(query)}`,
      { timeout: 12000 },
    );
    const hit = Array.isArray(data) ? data.find(x => x.plainLyrics || x.syncedLyrics) : null;
    const text = hit?.plainLyrics || stripLrcTimestamps(hit?.syncedLyrics);
    if (text) return text;
  } catch (_) {}

  // 2) lyrics.ovh
  if (artist && song && artist !== song) {
    try {
      const data = await helpers.getJson(
        `https://api.lyrics.ovh/v1/${encodeURIComponent(artist)}/${encodeURIComponent(song)}`,
        { timeout: 12000 },
      );
      if (data?.lyrics) return data.lyrics;
    } catch (_) {}
  }

  // 3) some-random-api
  try {
    const data = await helpers.getJson(
      `https://some-random-api.com/lyrics?title=${encodeURIComponent(query)}`,
      { timeout: 12000 },
    );
    if (data?.lyrics) return data.lyrics;
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
        const { direct, source } = await resolveDirectUrl(AUDIO_PROVIDERS, v.url);
        const buf = await downloadCapped(direct);
        await sock.sendMessage(jid, {
          audio: buf,
          mimetype: 'audio/mp4',
          ptt: false,
          fileName: `${v.title}.mp3`,
        }, { quoted: m });
        await reply(`🎵 *${v.title}*\n${v.author?.name || ''} · ${v.timestamp || v.duration?.timestamp || ''}\n${v.url}\n_via ${source}_`);
      } catch (e) {
        reply(`❌ Audio download failed.\n\n*${v.title}*\n${v.url}\n\n_All providers refused. Try the link directly, or .video ${argText} for the video version._\n_Reason: ${e.message?.slice(0, 200)}_`);
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
        const { direct, source } = await resolveDirectUrl(VIDEO_PROVIDERS, v.url);
        const buf = await downloadCapped(direct);
        await sock.sendMessage(jid, { video: buf, mimetype: 'video/mp4', caption: `${v.title}\n_via ${source}_` }, { quoted: m });
      } catch (e) {
        reply(`❌ Video download failed.\n*${v.title}*\n${v.url}\n_${e.message?.slice(0, 200)}_\n\n_Long videos may exceed WhatsApp's upload limit — try .play ${argText} for audio only._`);
      }
    },
  },
  {
    name: 'lyrics', description: 'Fetch lyrics',
    handler: async ({ argText, reply }) => {
      if (!argText) return reply('Usage: .lyrics <song name>  or  .lyrics <artist> - <song>');
      try {
        const text = await fetchLyrics(argText);
        if (!text) return reply('No lyrics found. Try a more specific query like `.lyrics <artist> - <song>`.');
        reply(text.length > 3500 ? text.slice(0, 3500) + '\n\n_…truncated_' : text);
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

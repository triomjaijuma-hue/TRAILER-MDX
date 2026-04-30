'use strict';
const yts = require('yt-search');
// @distube/ytdl-core is a maintained fork that patches around YouTube's frequent changes.
// We keep the original ytdl-core as a secondary fallback.
const ytdlDistube = require('@distube/ytdl-core');
const ytdlOriginal = require('ytdl-core');
const axios = require('axios');
const helpers = require('../../lib/helpers');

// WhatsApp's media upload practical ceiling is ~16 MB for inline audio/video.
// We hard-cap to be safe and tell the user to use the link instead when over.
const MAX_MEDIA_BYTES = 14 * 1024 * 1024;

// Cobalt v10 instances. The community mirrors that used to be public
// (co.wuk.sh, capi.oak.li) are dead/intermittent. We keep only sources
// that actually answer in 2026.
const COBALT_INSTANCES = [
  'https://api.cobalt.tools/api/json',  // legacy v7-compatible JSON endpoint
  'https://api.cobalt.tools',           // v10
];

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

// Try multiple strategies to get an audio buffer for a YouTube URL.
async function fetchAudio(url) {
  const errors = [];

  // Strategy 1: @distube/ytdl-core (maintained)
  try {
    const stream = ytdlDistube(url, { filter: 'audioonly', quality: 'highestaudio' });
    const buf = await streamWithCap(stream, MAX_MEDIA_BYTES);
    if (buf && buf.length > 1024) return { buf, source: '@distube/ytdl-core' };
  } catch (e) { errors.push(`distube: ${e.message}`); }

  // Strategy 2: original ytdl-core
  try {
    const stream = ytdlOriginal(url, { filter: 'audioonly', quality: 'highestaudio' });
    const buf = await streamWithCap(stream, MAX_MEDIA_BYTES);
    if (buf && buf.length > 1024) return { buf, source: 'ytdl-core' };
  } catch (e) { errors.push(`ytdl: ${e.message}`); }

  // Strategy 3: Cobalt
  for (const base of COBALT_INSTANCES) {
    try {
      const r = await axios.post(
        base,
        { url, downloadMode: 'audio', audioFormat: 'mp3' },
        { timeout: 30000, headers: { Accept: 'application/json', 'Content-Type': 'application/json' }, validateStatus: () => true }
      );
      const direct = r.data?.url || r.data?.audio;
      if (direct) {
        const audio = await axios.get(direct, { responseType: 'arraybuffer', timeout: 60000, maxContentLength: MAX_MEDIA_BYTES, maxBodyLength: MAX_MEDIA_BYTES });
        const buf = Buffer.from(audio.data);
        if (buf.length > 1024) return { buf, source: `cobalt(${base.replace('https://', '')})` };
      } else if (r.data?.status === 'error') {
        errors.push(`cobalt(${base}): ${r.data?.error?.code || 'error'}`);
      }
    } catch (e) { errors.push(`cobalt(${base}): ${e.message}`); }
  }

  throw new Error(errors.join(' | ') || 'no working audio source');
}

// Read a stream into a buffer but bail out cleanly once we exceed `cap`.
// Prevents OOM and silent WhatsApp upload failures on long videos.
async function streamWithCap(stream, cap) {
  return await new Promise((resolve, reject) => {
    const chunks = [];
    let total = 0;
    stream.on('data', (c) => {
      total += c.length;
      if (total > cap) {
        try { stream.destroy(); } catch (_) {}
        return reject(new Error(`media exceeds ${Math.round(cap / 1024 / 1024)} MB limit`));
      }
      chunks.push(c);
    });
    stream.on('end', () => resolve(Buffer.concat(chunks)));
    stream.on('error', reject);
  });
}

async function fetchVideo(url) {
  const errors = [];

  // 360p mp4 (smaller, more likely to actually upload to WhatsApp).
  const filter = (format) =>
    format.container === 'mp4' && format.hasVideo && format.hasAudio &&
    (!format.height || format.height <= 360);

  try {
    const stream = ytdlDistube(url, { quality: 'highest', filter });
    const buf = await streamWithCap(stream, MAX_MEDIA_BYTES);
    if (buf?.length > 1024) return { buf, source: '@distube/ytdl-core' };
  } catch (e) { errors.push(`distube: ${e.message}`); }

  try {
    const stream = ytdlOriginal(url, { quality: 'highest', filter });
    const buf = await streamWithCap(stream, MAX_MEDIA_BYTES);
    if (buf?.length > 1024) return { buf, source: 'ytdl-core' };
  } catch (e) { errors.push(`ytdl: ${e.message}`); }

  for (const base of COBALT_INSTANCES) {
    try {
      const r = await axios.post(
        base,
        { url, downloadMode: 'auto', videoQuality: '360' },
        { timeout: 30000, headers: { Accept: 'application/json', 'Content-Type': 'application/json' }, validateStatus: () => true }
      );
      const direct = r.data?.url;
      if (direct) {
        const v = await axios.get(direct, { responseType: 'arraybuffer', timeout: 90000, maxContentLength: MAX_MEDIA_BYTES, maxBodyLength: MAX_MEDIA_BYTES });
        const buf = Buffer.from(v.data);
        if (buf.length > 1024) return { buf, source: `cobalt(${base.replace('https://', '')})` };
      } else if (r.data?.status === 'error') {
        errors.push(`cobalt(${base}): ${r.data?.error?.code || 'error'}`);
      }
    } catch (e) { errors.push(`cobalt(${base}): ${e.message}`); }
  }

  throw new Error(errors.join(' | ') || 'no working video source');
}

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
        const { buf } = await fetchAudio(v.url);
        await sock.sendMessage(jid, {
          audio: buf,
          mimetype: 'audio/mp4',
          ptt: false,
          fileName: `${v.title}.mp3`,
        }, { quoted: m });
        await reply(`🎵 *${v.title}*\n${v.author?.name || ''} · ${v.timestamp || v.duration?.timestamp || ''}\n${v.url}`);
      } catch (e) {
        reply(`❌ All audio sources failed.\n\n*${v.title}*\n${v.url}\n\nTip: try \`.ytmp4 ${argText}\` for video, or open the link directly.\n_Reason: ${e.message?.slice(0, 200)}_`);
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
        const { buf } = await fetchVideo(v.url);
        await sock.sendMessage(jid, { video: buf, mimetype: 'video/mp4', caption: v.title }, { quoted: m });
      } catch (e) {
        reply(`❌ Video fetch failed.\n*${v.title}*\n${v.url}\n_${e.message?.slice(0, 200)}_\n\n_Tip: long videos exceed WhatsApp's upload limit — try \`.play ${argText}\` for audio only._`);
      }
    },
  },
  {
    name: 'lyrics', description: 'Fetch lyrics',
    handler: async ({ argText, reply }) => {
      if (!argText) return reply('Usage: .lyrics <artist - song>');
      try {
        const parts = argText.split(/\s*-\s*/);
        const artist = parts[0] || 'artist';
        const song = parts[1] || argText;
        const data = await helpers.getJson(`https://api.lyrics.ovh/v1/${encodeURIComponent(artist)}/${encodeURIComponent(song)}`);
        reply(data.lyrics ? data.lyrics.slice(0, 3500) : 'No lyrics found. Try `.lyrics <artist> - <song>`.');
      } catch { reply('Lyrics service unavailable.'); }
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

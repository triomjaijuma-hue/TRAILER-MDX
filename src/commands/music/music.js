'use strict';
const yts = require('yt-search');
// @distube/ytdl-core is a maintained fork that patches around YouTube's frequent changes.
// We keep the original ytdl-core as a secondary fallback.
const ytdlDistube = require('@distube/ytdl-core');
const ytdlOriginal = require('ytdl-core');
const axios = require('axios');
const helpers = require('../../lib/helpers');

async function search(q) {
  const r = await yts(q);
  return r.videos?.[0] || null;
}

// Try multiple strategies to get an audio buffer for a YouTube URL.
async function fetchAudio(url) {
  const errors = [];

  // Strategy 1: @distube/ytdl-core (maintained)
  try {
    const stream = ytdlDistube(url, { filter: 'audioonly', quality: 'highestaudio' });
    const chunks = [];
    for await (const c of stream) chunks.push(c);
    const buf = Buffer.concat(chunks);
    if (buf.length > 1024) return { buf, source: '@distube/ytdl-core' };
  } catch (e) { errors.push(`distube: ${e.message}`); }

  // Strategy 2: original ytdl-core
  try {
    const stream = ytdlOriginal(url, { filter: 'audioonly', quality: 'highestaudio' });
    const chunks = [];
    for await (const c of stream) chunks.push(c);
    const buf = Buffer.concat(chunks);
    if (buf.length > 1024) return { buf, source: 'ytdl-core' };
  } catch (e) { errors.push(`ytdl: ${e.message}`); }

  // Strategy 3: Cobalt public API (no key required)
  try {
    const r = await axios.post(
      'https://api.cobalt.tools/api/json',
      { url, isAudioOnly: true, aFormat: 'mp3' },
      { timeout: 30000, headers: { Accept: 'application/json', 'Content-Type': 'application/json' } }
    );
    const direct = r.data?.url || r.data?.audio;
    if (direct) {
      const audio = await axios.get(direct, { responseType: 'arraybuffer', timeout: 60000 });
      const buf = Buffer.from(audio.data);
      if (buf.length > 1024) return { buf, source: 'cobalt' };
    }
  } catch (e) { errors.push(`cobalt: ${e.message}`); }

  throw new Error(errors.join(' | ') || 'no working audio source');
}

module.exports = [
  {
    name: 'ytsearch', aliases: ['ysearch'],
    description: 'YouTube search',
    handler: async ({ argText, reply }) => {
      if (!argText) return reply('Usage: .ytsearch <query>');
      const r = await yts(argText);
      const top = (r.videos || []).slice(0, 6);
      if (!top.length) return reply('Nothing found.');
      reply(top.map(v => `• ${v.title}\n  ${v.timestamp} · ${v.author?.name}\n  ${v.url}`).join('\n\n'));
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
        const { buf, source } = await fetchAudio(v.url);
        await sock.sendMessage(jid, {
          audio: buf,
          mimetype: 'audio/mp4',
          ptt: false,
          fileName: `${v.title}.mp3`,
        }, { quoted: m });
        await reply(`🎵 *${v.title}*\n${v.author?.name} · ${v.timestamp}\n${v.url}`);
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
        const stream = ytdlDistube(v.url, { quality: 'highestvideo', filter: format => format.container === 'mp4' && format.hasVideo && format.hasAudio });
        const chunks = [];
        for await (const c of stream) chunks.push(c);
        const buf = Buffer.concat(chunks);
        await sock.sendMessage(jid, { video: buf, mimetype: 'video/mp4', caption: v.title }, { quoted: m });
      } catch (e) {
        reply(`❌ Video fetch failed.\n*${v.title}*\n${v.url}\n_${e.message?.slice(0, 200)}_`);
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

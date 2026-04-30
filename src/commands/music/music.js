'use strict';
const yts = require('yt-search');
const ytdl = require('ytdl-core');
const helpers = require('../../lib/helpers');

async function search(q) {
  const r = await yts(q);
  return r.videos?.[0] || null;
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
    name: 'play', aliases: ['song'],
    description: 'Send audio for a song name',
    handler: async ({ argText, sock, jid, m, reply }) => {
      if (!argText) return reply('Usage: .play <song name>');
      const v = await search(argText);
      if (!v) return reply('Not found.');
      try {
        const stream = ytdl(v.url, { filter: 'audioonly', quality: 'highestaudio' });
        const chunks = [];
        for await (const c of stream) chunks.push(c);
        const buf = Buffer.concat(chunks);
        await sock.sendMessage(jid, {
          audio: buf, mimetype: 'audio/mpeg', ptt: false,
        }, { quoted: m });
        await reply(`*${v.title}*\n${v.author?.name} · ${v.timestamp}\n${v.url}`);
      } catch (e) {
        reply(`Audio fetch failed: ${e?.message}\nLink: ${v.url}`);
      }
    },
  },
  {
    name: 'lyrics', description: 'Fetch lyrics',
    handler: async ({ argText, reply }) => {
      if (!argText) return reply('Usage: .lyrics <song>');
      try {
        const data = await helpers.getJson(`https://api.lyrics.ovh/v1/${encodeURIComponent(argText.split(' - ')[0] || 'artist')}/${encodeURIComponent(argText.split(' - ')[1] || argText)}`);
        reply(data.lyrics ? data.lyrics.slice(0, 3500) : 'No lyrics found.');
      } catch { reply('Lyrics service unavailable.'); }
    },
  },
  {
    name: 'ringtone', description: 'Search a ringtone',
    handler: async ({ argText, reply }) => reply(`https://www.zedge.net/find/ringtones/${encodeURIComponent(argText)}`),
  },
  {
    name: 'scloud', description: 'SoundCloud search',
    handler: async ({ argText, reply }) => reply(`https://soundcloud.com/search?q=${encodeURIComponent(argText)}`),
  },
];

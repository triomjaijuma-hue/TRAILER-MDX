'use strict';
const helpers = require('../../lib/helpers');
const axios = require('axios');

// Cobalt v10 changed the API. There is no single canonical free instance any
// more — try the official one, then a couple of community mirrors. Body schema
// changed too: {url, downloadMode, audioFormat, videoQuality}.
const COBALT_INSTANCES = [
  'https://api.cobalt.tools',
  'https://co.wuk.sh',
  'https://capi.oak.li',
];

async function cobaltResolve(targetUrl, audioOnly = false) {
  const body = audioOnly
    ? { url: targetUrl, downloadMode: 'audio', audioFormat: 'mp3' }
    : { url: targetUrl, downloadMode: 'auto', videoQuality: '720' };
  let lastErr;
  for (const base of COBALT_INSTANCES) {
    try {
      const r = await axios.post(`${base}/`, body, {
        timeout: 25000,
        headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
      });
      const d = r.data;
      // v10: { status: 'redirect'|'tunnel'|'picker'|'error', url, picker }
      // legacy: { status: 'success'|'stream'|'picker', url, audio, picker }
      if (d?.status === 'error') { lastErr = new Error(d?.error?.code || 'cobalt error'); continue; }
      if (d?.url) return { url: d.url };
      if (d?.audio) return { url: d.audio };
      if (Array.isArray(d?.picker) && d.picker.length) return { picker: d.picker.map(p => p.url).filter(Boolean).slice(0, 5) };
    } catch (e) {
      lastErr = e;
    }
  }
  throw lastErr || new Error('All cobalt instances unreachable.');
}

function makeFetcher(name, hint) {
  return {
    name,
    description: `Download from ${name}`,
    handler: async ({ argText, reply }) => {
      if (!argText) return reply(`Usage: .${name} <url>`);
      try {
        const result = await cobaltResolve(argText.trim(), false);
        if (result.url) return reply(`*${name}*\n${result.url}`);
        if (result.picker) return reply(`*${name} — pick one:*\n${result.picker.join('\n')}`);
        return reply(`Could not auto-resolve. ${hint || ''}`.trim());
      } catch (e) {
        return reply(`Download service unavailable for *${name}* (${e?.message || 'unknown error'}). ${hint || ''}`.trim());
      }
    },
  };
}

module.exports = [
  makeFetcher('facebook'),
  makeFetcher('instagram'),
  makeFetcher('tiktok'),
  makeFetcher('twitter'),
  makeFetcher('snapchat'),
  makeFetcher('sharechat'),
  makeFetcher('snack'),
  makeFetcher('terabox'),
  makeFetcher('mediafire'),
  makeFetcher('mega'),
  makeFetcher('vidsplay'),
  makeFetcher('dlstatus'),
  // NOTE: .video and .spotify intentionally removed here — they collide with
  // the music plugin which already handles YouTube and Spotify properly.
  {
    name: 'apkdl', description: 'Search APK on apkpure',
    handler: async ({ argText, reply }) => {
      if (!argText) return reply('Usage: .apkdl <app name>');
      reply(`Open: https://apkpure.com/search?q=${encodeURIComponent(argText)}`);
    },
  },
  {
    name: 'gimage', description: 'Image search results',
    handler: async ({ argText, reply }) => {
      if (!argText) return reply('Usage: .gimage <query>');
      reply(`Open: https://www.google.com/search?tbm=isch&q=${encodeURIComponent(argText)}`);
    },
  },
  {
    name: 'alamy', description: 'Alamy stock search',
    handler: async ({ argText, reply }) => reply(`https://www.alamy.com/search/imageresults.aspx?qt=${encodeURIComponent(argText)}`),
  },
  {
    name: 'getty', description: 'Getty Images search',
    handler: async ({ argText, reply }) => reply(`https://www.gettyimages.com/photos/${encodeURIComponent(argText)}`),
  },
  {
    name: 'istock', description: 'iStock search',
    handler: async ({ argText, reply }) => reply(`https://www.istockphoto.com/search/2/image?phrase=${encodeURIComponent(argText)}`),
  },
  {
    name: 'gitclone', description: 'Send a GitHub repo as a zip',
    handler: async ({ argText, sock, jid, m, reply }) => {
      const u = (argText || '').match(/github\.com\/([\w.-]+)\/([\w.-]+)/);
      if (!u) return reply('Usage: .gitclone https://github.com/user/repo');
      const tries = [
        `https://codeload.github.com/${u[1]}/${u[2]}/zip/refs/heads/main`,
        `https://codeload.github.com/${u[1]}/${u[2]}/zip/refs/heads/master`,
        `https://api.github.com/repos/${u[1]}/${u[2]}/zipball`,
      ];
      for (const url of tries) {
        try {
          const buf = await helpers.downloadToBuffer(url, { timeout: 60000 });
          if (buf && buf.length > 100) {
            await sock.sendMessage(jid, { document: buf, fileName: `${u[2]}.zip`, mimetype: 'application/zip' }, { quoted: m });
            return;
          }
        } catch (_) {}
      }
      reply('Could not fetch repo zip — branch may not exist or repo is private.');
    },
  },
  {
    name: 'gitclone2', description: 'Same as .gitclone (master branch)',
    handler: async (ctx) => {
      const handler = require('../../handler');
      return handler.getCommands().get('gitclone').handler(ctx);
    },
  },
];

'use strict';
const helpers = require('../../lib/helpers');
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const config = require('../../lib/config');

function makeFetcher(name, hint) {
  return {
    name,
    description: `Download from ${name}`,
    handler: async ({ argText, reply }) => {
      if (!argText) return reply(`Usage: .${name} <url>`);
      // Try a public any-downloader API (best-effort, may rate-limit)
      try {
        const r = await helpers.getJson(`https://api.cobalt.tools/api/json`, {
          headers: { 'Accept': 'application/json', 'Content-Type': 'application/json' },
        }).catch(() => null);
        // We use a POST below if GET-style not supported
      } catch (_) {}
      try {
        const post = await require('axios').post('https://api.cobalt.tools/api/json',
          { url: argText, vQuality: '720', isAudioOnly: false },
          { headers: { 'Accept': 'application/json', 'Content-Type': 'application/json' }, timeout: 30000 });
        const d = post.data;
        if (d?.url) return reply(`*${name}*\n${d.url}`);
        if (d?.picker) return reply(d.picker.map(p => `• ${p.url}`).slice(0, 5).join('\n'));
        return reply(`Could not auto-resolve. ${hint || ''}`.trim());
      } catch (e) {
        return reply(`Download service unavailable. ${hint || ''}`.trim());
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
  makeFetcher('spotify'),
  makeFetcher('vidsplay'),
  makeFetcher('video'),
  makeFetcher('dlstatus'),
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
      const zip = `https://codeload.github.com/${u[1]}/${u[2]}/zip/refs/heads/main`;
      try {
        const buf = await helpers.downloadToBuffer(zip, { timeout: 60000 });
        await sock.sendMessage(jid, { document: buf, fileName: `${u[2]}.zip`, mimetype: 'application/zip' }, { quoted: m });
      } catch {
        const zip2 = `https://codeload.github.com/${u[1]}/${u[2]}/zip/refs/heads/master`;
        const buf = await helpers.downloadToBuffer(zip2, { timeout: 60000 }).catch(() => null);
        if (!buf) return reply('Could not fetch repo zip.');
        await sock.sendMessage(jid, { document: buf, fileName: `${u[2]}.zip`, mimetype: 'application/zip' }, { quoted: m });
      }
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

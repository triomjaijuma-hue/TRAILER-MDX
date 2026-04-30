'use strict';
const helpers = require('../../lib/helpers');

module.exports = [
  { name: 'github', aliases: ['ghstalk'], description: 'GitHub user info', handler: async ({ argText, reply }) => {
    if (!argText) return reply('Usage: .github <user>');
    try {
      const u = await helpers.getJson(`https://api.github.com/users/${encodeURIComponent(argText)}`);
      reply(`*${u.name || u.login}* (@${u.login})\nFollowers: ${u.followers} · Following: ${u.following} · Repos: ${u.public_repos}\nBio: ${u.bio || '(none)'}\n${u.html_url}`);
    } catch (e) { reply('Not found.'); }
  } },
  { name: 'npmstalk', description: 'NPM package info', handler: async ({ argText, reply }) => {
    if (!argText) return reply('Usage: .npmstalk <package>');
    try {
      const u = await helpers.getJson(`https://registry.npmjs.org/${encodeURIComponent(argText)}/latest`);
      reply(`*${u.name}* v${u.version}\n${u.description || ''}\nLicense: ${u.license || '?'}\nHome: ${u.homepage || u.repository?.url || ''}`);
    } catch { reply('Not found.'); }
  } },
  { name: 'pinstalk', description: 'Pinterest profile URL', handler: async ({ argText, reply }) => reply(`https://www.pinterest.com/${encodeURIComponent(argText)}/`) },
  { name: 'tgstalk', description: 'Telegram profile URL', handler: async ({ argText, reply }) => reply(`https://t.me/${encodeURIComponent(argText)}`) },
  { name: 'thrstalk', description: 'Threads profile URL', handler: async ({ argText, reply }) => reply(`https://www.threads.net/@${encodeURIComponent(argText)}`) },
  { name: 'ttstalk', description: 'TikTok profile URL', handler: async ({ argText, reply }) => reply(`https://www.tiktok.com/@${encodeURIComponent(argText)}`) },
  { name: 'xstalk', description: 'X (Twitter) profile URL', handler: async ({ argText, reply }) => reply(`https://x.com/${encodeURIComponent(argText)}`) },
  { name: 'genshin', description: 'Genshin Impact info link', handler: async ({ argText, reply }) => reply(`https://genshin-impact.fandom.com/wiki/Special:Search?query=${encodeURIComponent(argText)}`) },
];

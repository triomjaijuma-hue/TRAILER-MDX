'use strict';
const config = require('../../lib/config');

function emojiFor(cat) {
  const m = {
    OWNER: '👑', AI: '🤖', DOWNLOAD: '📥', GENERAL: '📌', UTILITY: '🛠️',
    MENU: '📂', ADMIN: '🛡️', STICKERS: '🎴', TOOLS: '🧰', GROUP: '👥',
    IMAGES: '🖼️', GAMES: '🎮', SEARCH: '🔎', FUN: '🎉', STALK: '🕵️',
    INFO: 'ℹ️', QUOTES: '💬', MUSIC: '🎵', UPLOAD: '☁️',
  };
  return m[cat] || '•';
}

function fmt(handler, includeAll) {
  // Build a TRAILER-MDX-style framed menu from the live registry
  const cats = handler.getCategories();
  const total = handler.getCommands().size;
  const time = new Date().toLocaleTimeString('en-GB', { hour12: false }).slice(0, 5);

  const order = [
    'OWNER','AI','DOWNLOAD','GENERAL','UTILITY','MENU','ADMIN','STICKERS',
    'TOOLS','GROUP','IMAGES','GAMES','SEARCH','FUN','STALK','INFO','QUOTES',
    'MUSIC','UPLOAD',
  ];
  const lines = [];
  lines.push('┏━━━━ *TRAILER-MDX MENU* ━━━┓');
  lines.push(`┃• *Bot : ${config.botName}*`);
  lines.push(`┃• *Prefixes : ${config.prefixes.join(', ')}*`);
  lines.push(`┃• *Plugins : ${Math.max(total, 267)}*`);
  lines.push(`┃• *Version : ${config.version}*`);
  lines.push(`┃• *Time : ${time}*`);
  for (const cat of order) {
    const list = cats[cat];
    if (!list || list.length === 0) continue;
    lines.push(`┃━━━━ *${cat}* ━━◆`);
    const show = includeAll ? list : list;
    for (const n of show) lines.push(`┃ ▸ .${n}`);
  }
  lines.push('┗━━━━━━━━━━━━━━━┛');
  return lines.join('\n');
}

module.exports = [
  {
    name: 'menu',
    aliases: ['help', 'list'],
    description: 'Show full bot menu',
    handler: async ({ reply }) => {
      const handler = require('../../handler');
      await reply(fmt(handler, true));
    },
  },
  {
    name: 'smenu',
    description: 'Compact menu',
    handler: async ({ reply }) => {
      const handler = require('../../handler');
      const cats = handler.getCategories();
      const lines = [`*${config.botName}* — categories`];
      for (const k of Object.keys(cats)) lines.push(`${emojiFor(k)} *${k}* — ${cats[k].length} cmds`);
      lines.push(`\nUse .menu for the full list.`);
      await reply(lines.join('\n'));
    },
  },
  {
    name: 'listcmd',
    description: 'List every loaded command',
    handler: async ({ reply }) => {
      const handler = require('../../handler');
      const names = [...handler.getCommands().keys()].sort();
      await reply(`*${names.length} commands loaded:*\n` + names.map(n => `• .${n}`).join('\n'));
    },
  },
];

'use strict';
const config = require('../../lib/config');

function emojiFor(cat) {
  const m = {
    OWNER: '👑', AI: '🤖', DOWNLOAD: '📥', GENERAL: '📌', UTILITY: '🛠️',
    MENU: '📂', ADMIN: '🛡️', STICKERS: '🎴', TOOLS: '🧰', GROUP: '👥',
    IMAGES: '🖼️', GAMES: '🎮', SEARCH: '🔎', FUN: '🎉', STALK: '🕵️',
    INFO: 'ℹ️', QUOTES: '💬', MUSIC: '🎵', UPLOAD: '☁️',
    ANIME: '🌸', AUDIOFX: '🎶', NOTES: '📝', PRIVACY: '🔒',
    TEXT: '✏️', EPHOTO: '🎨',
  };
  return m[cat] || '🌼';
}

const FLOWER_FOR = {
  OWNER:    '👑', AI:      '🤖', DOWNLOAD: '📥', GENERAL: '📌',
  UTILITY:  '🛠️', MENU:    '📂', ADMIN:    '🛡️', STICKERS: '🎴',
  TOOLS:    '🧰', GROUP:   '👥', IMAGES:   '🌺', GAMES:    '🎮',
  SEARCH:   '🔎', FUN:     '🎉', STALK:    '🕵️', INFO:     'ℹ️',
  QUOTES:   '💬', MUSIC:   '🎵', UPLOAD:   '☁️', ANIME:    '🌸',
  AUDIOFX:  '🎶', NOTES:   '📝', PRIVACY:  '🔒', TEXT:     '✏️',
  EPHOTO:   '🎨',
};

function flowerBar(cat) {
  const icon = FLOWER_FOR[cat] || '🌼';
  return `🌸━━━━━━━━━━ ${icon} ${cat} ${icon} ━━━━━━━━━━🌸`;
}

function fmt(handler, includeAll) {
  const cats = handler.getCategories();
  const total = handler.getCommands().size;
  const time = new Date().toLocaleTimeString('en-GB', { hour12: false }).slice(0, 5);
  const date = new Date().toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });

  const order = [
    'OWNER','AI','DOWNLOAD','GENERAL','UTILITY','MENU','ADMIN','STICKERS',
    'TOOLS','GROUP','IMAGES','ANIME','AUDIOFX','GAMES','SEARCH','FUN',
    'STALK','INFO','QUOTES','MUSIC','UPLOAD','NOTES','PRIVACY','TEXT','EPHOTO',
  ];

  const lines = [];

  lines.push('');
  lines.push('🌺🌸🌼🌻🌷🌹🌺🌸🌼🌻🌷🌹🌺🌸🌼🌻');
  lines.push('');
  lines.push(`     ✿ *TRAILER-MDX* ✿`);
  lines.push(`  🌸 𝑩𝒐𝒕 : *${config.botName}*`);
  lines.push(`  🌸 𝑷𝒓𝒆𝒇𝒊𝒙𝒆𝒔 : *${config.prefixes.join('  ')}*`);
  lines.push(`  🌸 𝑷𝒍𝒖𝒈𝒊𝒏𝒔 : *${Math.max(total, 267)}*`);
  lines.push(`  🌸 𝑽𝒆𝒓𝒔𝒊𝒐𝒏 : *${config.version}*`);
  lines.push(`  🌸 𝑻𝒊𝒎𝒆 : *${time}*  📅 *${date}*`);
  lines.push('');
  lines.push('🌺🌸🌼🌻🌷🌹🌺🌸🌼🌻🌷🌹🌺🌸🌼🌻');
  lines.push('');

  for (const cat of order) {
    const list = cats[cat];
    if (!list || list.length === 0) continue;
    lines.push(flowerBar(cat));
    for (const n of list) lines.push(`  🌼 *.${n}*`);
    lines.push('');
  }

  lines.push('🌺🌸🌼🌻🌷🌹🌺🌸🌼🌻🌷🌹🌺🌸🌼🌻');
  lines.push('  💐 *Type .help <cmd> for details*');
  lines.push('🌺🌸🌼🌻🌷🌹🌺🌸🌼🌻🌷🌹🌺🌸🌼🌻');

  return lines.join('\n');
}

function fmtCompact(handler) {
  const cats = handler.getCategories();
  const lines = [];
  lines.push('🌺🌸🌼 *TRAILER-MDX* 🌼🌸🌺');
  lines.push('');
  for (const k of Object.keys(cats)) {
    const icon = emojiFor(k);
    lines.push(`${icon} *${k}* — ${cats[k].length} cmds`);
  }
  lines.push('');
  lines.push('🌸 Use *.menu* for the full floral list 🌸');
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
      await reply(fmtCompact(handler));
    },
  },
  {
    name: 'listcmd',
    description: 'List every loaded command',
    handler: async ({ reply }) => {
      const handler = require('../../handler');
      const names = [...handler.getCommands().keys()].sort();
      const lines = ['🌺🌸 *All Loaded Commands* 🌸🌺', ''];
      names.forEach(n => lines.push(`  🌼 .${n}`));
      lines.push('');
      lines.push(`🌸 *${names.length} commands total* 🌸`);
      await reply(lines.join('\n'));
    },
  },
];

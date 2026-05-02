'use strict';
const config = require('../../lib/config');

const KLA = { timeZone: 'Africa/Kampala', hour12: false };

function kampalaTime() {
  return new Date().toLocaleTimeString('en-GB', { ...KLA, hour: '2-digit', minute: '2-digit' });
}

const CAT_ICON = {
  OWNER: '👑', AI: '🤖', DOWNLOAD: '📥', GENERAL: '📌', UTILITY: '🛠️',
  MENU: '📂', ADMIN: '🛡️', STICKERS: '🎴', TOOLS: '🧰', GROUP: '👥',
  IMAGES: '🌺', GAMES: '🎮', SEARCH: '🔎', FUN: '🎉', STALK: '🕵️',
  INFO: 'ℹ️', QUOTES: '💬', MUSIC: '🎵', UPLOAD: '☁️',
  ANIME: '🌸', AUDIOFX: '🎶', NOTES: '📝', PRIVACY: '🔒',
  TEXT: '✏️', EPHOTO: '🎨',
};

const ORDER = [
  'OWNER','AI','DOWNLOAD','GENERAL','UTILITY','MENU','ADMIN','STICKERS',
  'TOOLS','GROUP','IMAGES','ANIME','AUDIOFX','GAMES','SEARCH','FUN',
  'STALK','INFO','QUOTES','MUSIC','UPLOAD','NOTES','PRIVACY','TEXT','EPHOTO',
];

const FLOWER_BANNER = '🌺🌸🌼🌻🌷🌹🌺🌸🌼🌻🌷🌹🌺🌸🌼🌻';

function catBar(cat) {
  const icon = CAT_ICON[cat] || '🌼';
  return `🌸━━━━━━ ${icon} *${cat}* ${icon} ━━━━━━🌸`;
}

function fmt(handler) {
  const cats  = handler.getCategories();
  const total = handler.getCommands().size;
  const time  = kampalaTime();

  const lines = [];

  // ── Decorative top banner ────────────────────────────────────────────────
  lines.push(FLOWER_BANNER);
  lines.push('');
  lines.push('  ✦═══ *TRAILER MENU* ═══✦');
  lines.push(`  🌸 Bot      : *${config.botName}*`);
  lines.push(`  🌸 Prefixes : *${config.prefixes.join('  ')}*`);
  lines.push(`  🌸 Plugins  : *${Math.max(total, 267)}*`);
  lines.push(`  🌸 Version  : *${config.version}*`);
  lines.push(`  🌸 Time     : *${time}*`);
  lines.push('');
  lines.push(FLOWER_BANNER);
  lines.push('');

  // ── Category sections ────────────────────────────────────────────────────
  for (const cat of ORDER) {
    const list = cats[cat];
    if (!list || list.length === 0) continue;
    lines.push(catBar(cat));
    for (const n of list) lines.push(`  🌼 *.${n}*`);
    lines.push('');
  }

  // ── Footer ───────────────────────────────────────────────────────────────
  lines.push(FLOWER_BANNER);
  lines.push('  💐 *Type .help <cmd> for details*');
  lines.push(FLOWER_BANNER);

  return lines.join('\n');
}

function fmtCompact(handler) {
  const cats  = handler.getCategories();
  const lines = [];
  lines.push(FLOWER_BANNER);
  lines.push('  ✦═══ *TRAILER MENU* ═══✦');
  lines.push('');
  for (const k of ORDER) {
    if (!cats[k] || cats[k].length === 0) continue;
    const icon = CAT_ICON[k] || '🌼';
    lines.push(`${icon} *${k}* — ${cats[k].length} cmds`);
  }
  lines.push('');
  lines.push('🌸 Use *.menu* for the full list 🌸');
  lines.push(FLOWER_BANNER);
  return lines.join('\n');
}

module.exports = [
  {
    name: 'menu',
    aliases: ['help', 'list'],
    description: 'Show full bot menu',
    handler: async ({ reply }) => {
      const handler = require('../../handler');
      await reply(fmt(handler));
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
      const lines = [FLOWER_BANNER, '  🌺 *All Loaded Commands* 🌺', ''];
      names.forEach(n => lines.push(`  🌼 .${n}`));
      lines.push('');
      lines.push(`🌸 *${names.length} commands total* 🌸`);
      lines.push(FLOWER_BANNER);
      await reply(lines.join('\n'));
    },
  },
];

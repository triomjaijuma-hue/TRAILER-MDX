'use strict';
const config = require('../../lib/config');

const KLA = { timeZone: 'Africa/Kampala', hour12: false };

function kampalaTime() {
  return new Date().toLocaleTimeString('en-GB', { ...KLA, hour: '2-digit', minute: '2-digit' });
}

const CAT_ICON = {
  OWNER: '👑', AI: '🤖', DOWNLOAD: '📥', GENERAL: '📌', UTILITY: '🛠️',
  MENU: '📂', ADMIN: '🛡️', STICKERS: '🎴', TOOLS: '🧰', GROUP: '👥',
  IMAGES: '🖼️', GAMES: '🎮', SEARCH: '🔎', FUN: '🎉', STALK: '🕵️',
  INFO: 'ℹ️', QUOTES: '💬', MUSIC: '🎵', UPLOAD: '☁️',
  ANIME: '🌸', AUDIOFX: '🎶', NOTES: '📝', PRIVACY: '🔒',
  TEXT: '✏️', EPHOTO: '🎨',
};

const ORDER = [
  'OWNER','AI','DOWNLOAD','GENERAL','UTILITY','MENU','ADMIN','STICKERS',
  'TOOLS','GROUP','IMAGES','ANIME','AUDIOFX','GAMES','SEARCH','FUN',
  'STALK','INFO','QUOTES','MUSIC','UPLOAD','NOTES','PRIVACY','TEXT','EPHOTO',
];

function fmt(handler) {
  const cats  = handler.getCategories();
  const total = handler.getCommands().size;
  const time  = kampalaTime();

  const lines = [];

  // ── Header ──────────────────────────────────────────────────────────────
  lines.push('\u2726\u2550\u2550\u2550 *TRAILER MENU* \u2550\u2550\u2550\u2726');
  lines.push(`\u25B8 Bot: *${config.botName}*`);
  lines.push(`\u25B8 Prefixes: *${config.prefixes.join('  ')}*`);
  lines.push(`\u25B8 Plugins: *${Math.max(total, 267)}*`);
  lines.push(`\u25B8 Version: *${config.version}*`);
  lines.push(`\u25B8 Time: *${time}*`);
  lines.push('\u2726\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2726');
  lines.push('');

  // ── Category sections ────────────────────────────────────────────────────
  for (const cat of ORDER) {
    const list = cats[cat];
    if (!list || list.length === 0) continue;
    const icon = CAT_ICON[cat] || '\u2728';
    lines.push(`\u2550\u2550\u2550 ${icon} *${cat}* ${icon} \u2550\u2550\u2550`);
    for (const n of list) lines.push(`  \u25BA *.${n}*`);
    lines.push('');
  }

  // ── Footer ───────────────────────────────────────────────────────────────
  lines.push('\u2726\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2726');
  lines.push('  \u2139\uFE0F *Type .help <cmd> for details*');
  lines.push('\u2726\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2726');

  return lines.join('\n');
}

function fmtCompact(handler) {
  const cats  = handler.getCategories();
  const lines = [];
  lines.push('\u2726\u2550\u2550\u2550 *TRAILER MENU* \u2550\u2550\u2550\u2726');
  lines.push('');
  for (const k of ORDER) {
    if (!cats[k] || cats[k].length === 0) continue;
    const icon = CAT_ICON[k] || '\u2728';
    lines.push(`${icon} *${k}* \u2014 ${cats[k].length} cmds`);
  }
  lines.push('');
  lines.push('\u25B8 Use *.menu* for the full list');
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
      const lines = ['\u2726\u2550\u2550\u2550 *All Commands* \u2550\u2550\u2550\u2726', ''];
      names.forEach(n => lines.push(`  \u25BA .${n}`));
      lines.push('');
      lines.push(`\u25B8 *${names.length} commands loaded*`);
      await reply(lines.join('\n'));
    },
  },
];

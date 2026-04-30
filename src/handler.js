'use strict';
const fs = require('fs');
const path = require('path');
const config = require('./lib/config');
const logger = require('./lib/logger');
const helpers = require('./lib/helpers');
const store = require('./lib/store');
const ai = require('./lib/ai');

// Lazy-load all plugin command files
const commands = new Map(); // name -> { handler, category, description }
const aliases = new Map();

function registerCommand(name, def, category) {
  commands.set(name, { ...def, category, name });
  if (def.aliases) for (const a of def.aliases) aliases.set(a, name);
}

function loadPlugins() {
  const baseDir = config.paths.plugins;
  if (!fs.existsSync(baseDir)) return;
  const cats = fs.readdirSync(baseDir).filter(f =>
    fs.statSync(path.join(baseDir, f)).isDirectory()
  );
  for (const cat of cats) {
    const dir = path.join(baseDir, cat);
    for (const file of fs.readdirSync(dir).filter(f => f.endsWith('.js'))) {
      try {
        const mod = require(path.join(dir, file));
        const list = Array.isArray(mod) ? mod : (mod.commands || [mod]);
        for (const def of list) {
          if (!def || !def.name || !def.handler) continue;
          registerCommand(def.name, def, cat.toUpperCase());
        }
      } catch (e) {
        logger.error({ err: e?.message, file }, 'failed to load plugin file');
      }
    }
  }
  logger.info(`Loaded ${commands.size} commands across ${cats.length} categories.`);
}

function parsePrefix(text) {
  if (!text) return null;
  for (const p of config.prefixes) {
    if (text.startsWith(p)) return { prefix: p, rest: text.slice(p.length) };
  }
  return null;
}

function getMessageText(m) {
  const msg = m.message || {};
  return (
    msg.conversation ||
    msg.extendedTextMessage?.text ||
    msg.imageMessage?.caption ||
    msg.videoMessage?.caption ||
    msg.documentMessage?.caption ||
    msg.buttonsResponseMessage?.selectedButtonId ||
    msg.listResponseMessage?.singleSelectReply?.selectedRowId ||
    ''
  );
}

async function reply(sock, m, content) {
  const jid = m.key.remoteJid;
  if (typeof content === 'string') {
    return sock.sendMessage(jid, { text: content }, { quoted: m });
  }
  return sock.sendMessage(jid, content, { quoted: m });
}

function buildContext(sock, m) {
  const jid = m.key.remoteJid;
  const isGroup = jid.endsWith('@g.us');
  const sender = isGroup ? (m.key.participant || m.participant || jid) : jid;
  const fromMe = !!m.key.fromMe;
  return {
    sock, m, jid, sender, isGroup, fromMe,
    pushName: m.pushName || 'User',
    isOwner: helpers.isOwner(sender) || fromMe,
    text: getMessageText(m),
    reply: (c) => reply(sock, m, c),
    react: (emoji) => sock.sendMessage(jid, { react: { text: emoji, key: m.key } }).catch(() => {}),
  };
}

async function handleAutoFeatures(ctx) {
  const s = store.get();
  const { sock, m, jid, isGroup, sender } = ctx;
  if (s.autoread && !ctx.fromMe) {
    sock.readMessages([m.key]).catch(() => {});
  }
  if (s.autoreact && !ctx.fromMe) {
    const emojis = ['👍','❤️','🔥','✨','💯','🌟','⚡','🎯'];
    sock.sendMessage(jid, { react: { text: helpers.pickRandom(emojis), key: m.key } }).catch(() => {});
  }
  if (s.autotyping && !ctx.fromMe) {
    sock.sendPresenceUpdate('composing', jid).catch(() => {});
    setTimeout(() => sock.sendPresenceUpdate('paused', jid).catch(() => {}), 1500);
  }

  // .aion / .aionall auto-reply: only DMs, not groups, not from me
  const aiActive = s.aiOn[jid] === true || (s.aiOnAll && s.aiOn[jid] !== false);
  if (!isGroup && !ctx.fromMe && aiActive && ctx.text && !parsePrefix(ctx.text)) {
    try {
      const out = await ai.autoReply(jid, ctx.text);
      await reply(ctx.sock, m, out);
    } catch (_) {}
  }

  // Keyword auto-replies (.addreply)
  if (s.replies && ctx.text) {
    const k = ctx.text.trim().toLowerCase();
    if (s.replies[k]) await reply(sock, m, s.replies[k]);
  }
}

async function onMessages(sock, ev) {
  const messages = ev.messages || [];
  for (const m of messages) {
    if (!m || !m.message) continue;
    if (m.key && m.key.remoteJid === 'status@broadcast') {
      const s = store.get();
      if (s.autostatus) {
        try { await sock.readMessages([m.key]); } catch (_) {}
      }
      continue;
    }
    const ctx = buildContext(sock, m);
    if (!ctx.text) {
      try { await handleAutoFeatures(ctx); } catch (_) {}
      continue;
    }

    try { await handleAutoFeatures(ctx); } catch (_) {}

    const parsed = parsePrefix(ctx.text);
    if (!parsed) continue;

    const [cmdRaw, ...rest] = parsed.rest.trim().split(/\s+/);
    if (!cmdRaw) continue;
    const cmdName = cmdRaw.toLowerCase();
    const args = rest;
    const argText = rest.join(' ');

    let resolved = commands.get(cmdName) || (aliases.has(cmdName) ? commands.get(aliases.get(cmdName)) : null);

    const s = store.get();
    if (s.maintenance && !ctx.isOwner) {
      await ctx.reply('Bot is in *maintenance* mode. Try again later.');
      continue;
    }
    if (config.mode === 'private' && !ctx.isOwner) continue;
    if (s.banned?.includes(ctx.sender)) continue;

    if (!resolved) {
      // Unknown command — silent in groups, hint in DMs
      if (!ctx.isGroup) {
        await ctx.reply(`Unknown command *${cmdName}*. Type *.menu* for the full list.`);
      }
      continue;
    }

    // Owner-only check
    if (resolved.owner && !ctx.isOwner) {
      await ctx.reply('Owner-only command.');
      continue;
    }
    if (resolved.group && !ctx.isGroup) {
      await ctx.reply('This command works in groups only.');
      continue;
    }

    if (s.cmdReact) ctx.react('⏳');

    try {
      await resolved.handler({ ...ctx, args, argText, prefix: parsed.prefix, command: cmdName });
      if (s.cmdReact) ctx.react('✅');
    } catch (e) {
      logger.error({ err: e?.stack || e?.message, command: cmdName }, 'command failed');
      try { await ctx.reply(`Error running *${cmdName}*: ${e?.message || e}`); } catch (_) {}
      if (s.cmdReact) ctx.react('❌');
    }
  }
}

function getCommands() { return commands; }
function getCategories() {
  const out = {};
  for (const [name, def] of commands) {
    out[def.category] = out[def.category] || [];
    out[def.category].push(name);
  }
  for (const k of Object.keys(out)) out[k].sort();
  return out;
}

loadPlugins();

module.exports = { onMessages, getCommands, getCategories };

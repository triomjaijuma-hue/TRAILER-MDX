'use strict';
const fs = require('fs');
const path = require('path');
const config = require('./lib/config');
const logger = require('./lib/logger');
const helpers = require('./lib/helpers');
const store = require('./lib/store');
const ai = require('./lib/ai');
const gameSessions = require('./lib/gameSessions');

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

// --- Self-echo guard ----------------------------------------------------
// WhatsApp echoes every outbound message back to us through messages.upsert
// with key.fromMe = true. If a command's response happens to start with a
// configured prefix (e.g. an image caption "#tech" while '#' is a prefix),
// the bot will parse its own echo as a new command and loop forever, flooding
// the chat. To prevent this we monkey-patch sock.sendMessage once, remember
// every id we sent, and skip command processing for those ids when they
// re-arrive.
const ownSentIds = new Set();
const OWN_SENT_MAX = 1000;
function rememberOwnSent(key) {
  if (!key?.id) return;
  ownSentIds.add(key.id);
  if (ownSentIds.size > OWN_SENT_MAX) {
    const first = ownSentIds.values().next().value;
    ownSentIds.delete(first);
  }
}
const patchedSocks = new WeakSet();
function patchSock(sock) {
  if (!sock || patchedSocks.has(sock)) return;
  patchedSocks.add(sock);
  const orig = sock.sendMessage.bind(sock);
  sock.sendMessage = async (...args) => {
    // Emergency brake: when paused, silently drop every outbound message.
    // This kills runaway loops or noisy commands without restarting the bot.
    // Reactions/edits/etc. are dropped too — that's intentional.
    if (paused) return null;
    const result = await orig(...args);
    if (result?.key) rememberOwnSent(result.key);
    return result;
  };
}

// --- Emergency-brake state ----------------------------------------------
// Flipped by the .stop / .resume owner commands. When true, the patched
// sendMessage above no-ops every outbound, so even a misbehaving loop can
// only print to the bot's logs — nothing leaves WhatsApp.
let paused = false;
function setPaused(v) { paused = !!v; }
function isPaused()   { return paused; }

// Per-category title shown in the top of the banner. The category comes
// straight from the plugin folder name (admin/ -> ADMIN, etc.). If a new
// category folder is added we just fall back to the raw name.
const CATEGORY_TITLE = {
  ADMIN:    'ADMIN PANEL',
  AI:       'AI ASSISTANT',
  ANIME:    'ANIME ZONE',
  AUDIOFX:  'AUDIO EFFECTS',
  DOWNLOAD: 'DOWNLOADER',
  EPHOTO:   'PHOTO EFFECTS',
  FUN:      'FUN & GAMES',
  GAMES:    'GAMES',
  GENERAL:  'GENERAL',
  GROUP:    'GROUP TOOLS',
  IMAGES:   'IMAGE TOOLS',
  INFO:     'INFORMATION',
  MENU:     'MENU',
  MUSIC:    'MUSIC',
  NOTES:    'NOTES',
  OWNER:    'OWNER ZONE',
  PRIVACY:  'PRIVACY',
  QUOTES:   'QUOTES',
  SEARCH:   'SEARCH',
  STALK:    'STALKER TOOLS',
  STICKERS: 'STICKER MAKER',
  TEXT:     'TEXT STYLES',
  TOOLS:    'UTILITIES',
  UPLOAD:   'UPLOADER',
  UTILITY:  'UTILITY',
};

function bannerWrap(category, body) {
  const title = CATEGORY_TITLE[category] || category || 'COMMAND';
  const top = `╭━━━〔 *${title}* 〕━━━╮`;
  const bot = `╰━━━〔 *${config.botName}* 〕━━━╯`;
  // Don't double-wrap: if a command already produced a banner (e.g. menus),
  // leave it alone.
  if (typeof body === 'string' && body.includes('╭━━━〔')) return body;
  const safe = (body == null ? '' : String(body));
  return `${top}\n${safe}\n${bot}`;
}

// Wrap a command's ctx.reply() so every text response and every media
// caption gets the category banner. Stickers/reactions/edits are skipped
// because adding a caption to them is either invalid or just noise.
function makeBannerReply(sock, m, category) {
  return async (content) => {
    if (typeof content === 'string') {
      return reply(sock, m, bannerWrap(category, content));
    }
    if (content && typeof content === 'object') {
      // Pass-through cases that don't take a caption.
      if (content.sticker || content.react || content.edit || content.delete) {
        return reply(sock, m, content);
      }
      if (typeof content.text === 'string') {
        return reply(sock, m, { ...content, text: bannerWrap(category, content.text) });
      }
      if (typeof content.caption === 'string') {
        return reply(sock, m, { ...content, caption: bannerWrap(category, content.caption) });
      }
      // Media without an explicit caption — add one so it still gets a banner.
      if (content.image || content.video || content.document || content.audio) {
        // Audio is usually a voice note; only banner if not a voice note.
        if (content.audio && content.ptt) return reply(sock, m, content);
        return reply(sock, m, { ...content, caption: bannerWrap(category, '') });
      }
    }
    return reply(sock, m, content);
  };
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

  // .aion / .aionall auto-reply: DMs only.
  // Normally we skip ctx.fromMe to avoid loops, BUT in the user's own self-chat
  // (Message yourself) every message is fromMe — so we still allow it there.
  const aiActive = s.aiOn[jid] === true || (s.aiOnAll && s.aiOn[jid] !== false);
  const myJid = sock.user?.id ? sock.user.id.split(':')[0] + '@s.whatsapp.net' : null;
  const isSelfChat = myJid && jid === myJid;
  const allowFromMe = isSelfChat; // personal AI assistant mode
  if (!isGroup && (!ctx.fromMe || allowFromMe) && aiActive && ctx.text && !parsePrefix(ctx.text)) {
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
  patchSock(sock);
  const messages = ev.messages || [];
  for (const m of messages) {
    if (!m || !m.message) continue;
    // Skip our own echoed sends so we don't re-execute them as commands
    // (e.g. an image caption that happens to start with '#').
    if (m.key?.fromMe && m.key?.id && ownSentIds.has(m.key.id)) continue;
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

    // --- Game session check -----------------------------------------
    // Must run BEFORE the prefix check so that replies to trivia/math/
    // hangman/tictactoe (which have no prefix) are caught and processed.
    const parsed = parsePrefix(ctx.text);
    if (!parsed) {
      // Check active game sessions for this sender
      const gameReply = gameSessions.checkAnswer(ctx.sender || ctx.jid, ctx.text);
      if (gameReply) {
        try { await ctx.reply(gameReply); } catch (_) {}
      }
      continue;
    }

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
      const bannerReply = makeBannerReply(sock, m, resolved.category);
      await resolved.handler({
        ...ctx,
        reply: bannerReply,
        args,
        argText,
        prefix: parsed.prefix,
        command: cmdName,
        category: resolved.category,
      });
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

function reload() {
  // Clear cached plugin modules so file changes are picked up,
  // then rebuild the registry from scratch.
  const baseDir = config.paths.plugins;
  for (const k of Object.keys(require.cache)) {
    if (k.startsWith(baseDir)) delete require.cache[k];
  }
  commands.clear();
  aliases.clear();
  loadPlugins();
  return { count: commands.size };
}

loadPlugins();

module.exports = { onMessages, getCommands, getCategories, reload, setPaused, isPaused };

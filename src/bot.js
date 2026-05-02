'use strict';
const fs = require('fs');
const path = require('path');
const {
  default: makeWASocket,
  useMultiFileAuthState,
  fetchLatestBaileysVersion,
  DisconnectReason,
  Browsers,
  makeCacheableSignalKeyStore,
  downloadContentFromMessage,
  generateMessageID,
} = require('@whiskeysockets/baileys');
const pino = require('pino');
const config = require('./lib/config');
const logger = require('./lib/logger');
const helpers = require('./lib/helpers');
const handler = require('./handler');
const store = require('./lib/store');
const sessionBackup = require('./lib/sessionBackup');

let sock = null;
let connected = false;
let lastPairCode = null;
let loggedOut    = false;
let pendingPairNumber = null;
let avatarApplied = false;

// In-memory cache of recent messages so antidelete can recover them.
// Map<chatJid, Map<msgId, { message, sender, timestamp, pushName }>>
const messageCache = new Map();
const MAX_PER_CHAT = 200;

// Tracks revoke events we've already processed so a duplicate
// messages.upsert (Baileys retransmits) doesn't fire anti-delete twice.
const handledRevokes = new Set();
const HANDLED_REVOKES_MAX = 1000;

// WhatsApp wraps real message content inside several "envelope" types
// (editedMessage, viewOnceMessage, ephemeralMessage, etc.). The protocol
// message that signals a delete-for-everyone often arrives wrapped, so the
// previous code was missing it entirely. This helper strips envelopes until
// we reach the inner payload.
function unwrapMessage(msg) {
  if (!msg || typeof msg !== 'object') return msg;
  const inner =
    msg.ephemeralMessage?.message ||
    msg.viewOnceMessage?.message ||
    msg.viewOnceMessageV2?.message ||
    msg.viewOnceMessageV2Extension?.message ||
    msg.editedMessage?.message ||
    msg.documentWithCaptionMessage?.message ||
    msg.deviceSentMessage?.message ||
    null;
  return inner ? unwrapMessage(inner) : msg;
}

function extractProtocol(msg) {
  const u = unwrapMessage(msg);
  return u?.protocolMessage || null;
}

function rememberMessage(m) {
  try {
    if (!m?.key?.id || !m?.key?.remoteJid || !m.message) return;
    const inner = unwrapMessage(m.message);
    if (!inner || inner.protocolMessage) return; // ignore protocol envelopes
    const chat = m.key.remoteJid;
    let chatMap = messageCache.get(chat);
    if (!chatMap) { chatMap = new Map(); messageCache.set(chat, chatMap); }
    if (chatMap.size >= MAX_PER_CHAT) {
      const firstKey = chatMap.keys().next().value;
      chatMap.delete(firstKey);
    }
    chatMap.set(m.key.id, {
      message: inner,
      sender: m.key.participant || m.key.remoteJid,
      timestamp: m.messageTimestamp,
      pushName: m.pushName || '',
    });
  } catch (_) {}
}

// IMPORTANT: do NOT delete from cache on recall. Baileys can deliver the
// same revoke twice; we de-dupe via handledRevokes instead, and let the
// per-chat LRU evict old messages naturally. Previous code dropped the
// entry on first read, which broke duplicate revokes and made retries
// silently lose the original payload.
function recallMessage(chatJid, msgId) {
  const chatMap = messageCache.get(chatJid);
  if (!chatMap) return null;
  return chatMap.get(msgId) || null;
}

// Turn raw JIDs (123@s.whatsapp.net, 182145754603609@lid, 12345-6789@g.us)
// into something a human reading the antidelete card can actually parse.
async function prettyChat(jid, fallbackName) {
  if (!jid || typeof jid !== 'string') return 'unknown';
  if (jid.endsWith('@g.us')) {
    try {
      const meta = await sock.groupMetadata(jid);
      if (meta?.subject) return meta.subject;
    } catch (_) {}
    return 'Group chat';
  }
  if (jid.endsWith('@s.whatsapp.net')) {
    const num = jid.split('@')[0];
    return num ? '+' + num : 'Private chat';
  }
  if (jid.endsWith('@lid')) {
    return fallbackName ? `Chat with ${fallbackName}` : 'Private chat';
  }
  return jid;
}

function hasSession() {
  try {
    return fs.existsSync(path.join(config.paths.auth, 'creds.json'));
  } catch {
    return false;
  }
}

async function applyAvatar() {
  if (avatarApplied || !sock || !connected) return;
  try {
    if (fs.existsSync(config.paths.avatar)) {
      const me = sock.user?.id;
      if (me) {
        await sock.updateProfilePicture(me, { url: config.paths.avatar });
        await sock.updateProfileName(config.botName);
        avatarApplied = true;
        logger.info('Bot avatar and name applied.');
      }
    }
  } catch (e) {
    logger.warn({ err: e?.message }, 'failed to apply avatar');
  }
}

// Re-upload media from a cached deleted message so the owner actually sees
// the picture / sticker / voice note instead of a "[non-text]" placeholder.
async function streamToBuffer(stream) {
  const chunks = [];
  for await (const c of stream) chunks.push(c);
  return Buffer.concat(chunks);
}

async function rebuildMediaMessage(message) {
  if (!message) return null;
  const inner =
    message.imageMessage      ? { kind: 'image',    node: message.imageMessage,    mediaType: 'image',    sendKey: 'image' } :
    message.videoMessage      ? { kind: 'video',    node: message.videoMessage,    mediaType: 'video',    sendKey: 'video' } :
    message.audioMessage      ? { kind: 'audio',    node: message.audioMessage,    mediaType: 'audio',    sendKey: 'audio' } :
    message.stickerMessage    ? { kind: 'sticker',  node: message.stickerMessage,  mediaType: 'sticker',  sendKey: 'sticker' } :
    message.documentMessage   ? { kind: 'document', node: message.documentMessage, mediaType: 'document', sendKey: 'document' } :
    null;
  if (!inner) return null;
  try {
    const stream = await downloadContentFromMessage(inner.node, inner.mediaType);
    const buf = await streamToBuffer(stream);
    if (!buf?.length) return null;
    const out = { [inner.sendKey]: buf };
    if (inner.node.caption)  out.caption  = inner.node.caption;
    if (inner.node.mimetype) out.mimetype = inner.node.mimetype;
    if (inner.kind === 'audio')  out.ptt = !!inner.node.ptt;
    if (inner.kind === 'document') out.fileName = inner.node.fileName || 'file';
    return out;
  } catch (e) {
    logger.warn({ err: e?.message }, 'rebuildMediaMessage failed');
    return null;
  }
}

async function start() {
  fs.mkdirSync(config.paths.auth, { recursive: true });
  helpers.ensureTmp();

  const { state, saveCreds } = await useMultiFileAuthState(config.paths.auth);
  const { version } = await fetchLatestBaileysVersion().catch(() => ({ version: [2, 3000, 1015901307] }));

  sock = makeWASocket({
    version,
    logger: pino({ level: 'silent' }),
    printQRInTerminal: false,
    browser: Browsers.macOS('Safari'),
    auth: {
      creds: state.creds,
      keys: makeCacheableSignalKeyStore(state.keys, pino({ level: 'silent' })),
    },
    syncFullHistory: false,
    markOnlineOnConnect: false,
    generateHighQualityLinkPreview: true,
  });

  // If we asked for a pairing code from the web, request one now.
  if (pendingPairNumber && !sock.authState.creds.registered) {
    try {
      await helpers.sleep(1500);
      const code = await sock.requestPairingCode(pendingPairNumber);
      lastPairCode = code?.replace?.(/(.{4})/g, '$1-').replace(/-$/, '') || code;
      logger.info('Pairing code generated (visible only on web UI).');
    } catch (e) {
      logger.error({ err: e?.message }, 'requestPairingCode failed');
    } finally {
      pendingPairNumber = null;
    }
  }

  // Save creds locally AND schedule an encrypted push to GitHub. The push
  // is debounced (~30s) and skipped when the encrypted blob is unchanged,
  // so a quiet session doesn't generate noise commits.
  sock.ev.on('creds.update', async (...args) => {
    try { await saveCreds(...args); } catch (e) { logger.warn({ err: e?.message }, 'saveCreds failed'); }
    try { sessionBackup.schedule(); } catch (_) {}
  });

  sock.ev.on('connection.update', async (u) => {
    const { connection, lastDisconnect } = u;
    if (connection === 'open') {
      connected = true;
      lastPairCode = null;
      logger.info(`Connected as ${sock.user?.id}`);
      try {
        const _klaTime = new Date().toLocaleTimeString('en-GB', {
          timeZone: 'Africa/Kampala', hour: '2-digit', minute: '2-digit', hour12: false,
        });
        await sock.sendMessage(sock.user.id, {
          text: [
            '🤖 *Bot Connected Successfully!*',
            '',
            '⏰ Time: *' + _klaTime + '* (Kampala)',
            '✅ Status: *Online and Ready!*',
            '',
            '▸ Prefixes: *' + config.prefixes.join('  ') + '*',
            '▸ Type *.menu* to see all commands',
          ].join('\n'),
        });
      } catch (_) {}
      applyAvatar();
    }
    if (connection === 'close') {
      connected = false;
      const code = lastDisconnect?.error?.output?.statusCode;
      const shouldReconnect = code !== DisconnectReason.loggedOut;
      logger.warn(`Disconnected (code=${code}). reconnect=${shouldReconnect}`);
      if (shouldReconnect) {
        setTimeout(start, 3000);
      } else {
        // 401 = WhatsApp logged out this session. Clear the stale creds so the
        // pairing page can immediately generate a fresh code without a restart.
        sock = null;
        lastPairCode = null;
        avatarApplied = false;
        loggedOut = true;
        try { fs.rmSync(config.paths.auth, { recursive: true, force: true }); } catch (_) {}
        fs.mkdirSync(config.paths.auth, { recursive: true });
        sessionBackup.clearRemote().catch(() => {});
        logger.info('Session cleared after logout — open the pairing page to link again.');
      }
    }
  });

  sock.ev.on('call', async (calls) => {
    if (!store.get().anticall) return;
    for (const c of calls) {
      try {
        if (c.status === 'offer') {
          await sock.rejectCall(c.id, c.from);
          await sock.sendMessage(c.from, { text: 'Calls are not allowed. Your call was rejected automatically.' });
        }
      } catch (_) {}
    }
  });

  // Anti-delete: WhatsApp's "delete for everyone" is delivered as a
  // protocolMessage of type REVOKE (0) inside messages.upsert — NOT
  // through messages.update. So we detect it here, where it actually fires.
  async function handleRevoke(revokeMsg, proto) {
    if (!store.get().antidelete) return;
    const chat = proto.key?.remoteJid || revokeMsg.key?.remoteJid;
    const msgId = proto.key?.id;
    if (!chat || !msgId) return;

    // De-dupe: never process the same revoke twice.
    const dedupeKey = `${chat}:${msgId}`;
    if (handledRevokes.has(dedupeKey)) return;
    handledRevokes.add(dedupeKey);
    if (handledRevokes.size > HANDLED_REVOKES_MAX) {
      const first = handledRevokes.values().next().value;
      handledRevokes.delete(first);
    }

    const cached = recallMessage(chat, msgId);
    if (!cached) {
      logger.info({ chat, msgId }, 'antidelete: cache MISS (original not seen)');
      return; // we never saw the original (e.g. bot was offline)
    }
    logger.info({ chat, msgId }, 'antidelete: cache HIT, restoring');

    const ownerJid = sock.user?.id ? sock.user.id.split(':')[0] + '@s.whatsapp.net' : null;
    if (!ownerJid) return;

    // Avoid a visible loop: if the deletion happened in the OWNER'S OWN
    // self-chat ("Message yourself"), don't re-send the deleted message
    // back into that same chat. Antidelete still fires for the owner's
    // own deletes in groups and other DMs — many users want a record of
    // what they themselves deleted.
    const deleterJid = revokeMsg.key?.participant || revokeMsg.key?.remoteJid;
    const ownerNumber = ownerJid.split('@')[0];
    if (chat && chat.split('@')[0] === ownerNumber && !chat.endsWith('@g.us')) return;

    const senderName = cached.pushName || cached.sender?.split('@')[0] || 'unknown';
    const when = new Date((Number(cached.timestamp) || Date.now() / 1000) * 1000).toLocaleString();
    const senderShort = (cached.sender || '').split('@')[0];
    const chatLabel = await prettyChat(chat, cached.pushName);
    const header =
      `*Sender:* @${senderShort} (${senderName})\n` +
      `*Chat:* ${chatLabel}\n` +
      `*Sent:* ${when}\n` +
      `*Deleted message:*`;
    const mentions = [cached.sender].filter(Boolean);

    await sock.sendMessage(ownerJid, { text: header, mentions }).catch(() => {});

    // 1) Re-upload any media so the owner actually sees the image / sticker /
    //    voice note instead of a placeholder. This was the main bug — the old
    //    code called sock.relayMessage without a messageId, which always
    //    threw, and the catch fell through to a text-only stub.
    const media = await rebuildMediaMessage(cached.message);
    if (media) {
      await sock.sendMessage(ownerJid, media).catch((e) => {
        logger.warn({ err: e?.message }, 'antidelete media re-send failed');
      });
      return;
    }

    // 2) Plain text fallback (covers conversation / extendedTextMessage).
    const txt =
      cached.message.conversation ||
      cached.message.extendedTextMessage?.text ||
      cached.message.imageMessage?.caption ||
      cached.message.videoMessage?.caption ||
      '';
    if (txt) {
      await sock.sendMessage(ownerJid, { text: '```' + txt + '```' }).catch(() => {});
      return;
    }

    // 3) Last-resort relay attempt with a freshly generated message id.
    try {
      await sock.relayMessage(ownerJid, cached.message, { messageId: generateMessageID() });
    } catch (e) {
      await sock.sendMessage(ownerJid, { text: '_[deleted message could not be re-sent]_' }).catch(() => {});
    }
  }

  sock.ev.on('messages.upsert', async (ev) => {
    try {
      for (const m of ev.messages || []) {
        rememberMessage(m);
        const proto = extractProtocol(m.message);
        if (proto && (proto.type === 0 || proto.type === 'REVOKE')) {
          logger.info({
            chat: m.key?.remoteJid,
            origId: proto.key?.id,
            via: 'upsert',
          }, 'antidelete: revoke received');
          await handleRevoke(m, proto);
        }
        try { await enforceGroupRules(m); } catch (e) {
          logger.warn({ err: e?.message }, 'enforceGroupRules failed');
        }
      }
    } catch (e) {
      logger.warn({ err: e?.message }, 'messages.upsert pre-handler failed');
    }
    handler.onMessages(sock, ev);
  });

  // Backup revoke path: some WhatsApp builds (especially when the deletion
  // arrives a long time after the original) deliver the revoke as a
  // messages.update with the message body wiped. Synthesize a revoke envelope
  // from those updates so antidelete still fires.
  sock.ev.on('messages.update', async (updates) => {
    try {
      for (const u of updates || []) {
        if (!u?.key?.id || !u?.key?.remoteJid) continue;
        const wasRevoked =
          u.update?.message === null ||
          u.update?.messageStubType === 1 || // REVOKE
          (typeof u.update?.messageStubType === 'string' &&
           /revoke/i.test(u.update.messageStubType));
        if (!wasRevoked) continue;
        logger.info({
          chat: u.key.remoteJid,
          origId: u.key.id,
          via: 'update',
        }, 'antidelete: revoke received');
        const synthetic = {
          key: { remoteJid: u.key.remoteJid, fromMe: false, id: 'synthetic_' + u.key.id },
          messageTimestamp: Math.floor(Date.now() / 1000),
        };
        const synthProto = { type: 0, key: u.key };
        await handleRevoke(synthetic, synthProto).catch((e) => {
          logger.warn({ err: e?.message }, 'antidelete (update path) failed');
        });
      }
    } catch (e) {
      logger.warn({ err: e?.message }, 'messages.update handler failed');
    }
  });

  // Welcome / goodbye + group security monitor on group-participants.update
  sock.ev.on('group-participants.update', async (ev) => {
    try {
      const s = store.get();
      const jid = ev.id;
      if (!jid?.endsWith('@g.us')) return;
      const meta = await sock.groupMetadata(jid).catch(() => null);
      const groupName = meta?.subject || jid;
      const memberCount = meta?.participants?.length || 0;
      const myJid = sock.user?.id ? sock.user.id.replace(/:\d+/, '') : null;
      const ownerJid = myJid; // bot number IS owner in this setup

      // ── Group Security Monitor ─────────────────────────────────────────────
      // Alerts the owner's DM whenever admin privileges change in any group
      // where .groupsecurity is enabled.
      if (s.groupSecurity?.[jid]) {
        const action = ev.action;
        const author = ev.author || null; // who made the change (WhatsApp provides this)
        const authorTag = author ? `+${author.split('@')[0]}` : 'unknown';

        if (action === 'promote') {
          // Someone was promoted to admin
          for (const p of ev.participants || []) {
            const pTag = `+${p.split('@')[0]}`;
            const isSelf = myJid && p.replace(/:\d+/, '') === myJid;
            const alert =
              `🚨 *ADMIN PROMOTED* in *${groupName}*
` +
              `👤 Promoted: ${isSelf ? '🤖 Bot itself' : pTag}
` +
              `✍️ By: ${authorTag}
` +
              `🕐 ${new Date().toLocaleString('en-GB', { timeZone: 'Africa/Kampala' })}
` +
              `🔗 Group: ${jid}`;
            if (ownerJid) await sock.sendMessage(ownerJid + '@s.whatsapp.net', { text: alert }).catch(() => {});
          }
        } else if (action === 'demote') {
          // Someone was demoted from admin — especially dangerous if it's the bot
          for (const p of ev.participants || []) {
            const pTag = `+${p.split('@')[0]}`;
            const isSelf = myJid && p.replace(/:\d+/, '') === myJid;
            const alert =
              `⚠️ *ADMIN REMOVED* in *${groupName}*
` +
              (isSelf ? `🤖 *The bot was demoted from admin!*
` : `👤 Demoted: ${pTag}
`) +
              `✍️ By: ${authorTag}
` +
              `🕐 ${new Date().toLocaleString('en-GB', { timeZone: 'Africa/Kampala' })}
` +
              `🔗 Group: ${jid}`;
            if (ownerJid) await sock.sendMessage(ownerJid + '@s.whatsapp.net', { text: alert }).catch(() => {});
          }
        } else if (action === 'add') {
          // Someone was added — alert if not done by a known admin
          const knownAdmins = (meta?.participants || [])
            .filter(p => p.admin)
            .map(p => p.id.replace(/:\d+/, ''));
          const authorBase = author ? author.replace(/:\d+/, '') : null;
          const addedByAdmin = !authorBase || knownAdmins.includes(authorBase);
          if (!addedByAdmin) {
            for (const p of ev.participants || []) {
              const alert =
                `🚨 *UNKNOWN ADD* in *${groupName}*
` +
                `👤 Added: +${p.split('@')[0]}
` +
                `✍️ By: ${authorTag} (not a known admin)
` +
                `🕐 ${new Date().toLocaleString('en-GB', { timeZone: 'Africa/Kampala' })}`;
              if (ownerJid) await sock.sendMessage(ownerJid + '@s.whatsapp.net', { text: alert }).catch(() => {});
            }
          }
        }
      }

      // ── Welcome / Goodbye messages ─────────────────────────────────────────
      const isAdd = ev.action === 'add';
      const isRemove = ev.action === 'remove' || ev.action === 'leave';
      const cfg = isAdd ? s.welcome[jid] : isRemove ? s.goodbye[jid] : null;
      if (!cfg?.enabled) return;

      const defaultText = isAdd
        ? '👋 Welcome @{user} to *{group}*! You are member #{count}.'
        : '👋 Goodbye @{user} — see you again sometime.';
      const tpl = cfg.text || defaultText;

      for (const participant of ev.participants || []) {
        const userTag = `@${participant.split('@')[0]}`;
        const text = tpl
          .replaceAll('{user}', userTag)
          .replaceAll('{group}', groupName)
          .replaceAll('{count}', String(memberCount));
        await sock.sendMessage(jid, { text, mentions: [participant] }).catch(() => {});
      }
    } catch (e) {
      logger.warn({ err: e?.message }, 'group-participants handler failed');
    }
  });

  return sock;
}

// Per-chat sliding window for spam detection.
const spamWindows = new Map(); // `${jid}:${sender}` -> [timestamps]

async function enforceGroupRules(m) {
  if (!m?.key?.remoteJid?.endsWith('@g.us')) return;
  if (m.key.fromMe) return;
  const s = store.get();
  const jid = m.key.remoteJid;
  const sender = m.key.participant || m.participant;
  if (!sender) return;
  const me = sock?.user?.id?.split(':')[0];
  if (me && sender.split('@')[0] === me) return;

  const text =
    m.message?.conversation ||
    m.message?.extendedTextMessage?.text ||
    m.message?.imageMessage?.caption ||
    m.message?.videoMessage?.caption ||
    '';

  if (helpers.isOwner(sender)) return;

  let meta = null;
  let botIsAdmin = false;
  let senderIsAdmin = false;
  const needsAdmin = s.antilink[jid] || s.antibadword[jid] || s.antispam[jid] || s.antitag[jid];
  if (needsAdmin) {
    meta = await sock.groupMetadata(jid).catch(() => null);
    if (meta) {
      const myFullJid = sock.user?.id?.split(':')[0] + '@s.whatsapp.net';
      botIsAdmin = meta.participants.some(p => p.id === myFullJid && (p.admin === 'admin' || p.admin === 'superadmin'));
      senderIsAdmin = meta.participants.some(p => p.id === sender && (p.admin === 'admin' || p.admin === 'superadmin'));
    }
  }
  if (senderIsAdmin) return;

  async function deleteOffending(reason) {
    if (!botIsAdmin) return;
    try { await sock.sendMessage(jid, { delete: m.key }); } catch (_) {}
    await sock.sendMessage(jid, { text: `🛡️ ${reason} — message removed (@${sender.split('@')[0]})`, mentions: [sender] }).catch(() => {});
  }

  if (s.antilink[jid] && /(https?:\/\/|chat\.whatsapp\.com\/|wa\.me\/)/i.test(text)) {
    return deleteOffending('Anti-link active');
  }
  if (s.antibadword[jid] && (s.badwords || []).length) {
    const lc = text.toLowerCase();
    if (s.badwords.some(w => w && lc.includes(w))) {
      return deleteOffending('Bad-word filter');
    }
  }
  if (s.antitag[jid]) {
    const mentioned = m.message?.extendedTextMessage?.contextInfo?.mentionedJid || [];
    if (mentioned.length >= 5) {
      return deleteOffending('Mass-tag blocked');
    }
  }
  if (s.antispam[jid]) {
    const key = `${jid}:${sender}`;
    const now = Date.now();
    const arr = (spamWindows.get(key) || []).filter(t => now - t < 8000);
    arr.push(now);
    spamWindows.set(key, arr);
    if (arr.length > 5) {
      spamWindows.set(key, []);
      return deleteOffending('Anti-spam (slow down)');
    }
  }
}

async function requestPairing(number) {
  if (hasSession() && connected) {
    throw new Error('Bot is already paired and connected. Use "Logout" first if you want a fresh code.');
  }
  lastPairCode = null;
  loggedOut = false;
  pendingPairNumber = number;

  if (!sock) {
    // No socket — start fresh
    await start();
  } else if (!connected && sock.authState?.creds?.registered) {
    // Dead socket with stale registered creds (e.g. after 401 logout before
    // the disconnect handler could clear them). Clear and restart.
    sock = null;
    try { fs.rmSync(config.paths.auth, { recursive: true, force: true }); } catch (_) {}
    fs.mkdirSync(config.paths.auth, { recursive: true });
    await start();
  } else if (!sock.authState.creds.registered) {
    try {
      const code = await sock.requestPairingCode(number);
      lastPairCode = code?.replace?.(/(.{4})/g, '$1-').replace(/-$/, '') || code;
    } catch (e) {
      throw new Error(e?.message || 'requestPairingCode failed');
    }
  }
  // Wait up to 10s for code generation triggered by start()
  for (let i = 0; i < 20 && !lastPairCode; i++) await helpers.sleep(500);
  if (!lastPairCode) throw new Error('Could not generate a pairing code. Try again.');
  return lastPairCode;
}

async function logout() {
  try {
    if (sock) await sock.logout().catch(() => {});
  } catch (_) {}
  try {
    fs.rmSync(config.paths.auth, { recursive: true, force: true });
  } catch (_) {}
  fs.mkdirSync(config.paths.auth, { recursive: true });
  connected = false;
  avatarApplied = false;
  loggedOut = true;
  sock = null;
  lastPairCode = null;
  sessionBackup.clearRemote().catch(() => {});
  setTimeout(() => start().catch(() => {}), 1000);
}

module.exports = {
  start,
  requestPairing,
  logout,
  hasSession,
  isConnected: () => connected,
  isLoggedOut: () => loggedOut,
  getSocket: () => sock,
};

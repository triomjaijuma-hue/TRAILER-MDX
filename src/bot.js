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
} = require('@whiskeysockets/baileys');
const pino = require('pino');
const config = require('./lib/config');
const logger = require('./lib/logger');
const helpers = require('./lib/helpers');
const handler = require('./handler');
const store = require('./lib/store');

let sock = null;
let connected = false;
let lastPairCode = null;
let pendingPairNumber = null;
let avatarApplied = false;

// In-memory cache of recent messages so antidelete can recover them.
// Map<chatJid, Map<msgId, { message, sender, timestamp, pushName }>>
const messageCache = new Map();
const MAX_PER_CHAT = 200;

function rememberMessage(m) {
  try {
    if (!m?.key?.id || !m?.key?.remoteJid || !m.message) return;
    if (m.message.protocolMessage) return; // ignore protocol messages
    const chat = m.key.remoteJid;
    let chatMap = messageCache.get(chat);
    if (!chatMap) { chatMap = new Map(); messageCache.set(chat, chatMap); }
    if (chatMap.size >= MAX_PER_CHAT) {
      const firstKey = chatMap.keys().next().value;
      chatMap.delete(firstKey);
    }
    chatMap.set(m.key.id, {
      message: m.message,
      sender: m.key.participant || m.key.remoteJid,
      timestamp: m.messageTimestamp,
      pushName: m.pushName || '',
    });
  } catch (_) {}
}

function recallMessage(chatJid, msgId) {
  const chatMap = messageCache.get(chatJid);
  if (!chatMap) return null;
  const cached = chatMap.get(msgId);
  if (cached) chatMap.delete(msgId);
  return cached;
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

  sock.ev.on('creds.update', saveCreds);

  sock.ev.on('connection.update', async (u) => {
    const { connection, lastDisconnect } = u;
    if (connection === 'open') {
      connected = true;
      lastPairCode = null;
      logger.info(`Connected as ${sock.user?.id}`);
      try {
        await sock.sendMessage(sock.user.id, {
          text: `*${config.botName} v${config.version}* is online.\nPrefixes: ${config.prefixes.join(' ')}\nType *.menu* to begin.`,
        });
      } catch (_) {}
      applyAvatar();
    }
    if (connection === 'close') {
      connected = false;
      const code = lastDisconnect?.error?.output?.statusCode;
      const shouldReconnect = code !== DisconnectReason.loggedOut;
      logger.warn(`Disconnected (code=${code}). reconnect=${shouldReconnect}`);
      if (shouldReconnect) setTimeout(start, 3000);
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

    const cached = recallMessage(chat, msgId);
    if (!cached) return; // we never saw the original (e.g. bot was offline)

    const ownerJid = sock.user?.id?.split(':')[0] + '@s.whatsapp.net';
    if (!ownerJid) return;

    // Don't re-forward messages the bot itself sent or that the owner deleted.
    const deleterJid = revokeMsg.key?.participant || revokeMsg.key?.remoteJid;
    if (deleterJid && deleterJid.split('@')[0] === ownerJid.split('@')[0]) return;

    const senderName = cached.pushName || cached.sender?.split('@')[0] || 'unknown';
    const when = new Date((Number(cached.timestamp) || Date.now() / 1000) * 1000).toLocaleString();
    const senderShort = (cached.sender || '').split('@')[0];
    const deleterShort = (deleterJid || '').split('@')[0];
    const header =
      `🛡️ *ANTI-DELETE*\n\n` +
      `*Sender:* @${senderShort} (${senderName})\n` +
      (deleterShort && deleterShort !== senderShort ? `*Deleted by:* @${deleterShort}\n` : '') +
      `*Chat:* ${chat}\n*Sent:* ${when}\n\n_Original message:_`;
    const mentions = [cached.sender, deleterJid].filter(Boolean);

    await sock.sendMessage(ownerJid, { text: header, mentions }).catch(() => {});
    // Re-deliver the original message content to the owner
    await sock.relayMessage(ownerJid, cached.message, {}).catch(async () => {
      const txt =
        cached.message.conversation ||
        cached.message.extendedTextMessage?.text ||
        cached.message.imageMessage?.caption ||
        cached.message.videoMessage?.caption ||
        '[non-text content could not be re-sent]';
      await sock.sendMessage(ownerJid, { text: '```' + txt + '```' }).catch(() => {});
    });
  }

  sock.ev.on('messages.upsert', async (ev) => {
    try {
      for (const m of ev.messages || []) {
        rememberMessage(m);
        const proto = m.message?.protocolMessage;
        if (proto && (proto.type === 0 || proto.type === 'REVOKE')) {
          await handleRevoke(m, proto);
        }
      }
    } catch (e) {
      logger.warn({ err: e?.message }, 'messages.upsert pre-handler failed');
    }
    handler.onMessages(sock, ev);
  });

  return sock;
}

async function requestPairing(number) {
  if (hasSession() && connected) {
    throw new Error('Bot is already paired and connected. Use "Logout" first if you want a fresh code.');
  }
  pendingPairNumber = number;
  if (!sock) {
    await start();
  } else if (!sock.authState.creds.registered) {
    try {
      const code = await sock.requestPairingCode(number);
      lastPairCode = code?.replace?.(/(.{4})/g, '$1-').replace(/-$/, '') || code;
    } catch (e) {
      throw new Error(e?.message || 'requestPairingCode failed');
    }
  }
  // Wait briefly for code generation triggered by start()
  for (let i = 0; i < 15 && !lastPairCode; i++) await helpers.sleep(500);
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
  sock = null;
  lastPairCode = null;
  setTimeout(() => start().catch(() => {}), 1000);
}

module.exports = {
  start,
  requestPairing,
  logout,
  hasSession,
  isConnected: () => connected,
  getSocket: () => sock,
};

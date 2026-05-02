'use strict';
const { downloadContentFromMessage } = require('@whiskeysockets/baileys');

// ─── helpers ────────────────────────────────────────────────────────────────

// Walk the standard Baileys envelope wrappers to find the real message content.
function unwrap(msg) {
  if (!msg || typeof msg !== 'object') return msg;
  const inner =
    msg.viewOnceMessage?.message ||
    msg.viewOnceMessageV2?.message ||
    msg.viewOnceMessageV2Extension?.message ||
    msg.ephemeralMessage?.message ||
    msg.editedMessage?.message ||
    msg.documentWithCaptionMessage?.message ||
    null;
  return inner ? unwrap(inner) : msg;
}

// Stream a Baileys media message into a Buffer.
async function toBuffer(mediaMsg, type) {
  const stream = await downloadContentFromMessage(mediaMsg, type);
  const chunks = [];
  for await (const chunk of stream) chunks.push(chunk);
  return Buffer.concat(chunks);
}

// Format a raw JID into something human-readable.
function prettyJid(jid) {
  if (!jid) return null;
  if (jid.endsWith('@g.us'))               return '👥 a group chat';
  if (jid.endsWith('@s.whatsapp.net'))      return `+${jid.split('@')[0]}`;
  if (jid.endsWith('@broadcast'))           return 'broadcast list';
  return jid;
}

// ─── .vv — reveal a view-once message ───────────────────────────────────────
const vvCommand = {
  name: 'vv',
  aliases: ['viewonce', 'vo', 'reveal'],
  description: 'Reveal a view-once photo / video / audio — reply to the view-once message',
  handler: async ({ sock, m, jid, reply }) => {
    // The user replies to a view-once message; the quoted content lives in
    // the contextInfo of their .vv text message.
    const ctxInfo = m.message?.extendedTextMessage?.contextInfo;
    if (!ctxInfo?.quotedMessage) {
      return reply(
        '📌 *How to use .vv*\n\n' +
        'Reply directly to a view-once photo, video, or voice message and send *.vv*\n\n' +
        '_The bot will download and re-send it as a normal media message._'
      );
    }

    // Unwrap the quoted message to find the raw media message object.
    const quoted = unwrap(ctxInfo.quotedMessage);

    // Detect media type
    const image = quoted.imageMessage;
    const video = quoted.videoMessage;
    const audio = quoted.audioMessage;

    const media = image || video || audio;
    const type  = image ? 'image' : video ? 'video' : audio ? 'audio' : null;

    if (!media || !type) {
      return reply('❌ The replied message does not contain view-once media (photo, video, or voice note).');
    }

    // Check it is actually view-once (viewOnceMessage wrapping is the canonical
    // way, but WhatsApp sometimes sends viewOnce=true inside the media msg itself).
    const isVO =
      ctxInfo.quotedMessage.viewOnceMessage ||
      ctxInfo.quotedMessage.viewOnceMessageV2 ||
      ctxInfo.quotedMessage.viewOnceMessageV2Extension ||
      media.viewOnce;

    if (!isVO) {
      return reply('ℹ️ That message does not appear to be a view-once — it is already a normal media message.');
    }

    await reply('👁 Revealing view-once media…');

    try {
      const buf  = await toBuffer(media, type);
      const mime = media.mimetype || (
        type === 'image' ? 'image/jpeg' :
        type === 'video' ? 'video/mp4'  : 'audio/mp4'
      );

      const caption = '👁 *View-once revealed*';

      if (type === 'image') {
        await sock.sendMessage(jid, { image: buf, mimetype: mime, caption }, { quoted: m });
      } else if (type === 'video') {
        await sock.sendMessage(jid, { video: buf, mimetype: mime, caption }, { quoted: m });
      } else {
        // audio — preserve ptt (voice note) flag
        await sock.sendMessage(jid, { audio: buf, mimetype: mime, ptt: !!media.ptt }, { quoted: m });
      }
    } catch (e) {
      reply(`❌ Failed to download the media: ${e?.message || 'unknown error'}\n\n_This can happen if the view-once has already expired or the sender deleted it._`);
    }
  },
};

// ─── .trace — trace the origin of a forwarded message ───────────────────────
const traceCommand = {
  name: 'trace',
  aliases: ['fwdtrace', 'tracefw', 'whofwd'],
  description: 'Trace the origin of a forwarded message — reply to the forwarded message',
  handler: async ({ m, jid, reply }) => {
    // The outer contextInfo belongs to the user's .trace text message.
    // It points at the message they replied to (the forwarded one).
    const outerCtx = m.message?.extendedTextMessage?.contextInfo;
    if (!outerCtx?.quotedMessage) {
      return reply(
        '📌 *How to use .trace*\n\n' +
        'Reply directly to a forwarded photo, video, or audio message and send *.trace*\n\n' +
        '_The bot will show every piece of origin metadata that WhatsApp preserved._'
      );
    }

    // Drill into the quoted message to find the inner media / text and its
    // own contextInfo (which carries forwardingScore etc.).
    const quotedRaw  = outerCtx.quotedMessage;
    const quotedInner = unwrap(quotedRaw);

    // Find the first recognized message type key.
    const msgType = Object.keys(quotedInner).find(k =>
      k.endsWith('Message') && k !== 'contextInfo'
    );
    const innerMsg  = msgType ? quotedInner[msgType] : null;
    const innerCtx  = innerMsg?.contextInfo || {};

    // Accept plain text too (forwarded text messages also carry forwardingScore)
    const forwardScore = innerCtx.forwardingScore ?? 0;
    const isForwarded  = innerCtx.isForwarded || forwardScore > 0;

    if (!isForwarded) {
      return reply(
        '❌ That message has *not been forwarded* — forwarding score is 0.\n\n' +
        '_Only forwarded messages carry origin metadata._'
      );
    }

    // ── Build the trace report ───────────────────────────────────────────────
    const lines = [
      '🔍 *Forward Trace Report*',
      '━━━━━━━━━━━━━━━━━━━━━━━━',
    ];

    // How many times it has been forwarded
    const scoreLabel = forwardScore >= 127
      ? '127+ _(highly forwarded — WhatsApp caps the counter at 127)_'
      : `*${forwardScore}* time${forwardScore === 1 ? '' : 's'}`;
    lines.push(`📊 Forwarded: ${scoreLabel}`);

    // Message type
    if (msgType) {
      const friendlyType = msgType
        .replace('Message', '')
        .replace(/([A-Z])/g, ' $1')
        .trim();
      lines.push(`📎 Content type: *${friendlyType}*`);
    }

    // Who sent this message into the CURRENT chat (the forwarder to us).
    // In a group this is ctx.participant; in a DM it is ctx.remoteJid.
    const forwarderJid  = outerCtx.participant || outerCtx.remoteJid;
    const forwarderPretty = forwarderJid && forwarderJid !== jid
      ? prettyJid(forwarderJid)
      : null;
    if (forwarderPretty) {
      lines.push(`📤 Forwarded into this chat by: *${forwarderPretty}*`);
    }

    lines.push('');
    lines.push('🔎 *Preserved origin metadata:*');
    let hasOrigin = false;

    // Original remote JID (chat where it came from, if WhatsApp kept it)
    if (innerCtx.remoteJid && innerCtx.remoteJid !== jid) {
      const p = prettyJid(innerCtx.remoteJid);
      if (p) { lines.push(`🏠 Possibly originated from: *${p}*`); hasOrigin = true; }
    }

    // Original group participant (sender inside a group, if available)
    if (innerCtx.participant) {
      const p = prettyJid(innerCtx.participant);
      if (p) { lines.push(`👤 Original sender (in group): *${p}*`); hasOrigin = true; }
    }

    // External ad / link preview attached to the original message
    const ad = innerCtx.externalAdReply;
    if (ad) {
      if (ad.title)     { lines.push(`📌 Linked title: *${ad.title}*`);  hasOrigin = true; }
      if (ad.body)      { lines.push(`📝 Description: ${ad.body}`);       hasOrigin = true; }
      if (ad.sourceUrl) { lines.push(`🔗 Source URL: ${ad.sourceUrl}`);   hasOrigin = true; }
    }

    // Mention JIDs in the original text
    if (Array.isArray(innerCtx.mentionedJid) && innerCtx.mentionedJid.length) {
      const mentions = innerCtx.mentionedJid.map(j => prettyJid(j)).filter(Boolean);
      if (mentions.length) {
        lines.push(`📣 Mentioned users: ${mentions.join(', ')}`);
        hasOrigin = true;
      }
    }

    if (!hasOrigin) {
      lines.push('_No origin data preserved — WhatsApp stripped sender identity from this forward._');
    }

    lines.push('');
    lines.push(
      '⚠️ _WhatsApp intentionally removes sender identity from forwarded messages ' +
      'for privacy. The trace above shows the maximum available information._'
    );

    reply(lines.join('\n'));
  },
};

module.exports = [vvCommand, traceCommand];

'use strict';
const { Sticker, StickerTypes } = require('wa-sticker-formatter');
const { downloadMediaMessage } = require('@whiskeysockets/baileys');
const sharp = require('sharp');
const helpers = require('../../lib/helpers');
const config = require('../../lib/config');

async function getMediaBuffer(m) {
  const ctx = m.message?.extendedTextMessage?.contextInfo;
  const inner = ctx?.quotedMessage;
  let target = m;
  if (inner) target = { message: inner };
  return downloadMediaMessage(target, 'buffer', {});
}

async function makeSticker(buf, opts = {}) {
  const s = new Sticker(buf, {
    pack: opts.pack || config.botName,
    author: opts.author || 'TRAILER-MDX',
    type: opts.type || StickerTypes.FULL,
    quality: 70,
  });
  return s.toBuffer();
}

module.exports = [
  {
    name: 'sticker', aliases: ['s'],
    description: 'Convert media to sticker (reply to image/video)',
    handler: async ({ sock, jid, m, reply }) => {
      try {
        const buf = await getMediaBuffer(m);
        const sb = await makeSticker(buf);
        await sock.sendMessage(jid, { sticker: sb }, { quoted: m });
      } catch (e) { reply(`Sticker error: ${e?.message}`); }
    },
  },
  {
    name: 'sticker2', description: 'Cropped sticker',
    handler: async ({ sock, jid, m, reply }) => {
      try {
        const buf = await getMediaBuffer(m);
        const sb = await makeSticker(buf, { type: StickerTypes.CROPPED });
        await sock.sendMessage(jid, { sticker: sb }, { quoted: m });
      } catch (e) { reply(`Sticker error: ${e?.message}`); }
    },
  },
  {
    name: 'crop', description: 'Sticker with crop fit',
    handler: async ({ sock, jid, m, reply }) => {
      try {
        const buf = await getMediaBuffer(m);
        const sb = await makeSticker(buf, { type: StickerTypes.CROPPED });
        await sock.sendMessage(jid, { sticker: sb }, { quoted: m });
      } catch (e) { reply(`Sticker error: ${e?.message}`); }
    },
  },
  {
    name: 's2img', aliases: ['take'], description: 'Convert sticker → image',
    handler: async ({ sock, jid, m, reply }) => {
      try {
        const buf = await getMediaBuffer(m);
        const png = await sharp(buf).png().toBuffer();
        await sock.sendMessage(jid, { image: png }, { quoted: m });
      } catch (e) { reply(`Convert failed: ${e?.message}`); }
    },
  },
  {
    name: 'attp', description: 'Animated text-to-pic sticker',
    handler: async ({ sock, jid, m, argText, reply }) => {
      if (!argText) return reply('Usage: .attp <text>');
      try {
        const buf = await helpers.downloadToBuffer(`https://api.xteam.xyz/attp?file&text=${encodeURIComponent(argText)}`).catch(() => null);
        if (!buf) return reply('attp service unavailable.');
        const sb = await makeSticker(buf);
        await sock.sendMessage(jid, { sticker: sb }, { quoted: m });
      } catch (e) { reply(`attp failed: ${e?.message}`); }
    },
  },
  {
    name: 'gif', description: 'Convert quoted gif/video to sticker',
    handler: async (ctx) => {
      const handler = require('../../handler');
      return handler.getCommands().get('sticker').handler(ctx);
    },
  },
  {
    name: 'emojimix', description: 'Mix two emojis into a sticker',
    handler: async ({ sock, jid, m, argText, reply }) => {
      const parts = argText.split(/\s+/).filter(Boolean);
      if (parts.length < 2) return reply('Usage: .emojimix 😀 🎉');
      const url = `https://www.gstatic.com/android/keyboard/emojikitchen/20201001/u${parts[0].codePointAt(0).toString(16)}/u${parts[0].codePointAt(0).toString(16)}_u${parts[1].codePointAt(0).toString(16)}.png`;
      try {
        const buf = await helpers.downloadToBuffer(url);
        const sb = await makeSticker(buf);
        await sock.sendMessage(jid, { sticker: sb }, { quoted: m });
      } catch { reply('No mix found for that combo.'); }
    },
  },
  {
    name: 'igs', description: 'Image → sticker w/ small pack name',
    handler: async (ctx) => {
      const handler = require('../../handler');
      return handler.getCommands().get('sticker').handler(ctx);
    },
  },
  { name: 'igsc', description: 'Image → square sticker', handler: async (ctx) => {
      const handler = require('../../handler'); return handler.getCommands().get('sticker2').handler(ctx);
    } },
  { name: 'tgstk', description: 'Telegram sticker pack import (stub)',
    handler: async ({ reply }) => reply('Send the .tgs URL — Telegram pack import is best done with a dedicated converter.') },
  { name: 'stickers', description: 'List supported sticker commands',
    handler: async ({ reply }) => reply('• .sticker (.s)\n• .sticker2 / .crop\n• .attp <text>\n• .emojimix 😀 🎉\n• .gif (reply to gif)\n• .s2img (.take) — sticker→image') },
  { name: 'quoted', description: 'Quote a sticker as quote text',
    handler: async ({ reply, m }) => {
      const ctx = m.message?.extendedTextMessage?.contextInfo;
      if (!ctx) return reply('Reply to something with .quoted');
      reply(`Quoted by: @${(ctx.participant || '').split('@')[0]}`);
    } },
];

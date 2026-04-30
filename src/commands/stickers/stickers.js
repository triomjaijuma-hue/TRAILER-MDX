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
    name: 'attp', description: 'Text-to-pic sticker (rendered locally)',
    handler: async ({ sock, jid, m, argText, reply }) => {
      if (!argText) return reply('Usage: .attp <text>');
      try {
        const safe = String(argText).slice(0, 60).replace(/[<&>]/g, '');
        const len = [...safe].length;
        const fontSize = len <= 8 ? 140 : len <= 16 ? 100 : len <= 28 ? 70 : 50;
        const colors = ['#ff3b3b', '#22d3ee', '#a78bfa', '#facc15', '#34d399', '#f472b6'];
        const c = colors[Math.floor(Math.random() * colors.length)];
        const svg = Buffer.from(
          `<svg xmlns='http://www.w3.org/2000/svg' width='512' height='512' viewBox='0 0 512 512'>` +
          `<rect width='100%' height='100%' fill='#000'/>` +
          `<text x='50%' y='50%' text-anchor='middle' dominant-baseline='middle' ` +
          `font-family='Impact, Arial Black, sans-serif' font-weight='900' ` +
          `font-size='${fontSize}' fill='${c}' stroke='#ffffff' stroke-width='3'>${safe}</text></svg>`
        );
        const png = await sharp(svg).png().toBuffer();
        const sb = await makeSticker(png);
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
      const a = encodeURIComponent(parts[0]);
      const b = encodeURIComponent(parts[1]);
      const candidates = [
        `https://emojik.vercel.app/s/${a}_${b}?size=512`,
        `https://emojikitchen.dev/api/sticker?emojis=${a}_${b}`,
      ];
      for (const url of candidates) {
        try {
          const buf = await helpers.downloadToBuffer(url, { timeout: 15000 });
          if (buf && buf.length > 1024) {
            const sb = await makeSticker(buf);
            await sock.sendMessage(jid, { sticker: sb }, { quoted: m });
            return;
          }
        } catch (_) {}
      }
      reply('No mix found for that combo. Try a different pair (not all combinations exist).');
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

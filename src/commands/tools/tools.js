'use strict';
const sharp = require('sharp');
const QRCode = require('qrcode');
const helpers = require('../../lib/helpers');
const { downloadMediaMessage } = require('@whiskeysockets/baileys');

async function getQuotedMediaBuffer(m) {
  const ctx = m.message?.extendedTextMessage?.contextInfo;
  const inner = ctx?.quotedMessage;
  if (!inner) return null;
  return downloadMediaMessage({ message: inner }, 'buffer', {});
}

async function imageOp(ctx, fn) {
  const buf = await getQuotedMediaBuffer(ctx.m);
  if (!buf) return ctx.reply('Reply to an image.');
  const out = await fn(sharp(buf)).png().toBuffer();
  await ctx.sock.sendMessage(ctx.jid, { image: out }, { quoted: ctx.m });
}

const SMALL_CAPS = {
  a:'ᴀ',b:'ʙ',c:'ᴄ',d:'ᴅ',e:'ᴇ',f:'ғ',g:'ɢ',h:'ʜ',i:'ɪ',j:'ᴊ',k:'ᴋ',l:'ʟ',m:'ᴍ',
  n:'ɴ',o:'ᴏ',p:'ᴘ',q:'ǫ',r:'ʀ',s:'s',t:'ᴛ',u:'ᴜ',v:'ᴠ',w:'ᴡ',x:'x',y:'ʏ',z:'ᴢ',
};

module.exports = [
  // text encodings
  { name: 'base64', description: 'Encode/decode base64', handler: async ({ argText, reply }) => {
    const m = argText.match(/^(en|de)\s+(.+)/i);
    if (!m) return reply('Usage: .base64 en <text>  |  .base64 de <b64>');
    if (m[1].toLowerCase() === 'en') reply(Buffer.from(m[2], 'utf8').toString('base64'));
    else reply(Buffer.from(m[2], 'base64').toString('utf8'));
  } },
  { name: 'bfdecode', description: 'Decode brainfuck', handler: async ({ argText, reply }) => {
    try {
      let p=0,d=new Uint8Array(30000),i=0,o='',code=argText;
      while(i<code.length){const c=code[i++];if(c==='>')p++;else if(c==='<')p--;else if(c==='+')d[p]++;else if(c==='-')d[p]--;else if(c==='.')o+=String.fromCharCode(d[p]);else if(c==='['&&!d[p]){let n=1;while(n)i++,n+=code[i]==='['?1:code[i]===']'?-1:0;}else if(c===']'&&d[p]){let n=1;while(n)i--,n+=code[i]===']'?1:code[i]==='['?-1:0;}}
      reply(o || '(empty)');
    } catch (e) { reply(`bf error: ${e?.message}`); }
  } },
  { name: 'brainfuck', description: 'Encode text → brainfuck (basic)', handler: async ({ argText, reply }) => {
    let out=''; for (const c of argText) { out += '+'.repeat(c.charCodeAt(0)) + '.>'; }
    reply(out.slice(0, 3500) || '(empty)');
  } },
  { name: 'fetch', aliases: ['get'], description: 'GET a URL (text)', handler: async ({ argText, reply }) => {
    if (!argText) return reply('Usage: .fetch <url>');
    try { const r = await require('axios').get(argText, { timeout: 15000 }); reply(String(r.data).slice(0, 3500)); }
    catch (e) { reply(`Failed: ${e?.message}`); }
  } },
  { name: 'getpage', description: 'Fetch URL HTML title + first 500 chars text', handler: async ({ argText, reply }) => {
    if (!argText) return reply('Usage: .getpage <url>');
    try {
      const r = await require('axios').get(argText, { timeout: 15000 });
      const $ = require('cheerio').load(r.data);
      const t = $('title').text().trim();
      const body = $('body').text().replace(/\s+/g, ' ').trim().slice(0, 500);
      reply(`*${t}*\n\n${body}…`);
    } catch (e) { reply(`Failed: ${e?.message}`); }
  } },
  { name: 'screenshot', description: 'Webpage screenshot (via wsrv)', handler: async ({ sock, jid, m, argText, reply }) => {
    if (!argText) return reply('Usage: .screenshot <url>');
    try {
      const buf = await helpers.downloadToBuffer(`https://image.thum.io/get/png/width/1024/${encodeURIComponent(argText)}`);
      await sock.sendMessage(jid, { image: buf, caption: argText }, { quoted: m });
    } catch (e) { reply(`Failed: ${e?.message}`); }
  } },
  { name: 'tinyurl', aliases: ['short'], description: 'Shorten URL', handler: async ({ argText, reply }) => {
    if (!argText) return reply('Usage: .tinyurl <url>');
    try { const r = await require('axios').get(`https://tinyurl.com/api-create.php?url=${encodeURIComponent(argText)}`); reply(r.data); }
    catch (e) { reply(`Failed: ${e?.message}`); }
  } },
  { name: 'url', description: 'URL-encode', handler: async ({ argText, reply }) => reply(encodeURIComponent(argText)) },
  { name: 'urldecode', description: 'URL-decode', handler: async ({ argText, reply }) => { try { reply(decodeURIComponent(argText)); } catch (e) { reply(e?.message); } } },
  { name: 'qrcode', description: 'Generate QR code image', handler: async ({ sock, jid, m, argText, reply }) => {
    if (!argText) return reply('Usage: .qrcode <text>');
    const buf = await QRCode.toBuffer(argText, { width: 512, margin: 1 });
    await sock.sendMessage(jid, { image: buf, caption: argText }, { quoted: m });
  } },
  { name: 'qmaker', description: 'Make a quote-styled image (text)', handler: async ({ sock, jid, m, argText, reply }) => {
    if (!argText) return reply('Usage: .qmaker <text>');
    const svg = Buffer.from(`<svg xmlns='http://www.w3.org/2000/svg' width='800' height='400'><rect width='100%' height='100%' fill='#0b0f1a'/><foreignObject x='30' y='30' width='740' height='340'><div xmlns='http://www.w3.org/1999/xhtml' style='font:600 28px system-ui;color:#e6edf6;line-height:1.4'>"${argText.replace(/</g,'&lt;')}"<br/><span style='color:#22d3ee;font-size:18px;font-weight:400;'>— TRAILER-MDX</span></div></foreignObject></svg>`);
    const png = await sharp(svg).png().toBuffer();
    await sock.sendMessage(jid, { image: png, caption: argText }, { quoted: m });
  } },
  { name: 'readqr', description: '(stub) read a QR image', handler: async ({ reply }) => reply('Open https://zxing.org/w/decode and upload the image — local QR decoding requires extra native deps.') },
  { name: 'removebg', description: 'Background removal (stub — needs API key)', handler: async ({ reply }) => reply('Set REMOVEBG_API_KEY and use https://www.remove.bg/api') },
  { name: 'length', description: 'Length of arg text', handler: async ({ argText, reply }) => reply(`Length: ${[...argText].length} chars`) },
  { name: 'reverse', description: 'Reverse text', handler: async ({ argText, reply }) => reply([...argText].reverse().join('')) },
  { name: 'flip', description: 'Mirror image horizontally', handler: async (ctx) => imageOp(ctx, s => s.flop()) },
  { name: 'grayscale', description: 'Grayscale image', handler: async (ctx) => imageOp(ctx, s => s.grayscale()) },
  { name: 'blur', description: 'Blur image', handler: async (ctx) => imageOp(ctx, s => s.blur(8)) },
  { name: 'invert', description: 'Invert colors', handler: async (ctx) => imageOp(ctx, s => s.negate()) },
  { name: 'sepia', description: 'Sepia tint', handler: async (ctx) => imageOp(ctx, s => s.modulate({ saturation: 0.6 }).tint('#704214')) },
  { name: 'sharpen', description: 'Sharpen image', handler: async (ctx) => imageOp(ctx, s => s.sharpen(2)) },
  { name: 'forwarded', description: 'Forward quoted to current chat', handler: async ({ sock, m, jid, reply }) => {
    const ctx = m.message?.extendedTextMessage?.contextInfo;
    if (!ctx?.quotedMessage) return reply('Reply to a message.');
    await sock.sendMessage(jid, { forward: { key: { remoteJid: jid, id: ctx.stanzaId, fromMe: false, participant: ctx.participant }, message: ctx.quotedMessage } });
  } },
  { name: 'excard', description: 'Send a sample contact card', handler: async ({ sock, jid, m, argText }) => {
    const num = argText.replace(/\D/g, '') || '0';
    const vcard = 'BEGIN:VCARD\nVERSION:3.0\nFN:TRAILER-MDX\nORG:TRAILER-MDX;\nTEL;type=CELL;type=VOICE;waid=' + num + ':' + num + '\nEND:VCARD';
    await sock.sendMessage(jid, { contacts: { displayName: 'TRAILER-MDX', contacts: [{ vcard }] } }, { quoted: m });
  } },
  { name: 'readmore', description: 'Insert "Read more" hidden text', handler: async ({ argText, reply }) => reply(`Visible…${'\u200E'.repeat(4000)}\n${argText}`) },
  { name: 'smallcaps', description: 'Convert text to small caps', handler: async ({ argText, reply }) => reply([...argText.toLowerCase()].map(c => SMALL_CAPS[c] || c).join('')) },
  { name: 'tourl', description: 'Upload media to a temp host (stub)', handler: async ({ reply }) => reply('Use .catbox or .tmpfiles to upload media to a public URL.') },
  { name: 'translate', description: 'translate <lang> <text> (uses LibreTranslate-compatible)', handler: async ({ argText, reply }) => {
    const m = argText.match(/^(\w{2,5})\s+(.+)/);
    if (!m) return reply('Usage: .translate <lang> <text>  e.g. .translate fr Hello');
    try {
      const r = await require('axios').post('https://translate.argosopentech.com/translate', { q: m[2], source: 'auto', target: m[1], format: 'text' }, { timeout: 15000 });
      reply(r.data.translatedText || '(no result)');
    } catch (e) { reply(`Translate failed: ${e?.message}`); }
  } },
  { name: 'tts', description: 'Text to speech (uses Google translate TTS)', handler: async ({ sock, jid, m, argText, reply }) => {
    if (!argText) return reply('Usage: .tts <text>');
    try {
      const buf = await helpers.downloadToBuffer(`https://translate.google.com/translate_tts?ie=UTF-8&q=${encodeURIComponent(argText)}&tl=en&client=tw-ob`);
      await sock.sendMessage(jid, { audio: buf, mimetype: 'audio/mpeg', ptt: true }, { quoted: m });
    } catch (e) { reply(`TTS failed: ${e?.message}`); }
  } },
  { name: 'vnote', description: 'Convert quoted audio to voice note', handler: async ({ sock, jid, m, reply }) => {
    const buf = await getQuotedMediaBuffer(m);
    if (!buf) return reply('Reply to an audio.');
    await sock.sendMessage(jid, { audio: buf, ptt: true, mimetype: 'audio/ogg; codecs=opus' }, { quoted: m });
  } },
];

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
  { name: 'translate', aliases: ['trans', 'tr'], description: 'translate <lang> <text> (free, no key)', handler: async ({ argText, reply }) => {
    const m = argText.match(/^(\w{2,5})\s+([\s\S]+)/);
    if (!m) return reply('Usage: .translate <lang> <text>  e.g. .translate fr Hello');
    const target = m[1].toLowerCase();
    const text = m[2];
    try {
      const r = await require('axios').get('https://api.mymemory.translated.net/get', {
        timeout: 15000,
        params: { q: text.slice(0, 4500), langpair: `auto|${target}` },
      });
      const t = r.data?.responseData?.translatedText;
      if (t) return reply(t);
    } catch (_) {}
    try {
      const r = await require('axios').get('https://translate.googleapis.com/translate_a/single', {
        timeout: 15000,
        params: { client: 'gtx', sl: 'auto', tl: target, dt: 't', q: text },
        headers: { 'User-Agent': 'Mozilla/5.0' },
      });
      const out = (r.data?.[0] || []).map(p => p[0]).join('');
      if (out) return reply(out);
    } catch (_) {}
    try {
      const r = await require('axios').post('https://translate.argosopentech.com/translate', { q: text, source: 'auto', target, format: 'text' }, { timeout: 15000 });
      if (r.data?.translatedText) return reply(r.data.translatedText);
    } catch (_) {}
    reply('Translate failed — all providers unreachable. Try again in a moment.');
  } },
  { name: 'tts', description: 'Text to speech', handler: async ({ sock, jid, m, argText, reply }) => {
    if (!argText) return reply('Usage: .tts <text>');
    const text = String(argText).slice(0, 300);
    const { execFile } = require('child_process');
    const fs = require('fs');

    const id  = Date.now();
    const wav = `/tmp/tts_${id}.wav`;
    const ogg = `/tmp/tts_${id}.ogg`;

    function cleanup() {
      try { fs.unlinkSync(wav); } catch(_) {}
      try { fs.unlinkSync(ogg); } catch(_) {}
    }

    try {
      // Step 1: espeak-ng → WAV (installed via apt, always in /usr/bin/espeak-ng)
      await new Promise((resolve, reject) => {
        execFile('espeak-ng', ['-v', 'en', '-s', '145', '-p', '50', text, '-w', wav],
          { timeout: 15000 },
          (err, _out, stderr) => err ? reject(new Error('espeak-ng: ' + (stderr||err.message).slice(0,200))) : resolve()
        );
      });

      // Verify WAV was created and has content
      if (!fs.existsSync(wav) || fs.statSync(wav).size < 100) throw new Error('espeak-ng produced empty output');

      // Step 2: WAV → OGG Opus (same pattern as audiofx which works correctly)
      await new Promise((resolve, reject) => {
        execFile('ffmpeg', ['-y', '-i', wav, '-c:a', 'libopus', '-ar', '48000', '-ac', '1', '-b:a', '128k', ogg],
          { timeout: 20000 },
          (err, _out, stderr) => err ? reject(new Error('ffmpeg: ' + (stderr||err.message).slice(0,200))) : resolve()
        );
      });

      // Verify OGG was created and has content
      if (!fs.existsSync(ogg) || fs.statSync(ogg).size < 100) throw new Error('ffmpeg produced empty output');

      const buf = fs.readFileSync(ogg);
      cleanup();
      await sock.sendMessage(jid, { audio: buf, mimetype: 'audio/ogg; codecs=opus', ptt: true }, { quoted: m });
    } catch(e) {
      cleanup();
      reply(`❌ TTS failed: ${e?.message?.slice(0, 200)}`);
    }
  } },
  { name: 'vnote', description: 'Convert quoted audio to voice note', handler: async ({ sock, jid, m, reply }) => {
    const buf = await getQuotedMediaBuffer(m);
    if (!buf) return reply('Reply to an audio.');
    await sock.sendMessage(jid, { audio: buf, ptt: true, mimetype: 'audio/ogg; codecs=opus' }, { quoted: m });
  } },
];

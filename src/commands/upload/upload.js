'use strict';
const helpers = require('../../lib/helpers');
const FormData = require('form-data');
const { downloadMediaMessage } = require('@whiskeysockets/baileys');

async function getQuoted(m) {
  const ctx = m.message?.extendedTextMessage?.contextInfo;
  const inner = ctx?.quotedMessage;
  if (!inner) return { error: 'Reply to a media message.' };
  const buf = await downloadMediaMessage({ message: inner }, 'buffer', {});
  let ext = 'bin';
  if (inner.imageMessage) ext = 'jpg';
  else if (inner.videoMessage) ext = 'mp4';
  else if (inner.audioMessage) ext = 'mp3';
  else if (inner.documentMessage) ext = (inner.documentMessage.fileName || 'file.bin').split('.').pop();
  return { buf, ext };
}

async function catbox(buf, ext) {
  const fd = new FormData();
  fd.append('reqtype', 'fileupload');
  fd.append('fileToUpload', buf, { filename: `upload.${ext}` });
  const r = await require('axios').post('https://catbox.moe/user/api.php', fd, { headers: fd.getHeaders(), timeout: 60000 });
  return String(r.data).trim();
}

async function tmpfiles(buf, ext) {
  const fd = new FormData();
  fd.append('file', buf, { filename: `upload.${ext}` });
  const r = await require('axios').post('https://tmpfiles.org/api/v1/upload', fd, { headers: fd.getHeaders(), timeout: 60000 });
  return r.data?.data?.url;
}

async function uguu(buf, ext) {
  const fd = new FormData();
  fd.append('files[]', buf, { filename: `upload.${ext}` });
  const r = await require('axios').post('https://uguu.se/upload?output=json', fd, { headers: fd.getHeaders(), timeout: 60000 });
  return r.data?.files?.[0]?.url;
}

function uploader(name, fn) {
  return {
    name,
    description: `Upload media to ${name}`,
    handler: async ({ m, reply }) => {
      const q = await getQuoted(m);
      if (q.error) return reply(q.error);
      try { const url = await fn(q.buf, q.ext); reply(url || 'No URL returned.'); }
      catch (e) { reply(`Upload failed: ${e?.message}`); }
    },
  };
}

module.exports = [
  uploader('catbox', catbox),
  uploader('tmpfiles', tmpfiles),
  uploader('uguu', uguu),
  { name: 'litterbox', description: 'Catbox (1-hour temp)', handler: async ({ m, reply }) => {
    const q = await getQuoted(m); if (q.error) return reply(q.error);
    const fd = new FormData();
    fd.append('reqtype', 'fileupload'); fd.append('time', '1h'); fd.append('fileToUpload', q.buf, { filename: `upload.${q.ext}` });
    try { const r = await require('axios').post('https://litterbox.catbox.moe/resources/internals/api.php', fd, { headers: fd.getHeaders(), timeout: 60000 }); reply(String(r.data).trim()); }
    catch (e) { reply(`Failed: ${e?.message}`); }
  } },
  { name: 'aupload', description: 'Auto-upload to catbox',
    handler: async (ctx) => {
      const handler = require('../../handler');
      return handler.getCommands().get('catbox').handler(ctx);
    } },
  uploader('freeimage', async (buf, ext) => uguu(buf, ext)),  // alias
  uploader('pixhost', async (buf, ext) => uguu(buf, ext)),
  uploader('pomf', async (buf, ext) => uguu(buf, ext)),
  uploader('quax', async (buf, ext) => uguu(buf, ext)),
  uploader('xoat', async (buf, ext) => uguu(buf, ext)),
];

'use strict';
const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');
const { downloadMediaMessage } = require('@whiskeysockets/baileys');
const helpers = require('../../lib/helpers');
const config = require('../../lib/config');
const logger = require('../../lib/logger');

function ffmpeg(args) {
  return new Promise((resolve, reject) => {
    execFile('ffmpeg', args, { maxBuffer: 64 * 1024 * 1024, timeout: 60000 }, (err, stdout, stderr) => {
      if (err) return reject(new Error(stderr?.toString().split('\n').slice(-3).join(' ').slice(0, 300) || err.message));
      resolve();
    });
  });
}

function getContextInfo(m) {
  const msg = m.message || {};
  return (
    msg.extendedTextMessage?.contextInfo ||
    msg.imageMessage?.contextInfo ||
    msg.videoMessage?.contextInfo ||
    msg.audioMessage?.contextInfo ||
    msg.documentMessage?.contextInfo ||
    msg.stickerMessage?.contextInfo ||
    msg.buttonsResponseMessage?.contextInfo ||
    null
  );
}

function buildQuotedMessageObject(m) {
  const ctxInfo = getContextInfo(m);
  const inner = ctxInfo?.quotedMessage;
  if (!inner) return null;
  if (!inner.audioMessage && !inner.videoMessage) return null;
  return {
    key: {
      remoteJid: m.key.remoteJid,
      id: ctxInfo.stanzaId || ctxInfo.quotedMessageId || '',
      participant: ctxInfo.participant || ctxInfo.remoteJid || m.key.remoteJid,
      fromMe: false,
    },
    message: inner,
  };
}

async function getQuotedAudio(sock, m) {
  const quoted = buildQuotedMessageObject(m);
  if (!quoted) return null;
  try {
    return await downloadMediaMessage(quoted, 'buffer', {}, { logger, reuploadRequest: sock.updateMediaMessage });
  } catch (e) {
    logger.warn({ err: e?.message }, 'audiofx: quoted media download failed');
    return null;
  }
}

function fxCmd(name, filterArgs, description) {
  return {
    name,
    description,
    handler: async ({ sock, jid, m, reply }) => {
      const buf = await getQuotedAudio(sock, m);
      if (!buf) return reply('Reply to an audio or voice note with this command.');
      helpers.ensureTmp();
      const id = Date.now().toString(36);
      const inFile  = path.join(config.paths.tmp, `fx_${id}_in`);
      const outFile = path.join(config.paths.tmp, `fx_${id}_out.ogg`);
      fs.writeFileSync(inFile, buf);
      try {
        await ffmpeg([
          '-y', '-i', inFile,
          ...filterArgs,
          '-c:a', 'libopus',
          '-b:a', '128k',
          '-ac', '1',
          '-ar', '48000',
          outFile,
        ]);
        const out = fs.readFileSync(outFile);
        await sock.sendMessage(jid, { audio: out, mimetype: 'audio/ogg; codecs=opus', ptt: true }, { quoted: m });
      } catch (e) {
        // libopus not available — fall back to mp3 regular audio
        try {
          const outMp3 = path.join(config.paths.tmp, `fx_${id}_out.mp3`);
          await ffmpeg(['-y', '-i', inFile, ...filterArgs, '-ac', '2', '-ar', '44100', '-b:a', '128k', outMp3]);
          const out = fs.readFileSync(outMp3);
          await sock.sendMessage(jid, { audio: out, mimetype: 'audio/mpeg', ptt: false }, { quoted: m });
          try { fs.unlinkSync(outMp3); } catch (_) {}
        } catch (e2) {
          reply(`FX failed: ${e2?.message}\n(Make sure ffmpeg is installed in your deploy environment.)`);
        }
      } finally {
        try { fs.unlinkSync(inFile); } catch (_) {}
        try { fs.unlinkSync(outFile); } catch (_) {}
      }
    },
  };
}

module.exports = [
  fxCmd('bass',      ['-af', 'bass=g=15'],                                              'Boost bass'),
  fxCmd('deep',      ['-af', 'asetrate=44100*0.8,aresample=44100,atempo=1.0'],          'Deeper voice'),
  fxCmd('male',      ['-af', 'asetrate=44100*0.85,aresample=44100,atempo=1.176'],       'Deep male voice'),
  fxCmd('female',    ['-af', 'asetrate=44100*1.25,aresample=44100,atempo=0.8'],         'Female voice'),
  fxCmd('fast',      ['-af', 'atempo=1.5'],                                              'Speed up 1.5x'),
  fxCmd('slow',      ['-af', 'atempo=0.75'],                                             'Slow down 0.75x'),
  fxCmd('reverse',   ['-af', 'areverse'],                                                'Reverse audio'),
  fxCmd('nightcore', ['-af', 'asetrate=44100*1.25,aresample=44100,atempo=1.0'],         'Nightcore pitch up'),
  fxCmd('chipmunk',  ['-af', 'asetrate=44100*1.4,aresample=44100,atempo=0.9'],          'Chipmunk voice'),
  fxCmd('robot',     ['-af', 'aecho=0.8:0.9:500|1000:0.3|0.2,vibrato=f=20:d=0.5'],     'Robot voice'),
  fxCmd('echo',      ['-af', 'aecho=0.8:0.9:1000:0.3'],                                 'Add echo'),
  fxCmd('tupai',     ['-af', 'asetrate=44100*1.5,aresample=44100,atempo=0.9'],          'Squirrel voice'),
];

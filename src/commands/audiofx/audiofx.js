'use strict';
// Audio FX commands powered by ffmpeg. Reply to an audio/voice message
// and the bot will re-encode it with the chosen filter.
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

// Extract contextInfo from whichever message type carries it.
// WhatsApp wraps a reply as extendedTextMessage, but some clients or
// forwarded replies can place contextInfo on other message types too.
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

// Build a full message object so downloadMediaMessage can decrypt the
// quoted audio. The .key (id, remoteJid, participant) is required by
// current Baileys (6.7+); without it the call returns an empty buffer.
function buildQuotedMessageObject(m) {
  const ctxInfo = getContextInfo(m);
  const inner = ctxInfo?.quotedMessage;
  if (!inner) return null;
  // Accept audioMessage (voice notes) and videoMessage (for video→audio FX)
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
    return await downloadMediaMessage(
      quoted,
      'buffer',
      {},
      {
        logger,
        reuploadRequest: sock.updateMediaMessage,
      },
    );
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
      // Use a generic .raw extension for input so ffmpeg auto-detects the
      // container (voice notes arrive as OGG/OPUS from WhatsApp).
      const inFile  = path.join(config.paths.tmp, `fx_${id}_in`);
      // Output as OGG/OPUS — the only format WhatsApp reliably plays as a
      // voice note (ptt). MP3 sent with ptt:true gives "audio not available".
      const outFile = path.join(config.paths.tmp, `fx_${id}_out.ogg`);
      fs.writeFileSync(inFile, buf);
      try {
        await ffmpeg([
          '-y', '-i', inFile,
          ...filterArgs,
          '-c:a', 'libopus',
          '-b:a', '128k',
          '-ac', '1',        // mono — WhatsApp voice notes are mono
          '-ar', '48000',    // Opus native sample rate
          outFile,
        ]);
        const out = fs.readFileSync(outFile);
        await sock.sendMessage(
          jid,
          { audio: out, mimetype: 'audio/ogg; codecs=opus', ptt: true },
          { quoted: m },
        );
      } catch (e) {
        // libopus unavailable? fall back to MP3 as a regular audio attachment
        try {
          const outMp3 = path.join(config.paths.tmp, `fx_${id}_out.mp3`);
          await ffmpeg([
            '-y', '-i', inFile,
            ...filterArgs,
            '-ac', '2', '-ar', '44100', '-b:a', '128k',
            outMp3,
          ]);
          const out = fs.readFileSync(outMp3);
          await sock.sendMessage(
            jid,
            { audio: out, mimetype: 'audio/mpeg', ptt: false },
            { quoted: m },
          );
          try { fs.unlinkSync(outMp3); } catch (_) {}
        } catch (e2) {
          reply(`FX failed: ${e2?.message}\n(Make sure ffmpeg is installed in the deploy environment.)`);
        }
      } finally {
        try { fs.unlinkSync(inFile); } catch (_) {}
        try { fs.unlinkSync(outFile); } catch (_) {}
      }
    },
  };
}

module.exports = [
  fxCmd('bass',      ['-af', 'bass=g=15'],                        'Boost bass on quoted audio'),
  fxCmd('deep',      ['-af', 'asetrate=44100*0.8,aresample=44100,atempo=1.0'], 'Deeper voice'),
  fxCmd('fast',      ['-af', 'atempo=1.5'],                       'Speed up audio 1.5x'),
  fxCmd('slow',      ['-af', 'atempo=0.75'],                      'Slow audio 0.75x'),
  fxCmd('reverse',   ['-af', 'areverse'],                          'Reverse the audio'),
  fxCmd('nightcore', ['-af', 'asetrate=44100*1.25,aresample=44100,atempo=1.0'], 'Nightcore-style pitch up'),
  fxCmd('chipmunk',  ['-af', 'asetrate=44100*1.4,aresample=44100,atempo=0.9'],  'Chipmunk voice'),
  fxCmd('robot',     ['-af', 'afftfilt=real=\'hypot(re,im)*sin(0)\':imag=\'hypot(re,im)*cos(0)\':win_size=512:overlap=0.75'], 'Robot voice'),
  fxCmd('echo',      ['-af', 'aecho=0.8:0.9:1000:0.3'],            'Add echo'),
  fxCmd('tupai',     ['-af', 'asetrate=44100*1.5,aresample=44100,atempo=0.9'],  'Squirrel/Tupai voice'),
];

'use strict';
const os = require('os');
const config = require('../../lib/config');
const helpers = require('../../lib/helpers');

const startedAt = Date.now();

module.exports = [
  {
    name: 'alive',
    description: 'Bot heartbeat',
    handler: async ({ reply }) => {
      await reply(
        `*${config.botName}* is alive.\n` +
        `Version: ${config.version}\n` +
        `Uptime: ${helpers.formatUptime((Date.now() - startedAt) / 1000)}\n` +
        `Prefixes: ${config.prefixes.join(' ')}`
      );
    },
  },
  {
    name: 'ping',
    description: 'Latency',
    handler: async ({ sock, jid, m }) => {
      // True round-trip: send a placeholder, then edit it with the elapsed ms.
      const t = Date.now();
      const sent = await sock.sendMessage(jid, { text: '🏓 ...' }, { quoted: m });
      const elapsed = Date.now() - t;
      try {
        await sock.sendMessage(jid, {
          edit: sent.key,
          text: `🏓 Pong! ${elapsed}ms round-trip · uptime ${process.uptime().toFixed(0)}s`,
        });
      } catch {
        await sock.sendMessage(jid, { text: `🏓 Pong! ${elapsed}ms round-trip · uptime ${process.uptime().toFixed(0)}s` }, { quoted: m });
      }
    },
  },
  {
    name: 'pingweb',
    description: 'Echo "pong" for healthchecks',
    handler: async ({ reply }) => reply('pong'),
  },
  {
    name: 'uptime',
    description: 'Show uptime',
    handler: async ({ reply }) => reply(`Uptime: ${helpers.formatUptime(process.uptime())}`),
  },
  {
    name: 'echo',
    description: 'Echo a message',
    handler: async ({ reply, argText }) => reply(argText || '(empty)'),
  },
  {
    name: 'channelid',
    description: 'Get the chat JID',
    handler: async ({ reply, jid }) => reply(`Chat JID: \`${jid}\``),
  },
  {
    name: 'getpp',
    description: 'Get the chat profile picture',
    handler: async ({ sock, reply, jid, m }) => {
      const target = m.message?.extendedTextMessage?.contextInfo?.mentionedJid?.[0] || jid;
      try {
        const url = await sock.profilePictureUrl(target, 'image');
        const buf = await helpers.downloadToBuffer(url);
        await sock.sendMessage(jid, { image: buf, caption: 'Profile picture' }, { quoted: m });
      } catch {
        await reply('No profile picture or it is private.');
      }
    },
  },
  {
    name: 'pair',
    description: 'Show pairing webpage URL',
    handler: async ({ reply }) => {
      const host = process.env.RAILWAY_PUBLIC_DOMAIN || process.env.PUBLIC_URL || `http://localhost:${config.port}`;
      const url = host.startsWith('http') ? host : `https://${host}`;
      await reply(`Open this page to pair another session:\n${url}`);
    },
  },
  {
    name: 'find',
    description: 'Find a command by keyword',
    handler: async ({ reply, argText }) => {
      const handler = require('../../handler');
      const q = (argText || '').toLowerCase().trim();
      if (!q) return reply('Usage: .find <keyword>');
      const matches = [...handler.getCommands().keys()].filter(n => n.includes(q));
      await reply(matches.length ? matches.map(m => `• .${m}`).join('\n') : 'No commands match.');
    },
  },
  {
    name: 'perf',
    description: 'Performance snapshot',
    handler: async ({ reply }) => {
      const mem = process.memoryUsage();
      await reply(
        '*Performance*\n' +
        `RSS: ${helpers.formatBytes(mem.rss)}\n` +
        `Heap: ${helpers.formatBytes(mem.heapUsed)} / ${helpers.formatBytes(mem.heapTotal)}\n` +
        `CPU load (1m): ${os.loadavg()[0].toFixed(2)}\n` +
        `Free mem: ${helpers.formatBytes(os.freemem())} / ${helpers.formatBytes(os.totalmem())}`
      );
    },
  },
  {
    name: 'viewonce',
    description: 'Re-send a quoted view-once media',
    handler: async ({ sock, m, reply, jid }) => {
      const ctx = m.message?.extendedTextMessage?.contextInfo;
      const quoted = ctx?.quotedMessage;
      if (!quoted) return reply('Reply to a view-once message with .viewonce');
      const inner = quoted.viewOnceMessage?.message || quoted.viewOnceMessageV2?.message || quoted;
      if (inner.imageMessage) {
        const { downloadMediaMessage } = require('@whiskeysockets/baileys');
        const buf = await downloadMediaMessage({ message: { imageMessage: inner.imageMessage } }, 'buffer', {});
        await sock.sendMessage(jid, { image: buf, caption: inner.imageMessage.caption || '' });
      } else if (inner.videoMessage) {
        const { downloadMediaMessage } = require('@whiskeysockets/baileys');
        const buf = await downloadMediaMessage({ message: { videoMessage: inner.videoMessage } }, 'buffer', {});
        await sock.sendMessage(jid, { video: buf, caption: inner.videoMessage.caption || '' });
      } else {
        await reply('No view-once media found.');
      }
    },
  },
];

'use strict';
const store = require('../../lib/store');

module.exports = [
  {
    name: 'online', description: 'Force the bot to appear online',
    handler: async ({ sock, jid, reply }) => {
      try {
        await sock.sendPresenceUpdate('available', jid);
        reply('Now showing as *online*.');
      } catch (e) { reply(`Failed: ${e?.message}`); }
    },
  },
  {
    name: 'offline', description: 'Force the bot to appear offline / unavailable',
    handler: async ({ sock, jid, reply }) => {
      try {
        await sock.sendPresenceUpdate('unavailable', jid);
        reply('Now showing as *offline*.');
      } catch (e) { reply(`Failed: ${e?.message}`); }
    },
  },
  {
    name: 'read', description: 'Toggle auto-read of incoming messages: .read on|off',
    handler: async ({ argText, reply }) => {
      const on = /on|true|1/i.test(argText);
      store.set({ autoread: on });
      reply(`Auto-read: ${on ? 'on' : 'off'}`);
    },
  },
  {
    name: 'lastseen', description: 'Show the bot’s lastSeen privacy setting',
    handler: async ({ sock, reply }) => {
      try {
        const v = await sock.fetchPrivacySettings(true);
        reply(`Privacy settings:\n\`\`\`\n${JSON.stringify(v, null, 2)}\n\`\`\``);
      } catch (e) { reply(`Failed: ${e?.message}`); }
    },
  },
  {
    name: 'stealth', description: 'Toggle stealth mode: .stealth on|off',
    handler: async ({ argText, reply }) => {
      const on = /on|true|1/i.test(argText);
      store.set({ stealth: on });
      reply(`Stealth: ${on ? 'on' : 'off'}`);
    },
  },
];

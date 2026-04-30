'use strict';
// Personal/per-chat notes — backed by the persistent store.
const store = require('../../lib/store');

function bucketFor(jid) { return jid; } // notes are scoped to the chat (DM or group)

module.exports = [
  {
    name: 'addnote', aliases: ['savenote'], description: 'Save a note: .addnote <name> | <text>',
    handler: async ({ jid, argText, reply }) => {
      const m = argText.match(/^([\w-]{1,32})\s*\|\s*([\s\S]+)$/);
      if (!m) return reply('Usage: .addnote <name> | <text>');
      const s = store.get();
      const b = bucketFor(jid);
      s.notes[b] = s.notes[b] || {};
      s.notes[b][m[1].toLowerCase()] = m[2].trim();
      store.set({ notes: s.notes });
      reply(`Saved note *${m[1]}*.`);
    },
  },
  {
    name: 'delnote', description: 'Delete a note: .delnote <name>',
    handler: async ({ jid, argText, reply }) => {
      const name = argText.trim().toLowerCase();
      if (!name) return reply('Usage: .delnote <name>');
      const s = store.get();
      const b = bucketFor(jid);
      if (s.notes[b] && s.notes[b][name]) {
        delete s.notes[b][name];
        store.set({ notes: s.notes });
        return reply(`Deleted *${name}*.`);
      }
      reply('No such note.');
    },
  },
  {
    name: 'listnotes', aliases: ['notes'], description: 'List your saved notes',
    handler: async ({ jid, reply }) => {
      const s = store.get();
      const b = bucketFor(jid);
      const ks = Object.keys(s.notes[b] || {});
      reply(ks.length ? `*Notes:*\n${ks.map(k => `• ${k}`).join('\n')}` : 'No notes saved here yet. .addnote <name> | <text>');
    },
  },
  {
    name: 'getnote', aliases: ['note'], description: 'Read a note: .getnote <name>',
    handler: async ({ jid, argText, reply }) => {
      const name = argText.trim().toLowerCase();
      if (!name) return reply('Usage: .getnote <name>');
      const s = store.get();
      const b = bucketFor(jid);
      const t = s.notes[b]?.[name];
      reply(t ? t : 'No such note.');
    },
  },
];

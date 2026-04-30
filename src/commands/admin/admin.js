'use strict';
const store = require('../../lib/store');

const group = true;

async function getMeta(sock, jid) {
  return sock.groupMetadata(jid).catch(() => null);
}
function isAdmin(meta, uid) {
  if (!meta) return false;
  return meta.participants.some(p => p.id === uid && (p.admin === 'admin' || p.admin === 'superadmin'));
}
function mentionedOrQuoted(m) {
  const ctx = m.message?.extendedTextMessage?.contextInfo;
  return ctx?.mentionedJid?.[0] || (ctx?.participant ? ctx.participant : null);
}
function gj(jid) { return jid.endsWith('@s.whatsapp.net') ? jid : `${jid.replace(/\D/g, '')}@s.whatsapp.net`; }

async function adminGuard(ctx) {
  const meta = await getMeta(ctx.sock, ctx.jid);
  if (!meta) { await ctx.reply('Group only.'); return null; }
  if (!isAdmin(meta, ctx.sender) && !ctx.isOwner) { await ctx.reply('Admins only.'); return null; }
  if (!isAdmin(meta, ctx.sock.user.id)) { await ctx.reply('Make me admin first.'); return null; }
  return meta;
}

module.exports = [
  // group settings toggles
  { name: 'antibadword', group, description: 'Toggle anti-badword', handler: async (ctx) => {
      const s = store.get(); s.antibadword[ctx.jid] = /on|true|1/i.test(ctx.argText);
      store.set({ antibadword: s.antibadword }); ctx.reply(`antibadword: ${s.antibadword[ctx.jid] ? 'on' : 'off'}`); } },
  { name: 'antilink', group, description: 'Toggle anti-link', handler: async (ctx) => {
      const s = store.get(); s.antilink[ctx.jid] = /on|true|1/i.test(ctx.argText);
      store.set({ antilink: s.antilink }); ctx.reply(`antilink: ${s.antilink[ctx.jid] ? 'on' : 'off'}`); } },
  { name: 'antispam', group, description: 'Toggle anti-spam', handler: async (ctx) => {
      const s = store.get(); s.antispam[ctx.jid] = /on|true|1/i.test(ctx.argText);
      store.set({ antispam: s.antispam }); ctx.reply(`antispam: ${s.antispam[ctx.jid] ? 'on' : 'off'}`); } },
  { name: 'antitag', group, description: 'Toggle anti-tag', handler: async (ctx) => {
      const s = store.get(); s.antitag[ctx.jid] = /on|true|1/i.test(ctx.argText);
      store.set({ antitag: s.antitag }); ctx.reply(`antitag: ${s.antitag[ctx.jid] ? 'on' : 'off'}`); } },

  // moderation
  {
    name: 'kick', group, description: 'Kick mentioned user',
    handler: async (ctx) => {
      const meta = await adminGuard(ctx); if (!meta) return;
      const target = mentionedOrQuoted(ctx.m);
      if (!target) return ctx.reply('Mention or reply to a user.');
      await ctx.sock.groupParticipantsUpdate(ctx.jid, [target], 'remove').catch(e => ctx.reply(`Failed: ${e?.message}`));
    },
  },
  {
    name: 'add', group, description: 'Add a number',
    handler: async (ctx) => {
      const meta = await adminGuard(ctx); if (!meta) return;
      const num = ctx.argText.replace(/\D/g, '');
      if (!num) return ctx.reply('Usage: .add <number>');
      const r = await ctx.sock.groupParticipantsUpdate(ctx.jid, [gj(num)], 'add').catch(e => ({ error: e?.message }));
      ctx.reply('```\n' + JSON.stringify(r, null, 2).slice(0, 600) + '\n```');
    },
  },
  {
    name: 'promote', group, description: 'Promote a user',
    handler: async (ctx) => {
      const meta = await adminGuard(ctx); if (!meta) return;
      const target = mentionedOrQuoted(ctx.m);
      if (!target) return ctx.reply('Mention or reply to a user.');
      await ctx.sock.groupParticipantsUpdate(ctx.jid, [target], 'promote').catch(e => ctx.reply(`Failed: ${e?.message}`));
    },
  },
  {
    name: 'demote', group, description: 'Demote a user',
    handler: async (ctx) => {
      const meta = await adminGuard(ctx); if (!meta) return;
      const target = mentionedOrQuoted(ctx.m);
      if (!target) return ctx.reply('Mention or reply to a user.');
      await ctx.sock.groupParticipantsUpdate(ctx.jid, [target], 'demote').catch(e => ctx.reply(`Failed: ${e?.message}`));
    },
  },
  {
    name: 'mute', group, description: 'Only admins can send',
    handler: async (ctx) => {
      const meta = await adminGuard(ctx); if (!meta) return;
      await ctx.sock.groupSettingUpdate(ctx.jid, 'announcement').then(() => ctx.reply('Group muted.')).catch(e => ctx.reply(e?.message));
    },
  },
  {
    name: 'unmute', group, description: 'Anyone can send',
    handler: async (ctx) => {
      const meta = await adminGuard(ctx); if (!meta) return;
      await ctx.sock.groupSettingUpdate(ctx.jid, 'not_announcement').then(() => ctx.reply('Group unmuted.')).catch(e => ctx.reply(e?.message));
    },
  },
  {
    name: 'disappear', group, description: 'disappearing messages: off|7d|24h|90d',
    handler: async (ctx) => {
      const meta = await adminGuard(ctx); if (!meta) return;
      const map = { off: 0, '24h': 86400, '7d': 604800, '90d': 7776000 };
      const t = map[ctx.argText.trim().toLowerCase()];
      if (t == null) return ctx.reply('Usage: .disappear off|24h|7d|90d');
      await ctx.sock.groupToggleEphemeral(ctx.jid, t).then(() => ctx.reply('Updated.')).catch(e => ctx.reply(e?.message));
    },
  },
  {
    name: 'delete', group, description: 'Delete the quoted message',
    handler: async (ctx) => {
      const ctxq = ctx.m.message?.extendedTextMessage?.contextInfo;
      if (!ctxq?.stanzaId) return ctx.reply('Reply to a message.');
      await ctx.sock.sendMessage(ctx.jid, { delete: { remoteJid: ctx.jid, id: ctxq.stanzaId, participant: ctxq.participant, fromMe: false } });
    },
  },
  {
    name: 'hidetag', group, description: 'Send message tagging everyone hidden',
    handler: async (ctx) => {
      const meta = await getMeta(ctx.sock, ctx.jid); if (!meta) return;
      await ctx.sock.sendMessage(ctx.jid, { text: ctx.argText || ' ', mentions: meta.participants.map(p => p.id) });
    },
  },
  {
    name: 'tag', group, description: 'Tag a single mentioned user with a message',
    handler: async (ctx) => {
      const target = mentionedOrQuoted(ctx.m);
      if (!target) return ctx.reply('Mention a user.');
      await ctx.sock.sendMessage(ctx.jid, { text: ctx.argText || '@user', mentions: [target] });
    },
  },
  {
    name: 'tagall', group, description: 'List everyone in the group',
    handler: async (ctx) => {
      const meta = await getMeta(ctx.sock, ctx.jid); if (!meta) return;
      const ms = meta.participants.map(p => p.id);
      const text = `*${meta.subject}* — ${ms.length} members\n\n` + ms.map(j => `@${j.split('@')[0]}`).join(' ');
      await ctx.sock.sendMessage(ctx.jid, { text, mentions: ms });
    },
  },
  {
    name: 'tagnotadmin', group, description: 'Tag non-admin members',
    handler: async (ctx) => {
      const meta = await getMeta(ctx.sock, ctx.jid); if (!meta) return;
      const ms = meta.participants.filter(p => !p.admin).map(p => p.id);
      await ctx.sock.sendMessage(ctx.jid, { text: ms.map(j => `@${j.split('@')[0]}`).join(' '), mentions: ms });
    },
  },
  {
    name: 'resetlink', group, description: 'Revoke and create new invite link',
    handler: async (ctx) => {
      const meta = await adminGuard(ctx); if (!meta) return;
      const code = await ctx.sock.groupRevokeInvite(ctx.jid).catch(() => null);
      ctx.reply(code ? `New invite: https://chat.whatsapp.com/${code}` : 'Failed.');
    },
  },
  {
    name: 'setgname', group, description: 'Set group name',
    handler: async (ctx) => { await adminGuard(ctx); await ctx.sock.groupUpdateSubject(ctx.jid, ctx.argText).catch(e => ctx.reply(e?.message)); ctx.reply('Updated.'); },
  },
  {
    name: 'setgdesc', group, description: 'Set group description',
    handler: async (ctx) => { await adminGuard(ctx); await ctx.sock.groupUpdateDescription(ctx.jid, ctx.argText).catch(e => ctx.reply(e?.message)); ctx.reply('Updated.'); },
  },
  {
    name: 'setgpp', group, description: 'Set group profile pic (reply to image)',
    handler: async (ctx) => {
      await adminGuard(ctx);
      const { downloadMediaMessage } = require('@whiskeysockets/baileys');
      const inner = ctx.m.message?.extendedTextMessage?.contextInfo?.quotedMessage;
      if (!inner?.imageMessage) return ctx.reply('Reply to an image.');
      const buf = await downloadMediaMessage({ message: inner }, 'buffer', {});
      await ctx.sock.updateProfilePicture(ctx.jid, buf).catch(e => ctx.reply(e?.message));
      ctx.reply('Group photo updated.');
    },
  },
  {
    name: 'gcset', group, description: 'gcset open|close|edit-admin|edit-all',
    handler: async (ctx) => {
      await adminGuard(ctx);
      const map = { open: 'not_announcement', close: 'announcement', 'edit-admin': 'locked', 'edit-all': 'unlocked' };
      const m = map[ctx.argText.trim().toLowerCase()];
      if (!m) return ctx.reply('Usage: .gcset open|close|edit-admin|edit-all');
      await ctx.sock.groupSettingUpdate(ctx.jid, m).then(() => ctx.reply('Updated.')).catch(e => ctx.reply(e?.message));
    },
  },
  {
    name: 'welcome', group, description: 'welcome on|off [text]',
    handler: async (ctx) => {
      const s = store.get(); s.antitag[`welcome:${ctx.jid}`] = /on|true|1/i.test(ctx.argText);
      store.set({ antitag: s.antitag }); ctx.reply(`welcome: ${s.antitag[`welcome:${ctx.jid}`] ? 'on' : 'off'}`);
    },
  },
  {
    name: 'goodbye', group, description: 'goodbye on|off [text]',
    handler: async (ctx) => {
      const s = store.get(); s.antitag[`goodbye:${ctx.jid}`] = /on|true|1/i.test(ctx.argText);
      store.set({ antitag: s.antitag }); ctx.reply(`goodbye: ${s.antitag[`goodbye:${ctx.jid}`] ? 'on' : 'off'}`);
    },
  },
  // ban / unban
  {
    name: 'ban', description: 'Ban user from using bot (mention)',
    handler: async (ctx) => {
      const target = mentionedOrQuoted(ctx.m);
      if (!target) return ctx.reply('Mention a user.');
      const s = store.get(); s.banned.push(target); store.set({ banned: [...new Set(s.banned)] });
      ctx.reply('Banned.');
    },
  },
  {
    name: 'unban', description: 'Unban user (mention)',
    handler: async (ctx) => {
      const target = mentionedOrQuoted(ctx.m);
      if (!target) return ctx.reply('Mention a user.');
      const s = store.get(); s.banned = s.banned.filter(x => x !== target); store.set({ banned: s.banned });
      ctx.reply('Unbanned.');
    },
  },
  // warn
  {
    name: 'warn', group, description: 'Warn a user (3 strikes = kick)',
    handler: async (ctx) => {
      const meta = await adminGuard(ctx); if (!meta) return;
      const target = mentionedOrQuoted(ctx.m); if (!target) return ctx.reply('Mention a user.');
      const s = store.get(); s.warns[ctx.jid] = s.warns[ctx.jid] || {};
      s.warns[ctx.jid][target] = (s.warns[ctx.jid][target] || 0) + 1;
      store.set({ warns: s.warns });
      ctx.reply(`Warning ${s.warns[ctx.jid][target]}/3 for @${target.split('@')[0]}`);
      if (s.warns[ctx.jid][target] >= 3) {
        await ctx.sock.groupParticipantsUpdate(ctx.jid, [target], 'remove').catch(() => {});
        s.warns[ctx.jid][target] = 0; store.set({ warns: s.warns });
      }
    },
  },
  {
    name: 'chatbot', group, description: 'Toggle chatbot in group',
    handler: async (ctx) => {
      const s = store.get(); s.aiOn[ctx.jid] = /on|true|1/i.test(ctx.argText);
      store.set({ aiOn: s.aiOn }); ctx.reply(`chatbot: ${s.aiOn[ctx.jid] ? 'on' : 'off'}`);
    },
  },
];

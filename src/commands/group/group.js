'use strict';
const helpers = require('../../lib/helpers');
const store = require('../../lib/store');

function pick(arr) { return arr[Math.floor(Math.random()*arr.length)]; }

module.exports = [
  { name: 'character', description: 'Random character analysis', handler: async ({ pushName, reply }) => {
    reply(`*${pushName}* — ${pick(['chaotic genius', 'silent strategist', 'unhinged optimist', 'professional procrastinator', 'caffeinated philosopher'])} (${pick(['INTJ','ENFP','INFJ','ESTP','ISTJ'])})`);
  } },
  { name: 'compliment', description: 'Send a compliment', handler: async ({ reply, m }) => {
    const target = m.message?.extendedTextMessage?.contextInfo?.mentionedJid?.[0];
    const who = target ? `@${target.split('@')[0]}` : 'you';
    const lines = ['You are absolutely brilliant.', 'You make every room better.', 'Your effort is unmatched.'];
    await reply({ text: `${who} ${pick(lines)}`, mentions: target ? [target] : [] });
  } },
  { name: 'gcmtdata', group: true, description: 'Group metadata raw', handler: async ({ sock, jid, reply }) => {
    const meta = await sock.groupMetadata(jid).catch(() => null);
    reply('```\n' + JSON.stringify(meta, null, 2).slice(0, 1500) + '\n```');
  } },
  { name: 'groupinfo', group: true, description: 'Group summary', handler: async ({ sock, jid, reply }) => {
    const meta = await sock.groupMetadata(jid).catch(() => null);
    if (!meta) return reply('No group.');
    const admins = meta.participants.filter(p => p.admin).length;
    reply(`*${meta.subject}*\nMembers: ${meta.participants.length}\nAdmins: ${admins}\nCreated: ${new Date(meta.creation*1000).toLocaleString()}\nDesc: ${meta.desc || '(none)'}`);
  } },
  { name: 'invitelink', group: true, description: 'Get group invite link', handler: async ({ sock, jid, reply }) => {
    try { const code = await sock.groupInviteCode(jid); reply(`https://chat.whatsapp.com/${code}`); }
    catch (e) { reply(`Failed: ${e?.message}`); }
  } },
  { name: 'joinrequests', group: true, description: 'Pending join requests', handler: async ({ sock, jid, reply }) => {
    try { const list = await sock.groupRequestParticipantsList(jid); reply(JSON.stringify(list, null, 2).slice(0, 1500)); }
    catch (e) { reply(`Failed: ${e?.message}`); }
  } },
  { name: 'insult', description: 'Light-hearted roast', handler: async ({ reply }) => reply(pick(['You spell "Wi-Fi" with a hyphen.','You unmute meetings to ask "wait, what?".','Your group chat starts with "guys" and ends with "..nvm".'])) },
  { name: 'rank', group: true, description: 'Random rank for the chat', handler: async ({ pushName, reply }) => reply(`${pushName} — Rank: ${pick(['Bronze','Silver','Gold','Diamond','Mythic'])}, Score: ${Math.floor(Math.random()*9999)}`) },
  { name: 'ship', description: 'Ship two users', handler: async ({ argText, reply }) => {
    const parts = argText.split('+').map(s => s.trim()).filter(Boolean);
    if (parts.length < 2) return reply('Usage: .ship Alice + Bob');
    reply(`💘 *${parts[0]}* + *${parts[1]}* = ${Math.floor(Math.random()*100)+1}% match`);
  } },
  { name: 'simp', description: 'Simp meter', handler: async ({ reply }) => reply(`Simp meter: ${Math.floor(Math.random()*101)}%`) },
  { name: 'staff', group: true, description: 'List group admins', handler: async ({ sock, jid }) => {
    const meta = await sock.groupMetadata(jid).catch(() => null);
    if (!meta) return;
    const admins = meta.participants.filter(p => p.admin).map(p => p.id);
    await sock.sendMessage(jid, { text: '*Admins*\n' + admins.map(j => `• @${j.split('@')[0]}`).join('\n'), mentions: admins });
  } },
  { name: 'stupid', description: 'Stupidity %', handler: async ({ reply }) => reply(`Stupidity score: ${Math.floor(Math.random()*101)}%`) },
  { name: 'warnings', group: true, description: 'Show your warnings count', handler: async ({ jid, sender, reply }) => {
    const s = store.get(); const n = s.warns?.[jid]?.[sender] || 0;
    reply(`You have ${n}/3 warnings.`);
  } },
  { name: 'wasted', description: 'Wasted overlay (caption)', handler: async ({ reply }) => reply('— WASTED —') },
  { name: 'poll', group: true, description: 'Send a poll: .poll Question | A | B | C', handler: async ({ sock, jid, m, argText, reply }) => {
    const parts = argText.split('|').map(s => s.trim()).filter(Boolean);
    if (parts.length < 3) return reply('Usage: .poll Question | A | B | C');
    await sock.sendMessage(jid, { poll: { name: parts[0], values: parts.slice(1), selectableCount: 1 } }, { quoted: m });
  } },
];

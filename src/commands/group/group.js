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

  // .groups — list every group the bot is currently in, numbered and sorted.
  // Use the numbers with .rejoin to get added back to a group you left.
  { name: 'groups', aliases: ['grouplist'], owner: true,
    description: 'List all groups the bot is in (use numbers with .rejoin)',
    handler: async ({ sock, reply }) => {
      let all;
      try { all = await sock.groupFetchAllParticipating(); }
      catch (e) { return reply(`❌ Could not fetch groups: ${e.message}`); }

      const list = Object.values(all)
        .map(g => ({ jid: g.id, name: g.subject || g.id }))
        .sort((a, b) => a.name.localeCompare(b.name));

      if (!list.length) return reply('Bot is not in any groups.');

      const lines = list.map((g, i) =>
        `${String(i + 1).padStart(2, ' ')}. ${g.name}\n    ${g.jid}`
      );
      reply(
        `*📋 Groups bot is in (${list.length})*\n` +
        `_Use \`.rejoin <number>\` to get added back_\n\n` +
        lines.join('\n\n')
      );
    },
  },

  // ----- group open / close (admin-only toggle) -------------------------
  {
    name: 'open', aliases: ['groupopen', 'unlock'], group: true, admin: true,
    description: 'Allow all members to send messages (remove admin-only)',
    handler: async ({ sock, jid, reply }) => {
      try {
        await sock.groupSettingUpdate(jid, 'not_announcement');
        reply('✅ Group opened — all members can now send messages.');
      } catch (e) {
        reply('❌ Could not open group. Make sure the bot is an admin.\n' + (e?.message || ''));
      }
    },
  },
  {
    name: 'close', aliases: ['groupclose', 'lock'], group: true, admin: true,
    description: 'Restrict group — only admins can send messages',
    handler: async ({ sock, jid, reply }) => {
      try {
        await sock.groupSettingUpdate(jid, 'announcement');
        reply('🔒 Group locked — only admins can send messages now.');
      } catch (e) {
        reply('❌ Could not lock group. Make sure the bot is an admin.\n' + (e?.message || ''));
      }
    },
  },

  // ----- group settings (edit info toggle) --------------------------------
  {
    name: 'editon', aliases: ['allowedit'], group: true, admin: true,
    description: 'Allow all members to edit group info (name/icon/desc)',
    handler: async ({ sock, jid, reply }) => {
      try {
        await sock.groupSettingUpdate(jid, 'unlocked');
        reply('✅ All members can now edit group info.');
      } catch (e) { reply('❌ Failed: ' + (e?.message || '')); }
    },
  },
  {
    name: 'editoff', aliases: ['disableedit'], group: true, admin: true,
    description: 'Restrict group info editing to admins only',
    handler: async ({ sock, jid, reply }) => {
      try {
        await sock.groupSettingUpdate(jid, 'locked');
        reply('🔒 Only admins can edit group info now.');
      } catch (e) { reply('❌ Failed: ' + (e?.message || '')); }
    },
  },

  // ----- kick / add / promote / demote ------------------------------------
  {
    name: 'kick', aliases: ['remove'], group: true, admin: true,
    description: 'Remove a member: reply to their message or @mention',
    handler: async ({ sock, jid, m, argText, reply }) => {
      const mentioned = m.message?.extendedTextMessage?.contextInfo?.mentionedJid?.[0]
        || m.message?.extendedTextMessage?.contextInfo?.participant;
      const target = mentioned || (argText.match(/\d+/)?.[0] ? argText.match(/\d+/)[0] + '@s.whatsapp.net' : null);
      if (!target) return reply('Reply to a message or @mention the user to kick.');
      try {
        await sock.groupParticipantsUpdate(jid, [target], 'remove');
        reply(`✅ @${target.split('@')[0]} removed.`, { mentions: [target] });
      } catch (e) { reply('❌ Could not remove user: ' + (e?.message || '')); }
    },
  },
  {
    name: 'add', group: true, admin: true,
    description: 'Add a member: .add 2567xxxxxxx',
    handler: async ({ sock, jid, argText, reply }) => {
      const num = argText.replace(/[^0-9]/g, '');
      if (!num) return reply('Usage: .add 2567xxxxxxx (number with country code, no +)');
      const target = num + '@s.whatsapp.net';
      try {
        const res = await sock.groupParticipantsUpdate(jid, [target], 'add');
        const status = res?.[0]?.status;
        if (status === '200' || status === 200) reply(`✅ +${num} added to the group.`);
        else reply(`⚠️ Status ${status} — they may not be on WhatsApp or have privacy settings blocking adds.`);
      } catch (e) { reply('❌ Failed: ' + (e?.message || '')); }
    },
  },
  {
    name: 'promote', aliases: ['makeadmin'], group: true, admin: true,
    description: 'Promote a member to admin: reply or @mention',
    handler: async ({ sock, jid, m, argText, reply }) => {
      const mentioned = m.message?.extendedTextMessage?.contextInfo?.mentionedJid?.[0];
      const target = mentioned || (argText.match(/\d+/)?.[0] ? argText.match(/\d+/)[0] + '@s.whatsapp.net' : null);
      if (!target) return reply('Reply to or @mention the user to promote.');
      try {
        await sock.groupParticipantsUpdate(jid, [target], 'promote');
        reply(`⭐ @${target.split('@')[0]} is now an admin.`, { mentions: [target] });
      } catch (e) { reply('❌ Failed: ' + (e?.message || '')); }
    },
  },
  {
    name: 'demote', aliases: ['removeadmin'], group: true, admin: true,
    description: 'Demote an admin to member: reply or @mention',
    handler: async ({ sock, jid, m, argText, reply }) => {
      const mentioned = m.message?.extendedTextMessage?.contextInfo?.mentionedJid?.[0];
      const target = mentioned || (argText.match(/\d+/)?.[0] ? argText.match(/\d+/)[0] + '@s.whatsapp.net' : null);
      if (!target) return reply('Reply to or @mention the user to demote.');
      try {
        await sock.groupParticipantsUpdate(jid, [target], 'demote');
        reply(`🔽 @${target.split('@')[0]} demoted to member.`, { mentions: [target] });
      } catch (e) { reply('❌ Failed: ' + (e?.message || '')); }
    },
  },

  // .rejoin <number> — adds the sender (owner) back to a group they left.
  // Requires the bot to still be a member and ideally an admin in that group.
  // The group number comes from .groups above (sorted alphabetically, stable order).
  { name: 'rejoin', aliases: ['groupjoin'], owner: true,
    description: 'Rejoin a group you left: .rejoin <number from .groups>',
    handler: async ({ sock, sender, argText, reply }) => {
      const num = parseInt((argText || '').trim(), 10);
      if (!num || num < 1) return reply('Usage: .rejoin <number>\nGet the number from .groups');

      let all;
      try { all = await sock.groupFetchAllParticipating(); }
      catch (e) { return reply(`❌ Could not fetch groups: ${e.message}`); }

      const list = Object.values(all)
        .map(g => ({ jid: g.id, name: g.subject || g.id }))
        .sort((a, b) => a.name.localeCompare(b.name));

      const target = list[num - 1];
      if (!target) return reply(`❌ No group #${num}. Run .groups to see the list (currently ${list.length} groups).`);

      try {
        const result = await sock.groupParticipantsUpdate(target.jid, [sender], 'add');
        const status = result?.[0]?.status;
        if (status === '200' || status === 200) {
          reply(`✅ Added you back to *${target.name}*`);
        } else if (status === '403') {
          reply(`❌ Bot is not an admin in *${target.name}* — ask a group admin to make the bot admin first, then try again.`);
        } else if (status === '408') {
          reply(`❌ You were already removed by an admin — they need to add you back manually in *${target.name}*.`);
        } else {
          reply(`⚠️ Got status ${status} for *${target.name}* — you may already be in the group, or the bot lacks permission.`);
        }
      } catch (e) {
        reply(`❌ Failed to add you to *${target.name}*: ${e.message}`);
      }
    },
  },
];

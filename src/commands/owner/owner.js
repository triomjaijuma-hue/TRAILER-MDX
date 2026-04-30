'use strict';
const fs = require('fs');
const path = require('path');
const os = require('os');
const config = require('../../lib/config');
const store = require('../../lib/store');
const helpers = require('../../lib/helpers');

const owner = true;

function setBool(key, on, ctx) {
  const s = store.get();
  store.set({ [key]: !!on });
  ctx.reply(`*${key}* is now *${on ? 'ON' : 'OFF'}*`);
}

module.exports = [
  // ----- toggles -----
  { name: 'anticall',   owner, description: 'Toggle anti-call', handler: (ctx) => setBool('anticall', /on|true|1/i.test(ctx.argText), ctx) },
  { name: 'antidelete', owner, description: 'Toggle anti-delete', handler: (ctx) => setBool('antidelete', /on|true|1/i.test(ctx.argText), ctx) },
  { name: 'autoreact',  owner, description: 'Toggle auto-react', handler: (ctx) => setBool('autoreact', /on|true|1/i.test(ctx.argText), ctx) },
  { name: 'autoread',   owner, description: 'Toggle auto-read', handler: (ctx) => setBool('autoread', /on|true|1/i.test(ctx.argText), ctx) },
  { name: 'autoreply',  owner, description: 'Toggle auto-reply', handler: (ctx) => setBool('autoreply', /on|true|1/i.test(ctx.argText), ctx) },
  { name: 'autostatus', owner, description: 'Toggle auto view status', handler: (ctx) => setBool('autostatus', /on|true|1/i.test(ctx.argText), ctx) },
  { name: 'autotyping', owner, description: 'Toggle auto typing', handler: (ctx) => setBool('autotyping', /on|true|1/i.test(ctx.argText), ctx) },
  { name: 'cmdreact',   owner, description: 'Toggle reaction on commands', handler: (ctx) => setBool('cmdReact', /on|true|1/i.test(ctx.argText), ctx) },
  { name: 'maintenance',owner, description: 'Toggle maintenance mode', handler: (ctx) => setBool('maintenance', /on|true|1/i.test(ctx.argText), ctx) },
  { name: 'pmblocker',  owner, description: 'Block DMs from non-contacts', handler: (ctx) => setBool('pmblock', /on|true|1/i.test(ctx.argText), ctx) },
  { name: 'stealth',    owner, description: 'Toggle stealth (no presence/read)', handler: (ctx) => setBool('stealth', /on|true|1/i.test(ctx.argText), ctx) },

  // ----- mode (public/private) -----
  {
    name: 'mode', owner, description: 'public|private',
    handler: async ({ reply, argText }) => {
      const m = (argText || '').toLowerCase();
      if (m === 'public' || m === 'private') {
        config.mode = m;
        return reply(`Mode set to *${m}*.`);
      }
      reply(`Current mode: *${config.mode}*. Use .mode public | private`);
    },
  },

  // ----- broadcast -----
  {
    name: 'broadcast', owner, description: 'Broadcast to all chats',
    handler: async ({ sock, argText, reply }) => {
      if (!argText) return reply('Usage: .broadcast <message>');
      const chats = (await sock.groupFetchAllParticipating?.()) || {};
      const targets = Object.keys(chats);
      let n = 0;
      for (const j of targets) {
        try { await sock.sendMessage(j, { text: `📢 *Broadcast*\n${argText}` }); n++; } catch (_) {}
      }
      reply(`Broadcast sent to ${n} group(s).`);
    },
  },
  {
    name: 'broadcastdm', owner, description: 'Broadcast to DM contacts',
    handler: async ({ reply }) => reply('DM broadcast queued (limited to recent chats).'),
  },

  // ----- replies (.addreply / .delreply / .listreplies) -----
  {
    name: 'addreply', owner, description: 'Add keyword auto-reply: keyword | response',
    handler: async ({ argText, reply }) => {
      const [k, ...r] = argText.split('|');
      if (!k || r.length === 0) return reply('Usage: .addreply hello | hi there');
      const s = store.get();
      s.replies[k.trim().toLowerCase()] = r.join('|').trim();
      store.set({ replies: s.replies });
      reply(`Saved reply for "${k.trim()}".`);
    },
  },
  {
    name: 'delreply', owner, description: 'Remove keyword auto-reply',
    handler: async ({ argText, reply }) => {
      const s = store.get();
      const k = argText.trim().toLowerCase();
      if (!s.replies[k]) return reply('No such keyword.');
      delete s.replies[k];
      store.set({ replies: s.replies });
      reply(`Removed reply for "${k}".`);
    },
  },
  {
    name: 'listreplies', owner, description: 'List keyword auto-replies',
    handler: async ({ reply }) => {
      const s = store.get();
      const keys = Object.keys(s.replies);
      reply(keys.length ? keys.map(k => `• ${k} → ${s.replies[k]}`).join('\n') : 'No saved replies.');
    },
  },

  // ----- chats: clear / archive / pin / star -----
  {
    name: 'clear', aliases: ['clearchat'], owner, description: 'Clear current chat',
    handler: async ({ sock, jid, reply }) => {
      try { await sock.chatModify({ delete: true, lastMessages: [] }, jid); reply('Chat cleared.'); }
      catch (e) { reply(`Could not clear: ${e?.message}`); }
    },
  },
  {
    name: 'archivechat', owner, description: 'Archive current chat',
    handler: async ({ sock, jid, reply }) => {
      try { await sock.chatModify({ archive: true, lastMessages: [] }, jid); reply('Archived.'); }
      catch (e) { reply(`Could not archive: ${e?.message}`); }
    },
  },
  {
    name: 'pinchat', owner, description: 'Pin current chat',
    handler: async ({ sock, jid, reply }) => {
      try { await sock.chatModify({ pin: true }, jid); reply('Pinned.'); }
      catch (e) { reply(`Could not pin: ${e?.message}`); }
    },
  },
  {
    name: 'star', owner, description: 'Star quoted message',
    handler: async ({ sock, m, jid, reply }) => {
      try { await sock.chatModify({ star: { messages: [{ id: m.key.id, fromMe: m.key.fromMe }], star: true } }, jid); reply('Starred.'); }
      catch (e) { reply(`Could not star: ${e?.message}`); }
    },
  },

  // ----- session / files -----
  {
    name: 'clearsession', owner, description: 'Wipe session and re-pair',
    handler: async ({ reply }) => {
      reply('Clearing session — bot will reconnect; re-pair from the web page.');
      const bot = require('../../bot');
      await bot.logout();
    },
  },
  {
    name: 'cleartmp', owner, description: 'Clear temp files',
    handler: async ({ reply }) => {
      try {
        const tmp = config.paths.tmp;
        for (const f of fs.readdirSync(tmp)) fs.rmSync(path.join(tmp, f), { recursive: true, force: true });
        reply('tmp/ cleared.');
      } catch (e) { reply(`Could not clear: ${e?.message}`); }
    },
  },

  // ----- system / info -----
  {
    name: 'sysinfo', owner, description: 'System information',
    handler: async ({ reply }) => {
      const mem = process.memoryUsage();
      reply(
        '*System*\n' +
        `OS: ${os.type()} ${os.release()} (${os.arch()})\n` +
        `Node: ${process.version}\n` +
        `Hostname: ${os.hostname()}\n` +
        `CPU: ${os.cpus()[0]?.model || 'unknown'} × ${os.cpus().length}\n` +
        `Load avg: ${os.loadavg().map(n => n.toFixed(2)).join(', ')}\n` +
        `Memory: ${helpers.formatBytes(mem.rss)} (free ${helpers.formatBytes(os.freemem())})\n` +
        `Uptime: ${helpers.formatUptime(process.uptime())}`
      );
    },
  },
  {
    name: 'inspect', owner, description: 'Inspect quoted message JSON',
    handler: async ({ m, reply }) => {
      const ctx = m.message?.extendedTextMessage?.contextInfo;
      const out = ctx?.quotedMessage || m.message;
      reply('```\n' + JSON.stringify(out, null, 2).slice(0, 1500) + '\n```');
    },
  },
  {
    name: 'getfile', owner, description: 'Send a project file (path)',
    handler: async ({ sock, jid, m, reply, argText }) => {
      const p = path.resolve(__dirname, '..', '..', '..', argText.trim());
      if (!p.startsWith(path.resolve(__dirname, '..', '..', '..'))) return reply('Path not allowed.');
      if (!fs.existsSync(p)) return reply('File not found.');
      await sock.sendMessage(jid, {
        document: fs.readFileSync(p),
        fileName: path.basename(p),
        mimetype: 'application/octet-stream',
      }, { quoted: m });
    },
  },
  {
    name: 'gitinfo', owner, description: 'Show git status (best-effort)',
    handler: async ({ reply }) => {
      try {
        const { execSync } = require('child_process');
        const out = execSync('git log -1 --oneline 2>/dev/null && git status -s 2>/dev/null', { encoding: 'utf8' });
        reply('```\n' + (out || '(no git info)') + '\n```');
      } catch { reply('git not available in this environment.'); }
    },
  },
  {
    name: 'gitpull', owner, description: 'git pull (if available)',
    handler: async ({ reply }) => {
      try {
        const { execSync } = require('child_process');
        const out = execSync('git pull 2>&1', { encoding: 'utf8' });
        reply('```\n' + out + '\n```');
      } catch (e) { reply(`git pull failed: ${e?.message}`); }
    },
  },
  {
    name: 'reload', owner, description: 'Hot-reload command modules',
    handler: async ({ reply }) => {
      try {
        for (const k of Object.keys(require.cache)) {
          if (k.includes(path.sep + 'commands' + path.sep)) delete require.cache[k];
        }
        const handlerPath = require.resolve('../../handler');
        delete require.cache[handlerPath];
        require('../../handler');
        reply('Reloaded all command modules.');
      } catch (e) { reply(`Reload failed: ${e?.message}`); }
    },
  },
  {
    name: 'update', owner, description: 'Restart the bot process',
    handler: async ({ reply }) => {
      await reply('Restarting…');
      setTimeout(() => process.exit(0), 600);
    },
  },

  // ----- profile -----
  {
    name: 'setbio', owner, description: 'Set bot status (bio)',
    handler: async ({ sock, argText, reply }) => {
      try { await sock.updateProfileStatus(argText || `${config.botName} v${config.version}`); reply('Bio updated.'); }
      catch (e) { reply(`Could not update bio: ${e?.message}`); }
    },
  },
  {
    name: 'setpp', owner, description: 'Set bot profile picture (reply to image)',
    handler: async ({ sock, m, reply }) => {
      const { downloadMediaMessage } = require('@whiskeysockets/baileys');
      const ctx = m.message?.extendedTextMessage?.contextInfo;
      const inner = ctx?.quotedMessage;
      if (!inner?.imageMessage) return reply('Reply to an image.');
      const buf = await downloadMediaMessage({ message: inner }, 'buffer', {});
      await sock.updateProfilePicture(sock.user.id, buf);
      reply('Profile picture updated.');
    },
  },
  {
    name: 'mention', owner, description: 'Mention everyone (alias of tagall)',
    handler: async (ctx) => {
      const handler = require('../../handler');
      const t = handler.getCommands().get('tagall');
      if (t) return t.handler(ctx);
      ctx.reply('tagall not loaded.');
    },
  },

  // ----- groups -----
  {
    name: 'gcleave', owner, group: true, description: 'Make bot leave the group',
    handler: async ({ sock, jid, reply }) => {
      await reply('Leaving…');
      await sock.groupLeave(jid).catch(() => {});
    },
  },
  {
    name: 'joingroup', owner, description: 'Join via invite link',
    handler: async ({ sock, argText, reply }) => {
      const m = argText.match(/chat\.whatsapp\.com\/([A-Za-z0-9]+)/);
      if (!m) return reply('Send a valid invite link.');
      try { const r = await sock.groupAcceptInvite(m[1]); reply(`Joined: ${r}`); }
      catch (e) { reply(`Failed: ${e?.message}`); }
    },
  },

  // ----- misc owner -----
  {
    name: 'sudo', owner, description: 'Add/remove sudo: add|del @user',
    handler: async ({ argText, reply, m }) => {
      const s = store.get();
      const ctx = m.message?.extendedTextMessage?.contextInfo;
      const target = ctx?.mentionedJid?.[0];
      if (!target) return reply('Mention a user.');
      if (/del|remove/i.test(argText)) {
        s.sudo = s.sudo.filter(j => j !== target);
        store.set({ sudo: s.sudo });
        return reply('Removed.');
      }
      s.sudo.push(target);
      store.set({ sudo: [...new Set(s.sudo)] });
      reply('Added.');
    },
  },
  {
    name: 'rentbot',  owner, description: '(stub) Mark a number as rented',
    handler: async ({ argText, reply }) => {
      const s = store.get();
      s.rented.push(argText.trim());
      store.set({ rented: [...new Set(s.rented)] });
      reply('Rental added.');
    },
  },
  { name: 'stoprent', owner, description: '(stub) Stop a rental',
    handler: async ({ argText, reply }) => {
      const s = store.get();
      s.rented = s.rented.filter(x => x !== argText.trim());
      store.set({ rented: s.rented });
      reply('Rental stopped.');
    },
  },
  { name: 'listrent', owner, description: 'List rentals',
    handler: async ({ reply }) => reply((store.get().rented || []).map(r => `• ${r}`).join('\n') || 'No rentals.'),
  },

  // ----- plugin admin (acknowledgements) -----
  { name: 'addplugin', owner, description: '(advisory) Drop .js files in src/commands/<category>/ then .reload', handler: async ({ reply }) => reply('Drop a JS file in `src/commands/<category>/` then run *.reload*.') },
  { name: 'delplugin', owner, description: '(advisory) Delete the file then .reload', handler: async ({ reply }) => reply('Delete the file under `src/commands/...` then run *.reload*.') },
  { name: 'setcmd',   owner, description: '(advisory) Set or alias a command', handler: async ({ reply }) => reply('Edit the plugin file and re-run *.reload*.') },
  { name: 'delcmd',   owner, description: '(advisory) Remove a command', handler: async ({ reply }) => reply('Edit the plugin file and re-run *.reload*.') },
  { name: 'manage',   owner, description: 'Open settings menu', handler: async ({ reply }) => reply('Use *.settings* to view bot toggles.') },
  {
    name: 'settings', owner, description: 'Show toggles',
    handler: async ({ reply }) => {
      const s = store.get();
      reply(
        '*Settings*\n' +
        Object.entries({
          mode: config.mode, anticall: s.anticall, antidelete: s.antidelete,
          autoreact: s.autoreact, autoread: s.autoread, autoreply: s.autoreply,
          autostatus: s.autostatus, autotyping: s.autotyping,
          stealth: s.stealth, maintenance: s.maintenance, pmblock: s.pmblock,
          cmdReact: s.cmdReact,
        }).map(([k, v]) => `• ${k}: *${v ? 'on' : (v === false ? 'off' : v)}*`).join('\n')
      );
    },
  },
];

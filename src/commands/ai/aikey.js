'use strict';
// Owner-only: set/clear/list AI provider API keys at runtime.
// Keys are persisted in the bot's store (auth_info/store.json) and take
// effect immediately — no redeploy needed. Runtime keys override env-var keys.
const ai = require('../../lib/ai');
const store = require('../../lib/store');

const PROVIDERS = ['gemini', 'groq', 'openrouter', 'openai'];
const HELP = [
  '🔑 *.aikey* — manage AI provider keys',
  '',
  'Usage:',
  '• `.aikey set gemini <YOUR_KEY>`   — save & start using a Gemini key',
  '• `.aikey set groq <YOUR_KEY>`     — save & start using a Groq key',
  '• `.aikey clear gemini`            — remove the saved Gemini key',
  '• `.aikey list`                    — show which providers have a key',
  '• `.aikey test`                    — send "Hello" to confirm AI is working',
  '',
  'Get a FREE key:',
  '• Gemini → https://aistudio.google.com/app/apikey',
  '• Groq   → https://console.groq.com/keys',
  '',
  'For safety, the message containing your key will be deleted automatically.',
].join('\n');

function mask(k) {
  if (!k) return '(none)';
  if (k.length <= 8) return '*'.repeat(k.length);
  return k.slice(0, 4) + '…' + k.slice(-4) + ` (len ${k.length})`;
}

async function autoDelete(sock, m) {
  // Best-effort: erase the message that carried the key. In a DM this works
  // for the owner's own message; in groups the bot must be admin to delete
  // someone else's, but the owner is usually messaging from their own number.
  try { await sock.sendMessage(m.key.remoteJid, { delete: m.key }); } catch (_) {}
}

module.exports = [
  {
    name: 'aikey',
    aliases: ['setaikey', 'aikeys'],
    owner: true,
    description: 'Manage AI provider keys at runtime (.aikey for help)',
    handler: async ({ argText, sock, jid, m, reply }) => {
      const parts = (argText || '').trim().split(/\s+/);
      const sub = (parts[0] || '').toLowerCase();

      if (!sub || sub === 'help') return reply(HELP);

      if (sub === 'list') {
        const lines = PROVIDERS.map((p) => {
          const k = ai.keyFor(p);
          const src = ai.keySource(p);
          return `• *${p}* — ${k ? `${mask(k)} _(from ${src})_` : '_(not set)_'}`;
        });
        const active = ai.activeProvider();
        return reply(`🔑 *AI keys*\n${lines.join('\n')}\n\nActive provider: ${active ? `*${active}*` : '_none_'}\n\nFallback order: GEMINI → GROQ → OPENROUTER → OPENAI`);
      }

      if (sub === 'test') {
        if (!ai.isConfigured()) return reply('No AI provider configured. Use `.aikey set gemini <key>` first.');
        await reply('🧪 Testing… (provider: ' + ai.activeProvider() + ')');
        const out = await ai.chat('Reply with the single word: pong', { system: 'Be terse.' });
        return reply(`Response: ${out}`);
      }

      if (sub === 'set') {
        const provider = (parts[1] || '').toLowerCase();
        const key = parts.slice(2).join(' ').trim();
        if (!PROVIDERS.includes(provider)) return reply(`Unknown provider. Use one of: ${PROVIDERS.join(', ')}`);
        if (!key) return reply(`Usage: .aikey set ${provider} <YOUR_KEY>`);
        if (key.length < 10) return reply('That key looks too short to be valid. Double-check and try again.');

        // Delete the user's message ASAP so the key doesn't sit in chat history.
        await autoDelete(sock, m);

        const s = store.get();
        s.aiKeys = s.aiKeys || {};
        s.aiKeys[provider] = key;
        store.set({ aiKeys: s.aiKeys });

        return reply(
          `✅ Saved *${provider}* key (${mask(key)}).\n` +
          `Active provider is now *${ai.activeProvider()}*.\n\n` +
          `Try: \`.aikey test\` or just \`.gpt hi\`.\n` +
          `For auto-reply: \`.aion\` (this chat) or \`.aionall\` (all DMs).`
        );
      }

      if (sub === 'clear' || sub === 'remove' || sub === 'del') {
        const provider = (parts[1] || '').toLowerCase();
        if (!PROVIDERS.includes(provider)) return reply(`Usage: .aikey clear <${PROVIDERS.join('|')}>`);
        const s = store.get();
        s.aiKeys = s.aiKeys || {};
        const had = !!s.aiKeys[provider];
        delete s.aiKeys[provider];
        store.set({ aiKeys: s.aiKeys });
        const fallback = ai.keySource(provider);
        return reply(
          had
            ? `🗑️ Cleared runtime *${provider}* key.${fallback ? ` Falling back to env-var key.` : ''}`
            : `No runtime *${provider}* key was set.`
        );
      }

      return reply(`Unknown subcommand "${sub}".\n\n${HELP}`);
    },
  },
];

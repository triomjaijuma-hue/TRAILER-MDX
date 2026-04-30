'use strict';
const ai = require('../../lib/ai');
const store = require('../../lib/store');

async function chatCmd(prompt, system) {
  if (!prompt) return 'Send a prompt after the command.';
  return ai.chat(prompt, { system });
}

module.exports = [
  {
    name: 'gpt',
    description: 'Ask GPT',
    handler: async ({ argText, reply }) => reply(await chatCmd(argText, 'You are a helpful, concise assistant.')),
  },
  {
    name: 'llama',
    description: 'Ask Llama',
    handler: async ({ argText, reply }) => reply(await ai.chat(argText, { system: 'You are Llama, friendly and helpful.', model: 'meta-llama/llama-3.1-8b-instruct' })),
  },
  {
    name: 'mistral',
    description: 'Ask Mistral',
    handler: async ({ argText, reply }) => reply(await ai.chat(argText, { system: 'You are Mistral, helpful and concise.', model: 'mistralai/mistral-7b-instruct' })),
  },
  {
    name: 'dalle', aliases: ['flux', 'diffusion'],
    description: 'Generate an image',
    handler: async ({ argText, sock, jid, m, reply }) => {
      if (!argText) return reply('Usage: .dalle <prompt>');
      const r = await ai.image(argText);
      if (r.error) return reply(r.error);
      await sock.sendMessage(jid, { image: r.buffer, caption: argText }, { quoted: m });
    },
  },
  {
    name: 'sora',
    description: 'Generate an animation prompt (text)',
    handler: async ({ argText, reply }) => reply(await ai.chat(`Write a vivid 8-second cinematic video prompt for: ${argText}`)),
  },
  {
    name: 'aion',
    description: 'Turn AI auto-reply ON for this chat',
    handler: async ({ jid, reply }) => {
      if (!ai.isConfigured()) return reply('AI is not configured. Set OPENAI_API_KEY (or OPENROUTER_API_KEY) in your environment.');
      const s = store.get();
      s.aiOn[jid] = true;
      s.aiHistory[jid] = s.aiHistory[jid] || [];
      store.set({ aiOn: s.aiOn, aiHistory: s.aiHistory });
      reply('AI auto-reply is now *ON* for this chat. The bot will reply to your messages and remember context.');
    },
  },
  {
    name: 'aioff',
    description: 'Turn AI auto-reply OFF for this chat',
    handler: async ({ jid, reply, argText }) => {
      const s = store.get();
      s.aiOn[jid] = false;
      if (/clear|reset/i.test(argText)) s.aiHistory[jid] = [];
      store.set({ aiOn: s.aiOn, aiHistory: s.aiHistory });
      reply('AI auto-reply is now *OFF* for this chat.');
    },
  },
  {
    name: 'aiprovider', aliases: ['aistatus'],
    description: 'Show which AI provider the bot is currently using',
    handler: async ({ reply }) => {
      const p = ai.activeProvider();
      if (!p) {
        return reply(
          '🤖 *No AI provider configured.*\n\n' +
          '👉 Recommended FREE options (no credit card):\n' +
          '• Google Gemini — https://aistudio.google.com/app/apikey\n' +
          '   then set *GEMINI_API_KEY* in your environment\n' +
          '• Groq (fast Llama) — https://console.groq.com/keys\n' +
          '   then set *GROQ_API_KEY*'
        );
      }
      const labels = {
        gemini: 'Google Gemini (free)',
        groq: 'Groq Llama (free)',
        openrouter: 'OpenRouter',
        openai: 'OpenAI',
      };
      reply(`🤖 Active AI provider: *${labels[p] || p}*\n\nFallback chain order: GEMINI → GROQ → OPENROUTER → OPENAI`);
    },
  },
  {
    name: 'aionall',
    description: 'Turn AI auto-reply ON for ALL DMs (global)',
    owner: true,
    handler: async ({ reply }) => {
      if (!ai.isConfigured()) return reply('AI is not configured. Set OPENAI_API_KEY (or OPENROUTER_API_KEY) in your environment.');
      const s = store.get();
      // Wipe per-chat overrides so the global flag truly applies everywhere
      s.aiOn = {};
      store.set({ aiOn: s.aiOn, aiOnAll: true });
      reply('🤖 AI auto-reply is now *ON for ALL DMs*. The bot will reply to every direct chat with rolling memory.\n\nUse `.aioff` in any specific chat to silence it there, or `.aioffall` to disable globally.');
    },
  },
  {
    name: 'aioffall',
    description: 'Turn AI auto-reply OFF for ALL DMs (global)',
    owner: true,
    handler: async ({ reply, argText }) => {
      const s = store.get();
      s.aiOn = {};
      const patch = { aiOn: s.aiOn, aiOnAll: false };
      if (/clear|reset/i.test(argText)) patch.aiHistory = {};
      store.set(patch);
      reply(`🤖 AI auto-reply is now *OFF for ALL DMs*.${/clear|reset/i.test(argText) ? '\nAll conversation history cleared.' : ''}`);
    },
  },
];

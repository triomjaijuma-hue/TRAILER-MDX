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
];

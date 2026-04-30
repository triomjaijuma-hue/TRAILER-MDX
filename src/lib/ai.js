'use strict';
// Thin AI wrapper. Works with OpenAI, OpenRouter, or any OpenAI-compatible API.
const config = require('./config');
const store = require('./store');

const HISTORY_LIMIT = 20;

function client() {
  const { default: OpenAI } = require('openai');
  if (config.openrouterKey) {
    return new OpenAI({
      apiKey: config.openrouterKey,
      baseURL: 'https://openrouter.ai/api/v1',
    });
  }
  if (config.openaiKey) {
    return new OpenAI({ apiKey: config.openaiKey });
  }
  return null;
}

function defaultModel() {
  if (config.openrouterKey) return 'meta-llama/llama-3.1-8b-instruct';
  return 'gpt-4o-mini';
}

async function chat(prompt, opts = {}) {
  const c = client();
  if (!c) {
    return 'AI is not configured. Set OPENAI_API_KEY (or OPENROUTER_API_KEY) in your environment.';
  }
  const model = opts.model || defaultModel();
  const messages = [];
  if (opts.system) messages.push({ role: 'system', content: opts.system });
  if (Array.isArray(opts.history)) messages.push(...opts.history);
  messages.push({ role: 'user', content: prompt });
  try {
    const r = await c.chat.completions.create({ model, messages, temperature: 0.7 });
    return (r.choices?.[0]?.message?.content || '').trim() || '(empty response)';
  } catch (e) {
    return `AI error: ${e?.message || e}`;
  }
}

async function image(prompt) {
  const c = client();
  if (!c || !config.openaiKey) {
    return { error: 'Image generation needs OPENAI_API_KEY.' };
  }
  try {
    const r = await c.images.generate({
      model: 'gpt-image-1',
      prompt,
      size: '1024x1024',
      n: 1,
    });
    const b64 = r.data?.[0]?.b64_json;
    const url = r.data?.[0]?.url;
    if (b64) return { buffer: Buffer.from(b64, 'base64') };
    if (url) {
      const axios = require('axios');
      const res = await axios.get(url, { responseType: 'arraybuffer' });
      return { buffer: Buffer.from(res.data) };
    }
    return { error: 'No image returned.' };
  } catch (e) {
    return { error: `Image error: ${e?.message || e}` };
  }
}

async function autoReply(jid, prompt) {
  const s = store.get();
  s.aiHistory[jid] = s.aiHistory[jid] || [];
  const history = s.aiHistory[jid];
  const reply = await chat(prompt, {
    system: `You are ${config.botName}, a friendly WhatsApp assistant for the bot owner. Keep replies short (1-3 sentences) unless asked for detail.`,
    history,
  });
  history.push({ role: 'user', content: prompt });
  history.push({ role: 'assistant', content: reply });
  while (history.length > HISTORY_LIMIT) history.shift();
  store.set({ aiHistory: s.aiHistory });
  return reply;
}

module.exports = { chat, image, autoReply, isConfigured: () => !!client() };

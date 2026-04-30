'use strict';
// Multi-provider AI wrapper.
// Priority order (first configured wins): Gemini > Groq > OpenRouter > OpenAI.
// Gemini and Groq are 100% free with no credit card required — recommended.
const axios = require('axios');
const config = require('./config');
const store = require('./store');

const HISTORY_LIMIT = 20;

function activeProvider() {
  if (config.geminiKey) return 'gemini';
  if (config.groqKey) return 'groq';
  if (config.openrouterKey) return 'openrouter';
  if (config.openaiKey) return 'openai';
  return null;
}

function isConfigured() {
  return !!activeProvider();
}

// ---------- Gemini (Google AI Studio — FREE) ----------
async function geminiChat(messages, model) {
  const m = model || 'gemini-1.5-flash-latest';
  // Convert OpenAI-style messages to Gemini format
  let systemInstruction;
  const contents = [];
  for (const msg of messages) {
    if (msg.role === 'system') {
      systemInstruction = { role: 'user', parts: [{ text: msg.content }] };
    } else {
      contents.push({
        role: msg.role === 'assistant' ? 'model' : 'user',
        parts: [{ text: String(msg.content || '') }],
      });
    }
  }
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${m}:generateContent?key=${encodeURIComponent(config.geminiKey)}`;
  const body = { contents, generationConfig: { temperature: 0.7, maxOutputTokens: 1024 } };
  if (systemInstruction) body.systemInstruction = systemInstruction;
  const r = await axios.post(url, body, { timeout: 30000 });
  const text = r.data?.candidates?.[0]?.content?.parts?.map(p => p.text).join('') || '';
  return text.trim() || '(empty response)';
}

// ---------- Groq (FREE, OpenAI-compatible) ----------
async function openaiCompatibleChat(baseURL, apiKey, messages, model) {
  const r = await axios.post(
    `${baseURL}/chat/completions`,
    { model, messages, temperature: 0.7 },
    {
      timeout: 30000,
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
    }
  );
  return (r.data?.choices?.[0]?.message?.content || '').trim() || '(empty response)';
}

function modelFor(provider, requested) {
  if (requested) return requested;
  switch (provider) {
    case 'gemini':     return 'gemini-1.5-flash-latest';
    case 'groq':       return 'llama-3.1-8b-instant';
    case 'openrouter': return 'meta-llama/llama-3.1-8b-instruct:free';
    case 'openai':     return 'gpt-4o-mini';
    default:           return null;
  }
}

async function chat(prompt, opts = {}) {
  const provider = activeProvider();
  if (!provider) {
    return 'AI is not configured. Recommended: get a FREE Gemini key at https://aistudio.google.com/app/apikey and set GEMINI_API_KEY.';
  }
  const messages = [];
  if (opts.system) messages.push({ role: 'system', content: opts.system });
  if (Array.isArray(opts.history)) messages.push(...opts.history);
  messages.push({ role: 'user', content: prompt });

  const tryProviders = [provider];
  // Build a fallback chain: try the active provider, then the next configured ones in priority order.
  for (const p of ['gemini', 'groq', 'openrouter', 'openai']) {
    if (p === provider) continue;
    if (p === 'gemini' && config.geminiKey) tryProviders.push(p);
    if (p === 'groq' && config.groqKey) tryProviders.push(p);
    if (p === 'openrouter' && config.openrouterKey) tryProviders.push(p);
    if (p === 'openai' && config.openaiKey) tryProviders.push(p);
  }

  let lastErr;
  for (const p of tryProviders) {
    try {
      const m = modelFor(p, opts.model);
      if (p === 'gemini')     return await geminiChat(messages, m);
      if (p === 'groq')       return await openaiCompatibleChat('https://api.groq.com/openai/v1', config.groqKey, messages, m);
      if (p === 'openrouter') return await openaiCompatibleChat('https://openrouter.ai/api/v1', config.openrouterKey, messages, m);
      if (p === 'openai')     return await openaiCompatibleChat('https://api.openai.com/v1', config.openaiKey, messages, m);
    } catch (e) {
      lastErr = e;
      // Try next provider on rate-limit / quota / auth errors
      const status = e?.response?.status;
      if (status && ![401, 402, 403, 429, 500, 502, 503, 504].includes(status)) {
        return `AI error: ${e?.response?.data?.error?.message || e.message}`;
      }
    }
  }
  const msg = lastErr?.response?.data?.error?.message || lastErr?.message || 'unknown error';
  return `AI error (all providers failed): ${msg}\n\nGet a FREE Gemini key at https://aistudio.google.com/app/apikey and set GEMINI_API_KEY.`;
}

// ---------- Image generation ----------
async function image(prompt) {
  // Try free image providers first.
  // 1) Pollinations (no key, free): https://image.pollinations.ai/prompt/<encoded>
  try {
    const url = `https://image.pollinations.ai/prompt/${encodeURIComponent(prompt)}?nologo=true&width=1024&height=1024`;
    const res = await axios.get(url, { responseType: 'arraybuffer', timeout: 60000 });
    return { buffer: Buffer.from(res.data) };
  } catch (e) {
    // fall through to OpenAI if available
  }
  if (config.openaiKey) {
    try {
      const r = await axios.post(
        'https://api.openai.com/v1/images/generations',
        { model: 'gpt-image-1', prompt, size: '1024x1024', n: 1 },
        { timeout: 60000, headers: { Authorization: `Bearer ${config.openaiKey}` } }
      );
      const b64 = r.data?.data?.[0]?.b64_json;
      const url = r.data?.data?.[0]?.url;
      if (b64) return { buffer: Buffer.from(b64, 'base64') };
      if (url) {
        const res = await axios.get(url, { responseType: 'arraybuffer' });
        return { buffer: Buffer.from(res.data) };
      }
    } catch (e) {
      return { error: `Image error: ${e?.response?.data?.error?.message || e.message}` };
    }
  }
  return { error: 'Image generation failed. Pollinations free service may be down — try again in a moment.' };
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

module.exports = { chat, image, autoReply, isConfigured, activeProvider };

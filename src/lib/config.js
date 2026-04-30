'use strict';
require('dotenv').config();
const path = require('path');

const config = {
  ownerNumber: (process.env.OWNER_NUMBER || '256706106326').replace(/\D/g, ''),
  botNumber: (process.env.BOT_NUMBER || '256706106326').replace(/\D/g, ''),
  botName: process.env.BOT_NAME || 'TRAILER-MDX',
  version: '6.0.0',
  prefixes: ['.', '!', '/', '#'],
  port: parseInt(process.env.PORT || '3000', 10),
  mode: process.env.MODE || 'public',

  webUsername: process.env.WEB_USERNAME || '',
  webPassword: process.env.WEB_PASSWORD || '',

  // Order of preference for chat: Gemini > Groq > OpenRouter > OpenAI
  // Gemini and Groq are 100% free (no credit card). OpenRouter has free models too.
  geminiKey: process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY || '',
  groqKey: process.env.GROQ_API_KEY || '',
  openrouterKey: process.env.OPENROUTER_API_KEY || '',
  openaiKey: process.env.OPENAI_API_KEY || '',

  paths: {
    auth: path.resolve(__dirname, '..', '..', 'auth_info'),
    avatar: path.resolve(__dirname, '..', '..', 'assets', 'avatar.png'),
    tmp: path.resolve(__dirname, '..', '..', 'tmp'),
    plugins: path.resolve(__dirname, '..', 'commands'),
  },
};

module.exports = config;

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

  openaiKey: process.env.OPENAI_API_KEY || '',
  openrouterKey: process.env.OPENROUTER_API_KEY || '',

  paths: {
    auth: path.resolve(__dirname, '..', '..', 'auth_info'),
    avatar: path.resolve(__dirname, '..', '..', 'assets', 'avatar.png'),
    tmp: path.resolve(__dirname, '..', '..', 'tmp'),
    plugins: path.resolve(__dirname, '..', 'commands'),
  },
};

module.exports = config;

'use strict';
const fs = require('fs');
const path = require('path');
const axios = require('axios');
const config = require('./config');

function ensureTmp() {
  fs.mkdirSync(config.paths.tmp, { recursive: true });
  return config.paths.tmp;
}

async function downloadToBuffer(url, opts = {}) {
  const res = await axios.get(url, {
    responseType: 'arraybuffer',
    timeout: opts.timeout || 30000,
    headers: { 'User-Agent': 'Mozilla/5.0 TRAILER-MDX' },
  });
  return Buffer.from(res.data);
}

async function getJson(url, opts = {}) {
  const res = await axios.get(url, {
    timeout: opts.timeout || 20000,
    headers: { 'User-Agent': 'Mozilla/5.0 TRAILER-MDX', ...(opts.headers || {}) },
  });
  return res.data;
}

async function postJson(url, body, opts = {}) {
  const res = await axios.post(url, body, {
    timeout: opts.timeout || 30000,
    headers: { 'Content-Type': 'application/json', ...(opts.headers || {}) },
  });
  return res.data;
}

function formatUptime(s) {
  s = Math.floor(s);
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  return `${d}d ${h}h ${m}m ${sec}s`;
}

function formatBytes(b) {
  if (!b) return '0 B';
  const u = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(b) / Math.log(1024));
  return `${(b / Math.pow(1024, i)).toFixed(2)} ${u[i]}`;
}

function isOwner(jid) {
  if (!jid) return false;
  const num = jid.split('@')[0].replace(/\D/g, '');
  return num === config.ownerNumber;
}

function jidToNumber(jid) {
  if (!jid) return '';
  return jid.split('@')[0].replace(/\D/g, '');
}

module.exports = {
  ensureTmp,
  downloadToBuffer,
  getJson,
  postJson,
  formatUptime,
  formatBytes,
  isOwner,
  jidToNumber,
  sleep: (ms) => new Promise(r => setTimeout(r, ms)),
  pickRandom: (arr) => arr[Math.floor(Math.random() * arr.length)],
};

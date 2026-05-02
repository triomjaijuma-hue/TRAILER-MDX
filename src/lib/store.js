'use strict';
// Tiny in-memory + JSON-disk persistent state for runtime toggles.
const fs = require('fs');
const path = require('path');

const STORE_PATH = path.resolve(__dirname, '..', '..', 'auth_info', 'store.json');

const defaults = () => ({
  aiOn: {},          // { jid: true|false }
  aiOnAll: false,    // when true, AI auto-replies in every DM by default
  aiHistory: {},     // { jid: [{role, content}] }
  aiKeys: {},        // { gemini, groq, openrouter, openai } — set via .aikey at runtime
  autoreact: false,
  autoread: false,
  autotyping: false,
  autostatus: false,
  anticall: true,
  antidelete: true,
  antibadword: {},   // { groupJid: true|[words] }
  antilink: {},      // { groupJid: true }
  antispam: {},      // { groupJid: true }
  antitag: {},       // { groupJid: true }
  badwords: [],      // global list (lowercased)
  welcome: {},       // { groupJid: { enabled, text } }
  goodbye: {},       // { groupJid: { enabled, text } }
  groupSecurity: {}, // { groupJid: true } — alert owner on admin changes
  ytCookies: null,   // base64 YouTube cookies.txt — set via .ytcookies command
  notes: {},         // { jidOrGlobal: { name: text } }
  warns: {},         // { groupJid: { userJid: count } }
  replies: {},       // { keyword: response }
  rented: [],
  sudo: [],
  banned: [],
  pmblock: false,
  stealth: false,
  maintenance: false,
  cmdReact: true,
  scheduled: [],
});

let state = defaults();

function load() {
  try {
    if (fs.existsSync(STORE_PATH)) {
      const raw = JSON.parse(fs.readFileSync(STORE_PATH, 'utf8'));
      state = { ...defaults(), ...raw };
    }
  } catch (e) {
    state = defaults();
  }
  return state;
}

function save() {
  try {
    fs.mkdirSync(path.dirname(STORE_PATH), { recursive: true });
    fs.writeFileSync(STORE_PATH, JSON.stringify(state, null, 2));
  } catch (_) {}
}

function get() { return state; }

function set(partial) {
  state = { ...state, ...partial };
  save();
  return state;
}

load();
module.exports = { get, set, save, load };

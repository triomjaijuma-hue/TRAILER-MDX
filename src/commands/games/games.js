'use strict';
const helpers = require('../../lib/helpers');

const trivia = [
  { q: 'Capital of Uganda?', a: 'Kampala' },
  { q: 'Speed of light (km/s)?', a: '299792' },
  { q: 'Largest ocean?', a: 'Pacific' },
  { q: 'Smallest planet?', a: 'Mercury' },
  { q: 'Author of "1984"?', a: 'Orwell' },
];
const truths = ['What is your worst habit?', 'Last lie you told?', 'Biggest fear?'];
const dares = ['Send a 30s voice note singing.', 'Text your crush "hi" right now.', 'Push-ups: 10 — go.'];
const sessions = new Map(); // jid -> game state

module.exports = [
  { name: 'dado', aliases: ['dice'], description: 'Roll a dice', handler: async ({ reply }) => reply(`🎲 You rolled: ${1 + Math.floor(Math.random()*6)}`) },
  { name: 'dare', description: 'Random dare', handler: async ({ reply }) => reply(helpers.pickRandom(dares)) },
  { name: 'truth', description: 'Random truth', handler: async ({ reply }) => reply(helpers.pickRandom(truths)) },
  { name: 'trivia', description: 'Trivia question (reply to answer)', handler: async ({ jid, reply }) => {
    const t = helpers.pickRandom(trivia);
    sessions.set(`trivia:${jid}`, t.a.toLowerCase());
    reply(`🧠 ${t.q}\n(reply with your answer)`);
  } },
  { name: 'math', description: 'Math problem (reply to answer)', handler: async ({ jid, reply }) => {
    const a = 10 + Math.floor(Math.random()*90);
    const b = 10 + Math.floor(Math.random()*90);
    sessions.set(`math:${jid}`, String(a + b));
    reply(`🧮 ${a} + ${b} = ?`);
  } },
  { name: 'hangman', description: 'Start a hangman game', handler: async ({ reply }) => {
    const words = ['javascript','whatsapp','railway','baileys','sticker'];
    const w = helpers.pickRandom(words);
    reply(`Hangman: ${'_ '.repeat(w.length).trim()}\n(Word length: ${w.length})\n*Tip:* this is a simple stub — full game requires turn tracking.`);
  } },
  { name: 'tictactoe', description: 'Show a tic-tac-toe board', handler: async ({ reply }) => {
    reply('```\n . | . | . \n---+---+---\n . | . | . \n---+---+---\n . | . | . \n```\n(Single-player demo; integrate session for full play.)');
  } },
];

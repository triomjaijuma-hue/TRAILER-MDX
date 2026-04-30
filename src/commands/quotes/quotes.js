'use strict';
const helpers = require('../../lib/helpers');

const FALLBACK_QUOTES = [
  ['The best way out is always through.', 'Robert Frost'],
  ['Whatever you do, do it well.', 'Walt Disney'],
  ['Life is what happens when you’re busy making other plans.', 'John Lennon'],
  ['What you do speaks so loudly that I cannot hear what you say.', 'Ralph Waldo Emerson'],
  ['Do what you can, with what you have, where you are.', 'Theodore Roosevelt'],
  ['It always seems impossible until it’s done.', 'Nelson Mandela'],
  ['He who has a why to live can bear almost any how.', 'Friedrich Nietzsche'],
];

const FALLBACK_PROG_QUOTES = [
  ['Programs must be written for people to read, and only incidentally for machines to execute.', 'Harold Abelson'],
  ['First, solve the problem. Then, write the code.', 'John Johnson'],
  ['Talk is cheap. Show me the code.', 'Linus Torvalds'],
  ['Any fool can write code that a computer can understand. Good programmers write code that humans can understand.', 'Martin Fowler'],
  ['Premature optimization is the root of all evil.', 'Donald Knuth'],
];

async function tryQuoteApis() {
  // Strategy 1: zenquotes (no key, allows server-to-server)
  try {
    const d = await helpers.getJson('https://zenquotes.io/api/random');
    const q = d?.[0];
    if (q?.q) return { content: q.q, author: q.a };
  } catch (_) {}
  // Strategy 2: dummyjson quotes (very reliable)
  try {
    const d = await helpers.getJson('https://dummyjson.com/quotes/random');
    if (d?.quote) return { content: d.quote, author: d.author };
  } catch (_) {}
  // Strategy 3: api.quotable.io (frequently down, kept last)
  try {
    const d = await helpers.getJson('https://api.quotable.io/random');
    if (d?.content) return { content: d.content, author: d.author };
  } catch (_) {}
  return null;
}

module.exports = [
  { name: 'quote', description: 'Random quote', handler: async ({ reply }) => {
    const q = await tryQuoteApis();
    if (q) return reply(`"${q.content}"\n— ${q.author}`);
    const [c, a] = helpers.pickRandom(FALLBACK_QUOTES);
    reply(`"${c}"\n— ${a}`);
  } },
  { name: 'quote2', description: 'Programming quote', handler: async ({ reply }) => {
    try {
      const d = await helpers.getJson('https://programming-quotes-api.azurewebsites.net/api/quotes/random');
      if (d?.en) return reply(`"${d.en}"\n— ${d.author}`);
    } catch (_) {}
    try {
      const d = await helpers.getJson('https://api.kanye.rest/');
      if (d?.quote) return reply(`"${d.quote}"\n— Kanye West`);
    } catch (_) {}
    const [c, a] = helpers.pickRandom(FALLBACK_PROG_QUOTES);
    reply(`"${c}"\n— ${a}`);
  } },
  { name: 'goodnight', description: 'Goodnight wish', handler: async ({ reply }) => reply('🌙 Goodnight — sleep well and dream big.') },
  { name: 'roseday', description: 'Rose for someone', handler: async ({ reply, argText }) => reply(`🌹 For ${argText || 'you'} — happy rose day!`) },
  { name: 'shayari', description: 'Random shayari', handler: async ({ reply }) => reply(helpers.pickRandom([
    'Zindagi ek safar hai suhana, yahan kal kya ho kisne jaana.',
    'Mohabbat ek ehsaas hai jo dil se nikalti hai.',
    'Hum apne saaye se hi mohabbat karne lage hain, lagta hai aap ki kami zyada mehsoos hone lagi hai.',
    'Tumhe paane ki khwahish thi, paa lete to kya kehte.',
    'Khamoshiyan bhi ab kuch kehne lagi hain, shayad teri yaad aane lagi hai.',
  ])) },
  { name: 'wyr', description: 'Would you rather', handler: async ({ reply }) => reply(helpers.pickRandom([
    'Would you rather: speak every language, or play every instrument?',
    'Would you rather: have unlimited time, or unlimited money?',
    'Would you rather: read minds, or be invisible?',
    'Would you rather: live without music or without movies?',
    'Would you rather: always be 10 minutes late, or always 20 minutes early?',
  ])) },
];

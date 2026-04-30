'use strict';
const helpers = require('../../lib/helpers');

module.exports = [
  { name: 'quote', description: 'Random quote', handler: async ({ reply }) => {
    try { const d = await helpers.getJson('https://api.quotable.io/random'); reply(`"${d.content}"\n— ${d.author}`); }
    catch { reply('"The best way out is always through." — Robert Frost'); }
  } },
  { name: 'quote2', description: 'Programming quote', handler: async ({ reply }) => {
    try { const d = await helpers.getJson('https://programming-quotesapi.vercel.app/api/random'); reply(`"${d.quote}"\n— ${d.author}`); }
    catch { reply('"Programs must be written for people to read." — H. Abelson'); }
  } },
  { name: 'goodnight', description: 'Goodnight wish', handler: async ({ reply }) => reply('🌙 Goodnight — sleep well and dream big.') },
  { name: 'roseday', description: 'Rose for someone', handler: async ({ reply, argText }) => reply(`🌹 For ${argText || 'you'} — happy rose day!`) },
  { name: 'shayari', description: 'Random shayari', handler: async ({ reply }) => reply(helpers.pickRandom([
    'Zindagi ek safar hai suhana, yahan kal kya ho kisne jaana.',
    'Mohabbat ek ehsaas hai jo dil se nikalti hai.',
    'Hum apne saaye se hi mohabbat karne lage hain, lagta hai aap ki kami zyada mehsoos hone lagi hai.',
  ])) },
  { name: 'wyr', description: 'Would you rather', handler: async ({ reply }) => reply(helpers.pickRandom([
    'Would you rather: speak every language, or play every instrument?',
    'Would you rather: have unlimited time, or unlimited money?',
    'Would you rather: read minds, or be invisible?',
  ])) },
];

'use strict';
const helpers = require('../../lib/helpers');

module.exports = [
  { name: 'wiki', description: 'Wikipedia summary', handler: async ({ argText, reply }) => {
    if (!argText) return reply('Usage: .wiki <topic>');
    try {
      const d = await helpers.getJson(`https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(argText)}`);
      reply(`*${d.title}*\n\n${d.extract || '(no summary)'}\n\n${d.content_urls?.desktop?.page || ''}`);
    } catch (e) { reply(`Failed: ${e?.message}`); }
  } },
  { name: 'define', description: 'Word definition', handler: async ({ argText, reply }) => {
    if (!argText) return reply('Usage: .define <word>');
    try {
      const d = await helpers.getJson(`https://api.dictionaryapi.dev/api/v2/entries/en/${encodeURIComponent(argText)}`);
      const e = d?.[0];
      const def = e?.meanings?.[0]?.definitions?.[0]?.definition;
      reply(`*${e?.word || argText}* — ${e?.phonetic || ''}\n${def || '(no definition)'}`);
    } catch (e) { reply(`Failed: ${e?.message}`); }
  } },
  { name: 'element', description: 'Periodic table element', handler: async ({ argText, reply }) => {
    if (!argText) return reply('Usage: .element <symbol or name>');
    try {
      const list = await helpers.getJson('https://raw.githubusercontent.com/Bowserinator/Periodic-Table-JSON/master/PeriodicTableJSON.json');
      const q = argText.toLowerCase();
      const e = list.elements.find(x => x.symbol.toLowerCase() === q || x.name.toLowerCase() === q);
      if (!e) return reply('Not found.');
      reply(`*${e.name}* (${e.symbol}) #${e.number}\nMass: ${e.atomic_mass}\nCategory: ${e.category}\n${e.summary}`);
    } catch (e) { reply(`Failed: ${e?.message}`); }
  } },
  { name: 'whoisip', description: 'IP info', handler: async ({ argText, reply }) => {
    if (!argText) return reply('Usage: .whoisip <ip or domain>');
    try {
      const d = await helpers.getJson(`https://ipwho.is/${encodeURIComponent(argText)}`);
      reply(JSON.stringify(d, null, 2).slice(0, 1500));
    } catch (e) { reply(`Failed: ${e?.message}`); }
  } },
  { name: 'wattpad', description: 'Search wattpad', handler: async ({ argText, reply }) => reply(`https://www.wattpad.com/search/${encodeURIComponent(argText)}`) },
];

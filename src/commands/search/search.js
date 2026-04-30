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
  { name: 'define', aliases: ['dict', 'meaning'], description: 'Word definition', handler: async ({ argText, reply }) => {
    if (!argText) return reply('Usage: .define <word>');
    const word = argText.trim().split(/\s+/)[0].toLowerCase();
    // Strategy 1: dictionaryapi.dev
    try {
      const d = await helpers.getJson(`https://api.dictionaryapi.dev/api/v2/entries/en/${encodeURIComponent(word)}`);
      const e = d?.[0];
      if (e?.meanings?.length) {
        const lines = [`📖 *${e.word}*${e.phonetic ? `  _${e.phonetic}_` : ''}`];
        e.meanings.slice(0, 3).forEach(m => {
          lines.push(`\n*(${m.partOfSpeech})*`);
          m.definitions.slice(0, 2).forEach((def, i) => {
            lines.push(`${i + 1}. ${def.definition}`);
            if (def.example) lines.push(`   _e.g. "${def.example}"_`);
          });
        });
        return reply(lines.join('\n'));
      }
    } catch (_) {}
    // Strategy 2: Free Dictionary fallback via Wiktionary REST
    try {
      const wk = await helpers.getJson(`https://en.wiktionary.org/api/rest_v1/page/definition/${encodeURIComponent(word)}`);
      const en = wk?.en?.[0];
      if (en?.definitions?.length) {
        const txt = en.definitions.slice(0, 3).map((x, i) => `${i + 1}. ${x.definition.replace(/<[^>]+>/g, '')}`).join('\n');
        return reply(`📖 *${word}* _(${en.partOfSpeech || 'word'})_\n${txt}`);
      }
    } catch (_) {}
    reply(`📖 No definition found for *${word}*. Check spelling and try again.`);
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

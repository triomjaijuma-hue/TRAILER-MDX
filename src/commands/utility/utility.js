'use strict';
const helpers = require('../../lib/helpers');
const store = require('../../lib/store');

function safeEval(expr) {
  if (/[^0-9+\-*/.()%\s]/.test(expr)) throw new Error('Only numeric expressions allowed.');
  // eslint-disable-next-line no-new-func
  return Function(`'use strict'; return (${expr});`)();
}

module.exports = [
  { name: 'calc', description: 'Calculator', handler: async ({ argText, reply }) => {
    if (!argText) return reply('Usage: .calc 2+2*3');
    try { reply(`= ${safeEval(argText)}`); } catch (e) { reply(`Error: ${e?.message}`); }
  } },
  { name: 'cipher', description: 'Caesar shift: .cipher <n> <text>', handler: async ({ argText, reply }) => {
    const m = argText.match(/^(-?\d+)\s+(.+)/);
    if (!m) return reply('Usage: .cipher 3 hello');
    const n = parseInt(m[1], 10);
    reply([...m[2]].map(c => {
      const code = c.charCodeAt(0);
      if (code >= 65 && code <= 90) return String.fromCharCode(((code - 65 + n) % 26 + 26) % 26 + 65);
      if (code >= 97 && code <= 122) return String.fromCharCode(((code - 97 + n) % 26 + 26) % 26 + 97);
      return c;
    }).join(''));
  } },
  { name: 'crun', description: '(stub) Run JS — disabled for safety', handler: async ({ reply }) => reply('Disabled for safety.') },
  { name: 'distance', description: 'distance city1 | city2 (great-circle, free Open-Meteo geocode)', handler: async ({ argText, reply }) => {
    const [a, b] = argText.split('|').map(s => s.trim());
    if (!a || !b) return reply('Usage: .distance Kampala | Nairobi');
    try {
      const g = async (q) => (await helpers.getJson(`https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(q)}&count=1`)).results?.[0];
      const [A, B] = await Promise.all([g(a), g(b)]);
      if (!A || !B) return reply('Could not locate one of the places.');
      const R = 6371;
      const toRad = d => d * Math.PI / 180;
      const dLat = toRad(B.latitude - A.latitude);
      const dLon = toRad(B.longitude - A.longitude);
      const v = Math.sin(dLat/2)**2 + Math.cos(toRad(A.latitude))*Math.cos(toRad(B.latitude))*Math.sin(dLon/2)**2;
      const km = 2*R*Math.asin(Math.sqrt(v));
      reply(`*${A.name}* → *${B.name}*: ${km.toFixed(1)} km (${(km*0.621371).toFixed(1)} mi)`);
    } catch (e) { reply(`Failed: ${e?.message}`); }
  } },
  { name: 'dna', description: 'DNA → mRNA', handler: async ({ argText, reply }) => {
    if (!argText) return reply('Usage: .dna ATGCGT');
    reply(argText.toUpperCase().replace(/T/g, 'U').replace(/[^AUCG]/g, ''));
  } },
  { name: 'rle', description: 'Run-length encode', handler: async ({ argText, reply }) => {
    let out = '', i = 0;
    while (i < argText.length) { let j = i; while (j < argText.length && argText[j] === argText[i]) j++; out += (j-i) + argText[i]; i = j; }
    reply(out || '(empty)');
  } },
  { name: 'schedule', description: 'Schedule a message: .schedule 30s | hello world', handler: async ({ jid, sock, argText, reply }) => {
    const m = argText.match(/^(\d+)\s*(s|m|h)\s*\|\s*(.+)/i);
    if (!m) return reply('Usage: .schedule 30s | message');
    const ms = parseInt(m[1], 10) * (m[2].toLowerCase() === 's' ? 1000 : m[2].toLowerCase() === 'm' ? 60000 : 3600000);
    const at = Date.now() + ms;
    const id = Math.random().toString(36).slice(2, 8);
    const s = store.get(); s.scheduled.push({ id, jid, at, text: m[3] }); store.set({ scheduled: s.scheduled });
    setTimeout(() => sock.sendMessage(jid, { text: `⏰ Scheduled: ${m[3]}` }).catch(() => {}), ms);
    reply(`Scheduled #${id} in ${m[1]}${m[2]}.`);
  } },
  { name: 'schedulelist', description: 'List scheduled messages', handler: async ({ reply }) => {
    const s = store.get();
    const upcoming = s.scheduled.filter(x => x.at > Date.now());
    reply(upcoming.length ? upcoming.map(x => `• #${x.id} in ${Math.round((x.at-Date.now())/1000)}s — ${x.text}`).join('\n') : 'No scheduled messages.');
  } },
  { name: 'schedulecancel', description: 'Cancel a scheduled message by id', handler: async ({ argText, reply }) => {
    const s = store.get();
    const before = s.scheduled.length;
    s.scheduled = s.scheduled.filter(x => x.id !== argText.trim());
    store.set({ scheduled: s.scheduled });
    reply(before === s.scheduled.length ? 'Not found.' : 'Cancelled.');
  } },
  { name: 'siminfo', description: 'Country lookup by phone prefix', handler: async ({ argText, reply }) => {
    const num = argText.replace(/\D/g, '');
    if (!num) return reply('Usage: .siminfo <number>');
    const map = { '256': 'Uganda', '254': 'Kenya', '255': 'Tanzania', '1': 'USA/Canada', '44': 'UK', '91': 'India', '234': 'Nigeria', '27': 'South Africa', '233': 'Ghana' };
    const hits = Object.keys(map).filter(k => num.startsWith(k));
    reply(hits.length ? `+${hits[0]} → ${map[hits[0]]}` : 'Unknown prefix.');
  } },
  { name: 'speedtest', description: 'Network info (best-effort)', handler: async ({ reply }) => {
    try {
      const t = Date.now();
      await helpers.getJson('https://www.cloudflare.com/cdn-cgi/trace');
      reply(`Edge round-trip: ~${Date.now()-t}ms (Cloudflare)`);
    } catch (e) { reply(`Failed: ${e?.message}`); }
  } },
  { name: 'sudoku', description: 'Generate an easy sudoku', handler: async ({ reply }) => {
    const sample = `5 3 . | . 7 . | . . .\n6 . . | 1 9 5 | . . .\n. 9 8 | . . . | . 6 .\n------+-------+------\n8 . . | . 6 . | . . 3\n4 . . | 8 . 3 | . . 1\n7 . . | . 2 . | . . 6\n------+-------+------\n. 6 . | . . . | 2 8 .\n. . . | 4 1 9 | . . 5\n. . . | . 8 . | . 7 9`;
    reply('```\n' + sample + '\n```');
  } },
  { name: 'units', description: 'Convert units: .units 10 km miles', handler: async ({ argText, reply }) => {
    const m = argText.match(/^([\d.]+)\s+(\w+)\s+(\w+)/);
    if (!m) return reply('Usage: .units 10 km miles');
    const [_, n, from, to] = m;
    const v = parseFloat(n);
    const map = {
      'km|miles': v * 0.621371,
      'miles|km': v / 0.621371,
      'kg|lb': v * 2.20462,
      'lb|kg': v / 2.20462,
      'c|f': v * 9/5 + 32,
      'f|c': (v - 32) * 5/9,
      'usd|eur': v * 0.92,
      'eur|usd': v / 0.92,
    };
    const k = `${from.toLowerCase()}|${to.toLowerCase()}`;
    reply(map[k] != null ? `${v} ${from} = ${map[k].toFixed(4)} ${to}` : 'Unknown unit pair.');
  } },
  { name: 'analyze', description: 'Quick text stats', handler: async ({ argText, reply }) => {
    if (!argText) return reply('Usage: .analyze <text>');
    const words = argText.split(/\s+/).filter(Boolean);
    const sents = argText.split(/[.!?]+/).filter(Boolean);
    reply(`Chars: ${argText.length}\nWords: ${words.length}\nSentences: ${sents.length}\nAvg word: ${(argText.replace(/\s/g,'').length/words.length).toFixed(1)}`);
  } },
  { name: 'wordcloud', description: 'Top frequent words', handler: async ({ argText, reply }) => {
    const map = {};
    for (const w of (argText.toLowerCase().match(/[a-z']+/g) || [])) map[w] = (map[w]||0)+1;
    const top = Object.entries(map).sort((a,b)=>b[1]-a[1]).slice(0, 15);
    reply(top.length ? top.map(([w,n]) => `${w}: ${n}`).join('\n') : 'No words.');
  } },
];

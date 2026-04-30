'use strict';
const helpers = require('../../lib/helpers');
const config = require('../../lib/config');

module.exports = [
  { name: 'owner', description: 'Bot owner contact', handler: async ({ sock, jid, m }) => {
    const num = config.ownerNumber;
    const vcard = `BEGIN:VCARD\nVERSION:3.0\nFN:TRAILER-MDX Owner\nORG:TRAILER-MDX;\nTEL;type=CELL;type=VOICE;waid=${num}:+${num}\nEND:VCARD`;
    await sock.sendMessage(jid, { contacts: { displayName: 'TRAILER-MDX Owner', contacts: [{ vcard }] } }, { quoted: m });
  } },
  { name: 'script', description: 'Project / script info', handler: async ({ reply }) => reply(`*${config.botName}* v${config.version}\nNode runtime · Baileys-based · Multi-prefix\nDeploy: Railway / Docker / Procfile included.`) },
  { name: 'imdb', description: 'IMDB search URL', handler: async ({ argText, reply }) => reply(`https://www.imdb.com/find?q=${encodeURIComponent(argText)}`) },
  { name: 'movie', description: 'Movie info (OMDB without key → search link)', handler: async ({ argText, reply }) => reply(`https://www.themoviedb.org/search?query=${encodeURIComponent(argText)}`) },
  { name: 'itunes', description: 'iTunes search', handler: async ({ argText, reply }) => {
    try {
      const d = await helpers.getJson(`https://itunes.apple.com/search?term=${encodeURIComponent(argText)}&limit=5`);
      reply((d.results || []).map(r => `• ${r.trackName} — ${r.artistName}\n  ${r.trackViewUrl}`).join('\n\n') || 'No results.');
    } catch (e) { reply(`Failed: ${e?.message}`); }
  } },
  { name: 'medicine', description: 'Drug info (openFDA)', handler: async ({ argText, reply }) => {
    try {
      const d = await helpers.getJson(`https://api.fda.gov/drug/label.json?search=openfda.brand_name:%22${encodeURIComponent(argText)}%22&limit=1`);
      const r = d.results?.[0];
      if (!r) return reply('Not found.');
      reply(`*${r.openfda?.brand_name?.[0] || argText}*\nPurpose: ${r.purpose?.[0] || '?'}\nUsage: ${(r.indications_and_usage?.[0] || '').slice(0, 600)}…`);
    } catch (e) { reply(`Failed: ${e?.message}`); }
  } },
  { name: 'momo', description: 'Mobile money disclaimer', handler: async ({ reply }) => reply('No mobile-money integration is enabled by default. Hook up a provider via env vars.') },
  { name: 'pokedex', description: 'Pokemon info', handler: async ({ argText, reply }) => {
    if (!argText) return reply('Usage: .pokedex <name>');
    try {
      const d = await helpers.getJson(`https://pokeapi.co/api/v2/pokemon/${encodeURIComponent(argText.toLowerCase())}`);
      reply(`*${d.name}* #${d.id}\nTypes: ${d.types.map(t=>t.type.name).join(', ')}\nHeight: ${d.height/10}m · Weight: ${d.weight/10}kg`);
    } catch { reply('Not found.'); }
  } },
  { name: 'quran', description: 'Quran ayah lookup: .quran 2:255', handler: async ({ argText, reply }) => {
    const m = argText.match(/(\d+):(\d+)/);
    if (!m) return reply('Usage: .quran 2:255');
    try {
      const d = await helpers.getJson(`https://api.alquran.cloud/v1/ayah/${m[1]}:${m[2]}/en.asad`);
      reply(`*${d.data.surah.englishName} ${m[1]}:${m[2]}*\n${d.data.text}`);
    } catch (e) { reply(`Failed: ${e?.message}`); }
  } },
  { name: 'shazam', description: '(stub) Identify song from audio', handler: async ({ reply }) => reply('Audio fingerprinting requires an external API key (e.g., AudD).') },
  { name: 'string', description: 'Bot session info', handler: async ({ reply }) => {
    const bot = require('../../bot');
    reply(`Connected: ${bot.isConnected()}\nSession: ${bot.hasSession() ? 'yes' : 'no'}\nUse the web pairing page if needed.`);
  } },
  { name: 'trends', description: 'Google Trends — top searches', handler: async ({ argText, reply }) => {
    if (!argText || !argText.trim()) {
      // Show top daily trends from Google Trends RSS
      try {
        const helpersLib = require('../../lib/helpers');
        const xml = await helpersLib.getText('https://trends.google.com/trends/trendingsearches/daily/rss?geo=US');
        const titles = [...xml.matchAll(/<title>([^<]+)<\/title>/g)].slice(1, 11).map(m => m[1]);
        if (titles.length) return reply(`📈 *Top Trending Now (US)*\n\n${titles.map((t, i) => `${i + 1}. ${t}`).join('\n')}\n\n_Tip: \`.trends <topic>\` for a specific search._`);
      } catch (_) {}
      return reply('📈 Trends: https://trends.google.com/trends/trendingsearches/daily\n\n_Usage: \`.trends <topic>\`_');
    }
    reply(`📈 https://trends.google.com/trends/explore?q=${encodeURIComponent(argText.trim())}`);
  } },
  { name: 'weather', description: 'Weather (Open-Meteo)', handler: async ({ argText, reply }) => {
    if (!argText) return reply('Usage: .weather <city>');
    try {
      const g = await helpers.getJson(`https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(argText)}&count=1`);
      const p = g.results?.[0]; if (!p) return reply('City not found.');
      const w = await helpers.getJson(`https://api.open-meteo.com/v1/forecast?latitude=${p.latitude}&longitude=${p.longitude}&current=temperature_2m,wind_speed_10m,relative_humidity_2m,weather_code`);
      const c = w.current;
      reply(`*${p.name}, ${p.country}*\nTemp: ${c.temperature_2m}°C\nHumidity: ${c.relative_humidity_2m}%\nWind: ${c.wind_speed_10m} km/h`);
    } catch (e) { reply(`Failed: ${e?.message}`); }
  } },
  { name: 'whois', description: 'WHOIS-style domain info (rdap)', handler: async ({ argText, reply }) => {
    if (!argText) return reply('Usage: .whois <domain>');
    try {
      const d = await helpers.getJson(`https://rdap.org/domain/${encodeURIComponent(argText)}`);
      reply(`*${argText}*\nStatus: ${(d.status || []).join(', ')}\nRegistrar: ${(d.entities?.[0]?.vcardArray?.[1]?.find(x=>x[0]==='fn')?.[3]) || '?'}\nNS: ${(d.nameservers || []).map(n=>n.ldhName).join(', ').slice(0, 300)}`);
    } catch (e) { reply(`Failed: ${e?.message}`); }
  } },
  { name: 'news', description: 'Top headlines (Google News RSS link)', handler: async ({ argText, reply }) => reply(`https://news.google.com/search?q=${encodeURIComponent(argText || 'world')}`) },
];

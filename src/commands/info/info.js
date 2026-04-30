'use strict';
const helpers = require('../../lib/helpers');
const config = require('../../lib/config');

// Small helper: try a JSON request and treat 404/empty as "not found"
// instead of bubbling up as a generic "Failed: status code 404" message.
async function safeGetJson(url, opts = {}) {
  try {
    return { ok: true, data: await helpers.getJson(url, opts) };
  } catch (e) {
    const status = e?.response?.status;
    if (status === 404) return { ok: false, notFound: true };
    return { ok: false, error: e?.message || String(e) };
  }
}

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

  // .medicine — openFDA returns 404 when there is no match, which the old
  // code surfaced as "Failed: Request failed with status code 404". We now
  // treat 404 as "not found" and fall back from brand_name -> generic_name
  // so common generics (paracetamol, ibuprofen, ...) actually resolve.
  { name: 'medicine', description: 'Drug info (openFDA)', handler: async ({ argText, reply }) => {
    const q = (argText || '').trim();
    if (!q) return reply('Usage: .medicine <drug name>');
    const enc = encodeURIComponent(`"${q}"`);
    let r = await safeGetJson(`https://api.fda.gov/drug/label.json?search=openfda.brand_name:${enc}&limit=1`);
    if (r.ok && !r.data?.results?.length) r = { ok: false, notFound: true };
    if (!r.ok && (r.notFound || r.error)) {
      const r2 = await safeGetJson(`https://api.fda.gov/drug/label.json?search=openfda.generic_name:${enc}&limit=1`);
      if (r2.ok && r2.data?.results?.length) r = r2;
    }
    if (!r.ok || !r.data?.results?.length) {
      return reply(`💊 No drug info found for *${q}*. Try a different spelling or a generic name (e.g. ibuprofen).`);
    }
    const d = r.data.results[0];
    const brand = d.openfda?.brand_name?.[0] || d.openfda?.generic_name?.[0] || q;
    const purpose = (d.purpose?.[0] || d.indications_and_usage?.[0] || '').trim();
    const usage   = (d.indications_and_usage?.[0] || '').trim();
    const warn    = (d.warnings?.[0] || d.warnings_and_cautions?.[0] || '').trim();
    const trim = (s, n) => s ? (s.length > n ? s.slice(0, n) + '…' : s) : '_(none provided)_';
    reply(
      `💊 *${brand}*\n\n` +
      `*Purpose:* ${trim(purpose, 400)}\n\n` +
      `*Usage:* ${trim(usage, 600)}\n\n` +
      `*Warnings:* ${trim(warn, 500)}\n\n` +
      `_Source: openFDA — informational only, not medical advice._`
    );
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
      try {
        const xml = await helpers.getText('https://trends.google.com/trends/trendingsearches/daily/rss?geo=US');
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

  // .news — fetches top headlines (Google News RSS, with BBC fallback).
  // Sends actual headline + source + snippet, not just a search URL.
  { name: 'news', description: 'Top headlines (Google News)', handler: async ({ argText, reply }) => {
    const q = (argText || '').trim();
    const NEWS_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

    const stripHtml = (s) => (s || '')
      .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
      .replace(/<[^>]+>/g, '')
      .replace(/&nbsp;/g, ' ')
      .replace(/&amp;/g, '&')
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/\s+/g, ' ')
      .trim();

    const parseRss = (xml) => {
      const items = [...xml.matchAll(/<item\b[^>]*>([\s\S]*?)<\/item>/g)].slice(0, 8);
      return items.map(([, body]) => {
        const pick = (tag) => {
          // Match <tag> OR <tag attr="...">
          const m = body.match(new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)<\\/${tag}>`));
          if (!m) return '';
          return stripHtml(m[1]);
        };
        return {
          title: pick('title'),
          link: pick('link'),
          source: pick('source'),
          description: pick('description'),
          pubDate: pick('pubDate'),
        };
      }).filter(it => it.title && it.link);
    };

    const sources = q
      ? [`https://news.google.com/rss/search?q=${encodeURIComponent(q)}&hl=en-US&gl=US&ceid=US:en`]
      : [
          `https://news.google.com/rss?hl=en-US&gl=US&ceid=US:en`,
          `https://feeds.bbci.co.uk/news/world/rss.xml`,
        ];

    let parsed = [];
    let lastErr = '';
    for (const url of sources) {
      try {
        const xml = await helpers.getText(url, {
          timeout: 15000,
          headers: { 'User-Agent': NEWS_UA, Accept: 'application/rss+xml, application/xml, text/xml, */*' },
        });
        parsed = parseRss(xml);
        if (parsed.length) break;
        lastErr = 'no items in feed';
      } catch (e) {
        lastErr = e?.message || 'fetch failed';
      }
    }

    if (!parsed.length) {
      return reply(`📰 News feed unreachable (${lastErr}). Search link:\nhttps://news.google.com/search?q=${encodeURIComponent(q || 'world')}`);
    }

    const heading = q ? `📰 *Top News: ${q}*` : '📰 *Top Headlines*';
    const lines = parsed.map((it, i) => {
      const snippet = it.description && it.description !== it.title
        ? `\n   ${it.description.slice(0, 180)}${it.description.length > 180 ? '…' : ''}`
        : '';
      const src = it.source ? `\n   _${it.source}_` : '';
      return `${i + 1}. *${it.title}*${src}${snippet}\n   ${it.link}`;
    });
    reply([heading, '', ...lines].join('\n\n').slice(0, 4000));
  } },
];

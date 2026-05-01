'use strict';
const yts     = require('yt-search');
const ytdl    = require('@distube/ytdl-core');
const https   = require('https');
const { execFile } = require('child_process');
const fs      = require('fs');
const path    = require('path');
const helpers = require('../../lib/helpers');
const config  = require('../../lib/config');

// ---------------------------------------------------------------------------
// YouTube search helpers
// ---------------------------------------------------------------------------
async function ytSearch(q) {
  try {
    const r = await yts(q);
    if (r?.videos?.length) return r;
  } catch (_) {}
  // Scrape fallback
  try {
    const r = await ytScrape(q);
    if (r?.videos?.length) return r;
  } catch (_) {}
  return { videos: [] };
}

function httpsGet(url, maxRedir) {
  maxRedir = maxRedir == null ? 8 : maxRedir;
  return new Promise((resolve, reject) => {
    const p = new URL(url);
    https.get(
      { hostname: p.hostname, path: p.pathname + p.search, headers: { 'User-Agent': 'Mozilla/5.0' } },
      res => {
        if ([301, 302, 307, 308].includes(res.statusCode) && res.headers.location) {
          return maxRedir > 0
            ? resolve(httpsGet(res.headers.location, maxRedir - 1))
            : reject(new Error('too many redirects'));
        }
        const c = [];
        res.on('data', d => c.push(d));
        res.on('end', () => resolve({ status: res.statusCode, body: Buffer.concat(c) }));
      }
    ).on('error', reject);
  });
}

async function ytScrape(q) {
  const r = await httpsGet(
    `https://www.youtube.com/results?search_query=${encodeURIComponent(q)}`
  );
  const m = r.body.toString().match(/var ytInitialData = (\{[\s\S]+?\});\s*<\/script>/);
  if (!m) return { videos: [] };
  const data = JSON.parse(m[1]);
  const out = [];
  for (const sec of (data?.contents?.twoColumnSearchResultsRenderer?.primaryContents
    ?.sectionListRenderer?.contents || [])) {
    for (const it of (sec?.itemSectionRenderer?.contents || [])) {
      const v = it?.videoRenderer;
      if (!v?.videoId) continue;
      const lt = v.lengthText?.simpleText || '';
      const secs = lt.split(':').map(Number).reduce((a, b) => a * 60 + b, 0);
      out.push({
        title: v.title?.runs?.[0]?.text || '',
        videoId: v.videoId,
        url: `https://www.youtube.com/watch?v=${v.videoId}`,
        author: { name: v.ownerText?.runs?.[0]?.text || '' },
        duration: { seconds: secs, timestamp: lt },
        timestamp: lt,
        views: Number((v.viewCountText?.simpleText || '0').replace(/\D/g, '')) || 0,
      });
      if (out.length >= 20) break;
    }
    if (out.length >= 20) break;
  }
  return { videos: out };
}

function pickBest(vids, q) {
  const tokens = q.toLowerCase().split(/\s+/).filter(Boolean);
  const score = v => {
    const t = (v.title || '').toLowerCase();
    const a = (v.author?.name || '').toLowerCase();
    let s = 0;
    tokens.forEach(k => {
      if (t.includes(k)) s += 3;
      if (a.includes(k)) s += 2;
    });
    if (/official\s+(audio|video|music)/i.test(v.title)) s += 3;
    if (/\btopic\b|vevo/i.test(v.author?.name || ''))    s += 3;
    if (/reaction|tutorial|cover|sped.up|nightcore|slowed/i.test(v.title)) s -= 3;
    const sec = v.duration?.seconds || 0;
    if (sec >= 45 && sec <= 720) s += 1;
    else if (sec > 720)          s -= 2;
    s += Math.min(3, Math.log10((v.views || 1) + 1) / 2);
    return s;
  };
  return vids.slice(0, 15).map(v => ({ v, s: score(v) })).sort((a, b) => b.s - a.s)[0]?.v || vids[0];
}

// ---------------------------------------------------------------------------
// Audio download — Strategy 1: @distube/ytdl-core (pure JS, no binary needed)
// ---------------------------------------------------------------------------
function downloadWithYtdlCore(videoUrl) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    const stream = ytdl(videoUrl, {
      filter: 'audioonly',
      quality: 'highestaudio',
      requestOptions: {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        },
      },
    });
    stream.on('data', chunk => chunks.push(chunk));
    stream.on('end', () => {
      const buf = Buffer.concat(chunks);
      if (buf.length < 2048) return reject(new Error('ytdl-core: output too small'));
      resolve({ buf, source: 'ytdl-core', mime: 'audio/mp4' });
    });
    stream.on('error', err => reject(new Error('ytdl-core: ' + (err.message || '').slice(0, 200))));
    // Hard timeout: kill stream if it takes too long
    const timer = setTimeout(() => {
      stream.destroy(new Error('ytdl-core: timeout'));
    }, 120000);
    stream.on('close', () => clearTimeout(timer));
  });
}

// ---------------------------------------------------------------------------
// Audio download — Strategy 2: Cobalt API (handles YouTube nsig, no binary)
// ---------------------------------------------------------------------------
const COBALT_INSTANCES = [
  'https://api.cobalt.tools',
  'https://cobalt.catvibers.me',
  'https://co.wuk.sh',
];

async function downloadWithCobalt(videoUrl) {
  for (const base of COBALT_INSTANCES) {
    try {
      const body = JSON.stringify({
        url: videoUrl,
        downloadMode: 'audio',
        audioFormat: 'mp3',
        filenameStyle: 'basic',
      });
      const res = await new Promise((resolve, reject) => {
        const p = new URL(base);
        const req = https.request(
          {
            hostname: p.hostname,
            path: '/',
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Accept: 'application/json',
              'User-Agent': 'Mozilla/5.0',
              'Content-Length': Buffer.byteLength(body),
            },
          },
          resp => {
            const chunks = [];
            resp.on('data', c => chunks.push(c));
            resp.on('end', () =>
              resolve({ status: resp.statusCode, body: Buffer.concat(chunks).toString() })
            );
          }
        );
        req.on('error', reject);
        req.setTimeout(20000, () => req.destroy(new Error('cobalt timeout')));
        req.write(body);
        req.end();
      });
      if (res.status !== 200) continue;
      const data = JSON.parse(res.body);
      if (!['tunnel', 'redirect', 'stream'].includes(data.status) || !data.url) continue;
      const dl = await httpsGet(data.url);
      if (dl.status === 200 && dl.body.length > 2048) {
        return { buf: dl.body, source: `cobalt(${base.replace('https://', '')})`, mime: 'audio/mpeg' };
      }
    } catch (_) {}
  }
  throw new Error('all cobalt instances failed');
}

// ---------------------------------------------------------------------------
// Main download orchestrator — tries ytdl-core first, falls back to Cobalt
// ---------------------------------------------------------------------------
async function downloadAudio(url) {
  const errs = [];

  // Strategy 1: @distube/ytdl-core — pure JS, most reliable
  try {
    return await downloadWithYtdlCore(url);
  } catch (e) {
    errs.push('ytdl-core: ' + (e.message || '').slice(0, 120));
  }

  // Strategy 2: Cobalt API — handles YouTube bot-check, no binary needed
  try {
    return await downloadWithCobalt(url);
  } catch (e) {
    errs.push('cobalt: ' + (e.message || '').slice(0, 120));
  }

  throw new Error(errs.join(' | '));
}

// ---------------------------------------------------------------------------
// Convert any audio buffer → MP3 via ffmpeg
// ---------------------------------------------------------------------------
function toMp3(buf, mime) {
  return new Promise(resolve => {
    const id  = Date.now().toString(36) + Math.random().toString(36).slice(2, 5);
    const ext = (mime || '').includes('webm') ? 'webm' : 'mp4';
    const inp = `/tmp/play_${id}.${ext}`;
    const out = `/tmp/play_${id}.mp3`;
    fs.writeFileSync(inp, buf);
    execFile(
      'ffmpeg',
      ['-y', '-i', inp, '-vn', '-ar', '44100', '-ac', '2', '-b:a', '128k', out],
      { timeout: 120000, maxBuffer: 80 * 1024 * 1024 },
      err => {
        try { fs.unlinkSync(inp); } catch (_) {}
        if (!err) {
          try {
            const mp3 = fs.readFileSync(out);
            fs.unlinkSync(out);
            resolve(mp3);
            return;
          } catch (_) {}
        }
        try { fs.unlinkSync(out); } catch (_) {}
        resolve(buf); // return original if ffmpeg fails
      }
    );
  });
}

// ---------------------------------------------------------------------------
// Lyrics helper
// ---------------------------------------------------------------------------
async function fetchLyrics(q) {
  const parts  = q.split(/\s*-\s*/);
  const artist = parts.length > 1 ? parts[0].trim() : '';
  const song   = (parts.length > 1 ? parts.slice(1).join(' - ') : q).trim();
  const tryUrl = async url => {
    try {
      const r = await httpsGet(url);
      return r.status === 200 ? JSON.parse(r.body.toString()) : null;
    } catch (_) { return null; }
  };
  const d1 = await tryUrl(`https://lrclib.net/api/search?q=${encodeURIComponent(q)}`);
  if (Array.isArray(d1)) {
    const h = d1.find(x => x.plainLyrics || x.syncedLyrics);
    if (h) {
      const text = h.plainLyrics || (h.syncedLyrics || '').replace(/\[\d{2}:\d{2}(?:\.\d+)?\]/g, '').trim();
      if (text) return { text, title: `${h.artistName} — ${h.trackName}` };
    }
  }
  if (artist && song) {
    const d2 = await tryUrl(
      `https://lrclib.net/api/get?artist_name=${encodeURIComponent(artist)}&track_name=${encodeURIComponent(song)}`
    );
    if (d2?.plainLyrics) return { text: d2.plainLyrics, title: `${d2.artistName} — ${d2.trackName}` };
  }
  const d3 = await tryUrl(`https://some-random-api.com/lyrics?title=${encodeURIComponent(q)}`);
  if (d3?.lyrics) return { text: d3.lyrics, title: d3.title ? `${d3.author || ''} — ${d3.title}` : null };
  return null;
}

// ---------------------------------------------------------------------------
// Commands
// ---------------------------------------------------------------------------
module.exports = [
  {
    name: 'play',
    aliases: ['song', 'mp3', 'ytmp3'],
    description: 'Search YouTube and send audio for a song',
    handler: async ({ argText, sock, jid, m, reply }) => {
      if (!argText) return reply('Usage: .play <song name>');

      await reply(`🔎 Searching *${argText}*...`);

      // 1. Search YouTube
      const r = await ytSearch(argText);
      const v = r.videos.length ? pickBest(r.videos, argText) : null;
      if (!v) return reply('❌ No results found on YouTube.');

      await reply(`🎵 Found: *${v.title}*\nDownloading audio…`);

      // 2. Download audio
      let buf, source, mime;
      try {
        ({ buf, source, mime } = await downloadAudio(v.url));
      } catch (e) {
        return reply(`❌ Download failed:\n_${e.message?.slice(0, 300)}_`);
      }

      // 3. Convert to MP3 with ffmpeg so WhatsApp can play it
      const finalBuf = await toMp3(buf, mime);

      // 4. Send as audio message
      await sock.sendMessage(jid, { audio: finalBuf, mimetype: 'audio/mpeg', ptt: false }, { quoted: m });
      await reply(`🎵 *${v.title}*\n${v.author?.name || ''} · ${v.timestamp || ''}\n_via ${source}_`);
    },
  },

  {
    name: 'ytsearch',
    aliases: ['ysearch'],
    description: 'Show YouTube search results',
    handler: async ({ argText, reply }) => {
      if (!argText) return reply('Usage: .ytsearch <query>');
      const r = await ytSearch(argText);
      const top = r.videos.slice(0, 6);
      if (!top.length) return reply('Nothing found.');
      reply(
        top
          .map(v => `• ${v.title}\n  ${v.timestamp || ''} · ${v.author?.name || ''}\n  ${v.url}`)
          .join('\n\n')
      );
    },
  },

  {
    name: 'lyrics',
    description: 'Fetch song lyrics',
    handler: async ({ argText, reply }) => {
      if (!argText) return reply('Usage: .lyrics <song>  or  .lyrics Artist - Song');
      const r = await fetchLyrics(argText);
      if (!r) return reply('No lyrics found.');
      const header = r.title ? `🎤 *${r.title}*\n\n` : '';
      const body   = r.text.length > 3500 ? r.text.slice(0, 3500) + '\n\n_…truncated_' : r.text;
      reply(header + body);
    },
  },

  {
    name: 'ringtone',
    description: 'Ringtone search link',
    handler: async ({ argText, reply }) =>
      reply(`https://www.zedge.net/find/ringtones/${encodeURIComponent(argText || 'top')}`),
  },

  {
    name: 'scloud',
    description: 'SoundCloud search link',
    handler: async ({ argText, reply }) =>
      reply(`https://soundcloud.com/search?q=${encodeURIComponent(argText || 'top')}`),
  },
];

'use strict';
const yts     = require('yt-search');
const https   = require('https');
const { execFile, exec } = require('child_process');
const fs      = require('fs');
const path    = require('path');
const helpers = require('../../lib/helpers');
const config  = require('../../lib/config');

const MAX_DL  = 75 * 1024 * 1024;   // 75 MB cap

// ---------------------------------------------------------------------------
// yt-dlp finder + self-installer
// ---------------------------------------------------------------------------
const YTDLP_URL = 'https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp';
const YTDLP_TMP = '/tmp/yt-dlp';

function testBin(bin) {
  return new Promise(res => {
    if (!bin) return res(false);
    execFile(bin, ['--version'], { timeout: 8000 }, err => res(!err));
  });
}

function sh(cmd) {
  return new Promise(res => exec(cmd, { timeout: 8000 }, (e, o) => res(e ? '' : (o||'').trim().split('\n')[0])));
}

function httpsGet(url, maxRedirects) {
  maxRedirects = maxRedirects == null ? 8 : maxRedirects;
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    https.get({ hostname: parsed.hostname, path: parsed.pathname + parsed.search, headers: { 'User-Agent': 'node-ytdlp-installer/1.0' } }, res => {
      const loc = res.headers.location;
      if ([301,302,307,308].includes(res.statusCode) && loc) {
        if (maxRedirects <= 0) return reject(new Error('too many redirects'));
        return resolve(httpsGet(loc, maxRedirects - 1));
      }
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode, body: Buffer.concat(chunks) }));
    }).on('error', reject);
  });
}

function downloadBinary(url, dest) {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    https.get({ hostname: parsed.hostname, path: parsed.pathname + parsed.search, headers: { 'User-Agent': 'node-ytdlp-installer/1.0' } }, res => {
      const loc = res.headers.location;
      if ([301,302,307,308].includes(res.statusCode) && loc) return resolve(downloadBinary(loc, dest));
      if (res.statusCode !== 200) return reject(new Error('HTTP ' + res.statusCode));
      const tmp = dest + '.dl';
      const file = fs.createWriteStream(tmp);
      res.pipe(file);
      file.on('finish', () => file.close(() => { try { fs.renameSync(tmp, dest); resolve(); } catch(e) { reject(e); } }));
      file.on('error', e => { try { fs.unlinkSync(tmp); } catch(_) {} reject(e); });
    }).on('error', reject);
  });
}

let _ytdlpReady = null;

async function getYtdlp() {
  if (_ytdlpReady) return _ytdlpReady;
  _ytdlpReady = (async () => {
    // Priority: Docker path first (Dockerfile installs here), then others
    const candidates = [
      '/usr/local/bin/yt-dlp',
      process.env.YTDLP_BIN,
      path.join(__dirname, '../../../bin/yt-dlp'),
      '/usr/bin/yt-dlp',
      '/bin/yt-dlp',
    ].filter(Boolean);

    for (const p of candidates) if (await testBin(p)) { console.log('[music] yt-dlp found at', p); return p; }

    const w = await sh('which yt-dlp 2>/dev/null || command -v yt-dlp 2>/dev/null');
    if (w && await testBin(w)) { console.log('[music] yt-dlp via which:', w); return w; }

    const nix = await sh('find /nix /run /usr -name yt-dlp -type f 2>/dev/null | head -1');
    if (nix && await testBin(nix)) { console.log('[music] yt-dlp via find:', nix); return nix; }

    if (await testBin(YTDLP_TMP)) { console.log('[music] yt-dlp already in /tmp'); return YTDLP_TMP; }

    // Self-download from GitHub
    console.log('[music] yt-dlp not found — downloading…');
    try {
      await downloadBinary(YTDLP_URL, YTDLP_TMP);
      fs.chmodSync(YTDLP_TMP, 0o755);
      if (await testBin(YTDLP_TMP)) { console.log('[music] yt-dlp self-download OK'); return YTDLP_TMP; }
    } catch(e) { console.error('[music] self-download failed:', e.message); }

    console.error('[music] yt-dlp unavailable');
    return null;
  })();
  return _ytdlpReady;
}

// Start looking immediately at module load so it's ready for the first command
getYtdlp();

// ---------------------------------------------------------------------------
// yt-dlp download — client strategies (most reliable first)
// Each client uses the matching user-agent so YouTube doesn't flag mismatch
// ---------------------------------------------------------------------------
const YT_STRATEGIES = [
  {
    client: 'ios',
    ua: 'com.google.ios.youtube/19.45.4 (iPhone16,2; U; CPU iPhone OS 18_1_0 like Mac OS X)',
    extraArgs: [],
  },
  {
    client: 'ios,web_embedded',
    ua: 'com.google.ios.youtube/19.45.4 (iPhone16,2; U; CPU iPhone OS 18_1_0 like Mac OS X)',
    extraArgs: [],
  },
  {
    client: 'tv_embedded',
    ua: 'Mozilla/5.0 (SMART-TV; Linux; Tizen 6.0) AppleWebKit/538.1 (KHTML, like Gecko) Version/6.0 TV Safari/538.1',
    extraArgs: [],
  },
  {
    client: 'web_embedded',
    ua: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    extraArgs: ['--add-header', 'Referer:https://www.youtube.com/'],
  },
];

function ytdlpDownload(bin, url, kind, strategy) {
  return new Promise((resolve, reject) => {
    helpers.ensureTmp();
    const id  = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
    const ext = kind === 'audio' ? 'm4a' : 'mp4';
    const out = path.join(config.paths.tmp, `yt_${id}.${ext}`);
    const fmt = kind === 'audio'
      ? 'bestaudio[ext=m4a]/bestaudio/best'
      : 'best[ext=mp4][height<=480]/best[height<=480]/best[ext=mp4]/best';

    const cookiesPath = path.join(__dirname, '../../../cookies.txt');
    const cookieArgs  = fs.existsSync(cookiesPath) ? ['--cookies', cookiesPath] : [];

    const args = [
      '-f', fmt,
      '--no-playlist', '--no-warnings', '--no-check-certificate',
      '--extractor-args', `youtube:player_client=${strategy.client}`,
      '--user-agent', strategy.ua,
      '--max-filesize', String(MAX_DL),
      '--socket-timeout', '45',
      '--retries', '2',
      ...strategy.extraArgs,
      ...cookieArgs,
      '-o', out,
      url,
    ];

    execFile(bin, args, { timeout: 240_000, maxBuffer: 80 * 1024 * 1024 }, (err, _so, se) => {
      if (err) {
        try { fs.unlinkSync(out); } catch(_) {}
        const msg = (se || err.message || '').toString().split('\n').filter(Boolean).slice(-3).join(' ').slice(0, 300);
        return reject(new Error(msg || err.message));
      }
      try {
        const buf = fs.readFileSync(out);
        fs.unlinkSync(out);
        if (buf.length < 2048) return reject(new Error('output too small'));
        resolve(buf);
      } catch(e) { reject(e); }
    });
  });
}

async function ytdlpRun(url, kind) {
  const bin = await getYtdlp();
  if (!bin) throw new Error('yt-dlp not installed');
  const errors = [];
  for (const strategy of YT_STRATEGIES) {
    try {
      const buf = await ytdlpDownload(bin, url, kind, strategy);
      return { buf, source: `yt-dlp[${strategy.client}]` };
    } catch(e) {
      const msg = e.message || '';
      errors.push(`${strategy.client}: ${msg.slice(0, 100)}`);
      // Only retry next client if it looks like a bot/auth error
      const retryable = /(Sign in|bot|403|unplayable|unavailable|private|PO|age.restrict)/i.test(msg);
      if (!retryable) break;
    }
  }
  throw new Error(errors.join(' | '));
}

// ---------------------------------------------------------------------------
// ytdl-core fallback
// ---------------------------------------------------------------------------
let _ytdl;
function getYtdl() {
  if (_ytdl !== undefined) return _ytdl;
  try { _ytdl = require('@distube/ytdl-core'); }
  catch(_) { try { _ytdl = require('ytdl-core'); } catch(__) { _ytdl = null; } }
  return _ytdl;
}

async function ytdlCoreFetch(url, kind) {
  const ytdl = getYtdl();
  if (!ytdl) throw new Error('ytdl-core not installed');
  const agent = ytdl.createAgent ? ytdl.createAgent() : undefined;
  const info  = await ytdl.getInfo(url, {
    requestOptions: { headers: { 'User-Agent': 'com.google.ios.youtube/19.45.4 (iPhone16,2; U; CPU iPhone OS 18_1_0 like Mac OS X)', 'Accept-Language': 'en-US,en;q=0.9' } },
    ...(agent ? { agent } : {}),
  });
  let fmt;
  if (kind === 'audio') {
    fmt = info.formats.filter(f => f.hasAudio && !f.hasVideo).sort((a,b) => (b.audioBitrate||0) - (a.audioBitrate||0))[0];
    if (!fmt) fmt = ytdl.chooseFormat(info.formats, { quality: 'highestaudio', filter: 'audioonly' });
  } else {
    fmt = info.formats.filter(f => f.hasVideo && f.hasAudio && f.container==='mp4' && (f.height||999)<=480).sort((a,b)=>(b.height||0)-(a.height||0))[0];
    if (!fmt) fmt = ytdl.chooseFormat(info.formats, { quality: '480p', filter: 'videoandaudio' });
  }
  if (!fmt?.url) throw new Error('no usable format');
  const r = await new Promise((res, rej) => {
    const chunks = [];
    https.get(fmt.url, { headers: { 'User-Agent': 'com.google.ios.youtube/19.45.4 (iPhone16,2; U; CPU iPhone OS 18_1_0 like Mac OS X)' } }, resp => {
      if (resp.statusCode !== 200) return rej(new Error('HTTP ' + resp.statusCode));
      resp.on('data', c => chunks.push(c));
      resp.on('end', () => res(Buffer.concat(chunks)));
    }).on('error', rej).setTimeout(90000, function() { this.destroy(new Error('timeout')); });
  });
  if (r.length < 2048) throw new Error('stream empty');
  return r;
}

// ---------------------------------------------------------------------------
// Invidious / Piped fallbacks
// ---------------------------------------------------------------------------
const INVIDIOUS = [
  'https://invidious.nerdvpn.de','https://invidious.fdn.fr','https://yt.artemislena.eu',
  'https://inv.tux.pizza','https://yewtu.be','https://inv.nadeko.net',
];
const PIPED = [
  'https://pipedapi.kavin.rocks','https://pipedapi.adminforge.de',
  'https://piped-api.garudalinux.org',
];

function videoId(url) { const m = url.match(/[?&]v=([A-Za-z0-9_-]{11})/); return m?.[1] || null; }

async function invidiousFetch(ytUrl, kind) {
  const id = videoId(ytUrl);
  if (!id) throw new Error('bad url');
  for (const base of INVIDIOUS) {
    try {
      const r = await httpsGet(`${base}/api/v1/videos/${id}?fields=formatStreams,adaptiveFormats`);
      if (r.status !== 200) continue;
      const d = JSON.parse(r.body.toString());
      let streamUrl;
      if (kind === 'video') {
        const fmts = (d.formatStreams||[]).filter(f=>f.type?.includes('video/mp4'));
        streamUrl = (fmts.find(f=>/480/.test(f.quality)) || fmts.find(f=>/360/.test(f.quality)) || fmts[0])?.url;
      } else {
        const fmts = d.adaptiveFormats||[];
        streamUrl = (fmts.find(f=>f.type?.includes('audio/mp4')) || fmts.find(f=>f.audioSampleRate))?.url;
      }
      if (streamUrl) return streamUrl;
    } catch(_) {}
  }
  throw new Error('all invidious failed');
}

async function pipedFetch(ytUrl, kind) {
  const id = videoId(ytUrl);
  if (!id) throw new Error('bad url');
  for (const base of PIPED) {
    try {
      const r = await httpsGet(`${base}/streams/${id}`);
      if (r.status !== 200) continue;
      const d = JSON.parse(r.body.toString());
      let streamUrl;
      if (kind === 'audio') {
        const s = (d.audioStreams||[]).sort((a,b)=>(b.bitrate||0)-(a.bitrate||0));
        streamUrl = s[0]?.url;
      } else {
        const s = (d.videoStreams||[]).filter(v=>v.mimeType?.includes('mp4')).sort((a,b)=>(b.height||0)-(a.height||0));
        streamUrl = (s.find(v=>!v.videoOnly&&(v.height||0)<=480) || s.find(v=>!v.videoOnly) || s[0])?.url;
      }
      if (streamUrl) return streamUrl;
    } catch(_) {}
  }
  throw new Error('all piped failed');
}

async function downloadUrl(url) {
  const r = await httpsGet(url);
  if (r.status !== 200) throw new Error('HTTP ' + r.status);
  if (r.body.length < 1024) throw new Error('payload too small');
  if (r.body.length > MAX_DL) throw new Error('file too large');
  return r.body;
}

// ---------------------------------------------------------------------------
// Master download chain
// ---------------------------------------------------------------------------
async function fetchMedia(url, kind) {
  const errs = [];

  try { return await ytdlpRun(url, kind); }
  catch(e) { errs.push('yt-dlp: ' + e.message?.slice(0,200)); }

  try { return { buf: await ytdlCoreFetch(url, kind), source: 'ytdl-core' }; }
  catch(e) { errs.push('ytdl-core: ' + e.message?.slice(0,80)); }

  try { const s = await invidiousFetch(url, kind); return { buf: await downloadUrl(s), source: 'invidious' }; }
  catch(e) { errs.push('invidious: ' + e.message?.slice(0,80)); }

  try { const s = await pipedFetch(url, kind); return { buf: await downloadUrl(s), source: 'piped' }; }
  catch(e) { errs.push('piped: ' + e.message?.slice(0,80)); }

  throw new Error(errs.join(' | '));
}

// ---------------------------------------------------------------------------
// YouTube search
// ---------------------------------------------------------------------------
async function ytSearch(q) {
  for (const fn of [ytSearchYts, ytSearchScrape, ytSearchPiped]) {
    try { const r = await fn(q); if (r?.videos?.length) return r; } catch(_) {}
  }
  return { videos: [] };
}

async function ytSearchYts(q)    { return yts(q); }

async function ytSearchScrape(q) {
  const r = await httpsGet(`https://www.youtube.com/results?search_query=${encodeURIComponent(q)}`);
  const html = r.body.toString();
  const m = html.match(/var ytInitialData = (\{[\s\S]+?\});\s*<\/script>/);
  if (!m) return { videos: [] };
  const data = JSON.parse(m[1]);
  const out = [];
  for (const sec of (data?.contents?.twoColumnSearchResultsRenderer?.primaryContents?.sectionListRenderer?.contents||[])) {
    for (const it of (sec?.itemSectionRenderer?.contents||[])) {
      const v = it?.videoRenderer; if (!v?.videoId) continue;
      const lt = v.lengthText?.simpleText||'';
      const secs = lt.split(':').map(Number).reduce((a,b)=>a*60+b,0);
      out.push({ title: v.title?.runs?.[0]?.text||'', videoId: v.videoId, url: `https://www.youtube.com/watch?v=${v.videoId}`, author: { name: v.ownerText?.runs?.[0]?.text||'' }, duration: { seconds: secs, timestamp: lt }, timestamp: lt, views: Number((v.viewCountText?.simpleText||'0').replace(/\D/g,''))||0 });
      if (out.length >= 20) break;
    }
    if (out.length >= 20) break;
  }
  return { videos: out };
}

async function ytSearchPiped(q) {
  for (const base of PIPED) {
    try {
      const r = await httpsGet(`${base}/search?q=${encodeURIComponent(q)}&filter=videos`);
      if (r.status !== 200) continue;
      const d = JSON.parse(r.body.toString());
      const items = (d?.items||[]).filter(x=>x.url||x.videoId);
      if (!items.length) continue;
      return { videos: items.map(x => { const id = x.videoId||(x.url||'').split('?v=').pop(); return { title: x.title||'', videoId: id, url: `https://www.youtube.com/watch?v=${id}`, author: { name: x.uploaderName||'' }, duration: { seconds: x.duration||0 }, timestamp: stamp(x.duration), views: x.views||0 }; }) };
    } catch(_) {}
  }
  return { videos: [] };
}

function stamp(s) {
  if (!s || s < 0) return '';
  const h = Math.floor(s/3600), m = Math.floor((s%3600)/60), sec = s%60;
  return h ? `${h}:${String(m).padStart(2,'0')}:${String(sec).padStart(2,'0')}` : `${m}:${String(sec).padStart(2,'0')}`;
}

function bestVideo(vids, q) {
  const tokens = q.toLowerCase().split(/\s+/).filter(Boolean);
  const score = v => {
    const t = (v.title||'').toLowerCase(), a = (v.author?.name||'').toLowerCase();
    let s = 0;
    tokens.forEach(tok => { if(t.includes(tok)) s+=3; if(a.includes(tok)) s+=2; });
    if (/official\s+(audio|video|music)/i.test(v.title)) s+=3;
    if (/\btopic\b|vevo/i.test(v.author?.name||'')) s+=3;
    if (/reaction|tutorial|cover|sped.up|nightcore|slowed/i.test(v.title)) s-=3;
    const sec = v.duration?.seconds||0;
    if (sec>=45 && sec<=720) s+=1; else if (sec>720) s-=2;
    s += Math.min(3, Math.log10((v.views||1)+1)/2);
    return s;
  };
  return vids.slice(0,15).map(v=>({v,s:score(v)})).sort((a,b)=>b.s-a.s)[0]?.v || vids[0];
}

// ---------------------------------------------------------------------------
// Lyrics helpers
// ---------------------------------------------------------------------------
async function lyrics(q) {
  const parts = q.split(/\s*-\s*/), artist = parts.length>1?parts[0].trim():'', song = (parts.length>1?parts.slice(1).join(' - '):q).trim();
  try { const r = await httpsGet(`https://lrclib.net/api/search?q=${encodeURIComponent(q)}`); if(r.status===200){const d=JSON.parse(r.body.toString());const hit=Array.isArray(d)?d.find(x=>x.plainLyrics||x.syncedLyrics):null;if(hit){const text=hit.plainLyrics||stripLrc(hit.syncedLyrics);if(text) return {text,title:`${hit.artistName} — ${hit.trackName}`};}} } catch(_) {}
  if (artist&&song) { try { const r = await httpsGet(`https://lrclib.net/api/get?artist_name=${encodeURIComponent(artist)}&track_name=${encodeURIComponent(song)}`); if(r.status===200){const d=JSON.parse(r.body.toString());if(d?.plainLyrics) return {text:d.plainLyrics,title:`${d.artistName} — ${d.trackName}`};} } catch(_) {} }
  try { const r = await httpsGet(`https://some-random-api.com/lyrics?title=${encodeURIComponent(q)}`); if(r.status===200){const d=JSON.parse(r.body.toString());if(d?.lyrics) return {text:d.lyrics,title:d.title?`${d.author||''} — ${d.title}`:null};} } catch(_) {}
  return null;
}
function stripLrc(s) { return s ? s.replace(/\[\d{2}:\d{2}(?:\.\d+)?\]/g,'').trim() : ''; }

// ---------------------------------------------------------------------------
// Commands
// ---------------------------------------------------------------------------
module.exports = [
  {
    name: 'play', aliases: ['song','mp3','ytmp3'],
    description: 'Send audio for a song',
    handler: async ({ argText, sock, jid, m, reply }) => {
      if (!argText) return reply('Usage: .play <song name>');
      await reply(`🔎 Searching *${argText}*...`);
      const r = await ytSearch(argText);
      const v = r.videos.length ? bestVideo(r.videos, argText) : null;
      if (!v) return reply('❌ Not found on YouTube.');
      await reply(`🎵 Found: *${v.title}* — downloading audio…`);
      try {
        const { buf, source } = await fetchMedia(v.url, 'audio');
        await sock.sendMessage(jid, { audio: buf, mimetype: 'audio/mp4', ptt: false, fileName: `${v.title}.mp3` }, { quoted: m });
        await reply(`🎵 *${v.title}*\n${v.author?.name||''} · ${v.timestamp||''}\n_via ${source}_`);
      } catch(e) { reply(`❌ Failed: *${v.title}*\n_${e.message?.slice(0,300)}_`); }
    },
  },
  {
    name: 'video', aliases: ['ytmp4','ytvideo'],
    description: 'Send video for a name',
    handler: async ({ argText, sock, jid, m, reply }) => {
      if (!argText) return reply('Usage: .video <name>');
      await reply(`🔎 Searching *${argText}*...`);
      const r = await ytSearch(argText);
      const v = r.videos.length ? bestVideo(r.videos, argText) : null;
      if (!v) return reply('❌ Not found on YouTube.');
      await reply(`🎬 Found: *${v.title}* — downloading video…`);
      try {
        const { buf, source } = await fetchMedia(v.url, 'video');
        await sock.sendMessage(jid, { video: buf, mimetype: 'video/mp4', caption: `🎬 *${v.title}*\n_via ${source}_` }, { quoted: m });
      } catch(e) { reply(`❌ Failed: *${v.title}*\n_${e.message?.slice(0,300)}_\n\nTry *.play ${argText}* for audio only.`); }
    },
  },
  {
    name: 'ytdlpcheck', aliases: ['checkytdlp','musiccheck'],
    description: 'Diagnose yt-dlp and media pipeline',
    handler: async ({ reply }) => {
      const bin = await getYtdlp();
      if (!bin) return reply('❌ yt-dlp: not found anywhere\n\nThe Dockerfile must have failed to install it. Check Railway build logs.');
      // Get version
      const ver = await new Promise(res => execFile(bin, ['--version'], { timeout: 6000 }, (e,o) => res(e ? 'error' : o.trim())));
      // Try getting a YouTube URL (no download)
      const testId = '60ItHLz5WEA'; // Faded
      const urlCheck = await new Promise(res => {
        execFile(bin, ['--get-url','--no-warnings','--extractor-args','youtube:player_client=ios','--user-agent','com.google.ios.youtube/19.45.4 (iPhone16,2; U; CPU iPhone OS 18_1_0 like Mac OS X)', `https://www.youtube.com/watch?v=${testId}`], { timeout: 30000 }, (e,o,se) => {
          if (e) res('❌ URL fetch failed:\n' + (se||e.message||'').slice(0,200));
          else res('✅ YouTube stream URL obtained (' + o.trim().slice(0,60) + '...)');
        });
      });
      reply(`*yt-dlp diagnostic*\n\nPath: \`${bin}\`\nVersion: ${ver}\n\nYouTube test:\n${urlCheck}`);
    },
  },
  {
    name: 'ytsearch', aliases: ['ysearch'],
    description: 'YouTube search results',
    handler: async ({ argText, reply }) => {
      if (!argText) return reply('Usage: .ytsearch <query>');
      const r = await ytSearch(argText);
      const top = r.videos.slice(0,6);
      if (!top.length) return reply('Nothing found.');
      reply(top.map(v => `• ${v.title}\n  ${v.timestamp||''} · ${v.author?.name||''}\n  ${v.url}`).join('\n\n'));
    },
  },
  {
    name: 'lyrics', description: 'Fetch song lyrics',
    handler: async ({ argText, reply }) => {
      if (!argText) return reply('Usage: .lyrics <song>  or  .lyrics Artist - Song');
      const r = await lyrics(argText);
      if (!r) return reply('No lyrics found.');
      const header = r.title ? `🎤 *${r.title}*\n\n` : '';
      const body   = r.text.length > 3500 ? r.text.slice(0, 3500) + '\n\n_…truncated_' : r.text;
      reply(header + body);
    },
  },
  { name: 'ringtone', description: 'Ringtone search link', handler: async ({ argText, reply }) => reply(`https://www.zedge.net/find/ringtones/${encodeURIComponent(argText||'top')}`) },
  { name: 'scloud',   description: 'SoundCloud search link', handler: async ({ argText, reply }) => reply(`https://soundcloud.com/search?q=${encodeURIComponent(argText||'top')}`) },
];

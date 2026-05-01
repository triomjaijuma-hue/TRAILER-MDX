'use strict';
const yts   = require('yt-search');
const https = require('https');
const { execFile, exec } = require('child_process');
const fs    = require('fs');
const path  = require('path');
const helpers = require('../../lib/helpers');
const config  = require('../../lib/config');

const MAX_DL = 75 * 1024 * 1024;

// ---------------------------------------------------------------------------
// Cookies — Railway sets YOUTUBE_COOKIES env var (base64 of cookies.txt)
// ---------------------------------------------------------------------------
const COOKIES_FILE = '/tmp/yt-cookies.txt';

function ensureCookies() {
  if (fs.existsSync(COOKIES_FILE)) return COOKIES_FILE;
  // Check repo root cookies.txt
  const repoCookies = path.join(__dirname, '../../../cookies.txt');
  if (fs.existsSync(repoCookies)) {
    fs.copyFileSync(repoCookies, COOKIES_FILE);
    return COOKIES_FILE;
  }
  // Decode from env var
  const b64 = process.env.YOUTUBE_COOKIES || process.env.YT_COOKIES;
  if (b64) {
    try {
      const decoded = Buffer.from(b64, 'base64').toString('utf8');
      if (decoded.includes('youtube.com')) {
        fs.writeFileSync(COOKIES_FILE, decoded, 'utf8');
        console.log('[music] YouTube cookies loaded from env var');
        return COOKIES_FILE;
      }
    } catch(_) {}
  }
  return null;
}

const COOKIES = ensureCookies();

// ---------------------------------------------------------------------------
// yt-dlp finder + self-installer
// ---------------------------------------------------------------------------
const YTDLP_TMP = '/tmp/yt-dlp';
const YTDLP_URL = 'https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp';

function testBin(p) {
  return new Promise(r => { if (!p) return r(false); execFile(p, ['--version'], { timeout: 8000 }, e => r(!e)); });
}
function sh(cmd) {
  return new Promise(r => exec(cmd, { timeout: 8000 }, (e, o) => r(e ? '' : (o||'').trim().split('\n')[0])));
}
function httpsGet(url, maxRedir) {
  maxRedir = maxRedir == null ? 8 : maxRedir;
  return new Promise((resolve, reject) => {
    const p = new URL(url);
    https.get({ hostname: p.hostname, path: p.pathname + p.search, headers: { 'User-Agent': 'Mozilla/5.0' } }, res => {
      if ([301,302,307,308].includes(res.statusCode) && res.headers.location) {
        return maxRedir > 0 ? resolve(httpsGet(res.headers.location, maxRedir-1)) : reject(new Error('too many redirects'));
      }
      const c = []; res.on('data', d => c.push(d)); res.on('end', () => resolve({ status: res.statusCode, body: Buffer.concat(c) }));
    }).on('error', reject);
  });
}
function dlBin(url, dest) {
  return new Promise((resolve, reject) => {
    const p = new URL(url);
    https.get({ hostname: p.hostname, path: p.pathname + p.search, headers: { 'User-Agent': 'installer/1.0' } }, res => {
      if ([301,302,307,308].includes(res.statusCode)) return resolve(dlBin(res.headers.location, dest));
      if (res.statusCode !== 200) return reject(new Error('HTTP ' + res.statusCode));
      const tmp = dest + '.dl'; const file = fs.createWriteStream(tmp);
      res.pipe(file);
      file.on('finish', () => file.close(() => { try { fs.renameSync(tmp, dest); resolve(); } catch(e) { reject(e); } }));
      file.on('error', e => { try { fs.unlinkSync(tmp); } catch(_) {} reject(e); });
    }).on('error', reject);
  });
}

let _ytdlpReady = null;
function getYtdlp() {
  if (!_ytdlpReady) {
    _ytdlpReady = (async () => {
      const candidates = [
        '/usr/local/bin/yt-dlp',       // Docker Dockerfile path
        process.env.YTDLP_BIN,
        path.join(__dirname, '../../../bin/yt-dlp'),
        '/usr/bin/yt-dlp', '/bin/yt-dlp',
      ].filter(Boolean);
      for (const p of candidates) if (await testBin(p)) { console.log('[music] yt-dlp at', p); return p; }
      const w = await sh('which yt-dlp 2>/dev/null || command -v yt-dlp 2>/dev/null');
      if (w && await testBin(w)) { console.log('[music] yt-dlp via which:', w); return w; }
      const f = await sh('find /nix /run /usr -name yt-dlp -type f 2>/dev/null | head -1');
      if (f && await testBin(f)) { console.log('[music] yt-dlp via find:', f); return f; }
      if (await testBin(YTDLP_TMP)) return YTDLP_TMP;
      console.log('[music] Downloading yt-dlp...');
      try {
        await dlBin(YTDLP_URL, YTDLP_TMP);
        fs.chmodSync(YTDLP_TMP, 0o755);
        if (await testBin(YTDLP_TMP)) { console.log('[music] yt-dlp self-download OK'); return YTDLP_TMP; }
      } catch(e) { console.error('[music] yt-dlp download failed:', e.message); }
      console.error('[music] yt-dlp unavailable');
      return null;
    })();
  }
  return _ytdlpReady;
}
getYtdlp(); // start immediately at module load

// ---------------------------------------------------------------------------
// yt-dlp strategies — iOS UA paired with iOS client for correct fingerprint
// ---------------------------------------------------------------------------
const STRATEGIES = [
  { client: 'ios',            ua: 'com.google.ios.youtube/19.45.4 (iPhone16,2; U; CPU iPhone OS 18_1_0 like Mac OS X)', extra: [] },
  { client: 'ios,web_embedded', ua: 'com.google.ios.youtube/19.45.4 (iPhone16,2; U; CPU iPhone OS 18_1_0 like Mac OS X)', extra: [] },
  { client: 'tv_embedded',    ua: 'Mozilla/5.0 (SMART-TV; Linux; Tizen 6.0) AppleWebKit/538.1',                          extra: [] },
  { client: 'web_embedded',   ua: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',                        extra: ['--add-header','Referer:https://www.youtube.com/'] },
];

function ytdlpDownload(bin, url, kind, strategy, cookiesFile) {
  return new Promise((resolve, reject) => {
    helpers.ensureTmp();
    const id  = Date.now().toString(36) + Math.random().toString(36).slice(2,6);
    const out = path.join(config.paths.tmp, `yt_${id}.${kind==='audio'?'m4a':'mp4'}`);
    const fmt = kind==='audio' ? 'bestaudio[ext=m4a]/bestaudio/best' : 'best[ext=mp4][height<=480]/best[height<=480]/best[ext=mp4]/best';
    const cookArgs = cookiesFile ? ['--cookies', cookiesFile] : [];
    const args = [
      '-f', fmt, '--no-playlist', '--no-warnings', '--no-check-certificate',
      '--extractor-args', `youtube:player_client=${strategy.client}`,
      '--user-agent', strategy.ua,
      '--max-filesize', String(MAX_DL),
      '--socket-timeout', '45', '--retries', '2',
      ...strategy.extra, ...cookArgs, '-o', out, url,
    ];
    execFile(bin, args, { timeout: 240000, maxBuffer: 80*1024*1024 }, (err, _so, se) => {
      if (err) {
        try { fs.unlinkSync(out); } catch(_) {}
        const msg = (se||err.message||'').toString().split('\n').filter(Boolean).slice(-3).join(' ').slice(0,300);
        return reject(new Error(msg || err.message));
      }
      try {
        const buf = fs.readFileSync(out); fs.unlinkSync(out);
        if (buf.length < 2048) return reject(new Error('output too small'));
        resolve(buf);
      } catch(e) { reject(e); }
    });
  });
}

async function ytdlpRun(url, kind) {
  const bin = await getYtdlp();
  if (!bin) throw new Error('yt-dlp not installed');
  const cookiesFile = ensureCookies();
  const errs = [];
  for (const s of STRATEGIES) {
    try { return { buf: await ytdlpDownload(bin, url, kind, s, cookiesFile), source: `yt-dlp[${s.client}]` }; }
    catch(e) {
      errs.push(`${s.client}: ${(e.message||'').slice(0,100)}`);
      if (!/(Sign in|bot|403|unplayable|unavailable|private|PO|age.restrict|nsig)/i.test(e.message)) break;
    }
  }
  throw new Error(errs.join(' | '));
}

// ---------------------------------------------------------------------------
// ytdl-core fallback
// ---------------------------------------------------------------------------
let _ytdl;
function getYtdl() {
  if (_ytdl !== undefined) return _ytdl;
  try { _ytdl = require('@distube/ytdl-core'); } catch(_) { try { _ytdl = require('ytdl-core'); } catch(__) { _ytdl = null; } }
  return _ytdl;
}
async function ytdlCoreFetch(url, kind) {
  const ytdl = getYtdl(); if (!ytdl) throw new Error('ytdl-core not installed');
  const agent = ytdl.createAgent ? ytdl.createAgent() : undefined;
  const IOS_UA = 'com.google.ios.youtube/19.45.4 (iPhone16,2; U; CPU iPhone OS 18_1_0 like Mac OS X)';
  const info = await ytdl.getInfo(url, { requestOptions: { headers: { 'User-Agent': IOS_UA } }, ...(agent?{agent}:{}) });
  let fmt;
  if (kind==='audio') { fmt = info.formats.filter(f=>f.hasAudio&&!f.hasVideo).sort((a,b)=>(b.audioBitrate||0)-(a.audioBitrate||0))[0]; }
  else { fmt = info.formats.filter(f=>f.hasVideo&&f.hasAudio&&f.container==='mp4'&&(f.height||999)<=480).sort((a,b)=>(b.height||0)-(a.height||0))[0]; }
  if (!fmt?.url) throw new Error('no format');
  const r = await new Promise((res,rej) => {
    const chunks=[];
    https.get(fmt.url, { headers: { 'User-Agent': IOS_UA } }, resp => {
      if (resp.statusCode!==200) return rej(new Error('HTTP '+resp.statusCode));
      resp.on('data',c=>chunks.push(c)); resp.on('end',()=>res(Buffer.concat(chunks)));
    }).on('error',rej).setTimeout(90000,function(){this.destroy(new Error('timeout'));});
  });
  if (r.length < 2048) throw new Error('stream empty'); return r;
}

// ---------------------------------------------------------------------------
// Invidious / Piped
// ---------------------------------------------------------------------------
const INVIDIOUS = ['https://invidious.nerdvpn.de','https://invidious.fdn.fr','https://yt.artemislena.eu','https://inv.tux.pizza','https://yewtu.be'];
const PIPED     = ['https://pipedapi.kavin.rocks','https://pipedapi.adminforge.de','https://piped-api.garudalinux.org'];
function vidId(url) { const m=url.match(/[?&]v=([A-Za-z0-9_-]{11})/); return m?.[1]||null; }
async function invFetch(ytUrl,kind) {
  const id=vidId(ytUrl); if(!id) throw new Error('bad url');
  for(const b of INVIDIOUS){try{const r=await httpsGet(`${b}/api/v1/videos/${id}?fields=formatStreams,adaptiveFormats`);if(r.status!==200)continue;const d=JSON.parse(r.body.toString());let u;if(kind==='video'){const f=(d.formatStreams||[]).filter(x=>x.type?.includes('video/mp4'));u=(f.find(x=>/480/.test(x.quality))||f.find(x=>/360/.test(x.quality))||f[0])?.url;}else{const f=d.adaptiveFormats||[];u=(f.find(x=>x.type?.includes('audio/mp4'))||f.find(x=>x.audioSampleRate))?.url;}if(u) return u;}catch(_){}}
  throw new Error('invidious failed');
}
async function pipedFetch(ytUrl,kind) {
  const id=vidId(ytUrl); if(!id) throw new Error('bad url');
  for(const b of PIPED){try{const r=await httpsGet(`${b}/streams/${id}`);if(r.status!==200)continue;const d=JSON.parse(r.body.toString());let u;if(kind==='audio'){const s=(d.audioStreams||[]).sort((a,b2)=>(b2.bitrate||0)-(a.bitrate||0));u=s[0]?.url;}else{const s=(d.videoStreams||[]).filter(v=>v.mimeType?.includes('mp4')).sort((a,b2)=>(b2.height||0)-(a.height||0));u=(s.find(v=>!v.videoOnly&&(v.height||0)<=480)||s.find(v=>!v.videoOnly)||s[0])?.url;}if(u) return u;}catch(_){}}
  throw new Error('piped failed');
}

// ---------------------------------------------------------------------------
// Master chain
// ---------------------------------------------------------------------------
async function fetchMedia(url, kind) {
  const errs = [];
  try { return await ytdlpRun(url, kind); } catch(e) { errs.push('yt-dlp: '+e.message?.slice(0,200)); }
  try { return { buf: await ytdlCoreFetch(url, kind), source: 'ytdl-core' }; } catch(e) { errs.push('ytdl-core: '+e.message?.slice(0,80)); }
  try { const s=await invFetch(url,kind); const r=await httpsGet(s); return { buf: r.body, source: 'invidious' }; } catch(e) { errs.push('invidious: '+e.message?.slice(0,80)); }
  try { const s=await pipedFetch(url,kind); const r=await httpsGet(s); return { buf: r.body, source: 'piped' }; } catch(e) { errs.push('piped: '+e.message?.slice(0,80)); }
  throw new Error(errs.join(' | '));
}

// ---------------------------------------------------------------------------
// Search
// ---------------------------------------------------------------------------
async function ytSearch(q) {
  for(const fn of [()=>yts(q), ytScrape.bind(null,q), ytPiped.bind(null,q)]){try{const r=await fn();if(r?.videos?.length) return r;}catch(_){}}
  return {videos:[]};
}
async function ytScrape(q) {
  const r=await httpsGet(`https://www.youtube.com/results?search_query=${encodeURIComponent(q)}`);
  const m=r.body.toString().match(/var ytInitialData = (\{[\s\S]+?\});\s*<\/script>/);
  if(!m) return {videos:[]};
  const data=JSON.parse(m[1]); const out=[];
  for(const sec of(data?.contents?.twoColumnSearchResultsRenderer?.primaryContents?.sectionListRenderer?.contents||[])){for(const it of(sec?.itemSectionRenderer?.contents||[])){const v=it?.videoRenderer;if(!v?.videoId)continue;const lt=v.lengthText?.simpleText||'';const s2=lt.split(':').map(Number).reduce((a,b2)=>a*60+b2,0);out.push({title:v.title?.runs?.[0]?.text||'',videoId:v.videoId,url:`https://www.youtube.com/watch?v=${v.videoId}`,author:{name:v.ownerText?.runs?.[0]?.text||''},duration:{seconds:s2,timestamp:lt},timestamp:lt,views:Number((v.viewCountText?.simpleText||'0').replace(/\D/g,''))||0});if(out.length>=20)break;}if(out.length>=20)break;}
  return {videos:out};
}
async function ytPiped(q) {
  for(const b of PIPED){try{const r=await httpsGet(`${b}/search?q=${encodeURIComponent(q)}&filter=videos`);if(r.status!==200)continue;const d=JSON.parse(r.body.toString());const items=(d?.items||[]).filter(x=>x.url||x.videoId);if(!items.length)continue;return{videos:items.map(x=>{const id=x.videoId||(x.url||'').split('?v=').pop();return{title:x.title||'',videoId:id,url:`https://www.youtube.com/watch?v=${id}`,author:{name:x.uploaderName||''},duration:{seconds:x.duration||0},timestamp:stamp(x.duration),views:x.views||0};})};}catch(_){}}
  return {videos:[]};
}
function stamp(s){if(!s||s<0)return '';const h=Math.floor(s/3600),m=Math.floor((s%3600)/60),sc=s%60;return h?`${h}:${String(m).padStart(2,'0')}:${String(sc).padStart(2,'0')}`:`${m}:${String(sc).padStart(2,'0')}`;}
function best(vids,q){const tok=q.toLowerCase().split(/\s+/).filter(Boolean);const sc=v=>{const t=(v.title||'').toLowerCase(),a=(v.author?.name||'').toLowerCase();let s=0;tok.forEach(k=>{if(t.includes(k))s+=3;if(a.includes(k))s+=2;});if(/official\s+(audio|video|music)/i.test(v.title))s+=3;if(/\btopic\b|vevo/i.test(v.author?.name||''))s+=3;if(/reaction|tutorial|cover|sped.up|nightcore|slowed/i.test(v.title))s-=3;const sec=v.duration?.seconds||0;if(sec>=45&&sec<=720)s+=1;else if(sec>720)s-=2;s+=Math.min(3,Math.log10((v.views||1)+1)/2);return s;};return vids.slice(0,15).map(v=>({v,s:sc(v)})).sort((a,b)=>b.s-a.s)[0]?.v||vids[0];}

// ---------------------------------------------------------------------------
// Lyrics
// ---------------------------------------------------------------------------
async function fetchLyrics(q) {
  const parts=q.split(/\s*-\s*/),artist=parts.length>1?parts[0].trim():'',song=(parts.length>1?parts.slice(1).join(' - '):q).trim();
  try{const r=await httpsGet(`https://lrclib.net/api/search?q=${encodeURIComponent(q)}`);if(r.status===200){const d=JSON.parse(r.body.toString());const hit=Array.isArray(d)?d.find(x=>x.plainLyrics||x.syncedLyrics):null;if(hit){const text=hit.plainLyrics||(hit.syncedLyrics||'').replace(/\[\d{2}:\d{2}(?:\.\d+)?\]/g,'').trim();if(text) return {text,title:`${hit.artistName} — ${hit.trackName}`};}}}catch(_){}
  if(artist&&song){try{const r=await httpsGet(`https://lrclib.net/api/get?artist_name=${encodeURIComponent(artist)}&track_name=${encodeURIComponent(song)}`);if(r.status===200){const d=JSON.parse(r.body.toString());if(d?.plainLyrics) return {text:d.plainLyrics,title:`${d.artistName} — ${d.trackName}`};}}catch(_){}}
  try{const r=await httpsGet(`https://some-random-api.com/lyrics?title=${encodeURIComponent(q)}`);if(r.status===200){const d=JSON.parse(r.body.toString());if(d?.lyrics) return {text:d.lyrics,title:d.title?`${d.author||''} — ${d.title}`:null};}}catch(_){}
  return null;
}

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
      const v = r.videos.length ? best(r.videos, argText) : null;
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
    description: 'Send video',
    handler: async ({ argText, sock, jid, m, reply }) => {
      if (!argText) return reply('Usage: .video <name>');
      await reply(`🔎 Searching *${argText}*...`);
      const r = await ytSearch(argText);
      const v = r.videos.length ? best(r.videos, argText) : null;
      if (!v) return reply('❌ Not found on YouTube.');
      await reply(`🎬 Found: *${v.title}* — downloading video…`);
      try {
        const { buf, source } = await fetchMedia(v.url, 'video');
        await sock.sendMessage(jid, { video: buf, mimetype: 'video/mp4', caption: `🎬 *${v.title}*\n_via ${source}_` }, { quoted: m });
      } catch(e) { reply(`❌ Failed: *${v.title}*\n_${e.message?.slice(0,300)}_\n\nTry *.play ${argText}* for audio only.`); }
    },
  },
  {
    name: 'ytdlpcheck', aliases: ['musiccheck','checkytdlp'],
    description: 'Diagnose yt-dlp and cookies',
    handler: async ({ reply }) => {
      const bin = await getYtdlp();
      if (!bin) return reply('❌ yt-dlp: *not found*\n\nCheck Railway build logs — the Dockerfile curl step may have failed.');
      const ver = await new Promise(r => execFile(bin, ['--version'], { timeout: 6000 }, (e,o) => r(e?'error':o.trim())));
      const cookies = ensureCookies();
      const cookieStatus = cookies ? `✅ cookies loaded (${fs.statSync(cookies).size} bytes)` : '❌ no cookies — YouTube will block cloud IPs\n\nTo fix: set *YOUTUBE_COOKIES* env var in Railway (see instructions)';
      const ytTest = await new Promise(r => {
        const args = ['--get-url','--no-warnings','--extractor-args','youtube:player_client=ios','--user-agent','com.google.ios.youtube/19.45.4 (iPhone16,2; U; CPU iPhone OS 18_1_0 like Mac OS X)'];
        if (cookies) args.push('--cookies', cookies);
        args.push('https://www.youtube.com/watch?v=60ItHLz5WEA');
        execFile(bin, args, { timeout: 30000 }, (e,o,se) => {
          if (e) r('❌ YouTube blocked:\n_' + (se||e.message||'').slice(0,200) + '_');
          else r('✅ YouTube working! Stream URL obtained.');
        });
      });
      reply(`*Music Diagnostics*\n\nyt-dlp: \`${bin}\`\nVersion: ${ver}\nCookies: ${cookieStatus}\n\nYouTube test:\n${ytTest}`);
    },
  },
  {
    name: 'ytsearch', aliases: ['ysearch'],
    description: 'YouTube search',
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
      if (!argText) return reply('Usage: .lyrics <song>');
      const r = await fetchLyrics(argText);
      if (!r) return reply('No lyrics found.');
      const header = r.title ? `🎤 *${r.title}*\n\n` : '';
      const body = r.text.length > 3500 ? r.text.slice(0,3500) + '\n\n_…truncated_' : r.text;
      reply(header + body);
    },
  },
  { name: 'ringtone', description: 'Ringtone search link', handler: async ({ argText, reply }) => reply(`https://www.zedge.net/find/ringtones/${encodeURIComponent(argText||'top')}`) },
  { name: 'scloud',   description: 'SoundCloud search',    handler: async ({ argText, reply }) => reply(`https://soundcloud.com/search?q=${encodeURIComponent(argText||'top')}`) },
];

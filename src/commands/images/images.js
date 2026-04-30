'use strict';
const helpers = require('../../lib/helpers');

// source.unsplash.com was deprecated in 2024 and now returns nothing useful.
// Use loremflickr.com for keyword-based random photos (CC-licensed).
function imgCmd(name, query) {
  return {
    name,
    description: `Random ${name} image`,
    handler: async ({ sock, jid, m, reply }) => {
      const sources = [
        `https://loremflickr.com/1024/768/${encodeURIComponent(query)}?lock=${Math.floor(Math.random() * 100000)}`,
        `https://source.unsplash.com/random/1024x768?${encodeURIComponent(query)}`, // legacy fallback
        `https://picsum.photos/seed/${encodeURIComponent(query + Date.now())}/1024/768`,
      ];
      for (const url of sources) {
        try {
          const buf = await helpers.downloadToBuffer(url, { timeout: 15000 });
          if (buf && buf.length > 1024) {
            await sock.sendMessage(jid, { image: buf, caption: `#${name}` }, { quoted: m });
            return;
          }
        } catch (_) {}
      }
      reply('Image fetch failed — all sources unreachable.');
    },
  };
}

module.exports = [
  imgCmd('coding', 'coding,programmer'),
  imgCmd('cyberimg', 'cyberpunk,neon'),
  imgCmd('game', 'video-game,gaming'),
  imgCmd('islamic', 'mosque,calligraphy'),
  imgCmd('mountain', 'mountain,landscape'),
  imgCmd('pies', 'pie,dessert'),
  imgCmd('tech', 'technology,gadgets'),
];

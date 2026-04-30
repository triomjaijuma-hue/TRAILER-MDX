'use strict';
const helpers = require('../../lib/helpers');

// source.unsplash.com was deprecated in 2024 and now returns nothing useful.
// Use loremflickr.com / picsum.photos for keyword-based random photos.
//
// IMPORTANT: every command in this file is an IMAGE FETCHER. The command name
// is the keyword that gets queried. We deliberately avoid generic verbs like
// "game" / "play" here so we don't shadow real commands in other plugins.
function imgCmd(name, query) {
  return {
    name,
    description: `Random ${name} image`,
    handler: async ({ sock, jid, m, reply }) => {
      const sources = [
        `https://loremflickr.com/1024/768/${encodeURIComponent(query)}?lock=${Math.floor(Math.random() * 100000)}`,
        `https://picsum.photos/seed/${encodeURIComponent(query + Date.now())}/1024/768`,
      ];
      for (const url of sources) {
        try {
          const buf = await helpers.downloadToBuffer(url, { timeout: 15000 });
          // loremflickr serves a tiny ~3KB "no-image" placeholder when a
          // keyword has no match. Require a realistic image size (>= 20KB)
          // to count as a hit; otherwise fall through to the next source.
          if (buf && buf.length >= 20 * 1024) {
            // IMPORTANT: do NOT use '#' or any other prefix character here.
            // '#' is a configured command prefix, so a caption like "#tech"
            // gets re-parsed as the .tech command when WhatsApp echoes the
            // outbound message back through messages.upsert — that's how the
            // chat-flood loop happened. Plain text captions are safe.
            await sock.sendMessage(
              jid,
              { image: buf, caption: `Random ${name} image` },
              { quoted: m }
            );
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
  // Renamed from 'game' -> 'gameimg' so it stops shadowing the games plugin.
  // The games plugin owns .game / .games (see commands/games/games.js).
  imgCmd('gameimg', 'video-game,gaming'),
  imgCmd('islamic', 'mosque,calligraphy'),
  imgCmd('mountain', 'mountain,landscape'),
  imgCmd('pies', 'pie,dessert'),
  imgCmd('tech', 'technology,gadgets'),
];

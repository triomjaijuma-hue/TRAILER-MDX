'use strict';
const helpers = require('../../lib/helpers');

function imgCmd(name, query) {
  return {
    name,
    description: `Random ${name} image`,
    handler: async ({ sock, jid, m, reply }) => {
      try {
        const buf = await helpers.downloadToBuffer(`https://source.unsplash.com/random/1024x768?${encodeURIComponent(query)}`);
        await sock.sendMessage(jid, { image: buf, caption: `#${name}` }, { quoted: m });
      } catch (e) { reply(`Image fetch failed: ${e?.message}`); }
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

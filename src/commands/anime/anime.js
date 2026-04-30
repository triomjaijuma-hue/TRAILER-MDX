'use strict';
// Free anime SFW image API — https://waifu.pics/docs
const helpers = require('../../lib/helpers');

function endpointCmd(name, endpoint, caption) {
  return {
    name,
    description: caption || `Random anime ${name} image`,
    handler: async ({ sock, jid, m, reply }) => {
      try {
        const d = await helpers.getJson(`https://api.waifu.pics/sfw/${endpoint}`);
        if (!d?.url) return reply('No image returned.');
        const buf = await helpers.downloadToBuffer(d.url, { timeout: 20000 });
        await sock.sendMessage(jid, { image: buf, caption: `#${name}` }, { quoted: m });
      } catch (e) { reply(`Failed: ${e?.message}`); }
    },
  };
}

module.exports = [
  endpointCmd('waifu', 'waifu', 'Random anime waifu'),
  endpointCmd('neko', 'neko', 'Random neko'),
  endpointCmd('hug', 'hug', 'Send a hug'),
  endpointCmd('kiss', 'kiss', 'Send a kiss'),
  endpointCmd('pat', 'pat', 'Pat someone'),
  endpointCmd('cuddle', 'cuddle', 'Cuddle'),
  endpointCmd('slap', 'slap', 'Slap someone (anime)'),
  endpointCmd('smile', 'smile', 'Anime smile'),
  endpointCmd('wave', 'wave', 'Anime wave'),
  endpointCmd('blush', 'blush', 'Anime blush'),
  endpointCmd('highfive', 'highfive', 'Anime high-five'),
  endpointCmd('handhold', 'handhold', 'Anime hand-hold'),
];

'use strict';
function makeSubmenu(name, items) {
  return {
    name,
    description: `${name} sub-menu`,
    handler: async ({ reply }) => reply(`*${name.toUpperCase()}*\n` + items.map(i => `• ${i}`).join('\n')),
  };
}

module.exports = [
  makeSubmenu('animes', ['waifu', 'neko', 'hug', 'kiss', 'pat', 'cuddle']),
  makeSubmenu('audiofx', ['bass', 'deep', 'fast', 'slow', 'reverse', 'tupai', 'nightcore']),
  makeSubmenu('notes', ['.addnote', '.delnote', '.listnotes', '.getnote']),
  makeSubmenu('privacy', ['.online', '.offline', '.read on/off', '.lastseen on/off']),
  makeSubmenu('images', ['.coding', '.cyberimg', '.game', '.islamic', '.mountain', '.pies', '.tech']),
  makeSubmenu('stext', ['.smallcaps', '.bold', '.italic', '.mono']),
  makeSubmenu('ephoto', ['.glitch', '.neon', '.metallic', '.fire']),
];

'use strict';
// Sub-menus that document related commands. Every entry below is now backed
// by a real, working command somewhere in the registry.
function makeSubmenu(name, items) {
  return {
    name,
    description: `${name} sub-menu`,
    handler: async ({ reply }) => reply(`*${name.toUpperCase()}*\n` + items.map(i => `• ${i}`).join('\n')),
  };
}

module.exports = [
  makeSubmenu('animes', ['.waifu', '.neko', '.hug', '.kiss', '.pat', '.cuddle']),
  makeSubmenu('audiofx', ['.bass', '.deep', '.fast', '.slow', '.reverse', '.nightcore']),
  makeSubmenu('notes', ['.addnote <name> | <text>', '.delnote <name>', '.listnotes', '.getnote <name>']),
  makeSubmenu('privacy', ['.online', '.offline', '.read on/off', '.stealth on/off']),
  makeSubmenu('images', ['.coding', '.cyberimg', '.game', '.islamic', '.mountain', '.pies', '.tech']),
  makeSubmenu('stext', ['.smallcaps', '.bold', '.italic', '.mono', '.strike', '.underline']),
  makeSubmenu('ephoto', ['.glitchtxt <text>', '.neontxt <text>', '.firetxt <text>', '.metaltxt <text>']),
];

'use strict';
const helpers = require('../../lib/helpers');

module.exports = [
  { name: '8ball', description: 'Magic 8-ball', handler: async ({ reply }) => reply(helpers.pickRandom(['Yes','No','Maybe','Definitely','Ask again later','Without a doubt','Very doubtful'])) },
  { name: 'fact', description: 'Random fact', handler: async ({ reply }) => {
    try { const d = await helpers.getJson('https://uselessfacts.jsph.pl/random.json?language=en'); reply(d.text); }
    catch { reply('Honey never spoils.'); }
  } },
  { name: 'joke', description: 'Random joke', handler: async ({ reply }) => {
    try { const d = await helpers.getJson('https://official-joke-api.appspot.com/random_joke'); reply(`${d.setup}\n— ${d.punchline}`); }
    catch { reply('Why do programmers confuse Halloween and Christmas? Because Oct 31 == Dec 25.'); }
  } },
  { name: 'joke2', description: 'Dad joke', handler: async ({ reply }) => {
    try { const d = await helpers.getJson('https://icanhazdadjoke.com/', { headers: { Accept: 'application/json' } }); reply(d.joke); }
    catch { reply('I told my wife she should embrace her mistakes. She gave me a hug.'); }
  } },
  { name: 'meme', description: 'Random meme', handler: async ({ sock, jid, m, reply }) => {
    try {
      const d = await helpers.getJson('https://meme-api.com/gimme');
      const buf = await helpers.downloadToBuffer(d.url);
      await sock.sendMessage(jid, { image: buf, caption: d.title }, { quoted: m });
    } catch (e) { reply(`Failed: ${e?.message}`); }
  } },
  { name: 'flirt', description: 'A pick-up line', handler: async ({ reply }) => reply(helpers.pickRandom(['Are you a parking ticket? Because you have FINE written all over you.','Do you believe in love at first sight, or should I walk by again?'])) },
  { name: 'hack', description: 'Fake hacking screen', handler: async ({ reply }) => reply('```\n[+] Connecting to mainframe...\n[+] Bypassing firewall...\n[+] Downloading entire internet (3GB/s)\n[#] Done. Welcome, Neo.\n```') },
  { name: 'teddy', description: 'Send a teddy', handler: async ({ reply }) => reply('🧸') },
  { name: 'why', description: 'Random why question', handler: async ({ reply }) => {
    try { const d = await helpers.getJson('https://nekos.life/api/v2/why'); reply(d.why); }
    catch { reply('Why do we drive on parkways and park on driveways?'); }
  } },
];

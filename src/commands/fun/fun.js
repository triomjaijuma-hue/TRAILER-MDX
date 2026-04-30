'use strict';
const helpers = require('../../lib/helpers');

module.exports = [
  { name: '8ball', aliases: ['8balls', 'eightball', 'magic8'], description: 'Magic 8-ball', handler: async ({ argText, reply }) => {
    const answers = ['It is certain.','Without a doubt.','Yes, definitely.','You may rely on it.','As I see it, yes.','Most likely.','Outlook good.','Yes.','Signs point to yes.','Reply hazy, try again.','Ask again later.','Better not tell you now.','Cannot predict now.','Concentrate and ask again.','Don\'t count on it.','My reply is no.','My sources say no.','Outlook not so good.','Very doubtful.'];
    reply(`🎱 ${argText ? `*Q:* ${argText}\n` : ''}*A:* ${helpers.pickRandom(answers)}`);
  } },
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

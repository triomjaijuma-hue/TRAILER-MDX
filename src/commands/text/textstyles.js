'use strict';
// Unicode text-style commands. Pure JS, no API needed.

const tables = {
  bold:   { lower: '𝗮𝗯𝗰𝗱𝗲𝗳𝗴𝗵𝗶𝗷𝗸𝗹𝗺𝗻𝗼𝗽𝗾𝗿𝘀𝘁𝘂𝘃𝘄𝘅𝘆𝘇', upper: '𝗔𝗕𝗖𝗗𝗘𝗙𝗚𝗛𝗜𝗝𝗞𝗟𝗠𝗡𝗢𝗣𝗤𝗥𝗦𝗧𝗨𝗩𝗪𝗫𝗬𝗭', digits: '𝟬𝟭𝟮𝟯𝟰𝟱𝟲𝟳𝟴𝟵' },
  italic: { lower: '𝘢𝘣𝘤𝘥𝘦𝘧𝘨𝘩𝘪𝘫𝘬𝘭𝘮𝘯𝘰𝘱𝘲𝘳𝘴𝘵𝘶𝘷𝘸𝘹𝘺𝘻', upper: '𝘈𝘉𝘊𝘋𝘌𝘍𝘎𝘏𝘐𝘑𝘒𝘓𝘔𝘕𝘖𝘗𝘘𝘙𝘚𝘛𝘜𝘝𝘞𝘟𝘠𝘡', digits: '0123456789' },
  mono:   { lower: '𝚊𝚋𝚌𝚍𝚎𝚏𝚐𝚑𝚒𝚓𝚔𝚕𝚖𝚗𝚘𝚙𝚚𝚛𝚜𝚝𝚞𝚟𝚠𝚡𝚢𝚣', upper: '𝙰𝙱𝙲𝙳𝙴𝙵𝙶𝙷𝙸𝙹𝙺𝙻𝙼𝙽𝙾𝙿𝚀𝚁𝚂𝚃𝚄𝚅𝚆𝚇𝚈𝚉', digits: '𝟶𝟷𝟸𝟹𝟺𝟻𝟼𝟽𝟾𝟿' },
  script: { lower: '𝓪𝓫𝓬𝓭𝓮𝓯𝓰𝓱𝓲𝓳𝓴𝓵𝓶𝓷𝓸𝓹𝓺𝓻𝓼𝓽𝓾𝓿𝔀𝔁𝔂𝔃', upper: '𝓐𝓑𝓒𝓓𝓔𝓕𝓖𝓗𝓘𝓙𝓚𝓛𝓜𝓝𝓞𝓟𝓠𝓡𝓢𝓣𝓤𝓥𝓦𝓧𝓨𝓩', digits: '0123456789' },
  bubble: { lower: 'ⓐⓑⓒⓓⓔⓕⓖⓗⓘⓙⓚⓛⓜⓝⓞⓟⓠⓡⓢⓣⓤⓥⓦⓧⓨⓩ', upper: 'ⒶⒷⒸⒹⒺⒻⒼⒽⒾⒿⓀⓁⓂⓃⓄⓅⓆⓇⓈⓉⓊⓋⓌⓍⓎⓏ', digits: '⓪①②③④⑤⑥⑦⑧⑨' },
};

function transform(style, text) {
  const t = tables[style];
  if (!t) return text;
  const lower = [...t.lower];
  const upper = [...t.upper];
  const digits = [...t.digits];
  let out = '';
  for (const ch of text) {
    const c = ch.charCodeAt(0);
    if (c >= 97 && c <= 122) out += lower[c - 97];
    else if (c >= 65 && c <= 90) out += upper[c - 65];
    else if (c >= 48 && c <= 57) out += digits[c - 48];
    else out += ch;
  }
  return out;
}

function styleCmd(name, style) {
  return {
    name,
    description: `Convert text to ${name} (Unicode)`,
    handler: async ({ argText, reply }) => {
      if (!argText) return reply(`Usage: .${name} <text>`);
      reply(transform(style, argText));
    },
  };
}

module.exports = [
  styleCmd('bold',   'bold'),
  styleCmd('italic', 'italic'),
  styleCmd('mono',   'mono'),
  styleCmd('script', 'script'),
  styleCmd('bubble', 'bubble'),
  { name: 'wabold', description: 'Wrap with WhatsApp *bold*', handler: async ({ argText, reply }) => reply(`*${argText}*`) },
  { name: 'waitalic', description: 'Wrap with WhatsApp _italic_', handler: async ({ argText, reply }) => reply(`_${argText}_`) },
  { name: 'strike', description: 'Wrap with WhatsApp ~strike~', handler: async ({ argText, reply }) => reply(`~${argText}~`) },
  { name: 'underline', description: 'Pseudo-underline (combining char)', handler: async ({ argText, reply }) => reply([...argText].map(c => c + '\u0332').join('')) },
];

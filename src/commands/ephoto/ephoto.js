'use strict';
// Local text-effect images (no external API).
// ephoto360 / xteam etc. are dead — render with sharp + SVG instead.
const sharp = require('sharp');

function safe(t) { return String(t || '').slice(0, 40).replace(/[<&>]/g, ''); }
function fontSize(text) {
  const len = [...text].length;
  return len <= 8 ? 130 : len <= 14 ? 100 : len <= 22 ? 80 : 60;
}

function svg(text, build) {
  const t = safe(text);
  const fs = fontSize(t);
  return Buffer.from(
    `<svg xmlns='http://www.w3.org/2000/svg' width='800' height='400' viewBox='0 0 800 400'>${build(t, fs)}</svg>`
  );
}

async function send(ctx, buf) {
  await ctx.sock.sendMessage(ctx.jid, { image: buf, caption: '#ephoto' }, { quoted: ctx.m });
}

const cmds = {
  glitchtxt: (t, fs) =>
    `<rect width='100%' height='100%' fill='#000'/>
     <text x='50%' y='50%' text-anchor='middle' dy='.35em' font-family='Impact, sans-serif' font-size='${fs}' fill='#ff0040' transform='translate(-4,0)'>${t}</text>
     <text x='50%' y='50%' text-anchor='middle' dy='.35em' font-family='Impact, sans-serif' font-size='${fs}' fill='#00f0ff' transform='translate(4,2)'>${t}</text>
     <text x='50%' y='50%' text-anchor='middle' dy='.35em' font-family='Impact, sans-serif' font-size='${fs}' fill='#ffffff'>${t}</text>`,
  neontxt: (t, fs) =>
    `<defs><filter id='g'><feGaussianBlur stdDeviation='3'/></filter></defs>
     <rect width='100%' height='100%' fill='#0b0014'/>
     <text x='50%' y='50%' text-anchor='middle' dy='.35em' font-family='Impact, sans-serif' font-size='${fs}' fill='#ff00cc' filter='url(#g)'>${t}</text>
     <text x='50%' y='50%' text-anchor='middle' dy='.35em' font-family='Impact, sans-serif' font-size='${fs}' fill='#ffffff'>${t}</text>`,
  firetxt: (t, fs) =>
    `<defs><linearGradient id='f' x1='0' y1='1' x2='0' y2='0'>
       <stop offset='0%' stop-color='#ffea00'/><stop offset='50%' stop-color='#ff7300'/><stop offset='100%' stop-color='#c20000'/>
     </linearGradient></defs>
     <rect width='100%' height='100%' fill='#1a0500'/>
     <text x='50%' y='50%' text-anchor='middle' dy='.35em' font-family='Impact, sans-serif' font-size='${fs}' fill='url(#f)' stroke='#000' stroke-width='2'>${t}</text>`,
  metaltxt: (t, fs) =>
    `<defs><linearGradient id='m' x1='0' y1='0' x2='0' y2='1'>
       <stop offset='0%' stop-color='#dfe9f3'/><stop offset='50%' stop-color='#7b8794'/><stop offset='100%' stop-color='#1f2a36'/>
     </linearGradient></defs>
     <rect width='100%' height='100%' fill='#0a0e14'/>
     <text x='50%' y='50%' text-anchor='middle' dy='.35em' font-family='Impact, sans-serif' font-size='${fs}' fill='url(#m)' stroke='#000' stroke-width='2'>${t}</text>`,
  galaxytxt: (t, fs) =>
    `<defs><linearGradient id='g' x1='0' y1='0' x2='1' y2='1'>
       <stop offset='0%' stop-color='#7b2ff7'/><stop offset='100%' stop-color='#f107a3'/>
     </linearGradient></defs>
     <rect width='100%' height='100%' fill='#000010'/>
     <text x='50%' y='50%' text-anchor='middle' dy='.35em' font-family='Impact, sans-serif' font-size='${fs}' fill='url(#g)' stroke='#fff' stroke-width='1'>${t}</text>`,
};

module.exports = Object.entries(cmds).map(([name, build]) => ({
  name,
  description: `Stylized text image: .${name} <text>`,
  handler: async (ctx) => {
    if (!ctx.argText) return ctx.reply(`Usage: .${name} <text>`);
    try {
      const png = await sharp(svg(ctx.argText, build)).png().toBuffer();
      await send(ctx, png);
    } catch (e) { ctx.reply(`Render failed: ${e?.message}`); }
  },
}));

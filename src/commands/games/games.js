'use strict';
const helpers = require('../../lib/helpers');
const gs = require('../../lib/gameSessions');

const TRIVIA = [
  { q: 'Capital of Uganda?', a: 'Kampala' },
  { q: 'Capital of France?', a: 'Paris' },
  { q: 'Largest ocean?', a: 'Pacific' },
  { q: 'Smallest planet in our solar system?', a: 'Mercury' },
  { q: 'Author of "1984"?', a: 'Orwell' },
  { q: 'Speed of light (km/s) — first 6 digits?', a: '299792' },
  { q: 'How many sides does a hexagon have?', a: '6' },
  { q: 'What gas do plants absorb from the air?', a: 'CO2' },
  { q: 'What is the chemical symbol for gold?', a: 'Au' },
  { q: 'How many continents are there?', a: '7' },
  { q: 'In which country is the Great Wall?', a: 'China' },
  { q: 'What is the longest river in the world?', a: 'Nile' },
  { q: 'What year did World War II end?', a: '1945' },
  { q: 'How many bones in the adult human body?', a: '206' },
  { q: 'What is H2O?', a: 'Water' },
  { q: 'Who painted the Mona Lisa?', a: 'Da Vinci' },
  { q: 'What is the hardest natural substance?', a: 'Diamond' },
  { q: 'How many strings on a standard guitar?', a: '6' },
  { q: 'Which planet has the most moons?', a: 'Saturn' },
  { q: 'How many minutes in a day?', a: '1440' },
  { q: 'What is the capital of Japan?', a: 'Tokyo' },
  { q: 'How many players in a soccer team?', a: '11' },
  { q: 'Which element has symbol "O"?', a: 'Oxygen' },
  { q: 'What is the largest mammal on Earth?', a: 'Blue whale' },
  { q: 'How many teeth does an adult human have?', a: '32' },
  { q: 'What is the square root of 144?', a: '12' },
  { q: 'Capital of Brazil?', a: 'Brasilia' },
  { q: 'Who wrote "Romeo and Juliet"?', a: 'Shakespeare' },
  { q: 'What is 15 × 15?', a: '225' },
  { q: 'Tallest mountain on Earth?', a: 'Everest' },
  { q: 'How many days in a leap year?', a: '366' },
  { q: 'Language with most native speakers?', a: 'Mandarin' },
  { q: 'Who discovered penicillin?', a: 'Fleming' },
  { q: 'Capital of Kenya?', a: 'Nairobi' },
  { q: 'How many seconds in an hour?', a: '3600' },
  { q: 'Chemical symbol for Iron?', a: 'Fe' },
  { q: 'Which country invented pizza?', a: 'Italy' },
  { q: 'How many planets in our solar system?', a: '8' },
  { q: 'What is the powerhouse of the cell?', a: 'Mitochondria' },
];

const TRUTHS = [
  'What is your worst habit?',
  'What was the last lie you told?',
  'What is your biggest fear?',
  'Have you ever cheated on a test?',
  'What is the most embarrassing thing that has happened to you?',
  'Have you ever broken a promise?',
  'What is something you have never told anyone?',
  'What would you do with one million dollars?',
  'What is your most irrational fear?',
  'Who was your first celebrity crush?',
  'Have you ever pretended to be sick to skip school or work?',
  'What is the worst gift you have ever received?',
  'If you could change one thing about yourself, what would it be?',
];

const DARES = [
  'Send a 30-second voice note singing your favourite song.',
  'Text your crush "hi" right now.',
  'Do 10 push-ups and send a voice note counting them.',
  'Send the last photo you took.',
  'Write a funny poem about the last person who texted you.',
  'Set your profile photo to a funny selfie for 10 minutes.',
  'Call a friend and say "I have a secret" then hang up.',
  'Send a voice note doing your best animal impression.',
  'Message a random contact and say "miss you".',
  'Try to lick your elbow for 10 seconds.',
  'Go outside and wave at 3 strangers.',
  'Eat a spoonful of something unusual from your kitchen.',
];

const WYR = [
  'Would you rather be rich but lonely OR poor but loved?',
  'Would you rather fly OR be invisible?',
  'Would you rather live without music OR without TV?',
  'Would you rather always be 10 minutes late OR 20 minutes early?',
  'Would you rather speak every language OR play every instrument?',
  'Would you rather have a rewind button OR a pause button for life?',
  'Would you rather be famous OR be the best friend of someone famous?',
  'Would you rather lose all your money OR all your photos?',
  'Would you rather only eat sweet OR only eat savoury forever?',
  'Would you rather be able to read minds OR predict the future?',
];

const HANGMAN_WORDS = [
  'javascript','whatsapp','railway','baileys','sticker','elephant','keyboard',
  'butterfly','chocolate','adventure','universe','password','computer','mountain',
  'umbrella','diamond','birthday','football','internet','champion','hospital',
  'treasure','musician','language','creative','strategy','engineer','scientist',
  'geography','crocodile','telescope','fireworks','pineapple','submarine',
];

const DICE_ART = [
  '',
  '```\n┌─────────┐\n│         │\n│    ●    │\n│         │\n└─────────┘```',
  '```\n┌─────────┐\n│  ●      │\n│         │\n│      ●  │\n└─────────┘```',
  '```\n┌─────────┐\n│  ●      │\n│    ●    │\n│      ●  │\n└─────────┘```',
  '```\n┌─────────┐\n│  ●   ●  │\n│         │\n│  ●   ●  │\n└─────────┘```',
  '```\n┌─────────┐\n│  ●   ●  │\n│    ●    │\n│  ●   ●  │\n└─────────┘```',
  '```\n┌─────────┐\n│  ●   ●  │\n│  ●   ●  │\n│  ●   ●  │\n└─────────┘```',
];

function gameMenu() {
  return [
    '🎮 *GAMES MENU*', '',
    '  .dado / .dice  —  🎲 Roll a dice',
    '  .truth         —  🤔 Random truth question',
    '  .dare          —  😈 Random dare challenge',
    '  .wyr           —  🤷 Would You Rather?',
    '  .trivia        —  🧠 Trivia — reply with answer',
    '  .math          —  🧮 Math problem — reply with answer',
    '  .hangman       —  🪢 Hangman — reply with letter or word',
    '  .tictactoe     —  ⭕ Tic-Tac-Toe vs bot — reply 1-9',
    '',
    '_Start any game by typing the command above._',
  ].join('\n');
}

module.exports = [
  {
    name: 'game', aliases: ['games'],
    description: 'Show available games',
    handler: async ({ reply }) => reply(gameMenu()),
  },
  {
    name: 'dado', aliases: ['dice'],
    description: 'Roll a dice',
    handler: async ({ reply }) => {
      const n = 1 + Math.floor(Math.random() * 6);
      reply(`🎲 You rolled a *${n}*!\n${DICE_ART[n]}`);
    },
  },
  {
    name: 'truth',
    description: 'Random truth question',
    handler: async ({ reply }) => reply(`🤔 *TRUTH*\n\n${helpers.pickRandom(TRUTHS)}`),
  },
  {
    name: 'dare',
    description: 'Random dare challenge',
    handler: async ({ reply }) => reply(`😈 *DARE*\n\n${helpers.pickRandom(DARES)}`),
  },
  {
    name: 'wyr',
    description: 'Would You Rather?',
    handler: async ({ reply }) => reply(`🤷 *WOULD YOU RATHER?*\n\n${helpers.pickRandom(WYR)}`),
  },
  {
    name: 'trivia',
    description: 'Trivia question — reply with your answer',
    handler: async ({ jid, reply }) => {
      const t = helpers.pickRandom(TRIVIA);
      gs.set(`trivia:${jid}`, { answer: t.a, question: t.q });
      reply(`🧠 *TRIVIA*\n\n${t.q}\n\n_Reply with your answer!_`);
    },
  },
  {
    name: 'math',
    description: 'Math problem — reply with your answer',
    handler: async ({ jid, reply }) => {
      const ops = [
        () => { const a=10+Math.floor(Math.random()*90), b=10+Math.floor(Math.random()*90); return { q:`${a} + ${b} = ?`, a: a+b }; },
        () => { const a=20+Math.floor(Math.random()*80), b=10+Math.floor(Math.random()*20); return { q:`${a} - ${b} = ?`, a: a-b }; },
        () => { const a=2+Math.floor(Math.random()*12),  b=2+Math.floor(Math.random()*12);  return { q:`${a} × ${b} = ?`, a: a*b }; },
        () => { const b=2+Math.floor(Math.random()*10),  a=b*(2+Math.floor(Math.random()*10)); return { q:`${a} ÷ ${b} = ?`, a: a/b }; },
      ];
      const { q, a } = helpers.pickRandom(ops)();
      gs.set(`math:${jid}`, { answer: a, question: q });
      reply(`🧮 *MATH*\n\n${q}\n\n_Reply with your answer!_`);
    },
  },
  {
    name: 'hangman',
    description: 'Start a hangman game — reply with a letter or word',
    handler: async ({ jid, reply }) => {
      const word = helpers.pickRandom(HANGMAN_WORDS);
      gs.set(`hangman:${jid}`, { word, guessed: new Set(), wrong: 0, maxWrong: 6 });
      const display = '_ '.repeat(word.length).trim();
      reply(
        `🪢 *HANGMAN* — New game!\n\n` +
        `${gs.HANGMAN_ART[0]}\n` +
        `${display}\n\n` +
        `Word length: *${word.length} letters*  |  Lives: 6\n\n` +
        `_Reply with a single letter to guess, or type the full word!_`,
      );
    },
  },
  {
    name: 'tictactoe', aliases: ['ttt'],
    description: 'Tic-Tac-Toe vs bot — reply 1-9 to move',
    handler: async ({ jid, reply }) => {
      gs.set(`ttt:${jid}`, { board: Array(9).fill(null) });
      reply(
        `⭕ *TIC-TAC-TOE*\nYou are *X*, bot is *O*\n\n` +
        `${gs.renderBoard(Array(9).fill(null))}\n\n` +
        `_Reply with a number 1-9 to place your X._`,
      );
    },
  },
];

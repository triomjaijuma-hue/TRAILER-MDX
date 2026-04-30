'use strict';
// Shared game-session registry.
// games.js writes sessions here; handler.js reads them for every incoming
// message so replies to trivia/math/hangman/tictactoe are detected even
// when the user doesn't type a prefix.

const sessions = new Map(); // key → { type, data, jid }

function set(key, value) { sessions.set(key, value); }
function get(key)        { return sessions.get(key); }
function del(key)        { sessions.delete(key); }
function has(key)        { return sessions.has(key); }
function clear(jid) {
  for (const k of sessions.keys()) {
    if (k.includes(':' + jid)) sessions.delete(k);
  }
}

// Called by handler.js for every incoming message that doesn't start with
// a command prefix. Returns a reply string if there was an active session,
// or null if nothing matched.
function checkAnswer(jid, rawText) {
  const text = (rawText || '').trim();
  if (!text) return null;

  // --- trivia ---
  const triviaKey = `trivia:${jid}`;
  if (sessions.has(triviaKey)) {
    const { answer, question } = sessions.get(triviaKey);
    sessions.delete(triviaKey);
    const correct = text.toLowerCase().replace(/[^a-z0-9]/g, '') ===
                    answer.toLowerCase().replace(/[^a-z0-9]/g, '');
    return correct
      ? `✅ Correct! *${answer}* is right! 🎉`
      : `❌ Wrong! The answer was *${answer}*.\n_Question was: ${question}_`;
  }

  // --- math ---
  const mathKey = `math:${jid}`;
  if (sessions.has(mathKey)) {
    const { answer, question } = sessions.get(mathKey);
    sessions.delete(mathKey);
    const num = parseInt(text.replace(/[^0-9\-]/g, ''), 10);
    return num === answer
      ? `✅ Correct! *${answer}* is right! 🎉`
      : `❌ Wrong! ${question} = *${answer}*`;
  }

  // --- hangman ---
  const hangKey = `hangman:${jid}`;
  if (sessions.has(hangKey)) {
    const state = sessions.get(hangKey);
    const guess = text.toLowerCase();

    // Single letter guess
    if (/^[a-z]$/.test(guess)) {
      if (state.guessed.has(guess)) return `You already guessed *${guess.toUpperCase()}*. Try another letter.`;
      state.guessed.add(guess);
      if (!state.word.includes(guess)) state.wrong++;
      const display = state.word.split('').map(c => state.guessed.has(c) ? c.toUpperCase() : '_').join(' ');
      const won = !display.includes('_');
      const lost = state.wrong >= state.maxWrong;
      if (won)  { sessions.delete(hangKey); return `🎉 You won! The word was *${state.word.toUpperCase()}*!`; }
      if (lost) { sessions.delete(hangKey); return `💀 Game over! The word was *${state.word.toUpperCase()}*.\n${HANGMAN_ART[state.maxWrong]}`; }
      sessions.set(hangKey, state);
      return `${HANGMAN_ART[state.wrong]}\n${display}\nWrong: ${state.wrong}/${state.maxWrong}  Guessed: ${[...state.guessed].join(' ')}`;
    }

    // Full word guess
    if (/^[a-z]+$/.test(guess)) {
      if (guess === state.word) {
        sessions.delete(hangKey);
        return `🎉 Correct! The word was *${state.word.toUpperCase()}*!`;
      }
      state.wrong += 2;
      if (state.wrong >= state.maxWrong) {
        sessions.delete(hangKey);
        return `💀 Wrong word guess! Game over. The word was *${state.word.toUpperCase()}*.`;
      }
      sessions.set(hangKey, state);
      const display = state.word.split('').map(c => state.guessed.has(c) ? c.toUpperCase() : '_').join(' ');
      return `❌ *${text.toUpperCase()}* is wrong! (-2 lives)\n${HANGMAN_ART[state.wrong]}\n${display}\nLives left: ${state.maxWrong - state.wrong}`;
    }

    return null;
  }

  // --- tictactoe ---
  const tttKey = `ttt:${jid}`;
  if (sessions.has(tttKey)) {
    const move = parseInt(text, 10);
    if (isNaN(move) || move < 1 || move > 9) {
      return `Enter a number 1–9 to place your *X*.\n${renderBoard(sessions.get(tttKey).board)}`;
    }
    return tttMove(jid, move);
  }

  return null;
}

// --- Hangman art --------------------------------------------------------
const HANGMAN_ART = [
  '```\n  +---+\n  |   |\n      |\n      |\n      |\n      |\n=========```',
  '```\n  +---+\n  |   |\n  O   |\n      |\n      |\n      |\n=========```',
  '```\n  +---+\n  |   |\n  O   |\n  |   |\n      |\n      |\n=========```',
  '```\n  +---+\n  |   |\n  O   |\n /|   |\n      |\n      |\n=========```',
  '```\n  +---+\n  |   |\n  O   |\n /|\\  |\n      |\n      |\n=========```',
  '```\n  +---+\n  |   |\n  O   |\n /|\\  |\n /    |\n      |\n=========```',
  '```\n  +---+\n  |   |\n  O   |\n /|\\  |\n / \\  |\n      |\n=========```',
];

// --- Tic-tac-toe helpers ------------------------------------------------
function renderBoard(board) {
  const s = board.map((c, i) => c || String(i + 1));
  return (
    `\`\`\`\n ${s[0]} | ${s[1]} | ${s[2]} \n---+---+---\n ${s[3]} | ${s[4]} | ${s[5]} \n---+---+---\n ${s[6]} | ${s[7]} | ${s[8]} \n\`\`\``
  );
}

const TTT_WINS = [[0,1,2],[3,4,5],[6,7,8],[0,3,6],[1,4,7],[2,5,8],[0,4,8],[2,4,6]];
function checkWin(board, mark) {
  return TTT_WINS.some(([a,b,c]) => board[a]===mark && board[b]===mark && board[c]===mark);
}
function bestMove(board) {
  // Minimax with α-β for unbeatable AI (depth ≤ 9 so instant)
  const empty = board.reduce((a, c, i) => c ? a : [...a, i], []);
  if (!empty.length) return -1;

  let best = -Infinity, move = empty[0];
  for (const i of empty) {
    board[i] = 'O';
    const score = minimax(board, false, -Infinity, Infinity);
    board[i] = null;
    if (score > best) { best = score; move = i; }
  }
  return move;
}
function minimax(board, isMax, alpha, beta) {
  if (checkWin(board, 'O')) return 10;
  if (checkWin(board, 'X')) return -10;
  const empty = board.reduce((a,c,i) => c ? a : [...a,i], []);
  if (!empty.length) return 0;
  let best = isMax ? -Infinity : Infinity;
  for (const i of empty) {
    board[i] = isMax ? 'O' : 'X';
    const s = minimax(board, !isMax, alpha, beta);
    board[i] = null;
    if (isMax) { best = Math.max(best, s); alpha = Math.max(alpha, best); }
    else        { best = Math.min(best, s); beta  = Math.min(beta,  best); }
    if (beta <= alpha) break;
  }
  return best;
}

function tttMove(jid, cell) {
  const tttKey = `ttt:${jid}`;
  const state = sessions.get(tttKey);
  const idx = cell - 1;

  if (state.board[idx]) return `Cell ${cell} is already taken. Pick another (1–9).\n${renderBoard(state.board)}`;

  state.board[idx] = 'X';
  if (checkWin(state.board, 'X')) {
    sessions.delete(tttKey);
    return `${renderBoard(state.board)}\n🎉 You won! Congratulations! Type *.tictactoe* to play again.`;
  }
  const empty = state.board.reduce((a,c,i) => c ? a : [...a,i], []);
  if (!empty.length) {
    sessions.delete(tttKey);
    return `${renderBoard(state.board)}\n🤝 It's a draw! Type *.tictactoe* to play again.`;
  }
  const ai = bestMove(state.board);
  state.board[ai] = 'O';
  sessions.set(tttKey, state);

  if (checkWin(state.board, 'O')) {
    sessions.delete(tttKey);
    return `${renderBoard(state.board)}\n🤖 Bot wins! Better luck next time. Type *.tictactoe* to play again.`;
  }
  const empty2 = state.board.reduce((a,c,i) => c ? a : [...a,i], []);
  if (!empty2.length) {
    sessions.delete(tttKey);
    return `${renderBoard(state.board)}\n🤝 It's a draw! Type *.tictactoe* to play again.`;
  }
  return `${renderBoard(state.board)}\nYour turn — reply with a number (1–9).`;
}

module.exports = { set, get, del, has, clear, checkAnswer, renderBoard, HANGMAN_ART };

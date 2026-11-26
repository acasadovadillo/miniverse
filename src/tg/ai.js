// How the neighbours play (docs/planes/gta/PLAN-I-juntos.md §1.2): pure, AI[game](state, seat, temper, rng) → a move. Nobody is far
// better than anybody else (the test plays 2000 games of each): the characters only show in how long they push their luck.
import { crows, TARGET } from './crows.js';
import { tiles, places, pips } from './tiles.js';

// Crows. calm: the pot they bank with no crow or one down (the odds hardly ask for it: it is their nerves); two: with two down
export const NERVE = {
  shy: { calm: 52, two: 16 }, kind: { calm: 50, two: 15 }, cheerful: { calm: 54, two: 16 }, wry: { calm: 54, two: 18 }, gruff: { calm: 64, two: 22 },
};
const BEHIND = 20, PUSH = 1.35;   // this far behind, they push a little more
// Bridge: the cautious keep the doubles for last (they match only one number: a small mistake, as in life)
const CAUTIOUS = new Set(['shy', 'kind']), KEEP = 1;

export const AI = {
  crows(st, seat, temper) {
    const L = crows.legal(st, seat);
    if (!L.includes('bank')) return 'roll';
    const N = NERVE[temper] || NERVE.cheerful, top = Math.max(...st.bank.map((b, i) => (i === seat || st.out.includes(i) ? 0 : b))), mine = st.bank[seat] + st.pot;
    // (somebody is already there: this turn must pass them, so nothing less is worth banking)
    if (top >= TARGET && mine <= top && endsRound(st, seat)) return 'roll';
    // (with what is in the pot they are there, and it is the last turn of the round: it is won)
    if (mine >= TARGET && mine > top) return 'bank';
    const k = top - st.bank[seat] > BEHIND ? PUSH : 1;
    return st.pot >= (st.crows >= 2 ? N.two : N.calm) * k ? 'bank' : 'roll';
  },
  tiles(st, seat, temper) {
    const hand = st.hands[seat], P = places(st, hand), L = tiles.legal(st, seat);
    if (!P.length) return L[0];
    const heavy = ([i]) => pips(hand[i]) - (CAUTIOUS.has(temper) && hand[i][0] === hand[i][1] ? KEEP : 0);
    const best = P.reduce((a, q) => (heavy(q) > heavy(a) ? q : a));
    return ['play', ...best];
  },
};
// Is this the last seat to play of the round?
function endsRound(st, seat) {
  const n = st.bank.length;
  for (let i = 1; i < n; i++) { const q = (seat + i) % n; if (st.out.includes(q)) continue; return q === firstOf(st); }
  return true;
}
function firstOf(st) { const n = st.bank.length; for (let i = 0; i < n; i++) { const q = (st.first + i) % n; if (!st.out.includes(q)) return q; } return st.first; }

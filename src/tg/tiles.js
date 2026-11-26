// Bridge tiles (Fichas del puente): the rules, and nothing else. Our own game: docs/planes/gta/PLAN-I-juntos.md §1.2
//   21 tiles with two ends of 0 to 5 pips, every pair once. Five each; the rest is the pile. Whoever holds the highest double starts
//   (with none dealt, the highest pip total). You play a tile that matches an open end of the bridge. If you cannot, you draw one
//   and may play it; with no pile, you pass. The first with an empty hand wins. If everybody passes, the bridge is blocked and the
//   lowest pip total in hand wins; a tie splits the pot.
// A move: ['play', i (of the hand), 'l' | 'r'], 'draw' or 'pass'. A state is plain data; apply() gives a new one.
export const HAND = 5, TOP = 5;
export const allTiles = () => { const out = []; for (let a = 0; a <= TOP; a++) for (let b = a; b <= TOP; b++) out.push([a, b]); return out; };
export const pips = ([a, b]) => a + b;
export const handPips = h => h.reduce((s, q) => s + pips(q), 0);

const alive = st => st.hands.map((_, i) => i).filter(i => !st.out.includes(i));
// The places a hand's tile may be played at: [[i, side], …] (the first of the game, only one side: 'r')
export function places(st, hand) {
  const out = [];
  hand.forEach(([a, b], i) => {
    if (!st.bridge.length) { out.push([i, 'r']); return; }
    if (a === st.ends[0] || b === st.ends[0]) out.push([i, 'l']);
    if (st.ends[1] !== st.ends[0] && (a === st.ends[1] || b === st.ends[1])) out.push([i, 'r']);
  });
  return out;
}
const key = mv => (Array.isArray(mv) ? mv.join() : mv);

export const tiles = {
  id: 'tiles', seats: [2, 4],
  start(seats, rng) {
    const T = allTiles();
    for (let i = T.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [T[i], T[j]] = [T[j], T[i]]; }
    const hands = Array.from({ length: seats }, () => T.splice(0, HAND));
    const st = { bridge: [], ends: [], hands, pile: T, passes: 0, drew: false, last: null, turn: 0, out: [] };
    // (the highest double; without any, the highest total of one tile's pips, the first seat of a tie)
    let best = -1;
    hands.forEach((h, i) => { for (const [a, b] of h) if (a === b && a > best) { best = a; st.turn = i; } });
    if (best < 0) { let top = -1; hands.forEach((h, i) => { for (const q of h) if (pips(q) > top) { top = pips(q); st.turn = i; } }); }
    return st;
  },
  legal(st, seat) {
    if (st.over || st.turn !== seat) return [];
    const P = places(st, st.hands[seat]).map(([i, s]) => ['play', i, s]);
    if (st.drew) return [...P, 'pass'];   // (drawn: it may be played, or not)
    if (P.length) return P;
    return st.pile.length ? ['draw'] : ['pass'];
  },
  apply(st, mv) {
    const me = st.turn;
    if (!tiles.legal(st, me).some(q => key(q) === key(mv))) return null;
    const s = structuredClone(st);
    if (mv === 'draw') {
      s.hands[me].push(s.pile.pop());
      s.drew = true; s.last = { k: 'draw', seat: me };
      if (!places(s, s.hands[me]).length) return next(s, false);   // (it cannot be played: the turn passes)
      return s;
    }
    if (mv === 'pass') { const drew = s.drew; s.last = { k: 'pass', seat: me }; return next(s, !drew && !s.pile.length); }
    const [, i, side] = mv, q = s.hands[me].splice(i, 1)[0];
    let [a, b] = q;
    if (!s.bridge.length) { s.bridge.push([a, b]); s.ends = [a, b]; s.start = 0; }
    else if (side === 'l') { if (b !== s.ends[0]) [a, b] = [b, a]; s.bridge.unshift([a, b]); s.ends[0] = a; s.start++; }
    else { if (a !== s.ends[1]) [a, b] = [b, a]; s.bridge.push([a, b]); s.ends[1] = b; }
    s.passes = 0;
    s.last = { k: 'play', seat: me, q, side };
    if (!s.hands[me].length) { s.over = true; s.empty = me; return s; }
    return next(s, false);
  },
  drop(st, seat) {
    const s = structuredClone(st);
    if (!s.out.includes(seat)) s.out.push(seat);
    // (their tiles go under the pile)
    s.pile.unshift(...s.hands[seat].splice(0));
    s.passes = 0;
    if (!s.over && s.turn === seat) { s.last = null; return next(s, false); }
    return s;
  },
  result(st) {
    if (!st.over) return null;
    if (st.empty !== undefined) return { win: [st.empty] };
    const A = alive(st), low = Math.min(...A.map(i => handPips(st.hands[i]))), win = A.filter(i => handPips(st.hands[i]) === low);
    return { win, blocked: true, ...(win.length > 1 && { draw: true }) };
  },
  score: (st, i) => st.hands[i].length,
};
function next(s, passed) {
  const n = s.hands.length;
  s.drew = false;
  s.passes = passed ? s.passes + 1 : 0;
  if (s.passes >= alive(s).length) { s.over = true; return s; }
  do s.turn = (s.turn + 1) % n; while (s.out.includes(s.turn) && s.out.length < n);
  return s;
}

// Crows (Cuervos): the rules, and nothing else (no page, no game). Our own game: docs/planes/gta/PLAN-I-juntos.md §1.2
//   Three dice. Faces 2 to 6 are pips; the 1 is a crow. On your turn you roll the three: the pips go into the turn's pot, the crows
//   stay beside the dice. The third crow of the turn takes the pot and the turn passes; three in one roll ("a murder") also take
//   10 of what you had banked. After a roll with fewer than three crows you roll again or bank. The first to bank 50 wins, but
//   everybody gets the same number of turns.
// A state is plain data, safe to save and to send; apply() gives a new one. rng() gives numbers in [0, 1).
export const TARGET = 50, MURDER = 10, MAX_CROWS = 3, MAX_ROUNDS = 60;

const alive = st => st.bank.map((_, i) => i).filter(i => !st.out.includes(i));
export const crows = {
  id: 'crows', seats: [2, 4],
  start(seats, rng) {
    const first = Math.floor(rng() * seats);
    return { bank: Array(seats).fill(0), pot: 0, crows: 0, dice: null, last: null, turn: first, first, round: 1, out: [] };
  },
  // The moves a seat may do now: ['roll', 'bank'], or none
  legal(st, seat) {
    if (st.over || st.turn !== seat) return [];
    return st.pot > 0 ? ['roll', 'bank'] : ['roll'];
  },
  apply(st, mv, rng) {
    if (!crows.legal(st, st.turn).includes(mv)) return null;
    const s = structuredClone(st), me = s.turn;
    if (mv === 'bank') { s.bank[me] += s.pot; s.last = { k: 'bank', seat: me, n: s.pot }; return next(s); }
    s.dice = [0, 1, 2].map(() => 1 + Math.floor(rng() * 6));
    const got = s.dice.filter(d => d === 1).length, pips = s.dice.reduce((a, d) => a + (d > 1 ? d : 0), 0);
    s.crows += got; s.pot += pips;
    if (s.crows < MAX_CROWS) { s.last = { k: 'roll', seat: me, n: pips, c: s.crows, dice: s.dice }; return s; }
    const murder = got === 3, lost = s.pot;
    if (murder) s.bank[me] = Math.max(0, s.bank[me] - MURDER);
    s.last = { k: murder ? 'murder' : 'bust', seat: me, n: lost, c: MAX_CROWS, dice: s.dice };
    return next(s);
  },
  // A seat that leaves the game (two or more go on)
  drop(st, seat) {
    const s = structuredClone(st);
    if (!s.out.includes(seat)) s.out.push(seat);
    if (!s.over && s.turn === seat) { s.last = null; return next(s); }
    return done(s) ? Object.assign(s, { over: true }) : s;
  },
  // { win: [seats] } when it is over (draw: more than one), or null
  result(st) {
    if (!st.over) return null;
    const A = alive(st), top = Math.max(...A.map(i => st.bank[i])), win = A.filter(i => st.bank[i] === top);
    return { win, ...(win.length > 1 && { draw: true }) };
  },
  score: (st, i) => st.bank[i],
};
// The end of the round is decided at its last turn (whoever sits before the first one)
const done = s => alive(s).some(i => s.bank[i] >= TARGET) && s.turn === first(s) && s.pot === 0 && s.crows === 0;
// Who starts each round (if they left, the next one)
function first(s) { for (let i = 0, n = s.bank.length; i < n; i++) { const q = (s.first + i) % n; if (!s.out.includes(q)) return q; } return s.first; }
function next(s) {
  const n = s.bank.length, f = first(s);
  s.pot = 0; s.crows = 0;
  do s.turn = (s.turn + 1) % n; while (s.out.includes(s.turn) && s.out.length < n);
  if (s.turn === f) { s.round++; if (done(s) || s.round > MAX_ROUNDS) s.over = true; }
  return s;
}

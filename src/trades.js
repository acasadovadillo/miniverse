// Tratos con los vecinos según su oficio, como con los aldeanos de Minecraft: Rosa (granjera), Bruno (herrero), Lía
// (pescadora) y Dani (artesano) cambian unas cosas por otras, casi siempre por esmeraldas o a cambio de ellas. Cada
// trato se puede hacer unas veces al día. Con cada uno el vecino gana oficio (de novato a maestro) y ofrece tratos
// nuevos, y tú ganas experiencia. Es de cada uno, como la amistad.
import { ITEMS } from './items.js';
import { roll } from './xp.js';

export const RANKS = ['novato', 'aprendiz', 'oficial', 'experto', 'maestro'];
const NEED = [0, 10, 70, 150, 250];   // la experiencia de oficio que hace falta para cada rango
// [rango, lo que das, lo que te dan, veces al día, lo que gana de oficio]
const T = (rank, give, get, uses = 12, xp = 2) => ({ rank, give, get, uses, xp });
export const TRADES = {
  rosa: [
    T(0, [['trigo', 20]], [['esmeralda', 1]]), T(0, [['zanahoria', 22]], [['esmeralda', 1]]), T(0, [['esmeralda', 1]], [['pan', 6]], 16, 1),
    T(1, [['calabaza', 6]], [['esmeralda', 1]], 12, 10), T(1, [['esmeralda', 1]], [['tarta_calabaza', 2]], 12, 5),
    T(2, [['manzana', 4]], [['esmeralda', 1]], 12, 20), T(3, [['esmeralda', 3]], [['semilla_manzano', 2]], 12, 15),
    T(4, [['esmeralda', 6]], [['huevo_oro', 1]], 4, 30),
  ],
  bruno: [
    T(0, [['carbon', 15]], [['esmeralda', 1]]), T(0, [['esmeralda', 1]], [['antorcha', 8]], 16, 1),
    T(1, [['lingote_hierro', 4]], [['esmeralda', 1]], 12, 10), T(1, [['esmeralda', 5]], [['casco_hierro', 1]], 3, 5),
    T(2, [['esmeralda', 9]], [['peto_hierro', 1]], 3, 10), T(2, [['lingote_oro', 3]], [['esmeralda', 1]], 12, 20),
    T(3, [['diamante', 1]], [['esmeralda', 2]], 12, 30), T(4, [['esmeralda', 13]], [['espada_oro', 1]], 3, 30),
  ],
  lia: [
    T(0, [['cuerda', 6]], [['esmeralda', 1]]), T(0, [['esmeralda', 1]], [['sardina', 4]], 16, 1),
    T(1, [['trucha', 6]], [['esmeralda', 1]], 12, 10), T(2, [['esmeralda', 3]], [['cana', 1]], 3, 10),
    T(3, [['salmon', 4]], [['esmeralda', 1]], 12, 20), T(4, [['esmeralda', 8]], [['cana_fibra', 1]], 3, 30),
  ],
  dani: [
    T(0, [['tablas', 20]], [['esmeralda', 1]]), T(0, [['esmeralda', 1]], [['maceta', 1]], 12, 1),
    T(1, [['tela', 4]], [['esmeralda', 1]], 12, 10), T(2, [['esmeralda', 2]], [['cuadro_valle', 1]], 12, 10),
    T(3, [['esmeralda', 3]], [['lampara', 1]], 12, 15), T(4, [['esmeralda', 6]], [['estanteria', 2]], 6, 30),
  ],
};
const list = items => items.map(([id, n]) => `${n} × ${ITEMS[id].name.toLowerCase()}`).join(' y ');

// El rango de oficio de un vecino contigo (0 a 4) según su experiencia
export const rankOf = xp => NEED.reduce((r, need, i) => (xp >= need ? i : r), 0);

export class Trades {
  constructor(game) { this.game = game; }
  // Lo de tratos de un vecino (en su amistad): { xp, day, uses }
  state(f) {
    const today = this.game.days.dayIndex;
    f.trade ||= { xp: 0, day: today, uses: {} };
    if (f.trade.day !== today) { f.trade.day = today; f.trade.uses = {}; }   // (cada día vuelven)
    return f.trade;
  }
  // Los tratos que ofrece ahora: [{ i, t, text, left, why }] (why: por qué no se puede, o null)
  offers(id, f) {
    const s = this.state(f), rank = rankOf(s.xp), inv = this.game.inv;
    return (TRADES[id] || []).map((t, i) => ({ i, t })).filter(o => o.t.rank <= rank).map(({ i, t }) => {
      const left = t.uses - (s.uses[i] || 0), short = t.give.find(([gid, n]) => !inv.infinite && inv.count(gid) < n);
      return { i, t, left, text: `${list(t.give)} → ${list(t.get)}${left > 0 ? '' : ' (agotado hoy)'}`, why: left <= 0 ? 'Por hoy ya no: vuelve mañana' : short ? `Te falta ${ITEMS[short[0]].name.toLowerCase()}` : null };
    });
  }
  // Hacer un trato. Devuelve el texto que dice el vecino (o por qué no se puede)
  make(id, f, o, name) {
    const g = this.game, s = this.state(f), inv = g.inv;
    if (o.why) return o.why;
    const before = rankOf(s.xp);
    for (const [gid, n] of o.t.give) inv.remove(gid, n);
    for (const [gid, n] of o.t.get) { const left = inv.add(gid, n); if (left) g.gather.throwOut(gid, left); }
    s.uses[o.i] = (s.uses[o.i] || 0) + 1;
    s.xp += o.t.xp;
    g.xp?.add(roll(3, 6));
    g.stats?.add('tratos', 1);
    const after = rankOf(s.xp);
    return after > before ? `¡Trato hecho! Ya soy ${RANKS[after]}: tengo cosas nuevas para ti.` : '¡Trato hecho!';
  }
  title(id, f, name) { return `${name} · ${RANKS[rankOf(this.state(f).xp)]}`; }
}

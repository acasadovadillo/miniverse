// The barber (Plan E §4.3): what Eusebio charges and what a haircut does. The window is the creator's in its barber mode
// (ui/menus.js onMirror('barber')); the chair, a piece of tavern furniture that is only where you sit meanwhile.
import { realHair } from './three/realperson.js';
import { HAIR_STYLE } from './three/mh/hair.js';
import { MH_ON, packMh } from './three/mh/folk.js';
// (how a style is drawn: today's person's, or, for a look of the new creator with ?creador=nuevo, our own hair's, hair.js)
const drawnAs = (s, look) => (MH_ON && look?.mh ? HAIR_STYLE[s] || s : realHair(s));
import { LOOK_OPTIONS, DEFAULT_LOOK, fullLook } from './looks.js';
import { hud } from './ui/hud.js';
import { inTavern } from './world/village.js';
import { nearX } from './world/planet.js';

// What each window leaves out of the creator's pages (ui/menus.js): the mirror, free, keeps the face; the hair and the beard's
// shape are the barber's, who does nothing else
export const MIRROR_HIDES = {
  mirror: ['outfit', 'cloth', 'hairAcc', 'accColor', 'hairStyle', 'hair', 'beard'],
  barber: Object.keys(LOOK_OPTIONS).filter(k => !['hairStyle', 'hair', 'beard', 'brows'].includes(k)),
};

export const PRICES = { cut: 40, style: 80, trim: 25, beard: 50, dye: 120 };

// The styles he offers: one for each real style (the ones drawn the same are one choice), the one you wear standing for its own
export function barberStyles(now, look = null) {
  const out = [], seen = new Set(), all = LOOK_OPTIONS.hairStyle, mine = all.some(([v]) => v === now) ? drawnAs(now, look) : null;
  for (const o of all) {
    const real = drawnAs(o[0], look);
    if (real === mine ? o[0] === now : !seen.has(real)) { seen.add(real); out.push(o); }
  }
  return out;
}

// The bill: from and to are looks, ask { cut, trim } what was asked for besides. Only what will look different costs: going
// between two styles drawn the same is free, a cut comes with a new style and a trim with a new beard
export function barberBill(from, to, ask = {}, factor = 1) {
  const lines = [], add = id => lines.push({ id, n: Math.max(1, Math.round(PRICES[id] * factor)) });
  from = { ...DEFAULT_LOOK, ...fullLook(from) };   // (an old look: what it lacks, as the window shows it)
  const style = drawnAs(from.hairStyle, from) !== drawnAs(to.hairStyle, from), beard = from.beard !== fullLook(to).beard;
  if (style) add('style'); else if (ask.cut) add('cut');
  if (from.hair !== to.hair) add('dye');
  if (beard) add('beard'); else if (ask.trim) add('trim');
  return { lines, total: lines.reduce((s, l) => s + l.n, 0), cut: style || !!ask.cut, shave: beard || !!ask.trim };
}

// The free barber chair of the tavern, or null: he cuts on his own stool when there is none or it is taken
export function tavernChair(game) {
  const p = game.player, w = game.world;
  if (!p || game.scene !== w) return null;
  for (const o of w.placedNear?.(p.x, p.y, 9) || []) {
    if (o.placed !== 'barber_chair' || !inTavern(o.x, o.y)) continue;
    if (game.live?.others?.some(q => q.sc === 'world' && q.entity?.pose && Math.hypot(nearX(q.entity.x, o.x) - o.x, q.entity.y - o.y) < 0.5)) continue;
    return o;
  }
  return null;
}

// The talk's option: sits you in the chair when there is one (not with something in the arms) and opens the window; the
// window gets you up when it closes
export function openBarber(game) {
  const p = game.player;
  if (!p || typeof game.onMirror !== 'function') return false;
  const o = !game.carry?.held && !p.mount && !p.boat && !p.aboard ? tavernChair(game) : null;
  let sat = false;
  if (o) { if (p.pose) game.rest.stand(); game.rest.sit(o); sat = p.pose?.kind === 'sit'; }
  if (game.onMirror('barber') === false) { if (sat) game.rest.stand(); return false; }
  return true;
}

// Pay and apply, or say why not (nothing changes then): the chosen fields into the look, the clocks back to now, the growth
// off at once. Returns null when done
export function payBarber(game, to, ask = {}) {
  const p = game.player, from = p.look, bill = barberBill(from, to, ask, game.rep?.buyFactor() ?? 1);
  if (game.money < bill.total) return 'poor';
  if (bill.total) game.addMoney(-bill.total);
  p.look = { ...from, hairStyle: to.hairStyle, hair: to.hair, beard: to.beard, brows: to.brows };
  if (bill.cut) game.body?.cut();
  if (bill.shave) game.body?.shave();
  game.body?.applyGrowth();
  changed(game);
  return null;
}

// The mirror, done: the face chosen (never the hair's cut, style or colour, nor the beard's shape), shaving or tidying the
// beard (act: 'shave', 'tidy' or null) and whether it grows
export function applyMirror(game, to, { act = null, grow = true } = {}) {
  const p = game.player, body = game.body, keep = new Set([...MIRROR_HIDES.mirror, 'pants']);
  p.look = { ...p.look, ...Object.fromEntries(Object.entries(to).filter(([k]) => !keep.has(k))) };
  if (act === 'shave') p.look.beard = 'no';
  if (body) {
    body.beardGrows = grow;
    if (act) body.shave();
    body.applyGrowth();
  }
  changed(game);
}
// The one retouch of a character of before the new creator (plan CR P6, menus.js offerRetouch): its new head and body, skin,
// eyes and brows; the hair, the beard and the clothes stay. RETOUCH_HIDES: the creator's rows it leaves out
export const RETOUCH_HIDES = ['name', 'sex', 'outfit', 'cloth', 'outer', 'accent'];
export function applyRetouch(game, to) {
  const p = game.player;
  p.look = { ...p.look, mh: packMh(to.mh || {}), skin: to.skin, eyes: to.eyes, brows: to.brows };
  changed(game);
}
// The new look everywhere: the dialogs' portrait, and whoever looks at inv.v
function changed(game) {
  const p = game.player;
  if (hud.faces[p.name]) hud.faces = { ...hud.faces, [p.name]: p.look };
  game.inv.changed();
}

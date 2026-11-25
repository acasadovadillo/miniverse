// What stands by the roads (world/roads.js; docs/planes/realismo/PLAN-R7-mundo.md §3.7): the timber bridges where they cross a stream and
// the signposts, a layer of the world (scenes.js). They come with the world and anyone takes them apart (B › Remove), as the houses of the
// village; both can be built too (B › Outside). And what the signposts say: those of the world, the next places along their roads; the
// players', the places they choose (d.signs of the chunk: 'x,y' → [key | null × 3], keys of places, never a text).
import { CHUNK } from './world/gen.js';
import { wrapIndex, wrapX, nearX, dxOf } from './world/planet.js';
import { CENTER } from './world/village.js';
import { deckHeight, TIMBER_L } from './world/hamlets.js';
import { hud } from './ui/hud.js';
import { Audio } from './audio.js';
import { t, fmt, onLangChange } from './i18n.js';

export const ARMS = 3, HOME_KEY = 'home';
const KEY = /^(home|-?\d{1,5},-?\d{1,5})$/;
const SIGN_CLEAR = 3.2;         // (how near a signpost no tree grows)
const PAGE = 6;                  // (places in a page of the choice)
// The arms of a player's signpost as they came from a save or from the network: three keys of places or null, or null if it has none
export const readArms = v => { if (!Array.isArray(v)) return null; const out = v.slice(0, ARMS).map(k => (typeof k === 'string' && KEY.test(k) ? k : null)); while (out.length < ARMS) out.push(null); return out.some(Boolean) ? out : null; };

export class Roadside {
  constructor(places) {
    this.places = places;
    this.chunks = new Map();     // a chunk → what stands in it: { placed, pos, models, decks } or null
    this.layer = {
      add: (cx, cy, d, out) => { const c = this.at(cx, cy); if (c?.any) this.world.addBuilt(c, out, true); },
      baseAt: (layer, tx, ty) => (layer === 'placed' ? this.at(Math.floor(tx / CHUNK), Math.floor(ty / CHUNK))?.placed[`${wrapX(tx)},${ty}`] : undefined),
      // (nothing grows on the signposts, nor so near that they would not be read)
      hides: o => { if (!o.kind) return false; const c = this.at(Math.floor(o.x / CHUNK), Math.floor(o.y / CHUNK)); return !!c && c.posts.some(p => Math.abs(p[0] - o.x) < SIGN_CLEAR && Math.abs(p[1] - o.y) < SIGN_CLEAR); },
      deckAt: (x, y) => this.deckAt(x, y), lvlAt: (x, y) => this.deckAt(x, y),
      blocks: (tx, ty) => this.deckAt(tx + 0.5, ty + 0.5) !== null,
    };
    onLangChange(() => { this.clear(); const w = this.world; if (w?.merged) { w.merged.clear(); w.touches++; } });
  }
  get game() { return this.places.game; }
  get world() { return this.places.world; }
  get roads() { return this.world?.gen?.roads || null; }
  clear() { this.chunks.clear(); }
  // (to a world that has just been opened)
  join(w) {
    this.clear();
    if (!w.layers.includes(this.layer)) w.layers.push(this.layer);
    w.signModel = (tile, arms, x, y, yaw) => this.signModel(arms, x, y, yaw);
    w.roadsideGone = (cx, cy, b = null) => this.gone(cx, cy, b);
  }
  // What stands in a chunk
  at(cx, cy) {
    const R = this.roads;
    if (!R) return null;
    cx = wrapIndex(cx, CHUNK);
    const k = (cx + 4096) * 8192 + cy + 4096, had = this.chunks.get(k);
    if (had !== undefined) return had;
    let c = null;
    if (R.mask(cx, cy) || R.nearby(cx, cy)) {
      c = { placed: {}, pos: {}, models: {}, decks: [], posts: [], any: false };
      for (const b of R.bridgesIn(cx, cy)) {
        c.decks.push({ kind: 'timber_bridge', x: b.x, y: b.y, yaw: b.yaw, L: b.L, tx: Math.floor(b.x), ty: Math.floor(b.y) });
        if (Math.floor(b.x / CHUNK) === cx && Math.floor(b.y / CHUNK) === cy) { const q = (b.yaw ? 1 : 0) + 4 * Math.max(0, TIMBER_L.indexOf(b.L)); c.placed[b.key] = q ? `timber_bridge@${q}` : 'timber_bridge'; c.any = true; }
      }
      for (const p of R.postsIn(cx, cy)) {
        const key = `${Math.floor(p.x)},${Math.floor(p.y)}`, o = `placed:${key}`;
        if (c.placed[key] || !this.room(p)) continue;
        c.placed[key] = 'signpost'; c.pos[o] = [p.x, p.y, 0]; c.models[o] = this.model(p.arms.map(a => [a.yaw, this.nameOf(a.to), a.m])); c.any = true; c.posts.push([p.x, p.y]);
      }
      if (!c.any && !c.decks.length) c = null;
    }
    if (this.chunks.size > 3000) this.chunks.clear();
    this.chunks.set(k, c);
    return c;
  }
  // Is there room for a signpost? (not in a place's houses, nor on a bridge)
  room(p) {
    const P = this.places, tx = Math.floor(p.x), ty = Math.floor(p.y);
    if (P.baseAt('placed', tx, ty) || P.baseAt('floor', tx, ty) || P.baseAt('roof', tx, ty)) return false;
    return !this.roads.bridgesIn(Math.floor(p.x / CHUNK), Math.floor(p.y / CHUNK)).some(b => Math.hypot(b.x - p.x, b.y - p.y) < b.L / 2 + 1);
  }
  // The height of a bridge of the roads at (x, y), or null (none, or it has been taken apart)
  deckAt(x, y) {
    const c = this.at(Math.floor(x / CHUNK), Math.floor(y / CHUNK));
    if (!c) return null;
    for (const d of c.decks) { const h = deckHeight(d, nearX(x, d.x), y); if (h !== null && !this.world.fixedGone(d.tx, d.ty)) return h; }
    return null;
  }
  // Has a bridge of a chunk (b; or any) been taken apart? (routegrid.js)
  gone(cx, cy, b = null) { return (b ? [b] : this.roads?.bridgesIn(cx, cy) || []).some(q => this.world.fixedGone(Math.floor(wrapX(q.x)), Math.floor(q.y))); }

  // ---------- what they say ----------
  placeOf(key) { return typeof key === 'string' && key !== HOME_KEY && KEY.test(key) ? this.places.poiOf(key) : null; }
  // The name of a place by its key, or null: there is none there
  nameOf(key) {
    if (key === HOME_KEY) return t('sign.home');
    const p = this.placeOf(key);
    return p ? this.places.title(p) : null;
  }
  km(m) { return t('sign.km', { km: fmt.num(Math.max(0.1, Math.round(m / 100) / 10), { minimumFractionDigits: 1, maximumFractionDigits: 1 }) }); }
  // The model of a signpost: [[yaw, name, metres]…]; a name of nothing is no arm
  model(list, yaw0 = 0) {
    const arms = list.filter(a => a[1]).slice(0, 4).map(([yaw, name, m]) => `${Math.round((((yaw - yaw0) * 180) / Math.PI + 720) % 360)}=${String(name).replace(/[|=]/g, ' ')}=${this.km(m)}`);
    return `signs:${arms.join('|')}`;
  }
  // A player's: its arms point straight to their places
  armsAt(arms, x, y) {
    const out = [];
    for (const k of readArms(arms) || []) {
      const p = k === HOME_KEY ? CENTER : this.placeOf(k), name = p && this.nameOf(k);
      if (!name) continue;
      const dx = dxOf(p.x, x), dy = p.y - y;
      out.push([Math.atan2(dx, dy), name, Math.hypot(dx, dy)]);
    }
    return out;
  }
  signModel(arms, x, y, yaw) { const list = this.armsAt(arms, x, y); return list.length ? this.model(list, yaw) : null; }
  // Those of a signpost of a place that has its own (a hamlet's, the council oak's): the model in its stead, or null
  placePost(p) {
    const R = this.roads, arms = R && (p.kind === 'aldea' || p.hito === 'roble') ? R.postOf(p.key) : null;
    return arms?.length ? arms.slice(0, 4).map(a => [a.yaw, this.nameOf(a.to), a.m]) : null;
  }

  // ---------- using them ----------
  // E on a signpost (game.js placedAction): yours or your friend's, what each arm points to; the world's, what it says
  action(o, pick) {
    if (o.fixed) return { text: t('sign.read'), run: () => this.read(o) };
    return { text: t('sign.set'), run: () => this.choose(o), alt: pick };
  }
  read(o) {
    const c = this.at(Math.floor(o.x / CHUNK), Math.floor(o.y / CHUNK)), p = c && this.roads.postsIn(Math.floor(o.x / CHUNK), Math.floor(o.y / CHUNK)).find(q => Math.floor(q.x) === o.tile[0] && Math.floor(q.y) === o.tile[1]);
    const list = p?.arms.map(a => [this.nameOf(a.to), a.m]).filter(a => a[0]) || [];
    Audio.page?.();
    hud.toast(list.length ? list.map(([n, m]) => t('sign.arm', { title: n, km: this.km(m) })).join(' · ') : t('sign.blank'), 'place');
  }
  // The places a player may write on one: the village and those they have visited, the nearest first
  choices(x, y) {
    const out = this.places.knownPlaces().map(p => [p.key, this.places.title(p), Math.hypot(dxOf(p.x, x), p.y - y)]);
    out.push([HOME_KEY, t('sign.home'), Math.hypot(dxOf(CENTER.x, x), CENTER.y - y)]);
    return out.sort((a, b) => a[2] - b[2]);
  }
  arms(o) { return readArms(this.world.delta(Math.floor(o.tile[0] / CHUNK), Math.floor(o.tile[1] / CHUNK))?.signs?.[`${o.tile}`]) || Array(ARMS).fill(null); }
  write(o, arms) {
    const cx = Math.floor(o.tile[0] / CHUNK), cy = Math.floor(o.tile[1] / CHUNK), d = this.world.delta(cx, cy, true), k = `${o.tile}`, v = readArms(arms);
    if (!this.world.ownAt('placed', ...o.tile)) return;
    if (v) (d.signs ||= {})[k] = v; else if (d.signs) delete d.signs[k];
    this.world.touch(cx, cy);
    this.game.onSave?.();
  }
  async choose(o) {
    const g = this.game;
    if (g.mode !== 'play' || g.busy || hud.dialogOpen || !o.tile) return;
    g.busy = true;
    try {
      for (;;) {
        const arms = this.arms(o), say = k => (k ? this.nameOf(k) || t('sign.empty') : t('sign.empty'));
        const i = await hud.ask(g.player.name, t('sign.which'), [...arms.map((k, n) => t('sign.arm_n', { n: n + 1, title: say(k) })), t('sign.done')]);
        if (!(i >= 0 && i < ARMS)) return;
        const list = this.choices(o.x, o.y);
        for (let page = 0; ;) {
          const part = list.slice(page * PAGE, (page + 1) * PAGE), more = list.length > (page + 1) * PAGE;
          const opts = [...part.map(c => t('sign.arm', { title: c[1], km: this.km(c[2]) })), ...(more ? [t('sign.more')] : []), t('sign.nothing')];
          const j = await hud.ask(g.player.name, t('sign.pick'), opts);
          if (!g.player || g.mode !== 'play') return;
          if (more && j === part.length) { page++; continue; }
          if (j >= 0 && j < part.length) arms[i] = part[j][0]; else if (j === opts.length - 1) arms[i] = null; else return;
          this.write(o, arms);
          Audio.place?.();
          break;
        }
      }
    } finally { g.busy = false; }
  }
}

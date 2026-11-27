// What goes on in the caves and mines of now (plan R7-5, docs/planes/realismo/PLAN-R7-mundo.md §3.8; the scenes themselves are
// world/cavegen.js, drawn by three/cave3d.js): the tiles you see for the cave map, the slopes that take you down or up, the rope
// tied at a pit, reaching the end of a cave, and, once per save, the torches (and the big things) left in the caves of before,
// which have changed, given back.
//
// Each player's own, as the caves are: never sent to anybody. In the save: caveRefund (1, the refund done) and caveEnds (the keys
// of the places whose end you have reached). The world server has no player and does nothing here.
import { Profile } from './accounts.js';
import { BULKY, CARCASS_DAYS } from './carry-items.js';
import { OLD_CAVES, rampGoes } from './world/cavegen.js';
import { Audio } from './audio.js';
import { hud } from './ui/hud.js';
import { t } from './i18n.js';

const SEE_R = 4;            // tiles your lamp shows round you (what goes on the cave map)
const SEE_EVERY = 0.2, FLUSH_EVERY = 3;   // s between two looks round, and between two writings of them to the state
const ROPE_HOLD = 0.3;      // s holding X to take a rope back
const END_XP = 40, ENDS_MAX = 500, PERK_CHAMBER = 8;   // (Exploring XP for an end; how many kept; the perk's level)
const OLD_STATE = /^u:c-?\d+_\d+$/;

export class Caves {
  constructor(game) {
    this.game = game;
    this.ends = new Set();
    this.refunded = 0;
    this.t = 0; this.flushT = 0; this.scene = null;
  }
  reset(save) {
    this.ends = new Set(Array.isArray(save?.caveEnds) ? save.caveEnds.filter(k => typeof k === 'string').slice(-ENDS_MAX) : []);
    this.refunded = save?.caveRefund ? 1 : 0;
    this.scene = null;
    // (with ?cuevas=1 the caves of before are as they were: nothing to give back, and it waits for a game with the new ones)
    if (!this.refunded && !OLD_CAVES && !Profile.server && this.game.world) this.refund();
  }
  save(out) {
    this.flush();
    if (this.refunded) out.caveRefund = 1;
    if (this.ends.size) out.caveEnds = [...this.ends];
  }
  // The caves of before are not entered any more (their states, u:c…, stay in the save as they were): what you left in them
  // comes back to you, once. Torches and anything else of the backpack as itself; a big thing (a log, a carcass) as its parts
  refund() {
    const g = this.game, back = new Map();
    let torches = 0, other = 0;
    for (const [k, st] of g.world.deltas) {
      if (!OLD_STATE.test(k) || !st?.placed) continue;
      for (const [tile, raw] of Object.entries(st.placed)) {
        let id = typeof raw === 'string' ? raw.split('@')[0] : null;
        if (!id) continue;
        // (a carcass that would have rotted by now comes back as what it would have left: a bone)
        const day = st.carcass?.[tile];
        if (BULKY[id]?.prey && g.carry && Number.isFinite(day) && g.carry.today() - g.carry.dayOf(day) >= CARCASS_DAYS) id = 'hueso';
        back.set(id, (back.get(id) || 0) + 1);
        if (id === 'antorcha') torches++; else other++;
      }
    }
    this.refunded = 1;
    for (const [id, n] of back) {
      if (BULKY[id] && g.carry) { for (let i = 0; i < n; i++) g.carry.giveParts(id); }
      else g.giveBack(id, n);   // (one of a newer version is kept aside: game.js giveBack)
    }
    if (torches || other) hud.toast(t(other ? 'cave.refund_more' : 'cave.refund', { n: torches, m: other }), 'good');
    return { torches, other };
  }
  // ---------- each frame ----------
  update(dt) {
    const g = this.game, sc = g.scene, p = g.player;
    if (this.scene && this.scene !== sc) { this.scene.flushSeen?.(); this.scene = null; }
    if (!sc || sc.kind !== 'grid' || !p || !sc.see) return;
    this.scene = sc;
    if ((this.flushT += dt) >= FLUSH_EVERY) { this.flushT = 0; sc.flushSeen(); }
    if ((this.t += dt) < SEE_EVERY) return;
    this.t = 0;
    sc.see(p.x, p.y, SEE_R, this.chamberOf(sc, p));
    if (g.busy || g.jumping || g.mode !== 'play') return;
    // (down or up a steep slope: walking far enough along it is going there)
    const R = sc.ramps?.length ? rampGoes(sc, p.x, p.y) : null;
    if (R) { g.places.climb(sc, R.sign < 0 ? 1 : -1); return; }
    const E = sc.end, key = sc.site?.key;
    if (E && key && !this.ends.has(key) && Math.hypot(p.x - E.x, p.y - E.y) < E.r + 0.5) this.reached(sc, E, key);
  }
  flush() { this.scene?.flushSeen?.(); }
  // (Exploring level 8: the whole chamber you are in goes on the map)
  chamberOf(sc, p) {
    if (!sc.chambers || (this.game.skills?.level('explore') || 0) < PERK_CHAMBER) return null;
    return sc.chambers.find(c => Math.hypot(p.x - c.x, p.y - c.y) < c.r) || null;
  }
  reached(sc, E, key) {
    const g = this.game;
    this.ends.add(key);
    if (this.ends.size > ENDS_MAX) this.ends.delete(this.ends.values().next().value);
    g.skills?.gain('explore', END_XP);
    g.xp?.add(END_XP);
    Audio.unlock?.();
    hud.toast(t(`cave.end.${E.kind}`, { title: g.places.title(sc.site) }), 'good');
    g.onSave?.();
  }
  // ---------- the pit at the end of a level: a rope ----------
  // Not tied: E ties one of yours (in creative, one from nowhere) and you climb down. Tied: E climbs down, and holding X takes it
  // back. The rope stays tied in this level's state (flags.rope) for the way back
  pitAction(sc, o) {
    const g = this.game, st = sc.state;
    if (st.flags.rope) return { text: t('cave.rope.climb_down'), run: () => g.places.climb(sc, 1), alt: { text: t('cave.rope.take'), hold: ROPE_HOLD, run: () => this.untie(sc) } };
    if (!g.admin && !(g.inv.count('cuerda') > 0)) return { text: t('cave.rope.need'), run: () => { Audio.error(); hud.toast(t('cave.rope.need_long')); } };
    return { text: t('cave.rope.down'), run: () => this.tie(sc) };
  }
  tie(sc) {
    const g = this.game;
    if (sc.state.flags.rope) return g.places.climb(sc, 1);
    if (!g.admin) { if (!(g.inv.count('cuerda') > 0)) { Audio.error(); return; } g.inv.remove('cuerda', 1); }
    sc.state.flags.rope = 1;
    sc.touched();
    Audio.place?.();
    return g.places.climb(sc, 1);
  }
  untie(sc) {
    const g = this.game;
    if (!sc.state.flags.rope) return;
    delete sc.state.flags.rope;
    sc.touched();
    if (!g.admin) g.giveBack('cuerda', 1);
    Audio.pickup?.();
    g.onSave?.();
  }
}

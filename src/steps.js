// Primeros pasos: lo que antes contaba Nilo de golpe, de uno en uno. Arriba a la izquierda sale lo que toca, con una
// pista y lo que falta; al hacerlo hay una recompensa y sale lo siguiente, hasta tener banco, cama y huerto. Es de cada
// jugador, no del mundo. Lo que se cuenta (matorrales, árboles…) se cuenta desde que empieza ese paso. A las partidas de
// antes de que esto existiera no les sale, pero en el diario (J) se puede repasar, ya sin recompensas.
import { CROPS } from './items.js';
import { seedOf } from './cropdata.js';
import { inTavern } from './world/village.js';
import { Audio } from './audio.js';
import { hud } from './ui/hud.js';
import { Profile } from './accounts.js';
import { t, getLang } from './i18n.js';

const $ = id => document.getElementById(id);
// Seeds of something that grows now (in winter, the first of the winter crops: the broad beans)
const seedNow = g => { const c = Object.keys(CROPS).find(id => CROPS[id].seasons.includes(g.days.season)); return c ? seedOf(c) : null; };

// id, lo que hay que hacer y una pista. Se cumple con stat + need (cuántos más que al empezar el paso), o con done(g).
// money e items: la recompensa (items puede depender del momento). skip(g): este paso ahora no se puede hacer
// (their texts: steps.<id> and steps.<id>.hint in the language files, read when shown)
export const STEPS = [
  { id: 'nilo', done: g => g.craft.taught.has('banco'), money: 20 },
  { id: 'segar', stat: 'segados', need: 3, money: 30, items: [['fibra', 4]] },
  { id: 'mochila', done: g => g.inv.equip.espalda?.id === 'mochila', money: 50 },
  { id: 'talar', stat: 'talados', need: 1, money: 20 },
  { id: 'tablas', done: g => g.inv.count('tablas') >= 6, money: 20 },
  { id: 'picar', stat: 'picados', need: 1, money: 20 },
  { id: 'taller', done: g => inTavern(g.player.x, g.player.y), money: 20 },
  { id: 'banco', stat: 'estaciones', need: 1, money: 60 },
  { id: 'obra', stat: 'obra', need: 4, money: 40, skip: g => !g.plans?.on },
  { id: 'dormir', stat: 'dormido', need: 1, money: 30 },
  { id: 'labrar', stat: 'labrados', need: 3, money: 40, items: g => { const s = seedNow(g); return s ? [[s, 3]] : []; } },
  { id: 'sembrar', stat: 'sembrados', need: 1, money: 40, skip: g => !seedNow(g) },
];
// (what is saved counts the steps: the ones from 'obra' on moved one place when it came. V says which count it is)
const V = 2, NEW_AT = STEPS.findIndex(s => s.id === 'obra');
for (const st of STEPS) Object.defineProperties(st, { text: { get: () => t(`steps.${st.id}`), enumerable: true }, hint: { get: () => t(`steps.${st.id}.hint`), enumerable: true } });

export class Steps {
  constructor(game) {
    this.game = game;
    this.i = 0;           // el paso por el que va (STEPS.length: terminados)
    this.base = null;     // cuánto llevaba lo que se cuenta al empezar este paso
    this.pay = true;      // si dan recompensa (repasándolos, no)
    this.t = 0;
    this.shown = null;
    $('quest-x')?.addEventListener('click', e => { e.stopPropagation(); this.askLeave(); });
  }
  get over() { return this.i >= STEPS.length; }
  get step() { return STEPS[this.i]; }
  reset(save) {
    const s = save.steps;
    if (s) { this.i = Math.min((s.v || 1) < V && s.i >= NEW_AT ? s.i + 1 : s.i, STEPS.length); this.base = s.base ?? null; this.pay = s.pay !== false; }
    else { this.i = save.inventory ? STEPS.length : 0; this.base = null; this.pay = !save.inventory; }   // (una partida de antes de esto: ya sabe jugar)
    this.shown = null;
    this.paint();
  }
  save(out) { out.steps = { i: this.i, base: this.base, pay: this.pay, v: V }; }
  // Lo que se lleva de este paso: [hecho, de cuánto] (si es de los que se cuentan)
  progress(st = this.step) {
    const g = this.game;
    if (!st?.stat) return null;
    return [Math.min(st.need, g.stats.get(st.stat) - (this.base ?? 0)), st.need];
  }
  update(dt) {
    const g = this.game;
    if (!g.player || g.mode !== 'play' || Profile.server) return;
    if ((this.t += dt) < 0.25) return;
    this.t = 0;
    if (this.over) this.paint(); else this.check();   // (over, its place is the site's: plans.js line)
  }
  // Mira si el paso actual está hecho y, si lo está, pasa al siguiente. Los que ahora no se pueden hacer se saltan
  check() {
    const g = this.game;
    for (let n = 0; n <= STEPS.length && !this.over; n++) {
      const st = this.step;
      if (st.skip?.(g)) { this.next(); continue; }
      if (st.stat && this.base === null) this.base = g.stats.get(st.stat);
      const p = this.progress(st);
      if (!(st.stat ? p[0] >= p[1] : st.done(g))) break;
      this.complete(st);
    }
    this.paint();
  }
  complete(st) {
    const g = this.game, items = typeof st.items === 'function' ? st.items(g) : st.items || [];
    if (this.pay) {
      if (st.money) g.addMoney(st.money);
      for (const [id, n] of items) { const left = g.inv.add(id, n); if (left) g.gather.throwOut(id, left); }
      Audio.unlock();
    }
    hud.toast(t('steps.done', { what: st.text, money: this.pay && st.money ? st.money : 0 }), 'good');
    this.next();
    if (this.over) { hud.toast(t('steps.over'), 'good'); g.onSave?.(); }
  }
  next() { this.i++; this.base = null; }
  // Volver a empezar desde el diario (ya sin recompensas)
  restart() { this.i = 0; this.base = null; this.pay = false; this.shown = null; this.paint(); }
  leave() { this.i = STEPS.length; this.base = null; this.shown = null; this.paint(); }
  async askLeave() {
    const g = this.game;
    if (g.busy || hud.dialogOpen) return;
    g.busy = true;
    const pick = await hud.ask(t('journal.tab.steps'), t('steps.leave'), [t('steps.leave.yes'), t('steps.leave.no')]);
    g.busy = false;
    if (pick === 0) this.leave();
  }
  // Lo que se ve arriba a la izquierda (solo se toca la página si ha cambiado)
  paint() {
    const el = $('quest');
    if (!el) return;
    // (with the steps done, the job you are in, or the building site around: what is left and what is missing)
    const site = this.over && !Profile.server ? this.game.missions?.line() || this.game.works?.line() || this.game.plans?.line() || '' : '';
    const st = this.step, p = st && this.progress(st), hide = (this.over && !site) || Profile.server;
    const key = hide ? '' : site || `${this.i}|${p || ''}|${getLang()}`;   // (and the language: it follows a switch)
    if (key === this.shown) return;
    this.shown = key;
    el.hidden = hide;
    el.classList.toggle('site', !!site);
    if (hide) return;
    if (site) { $('quest-title').textContent = ''; $('quest-text').textContent = site; $('quest-hint').textContent = ''; return; }
    $('quest-title').textContent = t('steps.title', { n: this.i + 1, total: STEPS.length });
    $('quest-text').textContent = st.text + (p ? ` (${Math.max(0, p[0])}/${p[1]})` : '');
    $('quest-hint').textContent = this.hintOf(st);
  }
  // A step's hint: felling, with the weight inventory (the default: carry.js), says what to do with the log it leaves
  hintOf(st) { return st.id === 'talar' && this.game.carry?.bigNow ? t('steps.fell_carry') : st.hint; }
  journal() {
    const rows = STEPS.map((st, i) => `<div class="j-row ach ${i < this.i ? 'done' : ''}"><b>${i < this.i ? '✓' : i === this.i ? '▸' : '·'} ${st.text}</b><small>${this.hintOf(st)}</small></div>`).join('');
    return `<p class="j-note">${this.over ? t('steps.finished') : t('steps.at', { n: this.i + 1, total: STEPS.length })} <button type="button" class="btn" data-steps-restart style="width:auto;display:inline-block;margin:0 0 0 8px;padding:2px 10px;font-size:14px">${t('steps.again')}</button></p>${rows}`;
  }
}

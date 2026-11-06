// Primeros pasos: lo que antes contaba Nilo de golpe, de uno en uno. Arriba a la izquierda sale lo que toca, con una
// pista y lo que falta; al hacerlo hay una recompensa y sale lo siguiente, hasta tener banco, cama y huerto. Es de cada
// jugador, no del mundo. Lo que se cuenta (matorrales, árboles…) se cuenta desde que empieza ese paso. A las partidas de
// antes de que esto existiera no les sale, pero en el diario (J) se puede repasar, ya sin recompensas.
import { CROPS } from './items.js';
import { inTavern } from './world/village.js';
import { Audio } from './audio.js';
import { hud } from './ui/hud.js';
import { Profile } from './accounts.js';

const $ = id => document.getElementById(id);
// Unas semillas que crezcan ahora (en invierno no crece nada)
const seedNow = g => { const c = Object.keys(CROPS).find(id => CROPS[id].seasons.includes(g.days.season)); return c ? `semilla_${c}` : null; };

// id, lo que hay que hacer y una pista. Se cumple con stat + need (cuántos más que al empezar el paso), o con done(g).
// money e items: la recompensa (items puede depender del momento). skip(g): este paso ahora no se puede hacer
export const STEPS = [
  { id: 'nilo', text: 'Habla con Nilo, en la plaza', hint: 'Acércate, pon el cursor encima de él y pulsa E.', done: g => g.craft.taught.has('banco'), money: 20 },
  { id: 'segar', text: 'Siega 3 matorrales', hint: 'Elige la guadaña con el 3 y usa el clic izquierdo. Dan fibra.', stat: 'segados', need: 3, money: 30, items: [['fibra', 4]] },
  { id: 'mochila', text: 'Hazte una mochila y póntela', hint: 'Son 8 de fibra y 2 cuerdas (3 de fibra cada una): siega más. Se hace con C y se pone con I.', done: g => g.inv.equip.espalda?.id === 'mochila', money: 50 },
  { id: 'talar', text: 'Tala un árbol', hint: 'El hacha está en el 1. Da madera.', stat: 'talados', need: 1, money: 20 },
  { id: 'tablas', text: 'Junta 6 tablas', hint: 'Con C: cada madera da 2 tablas.', done: g => g.inv.count('tablas') >= 6, money: 20 },
  { id: 'picar', text: 'Pica una roca', hint: 'El pico está en el 2. Da piedra.', stat: 'picados', need: 1, money: 20 },
  { id: 'taller', text: 'Ven a la taberna del pueblo', hint: 'Al oeste del camino. Anselmo sirve comida y bebida.', done: g => inTavern(g.player.x, g.player.y), money: 20 },
  { id: 'banco', text: 'Hazte tu banco de carpintero y colócalo', hint: '6 tablas y 2 piedras, con C. Luego, en la mano y clic donde lo quieras.', stat: 'estaciones', need: 1, money: 60 },
  { id: 'dormir', text: 'Prueba tu cama', hint: 'Está en tu casa, al norte de la plaza. Acércate, pon el cursor encima y pulsa E. Elige dormir.', stat: 'dormido', need: 1, money: 30 },
  { id: 'labrar', text: 'Labra 3 casillas de hierba', hint: 'La azada está en el 4. Si saltas encima de la tierra labrada, se deshace.', stat: 'labrados', need: 3, money: 40, items: g => { const s = seedNow(g); return s ? [[s, 3]] : []; } },
  { id: 'sembrar', text: 'Siembra lo que te ha dado la tierra', hint: 'Con las semillas en la mano, clic sobre la tierra labrada. Luego hay que regarlas, o que llueva.', stat: 'sembrados', need: 1, money: 40, skip: g => !seedNow(g) },
];

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
    if (s) { this.i = Math.min(s.i, STEPS.length); this.base = s.base ?? null; this.pay = s.pay !== false; }
    else { this.i = save.inventory ? STEPS.length : 0; this.base = null; this.pay = !save.inventory; }   // (una partida de antes de esto: ya sabe jugar)
    this.shown = null;
    this.paint();
  }
  save(out) { out.steps = { i: this.i, base: this.base, pay: this.pay }; }
  // Lo que se lleva de este paso: [hecho, de cuánto] (si es de los que se cuentan)
  progress(st = this.step) {
    const g = this.game;
    if (!st?.stat) return null;
    return [Math.min(st.need, g.stats.get(st.stat) - (this.base ?? 0)), st.need];
  }
  update(dt) {
    const g = this.game;
    if (this.over || !g.player || g.mode !== 'play' || Profile.server) return;
    if ((this.t += dt) < 0.25) return;
    this.t = 0;
    this.check();
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
    hud.toast(`Hecho: ${st.text.toLowerCase()}${this.pay && st.money ? ` · +${st.money} monedas` : ''}`, 'good');
    this.next();
    if (this.over) { hud.toast('Ya tienes banco, cama y huerto. Lo demás, a tu aire: mira el tablón de la plaza.', 'good'); g.onSave?.(); }
  }
  next() { this.i++; this.base = null; }
  // Volver a empezar desde el diario (ya sin recompensas)
  restart() { this.i = 0; this.base = null; this.pay = false; this.shown = null; this.paint(); }
  leave() { this.i = STEPS.length; this.base = null; this.shown = null; this.paint(); }
  async askLeave() {
    const g = this.game;
    if (g.busy || hud.dialogOpen) return;
    g.busy = true;
    const pick = await hud.ask('Primeros pasos', '¿Quitarlos? Puedes volver a repasarlos cuando quieras en el diario (J).', ['Quitarlos', 'Seguir con ellos']);
    g.busy = false;
    if (pick === 0) this.leave();
  }
  // Lo que se ve arriba a la izquierda (solo se toca la página si ha cambiado)
  paint() {
    const el = $('quest');
    if (!el) return;
    const st = this.step, p = st && this.progress(st), hide = this.over || Profile.server;
    const key = hide ? '' : `${this.i}|${p || ''}`;
    if (key === this.shown) return;
    this.shown = key;
    el.hidden = hide;
    if (hide) return;
    $('quest-title').textContent = `Primeros pasos · ${this.i + 1} de ${STEPS.length}`;
    $('quest-text').textContent = st.text + (p ? ` (${Math.max(0, p[0])}/${p[1]})` : '');
    $('quest-hint').textContent = st.hint;
  }
  journal() {
    const rows = STEPS.map((st, i) => `<div class="j-row ach ${i < this.i ? 'done' : ''}"><b>${i < this.i ? '✓' : i === this.i ? '▸' : '·'} ${st.text}</b><small>${st.hint}</small></div>`).join('');
    return `<p class="j-note">${this.over ? 'Terminados.' : `Vas por el ${this.i + 1} de ${STEPS.length}.`} <button type="button" class="btn" data-steps-restart style="width:auto;display:inline-block;margin:0 0 0 8px;padding:2px 10px;font-size:14px">Repasarlos</button></p>${rows}`;
  }
}

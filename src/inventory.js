// Inventario: 36 casillas. Las 9 primeras son la barra rápida (lo que cabe en las manos y los bolsillos);
// las otras 27 solo se pueden usar con una mochila puesta. Cada casilla es { id, n } o null (la ropa lleva
// además su color: { id, n: 1, color }). equip: lo que se lleva puesto, por hueco del cuerpo
// (ver WEAR_SLOTS en items.js), como { id, color }.
import { ITEMS, LEGACY_ITEMS, modernSlots } from './items.js';
import './buildables.js';   // (apunta en LEGACY_ITEMS los muebles y las estaciones, que ya no son objetos)

export const SLOTS = 36, HOTBAR = 9;
// Lo que distingue una cosa de otra igual (el color de una prenda, lo gastada que está una herramienta o una
// armadura: dur, los usos que le quedan); undefined si no hay nada
export const extraOf = s => { const e = {}; if (s?.color) e.color = s.color; if (s?.dur !== undefined) e.dur = s.dur; if (s?.map) e.map = s.map; return Object.keys(e).length ? e : undefined; };

export class Inventory {
  constructor(data) {
    this.slots = Array.from({ length: SLOTS }, (_, i) => (data?.slots?.[i] ? { ...data.slots[i] } : null));
    this.spill = modernSlots(this.slots);   // (lo que ya no es un objeto, por sus materiales; spill: lo que no ha cabido, que el juego deja a los pies)
    // Lo de una versión más nueva del juego (un id que este no conoce): no se ve ni se usa, pero no se pierde. Se aparta
    // (kept: [{ i: su casilla, s }]; keptEquip: lo puesto, por hueco del cuerpo) y al guardar vuelve a su sitio (toSave).
    // keep: lo que la última vez no tuvo sitio donde volver
    this.kept = [];
    this.slots.forEach((s, i) => { if (s && !ITEMS[s.id]) { this.kept.push({ i, s }); this.slots[i] = null; } });
    this.selected = data?.selected ?? 0;
    this.equip = Object.fromEntries(Object.entries(data?.equip || {}).filter(([, v]) => v && ITEMS[v.id]));
    this.keptEquip = Object.fromEntries(Object.entries(data?.equip || {}).filter(([, v]) => v?.id && !ITEMS[v.id]));
    // (lo de keep que ya se conoce, a una casilla que se pueda usar: sin mochila, las suyas no)
    for (const s of Array.isArray(data?.keep) ? data.keep : []) {
      if (!s?.id) continue;
      const free = ITEMS[s.id] ? this.slots.findIndex((x, k) => !x && k < this.cap) : -1;
      if (free >= 0) this.slots[free] = { ...s }; else this.kept.push({ i: -1, s: { ...s } });
    }
    this.onChange = null;
    this.infinite = false;   // modo admin: usar o gastar algo no lo quita (moverlo, tirarlo o guardarlo sí)
    this.v = 0;              // sube con cada cambio (para saber si hay que rehacer el muñeco)
  }
  get held() { return this.slots[this.selected]; }
  // Casillas que se pueden usar: la barra rápida y, con mochila, las suyas
  get cap() { const b = this.equip.espalda; return HOTBAR + (b ? ITEMS[b.id].bag || 0 : 0); }
  usable(i) { return i < this.cap; }
  changed() { this.v++; this.onChange?.(); }

  // Añade y devuelve lo que no haya cabido. Primero completa montones, luego usa huecos (barra rápida antes).
  // extra: lo propio de la prenda (su color); sin él, la ropa sale del color de fábrica
  add(id, n, extra) {
    const L = LEGACY_ITEMS[id];
    if (L) { let left = 0; for (const [m, k] of L) left += this.add(m, n * k); return left; }   // (una valla o un mueble sueltos de antes: sus materiales)
    if (!ITEMS[id]) return n;   // (de una versión más nueva: no cabe, y quien lo daba se lo queda)
    const max = ITEMS[id].stack, cap = this.cap;
    extra ||= ITEMS[id].wear ? { color: ITEMS[id].dye } : undefined;
    if (!extra) for (let i = 0; i < cap && n > 0; i++) { const s = this.slots[i]; if (s && s.id === id && !s.color && s.n < max) { const k = Math.min(n, max - s.n); s.n += k; n -= k; } }
    for (let i = 0; i < cap && n > 0; i++) if (!this.slots[i]) { const k = Math.min(n, max); this.slots[i] = { id, n: k, ...extra }; n -= k; }
    this.changed();
    return n;
  }
  count(id) { return this.slots.reduce((t, s) => t + (s?.id === id ? s.n : 0), 0); }
  // Cuántos de un objeto caben todavía
  room(id) {
    if (LEGACY_ITEMS[id]) id = LEGACY_ITEMS[id][0][0];
    const max = ITEMS[id].stack;
    return this.slots.slice(0, this.cap).reduce((t, s) => t + (!s ? max : s.id === id && !s.color ? max - s.n : 0), 0);
  }
  // Quita n de un objeto, de donde esté (primero de las casillas de la mochila, luego de la barra rápida)
  remove(id, n) {
    if (this.infinite) { this.changed(); return; }
    for (let i = SLOTS - 1; i >= 0 && n > 0; i--) {
      const s = this.slots[i];
      if (s?.id !== id) continue;
      const k = Math.min(n, s.n);
      s.n -= k; n -= k;
      if (s.n <= 0) this.slots[i] = null;
    }
    this.changed();
  }
  // Quita n de una casilla concreta (y lo devuelve, con su color). force: también en modo admin (al tirarlo
  // o guardarlo en un cofre)
  take(i, n = 1, force = false) {
    const s = this.slots[i];
    if (!s) return null;
    const k = Math.min(n, s.n), out = { ...s, n: k };
    if (!this.infinite || force) {
      s.n -= k;
      if (s.n <= 0) this.slots[i] = null;
    }
    this.changed();
    return out;
  }
  // Mover de una casilla a otra: junta montones del mismo objeto o intercambia (sin mochila, las suyas no se usan)
  move(from, to) {
    if (from === to || !this.usable(from) || !this.usable(to)) return;
    const a = this.slots[from], b = this.slots[to];
    if (a && b && a.id === b.id && !a.color && !b.color) {
      const k = Math.min(a.n, ITEMS[b.id].stack - b.n);
      b.n += k; a.n -= k;
      if (a.n <= 0) this.slots[from] = null;
    } else {
      this.slots[from] = b; this.slots[to] = a;
    }
    this.changed();
  }
  select(i) { this.selected = (i + HOTBAR) % HOTBAR; this.changed(); }

  // ---------- Ropa ----------
  // Ponerse lo de una casilla: lo que hubiera en ese hueco del cuerpo pasa a la casilla
  wear(i) {
    const s = this.slots[i], slot = s && ITEMS[s.id].wear;
    if (!slot) return false;
    const old = this.equip[slot];
    this.equip[slot] = { id: s.id, color: s.color || ITEMS[s.id].dye, ...(s.dur !== undefined && { dur: s.dur }) };
    this.slots[i] = old ? { id: old.id, n: 1, color: old.color, ...(old.dur !== undefined && { dur: old.dur }) } : null;
    this.changed();
    return true;
  }
  // Quitarse lo de un hueco y guardarlo en la primera casilla libre. Devuelve un motivo si no se puede.
  // La mochila, solo vacía (y va a la barra rápida, que es lo que queda sin ella).
  unwear(slot) {
    const it = this.equip[slot];
    if (!it) return null;
    if (slot === 'espalda' && this.slots.slice(HOTBAR).some(Boolean)) return 'Vacía la mochila antes de quitártela (o déjala en el suelo, llena).';
    const free = this.slots.findIndex((s, i) => !s && i < (slot === 'espalda' ? HOTBAR : this.cap));
    if (free < 0) return 'No tienes un hueco libre donde guardarlo.';
    this.slots[free] = { id: it.id, n: 1, color: it.color, ...(it.dur !== undefined && { dur: it.dur }) };
    delete this.equip[slot];
    if (slot === 'espalda') this.unbag();
    this.changed();
    return null;
  }

  // Sin mochila, lo apartado que iba en sus casillas ya no tiene casilla propia (se guardaría donde no se puede usar, y
  // una mochila que te pongas luego lo pisaría): vuelve con lo demás, a donde quepa al guardar (toSave)
  unbag() { for (const e of this.kept) if (e.i >= HOTBAR) e.i = -1; }
  // Algo de una versión más nueva que vuelve a ti (de un cofre que se cambia de sitio, por ejemplo): se aparta con lo demás
  keepUnknown(s) { this.kept.push({ i: -1, s: { ...s } }); }
  // Lo apartado de una versión más nueva que estaba en esa casilla (para dejarlo con los demás al soltar la mochila)
  takeKept(i) { const k = this.kept.findIndex(e => e.i === i); return k < 0 ? null : this.kept.splice(k, 1)[0].s; }

  // wardrobe: qué ropa había cuando se guardó (2: con calcetines), para dar a las partidas de antes la que falte. Lo
  // apartado (kept) vuelve a su casilla o, si ya está ocupada, a otra libre que se pueda usar; si no hay ninguna, a keep
  toSave() {
    const slots = this.slots.map(s => (s ? { ...s } : null)), equip = { ...this.equip }, keep = [], cap = this.cap;
    for (const { i, s } of this.kept) { const j = i >= 0 && i < cap && !slots[i] ? i : slots.findIndex((x, k) => !x && k < cap); if (j >= 0) slots[j] = { ...s }; else keep.push({ ...s }); }
    for (const [k, it] of Object.entries(this.keptEquip)) { if (!equip[k]) equip[k] = { ...it }; else keep.push({ ...it, n: 1 }); }
    return { slots, selected: this.selected, equip, wardrobe: 2, ...(keep.length && { keep }) };
  }
}

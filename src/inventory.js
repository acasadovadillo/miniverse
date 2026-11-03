// Inventario: 36 casillas. Las 9 primeras son la barra rápida (lo que cabe en las manos y los bolsillos);
// las otras 27 solo se pueden usar con una mochila puesta. Cada casilla es { id, n } o null (la ropa lleva
// además su color: { id, n: 1, color }). equip: lo que se lleva puesto, por hueco del cuerpo
// (ver WEAR_SLOTS en items.js), como { id, color }.
import { ITEMS } from './items.js';

export const SLOTS = 36, HOTBAR = 9;
// Lo que distingue una cosa de otra igual (el color de una prenda, lo gastada que está una herramienta o una
// armadura: dur, los usos que le quedan); undefined si no hay nada
export const extraOf = s => { const e = {}; if (s?.color) e.color = s.color; if (s?.dur !== undefined) e.dur = s.dur; return Object.keys(e).length ? e : undefined; };

export class Inventory {
  constructor(data) {
    this.slots = Array.from({ length: SLOTS }, (_, i) => (data?.slots?.[i] ? { ...data.slots[i] } : null));
    this.selected = data?.selected ?? 0;
    this.equip = Object.fromEntries(Object.entries(data?.equip || {}).filter(([, v]) => v && ITEMS[v.id]));
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
    this.changed();
    return null;
  }

  // wardrobe: qué ropa había cuando se guardó (2: con calcetines), para dar a las partidas de antes la que falte
  toSave() { return { slots: this.slots.map(s => (s ? { ...s } : null)), selected: this.selected, equip: { ...this.equip }, wardrobe: 2 }; }
}

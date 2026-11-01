// Mochila: 36 casillas; las 9 primeras son la barra rápida. Cada casilla es { id, n } o null.
import { ITEMS } from './items.js';

export const SLOTS = 36, HOTBAR = 9;

export class Inventory {
  constructor(data) {
    this.slots = Array.from({ length: SLOTS }, (_, i) => (data?.slots?.[i] ? { ...data.slots[i] } : null));
    this.selected = data?.selected ?? 0;
    this.onChange = null;
    this.infinite = false;   // modo admin: usar o gastar algo no lo quita (moverlo, tirarlo o guardarlo sí)
  }
  get held() { return this.slots[this.selected]; }
  changed() { this.onChange?.(); }

  // Añade y devuelve lo que no haya cabido. Primero completa montones, luego usa huecos (barra rápida antes).
  add(id, n) {
    const max = ITEMS[id].stack;
    for (const s of this.slots) if (n > 0 && s && s.id === id && s.n < max) { const k = Math.min(n, max - s.n); s.n += k; n -= k; }
    for (let i = 0; i < SLOTS && n > 0; i++) if (!this.slots[i]) { const k = Math.min(n, max); this.slots[i] = { id, n: k }; n -= k; }
    this.changed();
    return n;
  }
  count(id) { return this.slots.reduce((t, s) => t + (s?.id === id ? s.n : 0), 0); }
  // Cuántos de un objeto caben todavía
  room(id) {
    const max = ITEMS[id].stack;
    return this.slots.reduce((t, s) => t + (!s ? max : s.id === id ? max - s.n : 0), 0);
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
  // Quita n de una casilla concreta. force: también en modo admin (al tirarlo o guardarlo en un cofre)
  take(i, n = 1, force = false) {
    const s = this.slots[i];
    if (!s) return null;
    const k = Math.min(n, s.n);
    if (!this.infinite || force) {
      s.n -= k;
      if (s.n <= 0) this.slots[i] = null;
    }
    this.changed();
    return { id: s.id, n: k };
  }
  // Mover de una casilla a otra: junta montones del mismo objeto o intercambia
  move(from, to) {
    if (from === to) return;
    const a = this.slots[from], b = this.slots[to];
    if (a && b && a.id === b.id) {
      const k = Math.min(a.n, ITEMS[b.id].stack - b.n);
      b.n += k; a.n -= k;
      if (a.n <= 0) this.slots[from] = null;
    } else {
      this.slots[from] = b; this.slots[to] = a;
    }
    this.changed();
  }
  select(i) { this.selected = (i + HOTBAR) % HOTBAR; this.changed(); }
  toSave() { return { slots: this.slots.map(s => (s ? { ...s } : null)), selected: this.selected }; }
}

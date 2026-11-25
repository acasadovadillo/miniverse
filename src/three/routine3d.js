// What is drawn of the neighbours' routines besides themselves (routines.js): the card on Rosa's stall while she is away, what
// those at a table have before them and their bites and sips, the doors they go through (a closed one opens for them, only to
// be seen), the dark windows of the houses where everybody sleeps, and the chapel's bell when it calls. All of it local
import * as THREE from 'three';
import { HOUSES, TAVERN, CHAPEL, STALL, hasProject } from '../world/village.js';
import { ROUTINES, bellAt, BELL_S, opensNext, hhmm, weekdayOf } from '../routines.js';
import { PEOPLE } from '../neighbors.js';
import { foodModel } from './food3d.js';
import { ihash } from '../util.js';
import { Audio } from '../audio.js';
import { t, getLang } from '../i18n.js';

const FAR = 26, SLOW = 0.5;                       // tiles the meals are drawn from; s between two looks at the dear things
const SWING = 2.1, AMP = 1.05;                    // s of a swing of the bell, and how far it goes (radians)
const DISHES = [['estofado', 'cerveza'], ['pan', 'sidra'], ['pollo_asado', 'cerveza'], ['estofado', 'sidra']];
const TABLE_Y = 0.8, BAR_Y = 0.93;

export class RoutineView {
  constructor(view) {
    this.view = view;
    this.group = new THREE.Group();
    view.scene.add(this.group);
    this.meals = new Map();      // neighbour → { group, spot }
    this.card = null;
    this.slow = 0;
    this.passing = new Set();
    this.stroke = -1;
  }
  clear() {
    for (const m of this.meals.values()) this.group.remove(m.group);
    this.meals.clear();
    if (this.card) this.card.mesh.visible = false;
    this.view.world.darkRegions = null; this.view.world.passing = null;
  }
  update(game, scene, dt) {
    const N = game.neighbors, W = this.view.world, p = game.player;
    if (!ROUTINES || !N || !p || scene !== game.world) { if (this.on) { this.on = false; this.clear(); } return; }
    this.on = true;
    this.doors(N, W);
    this.eat(game, N, p, dt);
    this.bell(game, scene, W);
    if ((this.slow -= dt) > 0) return;
    this.slow = SLOW;
    this.lights(game, N, W);
    this.stall(game, N, p);
  }
  // A neighbour at a door: it is drawn open (the same for everyone, whatever the player did with it)
  doors(N, W) {
    const S = this.passing;
    S.clear();
    for (const n of N.people) {
      if (n.hidden || !n.path.length) continue;
      for (const d of W.doors.values()) if (Math.abs(d.tile[0] + 0.5 - n.x) < 1.3 && Math.abs(d.tile[1] + 0.5 - n.y) < 1.3) S.add(`${d.tile[0]},${d.tile[1]}`);
    }
    W.passing = S.size ? S : null;
  }
  // ---------- at table ----------
  eat(game, N, p, dt) {
    for (const n of N.people) {
      const s = n.spot, on = n.meal && !n.hidden && n.still && s && Math.hypot(n.x - p.x, n.y - p.y) < FAR && (n.pose || s.room === 'taberna');
      let m = this.meals.get(n);
      if (m && (!on || m.spot !== s)) { this.group.remove(m.group); this.meals.delete(n); m = null; }
      if (!on) continue;
      if (!m) {
        const day = game.days.realDay, [dish, drink] = DISHES[Math.floor(ihash(day, n.id.length * 7 + n.id.charCodeAt(0), 2801) * DISHES.length)];
        const g = new THREE.Group(), yaw = n.pose?.yaw ?? s.yaw ?? 0, bar = s.tile === null || Math.abs(Math.abs(yaw) - Math.PI) < 0.1, d = bar ? 0.98 : 0.66, dx = Math.sin(yaw), dz = Math.cos(yaw);
        const y = (bar ? BAR_Y : TABLE_Y) + this.view.groundY(game.world, s.x, s.y), a = foodModel(dish), b = foodModel(drink);
        if (a) { a.position.set(s.x + dx * d, y, s.y + dz * d); g.add(a); }
        if (b) { b.position.set(s.x + dx * (d + 0.04) - dz * 0.21, y, s.y + dz * (d + 0.04) + dx * 0.21); g.add(b); }
        g.traverse(o => { if (o.isMesh) o.castShadow = false; });
        this.group.add(g);
        this.meals.set(n, m = { group: g, spot: s, t: 1 + ihash(day, n.id.charCodeAt(1), 2802) * 4 });
      }
      if ((m.t -= dt) <= 0 && !n.emote && !n.talkWith) { m.t = 3.5 + Math.random() * 5; game.social?.emote(n, Math.random() < 0.7 ? 'eat' : 'drink', { amp: 1, local: true }); }
    }
  }
  // ---------- the windows ----------
  // Dark where they sleep, in the tavern while it is closed and in the chapel but when they gather (not with the player in there)
  lights(game, N, W) {
    const at = (x, y) => W.regionOf.get(`${x},${y}`), dark = (this.darkNow ||= new Set());
    dark.clear();
    const lit = r => N.people.some(n => n.spot?.room === r && !n.asleep), sleeps = r => N.people.some(n => n.asleep && n.spot?.room === r);
    const put = (r, x, y) => { if (lit(r) || (HOUSES[r] && !sleeps(r))) return; const k = at(x, y); if (k && k !== W.insideRegion) dark.add(k); };
    for (const h in HOUSES) if (!HOUSES[h].project || hasProject(HOUSES[h].project)) put(h, HOUSES[h].x0 + 5, HOUSES[h].y0 + 5);
    put('taberna', TAVERN.x0 + 5, TAVERN.y0 + 4);
    if (hasProject('chapel')) put('chapel', CHAPEL.x0 + 3, CHAPEL.y0 + 5);
    W.darkRegions = dark.size ? dark : null;
  }
  // ---------- the card on the stall ----------
  stall(game, N, p) {
    const T = game.days, near = Math.hypot(p.x - STALL.x0 - 1, p.y - STALL.y0) < 40;
    const n = near && N.people.find(q => q.id === 'rosa'), away = n && !N.isOpen('rosa');
    if (!away) { if (this.card) this.card.mesh.visible = false; return; }
    const key = `${Math.floor(T.now / 3e5)}:${getLang()}`;
    const C = (this.card ||= this.makeCard());
    C.mesh.visible = true;
    if (C.key === key) return;
    C.key = key;
    const next = opensNext('rosa', PEOPLE.rosa.shop, T.now);
    const text = !next ? [t('routine.card.closed'), ''] : next.day > 0 ? [t('routine.card.closed'), `${next.day > 1 ? t(`time.weekday.${weekdayOf(T.realDay + next.day)}`) + ' ' : ''}${hhmm(next.hour)}`] : [t(T.hour < 9 ? 'routine.card.opens' : 'routine.card.back'), hhmm(next.hour)];
    if (C.text === text.join()) return;
    C.text = text.join();
    const g = C.g, w = 256, h = 160;
    g.clearRect(0, 0, w, h);
    g.fillStyle = '#e9dfc6'; g.fillRect(0, 0, w, h);
    g.fillStyle = 'rgba(120,90,50,.10)'; for (let i = 0; i < 60; i++) g.fillRect(ihash(i, 1, 9) * w, ihash(i, 2, 9) * h, 2 + ihash(i, 3, 9) * 30, 1);
    g.strokeStyle = '#8a6a42'; g.lineWidth = 5; g.strokeRect(7, 7, w - 14, h - 14);
    g.fillStyle = '#4a3320'; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.font = 'italic 34px Georgia, serif'; g.fillText(text[0], w / 2, 52, w - 36);
    g.font = 'bold 58px Georgia, serif'; g.fillText(text[1], w / 2, 108, w - 36);
    C.tex.needsUpdate = true;
  }
  makeCard() {
    const c = document.createElement('canvas'); c.width = 256; c.height = 160;
    const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 4;
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(0.46, 0.29, 0.012), [0, 1, 2, 3, 4, 5].map(i => new THREE.MeshStandardMaterial(i === 4 ? { map: tex, roughness: 0.95 } : { color: '#b49a70', roughness: 0.95 })));
    mesh.position.set(STALL.x0 + 1, 1.02, STALL.y1 + 0.02); mesh.rotation.x = -0.12; mesh.castShadow = true;
    this.group.add(mesh);
    return { g: c.getContext('2d'), tex, mesh, key: '', text: '' };
  }
  // ---------- the bell ----------
  bell(game, scene, W) {
    const s = bellAt(game.days.now), k = `${CHAPEL.x0 + 3},${CHAPEL.y1 - 1}`;
    const on = s >= 0;
    if (!on && this.stroke < 0) return;
    let hang = null;
    for (const c of W.chunks.values()) if (c.bells) for (const b of c.bells) if (b.key === k) hang = b.mesh;
    if (!on) { this.stroke = -1; if (hang) { hang.userData.swing.rotation.x = 0; hang.userData.tongue.rotation.x = 0; } return; }
    const fade = Math.min(1, s / 3, (BELL_S - s) / 3), a = Math.sin(s / SWING * Math.PI * 2);
    if (hang) { hang.userData.swing.rotation.x = AMP * fade * a; hang.userData.tongue.rotation.x = -0.35 * fade * Math.cos(s / SWING * Math.PI * 2); }
    const stroke = Math.floor(s / (SWING / 2));
    if (stroke !== this.stroke) {
      const first = this.stroke < 0;
      this.stroke = stroke;
      const p = game.player, d = Math.hypot(p.x - CHAPEL.x0 - 3.5, p.y - CHAPEL.y1), v = Math.max(0, 1 - d / 170) ** 1.6 * (game.indoors ? 0.45 : 1) * fade;
      if (v > 0.01 && (!first || s < SWING)) Audio.bell?.(v, stroke % 2);
    }
  }
}

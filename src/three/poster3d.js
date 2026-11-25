// The posters of who is wanted, on the village's board (law.js; docs/planes/gta/PLAN-H-pueblo-vivo.md §4.6): each a canvas with the
// player's portrait, made when their record changes and only near the board
import * as THREE from 'three';
import { portrait3D } from './portrait.js';
import { BOARD } from '../world/village.js';
import { reportFault } from '../faults.js';
import { t, getLang } from '../i18n.js';
import { ihash } from '../util.js';

const PW = 256, PH = 384, MAX_POSTERS = 4, SEEN = 60, LOOK_S = 1;
// The places on the board (from its middle: x, y, how much it leans), the first one is the most wanted's
const PLACES = [[0.02, 1.31, 0.02], [-0.3, 1.3, -0.05], [0.32, 1.29, 0.04], [-0.13, 1.28, -0.02]];
// A poster, drawn on a 2D context. face: an image or a canvas, or null
export function drawPoster(g, rec, face) {
  const rnd = (i, k) => ihash(i, k, 77);
  g.clearRect(0, 0, PW, PH);
  const bg = g.createLinearGradient(0, 0, PW, PH); bg.addColorStop(0, '#e6d8b4'); bg.addColorStop(0.5, '#dccba2'); bg.addColorStop(1, '#cfba8c');
  g.fillStyle = bg; g.fillRect(0, 0, PW, PH);
  for (let i = 0; i < 260; i++) { g.fillStyle = `rgba(${90 + rnd(i, 1) * 50 | 0},${64 + rnd(i, 2) * 30 | 0},30,${0.03 + rnd(i, 3) * 0.07})`; g.fillRect(rnd(i, 4) * PW, rnd(i, 5) * PH, 1 + rnd(i, 6) * 16, 1 + rnd(i, 7) * 1.5); }
  for (let i = 0; i < 5; i++) { const x = rnd(i, 8) * PW, y = rnd(i, 9) * PH, r = 18 + rnd(i, 10) * 40, q = g.createRadialGradient(x, y, 0, x, y, r); q.addColorStop(0, 'rgba(110,72,28,.13)'); q.addColorStop(1, 'rgba(110,72,28,0)'); g.fillStyle = q; g.fillRect(0, 0, PW, PH); }
  g.fillStyle = 'rgba(70,44,16,.22)'; g.fillRect(0, 0, PW, 3); g.fillRect(0, 0, 3, PH); g.fillRect(PW - 3, 0, 3, PH); g.fillRect(0, PH - 3, PW, 3);
  g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillStyle = '#2c1c10';
  const font = (px, w = 700, f = 'Oswald, Georgia, serif') => { g.font = `${w} ${px}px ${f}`; };
  font(15, 500, 'Barlow, Georgia, serif'); g.fillText(t('law.poster.head'), PW / 2, 26, PW - 40);
  g.fillRect(34, 38, PW - 68, 1.5);
  font(48); g.fillText(t('law.poster.title'), PW / 2, 68, PW - 36);
  g.fillRect(34, 96, PW - 68, 1.5);
  // The face, printed in brown
  const X = 48, Y = 108, S = 160;
  g.save(); g.beginPath(); g.rect(X, Y, S, S); g.clip();
  g.fillStyle = '#c9b587'; g.fillRect(X, Y, S, S);
  if (face) { g.globalAlpha = 0.93; g.filter = 'grayscale(1) sepia(.55) contrast(1.12)'; g.drawImage(face, X, Y, S, S); g.filter = 'none'; g.globalAlpha = 1; g.globalCompositeOperation = 'multiply'; g.fillStyle = 'rgba(214,190,138,.55)'; g.fillRect(X, Y, S, S); g.globalCompositeOperation = 'source-over'; }
  for (let y = 0; y < S; y += 3) { g.fillStyle = 'rgba(60,38,14,.06)'; g.fillRect(X, Y + y, S, 1); }
  g.restore();
  g.strokeStyle = '#4a3018'; g.lineWidth = 2.5; g.strokeRect(X, Y, S, S);
  g.fillStyle = '#2c1c10';
  font(30); g.fillText(String(rec.name || '?').slice(0, 18), PW / 2, 292, PW - 36);
  font(17, 500, 'Barlow, Georgia, serif'); g.fillText(t('law.poster.owes'), PW / 2, 320, PW - 40);
  font(36); g.fillText(t('law.poster.sum', { n: rec.bounty }), PW / 2, 350, PW - 40);
  // (the tack)
  g.fillStyle = '#3a3230'; g.beginPath(); g.arc(PW / 2, 9, 5, 0, 7); g.fill(); g.fillStyle = '#8a827a'; g.beginPath(); g.arc(PW / 2 - 1.5, 7.5, 1.8, 0, 7); g.fill();
}
export class LawView {
  constructor(view) {
    this.view = view;
    this.group = new THREE.Group();
    view.scene.add(this.group);
    this.sheets = new Map();   // player → { mesh, key, tex, g }
    this.slow = 0;
  }
  update(game, scene, dt) {
    const p = game.player, L = game.law;
    if (!L || !p || scene !== game.world || Math.hypot(p.x - BOARD.x, p.y - BOARD.y) > SEEN) { this.group.visible = false; return; }
    this.group.visible = true;
    if ((this.slow -= dt) > 0) return;
    this.slow = LOOK_S;
    const list = L.posters().slice(0, MAX_POSTERS), ids = new Set(list.map(q => q.id));
    for (const [id, s] of this.sheets) if (!ids.has(id)) { this.group.remove(s.mesh); s.mesh.geometry.dispose(); s.mesh.material.map.dispose(); s.mesh.material.dispose(); this.sheets.delete(id); }
    list.forEach((q, i) => {
      const s = this.sheets.get(q.id) || this.make(q.id), key = `${q.bounty}|${q.name}|${getLang()}|${s.face ? 1 : 0}`, [x, y, a] = PLACES[i];
      s.mesh.position.set(BOARD.x + x, this.view.groundY(scene, BOARD.x, BOARD.y) + y, BOARD.y + 0.031 + i * 0.0015); s.mesh.rotation.z = a;
      if (!s.face && !s.asked && q.look) { s.asked = true; this.face(s, q.look); }
      if (s.key === key) return;
      s.key = key;
      drawPoster(s.g, q, s.face);
      s.tex.needsUpdate = true;
    });
  }
  make(id) {
    const c = document.createElement('canvas'); c.width = PW; c.height = PH;
    const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 4;
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(0.27, 0.405), new THREE.MeshStandardMaterial({ map: tex, roughness: 0.96 }));
    mesh.receiveShadow = true;
    this.group.add(mesh);
    const s = { mesh, tex, g: c.getContext('2d'), key: '', face: null, asked: false };
    this.sheets.set(id, s);
    return s;
  }
  face(s, look) {
    const make = () => { try { s.face = portrait3D(look); } catch (e) { reportFault(e, 'LawView.face'); } };   // (a person is built for it: when there is nothing to do)
    if (globalThis.requestIdleCallback) requestIdleCallback(make, { timeout: 3000 }); else setTimeout(make, 50);
  }
}

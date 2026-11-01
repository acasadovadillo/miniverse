// Combate ligero (solo en cuevas y mazmorras): vida del jugador en corazones, criaturas que persiguen
// y muerden, y golpes con la espada (o con cualquier herramienta, que pega menos).
import { ITEMS } from './items.js';
import { MONSTERS } from './art/explore.js';
import { Audio } from './audio.js';
import { hud } from './ui/hud.js';

export const HP_MAX = 20;   // medios corazones

class Monster {
  constructor(type, x, y) {
    Object.assign(this, { type, x, y, hp: MONSTERS[type].hp, cool: 0, hurt: 0, step: Math.random() * 4, wander: 0, dir: [0, 0] });
  }
  get def() { return MONSTERS[this.type]; }
  footprint() { return { x0: this.x - 0.2, x1: this.x + 0.2, y0: this.y - 0.2, y1: this.y + 0.2, c: this.x + this.y }; }
}

export class Combat {
  constructor(game) {
    this.game = game;
    this.hp = HP_MAX;
    this.invuln = 0;
    this.regen = 0;
    this.shown = -1;
  }
  reset(save) { this.hp = save.hp ?? HP_MAX; this.invuln = 0; this.paint(); }
  save(out) { out.hp = this.hp; }
  get scene() { return this.game.scene; }
  spawn(scene) { scene.monsters = (scene.spawns || []).map(([type, x, y]) => new Monster(type, x, y)); }
  heal(n) { this.hp = Math.min(HP_MAX, this.hp + n); this.paint(); }
  paint() {
    if (this.shown === this.hp) return;
    this.shown = this.hp;
    const el = document.getElementById('hearts');
    let html = '';
    for (let i = 0; i < HP_MAX / 2; i++) { const v = this.hp - i * 2; html += `<i class="${v >= 2 ? 'f' : v === 1 ? 'h' : 'e'}">♥</i>`; }
    el.innerHTML = html;
    document.body.classList.toggle('hurt', this.hp < HP_MAX);
  }

  update(dt) {
    const g = this.game, p = g.player, sc = this.scene;
    this.invuln = Math.max(0, this.invuln - dt);
    // Fuera de las cuevas se recupera vida poco a poco
    if (!sc.monsters && this.hp < HP_MAX && (this.regen += dt) > 15) { this.regen = 0; this.heal(1); }
    if (!sc.monsters) return;
    for (const m of sc.monsters) {
      m.cool = Math.max(0, m.cool - dt); m.hurt = Math.max(0, m.hurt - dt);
      const dx = p.x - m.x, dy = p.y - m.y, d = Math.hypot(dx, dy), def = m.def;
      let vx = 0, vy = 0;
      if (d < 7 && !g.busy) { vx = dx / d; vy = dy / d; if (def.fly) { vx += Math.sin(g.time * 3 + m.x) * 0.7; vy += Math.cos(g.time * 2.6 + m.y) * 0.7; } }
      else if ((m.wander -= dt) <= 0) { m.wander = 1 + Math.random() * 2; const a = Math.random() * 6.28; m.dir = Math.random() < 0.4 ? [0, 0] : [Math.cos(a) * 0.4, Math.sin(a) * 0.4]; }
      if (!vx && !vy) [vx, vy] = m.dir;
      if (m.hurt > 0.25) { vx = -dx / (d || 1) * 2.5; vy = -dy / (d || 1) * 2.5; }   // empujón al recibir un golpe
      const sp = def.speed * dt, nx = m.x + vx * sp, ny = m.y + vy * sp;
      if (def.fly || !sc.blocked(nx, m.y)) m.x = nx;
      if (def.fly || !sc.blocked(m.x, ny)) m.y = ny;
      if (sc.blocked(m.x, m.y)) { m.x -= vx * sp; m.y -= vy * sp; }
      m.step += dt * (def.fly ? 10 : 5);
      if (d < 0.55 && m.cool <= 0 && this.invuln <= 0 && !g.busy) { m.cool = 1.5; this.hit(def.dmg, m); }
    }
  }
  hit(dmg, from) {
    const g = this.game, p = g.player;
    this.hp = Math.max(0, this.hp - dmg);
    this.invuln = 0.8;
    const dx = p.x - from.x, dy = p.y - from.y, d = Math.hypot(dx, dy) || 1;
    const nx = p.x + (dx / d) * 0.5, ny = p.y + (dy / d) * 0.5;
    if (!this.scene.blocked(nx, ny)) { p.x = nx; p.y = ny; }
    this.paint();
    Audio.noiseHit(260, 0.15, 0.4);
    g.flashHurt = g.time + 0.25;
    if (this.hp <= 0) this.faint();
  }
  async faint() {
    const g = this.game, lost = Math.floor(g.money * 0.1);
    g.busy = true;
    await hud.fade(true);
    g.addMoney(-lost);
    g.days.skipToMorning();
    g.goHome();
    this.hp = HP_MAX; this.paint();
    g.setEnergy(50);
    await hud.fade(false);
    await hud.say('Nilo', [`Te encontraron desmayado y te traje a casa. ${lost ? `Por el camino se te cayeron ${lost} monedas.` : ''} ¡Lleva comida y antorchas la próxima vez!`]);
    g.busy = false;
    g.onSave?.();
  }

  // Atacar lo que haya delante
  target(p, held, def) {
    const sc = this.scene;
    if (!sc.monsters?.length) return null;
    const m = this.inFront(p);
    if (!m && !def?.weapon) return null;
    return { tile: null, ok: true, auto: true, label: m ? `Atacar (${m.def.name.toLowerCase()})` : 'Atacar', use: () => this.attack(m, def) };
  }
  inFront(p) {
    let best = null, bd = 1.6;
    for (const m of this.scene.monsters) {
      const dx = m.x - p.x, dy = m.y - p.y, d = Math.hypot(dx, dy);
      if (d < bd && (dx * p.face.x + dy * p.face.y) / (d || 1) > 0.2) { bd = d; best = m; }
    }
    return best;
  }
  attack(m, def) {
    const g = this.game;
    g.gather.cooldown = 0.38;
    g.gather.swing = 0.25;
    g.gather.swingItem = g.inv.held?.id && (ITEMS[g.inv.held.id].weapon || ITEMS[g.inv.held.id].tool) ? g.inv.held.id : null;
    Audio.swish();
    if (!m) return;
    const dmg = (def?.weapon || 1) + (g.skills?.level('combate') >= 5 ? 1 : 0);
    m.hp -= dmg; m.hurt = 0.4;
    Audio.chop();
    g.skills?.gain('combate', 1);
    if (m.hp <= 0) {
      this.scene.monsters.splice(this.scene.monsters.indexOf(m), 1);
      g.gather.spawnDrops(m, { drops: m.def.drops });
      g.gather.chips(m.x, m.y, m.type === 'limo' ? 'leaf' : 'stone', 12);
      g.skills?.gain('combate', 4);
      g.stats?.add('criaturas', 1);
    }
  }
  entities(scene) { return scene.monsters || null; }
}

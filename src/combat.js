// Vida y combate. La vida (en corazones) y el hambre (en muslos) cuentan siempre en supervivencia, como en
// Minecraft: con el hambre casi llena se cura sola, y sin hambre duele. El hambre baja con el tiempo y con lo que
// se hace (usar herramientas, correr, saltar, pegar). La armadura quita daño. Al morir se suelta lo que se lleva
// (salvo con keepInventory) y se reaparece en la cama o en casa. En cuevas y mazmorras, criaturas que persiguen y
// muerden, y golpes con la espada (o con cualquier herramienta, que pega menos); las de fuera, de noche, las lleva
// mobs.js. La dificultad (/difficulty) cambia cuánto muerden y el hambre: en pacífico no hay criaturas ni baja el
// hambre; en fácil el hambre no baja la vida de 5 corazones, en normal, de medio, y en difícil mata.
import { ITEMS, isArmor } from './items.js';
import { extraOf } from './inventory.js';
import { Audio } from './audio.js';
import { hud } from './ui/hud.js';
import { XP_MOB, roll } from './xp.js';
import { CAM } from './camera.js';

export const HP_MAX = 20;       // medios corazones
export const HUNGER_MAX = 20;   // medios muslos
const EXHAUST = 4;               // lo que hay que cansarse para perder medio muslo (usar una herramienta: TOOL_COST, de 0,5 a 1;
                                 // pegar: 0,1; correr, 0,05 por metro; saltar, 0,05; curarse medio corazón, 1,5; y, sin hacer nada, esto cada IDLE s)
const IDLE = 150, TICK = 4;      // y cada TICK s se cura (con el hambre a 18 o más) o duele el hambre (a 0)
const DROP_TTL = 300;            // segundos que dura en el suelo lo que se suelta al morir

export const DIFFICULTIES = { peaceful: 'pacífico', easy: 'fácil', normal: 'normal', hard: 'difícil' };
// Los efectos (de las pociones, de la comida o de /effect), por su nombre
export const EFFECT_NAMES = { rapido: 'rapidez', fuerza: 'fuerza', resistencia: 'resistencia', regeneracion: 'regeneración', incansable: 'sin cansancio', curacion: 'curación' };
// Por dificultad: cuántas criaturas de fuera como mucho alrededor de cada uno, cuánto muerden y hasta dónde quita
// vida el hambre (en medios corazones)
export const DIFF = { peaceful: { cap: 0, dmg: 0, starve: HP_MAX }, easy: { cap: 3, dmg: 0.5, starve: 10 }, normal: { cap: 6, dmg: 1, starve: 1 }, hard: { cap: 10, dmg: 1.5, starve: 0 } };

export const MONSTERS = {
  limo: { name: 'Limo', hp: 3, dmg: 1, speed: 1.1, drops: [['baba', 1, 1, 0.7]] },
  murcielago: { name: 'Murciélago', hp: 2, dmg: 1, speed: 2.4, fly: true, drops: [['fibra', 1, 1, 0.3]] },
  esqueleto: { name: 'Esqueleto', hp: 6, dmg: 2, speed: 1.4, drops: [['calavera', 1, 1, 0.3], ['moneda_antigua', 1, 1, 0.15], ['flecha', 1, 2, 0.6], ['hueso', 1, 2, 0.5]] },
};

class Monster {
  constructor(type, x, y) {
    Object.assign(this, { type, x, y, hp: MONSTERS[type].hp, cool: 0, hurt: 0, step: Math.random() * 4, wander: 0, dir: [0, 0] });
  }
  get def() { return MONSTERS[this.type]; }
}

export class Combat {
  constructor(game) {
    this.game = game;
    this.hp = HP_MAX;
    this.hunger = HUNGER_MAX;
    this.exhaust = 0;
    this.invuln = 0;
    this.regen = 0;
    this.shown = -1; this.shownHunger = -1;
  }
  reset(save) { this.hp = save.hp ?? HP_MAX; this.hunger = save.hunger ?? HUNGER_MAX; this.exhaust = save.exhaust || 0; this.invuln = 0; this.regen = 0; this.paint(); }
  save(out) { out.hp = Math.round(this.hp * 10) / 10; out.hunger = this.hunger; out.exhaust = Math.round(this.exhaust * 100) / 100; }
  get survival() { return this.game.gamemode === 'survival'; }
  get diff() { return DIFF[this.game.difficulty] || DIFF.normal; }
  // Cansarse: cada EXHAUST, medio muslo menos de hambre (solo en supervivencia, y no en pacífico)
  exert(n) {
    if (!this.survival || this.game.difficulty === 'peaceful') return;
    this.exhaust += n;
    while (this.exhaust >= EXHAUST) { this.exhaust -= EXHAUST; if (this.hunger > 0) this.hunger--; }
    this.paint();
  }
  feed(n) { this.hunger = Math.min(HUNGER_MAX, this.hunger + n); this.paint(); }
  // Los puntos de armadura que se llevan puestos (cada uno quita un 4 % del daño, hasta el 80 %)
  armor() { return Math.min(20, Object.values(this.game.inv?.equip || {}).reduce((t, it) => t + (ITEMS[it.id]?.armor || 0), 0)); }
  get scene() { return this.game.scene; }
  spawn(scene) { scene.monsters = this.game.rules.doMobSpawning && this.diff.cap ? (scene.spawns || []).map(([type, x, y]) => new Monster(type, x, y)) : []; }   // (/gamerule doMobSpawning; en pacífico, ninguna)
  // Las criaturas de esta escena (las de fuera, de mobs.js)
  get monsters() { const g = this.game; return this.scene === g.world ? g.mobs.list : this.scene?.monsters; }
  heal(n) { this.hp = Math.min(HP_MAX, this.hp + n); this.paint(); }
  paint() {
    if (this.shown === this.hp) return;
    this.shown = this.hp;
    const el = document.getElementById('hearts');
    let html = '';
    for (let i = 0; i < HP_MAX / 2; i++) { const v = this.hp - i * 2; html += `<i class="${v >= 2 ? 'f' : v >= 1 ? 'h' : 'e'}">♥</i>`; }
    el.innerHTML = html;
    el.title = `Vida: ${String(this.hp / 2).replace('.', ',')} de ${HP_MAX / 2} corazones`;
    document.body.classList.toggle('hurt', this.hp < HP_MAX);
    this.paintHunger();
  }
  paintHunger() {
    if (this.shownHunger === this.hunger) return;
    this.shownHunger = this.hunger;
    let html = '';
    for (let i = 0; i < HUNGER_MAX / 2; i++) { const v = this.hunger - i * 2; html += `<i class="${v >= 2 ? 'f' : v >= 1 ? 'h' : 'e'}"></i>`; }
    const el = document.getElementById('hunger');
    el.innerHTML = html;
    el.title = `Hambre: ${this.hunger / 2} de ${HUNGER_MAX / 2} muslos (trabajar, correr y pegar la gastan; comer la quita; con ${18 / 2} o más te curas)`;
    document.body.classList.toggle('hungry', this.hunger <= 6);
  }

  update(dt) {
    const g = this.game, p = g.player, sc = this.scene;
    this.invuln = Math.max(0, this.invuln - dt);
    // En creativo y de espectador, ni hambre ni daño; en supervivencia, el hambre baja sola y cada poco se cura
    // (con el hambre a 18 o más) o duele el hambre (a 0: hasta medio corazón)
    if (!this.survival) { if (this.hp < HP_MAX || this.hunger < HUNGER_MAX) { this.hp = HP_MAX; this.hunger = HUNGER_MAX; this.paint(); } }
    else if (p && !g.busy) {
      this.exert(dt * EXHAUST / IDLE);
      // (con la poción de regeneración, medio corazón cada poco)
      if (g.buffs.regeneracion > g.time && (this.regenPot = (this.regenPot || 0) + dt) >= 2.5) { this.regenPot = 0; this.heal(1); }
      if ((this.regen += dt) >= TICK) {
        this.regen = 0;
        const starve = this.diff.starve;
        if (((this.hunger >= 18 && g.rules.naturalRegeneration !== false) || g.difficulty === 'peaceful') && this.hp < HP_MAX) { this.heal(1); this.exert(1.5); }   // (/gamerule naturalRegeneration)
        else if (this.hunger <= 0 && this.hp > starve) {
          this.hp = Math.max(starve, this.hp - 1); this.paint(); Audio.noiseHit(200, 0.12, 0.3); g.flashHurt = g.time + 0.2;
          if (this.hp <= 0) this.die('Has muerto de hambre');
        }
      }
    }
    if (!sc.monsters) return;
    if (!this.diff.cap) sc.monsters.length = 0;   // (en pacífico se van)
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
      if (d < 0.55 && m.cool <= 0 && this.invuln <= 0 && !g.busy && g.gamemode === 'survival') { m.cool = 1.5; this.hit(Math.max(0.5, def.dmg * this.diff.dmg), m); }   // (en creativo y de espectador no hacen daño)
    }
  }
  hit(dmg, from) {
    const g = this.game, p = g.player;
    // La armadura quita daño y cada pieza se gasta un poco con cada golpe (y se rompe al acabarse; con irrompibilidad,
    // a veces no se gasta); la poción de resistencia, un 30 % más
    dmg *= (1 - this.armor() * 0.04) * (g.buffs.resistencia > g.time ? 0.7 : 1);
    for (const [slot, it] of Object.entries(g.inv.equip)) {
      if (!isArmor(it.id)) continue;
      it.dur = (it.dur ?? ITEMS[it.id].dur) - 1;
      if (it.dur <= 0) { delete g.inv.equip[slot]; g.gather.float(`¡Se ha roto: ${ITEMS[it.id].name.toLowerCase()}!`, '#ffb0a0'); }
    }
    g.inv.changed();
    this.exert(0.1);
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
  // Caer en una cueva: Nilo te lleva adonde reapareces y por el camino se pierde algo de dinero (salvo con
  // /gamerule keepInventory true)
  async faint() {
    const lost = await this.die(null);
    await hud.say('Nilo', [`Te encontraron desmayado y te traje ${this.game.player.spawn ? 'hasta aquí' : 'a casa'}. ${lost ? `Por el camino se te cayeron ${lost} monedas.` : ''} ¡Lleva comida y antorchas la próxima vez!`]);
    this.game.busy = false;
  }
  // Morir: se suelta lo que se lleva donde se cae (salvo con keepInventory) y se reaparece (en la cama, en tu punto
  // o en casa) con la vida y el hambre llenas. why: lo que se dice (null: lo dice quien llama, que sigue con el juego
  // parado). Devuelve las monedas perdidas
  async die(why) {
    const g = this.game, keep = g.rules.keepInventory || !this.survival, lost = keep ? 0 : Math.floor(g.money * 0.1);
    if (!g.player || g.dying) return 0;
    g.busy = g.dying = true;
    const dropped = keep ? 0 : this.dropAll();
    if (!keep && g.xp?.points) { g.xp.lose(); hud.toast('Has perdido tu experiencia'); }
    await hud.fade(true);
    g.addMoney(-lost);
    this.hunger = HUNGER_MAX; this.exhaust = 0;
    g.goHome();
    this.hp = HP_MAX; this.paint();
    g.view3d.snap();
    await hud.fade(false);
    g.dying = false;
    if (why) { g.busy = false; hud.toast(`${why}${lost ? ` · Se te cayeron ${lost} monedas` : ''}`); }
    if (dropped) hud.toast(`Lo que llevabas se ha quedado donde caíste: tienes ${DROP_TTL / 60} minutos para recogerlo`);
    g.onSave?.();
    return lost;
  }
  // Soltar lo que se lleva (las casillas y la armadura; la ropa y la mochila, vacía, no) alrededor de donde se
  // está, en esa escena (las cuevas se rehacen al entrar: se guarda cuál es). Devuelve cuántas cosas
  dropAll() {
    const g = this.game, p = g.player, inv = g.inv, out = [];
    inv.slots.forEach((s, i) => { if (s) { out.push(s); inv.slots[i] = null; } });
    for (const [slot, it] of Object.entries(inv.equip)) if (isArmor(it.id)) { out.push({ ...it, n: 1 }); delete inv.equip[slot]; }
    inv.changed();
    const scene = g.scene, sceneKey = g.sceneKey(scene);
    out.forEach((s, i) => {
      const a = (i / out.length) * Math.PI * 2, r = 0.3 + Math.random() * 0.6;
      g.gather.addDrop({ id: s.id, count: s.n, extra: extraOf(s), x: p.x + Math.cos(a) * r, y: p.y + Math.sin(a) * r, z: 4, vz: 30, t: 0, scene, sceneKey, ttl: DROP_TTL });
    });
    return out.length;
  }

  // Atacar lo que haya delante
  target(p, held, def) {
    if (!this.monsters?.length) return null;
    // (en primera persona, a la que está en la cruceta)
    const g = this.game, aim = CAM.first && g.mouse ? g.aimed() : null, m = CAM.first && g.mouse ? (aim?.kind === 'monster' ? aim.e : null) : this.inFront(p);
    if (!m && !def?.weapon) return null;
    return { tile: null, ok: true, auto: true, label: m ? `Atacar (${m.def.name.toLowerCase()})` : 'Atacar', use: () => this.attack(m, def) };
  }
  inFront(p) {
    let best = null, bd = 1.6;
    for (const m of this.monsters) {
      const dx = m.x - p.x, dy = m.y - p.y, d = Math.hypot(dx, dy);
      if (d < bd && (dx * p.face.x + dy * p.face.y) / (d || 1) > 0.2) { bd = d; best = m; }
    }
    return best;
  }
  // El gesto de pegar, acierte o no
  swing() {
    const g = this.game;
    g.gather.cooldown = 0.38;
    g.gather.swing = 0.25;
    g.gather.swingItem = g.inv.held?.id && (ITEMS[g.inv.held.id].weapon || ITEMS[g.inv.held.id].tool) ? g.inv.held.id : null;
    Audio.swish();
  }
  // Un golpe que acierta: lo que cuesta y cuánto pega (con filo, y con la poción de fuerza, más)
  blow(def) {
    const g = this.game, dmg = (def?.weapon || 1) + (g.skills?.level('combate') >= 5 ? 1 : 0) + (g.buffs.fuerza > g.time ? 2 : 0);
    g.gather.wearOut();   // (el arma, o la herramienta con que se pega, se gasta)
    this.exert(0.1);
    Audio.chop();
    g.skills?.gain('combate', 1);
    return dmg;
  }
  attack(m, def) {
    this.swing();
    if (!m) return;
    const dmg = this.blow(def);
    // (las de fuera son del mundo: el golpe se lo da quien lo lleva)
    const g = this.game;
    if (m.world) { g.mobs.strike(m, dmg); return; }
    m.hp -= dmg; m.hurt = 0.4;
    if (m.hp <= 0) { this.scene.monsters.splice(this.scene.monsters.indexOf(m), 1); this.reward(m); }
  }
  // Una flecha que le da (lo decide quien la dispara)
  shot(m, dmg) {
    const g = this.game;
    g.skills?.gain('combate', 1);
    if (m.world) { g.mobs.strike(m, dmg, true); return; }
    m.hp -= dmg; m.hurt = 0.4;
    if (m.hp <= 0) { const l = this.scene?.monsters, i = l ? l.indexOf(m) : -1; if (i >= 0) l.splice(i, 1); this.reward(m); }
  }
  flies(m) { return !!MONSTERS[m.type]?.fly; }
  // Una criatura muerta por ti: lo que suelta, y lo que aprendes
  reward(m) {
    const g = this.game;
    g.gather.spawnDrops(m, { drops: m.def.drops });
    g.gather.chips(m.x, m.y, m.type === 'limo' ? 'leaf' : 'stone', 12);
    g.skills?.gain('combate', 4);
    g.stats?.add('criaturas', 1);
    if (XP_MOB[m.type]) g.xp?.add(roll(...XP_MOB[m.type]));
  }
  entities(scene) { return scene === this.game.world ? null : scene.monsters || null; }
}

// Escenas de rejilla: cuevas (niveles infinitos hacia abajo) y mazmorras de los templos (salas en fila
// con puzles: palanca, llave y bloque sobre placa, y el tesoro al final). Se generan con la semilla y
// lo que cambia (vetas picadas, cofres abiertos, rejas abiertas) se guarda con el resto del mundo.
import { mk, ihash } from '../util.js';
import { toGrid } from '../iso.js';
import { rockWall, floorTile, veinSprite, crystalSprite, ladderSprite, treasureSprite, gateSprite, leverSprite, plateSprite, blockSprite, T_AX, T_AY, W_AX, W_AY } from '../art/explore.js';
import { placeSprite, PLACE_AX, PLACE_AY, LIGHT } from '../art/stations.js';

const HW = 16, HH = 8;

export class GridScene {
  constructor(game, { id, w, h, grid, style, name, dark = 0.84 }) {
    Object.assign(this, { game, id, w, h, grid, style, name, dark, kind: 'grid' });
    this.items = [];          // objetos fijos: vetas, escaleras, cofres, cristales, palancas…
    this.monsters = [];
    this.entities = [];
    this.origin = [h * HW + 40, 70];
    this.bounds = null;
  }
  get state() {
    const k = 'u:' + this.id, m = this.game.world.deltas;
    if (!m.has(k)) m.set(k, { removed: {}, opened: {}, placed: {}, flags: {} });
    return m.get(k);
  }
  touched() { this.game.world.dirty.add('u:' + this.id); this.cacheV = -1; }
  P(x, y, z = 0) { return [this.origin[0] + (x - y) * HW, this.origin[1] + (x + y) * HH - z]; }
  camera(px, py, view) { return { x: Math.round(px - view.w / 2), y: Math.round(py - 24 - view.h / 2) }; }
  wall(tx, ty) { return tx < 0 || ty < 0 || tx >= this.w || ty >= this.h || this.grid[ty * this.w + tx] === 1; }
  blocked(x, y) { return this.wall(Math.floor(x), Math.floor(y)); }
  water() { return null; }

  // El suelo se pinta una vez; las paredes que dan a un suelo se dibujan como cubos ordenados por profundidad
  prepare() {
    const [W, H] = [(this.w + this.h) * HW + 80, (this.w + this.h) * HH + 140];
    this.floor = mk(W, H);
    const g = this.floor.getContext('2d');
    this.walls = [];
    for (let ty = 0; ty < this.h; ty++) for (let tx = 0; tx < this.w; tx++) {
      const [sx, sy] = this.P(tx + 0.5, ty + 0.5);
      if (!this.wall(tx, ty)) { g.drawImage(floorTile(this.style, (tx * 7 + ty * 13) & 63), sx - T_AX, sy - T_AY); continue; }
      const edge = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, -1], [1, -1], [-1, 1]].some(([dx, dy]) => !this.wall(tx + dx, ty + dy) && tx + dx >= 0 && ty + dy >= 0 && tx + dx < this.w && ty + dy < this.h);
      if (edge) this.walls.push({ img: rockWall(this.style, tx * 31 + ty * 17), x: tx + 0.5, y: ty + 0.5, ax: W_AX, ay: W_AY, wall: true, tile: [tx, ty] });
    }
    this.cacheV = -1;
  }
  drawGround(ctx, cam, view) {
    ctx.fillStyle = '#0c0808';
    ctx.fillRect(0, 0, view.w, view.h);
    ctx.drawImage(this.floor, -cam.x, -cam.y);
  }
  // Objetos vivos (sin lo ya picado, con los cofres abiertos y lo colocado)
  live() {
    if (this.cacheV === this.game.frameNo) return this.cache;
    const st = this.state, out = [];
    for (const o of this.items) {
      if (o.kind && st.removed[o.key] !== undefined) continue;   // las vetas picadas no vuelven
      if (o.chest) o.img = treasureSprite(!!st.opened[o.key]);
      if (o.gate !== undefined) { const open = !!st.flags['g' + o.gate]; o.img = gateSprite(open, true); o.open = open; }
      if (o.lever !== undefined) o.img = leverSprite(!!st.flags['g' + o.lever]);
      if (o.plate !== undefined) o.img = plateSprite(!!st.flags['g' + o.plate]);
      out.push(o);
    }
    // Bloques que se empujan (su casilla actual se guarda)
    for (const b of this.blocks || []) {
      const [tx, ty] = st.flags['b' + b.room] || b.home;
      out.push({ img: blockSprite(), x: tx + 0.5, y: ty + 0.5, ax: T_AX, ay: T_AY, tile: [tx, ty], solid: true, box: { x0: tx + 0.05, y0: ty + 0.05, x1: tx + 0.95, y1: ty + 0.95 }, block: b });
    }
    for (const [k, id] of Object.entries(st.placed)) { const [tx, ty] = k.split(',').map(Number); out.push({ img: placeSprite(id), x: tx + 0.5, y: ty + 0.5, ax: PLACE_AX, ay: PLACE_AY, placed: id, tile: [tx, ty], layer: 'placed' }); }
    this.cache = out; this.cacheV = this.game.frameNo;
    return out;
  }
  objects() {
    const p = this.game.player, near = o => !p || Math.abs(o.x - p.x) + Math.abs(o.y - p.y) < 34;
    return this.walls.filter(near).concat(this.live().filter(o => !o.flat && near(o)));
  }
  collidersNear(x, y) {
    const out = [], tx = Math.floor(x), ty = Math.floor(y);
    for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) if (this.wall(tx + dx, ty + dy)) out.push({ x0: tx + dx, y0: ty + dy, x1: tx + dx + 1, y1: ty + dy + 1 });
    for (const o of this.live()) if (o.solid && !o.open && Math.abs(o.x - x) < 3 && Math.abs(o.y - y) < 3) out.push(o.box || { x: o.x, y: o.y, r: o.r || 0.35 });
    for (const m of this.monsters) if (m.solid) out.push({ x: m.x, y: m.y, r: 0.3 });
    return out;
  }
  harvestablesNear(x, y) { return this.live().filter(o => o.kind && Math.abs(o.x - x) < 3 && Math.abs(o.y - y) < 3); }
  remove(o) { this.state.removed[o.key] = this.game.world.clock; this.touched(); }
  lights() {
    const out = [];
    for (const o of this.live()) {
      if (o.shine) out.push({ x: o.x, y: o.y, z: 12, r: o.shine });
      if (o.placed && LIGHT[o.placed]) { const [lx, ly, lz, lr] = LIGHT[o.placed]; out.push({ x: o.x + lx, y: o.y + ly, z: lz, r: lr }); }
    }
    return out;
  }
  // Solo se pueden poner antorchas (y quitarlas)
  at(layer, tx, ty) { return layer === 'placed' ? this.state.placed[`${tx},${ty}`] : undefined; }
  canPlace(tx, ty, id) { return id === 'antorcha' && !this.wall(tx, ty) && !this.state.placed[`${tx},${ty}`] && !this.live().some(o => o.tile && o.tile[0] === tx && o.tile[1] === ty); }
  place(tx, ty, id) { this.state.placed[`${tx},${ty}`] = id; this.touched(); }
  unplace(o) { delete this.state.placed[`${o.tile[0]},${o.tile[1]}`]; this.touched(); }
  placedNear(x, y, r) { return this.live().filter(o => o.placed && Math.hypot(o.x - x, o.y - y) < r); }
  chestAt() { return null; }
  chestTouched() {}
  roofAt() { return false; }
  // Empujar un bloque una casilla; si cae en su placa, se abre la reja
  push(o, dx, dy) {
    const [tx, ty] = o.tile, nx = tx + dx, ny = ty + dy;
    if (this.wall(nx, ny) || this.live().some(q => q.solid && q !== o && !q.open && q.tile && q.tile[0] === nx && q.tile[1] === ny)) return false;
    const st = this.state;
    st.flags['b' + o.block.room] = [nx, ny];
    if (nx === o.block.plate[0] && ny === o.block.plate[1]) st.flags['g' + o.block.room] = true;
    this.touched();
    return true;
  }
  tileAt(sx, sy) { const [gx, gy] = toGrid(sx - this.origin[0], sy - this.origin[1]); return [Math.floor(gx), Math.floor(gy)]; }
  // Una casilla de suelo libre al azar (determinista)
  freeTiles() { const out = []; for (let ty = 1; ty < this.h - 1; ty++) for (let tx = 1; tx < this.w - 1; tx++) if (!this.wall(tx, ty)) out.push([tx, ty]); return out; }
}

// ---------- Cuevas ----------
const ORES = [
  ['piedra', 1, 0.3], ['cobre', 1, 0.3], ['hierro', 2, 0.24], ['amatista', 3, 0.1], ['oro', 4, 0.12], ['esmeralda', 5, 0.07], ['rubi', 7, 0.05], ['diamante', 9, 0.03], ['fosil', 2, 0.05],
];
export function makeCave(game, caveId, depth, snow) {
  const seed = game.world.seed + caveId * 131 + depth * 977, W = 30 + Math.min(16, depth * 2), H = W;
  let grid = new Uint8Array(W * H);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) grid[y * W + x] = x === 0 || y === 0 || x === W - 1 || y === H - 1 || ihash(x, y, seed) < 0.45 ? 1 : 0;
  for (let it = 0; it < 4; it++) {
    const next = new Uint8Array(W * H);
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      let n = 0;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) { const xx = x + dx, yy = y + dy; n += xx < 0 || yy < 0 || xx >= W || yy >= H ? 1 : grid[yy * W + xx]; }
      next[y * W + x] = x === 0 || y === 0 || x === W - 1 || y === H - 1 ? 1 : n >= 5 ? 1 : 0;
    }
    grid = next;
  }
  // Quedarse con la zona de suelo más grande (todo conectado)
  const region = new Int32Array(W * H).fill(-1), sizes = [];
  for (let i = 0; i < W * H; i++) {
    if (grid[i] || region[i] >= 0) continue;
    const r = sizes.length, todo = [i]; region[i] = r; let n = 0;
    while (todo.length) { const j = todo.pop(); n++; for (const k of [j + 1, j - 1, j + W, j - W]) if (k >= 0 && k < W * H && !grid[k] && region[k] < 0) { region[k] = r; todo.push(k); } }
    sizes.push(n);
  }
  const best = sizes.indexOf(Math.max(...sizes));
  for (let i = 0; i < W * H; i++) if (!grid[i] && region[i] !== best) grid[i] = 1;
  const sc = new GridScene(game, { id: `c${caveId}_${depth}`, w: W, h: H, grid, style: snow ? 'ice' : 'cave', name: `Cueva · nivel ${depth}` });
  sc.depth = depth; sc.caveId = caveId;
  const free = sc.freeTiles(), cx = W / 2, cy = H / 2;
  free.sort((a, b) => Math.hypot(a[0] - cx, a[1] - cy) - Math.hypot(b[0] - cx, b[1] - cy));
  const up = free[0], down = free.reduce((a, b) => (Math.hypot(b[0] - up[0], b[1] - up[1]) > Math.hypot(a[0] - up[0], a[1] - up[1]) ? b : a));
  // Se aparece junto a la escalera, en una casilla libre (abajo si se puede; al subir, mejor a su derecha)
  const beside = ([tx, ty], dirs) => {
    const [dx, dy] = dirs.find(([dx, dy]) => !sc.wall(tx + dx, ty + dy)) || [0, 0];
    return { x: tx + 0.5 + dx * 0.8, y: ty + 0.5 + dy * 0.8 };
  };
  sc.entry = beside(up, [[0, 1], [1, 0], [-1, 0], [0, -1]]);
  sc.fromBelow = beside(down, [[1, 0], [0, 1], [-1, 0], [0, -1]]);
  sc.items.push({ img: ladderSprite(false), x: up[0] + 0.5, y: up[1] + 0.5, ax: T_AX, ay: T_AY, ladder: 'up', tile: up });
  sc.items.push({ img: ladderSprite(true), x: down[0] + 0.5, y: down[1] + 0.5, ax: T_AX, ay: T_AY, ladder: 'down', tile: down, flat: false });
  const taken = new Set([`${up}`, `${down}`]);
  for (const [tx, ty] of free) {
    if (taken.has(`${tx},${ty}`) || Math.hypot(tx - up[0], ty - up[1]) < 2) continue;
    const nextToWall = sc.wall(tx + 1, ty) || sc.wall(tx - 1, ty) || sc.wall(tx, ty + 1) || sc.wall(tx, ty - 1), r = ihash(tx, ty, seed + 1);
    if (nextToWall && r < 0.11) {
      const ok = ORES.filter(([, d]) => depth >= d), tot = ok.reduce((t, o) => t + o[2], 0);
      let q = ihash(tx, ty, seed + 2) * tot, ore = ok[0][0];
      for (const [k, , w] of ok) { if (q < w) { ore = k; break; } q -= w; }
      sc.items.push({ kind: 'veta_' + ore, img: veinSprite(ore), x: tx + 0.5, y: ty + 0.5, ax: 15, ay: 20, key: `${tx},${ty}`, tile: [tx, ty], solid: true, r: 0.35 });
      taken.add(`${tx},${ty}`);
    } else if (depth >= 2 && r > 0.988) {
      const col = ['#9a5ae0', '#4ae8c8', '#5aa8ff'][Math.floor(ihash(tx, ty, seed + 3) * 3)];
      sc.items.push({ img: crystalSprite(col), x: tx + 0.5, y: ty + 0.5, ax: 12, ay: 27, shine: 46, tile: [tx, ty], solid: true, r: 0.3 });
      taken.add(`${tx},${ty}`);
    }
  }
  // Un cofre en algunos niveles
  if (ihash(caveId, depth, seed + 4) < 0.45) {
    const t = free[Math.floor(free.length * (0.6 + ihash(caveId, depth, 5) * 0.35))];
    if (t && !taken.has(`${t}`)) sc.items.push({ chest: true, img: treasureSprite(false), x: t[0] + 0.5, y: t[1] + 0.5, ax: T_AX, ay: T_AY, key: 'cofre', tile: t, solid: true, r: 0.35, loot: depth });
  }
  // Criaturas
  const n = Math.min(12, 2 + depth), types = ['limo', ...(depth >= 2 ? ['murcielago'] : []), ...(depth >= 4 ? ['esqueleto'] : [])];
  for (let i = 0; i < n; i++) {
    const t = free[Math.floor(free.length * (0.25 + ihash(i, depth, seed + 6) * 0.75))];
    if (t) sc.spawns = (sc.spawns || []).concat([[types[Math.floor(ihash(i, depth, seed + 7) * types.length)], t[0] + 0.5, t[1] + 0.5]]);
  }
  sc.prepare();
  return sc;
}

// ---------- Mazmorras: cuatro salas en fila, cada una con su puzle ----------
const RW = 9, RH = 9;
export function makeDungeon(game, dungeonId) {
  const seed = game.world.seed + dungeonId * 389, rooms = 4, W = rooms * (RW + 1) + 1, H = RH + 2;
  const grid = new Uint8Array(W * H).fill(1);
  for (let r = 0; r < rooms; r++) for (let y = 1; y <= RH; y++) for (let x = 1; x <= RW; x++) grid[y * W + r * (RW + 1) + x] = 0;
  const doorY = 1 + Math.floor(RH / 2);
  for (let r = 0; r < rooms - 1; r++) grid[doorY * W + (r + 1) * (RW + 1)] = 0;   // huecos entre salas (con reja)
  const sc = new GridScene(game, { id: `d${dungeonId}`, w: W, h: H, grid, style: 'temple', name: 'Templo antiguo', dark: 0.7 });
  sc.dungeonId = dungeonId;
  const x0 = r => r * (RW + 1) + 1;
  sc.entry = { x: x0(0) + 1.5, y: doorY + 0.5 };
  sc.items.push({ img: ladderSprite(false), x: x0(0) + 0.5, y: doorY + 0.5, ax: T_AX, ay: T_AY, ladder: 'up', tile: [x0(0), doorY] });
  const puzzles = ['palanca', 'llave', 'bloque'];
  for (let r = 0; r < rooms - 1; r++) {
    const gx = (r + 1) * (RW + 1), kind = puzzles[(r + Math.floor(ihash(dungeonId, 1, seed) * 3)) % 3];
    sc.items.push({ gate: r, img: gateSprite(false, false), x: gx + 0.5, y: doorY + 0.5, ax: W_AX, ay: W_AY, wall: true, tile: [gx, doorY], solid: true, box: { x0: gx, y0: doorY, x1: gx + 1, y1: doorY + 1 }, lock: kind === 'llave' });
    const rx = x0(r), at = (dx, dy) => [rx + dx, 1 + dy];
    if (kind === 'palanca') {
      const [lx, ly] = at(2 + Math.floor(ihash(r, 2, seed) * 5), 1);
      sc.items.push({ lever: r, img: leverSprite(false), x: lx + 0.5, y: ly + 0.5, ax: T_AX, ay: T_AY, tile: [lx, ly], solid: true, r: 0.25 });
    } else if (kind === 'llave') {
      const [kx, ky] = at(1 + Math.floor(ihash(r, 3, seed) * 6), RH - 2);
      sc.items.push({ chest: true, keyFor: r, img: treasureSprite(false), x: kx + 0.5, y: ky + 0.5, ax: T_AX, ay: T_AY, key: 'llave' + r, tile: [kx, ky], solid: true, r: 0.35 });
    } else {
      const [px, py] = at(6, 2), [bx, by] = at(3, 4);
      sc.items.push({ plate: r, img: plateSprite(false), x: px + 0.5, y: py + 0.5, ax: T_AX, ay: T_AY, tile: [px, py], flatish: true });
      sc.blocks = (sc.blocks || []).concat([{ room: r, home: [bx, by], plate: [px, py] }]);
    }
    if (r > 0) for (let i = 0; i < 1 + r; i++) sc.spawns = (sc.spawns || []).concat([[r === 2 ? 'esqueleto' : 'limo', rx + 2 + i * 2 + 0.5, 1 + RH - 3 + 0.5]]);
  }
  // Sala del tesoro
  const fx = x0(rooms - 1);
  sc.items.push({ chest: true, img: treasureSprite(false), x: fx + RW / 2, y: doorY + 0.5, ax: T_AX, ay: T_AY, key: 'tesoro', tile: [fx + Math.floor(RW / 2), doorY], solid: true, r: 0.4, loot: 'templo' });
  for (const [dx, dy] of [[1, 1], [RW - 2, 1], [1, RH - 2], [RW - 2, RH - 2]]) sc.items.push({ img: crystalSprite('#f8c030'), x: fx + dx + 0.5, y: 1 + dy + 0.5, ax: 12, ay: 27, shine: 60, tile: [fx + dx, 1 + dy], solid: true, r: 0.3 });
  sc.spawns = (sc.spawns || []).concat([['esqueleto', fx + 3.5, doorY - 1.5], ['esqueleto', fx + 5.5, doorY + 2.5]]);
  sc.prepare();
  return sc;
}

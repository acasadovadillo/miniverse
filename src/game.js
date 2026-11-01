// Núcleo del juego: estado, bucle de paso fijo, cámara, dibujo por profundidad e interacciones.
import { mk, ellipse, blob, rng } from './util.js';
import { toScreen, toGrid, toView, VIEW, STEPS, setViewRot, depthDir } from './iso.js';
import { Player } from './entities.js';
import { Overworld, NILO_LOOK } from './world/scenes.js';
import { houseBlueprint, byChunk, doorTile } from './world/blueprints.js';
import { HOUSE, HOUSE_BIG, HOUSES, POND, CENTER, SPAWN, inBounds, inOwnHouse, hasProject } from './world/village.js';
import { PIECES, parsePlaced } from './pieces.js';
import { wallSprite, doorSprite, chandelierSprite, CANDLES, LAMP_AX, LAMP_AY } from './art/build.js';
import { BIOMES } from './world/biomes.js';
import { CHUNK, WORLD_SEED } from './world/gen.js';
import { MapView } from './ui/map.js';
import { Inventory } from './inventory.js';
import { Gathering } from './gather.js';
import { Crafting } from './crafting.js';
import { STATIONS } from './recipes.js';
import { ENERGY_MAX, START_KIT, ITEMS } from './items.js';
import { WorldStore } from './worldstore.js';
import { BuildMode } from './build.js';
import { TimeSystem } from './time.js';
import { Farm } from './farm.js';
import { Ranch } from './ranch.js';
import { Fishing } from './fishing.js';
import { Neighbors } from './neighbors.js';
import { Board } from './board.js';
import { Combat } from './combat.js';
import { Explore } from './explore.js';
import { Stats, Skills, Collection, Achievements, Story } from './progress.js';
import { Music } from './music.js';
import { Settings } from './settings.js';
import { keys, clearKeys } from './input.js';
import { Audio } from './audio.js';
import { hud } from './ui/hud.js';

const STEP = 1 / 60;   // la simulación avanza siempre a 60 pasos por segundo
const NILO_TIPS = [
  'Los peñascos grandes no se dejan picar con un pico de madera. Hazte uno de piedra en el banco.',
  'Dicen que en las montañas los peñascos esconden cobre, hierro y hasta oro. Pero hace falta buen pico.',
  'Con un horno conviertes el mineral en lingotes. Y con lingotes de cobre, un yunque para herramientas de metal.',
  'En la cocina, una manzana asada da el doble de energía que una cruda. Hazme caso.',
  'Si te quedas sin carbón, quema madera en el horno. Así lo hacía mi abuelo.',
];

// Deltas con tu casa recién hecha: para el fondo del menú, que no tiene partida
function defaultHouseDeltas() {
  const out = new Map();
  for (const [k, c] of Object.entries(byChunk(houseBlueprint({ x0: HOUSE.x0, y0: HOUSE.y0 }), CHUNK))) out.set(k, { removed: {}, tilled: {}, chest: {}, v: 0, ...c });
  return out;
}

export class Game {
  constructor(canvas, props) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.props = props;
    this.view = { w: 640, h: 360, scale: 2 };
    this.mode = 'menu';          // menu | play | pause | map | inventory | craft | chest | …
    this.busy = false;           // hay una escena en marcha (diálogo, puerta…)
    this.player = null;
    this.world = null;
    this.menuWorld = new Overworld(WORLD_SEED, props, defaultHouseDeltas());
    this.underRoof = false;      // el jugador está bajo un tejado del mundo (en una casa)
    this.scene = null;
    this.onSave = null;
    this.time = 0;
    this.frameNo = 0;
    this.effects = makeEffects();
    this.map = new MapView();
    this.inv = new Inventory();
    this.energy = ENERGY_MAX;
    this.gather = new Gathering(this);
    this.craft = new Crafting(this);
    this.niloTip = 0;
    this.explored = new Set();   // trozos descubiertos (claves "cx,cy")
    this.lastChunk = null;
    this.placeName = '';
    this.build = new BuildMode(this);
    this.house = { big: false };
    this.admin = false;          // modo admin (comando /admin): objetos infinitos y construir gratis
    this.camRot = 0;             // giro de la cámara en el mundo (Shift+Q / Shift+E), en pasos (STEPS por vuelta)
    this.camFade = null;         // la imagen de antes de girar, que se desvanece encima de la nueva
    this.cam = { x: 0, y: 0 };
    this.systems = [];           // capas de juego que se enchufan: tiempo, huerto, vecinos… (ver hook)
    this.stats = this.addSystem(new Stats());
    this.skills = this.addSystem(new Skills(this));
    this.days = this.addSystem(new TimeSystem(this));
    this.board = this.addSystem(new Board(this));
    this.farm = this.addSystem(new Farm(this));
    this.ranch = this.addSystem(new Ranch(this));
    this.fishing = this.addSystem(new Fishing(this));
    this.neighbors = this.addSystem(new Neighbors(this));
    this.combat = this.addSystem(new Combat(this));
    this.places = this.addSystem(new Explore(this));
    this.collection = this.addSystem(new Collection(this));
    this.achievements = this.addSystem(new Achievements(this));
    this.story = this.addSystem(new Story(this));
    this.niloTips = NILO_TIPS;
    this.money = 0;
    this.buffs = {};             // efectos de comida: { rapido: hasta cuándo, incansable: … }
    addEventListener('resize', () => this.resize());
    this.resize();
  }

  resize() {
    const v = this.view;
    const s = Settings.v.scale;
    v.scale = s === 'auto' ? Math.max(1, Math.round(Math.max(innerWidth, innerHeight) / 620)) : s;
    v.w = Math.ceil(innerWidth / v.scale);
    v.h = Math.ceil(innerHeight / v.scale);
    this.canvas.width = v.w;
    this.canvas.height = v.h;
    this.canvas.style.width = v.w * v.scale + 'px';
    this.canvas.style.height = v.h * v.scale + 'px';
    this.ctx.imageSmoothingEnabled = false;
  }

  // ---------- sistemas ----------
  // Cada sistema puede tener: reset(save), save(out), update(dt), interact(player, scene), objects(scene),
  // entities(scene), drawGround(ctx, cam, scene, t), drawOverlay(ctx, cam, view, scene, t), hint(), onDay(day)…
  addSystem(sys) { this.systems.push(sys); return sys; }
  hook(name, ...args) { for (const s of this.systems) s[name]?.(...args); }

  // ---------- partida ----------
  // deltas: cambios del jugador en el mundo, cargados de IndexedDB
  start(save, deltas = new Map()) {
    // Solo hay un mundo. Una partida de antes, de otro mundo, pasa a este: lo construido se queda donde
    // estaba, pero se olvida lo que dependía de la naturaleza de aquel (lo talado, recogido y saqueado),
    // el mapa explorado y los lugares descubiertos
    const moved = save.seed !== undefined && save.seed !== WORLD_SEED;
    if (moved) {
      for (const [k, d] of deltas) if (!k.startsWith('u:')) Object.assign(d, { removed: {}, picked: {}, opened: {} });
      save = { ...save, explored: [], found: [] };
    }
    this.world = new Overworld(WORLD_SEED, this.props, deltas);
    if (moved) for (const k of deltas.keys()) this.world.dirty.add(k);   // que se guarde ya así
    this.world.clock = save.clock || 0;
    this.inv = new Inventory(save.inventory);
    if (!save.inventory) for (const [id, n] of START_KIT) this.inv.add(id, n);   // partidas sin mochila: equipo inicial
    this.inv.onChange = () => { this.craft.check(); this.onInventory?.(); };
    this.craft.reset(save);
    this.onInventory?.();
    this.setEnergy(save.energy ?? ENERGY_MAX);
    this.setAdmin(!!save.admin);
    this.camRot = save.cam || 0;
    this.money = save.money ?? 100;
    this.addMoney(0);
    this.gather.reset();
    const p = { ...save.player };
    this.house = { big: !!save.house?.big, built: !!save.house?.built, v: save.house?.v ?? 1 };
    // Tu casa es parte del mundo. Si la partida aún no la tiene (es nueva, o de cuando la casa era una
    // habitación aparte), se levanta ahora; los muebles de aquella habitación pasan dentro.
    if (p.inside) { const [hx, hy] = this.homeSpot(); Object.assign(p, { inside: false, x: hx, y: hy, view: 'front', dir: null }); }
    this.player = new Player({ ...p, x: p.x ?? SPAWN.x, y: p.y ?? SPAWN.y });
    hud.faces = { ...hud.faces, Nilo: NILO_LOOK, [this.player.name]: this.player.look };
    this.scene = this.world;
    this.underRoof = false;
    // Lo que el jugador tenía en su habitación va primero (dentro de la casa); luego se levanta la casa con
    // sus muebles por defecto, que solo ocupan las casillas que quedan libres. Va después de crear al jugador,
    // porque lo que no quepa vuelve a la mochila a través de él.
    if (!this.house.built) { this.migrateRoom(save.house); this.layHouse(this.house.big, true); this.house.built = true; this.house.v = 3; }
    // Partidas de cuando las casas medían la mitad: la casa crece hacia atrás y a los lados (la puerta se queda)
    if (this.house.v < 2) { this.layHouse(this.house.big, false); this.makeRoomForBeds(); this.house.v = 2; }
    // Al crecer, la cama y el hogar se quedaron en medio de la sala: a su sitio, contra la pared
    if (this.house.v < 3) { this.tidyHouse(); this.house.v = 3; }
    this.explored = new Set(save.explored || []);
    this.lastChunk = null;
    this.placeName = '';
    Audio.indoors = this.indoors;
    clearKeys();
    this.mode = 'play';
    this.build.toggle(false);
    this.hook('reset', save);
    this.updatePlace();
  }
  snapshot() {
    if (!this.player) return null;
    const player = this.player.toSave();
    if (this.scene?.kind === 'grid') Object.assign(player, { inside: false, x: this.scene.exitTo.x, y: this.scene.exitTo.y });   // en una cueva se guarda la entrada
    const out = {
      seed: this.world.seed, player, explored: [...this.explored],
      inventory: this.inv.toSave(), energy: Math.round(this.energy), clock: Math.round(this.world.clock),
      ...this.craft.toSave(), house: { big: this.house.big, built: true, v: 3 }, money: this.money,
      admin: this.admin, cam: this.camRot,
    };
    this.hook('save', out);
    return out;
  }
  // Girar la cámara un paso (d: 1 o -1; STEPS pasos por vuelta). Solo en el mundo de fuera: en cuevas y
  // templos la vista es fija. La imagen de antes se funde con la nueva para que el salto no sea brusco.
  rotateCamera(d) {
    if (this.mode !== 'play' || !this.player || this.scene !== this.world || this.busy) return false;
    const c = this.ctx.canvas, snap = mk(c.width, c.height);
    snap.getContext('2d').drawImage(c, 0, 0);
    this.camFade = { img: snap, at: performance.now() };
    // Los muñecos y los animales siguen mirando hacia el mismo sitio del mundo: su vista cambia con la cámara
    const who = [this.player, ...this.world.entities, ...this.systems.flatMap(s => s.entities?.(this.world) || [])].filter(e => e?.worldDir);
    const dirs = who.map(e => e.worldDir());
    this.camRot = (this.camRot + d + STEPS) % STEPS;
    this.applyView();
    who.forEach((e, i) => e.faceTo(...dirs[i]));
    return true;
  }
  // La vista que toca: la de la cámara en el mundo de fuera; sin girar en el menú, las cuevas y los templos
  applyView() {
    const want = this.player && this.scene === this.world ? this.camRot : 0;
    if (VIEW.r === want) return;
    setViewRot(want);
    this.world?.resetView();
    this.menuWorld.resetView();
  }
  // Modo admin: lo que se usa no se gasta, en la mochila están todos los objetos y construir es gratis
  // (y se puede construir también sobre el terreno del pueblo)
  setAdmin(on) {
    this.admin = on;
    this.inv.infinite = on;
    if (this.world) this.world.buildAnywhere = on;
    document.body.classList.toggle('admin', on);
    this.build.onChange?.();
    this.onInventory?.();
  }
  // Guarda los trozos del mundo que han cambiado desde la última vez
  async flush(accountId) {
    const w = this.world;
    if (!w || !w.dirty.size) return;
    const keys = [...w.dirty];
    w.dirty.clear();
    await WorldStore.write(accountId, w.deltas, keys);
  }
  addMoney(n) {
    this.money = Math.max(0, this.money + n);
    hud.money(this.money);
    if (n > 0) this.stats?.add('ganado', n);
  }
  setEnergy(v) {
    this.energy = Math.max(0, Math.min(ENERGY_MAX, v));
    hud.energy(this.energy / ENERGY_MAX);
  }

  // Marca como explorados los trozos alrededor del jugador
  explore() {
    const p = this.player, cx = Math.floor(p.x / CHUNK), cy = Math.floor(p.y / CHUNK), key = `${cx},${cy}`;
    if (key === this.lastChunk) return;
    this.lastChunk = key;
    for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) this.explored.add(`${cx + dx},${cy + dy}`);
  }
  // Nombre del lugar (pueblo o bioma) y coordenadas, con el pueblo en (0, 0)
  updatePlace() {
    const p = this.player;
    const sc = this.scene;
    const name = sc?.kind === 'grid' ? sc.name : this.underRoof ? this.houseName() : inBounds(p.x, p.y) ? 'Pueblo Brotes' : BIOMES[this.world.gen.biomeAt(p.x, p.y)].name;
    if (name !== this.placeName) { hud.place(name, !!this.placeName); this.placeName = name; }
    hud.coords(p.inside ? null : [Math.round(p.x - CENTER.x), Math.round(p.y - CENTER.y)]);
    document.body.classList.toggle('indoors', this.indoors);
    document.body.classList.toggle('underground', sc?.kind === 'grid');
  }
  end() {
    this.player = null;
    this.scene = null;
    this.mode = 'menu';
    this.busy = false;
    hud.closeDialog();
    hud.prompt(null);
  }

  // ---------- interacción ----------
  nearest() {
    const p = this.player;
    if (this.busy || this.mode !== 'play' || !p) return null;
    const near = (a, r) => Math.hypot(p.x - a.x, p.y - a.y) < r;
    const sc = this.scene;
    for (const s of this.systems) { const r = s.interact?.(p, sc); if (r) return r; }
    // Una puerta cerca: se abre o se cierra (cerrarla con el jugador en el hueco lo dejaría atrapado)
    const door = sc.doorNear?.(p.x, p.y);
    if (door) {
      const closed = sc.doorClosed(...door), inGap = Math.hypot(door[0] + 0.5 - p.x, door[1] + 0.5 - p.y) < 0.55;
      if (closed || !inGap) return { text: closed ? 'Abrir la puerta' : 'Cerrar la puerta', run: () => { sc.toggleDoor(...door); Audio.place(); this.onSave?.(); } };
    }
    // Lo colocado: las estaciones se usan, la cama sirve para dormir, el cofre se abre y lo demás se recoge
    // (lo fijo de las casas de los vecinos no se toca)
    const o = sc.placedNear?.(p.x, p.y, 1.3).find(o => !o.fixed);
    if (o) {
      const name = ITEMS[o.placed].name.toLowerCase();
      if (STATIONS[o.placed]) return { text: `Usar ${name}`, run: () => this.onCraft?.(o.placed) };
      if (o.placed === 'cama') return { text: 'Dormir', run: () => this.sleep() };
      if (o.placed === 'cofre') return { text: 'Abrir el cofre', run: () => this.onChest?.(sc.chestAt(...o.tile), o.tile) };
      return { text: `Recoger ${name}`, run: () => this.pickUp(o) };
    }
    return null;
  }
  sleep() { return this.days.sleep(); }
  // Devolver a la mochila algo colocado
  pickUp(o) {
    if (this.inv.room(o.placed) < 1) { this.gather.float('No te cabe en la mochila', '#ffb0a0'); Audio.error(); return false; }
    if (o.placed === 'cofre' && this.scene.chestAt(...o.tile)?.some(Boolean)) { this.gather.float('Vacía el cofre antes', '#ffb0a0'); Audio.error(); return false; }
    this.scene.unplace(o);
    this.inv.add(o.placed, 1);
    Audio.pickup();
    return true;
  }
  action() {
    if (hud.dialogOpen) return hud.next();
    this.nearest()?.run();
  }
  async talkNilo() {
    this.busy = true;
    const nilo = this.world.nilo, p = this.player;
    nilo.flip = p.x - p.y < nilo.x - nilo.y;
    const first = !this.craft.taught.has('banco');
    await hud.say('Nilo', first ? [
      `¡Así que tú eres ${p.name}! Por fin llega alguien a la casa del final del camino. Llevaba años vacía.`,
      'Esto es Pueblo Brotes. Pequeño, sí, pero aquí cada cual se construye la vida a su manera.',
      'Dicen que el mundo no se acaba nunca más allá del bosque. Yo nunca he llegado tan lejos.',
      'Te he dejado en la mochila unas herramientas viejas: hacha, pico, guadaña y azada. Elígelas con los números y úsalas con Espacio.',
      'Y un consejo de viejo carpintero: con madera se hacen tablas (pulsa C para fabricar). Con seis tablas y dos piedras te sale un banco de carpintero, y con él, herramientas mejores.',
    ] : [NILO_TIPS[this.niloTip++ % NILO_TIPS.length]]);
    if (first) this.craft.teach('banco');
    this.busy = false;
  }
  // Nilo amplía la casa del pueblo a cambio de materiales
  async offerReform() {
    const cost = [['tablas', 40], ['piedra', 30]], ok = cost.every(([id, n]) => this.inv.count(id) >= n);
    const pick = await hud.ask('Nilo', 'Por cierto, esa casa se te va a quedar pequeña. Con 40 tablas y 30 piedras te la amplío: más sitio para muebles.', ok ? ['¡Hecho! Amplíala', 'Ahora no'] : ['Vale, lo junto y vuelvo']);
    if (!ok || pick !== 0) return;
    for (const [id, n] of cost) this.inv.remove(id, n);
    this.house.big = true;
    this.layHouse(true, false);
    await hud.say('Nilo', ['¡Listo! Tira de martillo… quiero decir, ya está. Tu casa es ahora mucho más amplia. Ve a verla.']);
    this.onSave?.();
  }
  // ¿Está el jugador a cubierto? En una cueva o bajo un tejado del mundo
  get indoors() { return !!(this.player?.inside || this.underRoof); }
  // Nombre de la casa en la que está el jugador
  houseName() {
    const p = this.player;
    if (inOwnHouse(p.x, p.y)) return 'Tu casa';
    for (const h of Object.values(HOUSES)) if ((!h.project || hasProject(h.project)) && p.x > h.x0 && p.x < h.x1 && p.y > h.y0 && p.y < h.y1) return `Casa de ${h.name}`;
    return 'Bajo techo';
  }
  // La casilla de dentro de tu casa, junto a la puerta (donde despiertas si te rescatan)
  homeSpot() {
    const H = this.house.big ? HOUSE_BIG : HOUSE, [dx, dy] = doorTile(H.x0, H.y0, this.house.big);
    return [dx + 0.5, dy - 0.5];
  }
  // Llevar al jugador a su casa (cuando cae en combate)
  goHome() {
    const [x, y] = this.homeSpot();
    Object.assign(this.player, { inside: false, x, y, view: 'front', dir: null, boat: false, mount: false });
    this.scene = this.world;
    this.updatePlace();
  }
  // Devuelve algo a la mochila; si no cabe, al suelo
  giveBack(id, n = 1) {
    const left = this.inv.add(id, n);
    if (left && this.player) this.gather.throwOut(id, left);
  }
  // Primera casilla libre de dentro de una casa (sin contar la de delante de la puerta), o null
  freeTile(H, dx, dy) {
    const w = this.world;
    for (let ty = H.y0 + 1; ty < H.y1 - 1; ty++) for (let tx = H.x0 + 1; tx < H.x1 - 1; tx++) {
      if (tx === dx && ty === dy - 1) continue;
      if (!w.ownAt('placed', tx, ty) && !w.footAt(tx, ty)) return [tx, ty];
    }
    return null;
  }
  // Levanta tu casa con piezas de construcción (partida nueva, partida de antes del cambio o la ampliación
  // de Nilo). Lo que haya del jugador donde va un muro vuelve a la mochila (las piezas devuelven sus
  // materiales); un cofre con cosas se cambia de sitio dentro de la casa. furnish: con muebles.
  layHouse(big, furnish) {
    const w = this.world, H = big ? HOUSE_BIG : HOUSE, [dx, dy] = doorTile(H.x0, H.y0, big);
    const bp = houseBlueprint({ x0: H.x0, y0: H.y0, big, furnish: furnish ? 'full' : 'none' });
    const interior = (tx, ty) => tx > H.x0 && tx < H.x1 - 1 && ty > H.y0 && ty < H.y1 - 1;
    const clear = (tx, ty) => {
      const cur = w.ownAt('placed', tx, ty);
      if (!cur) return;
      const [cid] = parsePlaced(cur), o = { tile: [tx, ty], layer: 'placed', placed: cid };
      const items = cid === 'cofre' ? w.chestAt(tx, ty) : null;
      w.unplace(o);
      if (items?.some(Boolean)) {
        const spot = this.freeTile(H, dx, dy);
        if (spot) { w.place(spot[0], spot[1], 'cofre'); w.delta(Math.floor(spot[0] / CHUNK), Math.floor(spot[1] / CHUNK)).chest[`${spot[0]},${spot[1]}`] = items; return; }
        for (const it of items) if (it) this.giveBack(it.id, it.n);
      }
      if (PIECES[cid]) { for (const [m, n] of PIECES[cid].cost) this.giveBack(m, n); } else this.giveBack(cid, 1);
    };
    for (const [t, raw] of Object.entries(bp.placed)) {
      const [tx, ty] = t.split(',').map(Number), [id, rot] = parsePlaced(raw);
      if (PIECES[id]) { if (parsePlaced(w.ownAt('placed', tx, ty) || '')[0] === id) continue; clear(tx, ty); w.place(tx, ty, id, rot); }
      else if (!w.ownAt('placed', tx, ty)) w.place(tx, ty, id, rot);   // muebles: solo donde no haya nada del jugador
    }
    // Muros de antes que al ampliar quedan dentro: fuera
    for (let ty = H.y0; ty < H.y1; ty++) for (let tx = H.x0; tx < H.x1; tx++) {
      if (!interior(tx, ty)) continue;
      const cur = w.ownAt('placed', tx, ty), kind = cur && PIECES[parsePlaced(cur)[0]]?.kind;
      if (kind === 'wall' || kind === 'door') clear(tx, ty);
    }
    for (const layer of ['floor', 'roof']) for (const [t, id] of Object.entries(bp[layer])) {
      const [tx, ty] = t.split(',').map(Number);
      if (!w.ownAt(layer, tx, ty)) w.place(tx, ty, id);
    }
  }
  // Las camas ocupan dos casillas: lo que haya puesto donde van los pies se cambia de sitio dentro de casa
  makeRoomForBeds() {
    const w = this.world, H = this.house.big ? HOUSE_BIG : HOUSE, [dx, dy] = doorTile(H.x0, H.y0, this.house.big);
    for (let ty = H.y0; ty < H.y1; ty++) for (let tx = H.x0; tx < H.x1; tx++) {
      const [id, rot] = parsePlaced(w.ownAt('placed', tx, ty) || '');
      if (id !== 'cama') continue;
      const [fx, fy] = rot ? [tx + 1, ty] : [tx, ty + 1], cur = w.ownAt('placed', fx, fy);
      if (!cur || PIECES[parsePlaced(cur)[0]]) continue;   // nada, o un muro (la cama se queda como está)
      const items = w.chestAt(fx, fy), [cid, crot] = parsePlaced(cur);
      w.unplace({ tile: [fx, fy], layer: 'placed', placed: cid });
      const spot = this.freeTile(H, dx, dy);
      if (!spot) { this.giveBack(cid, 1); for (const it of items || []) if (it) this.giveBack(it.id, it.n); continue; }
      w.place(spot[0], spot[1], cid, crot);
      if (items) w.delta(Math.floor(spot[0] / CHUNK), Math.floor(spot[1] / CHUNK)).chest[`${spot[0]},${spot[1]}`] = items;
    }
  }
  // La cama y el hogar de tu casa que no estén contra un muro pasan a su sitio del plano (contra la pared
  // de atrás), si está libre
  tidyHouse() {
    const w = this.world, big = this.house.big, H = big ? HOUSE_BIG : HOUSE, bp = houseBlueprint({ x0: H.x0, y0: H.y0, big });
    const wallAt = (x, y) => w.pieceAt(x, y)?.kind === 'wall';
    const free = (x, y) => !w.ownAt('placed', x, y) && !w.footAt(x, y);
    for (const id of ['cama', 'chimenea']) {
      const spots = Object.entries(bp.placed).filter(([, v]) => parsePlaced(v)[0] === id).map(([t]) => t.split(',').map(Number));
      for (let ty = H.y0 + 1; ty < H.y1 - 1; ty++) for (let tx = H.x0 + 1; tx < H.x1 - 1; tx++) {
        const [cur, rot] = parsePlaced(w.ownAt('placed', tx, ty) || '');
        if (cur !== id || wallAt(...(rot ? [tx - 1, ty] : [tx, ty - 1]))) continue;
        const spot = spots.find(([x, y]) => free(x, y) && (id !== 'cama' || free(x, y + 1)));
        if (!spot) continue;
        w.unplace({ tile: [tx, ty], layer: 'placed', placed: id });
        w.place(spot[0], spot[1], id);
      }
    }
  }
  // Muebles y cofres de la habitación de antes (coordenadas de la habitación): dentro de la casa nueva.
  // Lo que no cabe va a la mochila o al suelo.
  migrateRoom(house) {
    const entries = Object.entries(house?.placed || {});
    if (!entries.length) return;
    const w = this.world, H = this.house.big ? HOUSE_BIG : HOUSE, [dx, dy] = doorTile(H.x0, H.y0, this.house.big);
    entries.sort(([a], [b]) => (house.chests?.[b] ? 1 : 0) - (house.chests?.[a] ? 1 : 0));   // los cofres primero
    let lost = 0;
    for (const [k, raw] of entries) {
      const [id, rot] = parsePlaced(raw), spot = this.freeTile(H, dx, dy);
      if (spot) {
        w.place(spot[0], spot[1], id, rot);
        if (id === 'cofre' && house.chests?.[k]) w.delta(Math.floor(spot[0] / CHUNK), Math.floor(spot[1] / CHUNK)).chest[`${spot[0]},${spot[1]}`] = house.chests[k];
      } else {
        this.giveBack(id, 1);
        for (const it of house.chests?.[k] || []) if (it) this.giveBack(it.id, it.n);
        lost++;
      }
    }
    hud.toast(`Tu casa ya es parte del mundo: los muebles de la habitación están dentro${lost ? ' (lo que no cabía, en la mochila o en el suelo)' : ''}`);
  }
  // Cambiar a otra escena (cuevas, mazmorras…) con fundido. `inside`: no se ve el mapa ni el cielo.
  async goTo(scene, x, y, { inside = true, sound = true } = {}) {
    this.busy = true;
    this.player.stop();
    if (sound) Audio.door();
    await hud.fade(true);
    Object.assign(this.player, { x, y, inside, view: 'front', dir: null });
    this.scene = scene;
    Audio.indoors = inside;
    this.build.toggle(false);
    this.updatePlace();
    await hud.fade(false);
    this.busy = false;
  }
  // Casilla bajo un punto de la pantalla (ratón o dedo)
  tileAtScreen(clientX, clientY) {
    const v = this.view, sc = this.scene;
    if (!sc) return null;
    const sx = clientX / v.scale + this.cam.x, sy = clientY / v.scale + this.cam.y;
    const [ox, oy] = sc.origin || [0, 0], [gx, gy] = toGrid(sx - ox, sy - oy);
    return [Math.floor(gx), Math.floor(gy)];
  }

  // ---------- bucle ----------
  run() {
    let last = performance.now(), acc = 0;
    const frame = now => {
      acc += Math.min(0.25, (now - last) / 1000);
      last = now;
      while (acc >= STEP) { this.update(STEP); acc -= STEP; }
      this.render();
      if (this.frameNo % 30 === 0) Music.update(this);
      requestAnimationFrame(frame);
    };
    requestAnimationFrame(frame);
  }

  update(dt) {
    this.time += dt;
    const p = this.player;
    if (p && this.mode === 'map') { this.map.update(keys, dt); return; }
    if (!p || this.mode !== 'play') return;
    this.world.clock += dt;
    this.gather.update(dt);
    this.hook('update', dt);
    if (keys.use && !this.busy && !this.build.on) this.gather.use(true);
    if (this.busy || hud.dialogOpen) { p.stop(); return; }
    p.speedMul = (this.buffs.rapido > this.time ? 1.35 : 1) * (p.mount ? 1.8 : 1);
    p.update(dt, keys, this.scene);
    if (!p.inside) this.explore();
    // Bajo un tejado: cambia el ambiente (sonido, lluvia, nombre del sitio) y se guarda, como al entrar en casa
    const under = this.scene === this.world && underRoof(this.world, p.x, p.y);
    if (under !== this.underRoof) { this.underRoof = under; p.underRoof = under; Audio.indoors = this.indoors; this.updatePlace(); this.onSave?.(); }
    if (this.frameNo % 10 === 0) this.updatePlace();
  }

  render() {
    this.applyView();
    DEPTH = depthDir();
    // Recién girada la cámara, el suelo nuevo se pinta poco a poco (unos milisegundos por fotograma) mientras
    // se sigue viendo la imagen de antes
    if (this.world) this.world.buildBudget = this.camFade ? 24 : Infinity;
    const ctx = this.ctx, view = this.view, t = this.time;
    const scene = this.scene || this.menuWorld;
    this.frameNo++;
    const focus = this.player ? scene.P(this.player.x, this.player.y) : toScreen(CENTER.x + Math.sin(t * 0.07) * 6, CENTER.y + Math.cos(t * 0.05) * 5);
    const cam = scene.camera(focus[0], focus[1], view), playing = this.player && scene === this.scene;
    this.cam = cam;
    scene.drawGround(ctx, cam, view, this.frameNo);
    if (playing) this.hook('drawGround', ctx, cam, scene, t);
    if (scene.kind === 'world') this.effects.water(ctx, cam, t);
    // Dentro de una casa solo se ve la casa: fuera de su suelo, todo negro
    const p = this.player;
    const under = playing && scene.roofAt && underRoof(scene, p.x, p.y) ? roofRegion(scene, Math.floor(p.x), Math.floor(p.y)) : null;
    this.houseRegion = under;
    // El candelabro cuelga en el centro de la casa (la media de sus casillas)
    this.houseLamp = null;
    if (under) {
      let sx = 0, sy = 0;
      for (const k of under) { const [x, y] = k.split(','); sx += +x + 0.5; sy += +y + 0.5; }
      this.houseLamp = [sx / under.size, sy / under.size];
      blackOutside(ctx, cam, view, scene, under);
    }
    if (playing) { this.gather.drawTarget(ctx, cam, t); this.gather.drawDrops(ctx, cam, t); this.build.draw(ctx, cam, t); }

    // Todo lo que se dibuja, ordenado por profundidad
    const items = [], chimneys = [];
    const inside = (x, y) => !under || under.has(`${Math.floor(x)},${Math.floor(y)}`);
    const objs = scene.objects();
    if (playing) for (const s of this.systems) { const more = s.objects?.(scene); if (more) for (const o of more) objs.push(o); }
    for (const o of objs) {
      if (!inside(...(o.tile ? [o.tile[0], o.tile[1]] : [o.x, o.y]))) continue;
      // Lo que se apoya en una esquina de su huella (puestos, muelle) se dibuja como sin girar, pero centrado en
      // su huella; si con la cámara girada su lado largo se ve hacia el otro lado, en espejo
      let [sx, sy] = scene.P(o.x, o.y), mirror = false, mx = sx;
      if (o.corner && VIEW.r) {
        const cx = (o.fx[0] + o.fx[1]) / 2, cy = (o.fy[0] + o.fy[1]) / 2, dx = cx - o.x, dy = cy - o.y, [cs, cys] = scene.P(cx, cy);
        const long = o.fx[1] - o.fx[0] >= o.fy[1] - o.fy[0] ? [1, 0] : [0, 1], [ex, ey] = toView(...long), sdx = (ex - ey) * Math.sign((ex + ey) || 1);
        mirror = Math.sign(sdx) !== (long[0] ? 1 : -1);
        [sx, sy, mx] = [cs - (dx - dy) * 16, cys - (dx + dy) * 8, cs];
      }
      const x = sx - o.ax - cam.x, y = sy - o.ay - cam.y;
      if (x < view.w && y < view.h && x + o.img.width > 0 && y + o.img.height > 0) items.push({ o, x, y, mirror, sx: mx - cam.x, k: footprintOf(o), r: [x, y, x + o.img.width, y + o.img.height] });
    }
    // Personas, animales y criaturas: un rectángulo holgado alrededor de los pies (cabe el caballo)
    const addEntity = e => { if (e !== p && !inside(e.x, e.y)) return; const [sx, sy] = scene.P(e.x, e.y), x = sx - cam.x, y = sy - cam.y; items.push({ e, k: viewFoot(e.footprint()), r: [x - 32, y - 84, x + 32, y + 8] }); };
    for (const e of scene.entities) addEntity(e);
    if (playing) for (const s of this.systems) { const more = s.entities?.(scene); if (more) for (const e of more) addEntity(e); }
    if (playing) addEntity(p);
    depthSort(items);
    for (const it of items) {
      if (it.e) {
        const [sx, sy] = scene.P(it.e.x, it.e.y);
        it.e.draw(ctx, sx - cam.x, sy - cam.y, t);
        if (it.e === this.player) this.gather.drawSwing(ctx, sx - cam.x, sy - cam.y, it.e);
        continue;
      }
      const o = it.o;
      let alpha = 1, img = o.img;
      if (under) {
        // Dentro de casa: sin tejado y sin las paredes de delante (sur y este); de las de atrás, enteras.
        // En las esquinas de delante y atrás a la vez queda solo el tramo de atrás.
        if (o.roof) continue;
        // Delante es la pared que queda entre la cámara y la sala: ir de ella hacia dentro (hacia donde tiene el
        // suelo) aleja de la cámara. De canto (con la cámara en diagonal) cuenta como de atrás.
        if (o.wall) {
          const cut = scene.floorClip(...o.tile), iy = cut?.[2] === 0 ? 1 : cut?.[3] === 0 ? -1 : 0, ix = cut?.[0] === 0 ? 1 : cut?.[1] === 0 ? -1 : 0;
          const frontY = iy * DEPTH[1] < -1e-6, frontX = ix * DEPTH[0] < -1e-6, backY = iy && !frontY, backX = ix && !frontX;
          if (frontX || frontY) {
            if (o.door) img = doorSprite(o.door === 'x', undefined, scene.doorClosed(...o.tile), true, VIEW.r);   // la puerta de delante, entera y sin muro encima
            else if (!o.wallId || !(backX || backY)) continue;
            else img = wallSprite(o.wallId, o.mask, backY ? 'x' : 'y', true, VIEW.r);
          } else if (!cut && depthOf(o.x, o.y) > depthOf(p.x, p.y)) continue;   // un tabique de dentro que tapa al jugador
          else if (o.wallId) img = wallSprite(o.wallId, o.mask, undefined, true, VIEW.r);   // por dentro, yeso blanco
        }
      }
      // Un muro (o un tejado) que tapa al jugador desde delante se ve a medias. Los muros miden el doble que una
      // persona, así que lo tapan aunque estén hasta 11 casillas más adelante. En cuevas y templos hay paredes en
      // todas partes y se tapan unas a otras: ahí no se ven, y en un margen más ancho.
      else if ((o.wall || o.roof) && playing) {
        const [ox, oy] = toView(o.x, o.y), [qx, qy] = toView(p.x, p.y), ahead = ox + oy - (qx + qy);
        if (ahead > 0.4 && ahead < 11) {
          const side = Math.abs(ox - oy - (qx - qy)), cave = scene.kind === 'grid';
          if (side < (cave ? 2.6 : 1.7)) { if (cave) continue; alpha = 0.45; }
        }
      }
      if (alpha < 1) ctx.globalAlpha = alpha;
      const shake = o.shakeUntil > t ? Math.round(Math.sin(t * 90) * 2) : 0;   // lo que se golpea tiembla
      if (it.mirror) { ctx.save(); ctx.translate(Math.round(it.sx) * 2, 0); ctx.scale(-1, 1); ctx.drawImage(img, Math.round(it.x), Math.round(it.y)); ctx.restore(); }
      else ctx.drawImage(img, Math.round(it.x) + shake, Math.round(it.y));
      if (alpha < 1) ctx.globalAlpha = 1;
      it.o.draw?.(ctx, it.x, it.y, t);
      // La boca del fuego (hogar, horno, cocina) mira a +y (girado, a +x): de espaldas a la cámara no se ve
      const mouth = it.o.rot ? [1, 0] : [0, 1], lit = mouth[0] * DEPTH[0] + mouth[1] * DEPTH[1] > 1e-6;
      if (it.o.fire && lit) { const [fx, fy] = scene.P(...it.o.fire); this.effects.fire(ctx, fx - cam.x, fy - cam.y, t, it.o.fire[3]); }
      if (it.o.chimneyTop) { const [sx, sy] = scene.P(...it.o.chimneyTop); chimneys.push([sx - cam.x, sy - cam.y]); }
      if (it.o.glow && lit) {   // boca de horno o cocina encendida
        const [gx, gy, gz] = it.o.glow, [dx, dy] = it.o.rot ? [gy, -gx] : [gx, gy], [sx, sy] = scene.P(it.o.x + dx, it.o.y + dy, gz), f = Math.sin(t * 13 + it.o.x) > 0.3;
        ctx.fillStyle = f ? '#ffd860' : '#ff8a2a';
        ctx.fillRect(Math.round(sx - cam.x) - 1, Math.round(sy - cam.y) - (f ? 1 : 0), 3, 2);
      }
      if (it.o.candle) { const f = Math.sin(t * 18) > 0 ? 1 : 0; ctx.fillStyle = '#ffc040'; ctx.fillRect(it.o.candle[0] - cam.x, it.o.candle[1] - cam.y - 2 - f, 2, 3); }
    }

    for (const [sx, sy] of chimneys) this.effects.smoke(ctx, sx, sy, t);
    // Encima de todo lo de la sala, el candelabro del techo con sus velas encendidas
    if (this.houseLamp) {
      const [lx, ly] = this.houseLamp, [sx, sy] = scene.P(lx, ly), x = Math.round(sx - cam.x), y = Math.round(sy - cam.y);
      ctx.drawImage(chandelierSprite(), x - LAMP_AX, y - LAMP_AY);
      CANDLES.forEach(([cx, cy, cz], i) => {
        const [fx, fy] = scene.P(lx + cx, ly + cy, cz), f = Math.sin(t * 11 + i * 2.1) > 0.2;
        ctx.fillStyle = f ? '#ffd860' : '#ff9a30'; ctx.fillRect(Math.round(fx - cam.x), Math.round(fy - cam.y) - (f ? 2 : 1), 1, f ? 2 : 1);
        ctx.fillStyle = '#fff2b0'; ctx.fillRect(Math.round(fx - cam.x), Math.round(fy - cam.y), 1, 1);
      });
    }
    if (scene.kind === 'world' && !under) {
      this.effects.butterflies(ctx, cam, t);
      this.effects.clouds(ctx, cam, view);
    }
    if (playing) this.hook('drawOverlay', ctx, cam, view, scene, t);
    if (playing) this.gather.drawEffects(ctx, cam);
    if (this.camFade) {
      if (scene.chunks?.missing) this.camFade.at = performance.now();   // aún falta suelo por pintar: se espera
      const k = (performance.now() - this.camFade.at) / 280;
      if (k >= 1) this.camFade = null;
      else { ctx.globalAlpha = 1 - k; ctx.drawImage(this.camFade.img, 0, 0); ctx.globalAlpha = 1; }
    }
    hud.prompt(this.nearest()?.text);
    let hint = '';
    if (this.player) {
      for (const s of this.systems) { hint = s.hint?.() || ''; if (hint) break; }
      hint ||= this.build.on ? this.build.hint() : this.gather.hint();
    }
    hud.hint(hint);
    if (this.player && this.world) {
      this.map.markers = this.places.markers();
      if (this.mode === 'map') this.map.drawBig(this.world.gen, this.explored, this.player.x, this.player.y, t);
      else if (!this.indoors) this.map.drawMini(this.world.gen, this.explored, this.player.x, this.player.y, t);
    }
  }
}

// Huella de un objeto en la rejilla: una caja (casas, puestos, vallas, muros) o casi un punto (árboles,
// rocas, muebles). c es su centro en profundidad; bias adelanta algo que va en alto (los tejados).
// La huella sigue en el mundo; c es lo cerca que queda su centro de la cámara
function footprintOf(o) {
  const fx = o.fx || [o.x - 0.01, o.x + 0.01], fy = o.fy || [o.y - 0.01, o.y + 0.01];
  return viewFoot({ x0: fx[0], x1: fx[1], y0: fy[0], y1: fy[1] }, o.bias);
}
// Hacia dónde se acerca uno a la cámara, en el mundo (se pone al empezar cada fotograma)
let DEPTH = [1, 1];
function viewFoot(k, bias = 0) {
  return { x0: k.x0, x1: k.x1, y0: k.y0, y1: k.y1, c: depthOf((k.x0 + k.x1) / 2, (k.y0 + k.y1) / 2) + bias };
}
// Lo cerca que está un punto de la cámara (más, más adelante en pantalla)
const depthOf = (x, y) => x * DEPTH[0] + y * DEPTH[1];
// Todo negro menos el suelo de la casa (bajo los muros, hasta el muro: lo mismo que se ve del suelo)
function blackOutside(ctx, cam, view, scene, region) {
  ctx.beginPath();
  ctx.rect(0, 0, view.w, view.h);
  for (const k of region) {
    const [tx, ty] = k.split(',').map(Number), [x0, x1, y0, y1] = scene.floorClip(tx, ty) || [-0.5, 0.5, -0.5, 0.5];
    // Al revés que el rectángulo de la pantalla, para que cada casilla sea un hueco
    const pts = [[x0, y0], [x0, y1], [x1, y1], [x1, y0]].map(([x, y]) => scene.P(tx + 0.5 + x, ty + 0.5 + y));
    ctx.moveTo(pts[0][0] - cam.x, pts[0][1] - cam.y);
    for (const [sx, sy] of pts.slice(1)) ctx.lineTo(sx - cam.x, sy - cam.y);
    ctx.closePath();
    // Por la puerta de delante (vista desde la cámara) se ve un poco de lo de fuera: el hueco del umbral y algo más allá
    const outDir = y1 === 0 ? [0, 1] : y0 === 0 ? [0, -1] : x1 === 0 ? [1, 0] : x0 === 0 ? [-1, 0] : null, front = outDir && outDir[0] * DEPTH[0] + outDir[1] * DEPTH[1] > 1e-6;
    if (front && scene.pieceAt(tx, ty)?.kind === 'door' && !scene.doorClosed(tx, ty)) {
      const out = { '0,1': [-0.36, 0.36, 0, 1.2], '0,-1': [-0.36, 0.36, -1.2, 0], '1,0': [0, 1.2, -0.36, 0.36], '-1,0': [-1.2, 0, -0.36, 0.36] }[`${outDir}`], [a0, a1, b0, b1] = out;
      const q = [[a0, b0], [a0, b1], [a1, b1], [a1, b0]].map(([x, y]) => scene.P(tx + 0.5 + x, ty + 0.5 + y));
      ctx.moveTo(q[0][0] - cam.x, q[0][1] - cam.y);
      for (const [sx, sy] of q.slice(1)) ctx.lineTo(sx - cam.x, sy - cam.y);
      ctx.closePath();
    }
  }
  ctx.fillStyle = '#000';
  ctx.fill('nonzero');
}
// ¿Está este punto bajo un tejado? En la casilla de un muro o de una puerta solo cuenta el lado de dentro
// (el que tiene suelo): delante de una puerta cerrada se está fuera, aunque el tejado llegue hasta ahí
function underRoof(scene, x, y) {
  const tx = Math.floor(x), ty = Math.floor(y);
  if (!scene.roofAt(tx, ty)) return false;
  const c = scene.floorClip?.(tx, ty), u = x - tx - 0.5, v = y - ty - 0.5;
  return !c || (u >= c[0] && u <= c[1] && v >= c[2] && v <= c[3]);
}
// Casillas de tejado unidas a la del jugador (la casa en la que está)
function roofRegion(scene, tx, ty) {
  const seen = new Set([`${tx},${ty}`]), todo = [[tx, ty]];
  while (todo.length && seen.size < 400) {
    const [x, y] = todo.pop();
    for (const [nx, ny] of [[x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]]) {
      const k = `${nx},${ny}`;
      if (!seen.has(k) && scene.roofAt(nx, ny)) { seen.add(k); todo.push([nx, ny]); }
    }
  }
  return seen;
}
// ¿Cuál de dos huellas va delante? 1: a, -1: b, 0: da igual (no pueden taparse).
// Va delante la que empieza donde la otra acaba, en x o en y. Si están en diagonal (una más allá en x
// y la otra más allá en y) no se tapan; si se pisan, decide el centro.
// (con las huellas en el mundo: va delante la que está más allá, hacia la cámara, en los ejes que las separan)
function ahead(a, b) {
  const sx = a.x0 >= b.x1 ? 1 : b.x0 >= a.x1 ? -1 : 0, sy = a.y0 >= b.y1 ? 1 : b.y0 >= a.y1 ? -1 : 0;
  if (!sx && !sy) return Math.sign(a.c - b.c);
  const k = sx * DEPTH[0] + sy * DEPTH[1];
  return Math.abs(k) < 1e-6 ? 0 : Math.sign(k);
}
// Orden de dibujo. Ordenar solo por el centro falla con lo grande (una casa, un puesto, una valla larga):
// un árbol de detrás puede tener el centro más adelante que el de la casa y acabar pintado encima del tejado.
// Así que, para cada pareja que se pisa en pantalla, se decide quién va detrás con sus huellas, y se pinta
// en un orden que respete todas esas parejas (orden topológico), partiendo del orden por centro.
function depthSort(items) {
  items.sort((a, b) => a.k.c - b.k.c);
  const n = items.length, byX = new Int32Array(n);
  for (let i = 0; i < n; i++) byX[i] = i;
  byX.sort((a, b) => items[a].r[0] - items[b].r[0]);
  // Lista de "lo que tiene que ir antes" de cada uno, en arrays planos para no crear objetos en cada fotograma
  const head = new Int32Array(n).fill(-1), next = [], dest = [];
  const before = (i, j) => { dest.push(j); next.push(head[i]); head[i] = dest.length - 1; };
  // Barrido de izquierda a derecha: solo se comparan las parejas que se solapan en horizontal
  for (let p = 0; p < n; p++) {
    const i = byX[p], A = items[i], ra = A.r;
    for (let q = p + 1; q < n; q++) {
      const j = byX[q], rb = items[j].r;
      if (rb[0] >= ra[2]) break;
      if (ra[3] <= rb[1] || rb[3] <= ra[1]) continue;
      const d = ahead(A.k, items[j].k);
      if (d > 0) before(i, j); else if (d < 0) before(j, i);
    }
  }
  const state = new Uint8Array(n), out = new Array(n);
  let o = 0;
  const visit = i => {   // si hay un ciclo (huellas que se pisan raras), se rompe por donde se llegó
    state[i] = 1;
    for (let e = head[i]; e >= 0; e = next[e]) if (!state[dest[e]]) visit(dest[e]);
    out[o++] = items[i];
  };
  for (let i = 0; i < n; i++) if (!state[i]) visit(i);
  for (let i = 0; i < n; i++) items[i] = out[i];
}

// ---------- efectos de ambiente ----------
function makeEffects() {
  const rand = rng(5);
  const butterflies = Array.from({ length: 6 }, () => ({ cx: 12 + rand() * 20, cy: 14 + rand() * 18, ph: rand() * 10, sp: 0.35 + rand() * 0.3, col: ['#ffe04a', '#ffffff', '#ff9ac8', '#9ad0ff'][Math.floor(rand() * 4)] }));
  const clouds = Array.from({ length: 5 }, () => {
    const r = 90 + Math.floor(rand() * 80), img = mk(r * 3, r * 2), g = img.getContext('2d');
    ellipse(g, r, r, r, Math.round(r * 0.45), '#0a1a30');
    ellipse(g, Math.round(r * 1.5), r - 8, Math.round(r * 0.6), Math.round(r * 0.3), '#0a1a30');
    return { x: rand() * 2400, y: rand() * 1600, r, img };
  });
  let cloudDrift = 0;

  return {
    water(ctx, cam, t) {
      for (let i = 0; i < 14; i++) {
        if (Math.sin(t * 2.2 + i * 1.7) < 0.55) continue;
        const a = i * 2.39996, r = Math.sqrt((i + 0.5) / 14) * 0.85;
        const [wx, wy] = toScreen(POND.x + Math.cos(a) * POND.rx * r, POND.y + Math.sin(a) * POND.ry * r);
        ctx.fillStyle = '#d8f0ff';
        ctx.fillRect(wx - cam.x, wy - cam.y, 4, 1);
        ctx.fillRect(wx - cam.x + 1, wy - cam.y - 1, 2, 1);
      }
    },
    smoke(ctx, x0, y0, t) {
      for (let i = 0; i < 8; i++) {
        const q = (t * 0.18 + i / 8) % 1;
        ctx.globalAlpha = 0.6 * Math.sin(q * Math.PI);
        blob(ctx, Math.round(x0 + q * 26 + Math.sin(q * 7 + i) * 3), Math.round(y0 - q * 44), 2 + Math.round(q * 5), '#ecebf0');
      }
      ctx.globalAlpha = 1;
    },
    butterflies(ctx, cam, t) {
      for (const b of butterflies) {
        const q = t * b.sp + b.ph;
        const [bx, by] = toScreen(b.cx + Math.sin(q) * 2.5, b.cy + Math.cos(q * 0.8) * 2.5, 14 + Math.sin(q * 3) * 4);
        const x = Math.round(bx - cam.x), y = Math.round(by - cam.y), open = Math.sin(t * 18 + b.ph) > 0;
        ctx.fillStyle = b.col;
        ctx.fillRect(x - (open ? 3 : 1), y - 1, open ? 2 : 1, 2);
        ctx.fillRect(x + 1, y - 1, open ? 2 : 1, 2);
        ctx.fillStyle = '#2a1c22';
        ctx.fillRect(x, y - 1, 1, 2);
      }
    },
    // Sombras de nubes: se repiten en un mosaico grande alrededor de la cámara, así sirven en un mundo infinito
    clouds(ctx, cam, view) {
      cloudDrift += 0.25;
      const SPAN_X = 2400, SPAN_Y = 1600;
      ctx.globalAlpha = 0.07;
      for (const c of clouds) {
        const x = ((((c.x + cloudDrift - cam.x) % SPAN_X) + SPAN_X) % SPAN_X) - c.r * 1.5;
        const y = ((((c.y - cam.y) % SPAN_Y) + SPAN_Y) % SPAN_Y) - c.r;
        if (x < view.w && y < view.h && x + c.img.width > 0 && y + c.img.height > 0) ctx.drawImage(c.img, Math.round(x), Math.round(y));
      }
      ctx.globalAlpha = 1;
    },
    // n llamas de 2 px, centradas en x0 (el hogar usa menos, para que quepan en su boca)
    fire(ctx, x0, y0, t, n = 8) {
      for (let k = 0; k < n; k++) {
        const h = 5 + Math.round((Math.sin(t * 14 + k * 1.9) + Math.sin(t * 23 + k)) * 2 + 4), x = x0 - n + k * 2;
        ctx.fillStyle = '#ff6a20'; ctx.fillRect(x, y0 - 4 - h, 2, h);
        ctx.fillStyle = '#ffc040'; ctx.fillRect(x, y0 - 4 - Math.round(h * 0.6), 2, Math.round(h * 0.6));
        if (k > n * 0.3 && k < n * 0.7) { ctx.fillStyle = '#fff2b0'; ctx.fillRect(x, y0 - 4 - Math.round(h * 0.3), 2, Math.round(h * 0.3)); }
      }
    },
  };
}

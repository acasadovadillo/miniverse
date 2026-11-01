// Núcleo del juego: estado, bucle de paso fijo e interacciones. El dibujo es en 3D (src/three/engine.js).
import { Player } from './entities.js';
import { View3D } from './three/engine.js';
import { camToSave, camFromSave } from './camera.js';
import { Overworld, NILO_LOOK } from './world/scenes.js';
import { houseBlueprint, byChunk, doorTile } from './world/blueprints.js';
import { HOUSE, HOUSE_BIG, HOUSES, CENTER, SPAWN, inBounds, inOwnHouse, hasProject } from './world/village.js';
import { PIECES, parsePlaced } from './pieces.js';
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
  constructor(canvas) {
    this.canvas = canvas;
    this.view3d = new View3D(canvas);
    this.mode = 'menu';          // menu | play | pause | map | inventory | craft | chest | …
    this.busy = false;           // hay una escena en marcha (diálogo, puerta…)
    this.player = null;
    this.world = null;
    this.menuWorld = new Overworld(WORLD_SEED, defaultHouseDeltas());
    this.underRoof = false;      // el jugador está bajo un tejado del mundo (en una casa)
    this.scene = null;
    this.onSave = null;
    this.time = 0;
    this.frameNo = 0;
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
  }

  resize() { this.view3d.resize(); }

  // ---------- sistemas ----------
  // Cada sistema puede tener: reset(save), save(out), update(dt), interact(player, scene), objects(scene),
  // entities(scene), hint(), onDay(day)…
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
    this.world = new Overworld(WORLD_SEED, deltas);
    if (moved) for (const k of deltas.keys()) this.world.dirty.add(k);   // que se guarde ya así
    this.world.clock = save.clock || 0;
    this.inv = new Inventory(save.inventory);
    if (!save.inventory) for (const [id, n] of START_KIT) this.inv.add(id, n);   // partidas sin mochila: equipo inicial
    this.inv.onChange = () => { this.craft.check(); this.onInventory?.(); };
    this.craft.reset(save);
    this.onInventory?.();
    this.setEnergy(save.energy ?? ENERGY_MAX);
    this.setAdmin(!!save.admin);
    camFromSave(save.cam3d);
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
    this.view3d.snap();
  }
  snapshot() {
    if (!this.player) return null;
    const player = this.player.toSave();
    if (this.scene?.kind === 'grid') Object.assign(player, { inside: false, x: this.scene.exitTo.x, y: this.scene.exitTo.y });   // en una cueva se guarda la entrada
    const out = {
      seed: this.world.seed, player, explored: [...this.explored],
      inventory: this.inv.toSave(), energy: Math.round(this.energy), clock: Math.round(this.world.clock),
      ...this.craft.toSave(), house: { big: this.house.big, built: true, v: 3 }, money: this.money,
      admin: this.admin, cam3d: camToSave(),
    };
    this.hook('save', out);
    return out;
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
    this.view3d.snap();
    await hud.fade(false);
    this.busy = false;
  }
  // Casilla bajo un punto de la pantalla (ratón o dedo): el rayo desde la cámara hasta el suelo
  tileAtScreen(clientX, clientY) { return this.scene ? this.view3d.tileAt(clientX, clientY) : null; }

  // ---------- bucle ----------
  run() {
    let last = performance.now(), acc = 0;
    const frame = now => {
      acc += Math.min(0.25, (now - last) / 1000);
      last = now;
      while (acc >= STEP) { this.update(STEP); acc -= STEP; }
      // (un fallo al dibujar no para el juego: se avisa y se sigue)
      try { this.render(); } catch (e) { if (this.renderError !== e.message) console.error(e); this.renderError = e.message; }
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
    this.frameNo++;
    this.view3d.render(this);
    hud.prompt(this.nearest()?.text);
    let hint = '';
    if (this.player) {
      for (const s of this.systems) { hint = s.hint?.() || ''; if (hint) break; }
      hint ||= this.build.on ? this.build.hint() : this.gather.hint();
    }
    hud.hint(hint);
    if (this.player && this.world) {
      this.map.markers = this.places.markers();
      if (this.mode === 'map') this.map.drawBig(this.world.gen, this.explored, this.player.x, this.player.y, this.time);
      else if (!this.indoors) this.map.drawMini(this.world.gen, this.explored, this.player.x, this.player.y, this.time);
    }
  }
}

// ¿Está este punto bajo un tejado? En la casilla de un muro o de una puerta solo cuenta el lado de dentro
// (el que tiene suelo): delante de una puerta cerrada se está fuera, aunque el tejado llegue hasta ahí
function underRoof(scene, x, y) {
  const tx = Math.floor(x), ty = Math.floor(y);
  if (!scene.roofAt(tx, ty)) return false;
  const c = scene.floorClip?.(tx, ty), u = x - tx - 0.5, v = y - ty - 0.5;
  return !c || (u >= c[0] && u <= c[1] && v >= c[2] && v <= c[3]);
}

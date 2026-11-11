// Núcleo del juego: estado, bucle de paso fijo e interacciones. El dibujo es en 3D (src/three/engine.js).
import { Player } from './entities.js';
import { View3D } from './three/engine.js';
import { prewarmIcons } from './three/icons.js';
import { itemIcon } from './art/items.js';
import { camToSave, camFromSave, CAM } from './camera.js';
import { wrapX, wrapIndex, HALF, NORTH, SOUTH } from './world/planet.js';
import { Overworld, NILO_LOOK } from './world/scenes.js';
import { houseBlueprint, familyBlueprint, byChunk, doorTile, houseSize } from './world/blueprints.js';
import { HOUSE, HOUSE_BIG, HOUSE_FAMILY, HOUSES, CENTER, SPAWN, inBounds, inOwnHouse, inTavern, hasProject, setFamilyHouse } from './world/village.js';
import { PIECES, parsePlaced } from './pieces.js';
import { BUILDABLE } from './buildables.js';
import { Profile } from './accounts.js';
import { BIOMES } from './world/biomes.js';
import { CHUNK, WORLD_SEED } from './world/gen.js';
import { MapView } from './ui/map.js';
import { Inventory } from './inventory.js';
import { Gathering } from './gather.js';
import { Crafting } from './crafting.js';
import { STATIONS } from './recipes.js';
import { START_KIT, ITEMS, RUG_MADE, rugId, CHESTS } from './items.js';
import { clothesFor, dressed } from './looks.js';
import { WorldStore } from './worldstore.js';
import { BuildMode } from './build.js';
import { TimeSystem } from './time.js';
import { Farm } from './farm.js';
import { Ranch } from './ranch.js';
import { Steps } from './steps.js';
import { Fishing } from './fishing.js';
import { Wildlife } from './wildlife.js';
import { Rest } from './rest.js';
import { Crew } from './crew.js';
import { footTile, front, extraTiles, yawOf } from './art/stations.js';
import { solidsOf, hull, placeBoxes, aabb, distTo, rayHits } from './world/fit.js';
import { HOTBAR, extraOf } from './inventory.js';
import { Neighbors } from './neighbors.js';
import { Board } from './board.js';
import { Combat, DIFFICULTIES, MONSTERS, EFFECT_NAMES } from './combat.js';
import { Hunt, bodyBox } from './hunt.js';
import { Archery } from './archery.js';
import { ANIMALS } from './art/farm.js';
import { syncLook, aimLock } from './input.js';
import { xpTo } from './xp.js';
import { Mobs } from './mobs.js';
import { Experience } from './xp.js';
import { Machines, MACHINES, machineAt, machineEmpty } from './machines.js';
import { Trades } from './trades.js';
import { Maps } from './maps.js';
import { Explore } from './explore.js';
import { Stats, Skills, Collection, Achievements, Story } from './progress.js';
import { Music } from './music.js';
import { Live } from './live.js';
import { Family } from './family.js';
import { Settings } from './settings.js';
import { keys, clearKeys } from './input.js';
import { Audio } from './audio.js';
import { hud } from './ui/hud.js';

// Lo que ya no existe en el juego y lo que costó. Al cargar una partida se quita de donde esté (la mochila, los cofres, las
// alforjas, el correo o puesto en el mundo) y, si no, quedaría un objeto sin datos que rompe la mochila. Devuelve lo que
// hay que devolver: [[id, n]]
// Las herramientas son todas de hierro: las de antes pasan a serlo, con la parte de uso que les quedaba (dur: lo que aguantaban)
const OLD_TOOLS = {};
for (const tool of ['hacha', 'pico', 'guadana', 'azada']) for (const [suffix, dur] of [['', 60], ['_piedra', 130], ['_cobre', 190], ['_oro', 500]]) OLD_TOOLS[tool + suffix] = { id: `${tool}_hierro`, dur };
const RETIRED = { mesa_encantar: [['amatista', 4], ['tablas', 6], ['lingote_hierro', 2]] };
export function retireItems(save, deltas) {
  const owed = [], back = (id, n = 1) => { for (const [m, k] of RETIRED[id]) owed.push([m, k * n]); };
  // (los encantamientos tampoco están ya: lo encantado se queda como cualquier otro; owed.spell: si había alguno)
  const unspell = s => { if (s?.ench) { delete s.ench; owed.spell = true; } };
  const reforge = (s, data = s) => {
    const old = s && OLD_TOOLS[s.id];
    if (!old) return;
    s.id = old.id; owed.iron = true;
    if (data.dur !== undefined) data.dur = Math.max(1, Math.ceil(ITEMS[old.id].dur * data.dur / old.dur));
  };
  const clean = list => { if (Array.isArray(list)) list.forEach((s, i) => { if (s && RETIRED[s.id]) { back(s.id, s.n || 1); list[i] = null; } else { unspell(s); reforge(s); } }); };
  clean(save.inventory?.slots);
  for (const it of Object.values(save.inventory?.equip || {})) unspell(it);
  for (const a of save.animals || []) clean(a.bags);
  if (save.farm?.mail) save.farm.mail = save.farm.mail.filter(m => { if (!RETIRED[m.id]) { unspell(m.extra); reforge(m, m.extra || {}); return true; } back(m.id, m.n || 1); return false; });
  for (const [k, d] of deltas) {
    if (k.startsWith('u:')) continue;
    for (const list of Object.values(d.chest || {})) clean(list);
    for (const [t, raw] of Object.entries(d.placed || {})) {
      const id = parsePlaced(raw)[0];
      if (!RETIRED[id]) continue;
      delete d.placed[t]; if (d.pos) delete d.pos[`placed:${t}`];
      back(id);
    }
  }
  return owed;
}
const STEP = 1 / 60;   // la simulación avanza siempre a 60 pasos por segundo
const NILO_TIPS = [
  'Dicen que el mundo no se acaba nunca más allá del bosque. Yo nunca he llegado tan lejos.',
  'Los peñascos grandes dan de todo: piedra, carbón, cobre, hierro y a veces oro. Pero tu pico se gasta: cuídalo.',
  'Dicen que en las montañas los peñascos esconden más hierro y más oro.',
  'Con un horno conviertes el mineral en lingotes. Y con lingotes de cobre, un yunque para forjar. Si se te rompe una herramienta, ahí te haces otra, o se la compras a Bruno.',
  'En la cocina, una manzana asada quita el doble de hambre que una cruda. Hazme caso.',
  'Si te quedas sin carbón, quema madera en el horno. Así lo hacía mi abuelo.',
  'En la taberna, al oeste del camino, Anselmo te da de comer y te cuenta la vida de todos. Sobre todo lo segundo.',
  'Las palmeras de las playas cálidas dan cocos cada pocos días. No hace falta talarlas: basta con sacudirlas.',
  'Una noria en un río muele el trigo en harina y riega sola el huerto de alrededor. Con harina, el pan sale más barato.',
  'Cava cinco bloques hacia abajo con la pala y, con la mesa de cantero cerca, te haces un pozo: agua para la regadera sin ir al río.',
];

// Deltas con tu casa recién hecha: para el fondo del menú, que no tiene partida
function defaultHouseDeltas() {
  const out = new Map();
  for (const [k, c] of Object.entries(byChunk(houseBlueprint({ x0: HOUSE.x0, y0: HOUSE.y0 }), CHUNK))) out.set(k, { removed: {}, tilled: {}, chest: {}, v: 0, ...c });
  return out;
}

// Los modos de juego (/gamemode) y las reglas del mundo (/gamerule) con lo que valen al empezar
export const GAMEMODES = { survival: 'supervivencia', creative: 'creativo', spectator: 'espectador' };
export const RULES = { keepInventory: false, doMobSpawning: true, doWeatherCycle: true, doDaylightCycle: true, naturalRegeneration: true, announceAdvancements: true };
const TAVERN_SEATS = new Set(['silla', 'taburete']);   // (en la taberna, quien quiere se sienta)
const AIM_REACH = 2;   // lo que se apunta con el ratón se usa si está a esto como mucho (casillas)
const LIGHTS = new Set(['lampara', 'antorcha', 'vela', 'candelabro']);
const BEDS = new Set(['cama', 'cama_nino', 'cama_doble']);   // lo colocado que se apaga y se enciende con E
// Sin dibujo (el mundo del servidor, server.js): lo que el juego le pregunta a la vista en 3D, sin vista
const NO_VIEW = { world: null, actors: { player: null }, snap() {}, resize() {}, render() {}, tileAt: () => null, pointAt: () => null, rayAt: () => null, groundY: () => 0 };

export class Game {
  constructor(canvas, { headless = false } = {}) {
    this.canvas = canvas;
    this.view3d = headless ? NO_VIEW : new View3D(canvas);
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
    this.gather = new Gathering(this);
    this.craft = new Crafting(this);
    this.niloTip = 0;
    this.explored = new Set();   // trozos descubiertos (claves "cx,cy")
    this.lastChunk = null;
    this.placeName = '';
    this.build = new BuildMode(this);
    this.house = { big: false };
    this.admin = false;          // lo del modo creativo: objetos infinitos y construir gratis donde sea
    this.gamemode = 'survival';  // modo de juego (/gamemode): survival, creative o spectator
    this.rules = { ...RULES };   // las reglas del mundo (/gamerule): de todos, como el mundo
    this.worldSpawn = null;      // dónde aparecen los personajes nuevos (/setworldspawn); sin él, en el pueblo
    this.weatherLock = null;     // el tiempo que ha puesto un op (/weather): { w, until } (until null: sin fin)
    this.difficulty = 'normal';  // la dificultad del mundo (/difficulty): peaceful, easy, normal o hard
    this.defaultGamemode = 'survival';   // el modo en que empiezan los personajes nuevos (/defaultgamemode)
    this.worldSaving = true;     // si se guarda el mundo (/save-off en el terminal lo para)
    this.spectating = null;      // a quién sigue el espectador (/spectate)
    this.systems = [];           // capas de juego que se enchufan: tiempo, huerto, vecinos… (ver hook)
    this.stats = this.addSystem(new Stats());
    this.skills = this.addSystem(new Skills(this));
    this.days = this.addSystem(new TimeSystem(this));
    this.archery = this.addSystem(new Archery(this));   // el arco (antes que lo que se haga con E o con la herramienta)
    this.board = this.addSystem(new Board(this));
    this.farm = this.addSystem(new Farm(this));
    this.ranch = this.addSystem(new Ranch(this));
    this.family = this.addSystem(new Family(this));
    this.fishing = this.addSystem(new Fishing(this));
    this.wildlife = this.addSystem(new Wildlife(this));
    this.rest = this.addSystem(new Rest(this));
    this.crew = this.addSystem(new Crew(this));   // ir de pasajero en la barca de otro
    this.neighbors = this.addSystem(new Neighbors(this));
    this.hunt = this.addSystem(new Hunt(this));   // pegar a los animales (antes que a las criaturas: va a lo que se apunta)
    this.combat = this.addSystem(new Combat(this));
    this.mobs =this.addSystem(new Mobs(this));   // la luz y las criaturas de fuera, de noche
    this.xp = this.addSystem(new Experience(this));   // la experiencia y los niveles
    this.machines = new Machines(this);   // el horno y el alambique, que llevan su tiempo
    this.trades = new Trades(this);       // los tratos con los vecinos
    this.maps = this.addSystem(new Maps(this));   // los mapas (objetos) y la brújula
    this.places = this.addSystem(new Explore(this));
    this.collection = this.addSystem(new Collection(this));
    this.achievements = this.addSystem(new Achievements(this));
    this.story = this.addSystem(new Story(this));
    this.steps = this.addSystem(new Steps(this));   // los primeros pasos
    this.live = this.addSystem(new Live(this));   // jugar juntos en directo
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
    const owed = retireItems(save, deltas);
    // Solo hay un mundo. Una partida de antes, de otro mundo, pasa a este: lo construido se queda donde
    // estaba, pero se olvida lo que dependía de la naturaleza de aquel (lo talado, recogido y saqueado),
    // el mapa explorado y los lugares descubiertos
    const moved = save.seed !== undefined && save.seed !== WORLD_SEED;
    if (moved) {
      for (const [k, d] of deltas) if (!k.startsWith('u:')) Object.assign(d, { removed: {}, picked: {}, opened: {} });
      save = { ...save, explored: [], found: [] };
    }
    setFamilyHouse(save.house?.family);   // (antes de hacer el pueblo: con la casa familiar, su jardín cambia)
    this.world = new Overworld(WORLD_SEED, deltas);
    this.world.onTouch = k => this.live.touched(k);
    if (moved) for (const k of deltas.keys()) this.world.dirty.add(k);   // que se guarde ya así
    this.world.clock = save.clock || 0;
    this.inv = new Inventory(save.inventory);
    if (!save.inventory) for (const [id, n] of START_KIT) this.inv.add(id, n);   // partida nueva: equipo inicial
    this.invSpill = this.inv.spill;   // (materiales de muebles de antes que no han cabido: se dejan a los pies al empezar)
    // (las partidas de antes de la pala la reciben una vez: la marca pala va en lo guardado; si no cabe, a los pies)
    const shovel = !!save.inventory && !save.pala;
    if (shovel && this.inv.add('pala_hierro', 1)) this.invSpill.push(['pala_hierro', 1]);
    // La ropa: la partida nueva empieza con la que se eligió al crear el personaje, sin mochila; las de antes
    // de que hubiera ropa, con la suya y una mochila (así no pierden nada de lo que llevaban)
    if (!save.inventory?.equip) this.inv.equip = clothesFor(save.player.look, !!save.inventory);
    else if ((save.inventory.wardrobe || 1) < 2) this.inv.equip.calcetines ??= clothesFor(save.player.look).calcetines;   // los calcetines llegaron después
    this.inv.onChange = () => { this.craft.check(); this.onInventory?.(); };
    this.craft.reset(save);
    this.onInventory?.();
    this.rules = { ...RULES, ...(save.rules || {}) };
    this.worldSpawn = save.worldSpawn || null;
    this.weatherLock = save.weatherLock || null;
    this.difficulty = DIFFICULTIES[save.difficulty] ? save.difficulty : 'normal';
    this.defaultGamemode = GAMEMODES[save.defaultGamemode] ? save.defaultGamemode : 'survival';
    this.spectating = null;
    this.lastInput = this.time;
    this.setGamemode(save.gamemode || (save.admin ? 'creative' : save.inventory ? 'survival' : this.defaultGamemode));   // (las de antes: el modo admin era el creativo; los nuevos, el del mundo)
    camFromSave(save.cam3d);
    this.money = save.money ?? 100;
    this.addMoney(0);
    this.gather.reset();
    const p = { ...save.player };
    this.house = { big: !!save.house?.big, family: !!save.house?.family, built: !!save.house?.built, v: save.house?.v ?? 1 };
    // Tu casa es parte del mundo. Si la partida aún no la tiene (es nueva, o de cuando la casa era una
    // habitación aparte), se levanta ahora; los muebles de aquella habitación pasan dentro.
    if (p.inside) { const [hx, hy] = this.homeSpot(); Object.assign(p, { inside: false, x: hx, y: hy, view: 'front', dir: null }); }
    const [sx, sy] = this.worldSpawn || [SPAWN.x, SPAWN.y];   // (un personaje nuevo, donde diga el mundo)
    this.player = new Player({ ...p, x: save.inventory ? p.x ?? sx : sx, y: save.inventory ? p.y ?? sy : sy });
    this.player.ghost = this.gamemode === 'spectator';
    this.player.onExert = n => this.combat.exert(n);   // (correr y saltar dan hambre)
    this.player.onLand = () => this.farm.trample(this.player);   // (caer de un salto sobre tierra labrada la deshace)
    hud.faces = { ...hud.faces, Nilo: NILO_LOOK, [this.player.name]: this.player.look };
    this.scene = this.world;
    this.underRoof = false;
    if (owed.length && !Profile.server) { for (const [id, n] of owed) this.giveBack(id, n); hud.toast('La mesa de encantar ya no está en el juego: te devuelvo sus materiales', 'good'); }
    if (owed.iron && !Profile.server) hud.toast('Ahora todas las herramientas son de hierro: también las tuyas, con el desgaste que llevaban', 'good');
    if (owed.spell && !Profile.server) hud.toast('Los encantamientos ya no están en el juego: tus cosas siguen, pero sin ellos');
    if (shovel && !Profile.server) hud.toast('Nilo te ha dejado una pala: cava un bloque de tierra con ella y suéltalo donde quieras', 'good');
    // Lo que el jugador tenía en su habitación va primero (dentro de la casa); luego se levanta la casa con
    // sus muebles por defecto, que solo ocupan las casillas que quedan libres. Va después de crear al jugador,
    // porque lo que no quepa vuelve a la mochila a través de él.
    if (!this.house.built) { this.migrateRoom(save.house); this.layHouse(this.houseSize, true); this.house.built = true; this.house.v = 4; }
    // Partidas de cuando las casas medían la mitad: la casa crece hacia atrás y a los lados (la puerta se queda)
    if (this.house.v < 2) { this.layHouse(this.houseSize, false); this.makeRoomForBeds(); this.house.v = 2; }
    // Al crecer, la cama y el hogar se quedaron en medio de la sala: a su sitio, contra la pared
    if (this.house.v < 3) { this.tidyHouse(); this.house.v = 3; }
    // Las casas tenían un candelabro por su cuenta, que salía también al poner tejados: ya no. En la tuya se cuelga uno de
    // verdad (se apaga, se quita y se mueve como cualquier otro), donde va en las casas nuevas
    if (this.house.v < 4) { this.hangHouseLamp(); this.house.v = 4; }
    this.explored = new Set(save.explored || []);
    // (los iconos de lo que se lleva y de la comida, en ratos libres: ver icons.js)
    if (this.view3d !== NO_VIEW) prewarmIcons(() => this.inv.slots.filter(Boolean).map(s => s.id), itemIcon);
    this.lastChunk = null;
    this.placeName = '';
    Audio.indoors = this.indoors;
    clearKeys();
    this.mode = 'play';
    for (const [id, n] of this.invSpill || []) this.gather.throwOut(id, n);
    this.invSpill = null;
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
      inventory: this.inv.toSave(), clock: Math.round(this.world.clock),
      ...this.craft.toSave(), house: { big: this.house.big, family: this.house.family, built: true, v: this.house.v }, money: this.money,
      pala: 1, gamemode: this.gamemode, rules: this.rules, worldSpawn: this.worldSpawn, weatherLock: this.weatherLock, difficulty: this.difficulty, defaultGamemode: this.defaultGamemode, cam3d: camToSave(), volumes: Settings.volumes(),
    };
    this.hook('save', out);
    return out;
  }
  // Modo de juego, como en Minecraft: en supervivencia se gasta lo que se usa y hacen daño; en creativo, lo que se
  // usa no se gasta, en la mochila están todos los objetos, construir es gratis y no hacen daño; el espectador
  // atraviesa todo, no toca nada y los demás no lo ven (solo los otros espectadores)
  setGamemode(gm) {
    this.gamemode = GAMEMODES[gm] ? gm : 'survival';
    this.setAdmin(this.gamemode === 'creative');
    if (this.player) this.player.ghost = this.gamemode === 'spectator';
    document.body.classList.toggle('spectator', this.gamemode === 'spectator');
    document.body.classList.toggle('survival', this.gamemode === 'survival');   // (con la vida y el hambre a la vista)
    this.combat?.paint();
    document.getElementById('admin-tag').textContent = this.gamemode === 'spectator' ? 'ESPECTADOR' : 'CREATIVO';
    if (this.gamemode === 'spectator') { this.build.toggle(false); if (this.player?.pose) this.rest.stand(); }
  }
  // Lo que pide un op con un comando a este jugador (desde su juego o desde otro): llevarte a un sitio, darte
  // algo, matarte, ponerte dónde reaparecer o cambiarte el modo de juego. by: quién lo pide (null: tú)
  fromOp(m, by = null) {
    const said = text => { if (by) hud.toast(`${by} ${text}`); };
    if (m.t === 'tp') { if (m.home ? this.teleportHome() : this.teleport(m.x, m.y)) said(`te ha teletransportado${m.home ? ' a casa' : ''}`); }
    else if (m.t === 'give' && ITEMS[m.id]) {
      const n = Math.max(1, Math.min(9999, m.n | 0)), left = this.inv.add(m.id, n);
      if (left) this.gather.throwOut(m.id, left);
      said(`te ha dado ${n} × ${ITEMS[m.id].name.toLowerCase()}`);
    } else if (m.t === 'kill') this.combat.die(by ? `${by} te ha matado (/kill)` : 'Has muerto (/kill)');
    else if (m.t === 'spawn' && Number.isFinite(m.x) && Number.isFinite(m.y)) { this.player.spawn = [m.x, m.y]; said('te ha puesto aquí dónde reapareces'); }
    else if (m.t === 'gamemode' && GAMEMODES[m.gm]) { this.setGamemode(m.gm); said(`te ha puesto en modo ${GAMEMODES[m.gm]}`); }
    else return this.fromOp2(m, said);
    this.onSave?.();
  }
  // (las órdenes de los comandos de la fase de comandos: /clear, /effect, /xp, /recipe, /achievement y
  // /title). Devuelven lo que ha pasado, para quien lo pide desde su juego
  fromOp2(m, said) {
    const inv = this.inv, p = this.player;
    let out = '';
    if (m.t === 'clear') {
      let n = 0;
      inv.slots.forEach((s, i) => {
        if (!s || (m.id && s.id !== m.id)) return;
        const k = m.n ? Math.min(s.n, m.n - n) : s.n;
        if (k <= 0) return;
        inv.take(i, k, true); n += k;
      });
      if (!m.id) for (const [slot, it] of Object.entries(inv.equip)) if (ITEMS[it.id]?.armor) { delete inv.equip[slot]; n++; }
      inv.changed();
      out = `Fuera de tu mochila: ${n} ${m.id ? `× ${ITEMS[m.id].name.toLowerCase()}` : 'cosas'}`;
      said(`ha vaciado tu mochila (${n})`);
    } else if (m.t === 'effect') {
      if (m.give === 'curacion') { this.combat.heal(8); out = 'Te has curado 4 corazones'; }
      else if (m.give && EFFECT_NAMES[m.give]) { this.buffs[m.give] = this.time + Math.max(1, Math.min(3600, m.secs || 30)); out = `Efecto ${EFFECT_NAMES[m.give]} durante ${m.secs || 30} s`; }
      else if (m.clear) { if (m.clear === 'all') this.buffs = {}; else delete this.buffs[m.clear]; out = 'Efectos quitados'; }
      if (out) said(`te ha dado: ${out.toLowerCase()}`);
    } else if (m.t === 'xp' && Number.isFinite(m.n)) {
      const x = this.xp;
      if (m.levels) x.set(xpTo(Math.max(0, (m.set ? 0 : x.level) + m.n)) + (m.set ? 0 : x.into));
      else if (m.set) x.set(m.n); else if (m.n > 0) x.add(m.n); else x.set(x.points + m.n);
      out = `Tienes nivel ${x.level} de experiencia (${x.points} puntos)`;
      said(`te ha cambiado la experiencia: nivel ${x.level}`);
    } else if (m.t === 'recipe') {
      const n = m.give ? this.craft.grant(m.id) : this.craft.revoke(m.id);
      out = `${m.give ? 'Recetas nuevas' : 'Recetas olvidadas'}: ${n}`;
      said(`te ha ${m.give ? 'enseñado' : 'quitado'} recetas (${n})`);
    } else if (m.t === 'achievement') {
      const n = m.grant ? this.achievements.grant(m.id) : this.achievements.revoke(m.id);
      out = `${m.grant ? 'Logros dados' : 'Logros quitados'}: ${n}`;
      said(`te ha ${m.grant ? 'dado' : 'quitado'} logros (${n})`);
    } else if (m.t === 'title' && m.text) { hud.title(String(m.text).slice(0, 80)); return null; }
    else return null;
    this.onSave?.();
    return out;
  }
  // Lo que se le pide a quien lleva el mundo (/summon de criaturas y animales de granja, /kill @e). Devuelve lo que
  // ha pasado
  fromHost(m) {
    if (m.t === 'summon' && Number.isFinite(m.x) && Number.isFinite(m.y)) {
      if (m.kind === 'mob' && MONSTERS[m.type]) { this.mobs.summon(m.type, m.x, m.y); return `Ha aparecido: ${MONSTERS[m.type].name.toLowerCase()}.`; }
      if (m.kind === 'wild') { this.wildlife.summon(m.type, m.x, m.y); return `Ha aparecido: ${ANIMALS[m.type]?.name.toLowerCase() || m.type}.`; }
      if (m.kind === 'farm') { const a = this.ranch.summon(m.type, m.x, m.y); return a ? `Ha aparecido: ${a.name}.` : null; }
    }
    if (m.t === 'killmobs' && Number.isFinite(m.x)) return `Criaturas quitadas: ${this.mobs.clearNear(m.x, m.y, 48)}.`;
    return null;
  }
  // Dónde se reaparece al morir: en tu cama (si sigue ahí), en tu punto (/spawnpoint) o, si no tienes, en casa
  respawnSpot() {
    const s = this.player?.spawn;
    if (s?.length === 4) {
      const v = this.world.ownAt('placed', s[2], s[3]), id = v && parsePlaced(v)[0];
      if (!BEDS.has(id)) { this.player.spawn = null; hud.toast('Tu cama ya no está: apareces en casa'); return this.homeSpot(); }
    }
    return s ? [s[0], s[1]] : this.homeSpot();
  }
  bedSpawn(o) {
    const p = this.player, [tx, ty] = o.tile, s = p.spawn;
    if (s?.length === 4 && s[2] === tx && s[3] === ty) return;
    p.spawn = [Math.round(p.x * 100) / 100, Math.round(p.y * 100) / 100, tx, ty];
    hud.toast('Punto de reaparición: tu cama');
  }
  // Un nombre fijo para cada escena (el mundo, o tal nivel de tal cueva), que no cambia aunque se rehaga
  sceneKey(sc) { return !sc || sc === this.world ? 'world' : `g:${sc.id ?? `${sc.caveId}:${sc.depth}`}`; }
  // Lo que se usa no se gasta, en la mochila están todos los objetos y construir es gratis (y se puede construir
  // también sobre el terreno del pueblo): el modo creativo
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

  // Marca como explorados los trozos alrededor del jugador
  explore() {
    const p = this.player, cx = Math.floor(p.x / CHUNK), cy = Math.floor(p.y / CHUNK), key = `${cx},${cy}`;
    if (key === this.lastChunk) return;
    this.lastChunk = key;
    for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) this.explored.add(`${wrapIndex(cx + dx, CHUNK)},${cy + dy}`);
  }
  // Dar la vuelta al planeta (planet.js): al pasar la costura, las coordenadas siguen por el otro lado y la vista se
  // rehace; al cruzar un polo se sale por el otro lado del planeta (180° más allá), andando hacia el sur (la cámara
  // da media vuelta, así que en la pantalla se sigue hacia el mismo lado)
  aroundPlanet() {
    const p = this.player;
    if (p.x >= HALF || p.x < -HALF) { p.x = wrapX(p.x); this.view3d.snap(); }
    if (p.y >= NORTH && p.y < SOUTH) return;
    const north = p.y < NORTH;
    p.y = north ? 2 * NORTH - p.y : 2 * SOUTH - p.y - 0.01;
    p.x = wrapX(p.x + HALF);
    if (p.face) p.face = { x: -p.face.x, y: -p.face.y };
    CAM.yaw += Math.PI;
    this.view3d.snap();
    hud.toast(`Has cruzado el polo ${north ? 'norte' : 'sur'}: sigues por el otro lado del planeta`);
  }
  // El espectador que sigue a alguien (/spectate) va donde va él (si deja de estar, o deja de ser espectador, se acaba)
  followSpectated() {
    const peer = this.live.others.find(x => x.id === this.spectating && x.playing), e = peer?.entity;
    if (this.gamemode !== 'spectator' || !peer) { this.spectating = null; return; }
    if (e && peer.sc === 'world') { this.player.x = e.x; this.player.y = e.y; }
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
    this.live.left();
    this.player = null;
    this.scene = null;
    this.mode = 'menu';
    this.busy = false;
    hud.closeDialog();
    hud.prompt(null);
  }

  // ---------- interacción ----------
  // Lo que se puede hacer con E aquí (text, run) y, a veces, algo más con X (alt: recoger un mueble)
  nearest() {
    const p = this.player;
    if (this.busy || this.mode !== 'play' || !p || this.gamemode === 'spectator') return null;   // (el espectador no toca nada)
    const sc = this.scene;
    if (p.pose) return { text: 'Levantarse', run: () => this.rest.stand() };
    if (p.aboard) return this.crew.action();
    if (p.boat) return this.crew.ownAction();   // (remando: E baja a tierra y amarra la barca)
    // Con ratón, solo lo que se apunta con el cursor (a AIM_REACH casillas como mucho)
    if (this.mouse) { const aim = this.aimed(); return aim ? this.actionFor(aim) : null; }
    // Sin ratón (en pantalla táctil, sin cursor): lo que haya más cerca
    for (const s of this.systems) { const r = s.interact?.(p, sc); if (r) return r; }
    const door = sc.doorNear?.(p.x, p.y), da = door && this.doorAction(door);
    if (da) return da;
    // Lo colocado, lo más cercano primero (la alfombra, al final: lo de encima, las puertas y las ventanas antes).
    // (lo fijo de las casas de los vecinos no se toca)
    const dist = o => (sc.placedDist ? sc.placedDist(o, p.x, p.y) : Math.hypot(o.x - p.x, o.y - p.y));
    const near = (sc.placedNear?.(p.x, p.y, 1.3) || []).filter(o => (!o.fixed || STATIONS[o.placed]) && (!sc.reaches || sc.reaches(p.x, p.y, o.x, o.y))).sort((a, b) => dist(a) - dist(b));
    const o = near.find(o => o.layer !== 'rug');
    if (o) return this.placedAction(o, true);
    const hearth = sc.hearthNear?.(p.x, p.y);
    if (hearth) return this.hearthAction(hearth);
    const win = sc.windowNear?.(p.x, p.y);
    if (win) return this.windowAction(win);
    const rug = near.find(o => o.layer === 'rug');
    return rug ? this.rugAction(rug) : null;
  }
  // Lo que se apunta con el ratón (a AIM_REACH casillas como mucho y, si está suelto, a la vista): lo primero que
  // corta el rayo, { kind, …, t }; o null (sin ratón sobre el juego, o sin apuntar a nada que se use)
  aimed() {
    const p = this.player, sc = this.scene, m = this.mouse;
    if (!m?.in || !sc || !p) return null;
    if (m.aimFrame === this.frameNo) return m.aim;
    m.aimFrame = this.frameNo; m.aim = null;
    const ray = this.view3d.rayAt(m.x, m.y);
    if (!ray) return null;
    for (const c of this.aimTargets(p, sc)) {
      if (distTo(c.box, p.x, p.y) > AIM_REACH) continue;
      const g = this.view3d.groundY(sc, c.box.x, c.box.y), t = rayHits(ray.o, ray.d, { ...c.box, y0: c.box.y0 + g, y1: c.box.y1 + g });
      if (t !== null && (!m.aim || t < m.aim.t)) m.aim = { ...c, t };
    }
    return m.aim;
  }
  // Lo que se puede apuntar alrededor del jugador, cada cosa con su caja (girada, con alturas)
  aimTargets(p, sc) {
    const out = [], R = AIM_REACH + 1, box = (x, y, hx, hy, y0, y1) => ({ ...aabb(x - hx, y - hy, x + hx, y + hy), y0, y1 });
    const sees = (x, y) => !sc.reaches || sc.reaches(p.x, p.y, x, y);
    // Lo colocado, a su tamaño y altura (las alfombras, a ras de suelo; los cuadros cuelgan del muro: no se miran a la vista)
    for (const o of sc.placedNear?.(p.x, p.y, R) || []) {
      if ((o.fixed && !STATIONS[o.placed] && !(TAVERN_SEATS.has(o.placed) && inTavern(o.x, o.y))) || (o.layer !== 'hang' && !sees(o.x, o.y))) continue;
      // (en el establo abierto se entra: sus paredes, por separado, y el tejado desde fuera)
      if (o.placed === 'establo' && o.model !== 'establo:shut') {
        const yaw = o.yaw ?? yawOf(o.rot), walls = solidsOf('establo').filter(s => s[1] < 1), roof = this.ranch.houseAround(p) === o ? [] : [[-2, 1.95, -1.5, 2, 3, 1.5]];
        for (const s of placeBoxes([...walls, ...roof], o.x, o.y, yaw)) out.push({ kind: 'placed', o, yaw, box: s });
        continue;
      }
      if (o.layer === 'rug') { out.push({ kind: 'placed', o, box: { ...(o.obb || aabb(o.fx[0], o.fy[0], o.fx[1], o.fy[1])), y0: 0, y1: 0.06 } }); continue; }
      let h = hull(solidsOf(o.model || o.placed));
      if (!isFinite(h[0])) h = [-0.45, 0, -0.45, 0.45, 0.1, 0.45];
      out.push({ kind: 'placed', o, yaw: o.yaw ?? yawOf(o.rot), box: placeBoxes([h], o.x, o.y, o.yaw ?? yawOf(o.rot))[0] });
    }
    // Las puertas, las ventanas y el hogar (piezas de construcción)
    const cx = Math.floor(p.x / CHUNK), cy = Math.floor(p.y / CHUNK);
    if (sc.contentFor) for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) for (const o of sc.contentFor(cx + dx, cy + dy).objects) {
      if (!o.tile || Math.abs(o.x - p.x) > R || Math.abs(o.y - p.y) > R) continue;
      const [tx, ty] = o.tile, alongX = o.door ? o.door === 'x' : (o.mask & 3) || !(o.mask & 12);
      if (o.door) { const y1 = o.gate ? 1 : 2.05, w = o.gate ? 0.5 : 0.46; out.push({ kind: 'door', tile: o.tile, box: alongX ? box(tx + 0.5, ty + 0.5, w, 0.12, 0, y1) : box(tx + 0.5, ty + 0.5, 0.12, w, 0, y1) }); }
      else if (o.window) out.push({ kind: 'window', tile: o.tile, box: alongX ? box(tx + 0.5, ty + 0.5, 0.45, 0.2, 0.9, 2.1) : box(tx + 0.5, ty + 0.5, 0.2, 0.45, 0.9, 2.1) });
      else if (o.hearth) out.push({ kind: 'hearth', tile: o.tile, box: box(o.x, o.y, 0.5, 0.5, 0, 1.4) });
      else if (o.fence && (!o.fixed || o.yard)) {   // (solo apuntándola: si no, cada valla cercana taparía lo demás)
        const m = o.mask || 0, x0 = m & 2 ? -0.5 : -0.1, x1 = m & 1 ? 0.5 : 0.1, y0 = m & 8 ? -0.5 : -0.1, y1 = m & 4 ? 0.5 : 0.1;   // (el poste y sus tramos, hacia las de al lado)
        out.push({ kind: 'fence', o, box: box(o.x + (x0 + x1) / 2, o.y + (y0 + y1) / 2, (x1 - x0) / 2, (y1 - y0) / 2, 0, 0.9) });
      }
    }
    // Lo de cada sistema: el tablón, las cuevas y los templos, los árboles con fruta, la barca de otro…
    for (const s of this.systems) { const more = s.aimables?.(p, sc, box); if (more) out.push(...more); }
    // En primera persona, también las criaturas: se les pega a las que están en la cruceta
    if (CAM.first) for (const m of this.combat.monsters || []) if (sees(m.x, m.y)) { const fly = MONSTERS[m.type].fly, tall = m.type === 'esqueleto' ? 1.4 : 0.7; out.push({ kind: 'monster', e: m, box: box(m.x, m.y, 0.4, 0.4, fly ? 0.9 : 0, fly ? 1.7 : tall) }); }
    if (sc !== this.world) return out;
    // La gente, los animales y lo que se puede cosechar
    const who = (kind, e, r, y1, more) => out.push({ kind, e, ...more, box: box(e.x, e.y, r, r, 0, y1) });
    if (sees(this.world.nilo.x, this.world.nilo.y)) who('npc', this.world.nilo, 0.35, 1.5, { n: null });
    for (const n of this.neighbors.people) if (!n.hidden && sees(n.x, n.y)) who('npc', n, 0.35, 1.5, { n });
    for (const [id, e] of this.family.ents) if (sees(e.x, e.y)) who('kid', e, e.lying ? 0.45 : 0.3, e.lying ? (e.h || 0) + 0.5 : 1.1, { id });
    for (const a of this.ranch.animals) if ((!a.inside || this.ranch.stall(a)) && !a.rider && sees(a.x, a.y)) out.push({ kind: 'animal', e: a, box: bodyBox(a) });
    for (const w of this.wildlife.list) if (sees(w.x, w.y)) out.push({ kind: 'wild', e: w, box: bodyBox(w) });
    for (let ty = Math.floor(p.y) - 2; ty <= Math.floor(p.y) + 2; ty++) for (let tx = Math.floor(p.x) - 2; tx <= Math.floor(p.x) + 2; tx++) {
      if (this.farm.ready(this.farm.cropAt(tx, ty))) out.push({ kind: 'crop', tile: [tx, ty], box: box(tx + 0.5, ty + 0.5, 0.45, 0.45, 0, 0.7) });
    }
    return out;
  }
  // Lo que se hace con lo apuntado (o null)
  actionFor(a) {
    switch (a.kind) {
      case 'placed': return (a.o.layer === 'placed' && this.ranch.objectAction(a.o)) || this.placedAction(a.o);
      case 'door': return this.doorAction(a.tile);
      case 'window': return this.windowAction(a.tile);
      case 'hearth': return this.hearthAction(a.tile);
      case 'fence': return { text: `Quitar ${(PIECES[a.o.placed] || ITEMS[a.o.placed]).name.toLowerCase()}`, run: () => { if (this.pickUp(a.o)) this.onSave?.(); } };
      case 'npc': return this.neighbors.actionFor(a.n);
      case 'kid': return this.family.actionFor(a.id, a.e);
      case 'animal': return this.ranch.talk(a.e);
      case 'wild': return { text: ANIMALS[a.e.type].name, run: () => Audio.blip() };
      case 'monster': return { text: MONSTERS[a.e.type].name, run: () => Audio.blip() };
      case 'crop': return { text: 'Cosechar', run: () => this.farm.harvest(...a.tile) };
      case 'sys': return a.act();
    }
    return null;
  }
  // Una puerta: se abre o se cierra (cerrarla con el jugador en el hueco lo dejaría atrapado: null). Cerrada y de
  // otro (de un vecino, o con alguien jugando contigo cerca), primero se llama
  doorAction(door) {
    const sc = this.scene, p = this.player, closed = sc.doorClosed(...door), inGap = Math.hypot(door[0] + 0.5 - p.x, door[1] + 0.5 - p.y) < 0.55, k = String(door);
    const gate = sc.pieceAt?.(...door)?.kind === 'gate';
    if (!gate && closed && !(this.knocked?.k === k && this.time < this.knocked.until) && this.knockable(door)) return { text: 'Llamar a la puerta', run: () => this.knock(door) };
    const pick = gate ? { text: 'Recoger la puerta de valla', run: () => { if (this.pickUp({ tile: door, layer: 'placed', placed: 'puerta_valla' })) this.onSave?.(); } } : null;
    if (closed || !inGap) return { text: `${closed ? 'Abrir' : 'Cerrar'} la puerta${gate ? ' de valla' : ''}`, run: () => { sc.toggleDoor(...door); Audio.place(); this.onSave?.(); }, alt: pick };
    return gate ? { text: 'Puerta de valla', run: () => Audio.blip(), alt: pick } : null;
  }
  // Lo colocado: las estaciones se usan, en la cama te tumbas o duermes, en la silla te sientas, las luces se
  // apagan y se encienden, el cofre, el armario y la mochila se abren; lo demás se recoge (con X, lo que se usa
  // con E). hungFirst: si encima del mueble cuelga un cuadro, se recoge antes el cuadro (sin apuntar con el ratón)
  placedAction(o, hungFirst = false) {
    const sc = this.scene, save = () => this.onSave?.();
    if (o.layer === 'rug') return this.rugAction(o);
    const hung = hungFirst && o.layer !== 'hang' ? [o.tile, ...extraTiles(o.placed, ...o.tile, o.rot)].map(t => [t, sc.ownAt?.('hang', ...t)]).find(([, v]) => v) : null;
    const top = hung ? { tile: hung[0], layer: 'hang', placed: hung[1].split('@')[0] } : o;
    const name = ITEMS[o.placed].name.toLowerCase(), pick = { text: `${BUILDABLE[top.placed] ? 'Desmontar' : 'Recoger'} ${ITEMS[top.placed].name.toLowerCase()}`, run: () => this.pickUp(top) };   // (lo construido, al desmontarlo, devuelve sus materiales)
    if (STATIONS[o.placed]) return { text: `Usar ${name}`, run: () => this.onCraft?.(o.placed), alt: o.fixed ? null : pick };
    if (o.placed === 'cama' || o.placed === 'cama_nino' || o.placed === 'cama_doble') return { text: 'Usar la cama', run: () => this.bed(o), alt: pick };
    if (o.placed === 'silla' || o.placed === 'taburete' || o.placed === 'sofa' || o.placed === 'sillon') return { text: 'Sentarse', run: () => this.rest.sit(o), alt: o.fixed ? null : pick };
    if (o.placed === 'lavabo') return { text: 'Mirarse en el espejo', run: () => this.onMirror?.(), alt: pick };
    if (o.placed === 'pozo') return this.farm.wellAction(o, o.fixed ? null : pick);   // (E: llenar la regadera; X: desmontarlo)
    if (CHESTS[o.placed] && o.placed !== 'mochila') return { text: `Abrir ${CHESTS[o.placed][1]}`, run: () => this.onChest?.(sc.chestAt(...o.tile), o.tile), alt: pick };   // (lleno no se recoge: hay que vaciarlo antes)
    if (o.placed === 'mochila') return { text: 'Abrir la mochila', run: () => this.onChest?.(sc.chestAt(...o.tile) || [], o.tile), alt: { text: this.inv.equip.espalda ? 'Recoger la mochila' : 'Ponerse la mochila', run: () => this.takeBackpack(o) } };
    if (LIGHTS.has(o.placed)) return { text: `${o.off ? 'Encender' : 'Apagar'} ${name.replace(/^lámpara/, 'la lámpara').replace(/^antorcha/, 'la antorcha').replace(/^vela/, 'la vela').replace(/^candelabro de techo/, 'el candelabro')}`, run: () => { sc.toggleLight(...o.tile); Audio.blip(); save(); }, alt: pick };
    return pick;
  }
  // El fuego del hogar (el de los vecinos no se recoge)
  hearthAction(hearth) {
    const sc = this.scene, off = sc.lightOff(...hearth), mine = !!sc.ownAt?.('placed', ...hearth), save = () => this.onSave?.();
    return { text: off ? 'Encender el fuego' : 'Apagar el fuego', run: () => { sc.toggleLight(...hearth); Audio.noiseHit(off ? 900 : 300, 0.25, 0.25); save(); }, alt: mine ? { text: 'Recoger el hogar', run: () => { if (this.pickUp({ tile: hearth, layer: 'placed', placed: 'chimenea' })) save(); } } : null };
  }
  // Una ventana: se abre o se cierra (con contraventanas, por fuera; sin ellas, con postigos por dentro)
  windowAction(win) { const sc = this.scene, closed = sc.doorClosed(...win); return { text: closed ? 'Abrir la ventana' : 'Cerrar la ventana', run: () => { sc.toggleDoor(...win); Audio.door(); this.onSave?.(); } }; }
  // La alfombra: con X se recoge (con E no, para no llevársela sin querer)
  rugAction(rug) { return { text: `${ITEMS[rug.placed].plain || ITEMS[rug.placed].name} de ${rug.rug.w}×${rug.rug.h}`, run: () => Audio.blip(), alt: { text: 'Recoger', run: () => { if (this.pickUp(rug)) this.onSave?.(); } } }; }
  // La cama: tumbarse (sin dormir), dormir o, en la doble, lo de la familia
  async bed(o) {
    this.bedSpawn(o);   // (como en Minecraft: usar la cama la hace tu punto de reaparición)
    if (o.placed === 'cama_doble') return this.family.bed(o);
    this.busy = true;
    const pick = await hud.ask(this.player.name, '¿Qué hacemos?', ['Tumbarse un rato', 'Dormir', 'Nada']);
    this.busy = false;
    if (pick === 0) this.rest.lie(o);
    if (pick === 1) this.sleep();
  }
  // Llamar a una puerta cerrada: suena para todos los de cerca; si es de un vecino y está en casa, contesta
  knockable(door) {
    if (this.vecinoAt(door)) return true;
    return [...(this.live.peers?.values() || [])].some(q => q.entity && q.sc === 'world' && Math.hypot(q.entity.x - door[0], q.entity.y - door[1]) < 10);
  }
  vecinoAt([tx, ty]) { return Object.entries(HOUSES).find(([, h]) => (!h.project || hasProject(h.project)) && tx === h.x0 + 6 && ty === h.y1 - 1)?.[0] || null; }   // (la puerta: en x0+6, en la fila de abajo)
  knock(door) {
    const g = this, house = this.vecinoAt(door), h = this.days.hour;
    this.knocked = { k: String(door), until: this.time + 8 };
    Audio.knock();
    this.live.knock?.(door);
    if (!house) return;
    const home = this.neighbors.people.filter(n => n.def.home === house && n.hidden);
    setTimeout(() => {
      if (!home.length) { g.gather.float('No contesta nadie…', '#d8c3a0'); return; }
      const who = home[0].def.name;
      if (h >= 22 || h < 7) { g.gather.float(`${who} (desde dentro): ¡Son horas de dormir! Vuelve mañana`, '#fff3c0'); return; }
      g.gather.float(`${who}: ¡Voy! … ¡Pasa, pasa!`, '#fff3c0');
      if (this.scene.doorClosed(...door)) { this.scene.toggleDoor(...door); Audio.door(); }
    }, 900);
  }
  // X: lo segundo que se puede hacer aquí (recoger lo que se usa con E)
  altAction() { const n = this.nearest(); n?.alt?.run(); }
  // Tirar al suelo lo que se lleva en la mano (uno, o el montón entero)
  toss(all = false) {
    const p = this.player, held = this.inv.held, i = this.inv.selected;
    if (!p || !held || this.busy || this.mode !== 'play' || p.pose || this.gamemode === 'spectator') return;
    const n = all ? held.n : 1, { id, n: _, ...extra } = held;
    this.inv.take(i, n, true);
    for (let k = 0; k < n; k++) this.gather.addDrop({ id, extra: Object.keys(extra).length ? extra : undefined, x: p.x + p.face.x * (2 + Math.random() * 0.4), y: p.y + p.face.y * (2 + Math.random() * 0.4) + (Math.random() - 0.5) * 0.3, z: 12, vz: 45, t: -1.2, scene: this.scene });
    this.gather.swing = 0.25; this.gather.swingItem = null;
    Audio.swish();
  }
  // Recoger una mochila del suelo: si no llevas, te la pones con lo que tenga dentro; si llevas, solo vacía
  takeBackpack(o) {
    const sc = this.scene, inside = sc.chestAt(...o.tile) || [], full = inside.some(Boolean), inv = this.inv;
    if (!inv.equip.espalda) {
      sc.unplace(o);
      inv.equip.espalda = { id: 'mochila', color: ITEMS.mochila.dye };
      inside.forEach((s, j) => { if (s) inv.slots[HOTBAR + j] = s; });
      inv.changed();
      Audio.pickup();
      this.onSave?.();
      return;
    }
    if (full) { this.gather.float('Ya llevas una mochila: saca antes lo que tenga', '#ffb0a0'); Audio.error(); return; }
    this.pickUp(o);
  }
  // Dejar en el suelo, delante, la mochila que llevas puesta, con todo lo que lleve dentro
  dropBackpack() {
    const p = this.player, sc = this.scene, inv = this.inv;
    if (!p || !inv.equip.espalda) return 'No llevas mochila.';
    const tx = Math.floor(p.x + p.face.x * 1.1), ty = Math.floor(p.y + p.face.y * 1.1);
    if (!sc.canPlace?.(tx, ty, 'mochila', p)) return 'Aquí delante no hay sitio para dejarla.';
    sc.place(tx, ty, 'mochila', 0);
    const chest = sc.chestAt(tx, ty);
    for (let j = 0; j < 27; j++) { chest[j] = inv.slots[HOTBAR + j] || null; inv.slots[HOTBAR + j] = null; }
    delete inv.equip.espalda;
    inv.changed();
    sc.chestTouched(tx, ty);
    Audio.place();
    this.onSave?.();
    return null;
  }
  sleep() { return this.days.sleep(); }
  // Devolver a la mochila algo colocado
  // carry: lo coge el modo construir para moverlo (no devuelve nada: se deja en otro sitio)
  pickUp(o, carry = false) {
    if (o.fixed && !o.yard && !o.build) return false;   // (lo que venía puesto no se recoge sin querer: solo la valla de tu jardín y, en modo construir, todo)
    // Lo que se construye (las piezas, como la valla, y los muebles y las estaciones) no vuelve a la mochila: devuelve
    // sus materiales
    const B = BUILDABLE[o.placed] || (PIECES[o.placed] && !ITEMS[o.placed] ? PIECES[o.placed] : null);
    // (una alfombra vuelve como la del telar de su tamaño; las de antes, de cualquier tamaño, se ponían con V)
    const r = o.layer === 'rug' && o.rug, id = r ? rugId(ITEMS[o.placed].rug || o.placed, RUG_MADE.find(([w, h]) => (w === r.w && h === r.h) || (w === r.h && h === r.w)) || [1, 1]) : o.placed;
    if (!B && this.inv.room(id) < 1) { this.gather.float('No te cabe: no llevas sitio libre', '#ffb0a0'); Audio.error(); return false; }
    if (this.scene === this.world && !machineEmpty(machineAt(this.world, o.tile))) { this.gather.float(`Vacía ${MACHINES[o.placed]?.the || 'la máquina'} antes`, '#ffb0a0'); Audio.error(); return false; }
    if (CHESTS[o.placed] && o.placed !== 'mochila' && this.scene.chestAt(...o.tile)?.some(Boolean)) { this.gather.float(`Vacía ${CHESTS[o.placed][1]} antes`, '#ffb0a0'); Audio.error(); return false; }
    if (this.scene.unplace(o) === false && B) return false;
    if (!B) this.inv.add(id, 1);
    else if (!carry) for (const [m, n] of B.cost) { const left = this.inv.add(m, n); if (left) this.gather.throwOut(m, left); }
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
      'Te he dejado unas herramientas de hierro: hacha, pico, guadaña, azada y pala. Elígelas con los números y úsalas con el clic izquierdo. Para usar lo demás, acércate, pon el cursor encima y pulsa E.',
      'No te agobies, que no hace falta saberlo todo hoy. Te dejo apuntado qué hacer, de uno en uno, arriba a la izquierda.',
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
  // Nilo convierte la casa ampliada en la casa familiar: más grande, con dormitorio, cuarto de los niños, baño,
  // cocina y salón (los muebles, de cada uno)
  async offerFamily() {
    const cost = [['tablas', 80], ['piedra', 60], ['lingote_hierro', 6]], ok = cost.every(([id, n]) => this.inv.count(id) >= n);
    const pick = await hud.ask('Nilo', 'Si la familia va a crecer, hace falta sitio. Con 80 tablas, 60 piedras y 6 lingotes de hierro te levanto una casa familiar: dormitorio, cuarto para los niños, baño, cocina y salón. Los muebles ya los pones tú.', ok ? ['¡Adelante!', 'Ahora no'] : ['Vale, lo junto y vuelvo']);
    if (!ok || pick !== 0) return;
    for (const [id, n] of cost) this.inv.remove(id, n);
    this.house.family = true;
    setFamilyHouse(true);
    this.world.rebuildVillage();   // (los árboles y arbustos que había donde va la casa ya no están)
    this.layHouse('family', false);
    await hud.say('Nilo', ['¡Hecho! Ya tienes casa familiar. Construye con B la cama doble, la cuna, las camas de los niños y lo de la cocina y el baño (yo vendo los planos de las camas y la cuna; Dani, los demás), y ponlo a tu gusto.']);
    this.onSave?.();
  }
  // Tu casa: su tamaño (false, true o 'family') y su solar
  get houseSize() { return this.house.family ? 'family' : !!this.house.big; }
  houseRect() { return this.house.family ? HOUSE_FAMILY : this.house.big ? HOUSE_BIG : HOUSE; }
  // ¿Está el jugador a cubierto? En una cueva o bajo un tejado del mundo
  get indoors() { return !!(this.player?.inside || this.underRoof); }
  // Nombre de la casa en la que está el jugador
  houseName() {
    const p = this.player;
    if (inOwnHouse(p.x, p.y)) return 'Tu casa';
    for (const h of Object.values(HOUSES)) if ((!h.project || hasProject(h.project)) && p.x > h.x0 && p.x < h.x1 && p.y > h.y0 && p.y < h.y1) return `Casa de ${h.name}`;
    if (inTavern(p.x, p.y)) return 'La taberna';
    return 'Bajo techo';
  }
  // La casilla de dentro de tu casa, junto a la puerta (donde despiertas si te rescatan)
  homeSpot() {
    const H = this.houseRect(), [dx, dy] = doorTile(H.x0, H.y0, this.houseSize);
    return [dx + 0.5, dy - 0.5];
  }
  // Llevar al jugador a un sitio del mundo de fuera (/tp): sale de la cueva si está en una, se levanta y, si allí
  // no hay agua, se baja de la barca (a caballo, va con él)
  teleport(x, y) {
    const p = this.player;
    if (!p || !this.world || !Number.isFinite(x) || !Number.isFinite(y)) return false;
    x = wrapX(x); y = Math.max(NORTH + 1, Math.min(SOUTH - 1, y));   // (dentro del planeta)
    if (p.pose) this.rest.stand();
    if (this.scene !== this.world) { this.scene = this.world; p.inside = false; }
    if (p.boat && !this.world.water(x, y) && !this.crew.hasMate()) this.world.moorBoat(p.x, p.y, 0);   // (te llevan a tierra remando: la barca se queda amarrada donde estabas)
    Object.assign(p, { x, y, vx: 0, vy: 0, z: 0, vz: 0, boat: (p.boat || !!p.aboard) && !!this.world.water(x, y), aboard: null });
    this.view3d.snap();
    this.updatePlace();
    return true;
  }
  teleportHome() { const [x, y] = this.homeSpot(); return this.teleport(x, y); }
  // Llevar al jugador adonde reaparece (cuando cae en combate): su punto (/spawnpoint) o su casa
  goHome() {
    const [x, y] = this.respawnSpot();
    Object.assign(this.player, { inside: false, x, y, view: 'front', dir: null, boat: false, aboard: null, mount: false });
    this.scene = this.world;
    this.updatePlace();
  }
  // Devuelve algo a la mochila; si no cabe, al suelo
  giveBack(id, n = 1, from) {   // (from: la casilla de donde sale, para que la ropa conserve su color)
    const left = this.inv.add(id, n, extraOf(from));
    if (left && this.player) this.gather.throwOut(id, left, extraOf(from));
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
  layHouse(size, furnish) {
    const w = this.world, H = size === 'family' ? HOUSE_FAMILY : size ? HOUSE_BIG : HOUSE, [dx, dy] = doorTile(H.x0, H.y0, size);
    const bp = size === 'family' ? familyBlueprint({ x0: H.x0, y0: H.y0 }) : houseBlueprint({ x0: H.x0, y0: H.y0, big: size, furnish: furnish ? 'full' : 'none' });
    const interior = (tx, ty) => tx > H.x0 && tx < H.x1 - 1 && ty > H.y0 && ty < H.y1 - 1;
    const clear = (tx, ty) => {
      const cur = w.ownAt('placed', tx, ty);
      if (!cur) return;
      const [cid] = parsePlaced(cur), o = { tile: [tx, ty], layer: 'placed', placed: cid };
      const items = CHESTS[cid] ? w.chestAt(tx, ty) : null;
      w.unplace(o);
      if (items?.some(Boolean)) {
        const spot = this.freeTile(H, dx, dy);
        if (spot) { w.place(spot[0], spot[1], cid); w.delta(Math.floor(spot[0] / CHUNK), Math.floor(spot[1] / CHUNK)).chest[`${spot[0]},${spot[1]}`] = items; return; }
        for (const it of items) if (it) this.giveBack(it.id, it.n, it);
      }
      if (PIECES[cid] && !ITEMS[cid]) { for (const [m, n] of PIECES[cid].cost) this.giveBack(m, n); } else this.giveBack(cid, 1);
    };
    // (en la casa familiar el hogar va en el salón: el de antes, que quedaría en un dormitorio, se cambia allí; si
    // había más, los otros vuelven a la mochila)
    if (size === 'family') {
      let n = 0;
      for (let ty = H.y0; ty < H.y1; ty++) for (let tx = H.x0; tx < H.x1; tx++) if (parsePlaced(w.ownAt('placed', tx, ty) || '')[0] === 'chimenea') { w.unplace({ tile: [tx, ty], layer: 'placed', placed: 'chimenea' }); n++; }
      if (n > 1) this.giveBack('chimenea', n - 1);
    }
    for (const [t, raw] of Object.entries(bp.placed)) {
      const [tx, ty] = t.split(',').map(Number), [id, rot] = parsePlaced(raw);
      if (PIECES[id]) {
        if (parsePlaced(w.ownAt('placed', tx, ty) || '')[0] === id) continue;
        const a = w.anchorOf(tx, ty);   // (lo de varias casillas que pisa un muro nuevo, por ejemplo los pies de una cama)
        if (a) clear(...a);
        clear(tx, ty); w.place(tx, ty, id, rot);
      }
      else if (!w.ownAt('placed', tx, ty)) w.place(tx, ty, id, rot);   // muebles: solo donde no haya nada del jugador
    }
    // Muros de antes que al ampliar quedan dentro: fuera (menos los de los cuartos del plano)
    for (let ty = H.y0; ty < H.y1; ty++) for (let tx = H.x0; tx < H.x1; tx++) {
      if (!interior(tx, ty) || PIECES[parsePlaced(bp.placed[`${tx},${ty}`] || '')[0]]) continue;
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
    const w = this.world, H = this.houseRect(), [dx, dy] = doorTile(H.x0, H.y0, this.houseSize);
    for (let ty = H.y0; ty < H.y1; ty++) for (let tx = H.x0; tx < H.x1; tx++) {
      const [id, rot] = parsePlaced(w.ownAt('placed', tx, ty) || '');
      if (id !== 'cama') continue;
      const [fx, fy] = footTile(tx, ty, rot), cur = w.ownAt('placed', fx, fy);
      if (!cur || PIECES[parsePlaced(cur)[0]]) continue;   // nada, o un muro (la cama se queda como está)
      const items = w.chestAt(fx, fy), [cid, crot] = parsePlaced(cur);
      w.unplace({ tile: [fx, fy], layer: 'placed', placed: cid });
      const spot = this.freeTile(H, dx, dy);
      if (!spot) { this.giveBack(cid, 1); for (const it of items || []) if (it) this.giveBack(it.id, it.n); continue; }
      w.place(spot[0], spot[1], cid, crot);
      if (items) w.delta(Math.floor(spot[0] / CHUNK), Math.floor(spot[1] / CHUNK)).chest[`${spot[0]},${spot[1]}`] = items;
    }
  }
  // El candelabro de tu casa, en medio, si ahí no hay nada y no tienes ya otro colgado (la casa familiar no lo trae: la
  // amuebla el jugador)
  hangHouseLamp() {
    if (this.house.family) return;
    const w = this.world, big = this.house.big, H = big ? HOUSE_BIG : HOUSE, { w: W, h } = houseSize(big), tx = H.x0 + Math.floor(W / 2) - 1, ty = H.y0 + Math.floor(h / 2) - 1;
    for (let y = H.y0; y < H.y1; y++) for (let x = H.x0; x < H.x1; x++) if (parsePlaced(w.at('placed', x, y) || '')[0] === 'candelabro') return;
    if (!w.at('placed', tx, ty) && !w.footAt(tx, ty) && w.roofAt(tx, ty)) w.place(tx, ty, 'candelabro');
  }
  // La cama y el hogar de tu casa que no estén contra un muro pasan a su sitio del plano (contra la pared
  // de atrás), si está libre
  tidyHouse() {
    if (this.house.family) return;
    const w = this.world, big = this.house.big, H = big ? HOUSE_BIG : HOUSE, bp = houseBlueprint({ x0: H.x0, y0: H.y0, big });
    const wallAt = (x, y) => w.pieceAt(x, y)?.kind === 'wall';
    const free = (x, y) => !w.ownAt('placed', x, y) && !w.footAt(x, y);
    for (const id of ['cama', 'chimenea']) {
      const spots = Object.entries(bp.placed).filter(([, v]) => parsePlaced(v)[0] === id).map(([t]) => t.split(',').map(Number));
      for (let ty = H.y0 + 1; ty < H.y1 - 1; ty++) for (let tx = H.x0 + 1; tx < H.x1 - 1; tx++) {
        const [cur, rot] = parsePlaced(w.ownAt('placed', tx, ty) || '');
        if (cur !== id || wallAt(tx - front(rot)[0], ty - front(rot)[1])) continue;
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
    const w = this.world, H = this.houseRect(), [dx, dy] = doorTile(H.x0, H.y0, this.houseSize);
    entries.sort(([a], [b]) => (house.chests?.[b] ? 1 : 0) - (house.chests?.[a] ? 1 : 0));   // los cofres primero
    let lost = 0;
    for (const [k, raw] of entries) {
      const [id, rot] = parsePlaced(raw), spot = this.freeTile(H, dx, dy);
      if (spot) {
        w.place(spot[0], spot[1], id, rot);
        if (CHESTS[id] && house.chests?.[k]) w.delta(Math.floor(spot[0] / CHUNK), Math.floor(spot[1] / CHUNK)).chest[`${spot[0]},${spot[1]}`] = house.chests[k];
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
    // (lo que se soltó al morir en esta cueva o mazmorra sigue ahí: las cuevas se rehacen al entrar)
    const key = this.sceneKey(scene);
    for (const d of this.gather.drops) if (d.sceneKey === key) d.scene = scene;
    Audio.indoors = inside;
    this.build.toggle(false);
    this.updatePlace();
    this.view3d.snap();
    await this.view3d.whenReady?.(1500);   // (el suelo se hace en otro hilo: que esté antes de destapar)
    await hud.fade(false);
    this.busy = false;
  }
  // Casilla bajo un punto de la pantalla (ratón o dedo): el rayo desde la cámara hasta el suelo
  // El aspecto del jugador con la ropa que lleva puesta (cambia al ponerse o quitarse algo)
  appearance() {
    if (!this.player) return null;
    // (solo cambia con la ropa puesta y su color: lo gastada que esté la armadura no rehace el muñeco)
    if (this.looked?.v === this.inv.v && this.looked.base === this.player.look) return this.looked.look;
    const key = Object.entries(this.inv.equip).map(([k, it]) => `${k}:${it.id}:${it.color}`).sort().join('|');
    if (this.looked?.key !== key || this.looked.base !== this.player.look) this.looked = { key, base: this.player.look, look: dressed(this.player.look, this.inv.equip) };
    this.looked.v = this.inv.v;
    return this.looked.look;
  }
  tileAtScreen(clientX, clientY) { return this.scene ? this.view3d.tileAt(clientX, clientY) : null; }
  // La casilla con la que se trabaja la tierra: un paso por delante o, en primera persona, la que está en la cruceta (si llega)
  aimTile() {
    const p = this.player, mt = CAM.first ? this.mouseTile() : null;
    return mt && Math.hypot(mt[0] + 0.5 - p.x, mt[1] + 0.5 - p.y) < 2.5 ? mt : [Math.floor(p.x + p.face.x * 0.9), Math.floor(p.y + p.face.y * 0.9)];
  }
  // La casilla bajo el ratón mientras está sobre el juego (null si no), recalculada en cada fotograma: la
  // cámara se mueve aunque el ratón se quede quieto
  mouseTile() {
    const p = this.mousePoint();
    return p && [Math.floor(p[0]), Math.floor(p[1])];
  }
  // El punto exacto (con decimales) bajo el ratón: para colocar libre
  mousePoint() {
    const m = this.mouse;
    if (!m?.in || !this.scene) return null;
    if (m.frame !== this.frameNo) { m.frame = this.frameNo; m.point = this.view3d.pointAt(m.x, m.y); }
    return m.point;
  }

  // ---------- bucle ----------
  run() {
    let last = performance.now(), acc = 0;
    const perf = this.perf = { frames: 0, steps: 0, update: 0, draw: 0, max: 0 };   // (lo que cuesta cada fotograma: para el panel de F3)
    const frame = now => {
      acc += Math.min(0.25, (now - last) / 1000);
      last = now;
      const t0 = performance.now();
      // (un fallo al avanzar tampoco: se avisa una vez y el juego sigue respondiendo)
      try { while (acc >= STEP) { this.update(STEP); acc -= STEP; perf.steps++; } } catch (e) { acc = 0; if (this.updateError !== e.message) console.error(e); this.updateError = e.message; }
      const t1 = performance.now();
      // (un fallo al dibujar no para el juego: se avisa y se sigue)
      try { this.render(); } catch (e) { if (this.renderError !== e.message) console.error(e); this.renderError = e.message; }
      const t2 = performance.now();
      perf.frames++; perf.update += t1 - t0; perf.draw += t2 - t1; perf.max = Math.max(perf.max, t2 - t0);
      if (this.frameNo % 30 === 0) Music.update(this);
      requestAnimationFrame(frame);
    };
    requestAnimationFrame(frame);
  }

  // Sin dibujar (el mundo del servidor): solo avanza, a pasos fijos, unas 20 veces por segundo. onError: un fallo al
  // avanzar (se avisa una vez y se sigue)
  // (tps: los pasos por segundo de verdad del último segundo, y lo que tardan; para /tps en el terminal)
  runHeadless() {
    let last = performance.now(), acc = 0, steps = 0, busy = 0, t0 = last;
    this.tps = { steps: 60, ms: 0 };
    setInterval(() => {
      const now = performance.now();
      acc += Math.min(1, (now - last) / 1000);
      last = now;
      try { while (acc >= STEP) { this.update(STEP); acc -= STEP; steps++; } } catch (e) { acc = 0; if (this.updateError !== e.message) this.onError?.(e); this.updateError = e.message; }
      busy += performance.now() - now;
      if (now - t0 >= 1000) { this.tps = { steps: Math.round((steps * 1000) / (now - t0)), ms: steps ? busy / steps : 0 }; steps = 0; busy = 0; t0 = now; }
    }, 50);
  }

  // Dónde se va a jugar, en el menú (aún sin jugador): donde se quedó la partida guardada, para hornear los árboles
  // lejanos de la estación de allí (en el otro hemisferio, la contraria). null: no se sabe
  savedY() { const p = Profile.data?.save?.player; return p && !p.inside && Number.isFinite(p.y) ? p.y : null; }

  update(dt) {
    this.time += dt;
    this.live.tick(dt);
    const p = this.player;
    if (p && this.mode === 'map') { this.map.update(keys, dt); return; }
    if (!p || this.mode !== 'play') return;
    if (!this.live.guest) this.world.clock += dt;   // (jugando en el mundo de otro, la hora la lleva él)
    this.gather.update(dt);
    this.hook('update', dt);
    if (keys.use && !this.busy && !this.build.on) this.gather.use(true);
    if (this.busy || hud.dialogOpen || p.pose) { p.stop(); return; }
    p.speedMul = (this.buffs.rapido > this.time ? 1.35 : 1) * (p.mount ? this.ranch.rideSpeed() : 1) * this.archery.walk;
    if (Object.values(keys).some(Boolean)) this.lastInput = this.time;   // (para /setidletimeout)
    if (p.aboard) p.stop();   // (de pasajero en una barca, le lleva ella)
    else p.update(dt, keys, this.scene);
    if (this.spectating) this.followSpectated();
    if (this.scene === this.world) this.aroundPlanet();
    if (!p.inside) this.explore();
    // Bajo un tejado: cambia el ambiente (sonido, lluvia, nombre del sitio) y se guarda, como al entrar en casa
    const house = this.scene === this.world && !p.aboard ? this.ranch.houseAround(p) : null;
    this.view3d.world?.showInside?.(house && !CAM.first ? house : null);   // (dentro del establo, sin tejado: se ve lo de dentro)
    const under = this.scene === this.world && (underRoof(this.world, p.x, p.y) || !!house);
    if (under !== this.underRoof) { this.underRoof = under; p.underRoof = under; Audio.indoors = this.indoors; this.updatePlace(); this.onSave?.(); }
    if (this.frameNo % 10 === 0) this.updatePlace();
  }

  render() {
    this.frameNo++;
    // En primera persona el ratón mueve la cámara y se apunta con la cruceta, en el centro de la pantalla
    syncLook(this.mode === 'play' && !this.busy && !hud.dialogOpen && !this.build.on && !!this.player && !this.windowsOpen);   // (con una ventana abierta, el cursor es para ella)
    document.body.classList.toggle('talking', this.busy || hud.dialogOpen);   // (hablando, las ventanas se apartan)
    this.onFrame?.();
    if (aimLock.locked) { const c = this.mouse ||= {}; c.x = innerWidth / 2; c.y = innerHeight / 2; c.in = true; }
    const near = this.nearest(), p = this.player, m = this.mouse;
    // Lo apuntado con el cursor lleva un borde amarillo, y la opción sale a su lado
    this.highlight = this.build.on ? this.build.pickHighlight() : near && m?.in && !p.pose && !p.aboard ? this.aimed() : null;
    this.view3d.game = this;
    // (sin partida, al entrar y en el menú, el fondo es una foto fija: body.still, en index.html; el mundo no se dibuja)
    const still = !this.player || !this.scene;
    if (still !== this.still) { this.still = still; document.body.classList.toggle('still', still); if (!still) this.view3d.snap?.(); }
    if (!still) this.view3d.render(this);
    else this.view3d.idle?.(this);   // (sin dibujar, se adelanta lo que se puede: los impostores de los árboles lejanos)
    const prey = this.gather.target?.prey, click = prey && this.highlight?.e === prey ? '  ·  Clic: atacar' : '';
    hud.prompt(near && (near.alt ? `${near.text}  ·  X: ${near.alt.text.toLowerCase()}` : near.text) + click, this.highlight ? [m.x, m.y] : null);
    let hint = '';
    if (this.player) {
      for (const s of this.systems) { hint = s.hint?.() || ''; if (hint) break; }
      hint ||= this.build.on ? this.build.hint() : this.gather.hint();
    }
    hud.hint(hint);
    if (this.player && this.world) {
      this.map.markers = this.places.markers();
      if (this.mode === 'map') this.map.people = this.neighbors.people.filter(n => !n.hidden).map(n => ({ x: n.x, y: n.y, name: n.def.name }));
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

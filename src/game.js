// Núcleo del juego: estado, bucle de paso fijo e interacciones. El dibujo es en 3D (src/three/engine.js).
import { Player } from './entities.js';
import { View3D } from './three/engine.js';
import { prewarmIcons } from './three/icons.js';
import { itemIcon } from './art/items.js';
import { camToSave, camFromSave, CAM } from './camera.js';
import { wrapX, dxOf, wrapIndex, HALF, NORTH, SOUTH } from './world/planet.js';
import { Overworld, NILO_LOOK, wellSpec, vehicleSolids } from './world/scenes.js';
import { houseBlueprint, familyBlueprint, byChunk, doorTile, houseSize } from './world/blueprints.js';
import { HOUSE, HOUSE_BIG, HOUSE_FAMILY, HOUSES, CENTER, SPAWN, inBounds, inOwnHouse, inTavern, inChapel, inLawOffice, houseStands, setFamilyHouse } from './world/village.js';
import { PIECES, parsePlaced } from './pieces.js';
import { BUILDABLE } from './buildables.js';
import { Caves } from './caves.js';
import { Profile } from './accounts.js';
import { BIOMES } from './world/biomes.js';
import { CHUNK, WORLD_SEED } from './world/gen.js';
import { MapView } from './ui/map.js';
import { Inventory } from './inventory.js';
import { Gathering } from './gather.js';
import { RoomWatch, shelterOn } from './structure.js';
import { Crafting } from './crafting.js';
import { STATIONS } from './recipes.js';
import { START_KIT, ITEMS, RUG_MADE, rugId, CHESTS, UNKNOWN_NAME, knownItem, FIRE_MS, FIRE_FUEL } from './items.js';
import { clothesFor, dressed, wearStage } from './looks.js';
import { WorldStore } from './worldstore.js';
import { BuildMode } from './build.js';
import { Plans } from './plans.js';
import { Wear } from './wear.js';
import { watchtower } from './world/tower.js';
import { TimeSystem } from './time.js';
import { Farm } from './farm.js';
import { Ranch } from './ranch.js';
import { Horse } from './horse.js';
import { HorseCare } from './horsecare.js';
import { HorseLead } from './horselead.js';
import { Saddlebags } from './saddlebags.js';
import { Freshness } from './freshness.js';
import { Steps } from './steps.js';
import { PlayTime } from './playtime.js';
import { Recap } from './recap.js';
import { Fishing } from './fishing.js';
import { Traps } from './traps.js';
import { RodRest } from './rodrest.js';
import { Wildlife } from './wildlife.js';
import { Wind } from './wind.js';
import { EVENT } from './senses.js';
import { Rest } from './rest.js';
import { Crew } from './crew.js';
import { DoorWalk } from './doorwalk.js';
import { footTile, front, extraTiles, yawOf } from './art/stations.js';
import { solidsOf, hull, placeBoxes, aabb, distTo, rayHits } from './world/fit.js';
import { HOTBAR, extraOf } from './inventory.js';
import { Visitors } from './visitors.js';
import { Travellers } from './travellers.js';
import { Neighbors } from './neighbors.js';
import { Reputation } from './reputation.js';
import { Social } from './social.js';
import { Talk } from './talk.js';
import { Board } from './board.js';
import { VillageSites } from './villagesites.js';
import { Combat, DIFFICULTIES, MONSTERS, EFFECT_NAMES } from './combat.js';
import { Hunt, bodyBox, kindName } from './hunt.js';
import { Code } from './huntcode.js';
import { Archery } from './archery.js';
import { reportFault } from './faults.js';
import { ANIMALS } from './art/farm.js';
import { syncLook, aimLock } from './input.js';
import { xpTo } from './xp.js';
import { Mobs } from './mobs.js';
import { Experience } from './xp.js';
import { Machines, MACHINES, machineAt, machineEmpty } from './machines.js';
import { Trades } from './trades.js';
import { Maps } from './maps.js';
import { Route } from './route.js';
import { MapMarks } from './mapmarks.js';
import { Explore } from './explore.js';
import { Stats, Skills, Collection, Achievements, Story } from './progress.js';
import { Music } from './music.js';
import { Live } from './live.js';
import { Family } from './family.js';
import { Settings } from './settings.js';
import { apagada } from './opciones.js';
import { savedLang, t, tList, formatMessage } from './i18n.js';
import { keys, clearKeys, dropSprint } from './input.js';
import { Audio } from './audio.js';
import { hud } from './ui/hud.js';
import { Prompts } from './ui/prompts.js';
import { kitOf, kitKey } from './kit.js';
import { Carry, WeightInventory, weightMode } from './carry.js';
import { BULKY, BARROW } from './carry-items.js';
import { Barrow } from './barrow.js';
import { Cart } from './cart.js';
import { Needs, RATES } from './needs.js';
import { Body } from './body.js';
import { Remarks } from './remarks.js';
import { Gossip } from './gossip.js';
import { Chatter } from './chatter.js';
import { Business, BIZ_THINGS } from './business.js';
import { Law } from './law.js';
import { TableGames } from './tablegames.js';
import { Missions } from './missions.js';
import { Rumours } from './rumours.js';
import { Dive } from './dive.js';
import { Tracks } from './tracks.js';
import { NatureBook } from './nature.js';

// Lo que ya no existe en el juego y lo que costó. Al cargar una partida se quita de donde esté (la mochila, los cofres, las
// alforjas, el correo o puesto en el mundo) y, si no, quedaría un objeto sin datos que rompe la mochila. Devuelve lo que
// hay que devolver: [[id, n]]
// Las herramientas son todas de hierro: las de antes pasan a serlo, con la parte de uso que les quedaba (dur: lo que aguantaban)
const OLD_TOOLS = {};
for (const tool of ['hacha', 'pico', 'guadana', 'azada']) for (const [suffix, dur] of [['', 60], ['_piedra', 130], ['_cobre', 190], ['_oro', 500]]) OLD_TOOLS[tool + suffix] = { id: `${tool}_hierro`, dur };
// (NORMA: todo id que se quite del juego va aquí o en LEGACY_ITEMS; lo que no se conoce se guarda como de una versión más
// nueva: ver knownItem en items.js)
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
// The tool wheel's slow motion (src/ui/wheel.js): how fast the game goes while it is open, playing alone, and how fast it
// gets there and back (per second of real time: about 0.12 s)
const SLOW_MOTION = 0.3, SLOW_RATE = 25;

// Deltas con tu casa recién hecha: para el fondo del menú, que no tiene partida
function defaultHouseDeltas() {
  const out = new Map();
  for (const [k, c] of Object.entries(byChunk(houseBlueprint({ x0: HOUSE.x0, y0: HOUSE.y0 }), CHUNK))) out.set(k, { removed: {}, tilled: {}, chest: {}, v: 0, ...c });
  return out;
}

// Los modos de juego (/gamemode) y las reglas del mundo (/gamerule) con lo que valen al empezar
export const GAMEMODES = { survival: 'supervivencia', creative: 'creativo', spectator: 'espectador' };
export const RULES = { keepInventory: false, doMobSpawning: true, doWeatherCycle: true, doDaylightCycle: true, naturalRegeneration: true, announceAdvancements: true, doThirst: true, doFatigue: true, doBodyWeather: true, doGardenPests: true, doLaw: true };   // (doGardenPests: pests.js; doLaw: law.js; doThirst, doFatigue: needs.js; doBodyWeather: body.js, cold and heat on the needs; old saves get true, and they are read as !== false)
const TAVERN_SEATS = new Set(['silla', 'taburete', 'barber_chair']);   // (en la taberna, quien quiere se sienta)
// (no key held: what a rearing horse's rider moves with, horse.js held; frozen, never written)
const NO_KEYS = Object.freeze({ up: false, down: false, left: false, right: false, run: false, sprint: false, use: false, space: false, dive: false, mapFast: false });
const AIM_REACH = 2;   // lo que se apunta con el ratón se usa si está a esto como mucho (casillas)
const LIGHTS = new Set(['lampara', 'antorcha', 'vela', 'candelabro', 'post_lantern']);
const BEDS = new Set(['cama', 'cama_nino', 'cama_doble']);   // lo colocado que se apaga y se enciende con E
const JUMP_COVER = 24;   // casillas: un salto más largo (/tp) se hace a oscuras (ver coverJump); uno corto, de golpe
const BLUR_MS = 50;      // sin el foco, un dibujo cada tanto (unos 20 fps; ver run)
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
    this.underGlass = false;     // … and it is of glass (greenhouse.js)
    this.scene = null;
    this.onSave = null;
    this.time = 0;
    this.frameNo = 0;
    this.prompts = new Prompts(this);   // (what the keys do, at what is aimed at: ui/prompts.js)
    this.map = new MapView();
    this.inv = new Inventory();
    this.gather = new Gathering(this);
    this.craft = new Crafting(this);
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
    this.barrow = this.addSystem(new Barrow(this));   // the wheelbarrow, pushed with both hands (before carry: its hint wins)
    this.plans = this.addSystem(new Plans(this));   // what is drawn with B, and the hammer that builds it (src/plans.js; before whatever else offers a target)
    this.wear = this.addSystem(new Wear(this));   // what is built ages, and the hammer repairs it (src/wear.js)
    this.carry = this.addSystem(new Carry(this));   // weight and things in the arms (the default; ?inventario=casillas: the slots. Before the bow, so its hint wins)
    this.archery = this.addSystem(new Archery(this));   // el arco (antes que lo que se haga con E o con la herramienta)
    this.villageSites = this.addSystem(new VillageSites(this));   // where the village's buildings stand in this world, chosen once (src/villagesites.js)
    this.board = this.addSystem(new Board(this));
    this.farm = this.addSystem(new Farm(this));
    this.ranch = this.addSystem(new Ranch(this));
    this.horse = this.addSystem(new Horse(this));   // the horse from the saddle: bond, whistle (N), gallop stamina, spooks (Plan F, src/horse.js)
    this.saddlebags = this.addSystem(new Saddlebags(this));   // the horse's saddlebags: shared with the couple, one writer at a time (Plan F, src/saddlebags.js)
    this.freshness = this.addSystem(new Freshness(this));   // the catch going off, and cleaning and salting it (src/freshness.js)
    this.horsecare = this.addSystem(new HorseCare(this));   // what the horse eats and drinks, its shoes, being sore (Plan R4-2, src/horsecare.js)
    this.horselead = this.addSystem(new HorseLead(this));   // led by the reins, and tied (Plan R4-4, src/horselead.js)
    this.cart = this.addSystem(new Cart(this));   // the horse cart: hitched, driven, parked; its passenger (Plan R4-5, src/cart.js)
    this.family = this.addSystem(new Family(this));
    this.fishing = this.addSystem(new Fishing(this));
    this.traps = this.addSystem(new Traps(this));   // the fish traps and their buoys (src/traps.js)
    this.rodrest = this.addSystem(new RodRest(this));   // the rod laid on its rest, with its bell (src/rodrest.js)
    this.wind = this.addSystem(new Wind(this));   // the wind, the same for everyone (src/wind.js, Plan R3: it carries the scent; before wildlife, which reads it)
    this.wildlife = this.addSystem(new Wildlife(this));
    this.visitors = this.addSystem(new Visitors(this));   // the birds and the rabbits seen coming to the garden (src/visitors.js; after wildlife: they count together)
    this.rest = this.addSystem(new Rest(this));
    this.doorWalk = this.addSystem(new DoorWalk(this));   // walking up to a door and pushing it (src/doorwalk.js)
    this.crew = this.addSystem(new Crew(this));   // ir de pasajero en la barca de otro
    this.neighbors = this.addSystem(new Neighbors(this));
    this.rep = this.addSystem(new Reputation(this));   // the village's reputation (after stats and neighbors: an old game is born from them)
    this.gossip = this.addSystem(new Gossip(this));   // what the village knows about you, and who has heard it (src/gossip.js)
    this.huntcode = this.addSystem(new Code(this));   // the hunter's code, Paco's respect, the deer call and the cast antlers (src/huntcode.js, Plan R3-4; before hunt: the call in the hand)
    this.hunt = this.addSystem(new Hunt(this));   // pegar a los animales (antes que a las criaturas: va a lo que se apunta)
    this.tracks = this.addSystem(new Tracks(this));   // prints, blood and the locked trail (src/tracks.js, Plan G; drawn by three/tracks3d.js)
    this.combat = this.addSystem(new Combat(this));
    this.needs = this.addSystem(new Needs(this));   // thirst, stamina, rest, air and sleep (health and hunger stay in combat)
    this.body = this.addSystem(new Body(this));   // the body: dirt, mud, wet, snow, blood, felt temperature, growth clocks (feeds needs through body.factors: right after needs)
    this.dive = this.addSystem(new Dive(this));   // the finds on the sea and lake beds, while swimming
    this.mobs =this.addSystem(new Mobs(this));   // la luz y las criaturas de fuera, de noche
    this.xp = this.addSystem(new Experience(this));   // la experiencia y los niveles
    this.machines = new Machines(this);   // el horno y el alambique, que llevan su tiempo
    this.trades = new Trades(this);       // los tratos con los vecinos
    this.maps = this.addSystem(new Maps(this));   // los mapas (objetos) y la brújula
    this.route = this.addSystem(new Route(this));   // the marked route: a pin on the big map and the way to it (Plan J)
    this.marks = this.addSystem(new MapMarks(this));   // your own marks on the map, and your couple's
    this.places = this.addSystem(new Explore(this));
    this.caves = this.addSystem(new Caves(this));   // the caves and mines of now: the cave map, ropes, slopes, their ends, the refund of the old ones (src/caves.js)
    this.collection = this.addSystem(new Collection(this));
    this.nature = this.addSystem(new NatureBook(this));   // the nature book (src/nature.js, Plan G; after collection: its backfill reads it)
    this.achievements = this.addSystem(new Achievements(this));
    this.story = this.addSystem(new Story(this));
    this.steps = this.addSystem(new Steps(this));   // los primeros pasos
    this.playTime = this.addSystem(new PlayTime());   // how long this character has been played (src/playtime.js)
    this.recap = this.addSystem(new Recap(this));   // what was done this session, for the loading screen (after the statistics and the time played)
    this.live = this.addSystem(new Live(this));   // jugar juntos en directo
    this.social = this.addSystem(new Social(this));   // greeting and provoking people (Y or right click on someone)
    this.talk = this.addSystem(new Talk(this));   // talking to a neighbour: subtitles and a list of options (talk.js)
    this.remarks = this.addSystem(new Remarks(this));   // what the neighbours say about how you look (src/remarks.js; after social: it speaks through social.say)
    this.law = this.addSystem(new Law(this));   // the law: crimes, bounties, the constable and the cell (src/law.js; after neighbors and barrow)
    this.business = this.addSystem(new Business(this));   // the players' own shops and taverns (src/business.js; after neighbors, barrow and social)
    this.tables = this.addSystem(new TableGames(this));   // dice and tiles, with bets (src/tablegames.js; after neighbors, barrow and social)
    this.missions = this.addSystem(new Missions(this));   // the jobs, alone or in company (src/missions.js; after ranch, talk and live)
    this.rumours = this.addSystem(new Rumours(this));   // the places the neighbours tell you of (src/rumours.js; after places and talk)
    this.chatter = this.addSystem(new Chatter(this));   // the neighbours talking among themselves (src/chatter.js)
    this.travellers = this.addSystem(new Travellers(this));   // the travellers of the roads (src/travellers.js; after places, talk and rumours)
    this.money = 0;
    this.buffs = {};             // efectos de comida: { rapido: hasta cuándo, incansable: … }
    // Slow motion (see slowScale): timeScale, where it is now; timeScaleTarget, where it goes; simScale, what the last
    // steps really used (1 unless alone with the tab in sight: what the drawing uses for the bodies and the particles)
    this.timeScale = 1; this.timeScaleTarget = 1; this.simScale = 1;
    this.wheel = null;           // the tool wheel (main.js makes it: not on the server)
    this.needsBar = null;        // the status bars (main.js makes it: not on the server; src/ui/needsbar.js)
    this.minimap = null;         // the minimap and the compass strip (main.js makes it; src/ui/minimap.js)
    this.quick = null;           // the places near, M held (main.js makes it; src/ui/quickplaces.js)
  }

  resize() { this.view3d.resize(); }

  // ---------- sistemas ----------
  // Cada sistema puede tener: reset(save), save(out), update(dt), interact(player, scene), objects(scene),
  // entities(scene), hint(), onDay(day)…
  // Cada uno va aislado: si uno falla, los de detrás siguen (en el servidor, que no se paren los cultivos y los
  // animales de todos por un fallo de otra cosa) y se avisa (ver faults.js). Menos al cargar y al guardar: un sistema
  // que no se carga o no se guarda entero tiene que parar, antes que guardar a medias encima de lo bueno
  addSystem(sys) { this.systems.push(sys); return sys; }
  hook(name, ...args) {
    const strict = name === 'reset' || name === 'save';
    for (const s of this.systems) {
      const f = s[name];
      if (!f) continue;
      if (strict) f.apply(s, args);
      else try { f.apply(s, args); } catch (e) { reportFault(e, faultName(s, name)); }
    }
  }

  // ---------- partida ----------
  // deltas: cambios del jugador en el mundo, cargados de IndexedDB
  start(save, deltas = new Map()) {
    const owed = retireItems(save, deltas);
    // Solo hay un mundo. Una partida de antes, de otro mundo, pasa a este: lo construido se queda donde
    // estaba, pero se olvida lo que dependía de la naturaleza de aquel (lo talado, recogido y saqueado),
    // el mapa explorado y los lugares descubiertos
    const moved = save.seed !== undefined && save.seed !== WORLD_SEED;
    if (moved) {
      for (const [k, d] of deltas) if (!k.startsWith('u:')) Object.assign(d, { removed: {}, picked: {}, opened: {}, dived: {}, fished: {}, frostYear: {} });   // (dived: what was taken from the sea bed, dive.js)
      save = { ...save, explored: [], found: [], spotted: [], lookouts: {} };
    }
    setFamilyHouse(save.house?.family);   // (antes de hacer el pueblo: con la casa familiar, su jardín cambia)
    this.world = new Overworld(WORLD_SEED, deltas);
    this.world.onTouch = k => this.live.touched(k);
    if (moved) for (const k of deltas.keys()) this.world.dirty.add(k);   // que se guarde ya así
    this.world.clock = save.clock || 0;
    this.inv = new (weightMode() ? WeightInventory : Inventory)(save.inventory);   // (the weight one, unless ?inventario=casillas or on the world server: carry.js)
    if (!save.inventory) for (const [id, n, extra] of START_KIT) this.inv.add(id, n, extra);   // partida nueva: equipo inicial (extra: a full canteen's sips)
    this.invSpill = this.inv.spill;   // (materiales de muebles de antes que no han cabido: se dejan a los pies al empezar)
    // (las partidas de antes de la pala la reciben una vez: la marca pala va en lo guardado; si no cabe, a los pies)
    const shovel = !!save.inventory && !save.pala;
    if (shovel && this.inv.add('pala_hierro', 1)) this.invSpill.push(['pala_hierro', 1]);
    // (and the hammer, the same way: the mark is hammer, 2 once Nilo has told what it is for)
    const hammer = !!save.inventory && !save.hammer && !Profile.server;
    if (hammer && this.inv.add('hammer', 1)) this.invSpill.push(['hammer', 1]);
    this.hammerTold = !save.inventory || save.hammer === 2;
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
    this.ui = save.ui && typeof save.ui === 'object' ? save.ui : null;   // (the character's own of the interface: accent, its colour: ui/skin.js)
    this.house = { big: !!save.house?.big, family: !!save.house?.family, built: !!save.house?.built, v: save.house?.v ?? 1 };
    // Tu casa es parte del mundo. Si la partida aún no la tiene (es nueva, o de cuando la casa era una
    // habitación aparte), se levanta ahora; los muebles de aquella habitación pasan dentro.
    if (p.inside) { const [hx, hy] = this.homeSpot(); Object.assign(p, { inside: false, x: hx, y: hy, view: 'front', dir: null }); }
    const [sx, sy] = this.worldSpawn || [SPAWN.x, SPAWN.y];   // (un personaje nuevo, donde diga el mundo)
    this.player = new Player({ ...p, x: save.inventory ? p.x ?? sx : sx, y: save.inventory ? p.y ?? sy : sy });
    this.player.ghost = this.gamemode === 'spectator';
    this.player.onExert = n => this.combat.exert(n);   // (correr y saltar dan hambre)
    // (a jump costs stamina and delays its refill: needs.js; riding, the horse pays it, and a winded horse does not jump: horse.js)
    this.player.onJump = () => (this.player.mount ? this.horse.jumpSpend() : this.needs.spend(RATES.jump, true));
    this.player.canJump = () => !this.player.mount || this.horse.canJump();
    this.player.onRide = ev => this.horse.onRide(ev);   // (riding: a sliding stop, a refusal, a crash: horse.js)
    this.player.onLand = () => this.farm.trample(this.player);   // (caer de un salto sobre tierra labrada la deshace)
    this.player.onSplash = (x, y, n) => { this.gather.splash(x, y, n); Audio.splash(); };   // (al caer al agua o saltar de ella)
    hud.faces = { ...hud.faces, Nilo: NILO_LOOK, [this.player.name]: this.player.look };
    this.scene = this.world;
    this.underRoof = this.underGlass = false;
    if (owed.length && !Profile.server) { for (const [id, n] of owed) this.giveBack(id, n); hud.toast('La mesa de encantar ya no está en el juego: te devuelvo sus materiales', 'good'); }
    if (owed.iron && !Profile.server) hud.toast('Ahora todas las herramientas son de hierro: también las tuyas, con el desgaste que llevaban', 'good');
    if (owed.spell && !Profile.server) hud.toast('Los encantamientos ya no están en el juego: tus cosas siguen, pero sin ellos');
    if (hammer) hud.toast(t('toast.hammer'), 'good');
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
    // (sin el 'NaN,NaN' que apuntaban las escaleras de las cuevas cuando subían al faro por error, hasta 2026-11-11)
    this.explored = new Set((save.explored || []).filter(k => typeof k !== 'string' || !k.includes('NaN')));
    // (los iconos de lo que se lleva y de la comida, en ratos libres: ver icons.js)
    if (this.view3d !== NO_VIEW) prewarmIcons(() => this.inv.slots.filter(Boolean).map(s => s.id), itemIcon);
    this.lastChunk = null;
    this.placeName = this.placeSub = '';
    this.room = null;
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
      pala: 1, hammer: this.hammerTold ? 2 : 1, gamemode: this.gamemode, rules: this.rules, worldSpawn: this.worldSpawn, weatherLock: this.weatherLock, difficulty: this.difficulty, defaultGamemode: this.defaultGamemode, cam3d: camToSave(), volumes: Settings.volumes(), lang: savedLang(),
    };
    if (this.ui) out.ui = this.ui;
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
    this.barrow?.onMode(this.gamemode);   // (the spectator pushes nothing: parked where you are)
    this.cart?.onMode(this.gamemode);   // (nor drives a cart)
    this.carry?.onMode(this.gamemode);   // (creative and the spectator carry nothing in the arms)
  }
  // Lo que pide un op con un comando a este jugador (desde su juego o desde otro): llevarte a un sitio, darte
  // algo, matarte, ponerte dónde reaparecer o cambiarte el modo de juego. by: quién lo pide (null: tú)
  fromOp(m, by = null) {
    const said = text => { if (by) hud.toast(`${by} ${text}`, 'net'); };
    if (m.t === 'tp') { if (m.home ? this.teleportHome(true) : this.teleport(m.x, m.y, true)) said(`te ha teletransportado${m.home ? ' a casa' : ''}`); }
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
      out = `Fuera de tu mochila: ${n} ${m.id ? `× ${ITEMS[m.id]?.name.toLowerCase() || m.id}` : 'cosas'}`;
      said(`ha vaciado tu mochila (${n})`);
    } else if (m.t === 'effect') {
      if (m.give === 'curacion') { this.combat.heal(8); out = t('effect.healed'); }
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
      if (!BEDS.has(id)) { this.player.spawn = null; hud.toast('Tu cama ya no está: apareces en casa', 'warn'); return this.homeSpot(); }
    }
    return s ? [s[0], s[1]] : this.homeSpot();
  }
  bedSpawn(o) {
    const p = this.player, [tx, ty] = o.tile, s = p.spawn;
    if (s?.length === 4 && s[2] === tx && s[3] === ty) return;
    p.spawn = [Math.round(p.x * 100) / 100, Math.round(p.y * 100) / 100, tx, ty];
    hud.toast('Punto de reaparición: tu cama', 'good');
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
    const R = this.places?.look?.radius(p.x, p.y) ?? 2;   // (further from the high ground: lookout.js)
    for (let dy = -R; dy <= R; dy++) for (let dx = -R; dx <= R; dx++) this.explored.add(`${wrapIndex(cx + dx, CHUNK)},${cy + dy}`);
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
    this.coverJump();   // (al otro lado del planeta: todo es nuevo)
    hud.toast(`Has cruzado el polo ${north ? 'norte' : 'sur'}: sigues por el otro lado del planeta`);
  }
  // El espectador que sigue a alguien (/spectate) va donde va él (si deja de estar, o deja de ser espectador, se acaba)
  followSpectated() {
    const peer = this.live.others.find(x => x.id === this.spectating && x.playing), e = peer?.entity;
    if (this.gamemode !== 'spectator' || !peer) { this.spectating = null; return; }
    if (!e || peer.sc !== 'world') return;
    // (si el seguido salta lejos, o se empieza a seguir a alguien lejano, a oscuras como un /tp: si no, la cámara correría
    // hasta allí haciendo de paso todo lo de en medio)
    const far = Math.hypot(dxOf(e.x, this.player.x), e.y - this.player.y) > JUMP_COVER;
    this.player.x = e.x; this.player.y = e.y;
    if (far) this.coverJump();
  }
  // Nombre del lugar (pueblo o bioma) y coordenadas, con el pueblo en (0, 0)
  updatePlace() {
    const p = this.player;
    const sc = this.scene;
    const rooms = this.underRoof && sc === this.world, name = sc?.kind === 'grid' ? sc.name : this.underRoof ? this.houseName() : inBounds(p.x, p.y) ? 'Pueblo Brotes' : BIOMES[this.world.gen.biomeAt(p.x, p.y)].name;
    const sub = rooms ? this.roomNote(name) : '';   // (under the name: your house, if it names the room, and whether it is draughty)
    if (name !== this.placeName || sub !== this.placeSub) { hud.place(sub ? `${name} · ${sub}` : name, !!this.placeName); this.placeName = name; this.placeSub = sub; }
    hud.coords(p.inside ? null : [Math.round(p.x - CENTER.x), Math.round(p.y - CENTER.y)]);
    document.body.classList.toggle('indoors', this.indoors);
    document.body.classList.toggle('underground', sc?.kind === 'grid');
  }
  end() {
    try { this.barrow?.onEnd(); } catch (e) { reportFault(e, 'Barrow.onEnd'); }   // (pushing it: parked where you are, before leaving the shared world)
    try { this.cart?.onEnd(); } catch (e) { reportFault(e, 'Cart.onEnd'); }   // (driving one: the same)
    this.live.left();
    hud.log.clear();   // (what was said to this one)
    this.covers = (this.covers || 0) + 1;   // (un salto a oscuras a medias ya no destapa: ver coverJump)
    this.jumping = false; this.view3d.hold = false;
    this.talk.stop();
    this.player = null;
    this.scene = null;
    this.mode = 'menu';
    this.busy = false;
    hud.closeDialog();
    this.prompts.stop();
    hud.prompt(null);
  }

  // ---------- interacción ----------
  // Lo que se puede hacer con E aquí (text, run) y, a veces, algo más con X (alt: recoger un mueble)
  nearest() {
    const p = this.player;
    if (this.busy || this.talk.on || this.mode !== 'play' || !p || this.gamemode === 'spectator') return null;   // (el espectador no toca nada; talking, E is the talk's)
    const sc = this.scene;
    if (p.pose) return { text: t('pose.stand_up'), run: () => this.rest.stand() };
    if (this.barrow.pushing) return this.barrow.pushAction();   // (the hands on the wheelbarrow: barrow.js)
    if (this.cart.rec) return this.cart.driveAction();   // (on a cart's bench: a door, a neighbour, or getting down; cart.js)
    if (p.aboard) return this.traps.boatAction() || this.crew.action();   // (a buoy aimed at: traps.js)
    if (p.boat) return this.traps.boatAction() || this.crew.ownAction();   // (remando: E baja a tierra y amarra la barca)
    // Swimming: a moored boat first (crew.js, only near the surface); then, with a mouse, only the systems' targets the
    // cursor aims at (a find on the bed, fresh water to drink, a boat: kind 'sys'; never a bed, a chair, a chest or a door
    // on the bank); without one, the find in reach (dive.js) or a drink of the water here (needs.js)
    if (p.swim) {
      const r = this.crew.interact(p, sc); if (r) return r;
      if (this.mouse) { const aim = this.aimed(); return aim && aim.kind === 'sys' ? this.actionFor(aim) : this.needs.swimAction(p, sc); }
      return this.dive?.action?.(p, sc) || this.needs.swimAction(p, sc) || null;
    }
    // Con ratón, solo lo que se apunta con el cursor (a AIM_REACH casillas como mucho). Riding with nothing aimed: get off,
    // and X the saddlebags (horse.js action; anything aimed wins, as for every prompt)
    if (this.mouse) { const aim = this.aimed(); return aim ? this.actionFor(aim) : p.mount ? this.horse.action() : this.horselead.action(); }
    // Sin ratón (en pantalla táctil, sin cursor): lo que haya más cerca
    for (const s of this.systems) { let r; try { r = s.interact?.(p, sc); } catch (e) { reportFault(e, faultName(s, 'interact')); } if (r) return r; }
    const door = sc.doorNear?.(p.x, p.y), da = door && this.doorAction(door);
    if (da) return da;
    // Lo colocado, lo más cercano primero (la alfombra, al final: lo de encima, las puertas y las ventanas antes).
    // (lo fijo de las casas de los vecinos no se toca)
    const dist = o => (sc.placedDist ? sc.placedDist(o, p.x, p.y) : Math.hypot(o.x - p.x, o.y - p.y));
    const near = (sc.placedNear?.(p.x, p.y, 1.3) || []).filter(o => (!o.fixed || STATIONS[o.placed] || FIRE_MS[o.placed] || o.placed === 'signpost') && (!sc.reaches || sc.reaches(p.x, p.y, o.x, o.y))).sort((a, b) => dist(a) - dist(b));
    const o = near.find(o => o.layer !== 'rug');
    if (o) return this.inB(this.placedAction(o, true), o);
    const hearth = sc.hearthNear?.(p.x, p.y);
    if (hearth) return this.inB(this.hearthAction(hearth), { tile: hearth, placed: 'chimenea' });
    const win = sc.windowNear?.(p.x, p.y);
    if (win) return this.windowAction(win);
    const rug = near.find(o => o.layer === 'rug');
    return rug ? this.placedAction(rug) : p.mount ? this.horse.action() : this.horselead.action();   // (placedAction: la alfombra, o lo de una versión más nueva)
  }
  // Lo que se apunta con el ratón (a AIM_REACH casillas como mucho y, si está suelto, a la vista): lo primero que
  // corta el rayo, { kind, …, t }; o null (sin ratón sobre el juego, o sin apuntar a nada que se use)
  aimed() {
    const p = this.player, sc = this.scene, m = this.mouse;
    if (!m?.in || !sc || !p) return null;
    if (m.aimFrame === this.frameNo) return m.aim;
    m.aimFrame = this.frameNo; m.aim = null;
    const ray = this.rayNow();
    if (!ray) return null;
    const O = this.view3d.outliner;
    for (const c of this.aimTargets(p, sc)) {
      if (distTo(c.box, p.x, p.y) > AIM_REACH) continue;
      const g = c.box.abs ? 0 : this.view3d.groundY(sc, c.box.x, c.box.y);
      let t = rayHits(ray.o, ray.d, { ...c.box, y0: c.box.y0 + g, y1: c.box.y1 + g });
      if (t === null || (m.aim && t >= m.aim.t)) continue;
      // (the box only says it may be there: what has a shape is aimed at by its real triangles, see outline.js hit)
      if (c.exact && O) { const e = O.hit(c, sc, p, ray.o, ray.d); if (e === null) continue; if (e !== undefined) t = e; }
      if (!m.aim || t < m.aim.t) m.aim = { ...c, t };
    }
    return m.aim;
  }
  // Lo que se puede apuntar alrededor del jugador, cada cosa con su caja (girada, con alturas)
  // The camera ray under the mouse, cast once per frame (aimed and needs.waterAim share it), or null
  rayNow() {
    const m = this.mouse;
    if (!m?.in || !this.view3d?.rayAt) return null;
    if (m.rayFrame === this.frameNo && m.rayX === m.x && m.rayY === m.y) return m.ray;
    m.rayFrame = this.frameNo; m.rayX = m.x; m.rayY = m.y;
    return (m.ray = this.view3d.rayAt(m.x, m.y));
  }
  aimTargets(p, sc) {
    const out = [], R = AIM_REACH + 1, box = (x, y, hx, hy, y0, y1) => ({ ...aabb(x - hx, y - hy, x + hx, y + hy), y0, y1 });
    const sees = (x, y) => !sc.reaches || sc.reaches(p.x, p.y, x, y);
    // Lo colocado, a su tamaño y altura (las alfombras, a ras de suelo; los cuadros cuelgan del muro: no se miran a la vista)
    for (const o of sc.placedNear?.(p.x, p.y, R) || []) {
      if ((o.fixed && !STATIONS[o.placed] && !FIRE_MS[o.placed] && o.placed !== 'signpost' && !(TAVERN_SEATS.has(o.placed) && inTavern(o.x, o.y))) || (o.layer !== 'hang' && !sees(o.x, o.y))) continue;
      // (en el establo abierto se entra: sus paredes, por separado, y el tejado desde fuera)
      if (o.placed === 'establo' && o.model !== 'establo:shut') {
        const yaw = o.yaw ?? yawOf(o.rot), walls = solidsOf('establo').filter(s => s[1] < 1), roof = this.ranch.houseAround(p) === o ? [] : [[-2, 1.95, -1.5, 2, 3, 1.5]];
        for (const s of placeBoxes([...walls, ...roof], o.x, o.y, yaw)) out.push({ kind: 'placed', o, yaw, box: s });
        continue;
      }
      if (o.layer === 'rug') { out.push({ kind: 'placed', o, box: { ...(o.obb || aabb(o.fx[0], o.fy[0], o.fx[1], o.fy[1])), y0: 0, y1: 0.06 } }); continue; }
      let h = hull(vehicleSolids(o.placed) || solidsOf(o.model || o.placed));
      if (!isFinite(h[0])) h = [-0.45, 0, -0.45, 0.45, 0.1, 0.45];
      // (the box of what it draws, if it draws a model: then the ray goes against its real shape)
      const a = { kind: 'placed', o, yaw: o.yaw ?? yawOf(o.rot), box: placeBoxes([h], o.x, o.y, o.yaw ?? yawOf(o.rot))[0] }, mb = this.shapeBox(a, sc);
      if (mb) { a.box = mb; a.exact = true; }
      if (o.placed === 'rod_rest') { a.exact = false; a.box = { ...a.box, hx: Math.max(0.26, a.box.hx) }; }   // (two thin sticks: its box, and wider)
      out.push(a);
    }
    // Las puertas, las ventanas y el hogar (piezas de construcción)
    const cx = Math.floor(p.x / CHUNK), cy = Math.floor(p.y / CHUNK);
    if (sc.contentFor) for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) for (const o of sc.contentFor(cx + dx, cy + dy).objects) {
      if (!o.tile || Math.abs(o.x - p.x) > R || Math.abs(o.y - p.y) > R) continue;
      const [tx, ty] = o.tile, alongX = o.door ? o.door === 'x' : (o.mask & 3) || !(o.mask & 12);
      if (o.door) {
        // The doorway (open, it still offers to close) and the leaf as it is now: open, it stands inside, by the wall
        const y1 = o.gate ? 1 : 2.05, w = o.gate ? 0.5 : 0.46;
        out.push({ kind: 'door', tile: o.tile, box: alongX ? box(tx + 0.5, ty + 0.5, w, 0.12, 0, y1) : box(tx + 0.5, ty + 0.5, 0.12, w, 0, y1) });
        const leaf = this.view3d?.world?.doorLeaf?.(o.tile), lb = leaf && this.view3d.outliner?.liveBox(leaf);
        if (lb) out.push({ kind: 'door', tile: o.tile, box: lb, exact: true });
      }
      // (the window with its frame, sill and lintel; with open shutters, those too)
      else if (o.window) { const w = o.placed === 'ventana_contraventanas' && !sc.doorClosed?.(tx, ty) ? 0.7 : 0.45; out.push({ kind: 'window', tile: o.tile, box: alongX ? box(tx + 0.5, ty + 0.5, w, 0.2, 0.88, 2.16) : box(tx + 0.5, ty + 0.5, 0.2, w, 0.88, 2.16) }); }
      else if (o.hearth) { const a = { kind: 'hearth', tile: o.tile, o, yaw: o.yaw ?? yawOf(o.rot), box: box(o.x, o.y, 0.5, 0.5, 0, 1.4) }, mb = this.shapeBox(a, sc); if (mb) { a.box = mb; a.exact = true; } out.push(a); }
      // (las vallas no se apuntan: solo se quitan con Quitar en el modo construir, B)
    }
    // Lo de cada sistema: el tablón, las cuevas y los templos, los árboles con fruta, la barca de otro…
    for (const s of this.systems) {
      let more; try { more = s.aimables?.(p, sc, box); } catch (e) { reportFault(e, faultName(s, 'aimables')); }
      // (a model of its own, { name, x, y, yaw }: its box is the model's, and with exact the ray goes against it)
      if (more) for (const a of more) { a.sys = s; if (a.model) { const mb = this.shapeBox(a, sc); if (mb && !a.keepBox) a.box = mb; } out.push(a); }
    }
    // En primera persona, también las criaturas: se les pega a las que están en la cruceta
    if (CAM.first) for (const m of this.combat.monsters || []) if (sees(m.x, m.y)) { const fly = MONSTERS[m.type].fly, tall = m.type === 'esqueleto' ? 1.4 : 0.7; out.push({ kind: 'monster', e: m, box: box(m.x, m.y, 0.4, 0.4, fly ? 0.9 : 0, fly ? 1.7 : tall) }); }
    if (sc !== this.world) return out;
    // La gente, los animales y lo que se puede cosechar
    // (a person's box is as tall as the person drawn: the head is aimed at too)
    const who = (kind, e, r, y1, more) => out.push({ kind, e, ...more, box: box(e.x, e.y, r, r, 0, y1) }), tall = (e, y1) => this.view3d?.personHeight?.(e, y1) ?? y1;
    if (sees(this.world.nilo.x, this.world.nilo.y)) who('npc', this.world.nilo, 0.35, tall(this.world.nilo, 1.5), { n: null });
    for (const n of this.neighbors.people) if (!n.hidden && sees(n.x, n.y)) { if (n.asleep) who('npc', n, 0.55, 1, { n }); else who('npc', n, 0.35, tall(n, 1.5), { n }); }
    for (const [id, e] of this.family.ents) if (sees(e.x, e.y)) who('kid', e, e.lying ? 0.45 : 0.3, e.lying ? (e.h || 0) + 0.5 : tall(e, 1.1), { id });
    for (const a of this.ranch.animals) if ((!a.inside || this.ranch.stall(a)) && !a.rider && sees(a.x, a.y)) out.push({ kind: 'animal', e: a, box: bodyBox(a) });
    for (const w of this.wildlife.list) if (sees(w.x, w.y)) out.push({ kind: 'wild', e: w, box: bodyBox(w) });
    for (let ty = Math.floor(p.y) - 2; ty <= Math.floor(p.y) + 2; ty++) for (let tx = Math.floor(p.x) - 2; tx <= Math.floor(p.x) + 2; tx++) {
      const c = this.farm.cropAt(tx, ty);
      if (this.farm.takes(c)) out.push({ kind: 'crop', tile: [tx, ty], model: { name: this.farm.model(c), x: tx + 0.5, y: ty + 0.5, lift: sc.levelAt?.(tx + 0.5, ty + 0.5) || 0 }, box: box(tx + 0.5, ty + 0.5, 0.45, 0.45, 0, 0.7) });
    }
    return out;
  }
  // The box of what a draws, when it is a model (see outline.js modelBox), or null (no view: the server; or no model)
  shapeBox(a, sc) {
    const O = this.view3d?.outliner, m = O && O.modelOf(a, sc);
    return m ? O.modelBox(m) : null;
  }
  // Lo que se hace con lo apuntado (o null)
  actionFor(a) {
    switch (a.kind) {
      case 'placed': return this.inB((a.o.layer === 'placed' && !a.o.unknown && this.ranch.objectAction(a.o)) || this.placedAction(a.o), a.o);
      case 'door': return this.doorAction(a.tile);
      case 'window': return this.windowAction(a.tile);
      case 'hearth': return this.inB(this.hearthAction(a.tile), { tile: a.tile, placed: 'chimenea', own: !!this.scene.ownAt?.('placed', ...a.tile) });
      case 'npc': return this.neighbors.actionFor(a.n);
      case 'kid': return this.family.actionFor(a.id, a.e);
      case 'animal': return this.ranch.talk(a.e);
      case 'wild': return { text: kindName(a.e), run: () => Audio.blip() };
      case 'monster': return { text: MONSTERS[a.e.type].name, run: () => Audio.blip() };
      case 'crop': return this.farm.cropAction(...a.tile);
      // (lo de cada sistema, aislado como sus ganchos: si falla, no se puede usar eso, pero el resto se sigue viendo)
      case 'sys': try { return a.act(); } catch (e) { reportFault(e, a.sys ? faultName(a.sys, 'act') : 'apuntar'); return null; }
    }
    return null;
  }
  // Una puerta: se abre o se cierra (cerrarla con el jugador en el hueco lo dejaría atrapado: null). Cerrada y de
  // otro (de un vecino, o con alguien jugando contigo cerca), primero se llama
  doorAction(door) {
    // (nor on a wheelbarrow in the doorway: yours or another player's, barrow.js)
    const sc = this.scene, p = this.player, closed = sc.doorClosed(...door), inGap = Math.hypot(door[0] + 0.5 - p.x, door[1] + 0.5 - p.y) < 0.55 || (sc === this.world && !closed && !!this.barrow?.onDoor(door)), k = String(door);
    const gate = sc.pieceAt?.(...door)?.kind === 'gate';
    if (sc === this.world && this.law.locked(door)) return { text: t('law.locked'), run: () => Audio.error() };   // (the cell's, with somebody in it)
    if (!gate && closed && !(this.knocked?.k === k && this.time < this.knocked.until) && this.knockable(door)) return { text: 'Llamar a la puerta', run: () => this.knock(door) };
    // (la puerta de valla, como las vallas, solo se quita con Quitar en el modo construir, B)
    // (a little away, one walks up to it first and pushes or pulls it by hand: doorwalk.js; it swings when the hand gets there)
    if (closed || !inGap) return { text: `${closed ? 'Abrir' : 'Cerrar'} la puerta${gate ? ' de valla' : ''}`, run: () => this.doorWalk.use(door, () => { if (sc.doorClosed(...door) !== closed || (!closed && this.doorBlocked(door))) return; sc.toggleDoor(...door); Audio.place(); if (sc === this.world) this.wildlife.noise(door[0] + 0.5, door[1] + 0.5, EVENT.door); this.onSave?.(); }) };
    return null;
  }
  // (when the hand gets there: closing it, not on somebody in the gap now, nor on a wheelbarrow)
  doorBlocked(door) { const p = this.player; return (!!p && Math.hypot(door[0] + 0.5 - p.x, door[1] + 0.5 - p.y) < 0.55) || (this.scene === this.world && !!this.barrow?.onDoor(door)); }
  // Lo colocado: las estaciones se usan, en la cama te tumbas o duermes, en la silla te sientas, las luces se
  // apagan y se encienden, el cofre, el armario y la mochila se abren; lo demás se recoge (con X, lo que se usa
  // con E). hungFirst: si encima del mueble cuelga un cuadro, se recoge antes el cuadro (sin apuntar con el ratón)
  placedAction(o, hungFirst = false) {
    const sc = this.scene, save = () => this.onSave?.();
    if (o.unknown) return { text: UNKNOWN_NAME, run: () => Audio.error() };   // (de una versión más nueva: no se usa ni se recoge)
    if (o.layer === 'rug') return this.rugAction(o);
    if (o.placed === BARROW.ID) return this.barrow.parkedAction(o);   // (E pushes it, X opens it: barrow.js)
    if (o.placed === 'cart') return this.cart.parkedAction(o);   // (E: hitch, drive, unhitch; X opens it: cart.js)
    if (BULKY[o.placed]) return this.carry.placedAction(o);   // (a log, a carcass: carry.js)
    if (this.carry.held) { const c = this.carry.stationAction(o); if (c) return c; }   // (with it in the arms: saw it at the bench, butcher it at the kitchen)
    const hung = hungFirst && o.layer !== 'hang' ? [o.tile, ...extraTiles(o.placed, ...o.tile, o.rot)].map(t => [t, sc.ownAt?.('hang', ...t)]).find(([, v]) => v && ITEMS[v.split('@')[0]]) : null;
    const top = hung ? { tile: hung[0], layer: 'hang', placed: hung[1].split('@')[0] } : o;
    // (lo construido, al desmontarlo, devuelve sus materiales; and only in build mode, B › Remove: xTakes)
    const name = ITEMS[o.placed].name.toLowerCase(), pick = this.xTakes(top) ? { text: `${BUILDABLE[top.placed] ? 'Desmontar' : 'Recoger'} ${ITEMS[top.placed].name.toLowerCase()}`, run: () => this.pickUp(top) } : null;
    if (o.placed === 'rod_rest') return this.rodrest.action(o, pick);
    { const q = this.tables.tableAction(o); if (q) return q; }   // (what is on a table to play with: tablegames.js)
    if (STATIONS[o.placed]) return { text: `Usar ${name}`, run: () => this.onCraft?.(o.placed), alt: o.fixed ? null : pick };
    if (o.placed === 'cama' || o.placed === 'cama_nino' || o.placed === 'cama_doble') return { text: this.carry.dropFirst() || t('bed.use'), run: () => this.bed(o), alt: pick };   // (with something in the arms: put it down first, carry.js)
    if (o.placed === 'silla' || o.placed === 'taburete' || o.placed === 'sofa' || o.placed === 'sillon' || o.placed === 'barber_chair' || o.placed === 'pew') return { text: this.carry.dropFirst() || 'Sentarse', run: () => this.rest.sit(o), alt: o.fixed ? null : pick };
    // (the bathroom, Plan E §4.1: E on the tub takes a bath, body.js; E on the basin asks: wash, or the mirror as before,
    // ui/menus.js onBasin)
    if (o.placed === 'banera') return { text: this.carry.dropFirst() || t(this.body.hasSoap() && this.gamemode === 'survival' ? 'body.bath.soap' : 'body.bath'), run: () => this.body.bathe(o), alt: pick };
    // (no dropFirst here: the mirror still works with full arms; the wash itself refuses them, menus.js)
    if (o.placed === 'lavabo') return { text: this.onBasin && this.body && !this.body.off?.surface ? t('body.basin.use') : t('body.mirror'), run: () => (this.onBasin ? this.onBasin(o) : this.onMirror?.()), alt: pick };   // (onBasin: ui/menus.js asks wash or mirror)
    if (FIRE_MS[o.placed]) return this.fireAction(o, o.fixed ? null : pick);
    if (o.placed === 'signpost' && sc === this.world) return this.places.roadside.action(o, pick);
    if (o.placed === 'bell_frame') return { text: t('bell.ring'), run: () => Audio.bell?.() ?? Audio.clink(), alt: pick };
    if (BIZ_THINGS.has(o.placed)) return this.business.action(o, o.fixed ? null : pick);   // (a counter, a shelf or a crate: business.js)
    if (wellSpec(o.placed)) return this.farm.wellAction(o, o.fixed ? null : pick);   // (E: llenar la regadera; X: desmontarlo. The big well too)
    if (CHESTS[o.placed] && o.placed !== 'mochila') return { text: `Abrir ${CHESTS[o.placed][1]}`, run: () => this.onChest?.(sc.chestAt(...o.tile), o.tile), alt: pick };   // (lleno no se recoge: hay que vaciarlo antes)
    if (o.placed === 'mochila') return { text: 'Abrir la mochila', run: () => this.onChest?.(sc.chestAt(...o.tile) || [], o.tile), alt: { text: this.inv.equip.espalda ? 'Recoger la mochila' : 'Ponerse la mochila', run: () => this.takeBackpack(o) } };
    if (LIGHTS.has(o.placed)) return { text: `${o.off ? 'Encender' : 'Apagar'} ${name.replace(/^lámpara/, 'la lámpara').replace(/^antorcha/, 'la antorcha').replace(/^vela/, 'la vela').replace(/^candelabro de techo/, 'el candelabro').replace(/^farol/, 'el farol')}`, run: () => { sc.toggleLight(...o.tile); Audio.blip(); save(); }, alt: pick };
    return pick;
  }
  // What is built (furniture, stations, the Rancho's, the outdoor things, the pieces: BUILDABLE, or a piece that is no item) is
  // taken down only in build mode, with B › Remove; X still picks up what is an item (a lamp, a candle, a picture, a rug…)
  builtThing(id) { return !!(BUILDABLE[id] || (PIECES[id] && !ITEMS[id])); }
  xTakes(o) { return !!this.build?.on || !this.builtThing(o?.placed); }
  // act, for something built of one's own aimed at outside build mode: where X took it down, a row saying how (ui/prompts.js,
  // act.inB); where nothing else is done with it, just its name
  inB(act, o) {
    if (this.build?.on || !o || o.fixed || o.unknown || !this.builtThing(o.placed) || act?.alt) return act;
    if (o.own === false || (this.scene === this.world && o.tile && !o.yard && !this.world.ownAt?.(o.layer || 'placed', ...o.tile) && this.build.lived?.(o.tile))) return act;
    if (!act) { const n = ITEMS[o.placed]?.name || ''; act = { text: n.charAt(0).toUpperCase() + n.slice(1), run: () => Audio.blip() }; }
    act.inB = true;
    return act;
  }
  // A fire one has built (a campfire, a brazier, a charcoal clamp): E lights it, with its fuel; X takes it down (in build mode)
  fireAction(o, pick) {
    const lit = this.world.fireAt(...o.tile), [m, n] = FIRE_FUEL[o.placed];
    if (lit) return { text: t('fire.burning'), run: () => {}, alt: pick };
    return { text: t('fire.light_with', { n, item: ITEMS[m].name.toLowerCase() }), run: () => this.lightFire(() => { const [tx, ty] = o.tile, d = this.world.delta(Math.floor(tx / CHUNK), Math.floor(ty / CHUNK), true); (d.fire ||= {})[`${tx},${ty}`] = Date.now() + FIRE_MS[o.placed]; this.world.touchAround(tx, ty); }, m, n), alt: pick };
  }
  // …whatever it is: what it takes, from the bag, and it burns (done: what notes it)
  lightFire(done, m = 'madera', n = 1) {
    if (this.gamemode !== 'creative' && this.inv.count(m) < n) { this.gather.float(t('fire.needs', { n, item: ITEMS[m].name.toLowerCase() }), '#ffb0a0'); Audio.error(); return; }
    if (this.gamemode !== 'creative') this.inv.remove(m, n);
    done();
    Audio.noiseHit(900, 0.25, 0.25);
    this.onSave?.();
  }
  // El fuego del hogar (el de los vecinos no se recoge)
  hearthAction(hearth) {
    const sc = this.scene, off = sc.lightOff(...hearth), mine = !!sc.ownAt?.('placed', ...hearth), save = () => this.onSave?.();
    return { text: off ? 'Encender el fuego' : 'Apagar el fuego', run: () => { sc.toggleLight(...hearth); Audio.noiseHit(off ? 900 : 300, 0.25, 0.25); save(); }, alt: mine && this.xTakes({ placed: 'chimenea' }) ? { text: 'Recoger el hogar', run: () => { if (this.pickUp({ tile: hearth, layer: 'placed', placed: 'chimenea' })) save(); } } : null };
  }
  // Una ventana: se abre o se cierra (con contraventanas, por fuera; sin ellas, con postigos por dentro)
  windowAction(win) { const sc = this.scene, closed = sc.doorClosed(...win); return { text: closed ? 'Abrir la ventana' : 'Cerrar la ventana', run: () => { sc.toggleDoor(...win); Audio.door(); this.onSave?.(); } }; }
  // La alfombra: con X se recoge (con E no, para no llevársela sin querer)
  rugAction(rug) { return { text: `${ITEMS[rug.placed].plain || ITEMS[rug.placed].name} de ${rug.rug.w}×${rug.rug.h}`, run: () => Audio.blip(), alt: { text: 'Recoger', run: () => { if (this.pickUp(rug)) this.onSave?.(); } } }; }
  // La cama: tumbarse (sin dormir), dormir o, en la doble, lo de la familia
  async bed(o) {
    if (this.carry.refuse()) return;
    this.bedSpawn(o);   // (como en Minecraft: usar la cama la hace tu punto de reaparición)
    if (o.placed === 'cama_doble') return this.family.bed(o);
    this.busy = true;
    const pick = await hud.ask(this.player.name, t('bed.q'), [t('bed.lie'), t('bed.sleep'), t('bed.nothing')]);
    this.busy = false;
    if (pick === 0) this.rest.lie(o);
    if (pick === 1) this.sleep(o);
  }
  // Llamar a una puerta cerrada: suena para todos los de cerca; si es de un vecino y está en casa, contesta
  knockable(door) {
    if (this.vecinoAt(door)) return true;
    return [...(this.live.peers?.values() || [])].some(q => q.entity && q.sc === 'world' && Math.hypot(q.entity.x - door[0], q.entity.y - door[1]) < 10);
  }
  vecinoAt([tx, ty]) { return Object.entries(HOUSES).find(([, h]) => houseStands(h) && tx === h.x0 + 6 && ty === h.y1 - 1)?.[0] || null; }   // (la puerta: en x0+6, en la fila de abajo)
  knock(door) {
    const g = this, house = this.vecinoAt(door), h = this.days.hour;
    this.knocked = { k: String(door), until: this.time + 8 };
    Audio.knock();
    this.live.knock?.(door);
    if (!house) return;
    const home = this.neighbors.people.filter(n => n.def.home === house && n.atHome);
    setTimeout(() => {
      if (!home.length) { g.gather.float('No contesta nadie…', '#d8c3a0'); return; }
      const who = home[0].def.name;
      if (h >= 22 || h < 7) { g.gather.float(`${who} (desde dentro): ¡Son horas de dormir! Vuelve mañana`, '#fff3c0'); g.rep.knockNight(door, h); return; }
      g.gather.float(`${who}: ¡Voy! … ¡Pasa, pasa!`, '#fff3c0');
      if (this.scene.doorClosed(...door)) { this.scene.toggleDoor(...door); Audio.door(); }
    }, 900);
  }
  // X: lo segundo que se puede hacer aquí (recoger lo que se usa con E)
  // (X: at once, or, if it has to be held, from now on: ui/prompts.js; altRelease, letting go of it)
  altAction() {
    if (this.mode === 'play' && this.fishing.holdX()) return;
    const act = this.nearest()?.alt;
    if (act?.hold) this.prompts.start(act); else act?.run();
  }
  altRelease() { this.prompts.stop(); }
  // Tirar al suelo lo que se lleva en la mano (uno, o el montón entero)
  toss(all = false) {
    if (this.barrow.pushing) { if (this.mode === 'play' && !this.busy) this.barrow.park(this.barrow.stuckFor() > 2 ? 'q' : false); return; }   // (Q parks the wheelbarrow; stuck in something for 2 s, further away: barrow.js park)
    if (this.carry.held) return this.carry.drop();   // (Q puts down what the arms carry: carry.js)
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
      // (the weight inventory: to its list, whatever it already carried in its slots past the hotbar)
      if (inv.weight) inside.forEach(s => { if (s && ITEMS[s.id]) inv.add(s.id, s.n, extraOf(s)); else if (s) inv.kept.push({ i: -1, s }); });
      else inside.forEach((s, j) => { if (s && ITEMS[s.id]) inv.slots[HOTBAR + j] = s; else if (s) inv.kept.push({ i: HOTBAR + j, s }); });   // (lo de una versión más nueva, apartado: ver Inventory)
      inv.changed();
      Audio.pickup();
      this.onSave?.();
      return;
    }
    if (full) { this.gather.float(t('gui.inventory.bag_have_one'), '#ffb0a0'); Audio.error(); return; }
    this.pickUp(o);
  }
  // Dejar en el suelo, delante, la mochila que llevas puesta, con todo lo que lleve dentro
  dropBackpack() {
    const p = this.player, sc = this.scene, inv = this.inv;
    if (!p || !inv.equip.espalda) return t('gui.inventory.no_bag');
    const tx = Math.floor(p.x + p.face.x * 1.1), ty = Math.floor(p.y + p.face.y * 1.1);
    if (!sc.canPlace?.(tx, ty, 'mochila', p)) return t('gui.inventory.no_room_bag');
    const list = inv.weight ? inv.listSlots() : null;   // (the weight inventory: its list, if it fits in the 27 of the backpack)
    if (list && list.length > 27) return t('gui.inventory.bag_too_full');
    sc.place(tx, ty, 'mochila', 0);
    const chest = sc.chestAt(tx, ty);
    if (list) { list.forEach((i, j) => { chest[j] = inv.slots[i]; }); inv.slots.length = HOTBAR; }
    else for (let j = 0; j < 27; j++) { chest[j] = inv.slots[HOTBAR + j] || inv.takeKept(HOTBAR + j) || null; inv.slots[HOTBAR + j] = null; }   // (lo apartado que iba en ella, también)
    delete inv.equip.espalda;
    inv.changed();
    sc.chestTouched(tx, ty);
    Audio.place();
    this.onSave?.();
    return null;
  }
  // Sleep (in bed o, which you lie down in first; null: where you are). needs.js: refusals, the day nap, the fade, rest
  sleep(o = null) { return this.needs.sleep(o); }
  // Devolver a la mochila algo colocado
  // carry: lo coge el modo construir para moverlo (no devuelve nada: se deja en otro sitio)
  pickUp(o, carry = false) {
    if (o.fixed && !o.yard && !o.build) return false;
    if (this.scene === this.world && o.tile && !this.world.ownAt(o.layer || 'placed', o.tile[0], o.tile[1]) && this.build.lived(o.tile)) return false;   // (of a place where somebody lives)
    const held = this.business?.protects(o) || this.tables?.protects(o);   // (what a business uses: business.js; a table with a game on it: tablegames.js)
    if (held) { this.gather.float(held, '#ffb0a0'); Audio.error(); return false; }
    // (a log or a carcass, taken with B › Remove or X: its parts, as with the slot inventory; it is never moved. carry.js)
    if (BULKY[o.placed]) { const wait = this.carry.notYours(o); if (wait) { this.carry.say(wait); Audio.error(); return false; } if (carry || this.scene.unplace(o) === false) return false; this.carry.forget(o.tile); this.carry.giveParts(o.placed); Audio.pickup(); return true; }   // (lo que venía puesto no se recoge sin querer: solo la valla de tu jardín y, en modo construir, todo)
    // Lo que se construye (las piezas, como la valla, y los muebles y las estaciones) no vuelve a la mochila: devuelve
    // sus materiales
    const B = BUILDABLE[o.placed] || (PIECES[o.placed] && !ITEMS[o.placed] ? PIECES[o.placed] : null);
    // (a wheelbarrow with stacks or big things on it is not taken down nor moved: barrow.js)
    if (o.placed === BARROW.ID && this.barrow.loaded(o.tile)) { this.gather.float(t('barrow.empty_first'), '#ffb0a0'); Audio.error(); return false; }
    if (o.placed === 'cart' && (this.barrow.loaded(o.tile) || this.cart.hitched(o.tile))) { this.gather.float(t(this.cart.hitched(o.tile) ? 'cart.unhitch_first' : 'cart.empty_first'), '#ffb0a0'); Audio.error(); return false; }
    // (una alfombra vuelve como la del telar de su tamaño; las de antes, de cualquier tamaño, se ponían con V)
    const r = o.layer === 'rug' && o.rug, id = r ? rugId(ITEMS[o.placed].rug || o.placed, RUG_MADE.find(([w, h]) => (w === r.w && h === r.h) || (w === r.h && h === r.w)) || [1, 1]) : o.placed;
    if (!B && this.inv.room(id) < 1) { this.gather.float('No te cabe: no llevas sitio libre', '#ffb0a0'); Audio.error(); return false; }
    if (this.scene === this.world && !machineEmpty(machineAt(this.world, o.tile))) { this.gather.float(`Vacía ${MACHINES[o.placed]?.the || 'la máquina'} antes`, '#ffb0a0'); Audio.error(); return false; }
    if (CHESTS[o.placed] && o.placed !== 'mochila' && this.scene.chestAt(...o.tile)?.some(Boolean)) { this.gather.float(`Vacía ${CHESTS[o.placed][1]} antes`, '#ffb0a0'); Audio.error(); return false; }
    // (a compost bin with something in it is not moved; taken down, what is in it falls out: the compost, or what had not
    // rotted yet. The manure of an animal house is left on the ground)
    const spill = this.scene === this.world && (o.layer || 'placed') === 'placed' && o.tile ? this.ranch.spillOf(o) : null;
    if (spill && carry && (o.placed === 'compost_bin' || o.placed === 'scarecrow')) { this.gather.float(t(o.placed === 'scarecrow' ? 'farm.scarecrow.undress_first' : 'farm.compost.empty_first'), '#ffb0a0'); Audio.error(); return false; }
    // (whose it was, before it goes: what came with a neighbor's house, or what you had put back there yourself)
    // (the hearth, whose chimney holds the roof: not while it does; structure.js)
    if (PIECES[o.placed] && o.tile && this.build.holds({ tile: o.tile, layer: o.layer || 'placed' })) { this.gather.float(t('build.why.holds_roof'), '#ffb0a0'); Audio.error(); return false; }
    const W = this.scene === this.world && o.tile && o.layer ? this.world : null, own = W && (!W.ownAt || !!W.ownAt(o.layer, o.tile[0], o.tile[1]));
    // (a watchtower: not while you are in it; of one that is not new, only a part comes back, as of the pieces: build.js)
    const tall = watchtower(o.placed), back = tall ? this.build.backOf({ layer: 'placed', tile: o.tile }, o.placed) : B?.cost;
    if (tall && this.player?.tower?.key === `w:${o.tile}`) { this.gather.float(t('why.watchtower.inside'), '#ffb0a0'); Audio.error(); return false; }
    if (this.scene.unplace(o) === false && B) return false;
    if (spill) this.gather.throwOut(...spill);
    if (!B) this.inv.add(id, 1);
    else if (!carry) for (const [m, n] of back) { const left = this.inv.add(m, n); if (left) this.gather.throwOut(m, left); }
    // (from a neighbor's house the village notices; taking again what you had given back costs again: reputation.js.
    // Here and not only in B › Remove, so picking it up with X or moving it with B › Move counts the same)
    if (W) this.rep?.taken(o.layer, o.tile[0], o.tile[1], own, id);
    Audio.pickup();
    return true;
  }
  action() {
    if (hud.dialogOpen) return hud.next();
    if (this.talk.on) return this.talk.press();
    if (this.mode === 'play' && this.fishing.keep()) return;   // (a fish in the hands: it goes in the backpack)
    this.nearest()?.run();   // (what the arms carry is only put down with Q: carry.js)
  }
  // What Nilo has to tell before anything else (talk.js): how the game starts, or, in a game of before the hammer, what it is
  // for, once. { lines, first, after() }, or null
  niloTells() {
    const first = !this.craft.taught.has('banco');
    if (!first && (this.hammerTold || !this.plans.on)) return null;
    return { first, lines: first ? tList('npc.nilo.first').map(l => formatMessage(l, { name: this.player.name })) : tList('npc.nilo.hammer'),
      after: () => { if (first) this.craft.teach('banco'); this.hammerTold = true; } };
  }
  // Nilo amplía la casa del pueblo a cambio de materiales
  async offerReform() {
    const cost = [['tablas', 40], ['piedra', 30]], ok = cost.every(([id, n]) => this.inv.count(id) >= n);
    const pick = await hud.ask('Nilo', t('npc.nilo.reform'), ok ? [t('npc.nilo.reform.yes'), t('npc.nilo.not_now')] : [t('npc.nilo.later')]);
    if (!ok || pick !== 0) return;
    for (const [id, n] of cost) this.inv.remove(id, n);
    this.house.big = true;
    this.layHouse(true, false);
    await hud.say('Nilo', [t('npc.nilo.reform.done')]);
    this.onSave?.();
  }
  // Nilo convierte la casa ampliada en la casa familiar: más grande, con dormitorio, cuarto de los niños, baño,
  // cocina y salón (los muebles, de cada uno)
  async offerFamily() {
    const cost = [['tablas', 80], ['piedra', 60], ['lingote_hierro', 6]], ok = cost.every(([id, n]) => this.inv.count(id) >= n);
    const pick = await hud.ask('Nilo', t('npc.nilo.family'), ok ? [t('npc.nilo.family.yes'), t('npc.nilo.not_now')] : [t('npc.nilo.later')]);
    if (!ok || pick !== 0) return;
    for (const [id, n] of cost) this.inv.remove(id, n);
    this.house.family = true;
    setFamilyHouse(true);
    this.world.rebuildVillage();   // (los árboles y arbustos que había donde va la casa ya no están)
    this.layHouse('family', false);
    await hud.say('Nilo', [t('npc.nilo.family.done')]);
    this.onSave?.();
  }
  // Tu casa: su tamaño (false, true o 'family') y su solar
  get houseSize() { return this.house.family ? 'family' : !!this.house.big; }
  houseRect() { return this.house.family ? HOUSE_FAMILY : this.house.big ? HOUSE_BIG : HOUSE; }
  // ¿Está el jugador a cubierto? En una cueva o bajo un tejado del mundo
  get indoors() { return !!(this.player?.inside || this.underRoof); }
  // Nombre de la casa en la que está el jugador
  houseName() {
    const p = this.player, own = inOwnHouse(p.x, p.y), room = this.roomName(own);
    if (room) return room;
    if (own) return t('place.your_house');
    for (const h of Object.values(HOUSES)) if (houseStands(h) && p.x > h.x0 && p.x < h.x1 && p.y > h.y0 && p.y < h.y1) return `Casa de ${h.name}`;
    if (inTavern(p.x, p.y)) return 'La taberna';
    if (inChapel(p.x, p.y)) return t('place.chapel');
    if (inLawOffice(p.x, p.y)) return t('place.law_office');
    return t('place.under_roof');
  }
  // The room by what is in it (structure.js roomAt): only in your house or in one that was built (its roof came with neither
  // the village nor an aldea). With nothing that says what it is (a shed, a barn), null
  roomName(own) {
    const r = this.room, p = this.player;
    if (!r?.kind || !(own || this.world.ownAt('roof', Math.floor(p.x), Math.floor(p.y)))) return null;
    if (r.kind === 'porch') return t('room.porch');
    if (this.underGlass && !r.bed && !r.kitchen && !r.bath) return t('room.greenhouse');
    return r.bed ? t('room.bedroom') : r.kitchen ? t('room.kitchen') : r.bath ? t('room.bathroom') : r.living || own ? t('room.living') : null;
  }
  // (why there is a draught in a room that is shut: the roof leaks, or its walls have worn. wear.js)
  draught() { const r = this.room; return t(r.base === 'room' ? (r.leaky && this.wear.raining ? 'room.leaks' : 'room.worn') : 'room.draughty'); }
  roomNote(name) {
    const p = this.player, mine = inOwnHouse(p.x, p.y), own = mine ? t('place.your_house') : '';
    const air = this.room?.kind === 'draughty' && (mine || this.world.ownAt('roof', Math.floor(p.x), Math.floor(p.y))) ? this.draught() : '';
    return own && air ? `${own} · ${air}` : (own !== name && own) || air;
  }
  // La casilla de dentro de tu casa, junto a la puerta (donde despiertas si te rescatan)
  homeSpot() {
    const H = this.houseRect(), [dx, dy] = doorTile(H.x0, H.y0, this.houseSize);
    return [dx + 0.5, dy - 0.5];
  }
  // Llevar al jugador a un sitio del mundo de fuera (/tp): sale de la cueva si está en una, se levanta y, si allí
  // no hay agua, se baja de la barca (a caballo, va con él). cover: si es lejos, a oscuras (ver coverJump); sin él, de
  // golpe (las pruebas y el banco, que miran la vista justo después)
  teleport(x, y, cover = false) {
    const p = this.player;
    if (!p || !this.world || !Number.isFinite(x) || !Number.isFinite(y)) return false;
    x = wrapX(x); y = Math.max(NORTH + 1, Math.min(SOUTH - 1, y));   // (dentro del planeta)
    if (this.barrow?.pushing) this.barrow.park(true);   // (the wheelbarrow stays where you were)
    if (this.cart?.rec) this.cart.getDown(true);   // (and the cart, with its horse)
    if (cover) this.law?.freed();   // (an op takes you out of the cell)
    const far = this.scene !== this.world || Math.hypot(dxOf(x, p.x), y - p.y) > JUMP_COVER;
    if (p.pose) this.rest.stand();
    if (this.scene !== this.world) { this.scene = this.world; p.inside = false; }
    if (p.boat && !this.world.water(x, y) && !this.crew.hasMate()) this.world.moorBoat(p.x, p.y, 0);   // (te llevan a tierra remando: la barca se queda amarrada donde estabas)
    Object.assign(p, { x, y, vx: 0, vy: 0, z: 0, vz: 0, boat: (p.boat || !!p.aboard) && !!this.world.water(x, y), aboard: null });
    if (cover && far) this.coverJump(); else this.view3d.snap();
    this.updatePlace();
    return true;
  }
  teleportHome(cover = false) { const [x, y] = this.homeSpot(); return this.teleport(x, y, cover); }
  // Un salto lejos (/tp, lo que manda el servidor, cruzar un polo): a oscuras, como al entrar en una cueva. Lo de allí (el
  // suelo, los trozos, los árboles, los programas de sombreado) se hace tapado y por tandas (ver engine.js, whenReady), en
  // vez de un fotograma de más de un segundo con la imagen parada. Mientras se funde a negro, la vista se queda con la
  // última imagen (hold): si no, la cámara iría corriendo hasta allí, haciendo de paso todo lo de en medio. El jugador ya
  // está allí (para el juego y la red): solo espera la vista. Otro salto mientras tanto solo cambia adónde
  // (covers: cuántas veces otro ha tapado la pantalla por su cuenta, al morir o al salir de la partida; si pasa a medias,
  // destapa quien tapó después, no este salto). jumping: el número del salto en marcha (al salir de la partida se olvida:
  // el de una partida vieja no estorba al primero de la nueva). Mientras, a ciegas, el jugador se queda quieto (ver update)
  // y no se abren la pausa ni el mapa (no se verían: ver menus.js)
  async coverJump() {
    const v = this.view3d;
    if (!v.whenReady || this.jumping) { v.snap(); return; }
    const mine = (this.covers = (this.covers || 0) + 1);
    this.jumping = mine;
    try {
      v.hold = true;
      await hud.fade(true);
      if (this.jumping !== mine) return;   // (se ha salido de la partida mientras se fundía)
      this.body?.applyGrowth();   // (hair and beard grown: only where it does not show, body.js §2.5)
      v.hold = false;
      v.snap();
      await v.whenReady(1500);
    } finally { if (this.jumping === mine) { v.hold = false; this.jumping = false; } }
    if (this.covers === mine) await hud.fade(false);
  }
  // Llevar al jugador adonde reaparece (cuando cae en combate): su punto (/spawnpoint) o su casa
  goHome() {
    const [x, y] = this.respawnSpot();
    Object.assign(this.player, { inside: false, x, y, view: 'front', dir: null, boat: false, aboard: null, mount: false });
    this.scene = this.world;
    this.updatePlace();
  }
  // Devuelve algo a la mochila; si no cabe, al suelo
  giveBack(id, n = 1, from) {   // (from: la casilla de donde sale, para que la ropa conserve su color)
    if (!knownItem(id)) { this.inv.keepUnknown({ ...from, id, n }); return; }   // (de una versión más nueva: en el suelo se perdería; se guarda aparte, ver Inventory)
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
      const [cid, rot] = parsePlaced(cur), o = { tile: [tx, ty], layer: 'placed', placed: cid };
      // (de una versión más nueva: no se sabe si es un cofre o una máquina. Se cambia de sitio tal cual, con lo que guarde
      // dentro; sin sitio, a la mochila (apartado: ver Inventory) y lo de dentro de un cofre, a la mochila también)
      if (!knownItem(cid)) {
        const k0 = `${tx},${ty}`, d0 = w.delta(Math.floor(tx / CHUNK), Math.floor(ty / CHUNK)), spot = this.freeTile(H, dx, dy);
        const inside = Object.fromEntries(['chest', 'machine', 'incub'].filter(l => d0?.[l]?.[k0] !== undefined).map(l => [l, d0[l][k0]]));
        w.unplace(o);
        for (const l in inside) delete d0[l][k0];
        if (spot) { w.place(spot[0], spot[1], cid, rot); const d1 = w.delta(Math.floor(spot[0] / CHUNK), Math.floor(spot[1] / CHUNK), true); for (const l in inside) (d1[l] ||= {})[`${spot[0]},${spot[1]}`] = inside[l]; return; }
        for (const it of Array.isArray(inside.chest) ? inside.chest : []) if (it?.id) this.giveBack(it.id, it.n || 1, it);
        this.inv.keepUnknown({ id: cid, n: 1 });
        return;
      }
      const items = CHESTS[cid] ? w.chestAt(tx, ty) : null;
      // (a wheelbarrow: its id and big things too, read before unplace takes them away; with only big things it is not empty)
      const wb = cid === BARROW.ID || cid === 'cart' ? w.delta(Math.floor(tx / CHUNK), Math.floor(ty / CHUNK))?.barrow?.[`${tx},${ty}`] : null, loads = (wb?.l || []).filter(e => BULKY[e?.[0]]);
      w.unplace(o);
      if (items?.some(Boolean) || loads.length) {
        const spot = this.freeTile(H, dx, dy);
        if (spot) {
          w.place(spot[0], spot[1], cid);
          const d1 = w.delta(Math.floor(spot[0] / CHUNK), Math.floor(spot[1] / CHUNK)), k1 = `${spot[0]},${spot[1]}`;
          d1.chest[k1] = items;
          if (wb) (d1.barrow ||= {})[k1] = { id: wb.id || 't' + k1, l: loads, ...(wb.o && { o: wb.o }) };   // (a cart keeps its owner; its horse is unhitched)
          return;
        }
        for (const it of items || []) if (it) this.giveBack(it.id, it.n, it);
        for (const [id, day, cq] of loads) this.carry.toShore([id, Profile.id || 'me', day ?? null, dx + 0.5, dy + 1.5, 0, cq], dx + 0.5, dy + 1.5);   // (on the ground in front of the door, out of where the walls go; with no room, its parts to the backpack)
      }
      // (lo construido, como al desmontarlo: sus materiales; ver pickUp. Un pozo en un hoyo del jardín, por ejemplo)
      const B = BUILDABLE[cid] || (PIECES[cid] && !ITEMS[cid] ? PIECES[cid] : null);
      if (B) { for (const [m, n] of B.cost) this.giveBack(m, n); } else this.giveBack(cid, 1);
    };
    // (lo cavado o apilado en el jardín donde va la casa, y delante de su puerta, se allana: la casa va a ras del suelo del
    // pueblo. Lo que hubiera puesto en un hoyo vuelve a la mochila)
    // (a big well that takes the tile from its anchor in the next one goes too: see scenes.js, wellOf)
    for (let ty = H.y0; ty <= H.y1; ty++) for (let tx = H.x0; tx < H.x1; tx++) if ((ty < H.y1 || tx === dx) && w.digH(tx, ty) !== null) { const wa = w.wellOf(tx, ty); if (wa && (wa.tx !== tx || wa.ty !== ty)) clear(wa.tx, wa.ty); clear(tx, ty); w.digReset(tx, ty); }
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
    if (this.barrow?.pushing) this.barrow.park(true);   // (into a cave or out of it: the wheelbarrow stays where you were)
    if (this.cart?.rec) this.cart.getDown(true);   // (and the cart)
    this.busy = true;
    this.player.stop();
    if (sound) Audio.door();
    await hud.fade(true);
    this.body?.applyGrowth();
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
    // (solo cambia con la ropa puesta y su color, con la etapa de su desgaste y con lo crecidos que estén el pelo y la barba
    // (body.applied); lo gastada que esté la armadura no rehace el muñeco)
    const L = this.looked, grow = this.body.applied;
    if (L && L.v === this.inv.v && L.base === this.player.look && L.hair === grow.hair && L.beard === grow.beard) return L.look;
    const key = Object.entries(this.inv.equip).map(([k, it]) => `${k}:${it.id}:${it.color}:${wearStage(k, it)}`).sort().join('|') + `|g${grow.hair}${grow.beard}`;
    if (L?.key !== key || L.base !== this.player.look) this.looked = { key, base: this.player.look, look: dressed(this.player.look, this.inv.equip, grow), hair: grow.hair, beard: grow.beard };
    this.looked.v = this.inv.v;
    return this.looked.look;
  }
  // The tools you carry, for showing them on your body (kit.js): the same array until they change (switching slots
  // changes inv.v but not this)
  kitIds() {
    const inv = this.inv;
    if (this.kitInv !== inv || this.kitV !== inv.v) {
      this.kitInv = inv; this.kitV = inv.v;
      const ids = kitOf(inv), key = kitKey(ids);
      if (key !== this.kitKeyNow) { this.kitKeyNow = key; this.kitList = ids; }
    }
    return this.kitList;
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
    let last = performance.now(), acc = 0, drawnAt = -1e9, ticks = 0;
    const perf = this.perf = { frames: 0, steps: 0, update: 0, draw: 0, max: 0 };   // (lo que cuesta cada fotograma: para el panel de F3)
    // Avanzar el juego (la simulación y la red) hasta ahora, a pasos fijos; cap: lo que se recupera como mucho de una vez
    const advance = (now, cap) => {
      const real = Math.min(cap, Math.max(0, (now - last) / 1000));
      acc += real;
      last = Math.max(last, now);
      // (slow motion: the same 60 steps a second of real time, each one shorter. With fewer steps the drawing, which does
      // not interpolate between steps, would move everybody in jumps every 3 or 4 frames. The network, at its real pace)
      const ts = this.slowScale(real);
      // (un fallo al avanzar tampoco: se avisa y el juego sigue respondiendo; los de cada sistema ni llegan aquí: ver hook)
      try { while (acc >= STEP) { this.update(STEP * ts, STEP); acc -= STEP; perf.steps++; } } catch (e) { acc = 0; reportFault(e, 'paso'); this.updateError = e.message; }
    };
    this.advance = advance;   // (for the tests)
    const frame = now => {
      const t0 = performance.now();
      advance(now, 0.25);
      const t1 = performance.now();
      // Sin el foco (otra ventana delante, con esta aún a la vista), se dibuja a unos 20 fps: menos calor y batería, y la
      // gráfica para lo que sí se está mirando. El juego y la red siguen a su paso, en cada fotograma
      if (!this.unfocused || now - drawnAt >= BLUR_MS - 4) {
        drawnAt = now;
        // (un fallo al dibujar no para el juego: se avisa y se sigue)
        try { this.render(); } catch (e) { reportFault(e, 'dibujo'); this.renderError = e.message; }
      }
      const t2 = performance.now();
      perf.frames++; perf.update += t1 - t0; perf.draw += t2 - t1; perf.max = Math.max(perf.max, t2 - t0);
      // (la música, también aislada: es lo único que queda antes de pedir el fotograma siguiente)
      if (++ticks % 30 === 0) try { Music.update(this); } catch (e) { reportFault(e, 'Music.update'); }
      requestAnimationFrame(frame);
    };
    requestAnimationFrame(frame);
    // Con la pestaña oculta (o la ventana tapada del todo) el navegador ya no da fotogramas: sin esto se paraba el juego
    // entero, también la red (los demás te veían quieto y, si llevabas el mundo, el mundo de todos se paraba). Sigue
    // avanzando con un reloj, sin dibujar. El reloj va en un hilo aparte (Worker): en la página, Chrome deja los relojes de
    // una pestaña oculta en uno por segundo y, pasados 5 minutos, en uno por minuto (con el tope de 1 s por llamada, el
    // juego iría 60 veces más lento); a los de un Worker no los frena. Sin Worker, el reloj de la página
    const tick = () => { if (document.hidden) advance(performance.now(), 1); };
    let clock = null;
    try {
      clock = new Worker(URL.createObjectURL(new Blob(['setInterval(() => postMessage(0), 250);'], { type: 'text/javascript' })));
      clock.onmessage = tick;
      clock.onerror = () => { clock.terminate(); setInterval(tick, 250); };
    } catch { setInterval(tick, 250); }
    // (el foco, por sus avisos: en un Chrome sin pantalla no llega ninguno y se dibuja siempre a todo)
    addEventListener('blur', () => { this.unfocused = true; this.view3d.capped = true; });
    addEventListener('focus', () => { this.unfocused = false; this.view3d.capped = false; });
  }

  // Sin dibujar (el mundo del servidor): solo avanza, a pasos fijos, unas 20 veces por segundo. Un fallo al avanzar se
  // avisa (en el terminal del servidor: ver faults.js) y se sigue
  // (tps: los pasos por segundo de verdad del último segundo, y lo que tardan; para /tps en el terminal)
  runHeadless() {
    let last = performance.now(), acc = 0, steps = 0, busy = 0, t0 = last;
    this.tps = { steps: 60, ms: 0 };
    setInterval(() => {
      const now = performance.now();
      acc += Math.min(1, (now - last) / 1000);
      last = now;
      try { while (acc >= STEP) { this.update(STEP); acc -= STEP; steps++; } } catch (e) { acc = 0; reportFault(e, 'paso del mundo'); this.updateError = e.message; }
      busy += performance.now() - now;
      if (now - t0 >= 1000) { this.tps = { steps: Math.round((steps * 1000) / (now - t0)), ms: steps ? busy / steps : 0 }; steps = 0; busy = 0; t0 = now; }
    }, 50);
  }

  // Dónde se va a jugar, en el menú (aún sin jugador): donde se quedó la partida guardada, para hornear los árboles
  // lejanos de la estación de allí (en el otro hemisferio, la contraria). null: no se sabe
  savedY() { const p = Profile.data?.save?.player; return p && !p.inside && Number.isFinite(p.y) ? p.y : null; }

  // How fast the game goes now (1, or less while the tool wheel is open): only playing alone (live.aloneInWorld: the world
  // of everybody cannot be stopped) and with the tab in sight (the Worker's clock, with it hidden, always goes at 1). It
  // eases in and out in real time; with someone in or the tab hidden it is 1 at once, so it never stays slowed down
  slowScale(real) {
    const slow = this.wheel?.open || this.quick?.open;
    if (!slow && this.timeScale === 1) { this.timeScaleTarget = 1; return (this.simScale = 1); }   // (nearly always: nothing to ask)
    const alone = !document.hidden && this.live.aloneInWorld;
    this.timeScaleTarget = alone && slow ? SLOW_MOTION : 1;
    if (!alone) this.timeScale = 1;
    else this.timeScale += (this.timeScaleTarget - this.timeScale) * (1 - Math.exp(-real * SLOW_RATE));
    if (Math.abs(this.timeScale - this.timeScaleTarget) < 0.003) this.timeScale = this.timeScaleTarget;
    return (this.simScale = this.timeScale);
  }

  // dt: the time of the game (shorter in slow motion); realDt: the real one, for the network
  update(dt, realDt = dt) {
    this.time += dt;
    // (lo de los demás jugadores y lo de recoger, aislados como los sistemas: ver hook)
    try { this.live.tick(realDt); } catch (e) { reportFault(e, 'Live.tick'); }
    const p = this.player;
    if (p && this.mode === 'map') { this.map.update(keys, dt); return; }
    if (!p || this.mode !== 'play') return;
    if (!this.live.guest) this.world.clock += dt;   // (jugando en el mundo de otro, la hora la lleva él)
    try { this.gather.update(dt); } catch (e) { reportFault(e, 'Gather.update'); }
    this.hook('update', dt);
    if (keys.use && !this.busy && !this.jumping && !this.build.on) this.gather.use(true);
    if (this.busy || this.jumping || hud.dialogOpen || p.pose) { p.stop(); return; }
    p.speedMul = (this.buffs.rapido > this.time ? 1.35 : 1) * this.archery.walk * this.carry.speedMul();
    // (the three speeds, entities.js GAIT: the load and the arms stop the sprint, carry.js; overloaded or pushing the wheelbarrow,
    // only walking; out of stamina, a sprint drops to a jog, and sprinting again needs three new taps: input.js dropSprint)
    // (riding, the sprint tier is the gallop and the horse's stamina gates it, never the rider's: a winded horse trots at most
    // until it is back at 40 %, horse.js; its speeds, its weight and the ground: horseride.js)
    const tired = p.mount ? this.horse.noGallop() : this.needs.noRun();
    if (tired && keys.sprint) dropSprint();
    p.noSprint = this.carry.noRun() || tired || this.law.cell; p.noJog = this.carry.noJog(); p.jumpMul = this.carry.jumpMul();   // (with the slot inventory, false and 1)
    if (Object.values(keys).some(Boolean)) this.lastInput = this.time;   // (para /setidletimeout)
    if (p.mount) this.horse.prepRide(p, this.scene, Settings.v.ride === 'arcade' || apagada('montar'));
    if (p.aboard) p.stop();   // (de pasajero en una barca, le lleva ella)
    else p.update(dt, p.mount && this.horse.held() ? NO_KEYS : keys, this.scene);   // (a rearing or staggering horse: no control for a moment, horse.js)
    if (this.spectating) this.followSpectated();
    if (this.scene === this.world) this.aroundPlanet();
    if (!p.inside) this.explore();
    // Bajo un tejado: cambia el ambiente (sonido, lluvia, nombre del sitio) y se guarda, como al entrar en casa
    const house = this.scene === this.world && !p.aboard ? this.ranch.houseAround(p) : null;
    this.view3d.world?.showInside?.(house && !CAM.first ? house : null);   // (dentro del establo, sin tejado: se ve lo de dentro)
    const under = this.scene === this.world && (underRoof(this.world, p.x, p.y) || !!house);
    // (the room, while under a roof of the world: what warms it and what it is called. In a big animal house, none)
    this.room = under && !house && shelterOn() ? (this.roomWatch ||= new RoomWatch()).get(this.world, p.x, p.y, performance.now(), this.wear.raining) : null;
    const glass = under && !house && this.world.glassRoofAt(Math.floor(p.x), Math.floor(p.y));
    if (glass !== this.underGlass) { this.underGlass = glass; this.updatePlace(); }
    if (under !== this.underRoof) { this.underRoof = under; p.underRoof = under; Audio.indoors = this.indoors; this.updatePlace(); this.onSave?.(); }
    // (por pasos, no por dibujos: sin el foco o con la pestaña oculta se dibuja menos o nada, y frameNo se queda quieto)
    if ((this.stepNo = (this.stepNo || 0) + 1) % 10 === 0) this.updatePlace();
  }

  render() {
    this.frameNo++;
    // En primera persona el ratón mueve la cámara y se apunta con la cruceta, en el centro de la pantalla
    syncLook(this.mode === 'play' && !this.busy && !hud.dialogOpen && !this.build.on && !!this.player && !this.windowsOpen);   // (con una ventana abierta, el cursor es para ella)
    document.body.classList.toggle('talking', this.busy || hud.dialogOpen);   // (hablando, las ventanas se apartan)
    this.onFrame?.();
    if (aimLock.locked) { const c = this.mouse ||= {}; c.x = innerWidth / 2; c.y = innerHeight / 2; c.in = true; }
    const p = this.player, m = this.mouse;
    // Lo apuntado con el cursor lleva un borde amarillo, y la opción sale a su lado. (Aislado: si falla lo que dice
    // una cosa apuntada, esa cosa no se usa, pero el mundo se sigue dibujando)
    let near = null;
    try {
      near = this.nearest();
      this.highlight = this.build.on ? this.build.pickHighlight() : (near && m?.in && !p.pose && !p.aboard ? this.aimed() : null) || this.wear.outline();   // (swimming too: finds on the bed, water)
      if (p?.swim && this.highlight && this.highlight.kind !== 'sys' && !this.build.on) this.highlight = null;   // (a swimmer uses only those: nearest)
    } catch (e) { reportFault(e, 'apuntar'); near = null; this.highlight = null; }
    this.view3d.game = this;
    // (sin partida, al entrar y en el menú, el fondo es una foto fija: body.still, en index.html; el mundo no se dibuja)
    const still = !this.player || !this.scene;
    if (still !== this.still) { this.still = still; document.body.classList.toggle('still', still); if (!still) this.view3d.snap?.(); else this.view3d.leaveUnder?.(); }
    // Lo que no se ve no se dibuja: con el mapa grande delante (opaco), nada; en la pausa (el juego se ve detrás, quieto), la
    // última imagen, que se queda en el lienzo, salvo si hay que repintarla (redraw: cambia el tamaño de la ventana o algo
    // de los ajustes). Lo de la vista que espera (el suelo que llega, los trozos) sigue al volver. Mientras la vista se prepara a
    // oscuras (whenReady: al entrar, en un salto), sí, aunque haya una pantalla delante: sin dibujar no avanza, y se quedaría
    // a oscuras hasta el tope (unos 13 s). Ahí casi no pinta (ver prepare), y los fotogramas de después ya son la imagen fija
    const v = this.view3d, hidden = !v.prep && (this.mode === 'map' || (this.mode === 'pause' && !v.redraw));
    if (!still && !hidden) {
      const n = v.drawn;
      v.redraw = false; v.render(this);
      if (this.mode === 'map') this.map.relief?.touch();   // (a jump with the map open: its picture again)
      // (a copy of this very frame, for who asked: the pause, ui/pausehub.js. Right now: later the buffer may be gone)
      if (this.onShot) { if (v.drawn !== n) { const fn = this.onShot; this.onShot = null; fn(v.renderer.domElement); } else v.redraw = true; }
    }
    else if (still) v.idle?.(this);   // (sin dibujar, se adelanta lo que se puede: los impostores de los árboles lejanos)
    const prey = this.gather.target?.prey;
    // (and greeting whoever is under the cursor, Y: social.js. Only added if E is about that same person; farther away, alone)
    const social = this.player ? this.social.promptFor(this.highlight?.e || null, !!near) : '';
    if (this.fishing.card) near = null;   // (the catch card says what E and X do)
    if (near?.leading && !this.horselead.promptShown()) near = null;
    if (near?.riding && !this.horse.promptShown()) near = null;   // (riding: «Get off» does not stay on the screen the whole ride)
    this.build.tick();   // (what is being taken down, holding)
    this.prompts.frame(near, this.highlight, !!prey && this.highlight?.e === prey, social);   // (at what is aimed at: ui/prompts.js)
    let hint = '';
    if (this.player) {
      for (const s of this.systems) { try { hint = s.hint?.() || ''; } catch (e) { reportFault(e, faultName(s, 'hint')); } if (hint) break; }
      hint ||= this.build.on ? this.build.hint() : this.gather.hint();
    }
    // (a hint may say its own key, { text, key }: carry.js, "Q Put down the log"; the rest, the click)
    const hk = hint && typeof hint === 'object' ? hint : null;
    if (hk) hint = hk.text;
    hud.hint(hint, hk ? hk.key : undefined, hk?.key2, hk?.text2);   // (and a second key with its own words: the bait, fishing.js)
    if (hk?.all) hint = hk.all;
    try { this.wheel?.frame(); } catch (e) { reportFault(e, 'ToolWheel.frame'); }   // (the tool wheel: src/ui/wheel.js)
    try { this.quick?.frame(); } catch (e) { reportFault(e, 'QuickPlaces.frame'); }   // (the places near: src/ui/quickplaces.js)
    try { this.smartHud?.frame(hint); } catch (e) { reportFault(e, 'SmartHud.frame'); }   // (the minimal interface, unless the full one was chosen: src/ui/smarthud.js)
    try { this.lawHud?.frame(); } catch (e) { reportFault(e, 'LawHud.frame'); }
    try { this.needsBar?.frame(); } catch (e) { reportFault(e, 'NeedsBar.frame'); }   // (the status bars, both HUDs: src/ui/needsbar.js; after smartHud, which sets their timers)
    if (this.player && this.world) {
      // (los lugares y los caballos, para smarthud.js, y los vecinos que se ven, cuatro veces por segundo. What is on the maps
      // comes from ui/blips.js, which asks for the rest by itself)
      const due = !(Math.abs(this.time - (this.markersAt ?? -1)) < 0.25);
      if (due) { this.markersAt = this.time; this.map.markers = [...this.places.markers(), ...this.horse.marks()]; }
      this.map.world = this.world;   // (lo cavado que tiene agua se pinta de agua)
      this.map.game = this;
      if (this.mode === 'map' && due) this.map.people = this.neighbors.people.filter(n => !n.hidden && !n.atHome).map(n => ({ x: n.x, y: n.y, name: n.def.name }));
      this.map.face = this.player.face;   // (their arrow on the big map points where they face)
      if (this.mode === 'map') { const at = this.scene?.kind === 'grid' && this.scene.exitTo || this.player; this.map.drawBig(this.world.gen, this.explored, at.x, at.y, this.time); }   // (in a cave: where its mouth is)
      else if (this.map.relief?.on) this.map.relief.close();   // (left without closing it)
      try { this.minimap?.frame(); } catch (e) { reportFault(e, 'Minimap.frame'); }   // (the minimap and the compass strip: src/ui/minimap.js; hidden, it draws nothing)
    }
  }
}

// El nombre de un sistema y de su gancho, para los avisos de fallo (p. ej. 'Ranch.update')
function faultName(s, hook) { return `${s.constructor?.name || 'sistema'}.${hook}`; }

// ¿Está este punto bajo un tejado? En la casilla de un muro o de una puerta solo cuenta el lado de dentro
// (el que tiene suelo): delante de una puerta cerrada se está fuera, aunque el tejado llegue hasta ahí
function underRoof(scene, x, y) {
  const tx = Math.floor(x), ty = Math.floor(y);
  if (!scene.roofAt(tx, ty)) return false;
  const c = scene.floorClip?.(tx, ty), u = x - tx - 0.5, v = y - ty - 0.5;
  return !c || (u >= c[0] && u <= c[1] && v >= c[2] && v <= c[3]);
}

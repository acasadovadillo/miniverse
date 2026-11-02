// Punto de entrada: prepara el juego, los controles y los menús.
import { Game } from './game.js';
import { initInput } from './input.js';
import { initMenus } from './ui/menus.js';
import { hud } from './ui/hud.js';
import { initBuildBar } from './ui/buildbar.js';
import { initChat } from './ui/chat.js';
import { Settings } from './settings.js';
import { ITEMS } from './items.js';
import { RUG_SIZES } from './art/stations.js';

Settings.load();
const game = new Game(document.getElementById('c'));
const menus = initMenus(game);
initBuildBar(game);
const chat = initChat(game);
game.live.say = (text, kind) => chat.say(text, kind);
const b = game.build;
initInput({
  chat: prefix => chat.open(prefix),
  use: () => (hud.dialogOpen ? game.action() : b.on ? b.place() : game.gather.use()),
  jump: () => (hud.dialogOpen ? game.action() : game.player?.pose ? game.rest.stand() : game.fishing.space() || game.fishing.still ? null : game.player?.jump()),
  drop: all => game.toss(all),
  sit: () => game.rest.floor('floorSit'),
  lie: () => game.rest.floor('floorLie'),
  build: () => (game.mode === 'play' && !game.busy ? b.toggle() : false),
  building: () => b.on && game.mode === 'play',
  point: (x, y) => b.pointTo(game.tileAtScreen(x, y)),
  hover: (x, y) => { const t = game.tileAtScreen(x, y); if (t) game.gather.pointTo(t); },
  mouse: (x, y, inside) => { game.mouse = { x, y, in: inside }; },
  paint: (x, y, drag) => b.place(game.tileAtScreen(x, y), drag),
  unpaint: (x, y) => b.remove(game.tileAtScreen(x, y)),
  release: () => { b.painted = null; },
  secondary: (x, y) => { if (game.mode === 'play' && !game.busy) game.ranch.sitAt(game.tileAtScreen(x, y)); },
  // (cuatro giros: 0°, 90°, 180° y 270°, desde el que se ve; las alfombras, sus tamaños)
  rotate: () => { const g = game.gather, n = ITEMS[game.inv?.held?.id]?.place === 'rug' ? RUG_SIZES.length : 4; g.rot = ((g.target?.rot ?? g.rot ?? 0) + 1) % n; },
  erase: () => { if (b.on) b.remove(); else game.altAction(); },
  interact: () => game.action(),
  pause: () => menus.togglePause(),
  map: () => menus.toggleMap(),
  mapOpen: () => game.mode === 'map',
  mapZoom: d => menus.zoomMap(d),
  bag: () => menus.toggleInventory(),
  craft: () => menus.toggleCraft(),
  journal: () => menus.toggleJournal(),
  select: i => (b.on ? null : game.inv.select(i)),
  cycle: d => (b.on ? b.cycle(d) : game.inv.select(game.inv.selected + d)),
  enabled: () => game.mode === 'play',
});
Settings.onApply = () => game.resize();
game.run();
menus.boot();

// Acceso desde la consola del navegador, para depurar
window.pueblo = game;

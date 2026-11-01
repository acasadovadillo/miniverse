// Punto de entrada: prepara el juego, los controles y los menús.
import { Game } from './game.js';
import { initInput } from './input.js';
import { initMenus } from './ui/menus.js';
import { hud } from './ui/hud.js';
import { initBuildBar } from './ui/buildbar.js';
import { initChat } from './ui/chat.js';
import { Settings } from './settings.js';

Settings.load();
const game = new Game(document.getElementById('c'));
const menus = initMenus(game);
initBuildBar(game);
const chat = initChat(game);
const b = game.build;
initInput({
  chat: prefix => chat.open(prefix),
  use: () => (hud.dialogOpen ? game.action() : b.on ? b.place() : game.gather.use()),
  build: () => (game.mode === 'play' && !game.busy ? b.toggle() : false),
  building: () => b.on && game.mode === 'play',
  point: (x, y) => b.pointTo(game.tileAtScreen(x, y)),
  hover: (x, y) => { const t = game.tileAtScreen(x, y); if (t) game.gather.pointTo(t); },
  paint: (x, y, drag) => b.place(game.tileAtScreen(x, y), drag),
  unpaint: (x, y) => b.remove(game.tileAtScreen(x, y)),
  release: () => { b.painted = null; },
  rotate: () => { game.gather.rot = game.gather.rot ? 0 : 1; },
  erase: () => { if (b.on) b.remove(); },
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

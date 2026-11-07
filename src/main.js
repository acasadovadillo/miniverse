// Punto de entrada: prepara el juego, los controles y los menús.
import { Game, GAMEMODES } from './game.js';
import { initInput } from './input.js';
import { initMenus } from './ui/menus.js';
import { hud } from './ui/hud.js';
import { initBuildBar } from './ui/buildbar.js';
import { initChat } from './ui/chat.js';
import { initDebug } from './ui/debug.js';
import { Settings } from './settings.js';
import { freePlace } from './gather.js';

// Con ?modo=servidor, este juego es el mundo del servidor (lo abre multijugador.py): sin dibujo ni menús (server.js).
// Con ?modo=pruebas, el juego de siempre, pero jugado por las pruebas automáticas (pruebas.js; las lanza probar.py)
const MODE = new URLSearchParams(location.search).get('modo');
if (MODE === 'servidor') import('./server.js').then(m => m.runServer());
else if (MODE === 'pruebas' && ['127.0.0.1', 'localhost'].includes(location.hostname)) import('./pruebas.js').then(m => m.runTests(play()));   // (solo en este ordenador)
else play();

function play() {
  Settings.load();
  const game = new Game(document.getElementById('c'));
  const menus = initMenus(game);
  initBuildBar(game);
  const chat = initChat(game);
  const debug = initDebug(game);
  game.live.say = (text, kind) => chat.say(text, kind);
  const b = game.build;
  initInput({
    chat: prefix => chat.open(prefix),
    use: () => (hud.dialogOpen ? game.action() : b.on ? b.place() : game.gather.use()),
    jump: () => (hud.dialogOpen ? game.action() : game.player?.pose ? game.rest.stand() : game.fishing.space() ? null : game.player?.jump()),
    drop: all => game.toss(all),
    sit: () => game.rest.floor('floorSit'),
    lie: () => game.rest.floor('floorLie'),
    crouch: on => { const p = game.player; if (p && !p.mount && !p.boat && !p.aboard && !p.pose) p.crouch = on ?? !p.crouch; },   // (Shift: agacharse o levantarse)
    build: () => (game.mode === 'play' && !game.busy && game.gamemode !== 'spectator' ? b.toggle() : false),
    building: () => b.on && game.mode === 'play',
    point: (x, y) => b.pointTo(game.tileAtScreen(x, y)),
    hover: (x, y) => { const t = game.tileAtScreen(x, y); if (t) game.gather.pointTo(t); },
    mouse: (x, y, inside) => { game.mouse = { x, y, in: inside }; },
    paint: (x, y, drag) => b.place(game.tileAtScreen(x, y), drag, [x, y]),
    unpaint: (x, y, drag) => b.removeAt(game.tileAtScreen(x, y), drag, [x, y]),
    release: () => { b.painted = null; b.dragLayer = null; },
    secondary: (x, y) => { if (game.mode === 'play' && !game.busy) game.ranch.sitAt(game.tileAtScreen(x, y)); },
    // Lo que se coloca libre gira poco a poco mientras se mantiene R; lo que va contra un muro (cuadros, hogar), en
    // cuatro giros desde el que se ve
    rotate: dir => { const g = game.gather; if (freePlace(game.inv?.held?.id)) g.turnStart(dir); else g.rot = ((g.target?.rot ?? g.rot ?? 0) + 1) % 4; },
    rotateEnd: () => game.gather.turnEnd(),
    size: () => game.gather.nextSize(),
    erase: () => { if (b.on) b.remove(); else game.altAction(); },
    interact: () => game.action(),
    pause: () => menus.togglePause(),
    map: () => menus.toggleMap(),
    mapOpen: () => game.mode === 'map',
    mapZoom: d => menus.zoomMap(d),
    bag: () => menus.toggleInventory(),
    craft: () => menus.toggleCraft(),
    journal: () => menus.toggleJournal(),
    players: on => showPlayers(on),
    debug: () => debug.toggle(),
    select: i => (b.on ? null : game.inv.select(i)),
    cycle: d => (b.on ? b.cycle(d) : game.inv.select(game.inv.selected + d)),
    enabled: () => game.mode === 'play',
  });
  Settings.onApply = () => game.resize();

  // La lista de jugadores, mientras se mantiene Tab (como en Minecraft): quién juega, quién lleva el mundo, quién es
  // op y en qué modo está
  const GM_OF = { 0: 'survival', 1: 'creative', 3: 'spectator' };
  function showPlayers(on) {
    const box = document.getElementById('players'), list = document.getElementById('players-list'), live = game.live;
    box.classList.toggle('show', !!on && game.mode === 'play' && !!game.player);
    if (!box.classList.contains('show')) return;
    const rows = [[`${game.player.name} (tú)`, live.role === 'host', live.amOp, game.gamemode]];
    if (live.joined) for (const p of live.others) if (p.playing && !p.server) rows.push([p.name, p.host, live.isOp(p.id), GM_OF[p.entity?.gm || 0]]);
    list.textContent = '';
    for (const [name, host, op, gm] of rows) {
      const li = document.createElement('li'), b = document.createElement('b'), tags = [host && 'lleva el mundo', gm !== 'survival' && GAMEMODES[gm]].filter(Boolean);
      b.textContent = name;
      li.append(b);
      if (op) { const o = document.createElement('small'); o.className = 'op'; o.textContent = 'op'; li.append(o); }
      if (tags.length) { const t = document.createElement('small'); t.textContent = tags.join(' · '); li.append(t); }
      list.append(li);
    }
  }
  addEventListener('blur', () => showPlayers(false));
  game.run();
  menus.boot();

  // Acceso desde la consola del navegador, para depurar
  window.pueblo = game;
  return game;
}

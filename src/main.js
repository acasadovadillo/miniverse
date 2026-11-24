// Punto de entrada: prepara el juego, los controles y los menús.
import { t } from './i18n.js';   // (first: the language is chosen and the static HTML translated before anything is shown)
import { Game, GAMEMODES } from './game.js';
import { initInput } from './input.js';
import { initMenus } from './ui/menus.js';
import { hud } from './ui/hud.js';
import { initBuildBar } from './ui/buildbar.js';
import { initChat } from './ui/chat.js';
import { initDebug } from './ui/debug.js';
import { Settings } from './settings.js';
import { freePlace } from './gather.js';
import { useSmartHud } from './ui/smarthud.js';
import { NeedsBar } from './ui/needsbar.js';
import { ToolWheel } from './ui/wheel.js';
import { apagada } from './opciones.js';
import { FieldHud } from './ui/fieldhud.js';
import { FishCard } from './ui/fishcard.js';
import { HuntOverlay } from './ui/huntoverlay.js';
import { reportFault } from './faults.js';

// Con ?modo=servidor, este juego es el mundo del servidor (lo abre multijugador.py): sin dibujo ni menús (server.js).
// Con ?modo=pruebas, el juego de siempre, pero jugado por las pruebas automáticas (pruebas.js; las lanza probar.py)
// Con ?banco=1, el banco de medidas del dibujo (banco.js; lo lanza banco.py): sin entrar con ninguna cuenta
const MODE = new URLSearchParams(location.search).get('modo');
const DIVING = !apagada('buceo');   // (?buceo=0: Shift crouches while swimming, and so sinks a little, as before)
if (MODE === 'servidor') import('./server.js').then(m => m.runServer());
else if (new URLSearchParams(location.search).has('banco')) import('./banco.js').then(m => m.runBench(play(false)));
else if (MODE === 'pruebas' && ['127.0.0.1', 'localhost'].includes(location.hostname)) import('./pruebas.js').then(m => m.runTests(play()));   // (solo en este ordenador)
else play();

function play(login = true) {   // (login: abrir la pantalla de entrar)
  Settings.load();
  const game = new Game(document.getElementById('c'));
  const menus = initMenus(game);
  initBuildBar(game);
  const chat = initChat(game);
  const debug = initDebug(game);
  // The interface: the minimal one (src/ui/smarthud.js: each part shows when it matters, Tab shows everything) unless
  // the setting (Settings › Display › Interface) says full, or ?hud=completo. The tests and the bench keep the full one
  // (what they check and measure) unless &hud=minimo. Changing the setting swaps it at once, without reloading
  const q = new URLSearchParams(location.search), plain = MODE === 'pruebas' || q.has('banco');
  const pick = { minimo: true, completo: false }[q.get('hud')] ?? (plain ? false : null);
  game.needsBar = new NeedsBar(game);   // (the status bars at the top left, for both interfaces; before the HUD, which resets it)
  useSmartHud(game, pick ?? Settings.v.hud !== 'full');
  Settings.onHud = v => useSmartHud(game, v !== 'full');
  Settings.hudNow = () => (game.smartHud ? 'minimal' : 'full');   // (what the setting lights: the one in sight)
  game.live.say = (text, kind) => chat.say(text, kind);
  hud.feed.busy = () => hud.dialogOpen || !!game.wheel?.open;   // (meanwhile its lines wait: ui/feed.js)
  const wheel = game.wheel = new ToolWheel(game);   // (F held: the tool wheel, src/ui/wheel.js)
  // The study ring and the track tag (src/ui/fieldhud.js, Plan G), for both interfaces: drawn after menus.js's frame hook
  game.huntOverlay = new HuntOverlay(game);   // (while hunting: your noise ring and the wind, on the minimap)
  const fieldHud = game.fieldHud = new FieldHud(game), menusFrame = game.onFrame;
  const fishCard = new FishCard(game);   // (the catch card, src/ui/fishcard.js)
  game.onFrame = () => { menusFrame?.(); try { fieldHud.frame(); } catch (e) { reportFault(e, 'FieldHud.frame'); } try { fishCard.frame(); } catch (e) { reportFault(e, 'FishCard.frame'); } };
  const b = game.build;
  initInput({
    frontKey: e => menus.frontKey(e),   // (a menu screen of ui/frontend.js open: the keys are its own)
    chat: prefix => chat.open(prefix),
    use: () => (hud.dialogOpen ? game.action() : b.on ? b.place() : game.gather.use()),
    jump: () => (hud.dialogOpen ? game.action() : game.fishing.space() ? null : game.player?.pose ? game.rest.stand() : game.player?.jump()),
    drop: all => game.toss(all),
    posture: hold => game.rest.posture(hold),   // (Shift alone: a tap or a hold; rest.js posture)
    crouch: on => { const p = game.player; if (p && !p.mount && !p.boat && !p.aboard && !p.pose && !(p.swim && DIVING)) p.crouch = on ?? !p.crouch; },   // (the second tap of W stands up)
    swimming: () => DIVING && !!game.player?.swim,   // (swimming, Shift dives: neither its tap nor its hold is a posture, and a fast swim goes on)
    build: () => (game.mode === 'play' && !game.busy && game.gamemode !== 'spectator' ? b.toggle() : false),
    building: () => b.on && game.mode === 'play',
    point: (x, y) => b.pointTo(game.tileAtScreen(x, y)),
    hover: (x, y) => { const t = game.tileAtScreen(x, y); if (t) game.gather.pointTo(t); },
    mouse: (x, y, inside) => { game.mouse = { x, y, in: inside }; },
    paint: (x, y, drag) => b.place(game.tileAtScreen(x, y), drag, [x, y]),
    unpaint: (x, y, drag) => b.removeAt(game.tileAtScreen(x, y), drag, [x, y]),
    release: () => { b.painted = null; b.dragLayer = null; },
    social: (down, src, x, y) => (down ? game.social.press(src, x, y) : game.social.release(src)),   // (Y or right click on someone: social.js)
    socialCancel: () => game.social.cancel(),
    whistle: () => game.horse.whistle(),   // (N: Plan F, src/horse.js)
    ride: k => (game.player?.mount && !game.busy && !hud.dialogOpen ? (k === 'pat' ? game.horse.pat() : game.horse.trick('rear')) : false),   // (G and H riding)
    secondary: (x, y) => { if (game.mode === 'play' && !game.busy) game.ranch.sitAt(game.tileAtScreen(x, y)); },
    // Lo que se coloca libre gira poco a poco mientras se mantiene R; lo que va contra un muro (cuadros, hogar), en
    // cuatro giros desde el que se ve
    rotate: dir => { const g = game.gather; if (freePlace(b.on ? b.heldItem()?.id : game.inv?.held?.id)) g.turnStart(dir); else g.rot = ((g.target?.rot ?? g.rot ?? 0) + 1) % 4; },
    rotateEnd: () => game.gather.turnEnd(),
    size: () => game.gather.nextSize(),
    erase: () => { if (b.on) b.remove(); else game.altAction(); },
    eraseEnd: () => game.altRelease(),   // (X let go of: what it was holding is off)
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
    select: i => (b.on ? null : game.inv.select(i, true)),   // (on purpose: what was in hand is "the one before" for a tap of F)
    wheelPress: () => wheel.press(),
    wheelRelease: () => wheel.release(),
    wheelCancel: hard => wheel.cancel(hard),
    wheelOpen: () => wheel.open,
    wheelPick: i => wheel.pick(i),
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
    const rows = [[t('players.you', { name: game.player.name }), live.role === 'host', live.amOp, game.gamemode]];
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
  if (login) menus.boot();

  // Acceso desde la consola del navegador, para depurar
  window.pueblo = game;
  return game;
}

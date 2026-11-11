// Jugar juntos en directo. El admin abre su servidor (multijugador.py) y publica su dirección en GitHub; los
// demás la encuentran al iniciar sesión. El mundo compartido lo lleva el juego del primero que entra (el
// anfitrión, sea quien sea: también sin el admin), que lo guarda para todos en mundo.enc; los que llegan después
// entran en él con su propio personaje (ver livesync.js: qué es de todos y cómo se reparten los cambios). Si el
// anfitrión se va, lo sigue llevando el que antes llegó al servidor de los que quedan, sin cortar. Cada jugador manda a
// los demás cómo va (dónde está, hacia dónde mira, si salta, qué lleva en la mano y cuándo lo usa, y su
// aspecto con la ropa que lleva) y ve a los demás como una persona más, con su nombre encima. El chat llega a
// todos, y lo que se tira al suelo lo puede recoger cualquiera. Por ahora, juntos solo en el mundo de fuera:
// en las cuevas, cada uno va por su cuenta.
//
// Con el mundo del servidor (server.js: el juego en un Chrome invisible que abre multijugador.py), el mundo lo lleva
// siempre él, como un servidor de Minecraft: si llega cuando ya lo llevaba otro, le pide el mundo y ese juego se lo
// pasa y sigue en él como uno más. Quien lleva el mundo no deja tocarlo lejos de donde está quien lo pide, ni cambiar
// las reglas a quien no es op: se lo devuelve como estaba.
import { Net } from './net.js';
import { Person } from './entities.js';
import { Profile } from './accounts.js';
import { hud } from './ui/hud.js';
import { Audio } from './audio.js';
import { SHARED, BLOBS, COLLECTIONS, ItemSync, diffChunk, applyOps, copy, unknownShared } from './livesync.js';
import { toB64 } from './vault.js';
import { onFault } from './faults.js';
import { GAME_VERSION, compareVersions } from './version.js';
import { CHUNK } from './world/gen.js';
import { wrapIndex, PLANET } from './world/planet.js';

const SEND_EVERY = 0.1, IDLE_EVERY = 1;   // segundos entre mensajes de cómo va uno: moviéndose y quieto
const SYNC_EVERY = 0.1;                   // cada cuánto se mandan los cambios del mundo
const POSES = ['sit', 'floorSit', 'lie', 'floorLie'];   // las posturas, por su número (en el estado de cada jugador)
const BLOB_EVERY = 0.25, TIME_EVERY = 1, HERD_EVERY = 0.2;   // lo de todos, la hora y por dónde van los animales
const FULL_EVERY = 30;                     // (quien lleva el mundo) cada cuánto manda entera la foto de lo de todos por elementos
const SNAP = 4;                           // si alguien aparece a más de tantas casillas de donde estaba, salta allí
const MINE_FIRST = 3;                     // segundos que lo que suelta algo al romperse es solo de quien lo rompió
const GIVE_FIRST = 5;                     // y que lo que uno tira es solo para los demás (así se dan cosas)
const WORLD_WAIT = 20000;                 // lo que se espera, como mucho, a que llegue el mundo del anfitrión
const CLAIM_WAIT = 900;                   // al entrar sin anfitrión, lo que se espera por si otro también iba a llevarlo
const HOST_WAIT = 6000;                   // y lo que se espera a que el que lo lleva diga que ya está
const REACH = 3;                          // trozos del mundo alrededor de donde está cada uno que puede tocar
const OP_BLOBS = new Set(['rules', 'worldSpawn', 'weatherLock', 'difficulty']);   // lo de todos que solo cambian los op
const r2 = v => Math.round(v * 100) / 100;
const herdTo = (a, p) => { a.netTo = p; a.inside = !!p[2]; a.grazing = !!p[3]; };   // (por dónde va un animal, de quien lleva el mundo)
const session = Math.random().toString(36).slice(2, 6);   // (para que los objetos tirados tengan nombres únicos)

// Otro jugador, tal como lo ven los demás: va hacia donde dicen sus mensajes, suavizado
class RemotePlayer extends Person {
  constructor(peer) {
    super({ x: 0, y: 0, look: peer.look });
    Object.assign(this, { remote: true, id: peer.id, name: peer.name, z: 0, yaw: null, held: null, swing: 0, swingItem: null, cooldown: 0, to: null, fresh: true });
  }
  apply(st) {
    this.to = [st.x, st.y, st.z || 0]; this.floor = st.fl || 0;   // (fl: la roca que pisa)
    if (this.fresh || Math.hypot(st.x - this.x, st.y - this.y) > SNAP) { [this.x, this.y, this.z] = this.to; this.fresh = false; this.feet = null; }
    this.pose = st.po ? { kind: POSES[st.po[0]], yaw: st.po[1], h: st.po[2] } : null;   // (sentado o tumbado)
    Object.assign(this, { yaw: st.yaw ?? null, inside: !!st.in, mount: !!st.m, horseCoat: st.hc || null, horseBags: !!st.hb, boat: !!st.b, aboard: st.pa || null, crouch: !!st.cr, gm: st.gm || 0, held: st.h || null, swing: st.sw || 0, swingItem: st.si || null, cooldown: st.cd || 0, bowPull: st.dr || 0 });
    this.swim = !!st.na; this.sinkTo = st.na ? st.hu || 0 : 0;   // (nadando, y lo que se hunde o se asoma)
  }
  // w: el mundo, si está en él. z va sobre el suelo de donde pisa (surfaceAt); junto a lo cavado, ese suelo cambia de golpe
  // de una casilla a otra, y suavizando z aparte de x e y se le veía subir antes de caer al hoyo o hundido en el fondo al
  // salir. Ahí se suaviza la altura de los pies, y z sale de ella y del suelo de donde va ahora
  update(dt, w) {
    if (!this.to) return;
    const k = 1 - Math.exp(-dt * 12), [x, y, z] = this.to;
    // (el agua donde va, para dibujarlo: con los pies en el fondo vadeando, o nadando; ver actors.js)
    this.depth = w?.waterDepth && !this.boat && !this.aboard && this.gm !== 3 ? w.waterDepth(this.x, this.y) : 0;   // (el espectador vuela: como en su juego, sin agua)
    this.sink = (this.sink || 0) + ((this.sinkTo || 0) - (this.sink || 0)) * k;
    const dug = !!w && !this.boat && (w.digNear?.(x, y) || w.digNear?.(this.x, this.y));
    if (dug) this.feet ??= w.surfaceAt(this.x, this.y) + this.z;
    this.x += (x - this.x) * k; this.y += (y - this.y) * k;
    if (!dug) { this.z += (z - this.z) * k; this.feet = null; return; }
    this.feet += (w.surfaceAt(x, y) + z - this.feet) * k;
    this.z = this.feet - w.surfaceAt(this.x, this.y);
  }
}

export class Live {
  constructor(game) {
    this.game = game;
    this.net = null;
    this.url = null;
    this.status = 'off';      // off | connecting | nokey | on | error
    this.error = '';
    this.joined = false;      // si uno está jugando con los demás
    this.role = null;         // jugando juntos: 'host' (tu juego lleva el mundo compartido) o 'guest' (lo lleva otro)
    this.claimAt = null;      // entrando sin anfitrión: cuándo se pidió llevar el mundo (gana quien lo pidió antes)
    this.ops = null;          // los usuarios op (modo admin), como los da el servidor; null si no los da
    this.serverConns = new Set();   // las conexiones del mundo del servidor (lo dice el propio servidor, no ellas)
    this.idleMinutes = 0;     // (/setidletimeout en el terminal: a los tantos minutos sin moverse, te echa)
    this.peers = new Map();   // conexión → { id, name, host, playing, look, entity, sc }
    this.onChange = null;     // (para el menú: cambia el estado o quién hay)
    this.onHostLeft = null;   // (para el menú: hay que salir del mundo compartido, por qué: 'lost' o 'conflict')
    this.onHost = null;       // (para el menú: tu juego ha pasado a llevar el mundo)
    this.onServerSave = null; // (para el menú: el servidor pide guardar ya, /save-all)
    this.say = null;          // (para el chat: say(texto, tipo))
    this.sent = 0; this.lastSent = ''; this.swings = 0; this.lastSwing = 0; this.lastLook = null;
    this.pending = new Set();     // trozos del mundo que han cambiado desde la última vez que se mandaron
    this.synced = new Map();      // trozo → cómo estaba la última vez que se mandó (o llegó del anfitrión)
    this.blobs = {};              // lo de todos que no va en los trozos, como se mandó la última vez
    // (los animales, la familia y la granja, elemento a elemento: ver COLLECTIONS en livesync.js. seq: el número de tu
    // último envío de esos cambios; syncMode: cómo se repartían en la última vuelta; wholeSent: lo mandado entero a los
    // juegos de antes; ackHost: (invitado) a quién le mandas lo tuyo; fullDue: (quien lo lleva) toca mandar la foto entera)
    this.items = Object.fromEntries(Object.keys(COLLECTIONS).map(k => [k, new ItemSync(k)]));
    this.seq = 0; this.lastMode = null; this.wholeSent = {}; this.ackHost = null; this.fullDue = false;
    this.timers = { sync: 0, blob: 0, time: 0, herd: 0, full: 0 };
    this.clockBase = null;        // (invitado) la hora del anfitrión: { c, at, run, sh, db } (sh: lo que ha movido el reloj; db: su día 0)
    this.solo = null;             // (invitado) su partida de siempre, con su mundo: lo que se guarda
    this.wanted = null;           // (invitado) esperando el mundo del anfitrión
    this.dropN = 0;
    this.extraShared = {};        // (lo del mundo de una versión más nueva: se vuelve a guardar tal cual; ver unknownShared)
    this.faultSent = -Infinity;   // (cuándo se mandó el último fallo de este juego al terminal del servidor)
    this.newer = null;            // la versión más nueva que la tuya que tiene otro juego conectado (ver checkVersion)
    this.onOutdated = null;       // (para el menú: hay una versión nueva, hay que recargar)
    this.onServerRestart = null;  // (el mundo del servidor: /update en el terminal; guardar antes de que lo cierren)
    onFault(f => this.sendFault(f));
  }
  get host() { return [...this.peers.values()].find(p => p.host) || null; }
  get hostConn() { for (const [conn, p] of this.peers) if (p.host) return conn; return null; }
  get others() { return [...this.peers.values()]; }
  get guest() { return this.role === 'guest'; }
  changed() { this.onChange?.(); }
  setStatus(s, error = '') { this.status = s; this.error = error; this.changed(); }

  // ---------- conexión ----------
  async connect(url) {
    if (this.url === url && this.net) return;
    this.close();
    this.url = url;
    this.setStatus('connecting');
    const key = await Profile.worldKey();
    if (this.url !== url) return;
    const net = this.net = new Net(url, key, {
      up: () => this.up(),
      down: () => this.lost(),
      join: () => { if (this.status === 'nokey' && !Profile.server) this.net.sendPlain({ need: Profile.id }); },   // (por si es el admin, que llega)
      leave: conn => this.drop(conn, true),
      msg: (conn, m) => this.receive(conn, m),
      plain: (conn, p) => this.plain(conn, p),
      ops: list => this.setOps(list),
      welcome: m => this.welcome(m),
      server: m => this.fromServer(m),
    });
    // (si no responde a la primera, se queda avisando del error pero sigue intentándolo: un túnel recién
    // abierto tarda un poco en funcionar)
    try { await net.open(); } catch (e) { if (this.net === net && !net.ready) this.setStatus('error', e.message); }
  }
  // Se ha cortado (o no ha llegado a entrar): se sigue intentando. Si ya avisaba del error, sigue avisando;
  // si estaba conectado, avisa al rato de no poder volver.
  lost() {
    if (this.status === 'kicked') { this.dropAll(); return; }   // (te han echado o se ha cerrado: no se vuelve a intentar)
    const out = this.joined && (this.guest || !Profile.admin);
    this.dropAll();
    if (out) this.leave('lost');   // (sin servidor solo juega el admin: los demás salen, el anfitrión guardando el mundo)
    if (this.status === 'error') return;
    this.setStatus('connecting');
    clearTimeout(this.lostTimer);
    this.lostTimer = setTimeout(() => { if (this.net && !this.net.ready && this.status === 'connecting') this.setStatus('error', 'Se ha cortado la conexión con el servidor.'); }, 10000);
  }
  close() {
    if (this.net && this.joined) this.net.send({ t: 'bye' });
    this.net?.close();
    this.net = null; this.url = null;
    this.dropAll();
    if (this.status !== 'off') this.setStatus('off');
  }
  // Al entrar (o volver a entrar tras un corte): saludar o, sin la clave del mundo, pedírsela al admin
  up() {
    // (al servidor: de qué cuenta es, para los op, los vetos y la lista blanca; el mundo del servidor, su pase)
    const srv = Profile.server;
    this.net.sendServer(srv ? { t: 'pase', pase: srv.pase, v: GAME_VERSION } : { t: 'ident', user: Profile.id, v: GAME_VERSION });   // (v: ver version.js)
    if (this.net.need) this.giveKeys();
    // (el admin jugando solo en el mundo cuando aparece el servidor: lo lleva su juego, para que entren los demás)
    if (this.net.key && Profile.admin && this.game.player && !this.joined && this.newer === null) this.join(null, 'host');   // (newer: con una versión vieja, no)
    if (this.net.key) { this.setStatus('on'); this.hi(null, true); }
    else if (srv) this.setStatus('nokey');   // (el mundo del servidor: las claves se las da el servidor con su pase)
    else { this.setStatus('nokey'); this.net.sendPlain({ need: Profile.id }); }
  }
  // El admin, en el mismo ordenador que el servidor, le da las claves para el mundo del servidor (solo se las pide
  // así, nunca por el túnel)
  giveKeys() {
    const s = Profile.serverSecrets();
    if (s) { this.net.sendServer({ t: 'secrets', ...s }); this.net.need = false; }
  }
  // Lo mismo con el juego conectado al servidor por el túnel: por una conexión aparte, dentro del ordenador (url)
  handOver(url) {
    const s = Profile.serverSecrets();
    if (!s || this.handing === url) return;
    this.handing = url;
    let ws;
    try { ws = new WebSocket(url); } catch { this.handing = null; return; }
    ws.onmessage = e => {
      let m;
      try { m = JSON.parse(e.data); } catch { return; }
      if (m.t !== 'you') return;
      if (m.need) { ws.send(JSON.stringify({ t: 'ident', user: Profile.id, v: GAME_VERSION })); ws.send(JSON.stringify({ t: 'secrets', ...s })); }
      setTimeout(() => ws.close(), 500);
    };
    ws.onerror = () => { this.handing = null; };
  }
  hi(to = null, ask = false) {
    const g = this.game;
    const look = g.player ? g.appearance() : null;
    this.net?.send({ t: 'hi', id: Profile.id, name: g.player?.name || Profile.name, host: this.joined && this.role === 'host' && !!g.player, admin: Profile.admin, server: !!Profile.server, playing: this.joined && !!g.player, look, ask, v: GAME_VERSION, perItem: 1 }, to);   // (perItem: entiende lo de todos por elementos)
    this.lastLook = look; this.lastLookJson = JSON.stringify(look);
  }
  plain(conn, p) {
    // El admin da la clave del mundo a quien la pide (su archivo de claves dice si es de verdad esa cuenta:
    // solo esa cuenta puede abrir lo que se le deja ahí)
    if (p.need && Profile.admin) Profile.grant(p.need).then(() => this.net?.sendPlain({ granted: p.need }, conn)).catch(() => {});
    if (p.granted && p.granted === Profile.id && this.status === 'nokey') {
      Profile.reopenWorldKey().then(key => { if (key && this.net) { this.net.key = key; this.up(); } });
    }
  }

  // ---------- op y el servidor ----------
  // Los op los da el terminal del servidor (/op, /deop): pueden usar los comandos (/gamemode, /tp, /give…)
  setOps(list) {
    const was = this.amOp;
    this.ops = Array.isArray(list) ? new Set(list.map(u => String(u).toLowerCase())) : null;
    if (this.game.player && this.amOp !== was) hud.toast(this.amOp ? 'Ahora eres op: puedes usar los comandos (/help)' : 'Ya no eres op', this.amOp ? 'ok' : '');
    this.changed();
  }
  // ¿Es op esta cuenta? (null: el servidor no lo dice)
  isOp(id) { return this.ops ? this.ops.has(String(id || '').toLowerCase()) : null; }
  // ¿Lo eres tú? (sin un servidor que lo diga, solo el admin, que es el dueño del mundo)
  get amOp() { return Profile.server || this.local ? true : this.isOp(Profile.id) ?? Profile.admin; }   // (local: en tu mundo local mandas tú, como en un mundo de un jugador)   // (el mundo del servidor, siempre: ejecuta los del terminal)
  // Lo que dice el servidor al entrar: quién es el mundo del servidor, si se guarda el mundo y lo de no moverse
  welcome(m) {
    this.serverConns = new Set(m.servers || []);
    this.idleMinutes = m.idle || 0;
    if (m.autosave === false) this.game.worldSaving = false; else if (m.autosave === true) this.game.worldSaving = true;
  }
  // Lo que manda el propio servidor desde su terminal
  fromServer(m) {
    if (m.t === 'say') { this.say?.(`[Servidor] ${m.text}`, 'say'); hud.toast(`[Servidor] ${m.text}`); }
    else if (m.t === 'save') { this.say?.(Profile.server ? 'Guardando el mundo…' : 'El servidor guarda: guardando la partida…', 'sys'); this.onServerSave?.(); }
    else if (m.t === 'need') { if (Profile.admin) this.giveKeys(); }
    else if (m.t === 'servers') { this.serverConns = new Set(m.ids || []); for (const [c, p] of this.peers) if (p.server && !this.serverConns.has(c)) p.server = false; }
    else if (m.t === 'autosave') { this.game.worldSaving = !!m.on; this.say?.(m.on ? 'El servidor vuelve a guardar el mundo.' : 'El servidor ha dejado de guardar el mundo (/save-off).', 'sys'); }
    else if (m.t === 'idle') this.idleMinutes = m.minutes || 0;
    else if (m.t === 'cmd' || m.t === 'tps') this.onServerCmd?.(m);
    // /tp desde el terminal del servidor: a casa, o adonde está otro jugador (lo sabe tu juego)
    else if (m.t === 'tp') this.serverTp(m);
    // (el mundo del servidor: sus claves, la primera vez que enseña su pase)
    else if (m.t === 'secretos') { if (Profile.server && !this.net?.key && m.key) this.onKeys?.(m); }
    // (/update en el terminal: el mundo del servidor guarda y el servidor lo cierra para abrirlo con el código nuevo)
    else if (m.t === 'restart') this.onServerRestart?.(m);
    // (/restore y /backup en el terminal: el mundo del servidor abre esa copia del mundo, o hace una con nombre)
    else if (m.t === 'restore' || m.t === 'keep') { if (Profile.server) (m.t === 'restore' ? this.onServerRestore : this.onServerKeep)?.(m); }
    // (un aviso del servidor para el admin: su token caduca pronto)
    else if (m.t === 'notice') this.onNotice?.(m);
    else if (m.t === 'kicked' || m.t === 'stop') {
      if (m.outdated) this.outdated(typeof m.v === 'string' ? m.v : '');   // (el servidor tiene una versión más nueva)
      const why = m.t === 'stop' ? 'Se ha cerrado el servidor.' : m.reason || 'Te han echado del servidor.';
      this.setStatus('kicked', why);
      if (this.joined) this.leave(m.t === 'stop' ? 'stop' : 'kicked', why);
      else if (Profile.server) this.net?.sendServer({ t: 'saved' });   // (el mundo del servidor sin mundo abierto: nada que guardar)
    }
  }
  serverTp(m) {
    const g = this.game;
    if (!this.joined || !g.player || Profile.server) return;
    if (m.home) { if (g.teleportHome(true)) hud.toast('El servidor te ha llevado a casa'); return; }
    const to = String(m.to || '').toLowerCase(), peer = this.others.find(p => p.playing && p.id === to);
    if (peer?.entity && peer.sc === 'world' && g.teleport(peer.entity.x, peer.entity.y, true)) hud.toast(`El servidor te ha llevado adonde está ${peer.name}`);
  }
  // Una copia del mundo (ya cifrada con la clave del mundo: el servidor no puede abrirla) para que la guarde
  // name: una copia fija con ese nombre (solo el mundo del servidor: /backup, antes de /update y de /restore), que el
  // servidor no borra nunca
  backup(bytes, name = null) { if ((this.joined && this.role === 'host') || (name && Profile.server)) this.net?.sendServer({ t: 'backup', d: toB64(bytes), ...(name && { name }) }); }
  // Los jugadores con ese nombre (el de su cuenta o el de su personaje, sin mayúsculas; @a: todos; @s: tú),
  // de los que están jugando: [{ me: true } o { conn, peer }]
  playersNamed(name) {
    const n = name.toLowerCase(), g = this.game, out = [];
    if (n === '@a' || n === '@s' || n === String(Profile.id).toLowerCase() || n === g.player?.name.toLowerCase()) out.push({ me: true });
    if (n !== '@s' && this.joined) for (const [conn, peer] of this.peers) if (peer.playing && !peer.server && (n === '@a' || peer.id === n || peer.name?.toLowerCase() === n)) out.push({ conn, peer });
    return out;
  }
  // Llevar a otro jugador a un sitio ({ x, y }) o a casa ({ home: true }): lo hace su juego, si se lo pide un op
  sendTp(conn, where) { this.net?.send({ t: 'tp', ...where }, conn); }

  // ---------- mensajes ----------
  receive(conn, m) {
    let peer = this.peers.get(conn);
    if (m.t === 'hi') {
      const was = peer?.playing, wasHost = peer?.host;
      peer = { ...peer, id: m.id, name: m.name, host: !!m.host, admin: !!m.admin, server: !!m.server && this.serverConns.has(conn), playing: !!m.playing, look: m.look, v: typeof m.v === 'string' ? m.v : '', perItem: !!m.perItem };
      if (!peer.playing) this.hide(peer);
      this.peers.set(conn, peer);
      if (peer.entity && m.look) peer.entity.look = m.look;
      if (m.ask) this.hi(conn);
      if (this.joined && this.game.player && !peer.server && peer.playing !== !!was) hud.toast(peer.playing ? `${peer.name} ${Profile.server ? 'ha entrado en el mundo' : 'está jugando contigo'}` : `${peer.name} ha salido`, peer.playing ? 'ok' : '');
      if (peer.host) { this.hostName = peer.name; clearTimeout(this.waitTimer); }
      // Dos llevando el mundo (uno se cortó y volvió, o entraron a la vez): sigue el que llegó antes al servidor. El
      // mundo del servidor, siempre: si tu juego se lo acaba de dar, se lo pasa y sigue en él; si no, sale y vuelve
      if (peer.host && this.joined && this.role === 'host') {
        if (Profile.server) this.hi(conn);
        else if (peer.server) { if (this.gaveTo === conn) this.yieldTo(conn); else this.leave('conflict'); }
        else if (conn < this.net.me) this.leave('conflict');
        else this.hi(conn);
      }
      if (wasHost && !peer.host) this.hostGone();
      this.checkVersion(peer, conn);
      this.changed();
      return;
    }
    // Alguien entra sin anfitrión y pide llevar el mundo: si ya lo llevas, se lo dices; si tú también lo habías
    // pedido, gana quien lo pidió antes (y, a la vez, quien llegó antes al servidor)
    if (m.t === 'claim') {
      if (this.joined && this.role === 'host') this.hi(conn);
      else if (this.claimAt !== null) {
        if (this.claimAt < m.at || (this.claimAt === m.at && this.net.me < conn)) this.net.send({ t: 'claim', at: this.claimAt }, conn);
        else this.lostClaim = true;
      }
      return;
    }
    if (!peer) return;
    const g = this.game, fromHost = peer.host && this.guest;
    switch (m.t) {
      case 'st':
        if (!peer.playing) { peer.playing = true; this.changed(); }
        if (!m.sc) { this.hide(peer); return; }
        if (m.sc === 'world') peer.at = [m.x, m.y];   // (para saber qué puede tocar)
        if (!peer.entity && peer.look) peer.entity = new RemotePlayer(peer);
        peer.entity?.apply(m);
        peer.sc = m.sc;
        break;
      case 'look':
        peer.look = m.look;
        if (peer.entity) peer.entity.look = m.look;
        break;
      case 'chat':
        if (m.say) this.say?.(`[${peer.name}] ${m.text}`, 'say');   // (/say de un op)
        else if (m.me) this.say?.(`* ${peer.name} ${m.text}`, 'me');   // (/me)
        else if (m.adv) this.say?.(`${peer.name} ha conseguido el logro [${m.text}]`, 'say');   // (con announceAdvancements)
        else if (m.dm) this.say?.(`${peer.name} te susurra: ${m.text}`, 'dm');   // (/msg)
        else this.say?.(`<${peer.name}> ${m.text}`);
        break;
      case 'bye':
        if (this.joined && peer.playing && g.player && !peer.server) hud.toast(`${peer.name} ha salido`);
        peer.playing = false;
        this.hide(peer);
        if (peer.host) { peer.host = false; this.hostGone(); }
        this.changed();
        break;
      // El mundo compartido
      case 'want': if (this.role === 'host' && g.player) { if (peer.old) { this.tellOld(conn, peer); break; } this.sendWorld(conn); if (peer.server) this.gaveTo = conn; } break;   // (old: con una versión vieja no entra)
      case 'world': if (this.wanted && peer.host) { clearTimeout(this.wanted.timer); this.wanted.resolve(m); this.wanted = null; } break;
      case 'w':
        if (fromHost) this.applyChunk(m.c, m.ops);
        else if (this.takes(peer)) { if (!peer.old && this.mayEdit(peer, m.c)) this.applyChunk(m.c, m.ops); else this.refuse(conn, peer, m.c, m.ops); }
        break;
      case 's':
        if (!BLOBS[m.name]) { this.unknownBlob(peer, m, fromHost); break; }
        if (!(fromHost || this.takes(peer))) break;
        if (!fromHost && peer.old) { this.net.send({ t: 's', name: m.name, v: BLOBS[m.name].get(g) }, conn); this.tellOld(conn, peer); break; }   // (con una versión vieja, no se deja)
        if (!fromHost && OP_BLOBS.has(m.name) && this.isOp(peer.id) === false) { this.net.send({ t: 's', name: m.name, v: BLOBS[m.name].get(g) }, conn); this.warn(peer, `${peer.name} ha intentado cambiar ${m.name} sin ser op (no se deja)`); break; }
        BLOBS[m.name].set(g, m.v);
        if (fromHost) this.blobs[m.name] = JSON.stringify(BLOBS[m.name].get(g));   // (el anfitrión lo reparte a todos en su próxima vuelta)
        if (fromHost && this.items[m.name]) this.items[m.name].reset(g);   // (entero, de un juego de antes: lo repartido parte de aquí)
        break;
      // Lo de todos, elemento a elemento (ver COLLECTIONS en livesync.js). Al invitado le llega de quien lleva el mundo:
      // antes, lo suyo sin mandar se le manda (para que no se pierda), y lo suyo que allí aún no han aplicado no se pisa
      // (ack); con full, es la foto entera. A quien lo lleva, de un invitado: lo aplica (lo que no se deja, se le
      // devuelve) y lo reparte en su vuelta. Al mundo del servidor, de quien lo llevaba mientras se lo pasa: como suyo
      case 'el': {
        const sync = this.items[m.name];
        if (!sync || !Array.isArray(m.ops) || !this.joined) break;
        if (fromHost) {
          if (this.ackHost !== conn) { this.retarget(conn); this.flushItems(); }   // (lo lleva otro: lo tuyo sin aplicar, a él)
          const mode = this.syncMode();
          if (mode !== this.lastMode) this.switchMode(mode);
          this.flushItems(m.name);
          const ack = m.ack?.[this.net.me];
          sync.apply(g, m.ops, true, Number.isFinite(ack) ? ack : null, { full: !!m.full });
        } else if (this.takes(peer) && !peer.old) {
          const back = sync.apply(g, m.ops, false, null, { trusted: peer.host && !!Profile.server });
          if (Number.isFinite(m.seq)) peer.seq = Math.max(peer.seq ?? -1, m.seq);
          if (back.length) this.net.send({ t: 'el', name: m.name, ops: back, ack: this.acks() }, conn);
        }
        break;
      }
      case 'time': if (fromHost) this.clockBase = { c: m.c, at: g.time, run: m.run, sh: m.sh, db: m.db }; break;
      case 'herd':
        if (!fromHost || !Array.isArray(m.p)) break;
        // (p[3]: si está pastando, con la cabeza abajo; p[4]: de qué animal es. Los de antes no lo mandan: van en el orden
        // de la lista y, si ha nacido o muerto alguno y aún no ha llegado la lista nueva, se espera a ella. Por su id, uno
        // que no está en la lista de quien lo lleva (de una clase que su juego no conoce: ver ranch.unknown) no para a los demás)
        if (m.p[0]?.length > 4) { const by = new Map(g.ranch.animals.map(a => [a.id, a])); for (const p of m.p) { const a = by.get(p[4]); if (a) herdTo(a, p); } }
        else if (m.p.length === g.ranch.animals.length) m.p.forEach((p, i) => herdTo(g.ranch.animals[i], p));
        if (m.k) g.family.place(m.k);
        break;
      // Alguien llama a una puerta: suena si estás cerca (y, si es la tuya, te avisa)
      case 'knock':
        if (this.joined && g.player && g.scene === g.world && Math.hypot(g.player.x - m.x, g.player.y - m.y) < 25) { Audio.knock(); if (Math.hypot(g.player.x - m.x, g.player.y - m.y) < 12) hud.toast(`${peer.name} llama a la puerta`); }
        break;
      // Tener un bebé: quien está al otro lado de la cama ha pulsado su corazón
      case 'love':
        if (this.joined) g.family.heard(conn);
        break;
      // Un op te lleva a otro sitio (/tp), te da algo (/give), te mata (/kill), te pone dónde reaparecer
      // (/spawnpoint) o te cambia el modo de juego (/gamemode). Lo hace tu juego, si lo pide un op
      case 'tp': case 'give': case 'kill': case 'spawn': case 'gamemode':
      case 'clear': case 'effect': case 'xp': case 'recipe': case 'achievement': case 'title':
        if (this.joined && g.player && !Profile.server && this.trusted(conn, peer)) g.fromOp(m, peer.server ? 'El servidor' : peer.name);
        break;
      // Lo que se le pide a quien lleva el mundo (/summon, /kill @e), si lo pide un op
      case 'summon': case 'killmobs':
        if (this.role === 'host' && g.player && this.trusted(conn, peer)) g.fromHost(m);
        break;
      // Un op que juega en el mundo que lleva tu juego cambia la hora (/time)
      case 'settime':
        if (this.role !== 'host' || !this.isOp(peer.id) || !(m.madrid || (Number.isFinite(m.h) && m.h >= 0 && m.h < 24))) break;
        if (m.madrid) g.days.realHour(); else g.days.setHour(m.h);
        this.timers.time = Infinity;
        g.onSave?.();
        if (Profile.server) this.say?.(`${peer.name} ha cambiado la hora (/time)`, 'sys');
        break;
      // Las criaturas de fuera (mobs.js): dónde están (de quien lleva el mundo), a cuál le pega quién (a quien lo
      // lleva), a quién muerden y quién ha matado a una (de quien lo lleva)
      case 'mobs': if (fromHost && Array.isArray(m.m)) g.mobs.netList(m.m); break;
      case 'wild': if (fromHost && Array.isArray(m.w)) g.wildlife.netList(m.w); break;
      // Las flechas: las ve volar todo el mundo y la que ya no está, deja de verse (si se le da a alguien, to: a quién). La
      // clavada del otro se le pide a él para recogerla (arrowtake: ver archery.js)
      case 'arrow': g.archery.ghost(m, conn); break;
      // (un fallo en el juego de otro: el mundo del servidor lo saca en su terminal, uno por minuto y jugador)
      case 'fault': if (Profile.server && typeof m.text === 'string' && g.time - (peer.faultAt ?? -99) >= 60) { peer.faultAt = g.time; this.say?.(`Fallo en el juego de ${peer.name}: ${m.text.slice(0, 240)}`, 'sys'); } break;
      case 'arrowgone': g.archery.gone(m.id, Number.isFinite(m.to) ? m.to : null); break;
      case 'arrowtake': g.archery.asked(m.id, conn); break;
      case 'hitm': if (this.takes(peer)) g.mobs.hitBy(conn, peer, m); break;
      case 'hita': if (this.takes(peer)) g.hunt.hitBy(conn, peer, m); break;
      case 'preydead': if (fromHost) g.hunt.killed(m); break;
      case 'hurt': if (fromHost && this.joined && g.player && g.gamemode === 'survival' && g.combat.invuln <= 0 && Number.isFinite(m.dmg)) g.combat.hit(Math.min(20, m.dmg), { x: m.x, y: m.y }); break;
      case 'mobdead': if (fromHost) g.mobs.killed(m); break;
      // Lo que se tira al suelo
      case 'drop':
        if (this.joined && g.world) g.gather.drops.push({ id: m.id, extra: m.extra, count: m.k || 1, ttl: m.ttl, x: m.x, y: m.y, z: m.z, vz: m.vz, t: m.dt, scene: g.world, nid: m.n, owner: peer.id, free: !!m.free, back: !!m.back, born: g.time });
        break;
      case 'take': {
        const i = g.gather.drops.findIndex(d => d.nid === m.n);
        if (i >= 0) g.gather.drops.splice(i, 1);
        break;
      }
    }
  }
  // Si lo que pide alguien vale como de un op: lo es, o es el mundo del servidor (lo dice el servidor)
  trusted(conn, peer) { return !!this.isOp(peer.id) || this.serverConns.has(conn); }
  // (anfitrión) Los cambios del mundo que se aceptan: de los invitados (el mundo del servidor, también de quien lo
  // llevaba hasta que llegó). Lo que se toca, cerca de donde está quien lo toca (los op, donde sea: /fill)
  takes(peer) { return this.role === 'host' && (!peer.host || !!Profile.server); }
  mayEdit(peer, k) {
    if (!peer.at || this.isOp(peer.id)) return true;
    const [cx, cy] = k.split(',').map(Number);
    return Math.abs(wrapIndex(cx - Math.floor(peer.at[0] / CHUNK), CHUNK)) <= REACH && Math.abs(cy - Math.floor(peer.at[1] / CHUNK)) <= REACH;
  }
  // No se deja: se le devuelve como está aquí lo que intentó cambiar (una capa que aquí no hay, vacía si era de
  // casillas: su juego la vuelve a crear así, y quitársela del todo no acabaría nunca)
  refuse(conn, peer, k, ops) {
    const cur = this.game.world.deltas.get(k) || {}, isMap = v => !!v && typeof v === 'object' && !Array.isArray(v);
    const back = ops.map(([f, c, v]) => (c === undefined || c === null ? (cur[f] !== undefined ? [f, null, cur[f]] : isMap(v) ? [f, null, {}] : [f]) : cur[f]?.[c] === undefined ? [f, c] : [f, c, cur[f][c]]));
    this.net.send({ t: 'w', c: k, ops: back }, conn);
    if (peer.old) this.tellOld(conn, peer);
    else this.warn(peer, `${peer.name} ha intentado cambiar el mundo lejos de donde está (no se deja)`);
  }
  // ---------- versiones ----------
  // Cada juego dice su versión en el saludo (v; los de antes no la dicen: más viejos que cualquiera). El que tiene la
  // vieja no toca el mundo: si es tu juego, sales del mundo compartido (guardando) y se te pide recargar la página; si es
  // otro, quien lleva el mundo no le da el mundo ni le deja cambiarlo (old) y se lo dice. El mundo del servidor, si es él
  // el viejo, sigue llevándolo (lo que no conoce lo guarda tal cual: ver knownItem en items.js) y avisa en su terminal
  // de que hay que ponerlo al día (/update)
  checkVersion(peer, conn) {
    const cmp = compareVersions(peer.v, GAME_VERSION), g = this.game;
    peer.old = cmp < 0 && !peer.server;   // (al mundo del servidor viejo sí se le da el mundo: lo va a llevar igualmente)
    if (cmp > 0) {
      if (Profile.server) { if (this.toldNewer !== peer.v) { this.toldNewer = peer.v; this.say?.(`${peer.name} tiene una versión más nueva del juego (${peer.v}) que este mundo del servidor (${GAME_VERSION}): escribe /update en este terminal para ponerlo al día (si no lo conoce, cierra multijugador.py y vuelve a abrirlo).`, 'sys'); } }
      // (llevas el mundo y llega el mundo del servidor con la versión nueva, tras /update: antes de salir se lo das, con lo
      // hecho mientras se abría, que si no se perdería. Sales al pasárselo (yieldTo) o, si no lo pide, al rato)
      else if (this.joined && this.role === 'host' && peer.server && this.serverConns.has(conn)) this.outdatedLater(peer.v);
      else this.outdated(peer.v);
    } else if (cmp < 0 && peer.server && !this.toldServerOld && (Profile.admin || this.amOp)) {
      this.toldServerOld = true;
      const text = `El mundo del servidor tiene una versión anterior del juego (${peer.v || 'sin número'}): escribe /update en el terminal del servidor para ponerlo al día (si no lo conoce, cierra multijugador.py y vuelve a abrirlo).`;
      if (g.player) hud.toast(text); else this.serverOld = text;
      this.changed();
    }
  }
  // Hay una versión más nueva que la tuya (la tiene otro juego o el servidor): sales del mundo compartido y el menú lo dice
  // (si ya se sabía, solo no se repite el aviso: si has llegado a entrar, sales igual)
  outdated(v) {
    clearTimeout(this.outdatedTimer); this.pendingNewer = null;
    const fresh = this.newer === null || compareVersions(v, this.newer) > 0;
    if (fresh) this.newer = v;
    if (this.joined && this.game.player) {
      if (this.guest && this.hostConn !== null && this.pending.size) this.flush();   // (lo último que has hecho, a quien lo lleva)
      this.leave('outdated');
    }
    if (fresh) this.onOutdated?.(v);
  }
  outdatedLater(v) {
    if (this.pendingNewer) return;
    this.pendingNewer = v;
    this.outdatedTimer = setTimeout(() => this.outdated(v), WORLD_WAIT + HOST_WAIT);
  }
  // (anfitrión, o invitado que puede llegar a serlo) Lo de todos que este juego no conoce, de un juego más nuevo (o de
  // quien lo lleva): se guarda tal cual con el mundo (extraShared, ver worldOf) y quien lo lleva se lo reparte a los
  // demás, para que no vuelva atrás. (Por eso un blob nuevo de livesync.js se llama igual que su clave de SHARED)
  unknownBlob(peer, m, fromHost) {
    if (typeof m.name !== 'string' || !m.name || m.name in BLOBS || !(m.name in unknownShared({ [m.name]: 1 }))) return;   // (ni lo conocido ni lo retirado)
    if (fromHost) { this.extraShared[m.name] = m.v; return; }
    if (!this.takes(peer) || peer.old || compareVersions(peer.v, GAME_VERSION) <= 0) return;
    this.extraShared[m.name] = m.v;
    this.net.send({ t: 's', name: m.name, v: m.v });
  }
  // (anfitrión) A un juego con una versión vieja se le dice por el chat, que lo enseñan también los de antes de que se
  // mandara la versión; una vez por conexión. Y en el terminal del servidor, una vez
  tellOld(conn, peer) {
    if (peer.toldOld) return;
    peer.toldOld = true;
    this.net.send({ t: 'chat', say: true, text: 'Hay una versión nueva del juego: recarga la página.' }, conn);
    if (Profile.server) this.say?.(`${peer.name} tiene una versión anterior del juego (${peer.v || 'sin número'}): no puede tocar el mundo hasta que recargue la página.`, 'sys');
  }
  // (el mundo del servidor lo cuenta en el terminal; como mucho, una vez cada medio minuto por jugador)
  warn(peer, text) {
    if (!Profile.server || this.game.time - (peer.warned ?? -99) < 30) return;
    peer.warned = this.game.time;
    this.say?.(text, 'sys');
  }
  hide(peer) { peer.entity = null; peer.sc = null; }
  drop(conn, gone = false) {
    const peer = this.peers.get(conn);
    if (!peer) return;
    if (gone) {
      if (this.joined && peer.playing && this.game.player && !peer.server) hud.toast(`${peer.name} se ha desconectado`);
      this.peers.delete(conn);
      if (peer.host) this.hostGone();
      this.changed();
    } else this.hide(peer);
  }
  dropAll() { for (const p of this.peers.values()) this.hide(p); this.peers.clear(); this.changed(); }
  // El anfitrión se ha ido: lo sigue llevando el que antes llegó al servidor de los que quedan jugando (si eres
  // tú, desde ya; si es otro, se espera a que lo diga y, si no, lo llevas tú)
  hostGone() {
    if (!this.joined || !this.guest || !this.game.player || this.leaving || this.hostConn !== null) return;   // (ya lo lleva otro: el mundo del servidor)
    const me = this.net?.me;
    if (me === null || me === undefined) return this.leave('lost');
    const first = [...this.peers].filter(([, p]) => p.playing && !p.host).every(([c]) => c > me);
    clearTimeout(this.waitTimer);
    if (first) this.becomeHost();
    else this.waitTimer = setTimeout(() => { if (this.joined && this.guest && this.hostConn === null) this.becomeHost(); }, HOST_WAIT);
  }
  becomeHost() {
    const g = this.game, was = this.hostName || 'El anfitrión';
    this.role = 'host'; this.clockBase = null; this.hostName = g.player?.name || Profile.name;
    // (lo de todos por elementos: lo que el de antes no llegó a repartir, o lo tuyo que no llegó a aplicar, lo tienes tú y
    // no los demás, o al revés: la foto entera, ya, los deja a todos como tú)
    for (const s of Object.values(this.items)) s.inflight.clear();
    Object.assign(this, { ackHost: null, fullDue: true });
    for (const a of g.ranch.animals) { delete a.netTo; a.grazing = false; }   // (los animales y los niños, ahora los mueve tu juego)
    for (const e of g.family.ents.values()) delete e.netTo;
    this.hi();
    hud.toast(`Ahora el mundo compartido lo lleva tu juego (${was} ha salido)`, 'ok');
    this.onHost?.();
  }
  // Ha llegado el mundo del servidor mientras tu juego llevaba el mundo: desde ya lo lleva él (tiene el mundo tal cual:
  // se lo acaba de dar tu juego) y tú sigues jugando en él como uno más. En tu partida se guarda lo tuyo (el admin,
  // que guarda el mundo en la suya, con el mundo de ahora)
  yieldTo(conn) {
    const g = this.game;
    if (!this.solo) this.solo = { save: { ...g.snapshot(), worldAt: Date.now() }, deltas: new Map([...g.world.deltas].map(([k, d]) => [k, copy(d)])) };
    Object.assign(this, { role: 'guest', gaveTo: null, clockBase: { c: g.world.clock, at: g.time, run: true }, hostName: this.peers.get(conn)?.name || 'Servidor' });
    this.hi();
    hud.toast('Ahora el mundo compartido lo lleva el servidor', 'ok');
    this.onYield?.();
    if (this.pendingNewer) this.outdated(this.pendingNewer);   // (tiene una versión más nueva: ya tiene el mundo, sales)
  }
  // Salir del mundo compartido (se ha cortado la conexión, otro ya lo llevaba o el servidor te ha echado o se cierra)
  leave(why, text = '') {
    if (!this.game.player || this.leaving) return;
    this.leaving = true;
    this.onHostLeft?.(why, text);
  }

  // ---------- entrar sin anfitrión ----------
  // Se avisa a los demás de que vas a llevar el mundo y se espera un momento por si otro lo lleva o lo había
  // pedido antes. Devuelve true si te toca (y hasta join, contestas a los demás que lo llevas tú)
  async claim() {
    this.claimAt = Date.now(); this.lostClaim = false;
    this.net.send({ t: 'claim', at: this.claimAt });
    await new Promise(r => setTimeout(r, CLAIM_WAIT));
    if (this.lostClaim || this.host?.playing) { this.claimAt = null; return false; }
    return true;
  }
  unclaim() { this.claimAt = null; }
  // Espera a que alguien diga que lleva el mundo (true) o a que pase un rato (false)
  waitHost(ms = HOST_WAIT) {
    return new Promise(resolve => {
      const t0 = Date.now(), check = () => (this.host?.playing ? resolve(true) : Date.now() - t0 > ms ? resolve(false) : setTimeout(check, 150));
      check();
    });
  }

  // ---------- entrar en el mundo del anfitrión (invitado) ----------
  // Lo pide y espera a que llegue: { deltas, shared }
  requestWorld() {
    const conn = this.hostConn;
    if (conn === null || !this.host?.playing) return Promise.reject(new Error('El anfitrión no está jugando ahora.'));
    return new Promise((resolve, reject) => {
      this.wanted = { resolve, reject, timer: setTimeout(() => { this.wanted = null; reject(new Error('El mundo compartido no llega. Prueba otra vez.')); }, WORLD_WAIT) };
      this.net.send({ t: 'want' }, conn);
    });
  }
  // (anfitrión) Se lo manda: antes, lo que hubiera pendiente a los que ya están, para que todos partan de lo mismo
  sendWorld(conn) {
    const g = this.game, snap = g.snapshot();
    this.flush();
    if (this.syncMode() === 'items') this.flushItems();
    for (const [k, d] of g.world.deltas) if (!k.startsWith('u:') && !this.synced.has(k)) this.synced.set(k, copy(d));
    this.net.send({ t: 'world', ...this.worldOf(snap, g.world.deltas) }, conn);
  }
  // El mundo compartido tal como está (lo que se manda a quien entra y lo que guarda el anfitrión para todos), con
  // la ficha de su planeta (cada planeta, su archivo)
  worldOf(snap, deltas) { return { planet: PLANET, deltas: [...deltas].filter(([k]) => !k.startsWith('u:')), shared: { ...this.extraShared, ...Object.fromEntries(SHARED.map(k => [k, snap[k]])) } }; }
  // La partida con la que empieza quien entra en el mundo compartido: la suya, con ese mundo (y sus propias cuevas)
  enter(solo, world) {
    const her = solo.save;
    this.extraShared = unknownShared(world.shared);
    const save = { ...her, ...world.shared, player: { ...her.player, inside: false, boat: false, mount: false, ...(her.livePos || {}) } };
    const deltas = new Map(world.deltas);
    for (const [k, v] of solo.deltas) if (k.startsWith('u:')) deltas.set(k, v);
    return { save, deltas };
  }
  // Lo que se guarda en la partida del invitado: lo suyo de ahora, con su mundo de siempre (no el compartido)
  // y dónde se ha quedado en el compartido, para volver allí la próxima vez
  guestSave(snap, deltas) {
    const s = this.solo.save, { x, y, boat, mount } = snap.player, out = { ...snap, livePos: { x, y, boat, mount } };
    for (const k of SHARED) { if (k in s) out[k] = s[k]; else delete out[k]; }
    out.player = { ...snap.player, x: s.player.x, y: s.player.y, inside: s.player.inside, boat: s.player.boat, mount: s.player.mount };
    const d = new Map([...this.solo.deltas].filter(([k]) => !k.startsWith('u:')));
    for (const [k, v] of deltas) if (k.startsWith('u:')) d.set(k, v);
    return { save: out, deltas: d };
  }

  // ---------- en la partida ----------
  // Empieza a jugar con los demás: llevando tú el mundo compartido ('host') o en el que lleva otro ('guest').
  // solo: tu partida de siempre (lo que se guarda en la tuya; el admin, que guarda el mundo en la suya, sin ella
  // cuando lo lleva). O deja de hacerlo, al salir al menú.
  join(solo = null, role = solo ? 'guest' : 'host') {
    const g = this.game;
    Object.assign(this, { joined: true, role, solo, leaving: false, clockBase: null, claimAt: null, gaveTo: null, hostName: role === 'host' ? g.player?.name || '' : this.host?.name || '' });
    this.pending.clear(); this.synced.clear();
    if (solo) {
      for (const [k, d] of g.world.deltas) if (!k.startsWith('u:')) this.synced.set(k, copy(d));
      this.clockBase = { c: g.world.clock, at: g.time, run: true };
    }
    for (const [name, b] of Object.entries(BLOBS)) this.blobs[name] = JSON.stringify(b.get(g));
    for (const s of Object.values(this.items)) { s.reset(g); s.gone.clear(); }
    // (ackHost: a quien te ha dado el mundo; fullDue: el mundo del servidor que lo recibe de quien lo llevaba, la foto entera)
    Object.assign(this, { lastMode: null, wholeSent: {}, ackHost: role === 'guest' ? this.hostConn : null, fullDue: role === 'host' });
    this.hi();
  }
  left() {
    clearTimeout(this.waitTimer);
    if (!this.joined) return;
    this.joined = false; this.role = null; this.solo = null;
    this.net?.send({ t: 'st', sc: null });
    this.hi();
    for (const p of this.peers.values()) this.hide(p);
    for (const a of this.game.ranch.animals) { delete a.netTo; a.grazing = false; }
  }
  // El nombre de un jugador por su cuenta (de quien está jugando, o de la lista de cuentas)
  nameOf(id) {
    for (const peer of this.peers.values()) if (peer.id === id) return peer.name;
    return Profile.players?.().find(x => x.id === id)?.name || null;
  }
  // Un fallo nuevo de este juego, al terminal del servidor (si se juega en él): quien lo lleva se entera aunque no
  // mires el punto rojo. Solo lo que va cifrado al mundo del servidor (no a los demás), y como mucho uno por minuto
  sendFault(f) {
    if (!this.joined || Profile.server || !this.net || !this.serverConns.size) return;
    const now = Date.now();
    if (now - this.faultSent < 60000) return;
    this.faultSent = now;
    for (const c of this.serverConns) this.net.send({ t: 'fault', text: `${f.where}: ${f.message.slice(0, 200)}${f.place}` }, c);
  }
  knock([x, y]) { if (this.joined) this.net?.send({ t: 'knock', x: x + 0.5, y: y + 0.5 }); }
  chat(text, extra = {}, to = null) { if (this.joined) this.net?.send({ t: 'chat', text, ...extra }, to); }
  // Mandarle algo a otro jugador (lo que pide un op con un comando: ver fromOp en el juego)
  order(conn, m) { this.net?.send(m, conn); }
  // Otro jugador que esté contigo y cumpla near(entidad) (por ejemplo, en tu casa): { conn, peer } o null
  partner(near) {
    if (!this.joined) return null;
    for (const [conn, peer] of this.peers) if (peer.playing && peer.sc === 'world' && peer.entity && near(peer.entity)) return { conn, peer };
    return null;
  }
  // Un trozo del mundo ha cambiado (lo avisa el mundo)
  touched(k) { if (this.joined && !k.startsWith('u:')) this.pending.add(k); }

  // Manda los cambios de los trozos pendientes: el invitado, al anfitrión; el anfitrión, a todos
  flush() {
    const w = this.game.world, to = this.guest ? this.hostConn : null;
    for (const k of this.pending) {
      const cur = w.deltas.get(k), ops = diffChunk(this.synced.get(k), cur);
      this.synced.set(k, copy(cur) || {});
      if (ops.length && (to !== null || !this.guest)) this.net.send({ t: 'w', c: k, ops }, to);
    }
    this.pending.clear();
  }
  // Llegan cambios de un trozo. Al invitado le llegan del anfitrión (y quedan como lo último que se sabe); al
  // anfitrión, de un invitado: los aplica y, en su próxima vuelta, los reparte a todos.
  applyChunk(k, ops) {
    const w = this.game.world, [cx, cy] = k.split(',').map(Number);
    applyOps(w.delta(cx, cy, true), ops);
    if (this.guest) { const s = this.synced.get(k) || {}; applyOps(s, ops); this.synced.set(k, s); }
    w.touch(cx, cy);
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) if (dx || dy) w.merged.delete(`${cx + dx},${cy + dy}`);   // (tejados y vallas miran a sus vecinas)
  }

  // ---------- lo de todos, elemento a elemento ----------
  // Cómo se reparten ahora los animales, la familia y la granja: 'items' (por elementos), 'whole' (enteros, como los juegos
  // de antes: lo lleva uno de antes, como el mundo del servidor hasta que se pone al día) o null (sin nadie que lo lleve:
  // lo cambiado espera a que haya)
  syncMode() {
    if (!this.guest) return 'items';
    const h = this.host;
    return h && this.hostConn !== null ? (h.perItem ? 'items' : 'whole') : null;
  }
  // (de enteros a por elementos no hace falta nada: lo repartido ya es lo último que se mandó o llegó entero, ver tick, y
  // lo cambiado desde entonces se manda; sin nadie que lo lleve, igual)
  switchMode(mode) {
    const g = this.game, was = this.lastMode;
    this.lastMode = mode;
    // (de por elementos a enteros: lo tuyo entero no se manda de golpe, que pisaría lo que acaba de pasar allí)
    if (mode === 'whole' && was === 'items') for (const name of Object.keys(COLLECTIONS)) this.blobs[name] = JSON.stringify(BLOBS[name].get(g));
  }
  // (invitado) Lo lleva otro (o es el primero al que se lo mandas): lo tuyo que el de antes no llegó a aplicar vuelve a
  // quedar por mandar, ahora a este, y sus números de envío aplicado son otros
  retarget(conn) {
    this.ackHost = conn;
    for (const s of Object.values(this.items)) s.unsend();
  }
  // Lo cambiado de cada elemento: el invitado, a quien lleva el mundo (con su número); quien lo lleva, a todos (con hasta
  // qué número ha aplicado de cada uno; si toca, la foto entera, aunque no haya nada). only: solo esa colección
  flushItems(only = null) {
    const g = this.game, to = this.guest ? this.hostConn : null;
    if (!this.net || (this.guest && to === null)) return;
    if (this.guest && to !== this.ackHost) this.retarget(to);
    const full = !this.guest && this.fullDue && !only;
    if (full) this.fullDue = false;
    for (const [name, sync] of Object.entries(this.items)) {
      if (only && name !== only) continue;
      if (full) { this.net.send({ t: 'el', name, ops: sync.full(g), ack: this.acks(), full: 1 }); continue; }
      const seq = this.guest ? this.seq + 1 : null, ops = sync.diff(g, seq);
      if (!ops.length) continue;
      if (this.guest) { this.seq = seq; this.net.send({ t: 'el', name, ops, seq }, to); }
      else this.net.send({ t: 'el', name, ops, ack: this.acks() });
    }
  }
  // (quien lleva el mundo) Hasta qué envío de cada uno ha aplicado: conexión → seq
  acks() {
    const out = {};
    for (const [conn, p] of this.peers) if (p.seq !== undefined) out[conn] = p.seq;
    return out;
  }
  // (quien lleva el mundo) A los juegos de antes que juegan en él (el mundo del servidor viejo mientras se le da el mundo),
  // los animales, la familia y la granja, enteros, cuando cambian: no entienden los elementos
  sendWhole() {
    const old = [...this.peers].filter(([, p]) => p.playing && !p.perItem).map(([c]) => c);
    if (!old.length) { this.wholeSent = {}; return; }
    for (const name of Object.keys(COLLECTIONS)) {
      const s = JSON.stringify(BLOBS[name].get(this.game));
      if (s === this.wholeSent[name]) continue;
      this.wholeSent[name] = s;
      for (const c of old) this.net.send({ t: 's', name, v: JSON.parse(s) }, c);
    }
  }

  // Lo que se tira al suelo (o suelta algo al romperse): lo ven todos y lo puede recoger cualquiera. Lo que
  // suelta algo al romperse, los primeros segundos solo quien lo rompió; lo tirado a propósito (sale con t < 0,
  // porque tarda en poderse recoger), los primeros segundos solo los demás: así se dan cosas.
  dropped(d) {
    const g = this.game;
    if (!this.joined || d.scene !== g.world || !this.net?.ready) return;
    Object.assign(d, { nid: `${Profile.id}:${session}:${++this.dropN}`, owner: Profile.id, born: g.time, free: d.t < 0 });
    this.net.send({ t: 'drop', n: d.nid, id: d.id, extra: d.extra, k: d.count > 1 ? d.count : undefined, ttl: d.ttl, x: r2(d.x), y: r2(d.y), z: d.z, vz: r2(d.vz), dt: d.t, free: d.free, back: d.back ? 1 : undefined });
  }
  mayTake(d) {
    if (!d.owner) return true;
    const age = this.game.time - d.born;
    return d.owner === Profile.id ? !d.free || age > GIVE_FIRST : d.free || age > MINE_FIRST;
  }
  taken(d) { if (d.nid && this.joined) this.net?.send({ t: 'take', n: d.nid }); }

  // Cada paso, también con el juego en pausa o con el inventario abierto
  tick(dt) {
    const g = this.game, p = g.player;
    for (const peer of this.peers.values()) peer.entity?.update(dt, peer.sc === 'world' ? g.world : null);
    if (!this.joined || !p) return;
    // El invitado: la hora y los animales, como los lleva el anfitrión
    if (this.guest) {
      const b = this.clockBase;
      if (b) g.world.clock = b.c + (b.run ? g.time - b.at : 0);
      const k = 1 - Math.exp(-dt * 8);
      for (const a of g.ranch.animals) {
        if (!a.netTo || a.inside) continue;   // (dentro, en su sitio del establo)
        const dx = (a.netTo[0] - a.x) * k, dy = (a.netTo[1] - a.y) * k, moving = Math.abs(dx) + Math.abs(dy) > 1e-3;
        a.x += dx; a.y += dy; a.vx = moving ? dx / dt : 0; a.vy = moving ? dy / dt : 0;
      }
    }
    if (!this.net?.ready || !this.net.key) return;
    const T = this.timers;
    for (const k in T) T[k] += dt;
    // Los cambios del mundo y lo de todos
    if (T.sync >= SYNC_EVERY) { T.sync = 0; if (this.pending.size && (!this.guest || this.hostConn !== null)) this.flush(); }   // (sin anfitrión, se guardan hasta que haya)
    if (T.blob >= BLOB_EVERY) {
      T.blob = 0;
      const mode = this.syncMode();
      if (mode !== this.lastMode) this.switchMode(mode);
      for (const [name, b] of Object.entries(BLOBS)) {
        if (COLLECTIONS[name] && mode !== 'whole') continue;   // (por elementos, abajo; sin nadie que lo lleve, esperan)
        const s = JSON.stringify(b.get(g));
        if (s === this.blobs[name]) continue;
        this.blobs[name] = s;
        if (!this.guest || this.hostConn !== null) this.net.send({ t: 's', name, v: JSON.parse(s) }, this.guest ? this.hostConn : null);
        if (this.items[name]) this.items[name].reset(g, JSON.parse(s));   // (lo repartido por elementos, desde lo mandado entero)
      }
      if (mode === 'items') {
        if (this.role === 'host' && T.full >= FULL_EVERY) { T.full = 0; this.fullDue = true; }
        this.flushItems();
      }
      if (this.role === 'host') this.sendWhole();
    }
    if (this.role === 'host') {
      if (T.time >= TIME_EVERY) { T.time = 0; this.net.send({ t: 'time', c: r2(g.world.clock), run: g.mode === 'play', sh: g.days.shift, db: g.days.dayBase }); }
      if (T.herd >= HERD_EVERY && this.others.some(o => o.playing)) { T.herd = 0; this.net.send({ t: 'herd', p: g.ranch.animals.map(a => [r2(a.x), r2(a.y), a.inside ? 1 : 0, a.grazing ? 1 : 0, a.id]), k: g.family.positions() }); }
    }
    if (Profile.server) return;   // (el mundo del servidor no tiene personaje que los demás vean)
    // (/setidletimeout: si llevas los minutos que diga sin moverte, se lo dices al servidor, que te echa)
    if (this.idleMinutes > 0 && g.time - (g.lastInput ?? g.time) > this.idleMinutes * 60) { if (!this.idleSent) { this.idleSent = true; this.net.sendServer({ t: 'idle' }); } }
    else this.idleSent = false;
    // Cómo va uno. Cada golpe nuevo con la herramienta (el temporizador sube), para que los demás vean el gesto.
    if (g.gather.swing > this.lastSwing + 1e-4) this.swings++;
    this.lastSwing = g.gather.swing;
    // (el aspecto se rehace con cada cambio del inventario: solo se manda si de verdad ha cambiado la ropa)
    const look = g.appearance();
    if (look !== this.lastLook) {
      this.lastLook = look;
      const json = JSON.stringify(look);
      if (json !== this.lastLookJson) { this.lastLookJson = json; this.net.send({ t: 'look', look }); }
    }
    this.sent += dt;
    const sc = g.scene === g.world ? 'world' : null;
    const st = { t: 'st', sc, x: r2(p.x), y: r2(p.y), z: r2(p.z || 0), fl: p.floor ? r2(p.floor) : undefined, yaw: r2(g.view3d.actors.player?.person.facing ?? 0), in: p.inside ? 1 : 0, po: p.pose ? [POSES.indexOf(p.pose.kind), r2(p.pose.yaw), r2(p.pose.h)] : 0, m: p.mount ? 1 : 0, hc: p.mount ? p.horseCoat || null : null, hb: p.mount && p.horseBags ? 1 : 0, b: p.boat ? 1 : 0, pa: p.aboard || 0, cr: p.crouch ? 1 : 0, gm: g.gamemode === 'survival' ? 0 : g.gamemode === 'creative' ? 1 : 3, h: g.inv.held?.id || null, sw: this.swings, si: g.gather.swingItem || null, cd: r2(g.gather.cooldown || 0), dr: r2(g.archery.k), na: p.swim ? 1 : 0, hu: p.swim ? r2(p.sink) : undefined };
    const key = JSON.stringify(st);
    if (this.sent < SEND_EVERY || (key === this.lastSent && this.sent < IDLE_EVERY)) return;
    this.sent = 0; this.lastSent = key;
    this.net.send(st);
  }
  // Los demás jugadores que están en esta escena (para dibujarlos)
  entities(scene) {
    if (!this.joined || scene !== this.game.world) return null;
    const ghosts = this.game.gamemode === 'spectator';   // (los espectadores solo los ven los otros espectadores)
    return this.others.filter(p => p.sc === 'world' && p.entity && (p.entity.gm !== 3 || ghosts)).map(p => p.entity);
  }
}

// El panel de depuración (F3, como en Minecraft): cuánto cuesta cada fotograma (simulación y dibujo), qué dibuja
// la gráfica, cuánta memoria hay en uso, qué trozos y bloques de suelo están hechos, dónde está el jugador (casilla,
// trozo, bioma, luz, latitud y longitud), la hora y el tiempo, y cuántas criaturas, animales y vecinos hay. Para
// medir sin improvisar: cuando algo va lento, aquí se ve qué parte es.
import { CENTER } from '../world/village.js';
import { CHUNK } from '../world/gen.js';
import { BIOMES } from '../world/biomes.js';
import { latOf, lonOf, dxOf } from '../world/planet.js';
import { SEASONS } from '../art/seasons.js';
import { GAMEMODES } from '../game.js';
import { vramOf } from '../three/vram.js';
import { apagadas } from '../opciones.js';
import { faults, recentFaults, faultLabel } from '../faults.js';

const $ = id => document.getElementById(id);
const n1 = v => v.toFixed(1).replace('.', ',');
const clock = h => { const m = Math.round(h * 60) % 1440; return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`; };
const MB = b => `${Math.round(b / 1048576)} MB`;
const esc = t => t.replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c]);   // (el panel es HTML; un mensaje de error, no)

export function initDebug(game) {
  const el = $('debug');
  const version = document.querySelector('meta[name="miniverse-version"]')?.content || '';
  let timer = 0;
  // Lo del bucle desde la última vez que se miró (medias y el fotograma más largo)
  function frameStats() {
    const p = game.perf;
    if (!p || !p.frames) return 'sin fotogramas';
    const out = `<b>${(p.frames / 0.5).toFixed(0)} fps</b> · fotograma ${n1((p.update + p.draw) / p.frames)} ms (máx ${n1(p.max)}) · simulación ${n1(p.update / p.frames)} ms · dibujo ${n1(p.draw / p.frames)} ms · ${(p.steps / 0.5).toFixed(0)} pasos/s`;
    p.frames = p.steps = 0; p.update = p.draw = p.max = 0;
    return out;
  }
  // Las cifras de cada parte del dibujo, juntas en un bloque: el relieve, la hierba, los árboles lejanos, las sombras, la
  // sombra de contacto, las personas y los programas de sombreado. Cada línea, la parte y lo suyo; arriba, las que la
  // dirección deja como antes (ver opciones.js), para no leer unas cifras creyendo que son las de ahora
  function parts(v) {
    const out = [], row = (k, t) => out.push(`  <b>${k}</b> ${t}`), off = apagadas();
    out.push(`<b>por partes</b>${off.length ? ` · como antes por la dirección: ${off.map(p => `?${p}=0`).join(' ')}` : ''}`);
    const rs = v.terrain?.stats;
    if (rs && (rs.calc || rs.hits)) row('relieve', `${rs.hits} bloques guardados (${n1(rs.msHit / Math.max(1, rs.hits))} ms cada uno) · ${rs.calc} calculados (${n1(rs.msCalc / Math.max(1, rs.calc))} ms) · mallas ${n1(rs.msBuild / Math.max(1, rs.built))} ms` + (rs.padded ? ` (allanar ${n1(rs.msPad / rs.padded)} ms en ${rs.padded})` : ''));
    if (v.world) {
      // (las matas de hierba por trozo: cuántas mallas, con qué nivel de detalle, y cuántas matas se mandan a dibujar)
      let n = 0, hid = 0, matas = 0; const lod = [0, 0, 0];
      for (const b of v.world.nature.values()) for (const pc of b.tufts?.values() || []) { if (!pc.tufts) continue; n++; if (!pc.tufts.visible) { hid++; continue; } lod[pc.lod]++; matas += pc.tufts.count; }
      if (n) row('hierba', `${n} trozos (cerca ${lod[0]} · media ${lod[1]} · lejos ${lod[2]} · fuera ${hid}) · ${matas} matas`);
    }
    // (los árboles lejanos: si el atlas está listo o cuánto le queda, y los bloques de cerca que se están fundiendo)
    const imp = v.world?.impostorStats?.();
    if (imp) row('lejos', imp.replace(/^impostores: /, 'impostores '));
    // (el mapa de sombras: cuántas veces por segundo se repinta lo fijo y cuánto cuesta lo que se mueve en cada fotograma)
    if (v.shadows) row('sombras', v.shadows.text().replace(/^sombras: /, ''));
    // (la sombra de contacto: lo que falta por pintar y subir, y lo que cuesta en este hilo)
    if (v.terrain?.contact?.on) row('contacto', v.terrain.contact.text().replace(/^[^:]*: /, ''));
    const a = v.actors?.stats;
    if (a) row('personas', `${a.modelos} · ${a.vistas} vistas · ${a.dormidas} dormidas · a todo ${a.t0} / 30 Hz ${a.t1} / 15 Hz ${a.t2} · de lejos ${a.lod1} · ${(a.tris / 1000).toFixed(0)}k triángulos${a.protos !== undefined ? ` · ${a.protos} mallas en caché (${a.protosLibres} sin usar), ${a.lienzos} lienzos` : ''}${Number.isFinite(v.actorsMs) ? ` · actores ${n1(v.actorsMs)} ms` : ''}`);
    // (los programas de sombreado: cuántos hay, los que se compilaron antes de pintar al entrar y lo nuevo que esperó a
    // los suyos escondido en vez de parar el juego (y lo de cerca, que no espera); ver engine.js, prepare, gate y gateNear)
    const g = v.gateStats, r = v.renderer;
    if (g && r) row('programas', `${r.info.programs?.length ?? '?'} · al entrar, ${g.prep} pedidos antes de pintar (${n1(g.prepMs)} ms de este hilo) · después, ${g.held} cosas esperaron a los suyos (la que más, ${n1(g.ms / 1000)} s), ${g.near} cerca sin esperar, ${g.known} ya vistos listos, ${g.asked} preguntados (${n1(g.askMs)} ms)${v.gated?.length ? ` · ${v.gated.length} esperando` : ''}${g.top ? ` · al tope: ${g.top}` : ''}`);
    return out;
  }
  function text() {
    const v = game.view3d, r = v.renderer, info = v.lastInfo || { calls: 0, triangles: 0 }, mem = r?.info.memory, sc = game.scene, w = game.world, p = game.player, lines = [];
    lines.push(`<b>Miniverse ${version}</b> · F3 cierra`);
    lines.push(frameStats());
    if (r) lines.push(`dibujo: ${info.calls} llamadas · ${(info.triangles / 1000).toFixed(0)}k triángulos · ×${v.pixelRatio.toFixed(2)} (${Math.round(innerWidth * v.pixelRatio)}×${Math.round(innerHeight * v.pixelRatio)}) · sombras ${r.shadowMap.enabled ? 'sí' : 'no'}`);
    // (lo que ocupan en la gráfica las texturas, compartidas una vez, y los búferes de dibujo: mapas de sombras, atlas…)
    const vr = r && vramOf(r.getContext());
    if (mem) lines.push(`memoria: ${mem.geometries} geometrías · ${mem.textures} texturas${vr ? ` (${Math.round(vr.texMB)} MB en la gráfica, más ${Math.round(vr.rbMB)} MB de búferes)` : ''} · ${r.info.programs?.length ?? '?'} programas${performance.memory ? ` · JS ${MB(performance.memory.usedJSHeapSize)}` : ''}`);
    if (v.world && v.terrain) {
      const T = v.terrain;
      lines.push(`trozos: ${v.world.chunks.size} cerca · ${v.world.nature.size} bloques de naturaleza · ${v.world.far.size} lejanos · ${v.world.regions.size} tejados · suelo ${T.blocks.size} bloques (${T.pending.size} pedidos, ${T.jobs.size} trabajos, ${T.workers.length} hilos) · caché ${w?.merged.size ?? 0} trozos, ${w?.gen.cache.size ?? 0} naturaleza, ${w?.gen.biomes.size ?? 0} biomas`);
    }
    if (p && sc) {
      const inWorld = sc === w, tx = Math.floor(p.x), ty = Math.floor(p.y);
      let where = `posición <b>${Math.round(dxOf(p.x, CENTER.x))}, ${Math.round(p.y - CENTER.y)}</b> (x ${n1(p.x)} y ${n1(p.y)} z ${n1(p.z || 0)}) · casilla ${tx},${ty} · trozo ${Math.floor(tx / CHUNK)},${Math.floor(ty / CHUNK)}`;
      if (inWorld) where += ` · bioma ${BIOMES[w.gen.biomeAt(tx + 0.5, ty + 0.5)].name} · luz ${game.mobs?.lightAt(tx, ty) ?? '?'} · lat ${n1(latOf(p.y))}° lon ${n1(lonOf(p.x))}°${p.inside ? ' · dentro' : game.underRoof ? ' · bajo techo' : ''}`;
      else where += ` · ${sc.kind === 'grid' ? `${sc.name || 'cueva o mazmorra'}${/nivel/.test(sc.name || '') ? '' : ` (nivel ${sc.depth ?? '?'})`}` : sc.kind}`;
      lines.push(where);
    }
    const d = game.days;
    if (d) lines.push(`hora ${clock(d.hour)} (aquí ${clock(d.localHour)}) · ${SEASONS[d.localSeason].toLowerCase()} · tiempo ${d.weatherHere} · día ${d.dayIndex} · modo ${GAMEMODES[game.gamemode] || game.gamemode} · dificultad ${game.difficulty} · t ${Math.round(game.time)} s`);
    lines.push(...parts(v));
    const l = game.live;
    // (los últimos fallos distintos, si los ha habido: el punto rojo de abajo a la derecha dice el último; ver faults.js)
    if (faults.last) {
      lines.push(`<span class="bad">errores: ${faults.total}${faults.kinds > 1 ? ` (${faults.kinds} distintos)` : ''}</span>`);
      for (const k of recentFaults(4)) lines.push(`<span class="bad">· hace ${Math.round((Date.now() - k.at) / 1000)} s, en ${esc(faultLabel(k.where))}${faultLabel(k.where) !== k.where ? ` (${esc(k.where)})` : ''}${k.n > 1 ? `, ${k.n} veces` : ''}: ${esc(k.message)}${k.place}</span>`);
    }
    lines.push(`entidades: ${game.mobs?.list.length ?? 0} criaturas · ${game.wildlife?.list.length ?? 0} salvajes · ${game.ranch?.animals.length ?? 0} animales · ${game.neighbors?.people.length ?? 0} vecinos · ${game.gather.drops.length} en el suelo · juntos: ${l?.joined ? `${l.role === 'host' ? 'anfitrión' : 'invitado'}, ${l.others.filter(o => o.playing).length} más` : l?.status || 'no'}`);
    return lines.join('\n');
  }
  function paint() { if (!el.hidden) el.innerHTML = text(); }
  return {
    get on() { return !el.hidden; },
    toggle(on = el.hidden) {
      el.hidden = !on;
      clearInterval(timer);
      if (on) { if (game.perf) { game.perf.frames = game.perf.steps = 0; game.perf.update = game.perf.draw = game.perf.max = 0; } timer = setInterval(paint, 500); paint(); }
      return on;
    },
  };
}

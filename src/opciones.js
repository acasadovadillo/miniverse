// Los interruptores de la dirección, en un solo sitio y con una sola regla, para comparar en el mismo código lo de
// ahora con lo de antes (el banco, las pruebas a mano, F3):
//   ?<parte>=0      esa parte, como estaba antes de mejorarla
//   ?<parte>=<otro> para mirarla (solo donde se dice: ?contacto=ver, ?contacto=rojo)
// Las partes: hierba (todas las hojas a cualquier distancia), impostores (los árboles sencillos de lejos), relieve (sin
// guardarlo en el navegador), contacto (sin sombra de contacto), sombras (todo el mapa cada dos fotogramas), personas
// (todas a todo, sin dormidas ni detalle de lejos) y suelo (el de antes del 2026-11-10). Los nombres de antes siguen
// valiendo: ?hierba=sinlod, ?sombras=todas, ?personas=todas, ?suelo=v2. And inventario: ?inventario=casillas (or =0) is
// the slot inventory of before the weight one (carry.js weightMode), a temporary way back. Aparte, ?q=low (menos calidad) y
// ?relieve-max=N (cuántos bloques del relieve se guardan), que no son volver a lo de antes.
// También en los hilos: cada uno lee la dirección con la que se creó (terrain.js le pasa al del suelo lo que le toca)
const RAW = (() => { try { return new URLSearchParams(globalThis.location?.search || ''); } catch { return new URLSearchParams(); } })();
// (cada parte, con el valor que tenía antes para lo mismo)
// Plan D (status bars and diving, docs/planes/gta/PLAN-D-barras-buceo.md), each with ?x=0: sed (thirst stays full, its
// row hidden), cansancio (rest stays 100, no stamina cap), aguante (stamina: unlimited sprint, no row), buceo (no diving
// and no underwater camera; crouch and sink as before), fondo (no seabed decor and no deep bed paint: drawing only) and
// caustica (no caustics, a compile-time define). None of them changes gen or the relief, so peers stay in step
// Plan J (marked route and dynamic music, docs/planes/gta/PLAN-J-ruta-musica.md §7): ruta (?ruta=0: no routes at all, map
// clicks do nothing, no worker, no pin; ?ruta=ver: the big map tints the cells the last search expanded and F3 shows its
// ms and nodes), rutasuelo (?rutasuelo=0: no ground ribbon, the maps and the pin stay) and musica (?musica=0 or
// ?musica=chip: today's music exactly, music.js LegacyMusic chosen at load; ?musica=ver: F3 shows mood, intensity, live
// voices and the last cue). Local only: none changes gen, saves or the network
// Plan E (the body and how you look, docs/planes/gta/PLAN-E-cuerpo-aspecto.md §11), each with ?x=0: cuerpo (no surface
// at all: no dirt, mud, wet, snow or blood, neither gained nor drawn), frio (no temperature effects: body factors 1, no
// chip), crecer (hair and beard growth never applied to the look), desgaste (clothes never gain tear) and comentarios (no
// neighbour remarks). None of them changes gen or the world either
// Plan F (the horse, docs/planes/gta/PLAN-F-caballo.md §8), each with ?x=0: vinculo (no horse stamina: an unlimited
// gallop as before; no spooks, tricks, N key, dirt, horse bar or new bond gains: brushing or a carrot is +1 heart as
// before) and alforjas (no saddlebag lock or guard: last write wins as before; new bags get 9 stacks, B and C never pay
// from them, no kg in the title). Neither changes gen or the save shape (the fields just stay unused)
// And ui (not a part: ui/skin.js reads it): ?ui=madera, the wooden interface of before, for one version; ?ui=cristal, the
// glass, whatever Settings › Look says
// And menuart (not a part either: ui/keyart.js): ?menuart=winter, night, rider, summer-night… the picture behind the menus
// Plan R4-1 (riding with weight, docs/planes/realismo/PLAN-R4-caballo.md): montar (?montar=arcade or =0: the horse turns
// and brakes more sharply and never collects itself, whatever Ajustes › Juego › Montar says). Local only
// And R4-2 (horsecare.js): cuidado (?cuidado=0: no hunger, thirst, shoe wear or soreness: shoes last for ever, horses eat nothing
// at night and the horse's card is not shown). On the host it also stops the overnight care; the fields stay unused
// And R4-3 (horsebreeds.js): razas (?razas=0: every horse is an average Spanish one, in how it goes and how it looks, and Rosa
// sells none; the fields stay as they are)
// Plan G (tracking and the nature book, docs/planes/gta/PLAN-G-caza.md §10), each with ?x=0: tracks (no prints, blood or
// bent grass, made or drawn; no crouch aid, track tag or E study: local only), wounds (the host runs hits as before:
// heal after 30 s, gone beyond 42 m, no bleed sent, no vital multiplier; a guest's switch does nothing) and naturebook
// (no study ray or ring, no Nature tab, no book hooks: Collections as before, a save's `nature` kept untouched). None of
// them changes gen, so peers stay in step
// Plan R5-1 (building that holds, docs/planes/realismo/PLAN-R5-construccion.md), each with ?x=0: soporte (a roof goes on any
// floor or wall, doors go anywhere, a wall under a roof can be taken away, and removing gives everything back with a click,
// as before; swapping stays) and refugio (no rooms: under any roof the same warmth, and the old names). Local only
// And R5-2 (plan and hammer): obra (?obra=0: in survival too, a piece is placed at once and paid then, with no hammer; the plans
// already drawn stay, and can be erased). Local only
// And R5-3 (wear and repair, src/wear.js): deterioro (?deterioro=0: nothing built ages, leaks or lets the air in here, nor is it
// drawn worn; in the game that runs the world, the clock of the wear stops too)
// Plan R3-1 (the wild animals' senses, docs/planes/realismo/PLAN-R3-caza.md): sentidos (?sentidos=0 on the host: they run from
// whoever comes within their fear radius, as before; no heel or point of the dog; nor the ring and the wind mark)
// Plan R3-2 (herds, src/herds.js): manadas (?manadas=0 on the host: single animals at random round each player, as before)
// Plan R3-3 (clean kills, src/quality.js): calidad (?calidad=0: no record is written or read: no stars, nothing to gut, the yields
// and the weights of before; the carcasses that have one keep it untouched)
// Plan R8-2 (the maps, docs/planes/realismo/PLAN-R8-hud-mapa.md): sat (?sat=0: the maps' ground as before, 1 px per tile made
// in the game's own thread; no satellite pictures, nothing built on them)
// Plan R8-5 (the big map in 3D, src/three/map3d.js): mapa3d (?mapa3d=0: the big map is always flat)
// Plan H1 (the neighbours' routines, docs/planes/gta/PLAN-H-pueblo-vivo.md §2): routines (?routines=0: the hours of before,
// no weekdays, meals, bed, market or chapel gathering). Local: on one's own it only changes where they are drawn; the host's
// world is the same
// Plan R7-1 (sites and names, docs/planes/realismo/PLAN-R7-mundo.md): sitios (?sitios=1 or =0: the places where they were
// before, one roll per chunk, without the ruins; the world's list is neither made nor changed). To compare, playing alone
// Plan R7-3 (variety and hamlets): lugares (?lugares=1 or =0: the sites with the shapes they had before, to compare; the list of a
// world is not looked at with it, so nothing of it is saved)
// Plan R7-2 (looking from above): siluetas (?siluetas=0: no landmarks far off, three/landmarks3d.js). Drawing only
// Plan R2-F (weeds and pests in the garden, src/pests.js): pests (?pests=0: in the game that runs the world, no weeds come up and
// no animals eat; here, none are seen coming to the garden. What there was stays)
// Plan R6.3 (the village talks, docs/planes/realismo/PLAN-R6-gente.md): gossip (?gossip=0: nothing is written in the log of what
// you do, nor told, nor does it make anybody cold; what is saved stays) and chatter (?chatter=0: the neighbours do not talk among
// themselves). Local only. Plan R6.4: rumores (?rumores=0: nobody tells you of places; the circles are not drawn)
// Plan H2 (the players' own businesses, src/business.js): shops (?shops=0: in this game the counters do nothing and their goods and
// customers are not drawn. Whoever runs the world goes on making the sales, so everybody's world is the same)
export const PARTES = { hierba: 'sinlod', impostores: null, relieve: null, contacto: null, sombras: 'todas', personas: 'todas', suelo: 'v2', inventario: 'casillas',
  sed: null, cansancio: null, aguante: null, buceo: null, fondo: null, caustica: null,
  ruta: null, rutasuelo: null, musica: 'chip',
  cuerpo: null, frio: null, crecer: null, desgaste: null, comentarios: null,
  vinculo: null, alforjas: null, montar: 'arcade', cuidado: null, razas: null,
  tracks: null, wounds: null, naturebook: null,
  sentidos: null, manadas: null, calidad: null, routines: null,
  soporte: null, refugio: null, obra: null, deterioro: null, sat: null, mapa3d: null, sitios: '1', siluetas: null, lugares: '1', gossip: null, chatter: null, rumores: null, pests: null, shops: null };

// El valor tal cual (o null)
export const opcion = k => RAW.get(k);
// ¿Está esta parte como antes?
export const apagada = parte => { const v = RAW.get(parte); return v !== null && (v === '0' || v === PARTES[parte]); };
// Las que están como antes (para F3 y el banco)
export const apagadas = () => Object.keys(PARTES).filter(apagada);
// Lo que hay que pasarle a un hilo para que vea lo mismo: '&parte=0' por cada una de las que le tocan
export const paraHilo = partes => partes.filter(apagada).map(p => `&${p}=0`).join('');

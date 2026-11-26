// Glass (phase R2-G, docs/planes/realismo/PLAN-R2-huerto.md §3.11): the greenhouse, a room built with B from glass walls and a
// roof of glass, and the cloche, a glass bell over one plant. What they do to a field's day and where there is one; farm.js asks.
//   GreenRooms(world).at(tx, ty)   how well the tile is under glass: NONE, OPEN (a glass roof over it, but the room has no
//       wall somewhere: it keeps the rain and the snow off, and the air is the one outside), AIRED (an open door: half the
//       warmth) or SHUT. The tile's own roof must be of glass; the walls, anything a room has (structure.js: what closes it
//       is the same). It looks at what is built, not at what is drawn: the host asks it every morning for beds nobody is near
//   glassDay(F, level, out)        a field's day (fieldclimate.js) under glass
//   d.cover[k] = 'cloche'          (chunk) a cloche on a tilled tile
// What was planted before and has no glass over it is not asked for anything here.
import { PIECES, parsePlaced } from './pieces.js';
import { CHUNK } from './world/gen.js';
import { wrapX } from './world/planet.js';

export const GLASS_WALL = 'glass_wall', GLASS_ROOF = 'glass_roof', CLOCHE = 'cloche';
export const NONE = 0, OPEN = 1, AIRED = 2, SHUT = 3;
// °C more by day and by night, what is left of the drying, and how much of the warmth an open door leaves; from how many
// tiles on a room is too big to keep any of it
export const GLASS = { mean: 8, min: 6, dry: 0.7, aired: 0.5, max: 400 };
// °C more by night, what is left of the drying and how far the rain wets the soil under it; the crops that grow taller or
// wider than any bell; and the bell each one takes as it grows (its ages 1, 2 and 3: glass3d.js BELLS)
export const BELL = { min: 4, dry: 0.5, rain: 60, big: new Set(['maiz', 'potato']), size: { nabo: [1, 1, 2], fresa: [1, 1, 1], zanahoria: [1, 2, 2], tomate: [3, 4, 5], trigo: [3, 3, 4], calabaza: [1, 2, 6], broad_bean: [3, 3, 4], cabbage: [1, 2, 6], garlic: [2, 7, 7] } };
export const bellSize = (id, age) => BELL.size[id]?.[Math.max(1, age) - 1] || (age > 1 ? 2 : 1);

export const glassK = level => (level === SHUT ? 1 : level === AIRED ? GLASS.aired : 0);
// F: the field's day; out (reused; not F): the same under glass
export function glassDay(F, level, out) {
  const k = glassK(level);
  out.mean = F.mean + GLASS.mean * k; out.max = F.max + GLASS.mean * k; out.min = F.min + GLASS.min * k;
  out.season = F.season; out.weather = F.weather;
  return out;
}

const SIDES = [[1, 0], [-1, 0], [0, 1], [0, -1]];
export class GreenRooms {
  constructor(world) { this.w = world; this.known = new Map(); this.chunks = new Map(); this.ver = -1; }
  key(tx, ty) { return (tx + 65536) * 131072 + (ty + 65536); }
  chunk(tx, ty) {
    const cx = Math.floor(tx / CHUNK), cy = Math.floor(ty / CHUNK), k = cx * 65536 + cy;
    let d = this.chunks.get(k);
    if (d === undefined) this.chunks.set(k, (d = this.w.delta(cx, cy) || null));
    return d;
  }
  raw(layer, tx, ty) { return this.chunk(tx, ty)?.[layer]?.[`${tx},${ty}`] ?? this.w.baseAt(layer, tx, ty); }
  // Is its own roof of glass? (nothing that comes with the world is)
  roofed(tx, ty) { return this.w.delta(Math.floor(tx / CHUNK), Math.floor(ty / CHUNK))?.roof?.[`${tx},${ty}`] === GLASS_ROOF; }
  at(tx, ty) {
    if (!this.roofed(tx, ty)) return NONE;
    if (this.ver !== this.w.touches) { this.ver = this.w.touches; this.known.clear(); this.chunks.clear(); }
    return this.known.get(this.key(tx, ty)) ?? this.look(tx, ty);
  }
  // Fills the room of a tile, as structure.js roomAt does, and keeps the answer for all of it
  look(tx0, ty0) {
    const room = new Set([this.key(tx0, ty0)]), todo = [[tx0, ty0]], doors = [];
    let open = false;
    const fill = (seen, own) => {
      let i = 0;
      for (; i < todo.length && seen.size <= GLASS.max && !open; i++) for (const [dx, dy] of SIDES) {
        const x = wrapX(todo[i][0] + dx), y = todo[i][1] + dy, k = this.key(x, y);
        if (seen.has(k)) continue;
        const v = this.raw('placed', x, y), kind = v ? PIECES[parsePlaced(v)[0]]?.kind : undefined;
        if (kind === 'wall') continue;
        if (kind === 'door') { if (!this.w.doorClosed(x, y)) doors.push([x, y]); continue; }
        if (!this.raw('roof', x, y)) { open = true; break; }
        seen.add(k); todo.push([x, y]);
      }
      const full = i < todo.length;
      todo.length = 0;
      return full && !open;
    };
    const huge = fill(room, true);
    let level = open || huge ? OPEN : SHUT;
    if (level === SHUT && doors.length) {
      const seen = new Set(room);
      for (let i = 0; i < doors.length && !open && seen.size <= GLASS.max; i++) {
        const k = this.key(...doors[i]);
        if (seen.has(k)) continue;
        seen.add(k); todo.push(doors[i]);
        fill(seen, false);
      }
      if (open) level = AIRED;
    }
    for (const k of room) this.known.set(k, level);   // (what has been reached is of the same room, also when it was left half filled)
    return level;
  }
}

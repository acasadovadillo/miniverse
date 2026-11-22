// Host-resolved claims of other systems, through the wheelbarrow's claim protocol (barrow.js claim / resolve / sweep).
// Design: docs/planes/gta/PLAN-D-barras-buceo.md §4.6.
//
// A guest asks with game.barrow.claim(kind, chunkKey, data, done): the request travels in the chunk (d.claim[n]), whoever
// decides the world (the host or the world server) answers it in Barrow.resolve, which calls CLAIMS[c.k] for any kind it
// does not know itself, and the answer (ok, plus extra's fields) comes back in the same chunk to the guest's done(v)
// (v = null: it never reached whoever decides, after barrow.js CONFIRM_WAIT). Alone, as the host or as the world server
// (game.barrow.decides()), call the function directly instead: a claim() there would never be answered to this game.
//
// Kinds registered today (dive.js): shellfish (an oyster or a mussel on the bed) and sunk (a sunken chest).
//
// Contract: CLAIMS[kind](g, c, d, k, extra) → boolean
//   g      the game
//   c      the request (c.k = kind, c.by = who asks, c.key = the find's key, …): a guest's data, so check it
//   d      the chunk delta the claim is about (writable)
//   k      that chunk's key ("cx,cy", cx wrapped)
//   extra  an object whose fields are written into the answer (loot is NOT put here: every peer rolls it from ihash)
//   Checks the claim is still free (!d.opened?.[c.key], or d.dived?.[c.key] outside the regrow window), writes
//   (d.opened ||= {})[c.key] = c.by or (d.dived ||= {})[c.key] = day, and returns true; false when taken. It must not
//   throw on bad data (Barrow.resolve catches it anyway, as a refusal) and must not note the chunk: resolve does.
export const CLAIMS = {};

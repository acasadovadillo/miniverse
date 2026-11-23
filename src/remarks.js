// What the neighbours say about how you look and what they remember. Design: docs/planes/gta/PLAN-E-cuerpo-aspecto.md
// §4.5 and §6 (the 'rmk' message). Owner: Track C. Phase E2: in E1 this is a harmless stub (no remark is ever made).
//
// Contract (plan §10; keep the names):
//   REMARKS            the condition ids, in priority order. APPEND-ONLY, never reorder or remove: the network sends the
//                      index (rmk.rc, and the Y-greet reply's rc), and old clients must read the same id
//   GOOD_REMARKS       the good-news ids: when one of them holds it is picked first
//   remarks.update(dt) passing remarks at 1 Hz (a bubble through social.say, once per neighbour per condition per day)
//   remarks.forTalk(id) the line that replaces neighbour id's greeting in a talk ({ key, cond } or null)
//   remarks.heard(msg) a received { t: 'rmk', npc, rc, li } (live.js routes it): show the same bubble, block that
//                      neighbour's own remark for 40 s
// Keys: npc.remark.<cond>.<temper> (kind, cheerful, shy, gruff, wry), falling back to npc.remark.<cond> (lists, tList);
// recalls: npc.recall.<kind>. Body gives the condition: game.body.condition().
// Switch: ?comentarios=0 (opciones.js) turns every remark off.

export const REMARKS = [
  'carcass', 'log', 'blood', 'soaked', 'snowy', 'muddy', 'filthy', 'torn', 'underwear', 'barefoot',
  'underdressed', 'overdressed', 'fresh', 'haircut', 'new_clothes', 'couple', 'wrapped_up',
];
export const GOOD_REMARKS = new Set(['fresh', 'haircut', 'new_clothes', 'couple', 'wrapped_up']);
// The neighbours' memory kinds (friends[id].mem, neighbors.remember): keys npc.recall.<kind>
export const RECALLS = ['gift_loved', 'gift_hated', 'insult', 'take_seen', 'helped', 'knock_night', 'project'];

// ---------- the system (game.remarks, registered right after game.social) ----------
export class Remarks {
  constructor(game) {
    this.game = game;
  }
  update(dt) {}
  forTalk(id) { return null; }
  heard(msg) {}
}

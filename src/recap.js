// What was done in the last session, for the loading screen (docs/planes/realismo/PLAN-R9-menus.md §3.6, ui/loading.js):
// save.recap = { at, mins, d }: when that session was saved last, how many minutes of play it had (playtime.js) and how much
// each statistic grew ({ peces: 4, … }, at most MAX of them, the most telling first). Written at every save, so a game closed
// by force has it too; a session that has just begun and has done nothing yet keeps the one before. An old save has none, and
// an older game drops it on its next save
import { Profile } from './accounts.js';

const MAX = 6;
// The statistics it tells, in this order (their words: load.recap.<id>)
export const RECAP_STATS = ['peces', 'cosechas', 'cazados', 'piezas', 'lugares', 'faros', 'templos', 'tesoros', 'criaturas', 'encargos', 'proyectos', 'regalos', 'cocinados',
  'productos', 'mascotas', 'talados', 'picados', 'cofres', 'donados', 'trailsFollowed', 'profundidad', 'ganado'];

// A save's recap with only what can be told, or null
export function recapOf(save) {
  const r = save?.recap;
  if (!r || !Number.isFinite(r.at) || r.at <= 0) return null;
  const d = {}, mins = Number.isFinite(r.mins) && r.mins > 0 ? Math.floor(r.mins) : 0;
  for (const k of RECAP_STATS) if (Number.isFinite(r.d?.[k]) && r.d[k] >= 1 && Object.keys(d).length < MAX) d[k] = Math.floor(r.d[k]);
  return mins || Object.keys(d).length ? { at: r.at, mins, d } : null;
}

export class Recap {
  constructor(game) { this.game = game; this.prev = null; this.stats0 = {}; this.ms0 = 0; }
  // (after the statistics and the time played: game.js)
  reset(save) { this.prev = recapOf(save); this.stats0 = { ...this.game.stats.v }; this.ms0 = this.game.playTime.ms; }
  // This session so far, or null if there is nothing to tell yet
  now() {
    const d = {};
    for (const k of RECAP_STATS) if (Object.keys(d).length < MAX) { const n = Math.floor(this.game.stats.get(k) - (this.stats0[k] || 0)); if (n >= 1) d[k] = n; }
    const mins = Math.max(0, Math.floor((this.game.playTime.ms - this.ms0) / 60000));
    return mins || Object.keys(d).length ? { at: Date.now(), mins, d } : null;
  }
  save(out) { if (Profile.server) return; const r = this.now() || this.prev; if (r) out.recap = r; }
}

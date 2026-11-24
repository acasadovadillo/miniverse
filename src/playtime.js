// How long this character has been played (PLAN-R9-menus.md §3.7): save.playMs, in milliseconds. Only the time in play
// counts, dialogues included: not the menus, the pause nor the map (the systems' update does not run there), and no more
// than a second at a time, so a hidden tab or a sleeping computer adds nothing. Shown in Progress › Statistics. A save
// from before starts at 0; an older game drops the field on its next save (it is only a statistic)
import { Profile } from './accounts.js';

const STEP_MAX = 1000;
export class PlayTime {
  constructor() { this.ms = 0; this.last = 0; }
  reset(save) { this.ms = Number.isFinite(save?.playMs) && save.playMs > 0 ? save.playMs : 0; this.last = 0; }
  save(out) { if (!Profile.server) out.playMs = Math.round(this.ms); }
  update() {
    const now = performance.now(), d = now - this.last;
    if (this.last && d > 0 && d <= STEP_MAX) this.ms += d;
    this.last = now;
  }
}

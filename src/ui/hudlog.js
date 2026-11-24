// What was said to you and what the notices said: two short memories of the last lines (PLAN-R9-menus.md §3.4), which the
// pause's Brief tab shows (src/ui/brief.js). hud.js writes them: each line of a dialogue as it is shown, each notice as it
// comes. They are this session's: nothing is saved, and the end of a game empties them (game.js end).
export const KEEP = 40;

export class HudLog {
  constructor() {
    this.said = [];        // { at, name, line }, oldest first
    this.notes = [];       // { at, text, kind, n }, oldest first; n: how many times in a row
    this.onChange = null;  // (which: 'said' | 'notes'): the Brief tab while it is in sight
  }
  // name: as the dialogue shows it (a neighbour's may carry their hearts after two spaces)
  say(name, line) {
    if (!line) return;
    const who = String(name ?? '').split('  ')[0], last = this.said[this.said.length - 1], at = Date.now();
    if (last && last.name === who && last.line === line) last.at = at;
    else this.put(this.said, { at, name: who, line: String(line) });
    this.onChange?.('said');
  }
  note(text, kind = '') {
    if (!text) return;
    const last = this.notes[this.notes.length - 1], at = Date.now();
    if (last && last.text === text) { last.n++; last.at = at; }
    else this.put(this.notes, { at, text: String(text), kind, n: 1 });
    this.onChange?.('notes');
  }
  put(list, entry) { list.push(entry); if (list.length > KEEP) list.shift(); }
  clear() { this.said.length = this.notes.length = 0; this.onChange?.('said'); }
}

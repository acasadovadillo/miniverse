// The load meter on the HUD (the weight inventory, the default: ../carry.js): a backpack, a bar and "31/70 kg", and
// the icon of what the arms carry. Its own element, #hud-load, placed again whenever the interface changes (Settings ›
// Display swaps them while playing: it compares game.smartHud each frame): with the minimal one, in the block of health
// and hunger (#hud-status, which shows with the load when it matters: Carry.showLoad, read by smarthud.js); with the full
// one, under the hotbar, always in sight in survival. Each frame it compares a few numbers and only touches the page
// when one changes
import { itemIconUrl } from '../art/items.js';
import { loadLine, style } from './packlist.js';

const $ = id => document.getElementById(id);
const CSS = `
#hud-load { display: flex; align-items: center; gap: 6px; pointer-events: none; }
#hud-load > img { width: 22px; height: 22px; flex: none; }
#hud-load .pk-load { flex: 1; gap: 6px; } #hud-load .pk-load > span { display: none; }
#hud-load .pk-bar { min-width: 60px; height: 7px; }
#hud-load .pk-load b { font-size: 15px; }
#hud-load .hl-arms { display: none; width: 24px; height: 24px; flex: none; padding: 1px; background: rgba(255, 215, 122, .18); border: 1px solid rgba(255, 215, 122, .6); border-radius: 5px; }
#hud-load.arms .hl-arms { display: block; }
#hotbar > #hud-load { margin: 6px 2px 0; }
#hud-status > #hud-load { margin-top: 3px; min-width: 150px; }
body:not(.survival) #hud-load { display: none; }
`;

export function initLoadMeter(game) {
  style();
  const s = document.createElement('style');
  s.textContent = CSS;
  document.head.append(s);
  const el = document.createElement('div');
  el.id = 'hud-load';
  el.innerHTML = `<img alt="" src="${itemIconUrl('mochila')}"><div class="pk-load"></div><img class="hl-arms" alt="">`;
  const line = el.children[1], arms = el.children[2];
  let hudSeen, sig = '';
  return {
    el,
    frame() {
      const inv = game.inv;
      if (!inv?.weight || !game.player) { if (el.parentNode) el.remove(); hudSeen = undefined; return; }
      // Where it goes: in the block of the minimal interface (made again with each swap) or under the hotbar
      if (game.smartHud !== hudSeen || !el.isConnected) { hudSeen = game.smartHud; (game.smartHud ? $('hud-status') : $('hotbar'))?.append(el); }
      const held = game.carry?.held || '', armsKg = game.carry?.armsKg() || 0, now = `${inv.kg}|${inv.capKg}|${held}|${armsKg}`;   // (armsKg: 0 riding or rowing)
      if (now === sig) return;
      sig = now;
      loadLine(line, inv, armsKg);   // (with what the arms carry apart: "48 + 25 / 70 kg")
      el.classList.toggle('arms', !!held);
      if (held) arms.src = itemIconUrl(held);
    },
  };
}

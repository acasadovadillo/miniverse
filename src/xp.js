// Experiencia y niveles, como en Minecraft: picar carbón y piedras preciosas, matar criaturas, sacar lo fundido del
// horno, pescar, dar de comer a los animales para que tengan crías, cocinar y comerciar con los vecinos dan
// experiencia, y cada nivel cuesta más que el anterior. Los niveles se gastan en el yunque.
// Al morir se pierden (salvo con keepInventory). Es de cada uno, como la vida; la barra verde, en supervivencia.
import { Audio } from './audio.js';
import { hud } from './ui/hud.js';

// Lo que cuesta pasar del nivel l al siguiente, y lo que hay que tener en total para llegar a l
export const xpFor = l => (l >= 31 ? 9 * l - 158 : l >= 16 ? 5 * l - 38 : 2 * l + 7);
export const xpTo = l => (l <= 16 ? l * l + 6 * l : l <= 31 ? 2.5 * l * l - 40.5 * l + 360 : 4.5 * l * l - 162.5 * l + 2220);
export const roll = (a, b) => a + Math.floor(Math.random() * (b - a + 1));
// Lo que da cada cosa: al picar (si suelta esto), al matar y, por cada uno, al sacarlo del horno o del alambique
export const XP_ORE = { carbon: [0, 2], amatista: [3, 7], esmeralda: [3, 7], rubi: [3, 7], diamante: [3, 7] };
export const XP_MOB = { limo: [1, 2], murcielago: [1, 2], esqueleto: [5, 5] };

export class Experience {
  constructor(game) {
    this.game = game;
    this.points = 0; this.level = 0; this.into = 0;
    this.part = 0;   // (lo que se gana a trozos: fundir un lingote da 0,7)
  }
  reset(save) { this.set(save.xp || 0); this.part = 0; }
  save(out) { out.xp = this.points; }
  set(points) {
    this.points = Math.max(0, Math.floor(points));
    let l = 0;
    while (xpTo(l + 1) <= this.points) l++;
    this.level = l; this.into = this.points - xpTo(l);
    this.paint();
  }
  // Ganar experiencia (n puede tener decimales: se van juntando)
  add(n) {
    if (!(n > 0) || !this.game.player) return;
    this.part += n;
    const whole = Math.floor(this.part);
    if (!whole) return;
    this.part -= whole;
    const was = this.level;
    this.set(this.points + whole);
    this.game.gather.float(`+${whole} XP`, '#b8f070');
    if (this.level > was) { Audio.unlock(); hud.toast(`¡Nivel ${this.level} de experiencia!`, 'ok'); }
  }
  // Gastar niveles (lo que se llevaba del nivel de ahora se conserva). En creativo no se gastan
  spend(levels) {
    if (this.game.inv.infinite) return true;
    if (this.level < levels) return false;
    this.set(xpTo(this.level - levels) + Math.min(this.into, xpFor(this.level - levels) - 1));
    return true;
  }
  lose() { this.set(0); this.part = 0; }
  paint() {
    const el = document.getElementById('xp');
    if (!el) return;
    el.querySelector('i').style.width = `${Math.min(100, (this.into / xpFor(this.level)) * 100)}%`;
    el.querySelector('b').textContent = this.level || '';
    el.title = `Experiencia: nivel ${this.level} (${this.into}/${xpFor(this.level)})`;
  }
}

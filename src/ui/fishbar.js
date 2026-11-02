// Lo que se ve al pescar, junto al jugador: la barra de fuerza mientras se coge impulso y, en la pelea, una
// columna de agua con la red (que sube y baja), la silueta del pez, a veces un tesoro, y al lado la barra que
// se llena mientras el pez está dentro de la red. La coloca el dibujo 3D: x, y es el jugador en la pantalla y
// top, la altura de su cabeza.
import { itemIconUrl } from '../art/items.js';

const $ = id => document.getElementById(id);
let fishShown = '';

export function drawFishing(s, x, y, top, t) {
  const bar = $('fishbar'), cast = $('castbar');
  if (!bar) return;
  const reel = s?.phase === 'reel', charge = s?.phase === 'charge';
  if (bar.hidden === reel) bar.hidden = !reel;
  if (cast.hidden === charge) cast.hidden = !charge;
  if (charge) {
    cast.style.transform = `translate(${Math.round(x)}px, ${Math.round(top - 6)}px) translate(-50%, -100%)`;
    $('cast-fill').style.width = `${Math.round(s.power * 100)}%`;
    return;
  }
  if (!reel) { fishShown = ''; return; }
  const r = s.r, H = $('fb-water').clientHeight, W = bar.offsetWidth;
  if (fishShown !== s.fish) { fishShown = s.fish; $('fb-fish').src = itemIconUrl(s.fish); $('fb-chest-img').src = itemIconUrl('cofre'); }
  // Al lado del jugador (a la derecha si cabe; si no, a la izquierda); tiembla un poco si el pez se escapa de la red
  const left = x + 70 + W > innerWidth - 8 ? x - 70 - W : x + 70, shake = r.inside ? 0 : Math.sin(t * 60) * 2;
  bar.style.transform = `translate(${Math.round(left + shake)}px, ${Math.round(Math.min(innerHeight - bar.offsetHeight - 8, Math.max(8, y - bar.offsetHeight / 2)))}px)`;
  const zone = $('fb-zone');
  zone.style.height = `${r.h * H}px`;
  zone.style.transform = `translateY(${-r.y * H}px)`;
  zone.classList.toggle('on', r.inside);
  const wiggle = Math.sin(t * (r.inside ? 10 : 18)) * 10 - r.fv * 25;
  $('fb-fish').style.transform = `translate(-50%, 50%) translateY(${-r.fy * H}px) rotate(${wiggle.toFixed(1)}deg)`;
  const c = r.chest, chest = $('fb-chest');
  chest.hidden = !c?.on;
  if (c?.on) {
    chest.style.transform = `translate(-50%, 50%) translateY(${-c.y * H}px)`;
    $('fb-chest-fill').style.width = `${Math.round(c.got * 100)}%`;
  }
  const fill = $('fb-fill');
  fill.style.height = `calc(${Math.max(0, Math.min(1, r.prog)) * 100}% - 4px)`;
  fill.style.background = `hsl(${Math.round(r.prog * 110)}, 70%, 55%)`;
}

// Diario (tecla J): la historia, los vecinos, las habilidades, el museo, los logros y las estadísticas.
import { itemIconUrl } from '../art/items.js';

const $ = id => document.getElementById(id);
const STAT_NAMES = { talados: 'Árboles talados', picados: 'Rocas picadas', cosechas: 'Cosechas', peces: 'Peces', criaturas: 'Criaturas derrotadas', cofres: 'Cofres abiertos', lugares: 'Lugares descubiertos', profundidad: 'Nivel más hondo de cueva', encargos: 'Encargos cumplidos', regalos: 'Regalos hechos', piezas: 'Piezas construidas', cocinados: 'Platos cocinados', ganado: 'Monedas ganadas', donados: 'Piezas donadas' };

export function initJournalUI(game, { onClose }) {
  const TABS = {
    historia: ['Historia', () => game.story.journal()],
    vecinos: ['Vecinos', () => game.neighbors.journal()],
    habilidades: ['Habilidades', () => game.skills.journal()],
    museo: ['Museo', () => game.collection.journal()],
    logros: ['Logros', () => game.achievements.journal()],
    datos: ['Estadísticas', () => `<p class="j-note">Día ${game.days.dayIndex + 1} · ${game.money} monedas</p>` + Object.entries(STAT_NAMES).map(([k, n]) => `<div class="j-row"><b>${n}</b><span class="lvl">${Math.round(game.stats.get(k))}</span></div>`).join('')],
  };
  let tab = 'historia';
  for (const [k, [name]] of Object.entries(TABS)) {
    const b = document.createElement('button');
    b.type = 'button'; b.textContent = name; b.dataset.jtab = k;
    b.onclick = () => { tab = k; render(); };
    $('j-tabs').append(b);
  }
  function render() {
    document.querySelectorAll('[data-jtab]').forEach(b => b.classList.toggle('on', b.dataset.jtab === tab));
    $('j-body').innerHTML = TABS[tab][1]();
    $('j-body').querySelectorAll('[data-icon]').forEach(img => { img.src = itemIconUrl(img.dataset.icon); });
  }
  $('j-close').onclick = () => onClose();
  return { open() { render(); } };
}

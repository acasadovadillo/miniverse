// The small glyphs of the HUD (docs/planes/realismo/PLAN-R8-hud-mapa.md §5): original shapes on a 24-unit grid, filled, no
// part thinner than 2 units, readable at 12 px; drawn here as path data, used as inline SVG in the page (they take the
// colour of the text: fill currentColor). A hole is a part drawn the other way round.
const CLOUD = 'M7 14.5a4.2 4.2 0 0 1-.4-8.4A5.3 5.3 0 0 1 16.8 6.6a4 4 0 0 1-.2 7.9z';
export const GLYPHS = {
  // The status bars
  heart: 'M12 21 4.2 13.3A5.2 5.2 0 0 1 4 6a5.1 5.1 0 0 1 7.2 0l.8.8.8-.8A5.1 5.1 0 0 1 20 6a5.2 5.2 0 0 1-.2 7.3z',
  drumstick: 'M8 9.5a6.5 6.5 0 1 0 13 0 6.5 6.5 0 1 0-13 0zM10 11.6 5.4 16.2 7.8 18.6 12.4 14zM2.6 16.8a2.3 2.3 0 1 0 4.6 0 2.3 2.3 0 1 0-4.6 0zM4.9 19.1a2.3 2.3 0 1 0 4.6 0 2.3 2.3 0 1 0-4.6 0z',
  droplet: 'M12 2.5c3.6 4.3 6.5 8 6.5 11.6a6.5 6.5 0 0 1-13 0C5.5 10.5 8.4 6.8 12 2.5z',
  bolt: 'M13.5 2 5 13.5h5.6L9.2 22 19 9.8h-6z',
  bubbles: 'M3 14a6 6 0 1 0 12 0 6 6 0 1 0-12 0zM13.6 6.6a3.6 3.6 0 1 0 7.2 0 3.6 3.6 0 1 0-7.2 0zM16 17.6a2.4 2.4 0 1 0 4.8 0 2.4 2.4 0 1 0-4.8 0z',
  horseshoe: 'M5 3h4v2.2H8.6C7.6 7 7.2 9 7.2 11.4a4.8 4.8 0 0 0 9.6 0c0-2.4-.4-4.4-1.4-6.2H15V3h4v3.2c1 2 1.3 3.9 1.3 5.9a8.3 8.3 0 0 1-16.6 0c0-2 .3-3.9 1.3-5.9z',
  // (the horse's: what its bar and its card say, Plan R4-2)
  drumgrass: 'M11 21.5C11 14 8.6 8.6 3.4 5c6 .6 9.1 4 9.9 8.2C14 8.6 16.4 5 20.6 2.6c-2.6 4.6-4 9.4-4.1 18.9zM6.9 21.5C6.6 18 5.2 15 2.4 12.6c4 .7 6.4 3.4 7 8.9zM18.4 21.5c.1-3 .9-5.7 3.2-7.7-.4 2.6-.7 5-.8 7.7z',
  bandage: 'M3.2 14.6 14.6 3.2a4.4 4.4 0 0 1 6.2 6.2L9.4 20.8a4.4 4.4 0 0 1-6.2-6.2zM9.4 10.6l1.4-1.4 1.6 1.6-1.4 1.4zM12.4 13.6l1.4-1.4 1.6 1.6-1.4 1.4zM8.4 13.2 9.8 11.8 11.4 13.4 10 14.8zM12.9 8.7l1.4-1.4 1.6 1.6-1.4 1.4z',
  brush: 'M3 8.5h18v4H3zM4 14h2.4v6H4zM8 14h2.4v6H8zM13.6 14H16v6h-2.4zM17.6 14H20v6h-2.4zM7 4.5h10a2 2 0 0 1 2 2V7H5v-.5a2 2 0 0 1 2-2z',
  // The weather
  sun: 'M12 7.4a4.6 4.6 0 1 0 0 9.2 4.6 4.6 0 1 0 0-9.2zM11 1.5h2v3.6h-2zM11 18.9h2v3.6h-2zM1.5 11h3.6v2H1.5zM18.9 11h3.6v2h-3.6zM4 5.4 5.4 4 8 6.6 6.6 8zM16 17.4 17.4 16 20 18.6 18.6 20zM16 6.6 18.6 4 20 5.4 17.4 8zM4 18.6 6.6 16 8 17.4 5.4 20z',
  moon: 'M20 14.6A8.6 8.6 0 1 1 9.4 4 7 7 0 0 0 20 14.6z',
  cloud: 'M7 19a4.8 4.8 0 0 1-.5-9.6A6 6 0 0 1 18 10.2 4.4 4.4 0 0 1 17.6 19z',
  rain: CLOUD + 'M7.6 16.4h2L8.4 21h-2zM11.6 16.4h2L12.4 21h-2zM15.6 16.4h2L16.4 21h-2z',
  storm: CLOUD + 'M11.6 15.6 8.8 19.4h2.2L10 23l4.4-5h-2.2l1-2.4z',
  fog: 'M3 7h18v2.4H3zM5 11.2h14v2.4H5zM3 15.4h18v2.4H3z',
  snow: 'M11 2h2v20h-2zM2.8 7.9 3.8 6.1 21.2 16.1 20.2 17.9zM3.8 17.9 2.8 16.1 20.2 6.1 21.2 7.9z',
  // Money and the kinds of the feed
  coin: 'M12 2.5a9.5 9.5 0 1 0 0 19 9.5 9.5 0 1 0 0-19zM12 5a7 7 0 1 1 0 14 7 7 0 1 1 0-14zM10.6 8v8h2.8V8z',
  pin: 'M12 2a7.4 7.4 0 0 1 7.4 7.4C19.4 14.6 12 22 12 22S4.6 14.6 4.6 9.4A7.4 7.4 0 0 1 12 2zM12 6.6a2.8 2.8 0 1 0 0 5.6 2.8 2.8 0 1 0 0-5.6z',
  person: 'M12 3a4.3 4.3 0 1 0 0 8.6A4.3 4.3 0 1 0 12 3zM3.8 21h16.4c0-4.6-3.6-7.6-8.2-7.6S3.8 16.4 3.8 21z',
  people: 'M8.6 4.4a3.6 3.6 0 1 0 0 7.2 3.6 3.6 0 1 0 0-7.2zM1.6 19.6h14c0-3.9-3-6.4-7-6.4s-7 2.5-7 6.4zM16.4 5.6a3 3 0 1 0 0 6 3 3 0 1 0 0-6zM17.4 19.6h5.2c0-3.3-2.4-5.5-5.6-5.6 1 1.4 1.3 3.3.4 5.6z',
  hammer: 'M4 5.6 9.6 2.6 14 5l-1.6 2.4 8.4 10.2-2.6 2.4L9.6 9.9 7.4 11 5.8 8.4z',
  star: 'M12 2.2 14.9 8.4 21.7 9.2 16.7 13.8 18 20.5 12 17.2 6 20.5 7.3 13.8 2.3 9.2 9.1 8.4z',
  warn: 'M12 2.6 22.6 21H1.4zM11 9v6h2V9zM11 16.6v2.2h2v-2.2z',
  info: 'M12 2.5a9.5 9.5 0 1 0 0 19 9.5 9.5 0 1 0 0-19zM10.7 10.4h2.6v7h-2.6zM10.7 6.6h2.6v2.4h-2.6z',
  bag: 'M8 7V6a4 4 0 0 1 8 0v1h3l1 14H4L5 7zM10 7h4V6a2 2 0 0 0-4 0z',
};
// Each state of the weather (time.js WEATHER) → its glyph; by night a clear sky is the moon
const SKY = { sol: 'sun', nubes: 'cloud', lluvia: 'rain', tormenta: 'storm', niebla: 'fog', nieve: 'snow', ventisca: 'snow' };
export const skyGlyph = (weather, night) => (night && weather === 'sol' ? 'moon' : SKY[weather] || 'cloud');

export const glyph = (name, cls = '') => `<svg class="gl${cls ? ' ' + cls : ''}" viewBox="0 0 24 24" aria-hidden="true"><path d="${GLYPHS[name] || ''}"/></svg>`;

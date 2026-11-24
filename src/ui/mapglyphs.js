// The glyphs of what is on the maps (docs/planes/realismo/PLAN-R8-hud-mapa.md §5): original shapes on a 24-unit grid, filled,
// no part thinner than 2 units, readable at 11 px. (The HUD's own are in ui/glyphs.js.) sprite(): a blip as it is drawn on
// the maps' canvases, a dark disc with its ring and its glyph, remembered by glyph, colours and size; svg(): for the page.
export const MAP_GLYPHS = {
  house: 'M12 3 2.5 11.2 4.3 13.3 5.6 12.2V20.5H10V15h4v5.5h4.4V12.2l1.3 1.1 1.8-2.1z',
  home: 'M12 2.5 1.8 11.3 3.6 13.4 5 12.2V21h14V12.2l1.4 1.2 1.8-2.1zM12 11.2a3 3 0 1 1 0 6 3 3 0 1 1 0-6z',
  tavern: 'M4.5 6.5C4.5 4.4 6.4 3 8.3 3.5 9.4 2 12 1.9 13.2 3.4c2-.3 3.6 1.1 3.4 3.1H17v1.8h1.6c1.6 0 2.9 1.3 2.9 2.9v4c0 1.6-1.3 2.9-2.9 2.9H17V21H5zM17 10.6v5.4h1.2c.5 0 .9-.4.9-.9v-3.6c0-.5-.4-.9-.9-.9z',
  shop: 'M4 3h16l2 6.2c0 1.5-1.2 2.6-2.6 2.6-1 0-1.9-.5-2.4-1.4-.5.9-1.4 1.4-2.5 1.4-1 0-2-.5-2.5-1.4-.5.9-1.4 1.4-2.5 1.4s-2-.5-2.5-1.4c-.5.9-1.4 1.4-2.4 1.4C3.200 11.800 2 10.700 2 9.200zM4 13.600h2.200v5.200h11.600v-5.200H20V21H4z',
  cave: 'M2 21C2 10 6.400 3.500 12 3.500S22 10 22 21h-5c0-5.600-1.700-9-5-9s-5 3.400-5 9z',
  ruins: 'M3 19h18v2.500H3zM4.500 17.500V5.500h4v12zM10.300 17.500V10l4-2v9.500zM16 17.500V13l3.500 1.500v3zM3.500 3h6v1.800h-6z',
  camp: 'M12 3.500 1.500 20.500h7.300L12 14.800l3.200 5.700h7.300z',
  tower: 'M6 3h2.600v2.200h2V3h2.800v2.200h2V3H18v6l-1.500 1.500V21h-3v-3.500a1.500 1.500 0 0 0-3 0V21h-3V10.500L6 9z',
  wreck: 'M12 2a2.800 2.800 0 0 1 1.400 5.200V9.500H17V12h-3.600v6.700c2.500-.4 4.300-2 4.900-4.400l-1.800.7 2.700-4.500 2.300 4.700-1.200-.4C19.600 18.900 16.300 22 12 22s-7.600-3.100-8.300-7.200l-1.200.4 2.300-4.700 2.700 4.500-1.800-.7c.6 2.400 2.400 4 4.900 4.400V12H7V9.500h3.600V7.200A2.800 2.800 0 0 1 12 2z',
  temple: 'M12 2.500 2 8v2h20V8zM4 11.500h3V18H4zM10.500 11.500h3V18h-3zM17 11.500h3V18h-3zM2 19.200h20v2.300H2z',
  village: 'M7 8.500 1.500 13v7.500h4.700V16h2v4.500H11V12zM16.500 3.500 10 9l3 2.500v9h3V15.500h2.200v5H22V9z',
  lighthouse: 'M9.500 2.500h5V6h1.200v2h-1.300L16 21.500H8L9.600 8H8.300V6h1.200zM2 4.500 7 6v1.500L2 8.500zM22 4.500 17 6v1.500l5 1z',
  place: 'M12 3 21 12 12 21 3 12z',
  partner: 'M12 21 4.200 13.300A5.200 5.200 0 0 1 4 6a5.100 5.100 0 0 1 7.200 0l.8.8.8-.8A5.100 5.100 0 0 1 20 6a5.200 5.200 0 0 1-.2 7.300z',
  player: 'M12 3a4.300 4.300 0 1 0 0 8.600A4.300 4.300 0 1 0 12 3zM3.800 21h16.400c0-4.600-3.600-7.600-8.200-7.600S3.800 16.400 3.800 21z',
  person: 'M12 4.500a5 5 0 1 0 0 10 5 5 0 1 0 0-10zM5.500 21h13c0-3-2.800-4.800-6.500-4.800S5.500 18 5.500 21z',
  horse: 'M8.200 2.500 10.500 5c4 .2 8 3.300 9 8.500l.5 8H10.200c0-3.200 1-5 2.600-6.800-2 .3-3.600.8-4.900 2.300L5.800 18 3 15.800l1.200-3.700c.4-1.400.5-2.700 1.300-4 .6-1 1.500-1.800 2.500-2.400z',
  dog: 'M4 4.500 8 6.500h8l4-2-.5 7c0 1.200-.6 2-1.500 2.500V16c0 3-2.700 5-6 5s-6-2-6-5v-2c-.9-.5-1.500-1.300-1.500-2.500zM9 10.500a1.300 1.300 0 1 0 0 2.600 1.300 1.300 0 1 0 0-2.600zM15 10.500a1.300 1.300 0 1 0 0 2.600 1.300 1.300 0 1 0 0-2.600zM10 16h4l-2 2.300z',
  cat: 'M4.500 3 9.500 7h5l5-4v10.500c0 4.300-3.300 7.500-7.500 7.500s-7.500-3.200-7.500-7.500zM9 11.500a1.300 1.300 0 1 0 0 2.600 1.300 1.300 0 1 0 0-2.600zM15 11.500a1.300 1.300 0 1 0 0 2.600 1.300 1.300 0 1 0 0-2.600zM10.600 16h2.800L12 17.800z',
  boat: 'M11 2.500v11H4.500zM13 5.500l6 8h-6zM2 15h20l-3 6H5z',
  goal: 'M12 2 20 12 12 22 4 12z',
  pin: 'M12 2a7.400 7.400 0 0 1 7.400 7.400C19.400 14.600 12 22 12 22S4.600 14.600 4.600 9.400A7.400 7.400 0 0 1 12 2zM12 6.600a2.800 2.800 0 1 0 0 5.600 2.800 2.800 0 1 0 0-5.600z',
};
const paths = new Map(), sprites = new Map();
export function glyphPath(name) {
  let p = paths.get(name);
  if (!p) paths.set(name, p = new Path2D(MAP_GLYPHS[name] || MAP_GLYPHS.place));
  return p;
}
// A blip of D px across, k device pixels per px: its canvas is D + 2 px wide (1 px of room for the edge)
export function sprite(glyph, color, D, k = 1, dim = false) {
  const id = `${glyph}|${color}|${D}|${k}|${dim ? 1 : 0}`;
  let c = sprites.get(id);
  if (c) return c;
  c = document.createElement('canvas');
  c.width = c.height = Math.ceil((D + 2) * k);
  const g = c.getContext('2d'), R = D / 2;
  g.scale(k, k); g.translate(R + 1, R + 1);
  g.beginPath(); g.arc(0, 0, R, 0, Math.PI * 2); g.fillStyle = 'rgba(12, 15, 20, .9)'; g.fill();
  g.beginPath(); g.arc(0, 0, R - 0.75, 0, Math.PI * 2); g.lineWidth = 1.5; g.strokeStyle = color; g.globalAlpha = dim ? 0.4 : 0.95; g.stroke();
  const s = D * 0.64 / 24;
  g.globalAlpha = dim ? 0.5 : 1;
  g.scale(s, s); g.translate(-12, -12);
  g.fillStyle = color; g.fill(glyphPath(glyph), 'evenodd');
  if (sprites.size > 300) sprites.delete(sprites.keys().next().value);
  sprites.set(id, c);
  return c;
}
export const svg = (name, color) => `<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="${color}" fill-rule="evenodd" d="${MAP_GLYPHS[name] || MAP_GLYPHS.place}"/></svg>`;

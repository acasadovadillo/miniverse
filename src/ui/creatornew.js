// The new character creator (plan CR, P1), only with ?creador=nuevo: a MakeHuman person in the preview, the starting heads
// («Head», like Baldur's Gate 3's) and the fine sliders («Fine tune», about forty for the face), and six for the body plus
// the origin. The look gains `mh: { preset, macro, face }` (all optional: the game does not read it yet). The mirror and
// the barber keep the creator of before; without the switch nothing of this is loaded.
import { CharacterPreview } from '../three/preview.js';
import { optionRow } from './frontend.js';
import { t } from '../i18n.js';
import { PRESETS, presetOf, presetsFor, fromPreset, defaultMh, samePlace, randomMh } from '../three/mh/presets.js';
import { LOOK_OPTIONS } from '../looks.js';

export const NEW_PAGES = ['cuerpo', 'cabeza', 'ajuste', 'cara', 'pelo'];
// The shot of each page: the whole body, the head, or the face up close
export const NEW_SHOTS = { cuerpo: 'body', cabeza: 'face', ajuste: 'close', cara: 'close', pelo: 'face' };
const ORIGINS = ['af', 'as', 'ca'];
const BODY = [['height', -100, 100], ['weight', -100, 100], ['muscle', -100, 100], ['age', 0, 100], ['chest', -100, 100], ['prop', -100, 100]];
// The face sliders' groups, in the order the creator shows them (the sliders themselves come with the data: mh_pack.py)
const GROUPS = ['eyes', 'brows', 'nose', 'mouth', 'jaw', 'cheeks', 'forehead', 'ears', 'head'];
const FACE_IDS = {
  eyes: ['eye_size', 'eye_spacing', 'eye_height', 'eye_tilt', 'eye_open', 'eye_fold', 'eye_epicanthus', 'eye_bags'],
  brows: ['brow_height', 'brow_angle', 'brow_ridge'],
  nose: ['nose_length', 'nose_width', 'nose_projection', 'nose_hump', 'nose_tip', 'nose_nostrils', 'nose_bridge', 'nose_height'],
  mouth: ['mouth_width', 'mouth_height', 'lip_upper', 'lip_lower', 'mouth_corners', 'cupid_bow'],
  jaw: ['jaw_width', 'chin_width', 'chin_height', 'chin_forward', 'chin_cleft', 'jaw_jut'],
  cheeks: ['cheek_bones', 'cheek_volume', 'cheek_height'],
  forehead: ['forehead_height', 'forehead_slope'],
  ears: ['ear_size', 'ear_out', 'ear_height', 'ear_lobe'],
  head: ['head_width', 'head_height', 'head_shape', 'head_fat', 'neck_width'],
};
export const FACE_SLIDERS = GROUPS.flatMap(g => FACE_IDS[g]);
export const LIGHT_IDS = ['day', 'indoor', 'evening'];

// The look's MakeHuman part, made whole (an old look gets the first head of its sex)
export function ensureMh(look) {
  if (!look.mh || typeof look.mh !== 'object') look.mh = defaultMh(look);
  look.mh.macro ||= {};
  look.mh.face ||= {};
  const p = presetOf(look.mh.preset), sex = look.sex === 'chico' ? 'chico' : 'chica';
  if (p && p.sex !== sex) look.mh = fromPreset(samePlace(p.id, sex), look.mh.macro);   // (the sex changed: the same head of the other)
  return look.mh;
}
// What is saved: only the numbers that are not 0 (the look travels whole on the network: under 1 KB)
export function packMh(mh) {
  const clean = o => Object.fromEntries(Object.entries(o || {}).filter(([, v]) => Number.isFinite(v) && v !== 0).map(([k, v]) => [k, Math.round(v)]));
  const out = { macro: clean(mh.macro), face: clean(mh.face) };
  if (mh.preset) out.preset = mh.preset;
  return out;
}

// The preview: the creator of before (for the mirror and the barber) and the MakeHuman one, each on its own canvas; only the
// one in use is drawn, and its canvas is the one called #cr-canvas (so the page's styles follow it)
export class DualPreview {
  constructor(canvas) {
    this.old = new CharacterPreview(canvas);
    this.canvases = [canvas, document.createElement('canvas')];
    this.canvases[1].id = 'cr-canvas-mh';
    this.canvases[1].hidden = true;
    canvas.after(this.canvases[1]);
    this.mh = null; this.mode = 'old'; this.state = { look: null, angle: 0, shot: 'body', size: null, light: 'day', kit: null };
    this.loading = import('../three/mh/preview.js').then(m => {
      this.mh = new m.MhPreview(this.canvases[1]);
      const s = this.state;
      if (s.size) this.mh.resize(...s.size);
      this.mh.setLight(s.light); this.mh.setAngle(s.angle); this.mh.focus(s.shot);
      if (s.look && this.mode === 'new') this.mh.setLook(s.look);
      return this.mh;
    });
    this.loading.catch(err => console.warn('Miniverse: the new creator did not load', err));
  }
  use(mode) {
    this.mode = mode;
    const [a, b] = this.canvases, show = mode === 'new' ? b : a, hide = mode === 'new' ? a : b;
    hide.hidden = true; show.hidden = false;
    hide.id = hide === a ? 'cr-canvas-old' : 'cr-canvas-mh'; show.id = 'cr-canvas';
    if (mode === 'new' && this.state.look) this.mh?.setLook(this.state.look);
  }
  get active() { return this.mode === 'new' ? this.mh : this.old; }
  setLook(look) { this.state.look = look; this.active?.setLook(look); }
  setKit(ids) { this.state.kit = ids; this.old.setKit(ids); }
  setAngle(a) { this.state.angle = a; this.old.setAngle(a); this.mh?.setAngle(a); }
  focus(shot) {
    this.state.shot = shot;
    this.old.focus(shot === 'close' ? 'face' : shot);
    this.mh?.focus(shot);
  }
  setLight(id) { this.state.light = id; this.mh?.setLight(id); }
  resize(w, h) { this.state.size = [w, h]; this.old.resize(w, h); this.mh?.resize(w, h); }
  render(t) { this.active?.render(t); }
}

// The rows of the new creator, added through the creator's own add(page, id, option row). Returns what the creator does
// after making its list: the group titles and the grid of heads go between the rows (not rows themselves: the keys skip
// them), each shown with the row it belongs to
export function newRows({ add, look, rebuild, preview }) {
  const mh = () => ensureMh(look), extras = [];
  const range = (pg, id, label, min, max, get, set, o = {}) => add(pg, id, optionRow({ label, min, max, step: 5, def: o.def ?? 0, get, set: v => { set(v); rebuild(); } }), o);
  // Body: the origin (three, mixed as they are: a third each is an even mix) and the six of the body
  const rows = {
    origins: () => ORIGINS.forEach(o => range('cuerpo', 'origin_' + o, t(`gui.creator.row.origin_${o}`), 0, 100, () => mh().macro[o] ?? (o === 'ca' ? 100 : 0), v => {
      const m = mh().macro;
      for (const k of ORIGINS) m[k] ??= k === 'ca' ? 100 : 0;
      m[o] = v;
      if (!ORIGINS.some(k => m[k] > 0)) m[o] = 5;   // (never none)
    }, { def: o === 'ca' ? 100 : 0, desc: 'gui.creator.desc.origin' })),
    body: () => BODY.forEach(([id, min, max]) => range('cuerpo', 'body_' + id, t(`gui.creator.row.${id}`), min, max, () => mh().macro[id] ?? 0, v => { mh().macro[id] = v; },
      { desc: `gui.creator.desc.${id}` })),
  };
  // Head: the light to judge the skin, the heads of the sex (‹ name ›) and their portraits
  function headRows() {
    add('cabeza', 'light', optionRow({ label: t('gui.creator.row.light'), values: LIGHT_IDS.map(id => [id, t(`gui.creator.light.${id}`)]), get: () => preview.state.light, set: id => preview.setLight(id) }));
    const all = () => presetsFor(look.sex === 'chico' ? 'chico' : 'chica');
    const head = optionRow({ label: t('gui.creator.row.head'), values: PRESETS.map(p => [p.id, t(`mh.preset.${p.id}`)]), get: () => mh().preset, set: id => pickHead(id) });
    // (← → go round the heads of this sex only)
    const step = d => { const list = all(), i = list.findIndex(p => p.id === mh().preset); pickHead(list[(i + d + list.length) % list.length].id); head.refresh(); paintGrid(); };
    const key = head.key;
    head.key = e => { const d = { ArrowLeft: -1, KeyA: -1, ArrowRight: 1, KeyD: 1 }[e.code]; if (d) { if (!e.repeat) step(d); return true; } return key(e); };
    add('cabeza', 'head', head, { desc: 'gui.creator.desc.head' });
    const grid = document.createElement('div');
    grid.className = 'cr-heads';
    extras.push({ el: grid, after: 'head' });
    let painted = '';
    function paintGrid() {
      const list = all(), key = list.map(p => p.id).join() + '|' + [look.skin, look.hair, look.hairStyle, look.eyes].join();
      for (const b of grid.children) b.classList.toggle('on', b.dataset.id === mh().preset);
      if (key === painted) return;
      painted = key;
      grid.replaceChildren(...list.map(p => {
        const b = document.createElement('button');
        b.type = 'button'; b.tabIndex = -1; b.dataset.id = p.id; b.title = t(`mh.preset.${p.id}`);
        b.classList.toggle('on', p.id === mh().preset);
        const c = document.createElement('canvas'); c.width = 84; c.height = 100;
        const name = document.createElement('span'); name.textContent = t(`mh.preset.${p.id}`);
        b.append(c, name);
        b.onclick = () => { pickHead(p.id); head.refresh(); paintGrid(); };
        return b;
      }));
      // (each portrait drawn by the preview between two frames, with your colours and hair)
      preview.loading.then(P => {
        for (const b of grid.children) {
          const p = presetOf(b.dataset.id), canvas = b.firstChild;
          P.portrait({ ...look, mh: fromPreset(p, mh().macro) }, out => { const g = canvas.getContext('2d'); g.clearRect(0, 0, canvas.width, canvas.height); g.drawImage(out, 0, 0, canvas.width, canvas.height); });
        }
      });
    }
    headRows.paint = paintGrid;
  }
  function pickHead(id) {
    const p = presetOf(id);
    if (!p) return;
    look.mh = fromPreset(p, mh().macro);
    rebuild();
  }
  // Fine tune: back to the head, then the sliders by groups
  function fineRows() {
    const reset = optionRow({ label: t('gui.creator.row.reset_face'), values: [[0, t('gui.creator.reset')]], get: () => 0, set: () => {} });
    const go = () => { const p = presetOf(mh().preset); mh().face = p ? { ...p.face } : {}; rebuild(); };
    reset.el.onclick = go;
    const key = reset.key;
    reset.key = e => { if (/^(Enter|NumpadEnter|Space)$/.test(e.code)) { if (!e.repeat) go(); return true; } return key(e); };
    add('ajuste', 'reset_face', reset, { desc: 'gui.creator.desc.reset_face' });
    for (const g of GROUPS) {
      FACE_IDS[g].forEach((id, i) => {
        range('ajuste', 'face_' + id, t(`mh.slider.${id}`), -100, 100, () => mh().face[id] ?? 0, v => { mh().face[id] = v; });
        if (!i) {
          const h = document.createElement('h4');
          h.className = 'cr-group'; h.textContent = t(`mh.group.${g}`);
          extras.push({ el: h, before: 'face_' + id });
        }
      });
    }
  }
  return {
    origins: rows.origins, body: rows.body, head: headRows, fine: fineRows,
    // After the list is made: the titles and the grid in their places
    place(rowEl) {
      for (const x of extras) {
        const at = rowEl(x.before || x.after);
        if (!at) continue;
        if (x.before) at.before(x.el); else at.after(x.el);
        x.row = at;
      }
    },
    // Shown with their rows; the grid painted when it shows
    paint() {
      for (const x of extras) x.el.hidden = !x.row || x.row.hidden;
      const grid = extras.find(x => x.after === 'head');
      if (grid && !grid.el.hidden) headRows.paint?.();
    },
  };
}

// A coherent random character for the new creator: a head with a little noise, a body, and colours that go with its origin
export function randomNew(look) {
  const pick = a => a[Math.floor(Math.random() * a.length)], r = randomMh(look);
  look.mh = r.mh; look.skin = r.skin; look.eyes = r.eyes; look.hair = r.hair;
  look.hairStyle = pick(LOOK_OPTIONS.hairStyle.filter(([id]) => !['cresta', 'pinchos', 'samurai'].includes(id)))[0];
  look.brows = pick(LOOK_OPTIONS.brows)[0];
  look.outfit = pick(LOOK_OPTIONS.outfit)[0];
  look.cloth = pick(LOOK_OPTIONS.cloth)[0];
  look.beard = look.sex === 'chico' && Math.random() < 0.4 ? pick(LOOK_OPTIONS.beard.slice(1))[0] : 'no';
}

// The few styles of the new rows (group titles, the grid of heads), only with the switch
export function newStyles() {
  if (document.getElementById('cr-new-style')) return;
  const s = document.createElement('style');
  s.id = 'cr-new-style';
  s.textContent = `
  #cr-rows h4.cr-group { margin: 14px 4px 4px; font: 600 13px/1.2 var(--font-title); letter-spacing: .12em; text-transform: uppercase; opacity: .7; }
  #cr-rows .cr-heads { display: grid; grid-template-columns: repeat(4, 1fr); gap: 6px; padding: 6px 4px 10px; }
  #cr-rows .cr-heads[hidden], #cr-rows h4.cr-group[hidden] { display: none; }
  #cr-rows .cr-heads button { position: relative; padding: 0; border: 2px solid transparent; border-radius: 6px; background: rgba(0, 0, 0, .25); cursor: pointer; overflow: hidden; }
  #cr-rows .cr-heads button.on { border-color: var(--accent, #e8c050); }
  #cr-rows .cr-heads canvas { display: block; width: 100%; height: auto; }
  #cr-rows .cr-heads span { position: absolute; left: 0; right: 0; bottom: 0; padding: 2px 4px; font: 500 12px/1.2 var(--font-ui); background: linear-gradient(transparent, rgba(0, 0, 0, .7)); color: #fff; text-align: center; }
  #cr-canvas-mh, #cr-canvas-old { display: block; touch-action: none; cursor: grab; }`;
  document.head.append(s);
}

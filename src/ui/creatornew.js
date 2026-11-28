// The new character creator (plan CR, P1), only with ?creador=nuevo: a MakeHuman person in the preview, the starting heads
// («Head», like Baldur's Gate 3's) and the fine sliders («Fine tune», about forty for the face), and six for the body plus
// the origin. The look gains `mh: { preset, macro, face }` (all optional: the game does not read it yet). The mirror and
// the barber keep the creator of before; without the switch nothing of this is loaded.
import { CharacterPreview } from '../three/preview.js';
import { optionRow } from './frontend.js';
import { t } from '../i18n.js';
import { PRESETS, presetOf, presetsFor, fromPreset, defaultMh, samePlace, randomMh } from '../three/mh/presets.js';
import { LOOK_OPTIONS } from '../looks.js';
import { SKIN_TONES, nearestTone, SCARS, TATTOOS, BLUSH_COLOURS, KOHL_COLOURS, TATTOO_COLOURS } from '../three/mh/skin.js';
import { greyOf, HIGHLIGHT_COLOURS } from '../three/mh/hair.js';

export const NEW_PAGES = ['cuerpo', 'cabeza', 'ajuste', 'piel', 'cara', 'pelo'];
// The shot of each page: the whole body, the head, or the face up close
export const NEW_SHOTS = { cuerpo: 'body', cabeza: 'face', ajuste: 'close', piel: 'close', cara: 'close', pelo: 'face' };
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
export const MOOD_IDS = ['neutral', 'smile', 'laugh', 'talk', 'surprise', 'angry', 'sad'];

// The look's MakeHuman part, made whole (an old look gets the first head of its sex)
export function ensureMh(look) {
  if (!look.mh || typeof look.mh !== 'object') look.mh = defaultMh(look);
  look.mh.macro ||= {};
  look.mh.face ||= {};
  look.mh.skin ||= {};
  if (!SKIN_TONES.includes(look.skin)) look.skin = nearestTone(look.skin || '#c99c76');   // (a tone of before: the nearest of the new palette)
  const p = presetOf(look.mh.preset), sex = look.sex === 'chico' ? 'chico' : 'chica';
  if (p && p.sex !== sex) look.mh = { ...fromPreset(samePlace(p.id, sex), look.mh.macro), skin: look.mh.skin, ...(look.mh.eye2 && { eye2: look.mh.eye2 }) };   // (the sex changed: the same head of the other)
  return look.mh;
}
// What is saved: only the numbers that are not 0 (the look travels whole on the network: under 1 KB)
export function packMh(mh) {
  const clean = o => Object.fromEntries(Object.entries(o || {}).filter(([, v]) => Number.isFinite(v) && v !== 0).map(([k, v]) => [k, Math.round(v)]));
  const out = { macro: clean(mh.macro), face: clean(mh.face) };
  if (mh.preset) out.preset = mh.preset;
  // (the skin's layers: their numbers that are not 0, and the colours and kinds of those that are on)
  const sk = Object.fromEntries(Object.entries(mh.skin || {}).filter(([, v]) => (typeof v === 'string' ? v && v !== 'none' : Number.isFinite(v) && v !== 0)).map(([k, v]) => [k, typeof v === 'string' ? v : Math.round(v)]));
  if (Object.keys(sk).some(k => k !== 'seed')) out.skin = sk;
  if (mh.eye2) out.eye2 = mh.eye2;
  // (the hair (P4): grey hairs when chosen (0 too: no grey at any age), highlights and their colour)
  if (Number.isFinite(mh.grey)) out.grey = Math.round(mh.grey);
  if (mh.hl > 0) { out.hl = Math.round(mh.hl); if (mh.hlC) out.hlC = mh.hlC; }
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
    this.mh = null; this.mode = 'old'; this.state = { look: null, angle: 0, shot: 'body', size: null, light: 'day', mood: 'neutral', kit: null };
    this.loading = import('../three/mh/preview.js').then(m => {
      this.mh = new m.MhPreview(this.canvases[1]);
      const s = this.state;
      if (s.size) this.mh.resize(...s.size);
      this.mh.setLight(s.light); this.mh.setMood(s.mood); this.mh.setAngle(s.angle); this.mh.focus(s.shot);
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
  setMood(id) { this.state.mood = id; this.mh?.setMood(id); }
  resize(w, h) { this.state.size = [w, h]; this.old.resize(w, h); this.mh?.resize(w, h); }
  render(t) { this.active?.render(t); }
}

// The rows of the new creator, added through the creator's own add(page, id, option row). Returns what the creator does
// after making its list: the group titles and the grid of heads go between the rows (not rows themselves: the keys skip
// them), each shown with the row it belongs to
export function newRows({ add: add0, look, rebuild, preview }) {
  const mh = () => ensureMh(look), extras = [], created = new Map();
  const add = (pg, id, opt, o) => { created.set(id, opt.el); add0(pg, id, opt, o); };
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
    add('cabeza', 'mood', optionRow({ label: t('gui.creator.row.mood'), values: MOOD_IDS.map(id => [id, t(`gui.creator.mood.${id}`)]), get: () => preview.state.mood, set: id => preview.setMood(id) }), { desc: 'gui.creator.desc.mood' });
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
  // Skin: the tone (the new palette) and the layers, each with its strength and, some, their colour or kind
  function skinRows() {
    const sk = () => mh().skin;
    const swatches = (id, label, list, get, set) => { add('piel', id, optionRow({ label, colours: list, values: list.map((c, i) => [c, `${i + 1} / ${list.length}`]), get, set: v => { set(v); rebuild(); }, other: '—' })); rowOf(id).classList.add('sw'); };
    const kind = (id, list, key) => add('piel', id, optionRow({ label: t(`gui.creator.row.${id}`), values: list.map(k => [k, t(`gui.creator.${key}.${k}`)]), get: () => sk()[id] || 'none', set: v => { sk()[id] = v; if (!sk().seed) sk().seed = 1 + Math.floor(Math.random() * 998); rebuild(); } }));
    const amount = (id, def) => range('piel', id, t(`gui.creator.row.${id}`), 0, 100, () => sk()[id] ?? def ?? 0, v => { sk()[id] = v; if (!sk().seed) sk().seed = 1 + Math.floor(Math.random() * 998); }, { def: def ?? 0, desc: `gui.creator.desc.${id}` });
    swatches('tone', t('gui.creator.row.tone'), SKIN_TONES, () => look.skin, v => { look.skin = v; });
    amount('freckles'); amount('moles'); amount('vitiligo');
    amount('blush'); swatches('blushC', t('gui.creator.row.blushC'), BLUSH_COLOURS, () => sk().blushC || BLUSH_COLOURS[0], v => { sk().blushC = v; });
    amount('kohl'); swatches('kohlC', t('gui.creator.row.kohlC'), KOHL_COLOURS, () => sk().kohlC || KOHL_COLOURS[0], v => { sk().kohlC = v; });
    kind('scar', SCARS, 'scar'); amount('scarK', 70);
    kind('tattoo', TATTOOS, 'tattoo'); amount('tattooK', 80);
    swatches('tattooC', t('gui.creator.row.tattooC'), TATTOO_COLOURS, () => sk().tattooC || TATTOO_COLOURS[0], v => { sk().tattooC = v; });
  }
  // The other eye's colour: the same, or one of its own
  function eye2Row() {
    const all = ['', ...LOOK_OPTIONS.eyes];
    add('cara', 'eye2', optionRow({ label: t('gui.creator.row.eye2'), colours: all.map(c => c || 'transparent'), values: all.map((c, i) => [c, i ? `${i} / ${all.length - 1}` : t('gui.creator.same')]),
      get: () => mh().eye2 || '', set: v => { if (v) mh().eye2 = v; else delete mh().eye2; rebuild(); } }), { desc: 'gui.creator.desc.eye2' });
    rowOf('eye2').classList.add('sw');
  }
  // Hair (P4): grey hairs (by age until you choose), highlights and their colour
  function hairRows() {
    range('pelo', 'grey', t('gui.creator.row.grey'), 0, 100, () => mh().grey ?? Math.round(greyOf(look) * 100), v => { mh().grey = v; }, { desc: 'gui.creator.desc.grey' });
    range('pelo', 'hl', t('gui.creator.row.hl'), 0, 100, () => mh().hl ?? 0, v => { mh().hl = v; }, { desc: 'gui.creator.desc.hl' });
    add('pelo', 'hlC', optionRow({ label: t('gui.creator.row.hlC'), colours: HIGHLIGHT_COLOURS, values: HIGHLIGHT_COLOURS.map((c, i) => [c, `${i + 1} / ${HIGHLIGHT_COLOURS.length}`]),
      get: () => mh().hlC || HIGHLIGHT_COLOURS[0], set: v => { mh().hlC = v; rebuild(); }, other: '—' }));
    rowOf('hlC').classList.add('sw');
  }
  const rowOf = id => document.querySelector(`#cr-rows [data-row="${id}"]`) || created.get(id);
  return {
    origins: rows.origins, body: rows.body, head: headRows, fine: fineRows, skin: skinRows, eye2: eye2Row, hair: hairRows,
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
  // (now and then freckles, a mole or two, a little blush)
  const sk = look.mh.skin = { seed: 1 + Math.floor(Math.random() * 998) };
  if (Math.random() < 0.3 && SKIN_TONES.indexOf(look.skin) < 6) sk.freckles = 20 + Math.round(Math.random() * 12) * 5;
  if (Math.random() < 0.4) sk.moles = 20 + Math.round(Math.random() * 6) * 5;
  if (look.sex === 'chica' && Math.random() < 0.4) sk.blush = 15 + Math.round(Math.random() * 5) * 5;
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

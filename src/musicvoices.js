// The voices of the dynamic music (Plan J §3.5), all synthesized (no sample files). Pre-rendered: at the first
// Music.play each voice is rendered once per octave (C2 to C6, 1.5 s each) in plain JS into Float32Arrays, in a worker
// (musicworker.js; one octave per idle slice where there is none), kept once per page (module cache) and copied into
// AudioBuffers per context. A note is then one
// AudioBufferSource (pitched by playbackRate, at most ±6 semitones from its octave's buffer) plus one gain. Until a voice
// is ready its plain oscillator recipe plays it. Also the shared room (two feedback delays, no ConvolverNode) and the
// voice limiter.
//
// Voices: pluck (Karplus-Strong), pad (two saws ±6 cents → lowpass 1.2 kHz), flute (sine + breath noise, vibrato),
// bowed (saw → bandpass 1.4 kHz with vibrato, slow attack), bell (2-operator FM, ratio 3.5), bass (triangle + sine sub),
// frame (frame drum), kick, clap, hat.
// The sustained voices (pad, flute, bowed, bass) are rendered as seamless loops: every partial and the vibrato make a
// whole number of cycles in the buffer, and the filters run over the loop twice (the first pass only warms them up), so
// a held note can last any time. Buffers are rendered at 22.05 kHz (32 kHz for clap and hat): the voices are soft and
// the context resamples them; about 2.6 MB in all.
//
// new Voices(ctx, out)       ctx: any BaseAudioContext (so Music.render works offline); out: the node notes go to
//   .prerender(idle)         renders the buffers in the voices' worker (musicworker.js), or, without one or if it fails,
//                            in slices: idle(fn) schedules a slice (requestIdleCallback or a timer); offline (no idle) it
//                            renders all at once. Never throws
//   .ready(voice)            true when that voice's buffers exist
//   .play(voice, at, midi, dur, vel, dest, layer) → the source node, or null when dropped. at: ctx time; dur: seconds;
//                            vel 0..1; dest: the layer's GainNode (default out); layer: a musicscore.js LAYERS id (or
//                            'stinger'), which the limiter uses (over MAX_VOICES live: drop DROP_FIRST layers first,
//                            never KEEP ones; with document.hidden only KEEP layers play). Drums ignore midi's octave:
//                            midi 60 is the drum as rendered, others retune it
//   .live                    voices sounding now
// new Room(ctx, out)         .input (a GainNode: each mood's bus sends into it), .send(k) sets the send 0..1 (cave 0.5,
//                            home 0.15, outdoors 0.25); delays ROOM.delays s, feedback ROOM.feedback, lowpass ROOM.lowpass Hz

import { GAME_VERSION } from './version.js';

export const VOICES = ['pluck', 'pad', 'flute', 'bowed', 'bell', 'bass', 'frame', 'kick', 'clap', 'hat'];
export const MAX_VOICES = 28;
export const DROP_FIRST = ['lead', 'pluck'], KEEP = ['pad', 'bass'];
export const OCTAVES = [36, 48, 60, 72, 84];   // (C2 to C6: one buffer per voice and octave)
export const NOTE_S = 1.5;                      // (the length of each rendered buffer)
export const ROOM = { delays: [0.13, 0.29], feedback: 0.32, lowpass: 2500 };

const SR = 22050, SR_HI = 32000;
const TAU = Math.PI * 2;
export const hzOf = m => 440 * Math.pow(2, (m - 69) / 12);

// Per voice: the octaves it is rendered at (a subset of OCTAVES: no voice plays the whole range), whether it loops
// (sustained) or rings out (one shot), the envelope the note's gain adds (s) and its level (so a vel of 1 sits well in
// the mix: the buffers are all normalized to the same peak). Drums have one buffer (rendered at midi 60).
export const SPEC = {
  pluck: { octaves: [48, 60, 72, 84], loop: false, attack: 0, release: 0.25, level: 0.42, osc: 'triangle' },
  pad: { octaves: [48, 60, 72], loop: true, attack: 0.8, release: 1.2, level: 0.12, osc: 'triangle' },
  flute: { octaves: [60, 72, 84], loop: true, attack: 0.07, release: 0.16, level: 0.22, osc: 'sine' },
  bowed: { octaves: [48, 60, 72, 84], loop: true, attack: 0.16, release: 0.3, level: 0.32, osc: 'sawtooth' },
  bell: { octaves: [60, 72, 84], loop: false, attack: 0, release: 0.5, level: 0.22, osc: 'sine' },
  bass: { octaves: [36, 48], loop: true, attack: 0.012, release: 0.14, level: 0.28, sustain: 0.72, osc: 'triangle' },
  frame: { octaves: [60], loop: false, drum: true, len: 0.5, level: 0.42 },
  kick: { octaves: [60], loop: false, drum: true, len: 0.45, level: 0.5 },
  clap: { octaves: [60], loop: false, drum: true, len: 0.3, sr: SR_HI, level: 0.3 },
  hat: { octaves: [60], loop: false, drum: true, len: 0.06, sr: SR_HI, level: 0.1 },
};
// (the order of the idle slices: what the limiter never drops first, so the piece has a floor as soon as possible)
const ORDER = ['pad', 'bass', 'pluck', 'flute', 'bowed', 'bell', 'frame', 'kick', 'clap', 'hat'];

// ---------------------------------------------------------------------------------------------------------------------
// Synthesis (pure JS: deterministic, so renders and tests hear the same thing every time)

// A small seeded generator (mulberry32)
function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
// RBJ biquad coefficients
function biquad(type, f, q, sr) {
  const w = TAU * Math.min(f, sr * 0.45) / sr, cw = Math.cos(w), al = Math.sin(w) / (2 * q);
  let b0, b1, b2;
  if (type === 'lowpass') { b0 = (1 - cw) / 2; b1 = 1 - cw; b2 = b0; }
  else if (type === 'highpass') { b0 = (1 + cw) / 2; b1 = -(1 + cw); b2 = b0; }
  else { b0 = al; b1 = 0; b2 = -al; }   // (bandpass, 0 dB peak)
  const a0 = 1 + al;
  return { b0: b0 / a0, b1: b1 / a0, b2: b2 / a0, a1: -2 * cw / a0, a2: (1 - al) / a0 };
}
// Filters x into y (may be the same array). passes > 1 runs over x again with the state kept and writes only the last
// pass: for a periodic x that is the steady state, so the loop has no seam
function filter(c, x, y = x, passes = 1) {
  let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
  const n = x.length, src = passes > 1 ? Float32Array.from(x) : x;
  for (let p = 0; p < passes; p++) {
    const write = p === passes - 1;
    for (let i = 0; i < n; i++) {
      const v = src[i], o = c.b0 * v + c.b1 * x1 + c.b2 * x2 - c.a1 * y1 - c.a2 * y2;
      x2 = x1; x1 = v; y2 = y1; y1 = o;
      if (write) y[i] = o;
    }
  }
  return y;
}
// PolyBLEP correction of a naive saw at phase t with step dt (keeps the high partials from folding back)
function blep(t, dt) {
  if (t < dt) { t /= dt; return t + t - t * t - 1; }
  if (t > 1 - dt) { t = (t - 1) / dt; return t * t + t + t + 1; }
  return 0;
}
// Adds a band-limited saw of k whole cycles over the buffer (so it loops), with an optional vibrato (whole cycles too)
function addSaw(out, k, amp, vibK = 0, vibDepth = 0, phase = 0) {
  const n = out.length, dt0 = k / n;
  let ph = phase;
  for (let i = 0; i < n; i++) {
    const dt = vibK ? dt0 * (1 + vibDepth * Math.sin(TAU * vibK * i / n)) : dt0;
    out[i] += amp * (2 * ph - 1 - blep(ph, dt));
    ph += dt; if (ph >= 1) ph -= 1;
  }
}
const normalize = (d, peak = 0.9) => {
  let m = 0;
  for (let i = 0; i < d.length; i++) { const a = Math.abs(d[i]); if (a > m) m = a; }
  if (m > 1e-9) { const k = peak / m; for (let i = 0; i < d.length; i++) d[i] *= k; }
  return d;
};
// Short fades so a one shot never starts or stops with a click
function edges(d, sr, inS = 0.0008, outS = 0.04) {
  const a = Math.max(1, Math.round(inS * sr)), b = Math.min(d.length, Math.round(outS * sr));
  for (let i = 0; i < a; i++) d[i] *= i / a;
  for (let i = 0; i < b; i++) d[d.length - 1 - i] *= i / b;
  return d;
}

// Loop frequency: a whole number of cycles k over the loop; returns k (and the exact base frequency is k / loopS)
const cyclesFor = (f, loopS, even = false) => { let k = Math.max(1, Math.round(f * loopS)); if (even && k % 2) k += (f * loopS > k ? 1 : -1); return k; };

const SYNTH = {
  // Karplus-Strong: a noise burst through a tuned delay line with an averaging lowpass in the loop and an allpass for the
  // fraction of a sample (so high notes stay in tune at 22 kHz); a pick-position notch on the burst and a pitch-dependent
  // decay (low strings ring longer)
  pluck(midi) {
    const sr = SR, f = hzOf(midi), n = Math.round(NOTE_S * sr), out = new Float32Array(n), r = rng(midi * 7919 + 11);
    // (the loop: P samples of line, minus half a sample for the average of the oldest and the next one, plus D of
    // allpass; so P - 0.5 + D = N, with D kept between 0.1 and 1.1 where the allpass is well behaved)
    const N = sr / f, P = Math.max(2, Math.floor(N + 0.4)), D = N + 0.5 - P, C = (1 - D) / (1 + D);
    const t60 = 1.5 * Math.pow(261.6 / f, 0.35), rho = Math.pow(0.001, 1 / (f * t60));
    const line = new Float32Array(P), pick = Math.max(1, Math.round(P * 0.18));
    let lp = 0;
    const raw = new Float32Array(P);
    for (let i = 0; i < P; i++) { lp += 0.55 * ((r() * 2 - 1) - lp); raw[i] = lp; }
    for (let i = 0; i < P; i++) line[i] = raw[i] - 0.8 * raw[(i - pick + P) % P];
    let idx = 0, apIn = 0, apOut = 0;
    for (let i = 0; i < n; i++) {
      const cur = line[idx], nxt = line[(idx + 1) % P];
      const avg = 0.5 * (cur + nxt) * rho;
      const ap = C * avg + apIn - C * apOut; apIn = avg; apOut = ap;
      out[i] = cur; line[idx] = ap; idx = (idx + 1) % P;
    }
    return { data: edges(normalize(out), sr, 0.0005, 0.06), sr, base: f };
  },
  // Two saws detuned by about ±6 cents (whole cycles each, so the slow beating loops too) → lowpass 1.2 kHz
  pad(midi) {
    const sr = SR, f = hzOf(midi), n = Math.round(NOTE_S * sr), out = new Float32Array(n);
    const k = cyclesFor(f, NOTE_S), kd = Math.max(1, Math.round(k * 0.0035));
    addSaw(out, k - kd, 0.5, 0, 0, 0.13); addSaw(out, k + kd, 0.5, 0, 0, 0.61);
    filter(biquad('lowpass', 1200, 0.6, sr), out, out, 2);
    return { data: normalize(out), sr, base: k / NOTE_S, loop: true };
  },
  // Sine with a touch of second and third partial, a 5.3 Hz vibrato and a little bandpassed breath
  flute(midi) {
    const sr = SR, f = hzOf(midi), n = Math.round(NOTE_S * sr), out = new Float32Array(n), r = rng(midi * 104729 + 3);
    const k = cyclesFor(f, NOTE_S), vibK = 8, depth = 0.0035;
    let ph = 0;
    const dt0 = k / n;
    for (let i = 0; i < n; i++) {
      out[i] = Math.sin(TAU * ph) + 0.12 * Math.sin(2 * TAU * ph) + 0.04 * Math.sin(3 * TAU * ph);
      ph += dt0 * (1 + depth * Math.sin(TAU * vibK * i / n)); if (ph >= 1) ph -= 1;
    }
    const br = new Float32Array(n);
    for (let i = 0; i < n; i++) br[i] = r() * 2 - 1;
    filter(biquad('bandpass', Math.min(f * 2, 6000), 1.4, sr), br, br, 2);
    for (let i = 0; i < n; i++) out[i] += 0.22 * br[i];
    return { data: normalize(out), sr, base: k / NOTE_S, loop: true };
  },
  // A saw with vibrato → a bandpass formant at 1.4 kHz over a softened body (a fiddle-like line, not a copy of any)
  bowed(midi) {
    const sr = SR, f = hzOf(midi), n = Math.round(NOTE_S * sr), saw = new Float32Array(n);
    const k = cyclesFor(f, NOTE_S);
    addSaw(saw, k, 1, 8, 0.005);
    const body = filter(biquad('lowpass', 2600, 0.7, sr), saw, new Float32Array(n), 2);
    const formant = filter(biquad('bandpass', 1400, 1.1, sr), saw, new Float32Array(n), 2);
    const out = new Float32Array(n);
    for (let i = 0; i < n; i++) out[i] = 0.5 * body[i] + 1.1 * formant[i];
    return { data: normalize(out), sr, base: k / NOTE_S, loop: true };
  },
  // Two-operator FM: carrier at f, modulator at 3.5 f, the index falling fast (bright strike, mellow ring)
  bell(midi) {
    const sr = SR, f = hzOf(midi), n = Math.round(NOTE_S * sr), out = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const t = i / sr, idx = 2.2 * Math.exp(-t / 0.22) + 0.25, env = Math.exp(-t / 0.5);
      out[i] = env * Math.sin(TAU * f * t + idx * Math.sin(TAU * 3.5 * f * t));
    }
    return { data: edges(normalize(out), sr, 0.0015, 0.08), sr, base: f };
  },
  // Triangle with a sine an octave down (both whole cycles: k even), softened by a lowpass
  bass(midi) {
    const sr = SR, f = hzOf(midi), n = Math.round(NOTE_S * sr), out = new Float32Array(n);
    const k = cyclesFor(f, NOTE_S, true);
    for (let i = 0; i < n; i++) {
      const ph = (k * i / n) % 1, sub = ((k / 2) * i / n) % 1;
      out[i] = (4 * Math.abs(ph - 0.5) - 1) + 0.6 * Math.sin(TAU * sub);
    }
    filter(biquad('lowpass', 1000, 0.7, sr), out, out, 2);
    return { data: normalize(out), sr, base: k / NOTE_S, loop: true };
  },
  // Frame drum: a short lowpassed noise slap over a falling 150 → 105 Hz thump
  frame() {
    const sr = SR, n = Math.round(SPEC.frame.len * sr), out = new Float32Array(n), r = rng(907);
    const nz = new Float32Array(n);
    for (let i = 0; i < n; i++) nz[i] = (r() * 2 - 1) * Math.exp(-i / sr / 0.045);
    filter(biquad('lowpass', 1300, 0.8, sr), nz);
    let ph = 0;
    for (let i = 0; i < n; i++) {
      const t = i / sr, fr = 105 + 45 * Math.exp(-t / 0.04);
      ph += fr / sr;
      out[i] = 0.55 * nz[i] + Math.exp(-t / 0.16) * Math.sin(TAU * ph);
    }
    return { data: edges(normalize(out), sr, 0.0005, 0.05), sr, base: hzOf(60) };
  },
  // Kick: a sine falling from 130 to 45 Hz with a tiny click
  kick() {
    const sr = SR, n = Math.round(SPEC.kick.len * sr), out = new Float32Array(n), r = rng(31);
    let ph = 0;
    for (let i = 0; i < n; i++) {
      const t = i / sr, fr = 45 + 85 * Math.exp(-t / 0.035);
      ph += fr / sr;
      out[i] = Math.exp(-t / 0.22) * Math.sin(TAU * ph) + (t < 0.003 ? 0.3 * (r() * 2 - 1) : 0);
    }
    return { data: edges(normalize(out), sr, 0.0003, 0.05), sr, base: hzOf(60) };
  },
  // Clap: three quick noise bursts and a short tail, bandpassed
  clap() {
    const sr = SR_HI, n = Math.round(SPEC.clap.len * sr), out = new Float32Array(n), r = rng(577);
    for (let i = 0; i < n; i++) {
      const t = i / sr;
      let e = Math.exp(-Math.max(0, t - 0.03) / 0.09) * (t >= 0.03 ? 0.7 : 0);
      for (const s of [0, 0.011, 0.022]) if (t >= s) e += Math.exp(-(t - s) / 0.006);
      out[i] = (r() * 2 - 1) * e;
    }
    filter(biquad('bandpass', 1200, 0.9, sr), out);
    return { data: edges(normalize(out), sr, 0.0003, 0.04), sr, base: hzOf(60) };
  },
  // Hat: the old music's (a 40 ms noise fall through a 6 kHz highpass)
  hat() {
    const sr = SR_HI, n = Math.round(SPEC.hat.len * sr), out = new Float32Array(n), r = rng(1301);
    const m = Math.round(0.04 * sr);
    for (let i = 0; i < n; i++) out[i] = i < m ? (r() * 2 - 1) * (1 - i / m) : 0;
    filter(biquad('highpass', 6000, 0.7, sr), out);
    return { data: normalize(out), sr, base: hzOf(60) };
  },
};

// The module cache: voice → [{ data, sr, base, loop, midi }] per octave (null until rendered), once per page whatever
// the context. renderPart does one octave (an idle slice: a few ms), renderVoice all of a voice
const CACHE = new Map();
export function renderPart(voice, i) {
  const s = SPEC[voice];
  if (!s || i < 0 || i >= s.octaves.length) return null;
  let list = CACHE.get(voice);
  if (!list) CACHE.set(voice, list = s.octaves.map(() => null));
  if (!list[i]) list[i] = { ...SYNTH[voice](s.octaves[i]), midi: s.octaves[i], loop: !!s.loop };
  return list[i];
}
export function renderVoice(voice) {
  const s = SPEC[voice];
  if (!s) return null;
  for (let i = 0; i < s.octaves.length; i++) renderPart(voice, i);
  return CACHE.get(voice);
}
// One octave rendered elsewhere (the voices' worker): kept as if renderPart had made it
export function putPart(voice, i, o) {
  const s = SPEC[voice];
  if (!s || i < 0 || i >= s.octaves.length || !(o?.data instanceof Float32Array) || !o.data.length || !(o.sr > 0) || !(o.base > 0)) return false;
  let list = CACHE.get(voice);
  if (!list) CACHE.set(voice, list = s.octaves.map(() => null));
  if (!list[i]) list[i] = { data: o.data, sr: o.sr, base: o.base, midi: s.octaves[i], loop: !!s.loop };
  return true;
}
const rendered = voice => { const l = CACHE.get(voice); return !!l && l.every(Boolean); };
// Bytes the rendered buffers take (F3, the report)
export const cacheBytes = () => { let b = 0; for (const l of CACHE.values()) for (const o of l) if (o) b += o.data.byteLength; return b; };

// ---------------------------------------------------------------------------------------------------------------------

const isHidden = () => typeof document !== 'undefined' && !!document.hidden;

export class Voices {
  constructor(ctx, out) {
    this.ctx = ctx; this.out = out;
    this.buffers = new Map();      // voice → [{ buf, base, midi, loop }]
    this.slots = [];               // live notes: { start, end, layer, src, g } (reused from the pool)
    this.pool = [];
    this.notes = 0;                // (played since creation: renders and F3)
    this.dropped = 0;
    this.ignoreHidden = false;     // (offline renders play every layer whatever the page)
    this.now = 0;                  // (the conductor's clock: notes are never scheduled before it, so older ones can go)
    this.noiseBuf = null;
    this.endS = Number.isFinite(ctx?.length) && ctx.sampleRate ? ctx.length / ctx.sampleRate : Infinity;   // (offline: notes after it are skipped)
  }
  // The buffers of one voice in this context (from the module cache)
  load(voice) {
    if (this.buffers.has(voice)) return true;
    const list = renderVoice(voice);
    if (!list) return false;
    this.buffers.set(voice, list.map(o => {
      const buf = this.ctx.createBuffer(1, o.data.length, o.sr);
      if (buf.copyToChannel) buf.copyToChannel(o.data, 0); else buf.getChannelData(0).set(o.data);
      return { buf, base: o.base, midi: o.midi, loop: o.loop, dur: o.data.length / o.sr };
    }));
    return true;
  }
  prerender(idle) {
    try {
      if (!idle) { for (const v of ORDER) this.load(v); return; }
      // (a voice is used once all of its octaves exist; those already rendered on this page are loaded at once)
      const todo = [];
      for (const v of ORDER) {
        if (this.buffers.has(v)) continue;
        if (rendered(v)) { this.load(v); continue; }
        SPEC[v].octaves.forEach((_, i) => { if (!CACHE.get(v)?.[i]) todo.push([v, i]); });
      }
      if (todo.length && !this.inWorker(todo, idle)) this.inSlices(todo, idle);
    } catch (e) { console.warn('music voices', e); }
  }
  // One octave per idle slice (where there is no worker): a few ms to 90 ms each on the Air
  inSlices(todo, idle) {
    const slice = () => {
      try {
        const job = todo.shift();
        if (job) { renderPart(job[0], job[1]); if (rendered(job[0])) this.load(job[0]); }
      } catch (e) { console.warn('music voices', e); }
      if (todo.length) idle(slice);
    };
    if (todo.length) idle(slice);
  }
  // In the voices' worker: each octave comes back as it is done (the copy into an AudioBuffer here is a fraction of a
  // millisecond). Whatever has not come back when it ends or fails goes to the idle slices. Returns false without a worker
  inWorker(todo, idle) {
    if (typeof Worker === 'undefined' || typeof this.ctx?.createBuffer !== 'function') return false;
    let w;
    try { w = new Worker(new URL('./musicworker.js?v=' + encodeURIComponent(GAME_VERSION), import.meta.url), { type: 'module' }); } catch { return false; }
    let over = false;
    const end = () => {
      if (over) return;
      over = true;
      try { w.terminate(); } catch { /* gone */ }
      const rest = todo.filter(([v, i]) => !CACHE.get(v)?.[i]);
      if (rest.length) this.inSlices(rest, idle);
    };
    w.onmessage = e => {
      const m = e.data;
      if (m?.t === 'part') {
        try { if (!m.error && putPart(m.voice, m.i, m) && rendered(m.voice)) this.load(m.voice); } catch (err) { console.warn('music voices', err); }
      } else if (m?.t === 'done') end();
    };
    w.onerror = e => { e?.preventDefault?.(); console.warn('music voices: the worker failed; idle slices instead', e?.message || ''); end(); };
    try { w.postMessage({ t: 'render', jobs: todo }); } catch { end(); }
    return true;
  }
  ready(voice) { return this.buffers.has(voice); }
  get live() {
    const now = this.ctx?.currentTime ?? 0;
    let n = 0;
    for (const s of this.slots) if (s.start <= now + 1e-6 && s.end > now) n++;
    return n;
  }
  // Forget notes that ended before t (nothing is scheduled before the clock, so they can no longer overlap a new one)
  prune(t) {
    const sl = this.slots;
    for (let i = sl.length - 1; i >= 0; i--) if (sl[i].end <= t) { const s = sl[i]; sl[i] = sl[sl.length - 1]; sl.pop(); s.src = s.g = null; this.pool.push(s); }
  }
  // Voices overlapping t
  liveAt(t) { let n = 0; for (const s of this.slots) if (s.start <= t + 1e-6 && s.end > t) n++; return n; }
  // Over the cap: fade out the oldest note of a DROP_FIRST layer (or, for a KEEP note, of any other layer) at t
  steal(t, layer) {
    let best = null;
    const keep = KEEP.includes(layer);
    for (const s of this.slots) {
      if (s.end <= t || s.start > t) continue;
      const cheap = DROP_FIRST.includes(s.layer);
      if (!cheap && !(keep && !KEEP.includes(s.layer))) continue;
      if (!best || (cheap && !DROP_FIRST.includes(best.layer)) || (cheap === DROP_FIRST.includes(best.layer) && s.start < best.start)) best = s;
    }
    if (!best) return false;
    try {
      // (held where the note is at that instant, mid-attack or mid-release, then faded: cancelling alone would jump back
      // to the last set value and click)
      const at = Math.max(t, best.start), gp = best.g.gain;
      if (gp.cancelAndHoldAtTime) gp.cancelAndHoldAtTime(at); else gp.cancelScheduledValues(at);
      gp.setTargetAtTime(0, at, 0.015);
      best.src.stop(at + 0.09);
    } catch { /* already stopped */ }
    best.end = Math.max(best.start, t);
    return true;
  }
  play(voice, at, midi, dur, vel, dest = this.out, layer = null) {
    const ac = this.ctx, s = SPEC[voice];
    if (!ac || !s || !(vel > 0.0005) || !Number.isFinite(at) || !Number.isFinite(midi) || at >= this.endS) return null;
    if (!this.ignoreHidden && isHidden() && !KEEP.includes(layer)) { this.dropped++; return null; }
    this.prune(Math.min(at, Math.max(this.now, ac.currentTime || 0)));
    if (this.liveAt(at) >= MAX_VOICES) {
      if (DROP_FIRST.includes(layer) || !this.steal(at, layer)) { if (!KEEP.includes(layer)) { this.dropped++; return null; } }
    }
    dur = Math.max(0.03, dur || 0.1);
    const lvl = Math.min(1, vel) * s.level;
    let src, end;
    const g = ac.createGain();
    const set = this.buffers.get(voice);
    if (set) {
      // (the octave buffer nearest the note; playbackRate does the rest, at most ±6 semitones)
      let b = set[0];
      for (const o of set) if (Math.abs(o.midi - midi) < Math.abs(b.midi - midi)) b = o;
      src = ac.createBufferSource();
      src.buffer = b.buf;
      const rate = s.drum ? Math.pow(2, (midi - 60) / 12) : hzOf(midi) / b.base;
      src.playbackRate.value = rate;
      if (b.loop) { src.loop = true; src.loopStart = 0; src.loopEnd = b.dur; }
      end = this.envelope(g.gain, s, at, dur, lvl, b.loop ? 'hold' : 'shot', b.dur / rate);
    } else {
      // (not rendered yet: the plain recipe, one oscillator or a noise burst)
      if (s.drum) {
        if (!this.noiseBuf) {
          const n = Math.round(0.3 * ac.sampleRate), nb = ac.createBuffer(1, n, ac.sampleRate), d = nb.getChannelData(0), r = rng(5);
          for (let i = 0; i < n; i++) d[i] = (r() * 2 - 1) * Math.exp(-i / n * 8);
          this.noiseBuf = nb;
        }
        src = ac.createBufferSource(); src.buffer = this.noiseBuf;
        src.playbackRate.value = voice === 'kick' ? 0.25 : voice === 'frame' ? 0.5 : 1;
        end = this.envelope(g.gain, s, at, dur, lvl * 0.6, 'decay', s.len);
      } else {
        src = ac.createOscillator(); src.type = s.osc; src.frequency.value = hzOf(midi);
        end = this.envelope(g.gain, s, at, dur, lvl * (s.osc === 'sawtooth' ? 0.35 : 0.6), s.loop ? 'hold' : 'decay', voice === 'bell' ? 1.2 : 0.7);
      }
    }
    src.connect(g); g.connect(dest || this.out);
    src.start(at); src.stop(end + 0.02);
    const slot = this.pool.pop() || {};
    slot.start = at; slot.end = end; slot.layer = layer; slot.src = src; slot.g = g;
    this.slots.push(slot);
    this.notes++;
    return src;
  }
  // The note's gain. mode 'hold' (a loop or a sustained oscillator): ramps up (attack), holds and falls (release).
  // 'shot' (a rendered one shot): starts at full and lets the buffer ring (natural: its length at this rate), cut by the
  // release when the note is shorter. 'decay' (the oscillator or noise stand-in of a one shot): falls over natural s.
  // Returns when the note is silent
  envelope(p, s, at, dur, lvl, mode, natural) {
    if (mode === 'shot') {
      p.setValueAtTime(lvl, at);
      if (!s.drum && dur + s.release < natural) { p.setTargetAtTime(0, at + dur, s.release / 3); return at + dur + s.release * 1.6; }
      return at + natural;
    }
    if (mode === 'decay') {
      const len = s.drum ? natural : Math.min(natural, dur + s.release);
      p.setValueAtTime(lvl, at);
      p.setTargetAtTime(0, at + 0.004, len / 4);
      return at + len;
    }
    const a = Math.min(s.attack, dur * 0.45);
    p.setValueAtTime(0, at);
    p.linearRampToValueAtTime(lvl, at + Math.max(0.004, a));
    if (s.sustain) p.setTargetAtTime(lvl * s.sustain, at + a + 0.005, 0.12);
    const off = at + Math.max(dur, a + 0.01);
    p.setTargetAtTime(0, off, s.release / 3);
    return off + s.release * 1.6;
  }
}

// The shared room: two feedback delays (each with its lowpass inside the loop, so the repeats darken) panned apart. No
// ConvolverNode (too dear on the Air's audio thread). Static: 11 nodes for the whole music
export class Room {
  constructor(ctx, out) {
    this.ctx = ctx; this.out = out; this.k = 0.25;
    this.input = ctx.createGain(); this.input.gain.value = this.k;
    const wet = ctx.createGain(); wet.gain.value = 0.55; wet.connect(out);
    ROOM.delays.forEach((d, i) => {
      const dl = ctx.createDelay(1), lp = ctx.createBiquadFilter(), fb = ctx.createGain();
      dl.delayTime.value = d; lp.type = 'lowpass'; lp.frequency.value = ROOM.lowpass; fb.gain.value = ROOM.feedback;
      this.input.connect(dl); dl.connect(lp); lp.connect(fb); fb.connect(dl);
      if (ctx.createStereoPanner) { const pan = ctx.createStereoPanner(); pan.pan.value = i ? 0.5 : -0.5; lp.connect(pan); pan.connect(wet); } else lp.connect(wet);
    });
  }
  send(k, at = this.ctx.currentTime) {
    if (!Number.isFinite(k)) return;
    this.k = Math.max(0, Math.min(1, k));
    try { this.input.gain.setTargetAtTime(this.k, at, 0.5); } catch { this.input.gain.value = this.k; }
  }
}

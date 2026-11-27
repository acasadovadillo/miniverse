// Sonidos sintetizados con Web Audio: pasos, puerta, diálogos y pájaros.
let ac = null, on = true, noise = null, master = null, sfx = null, musicBus = null;
const vol = { master: 0.7, music: 0.5, sfx: 1 };

function tone(seq) {
  if (!ac || !on) return;
  let t = ac.currentTime;
  for (const [fr, d, type = 'square', v = 0.05] of seq) {
    const o = ac.createOscillator(), g = ac.createGain();
    o.type = type; o.frequency.value = fr;
    g.gain.setValueAtTime(v, t); g.gain.exponentialRampToValueAtTime(0.0001, t + d);
    o.connect(g).connect(sfx); o.start(t); o.stop(t + d + 0.02); t += d;
  }
}
let rainSrc = null, rainGain = null, rainTone = null, lowpass = null, musicLow = null, duckLow = null, duckGain = null, ducked = false;
const MUFFLE_HZ = { sfx: 600, music: 1600 };   // (the lowpass of each bus under the water: see muffle)
const DUCK = { hz: 700, gain: 0.55 };          // (the music behind the pause: see duck)
const lowPass = () => { const f = ac.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 20000; f.Q.value = 0.7; return f; };
// musicBus → [duckLow → duckGain] → [musicLow] → master: each one only once it has been needed
function wireMusic() {
  musicBus.disconnect();
  let at = musicBus;
  if (duckLow) { duckGain.disconnect(); at = at.connect(duckLow).connect(duckGain); }
  if (musicLow) at = at.connect(musicLow);
  at.connect(master);
}
function chirp() {
  if (!ac || !on || Audio.indoors || Audio.quietBirds) return;
  const base = 2600 + Math.random() * 1400;
  let t = ac.currentTime;
  for (let i = 0; i < 2 + Math.floor(Math.random() * 3); i++) {
    const o = ac.createOscillator(), g = ac.createGain();
    o.frequency.setValueAtTime(base, t); o.frequency.exponentialRampToValueAtTime(base * 1.35, t + 0.07);
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.03, t + 0.02); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.09);
    o.connect(g).connect(sfx); o.start(t); o.stop(t + 0.1); t += 0.14;
  }
}

// One hoof on the ground at time t (see Audio.hooves): filtered noise for the impact, and a short tone under it (on hard
// ground the shoe's knock, on soft ground the thump)
function clop(t, hard, v) {
  const src = ac.createBufferSource(), f = ac.createBiquadFilter(), g = ac.createGain(), o = ac.createOscillator(), og = ac.createGain();
  src.buffer = noise;
  if (hard) { f.type = 'bandpass'; f.frequency.value = 1500 + Math.random() * 500; f.Q.value = 1.4; } else { f.type = 'lowpass'; f.frequency.value = 360 + Math.random() * 80; }
  const d = hard ? 0.07 : 0.11;
  g.gain.setValueAtTime((hard ? 0.26 : 0.2) * v, t); g.gain.exponentialRampToValueAtTime(0.001, t + d);
  src.connect(f).connect(g).connect(sfx); src.start(t, Math.random() * 0.8, d + 0.03);
  o.type = hard ? 'triangle' : 'sine'; o.frequency.setValueAtTime(hard ? 280 + Math.random() * 40 : 95, t); o.frequency.exponentialRampToValueAtTime(hard ? 180 : 60, t + d);
  og.gain.setValueAtTime((hard ? 0.05 : 0.09) * v, t); og.gain.exponentialRampToValueAtTime(0.0001, t + d);
  o.connect(og).connect(sfx); o.start(t); o.stop(t + d + 0.02);
}

let feedAt = -1;
export const Audio = {
  indoors: false,
  start() {
    if (ac) return;
    try { ac = new (window.AudioContext || window.webkitAudioContext)(); } catch { return; }
    master = ac.createGain(); master.gain.value = on ? vol.master : 0; master.connect(ac.destination);
    sfx = ac.createGain(); sfx.gain.value = vol.sfx; sfx.connect(master);
    musicBus = ac.createGain(); musicBus.gain.value = vol.music; musicBus.connect(master);
    noise = ac.createBuffer(1, ac.sampleRate, ac.sampleRate);
    const d = noise.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    if (ducked) Audio.duck(true);
    (function bird() { setTimeout(() => { chirp(); bird(); }, 2500 + Math.random() * 6000); })();
  },
  step(wood) {
    if (!ac || !on) return;
    const src = ac.createBufferSource(), f = ac.createBiquadFilter(), g = ac.createGain(), t = ac.currentTime;
    src.buffer = noise; f.type = wood ? 'bandpass' : 'lowpass'; f.frequency.value = wood ? 1000 : 700;
    g.gain.setValueAtTime(wood ? 0.3 : 0.18, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.1);
    src.connect(f).connect(g).connect(sfx); src.start(t, Math.random() * 0.8, 0.15);
  },
  door: () => tone([[180, 0.08, 'triangle', 0.08], [140, 0.12, 'triangle', 0.08]]),
  chop() { Audio.noiseHit(500, 0.09, 0.35); tone([[110, 0.06, 'triangle', 0.08]]); },
  // The table games: three dice on the wood, a tile put down
  dice() { for (let i = 0; i < 7; i++) setTimeout(() => { Audio.noiseHit(1500 + Math.random() * 1400, 0.025, 0.16 - i * 0.015); tone([[820 + Math.random() * 500, 0.018, 'triangle', 0.03]]); }, 90 + i * 62 + Math.random() * 26); },
  tile() { Audio.noiseHit(1250, 0.035, 0.24); tone([[430, 0.03, 'triangle', 0.06], [250, 0.03, 'triangle', 0.05]]); },
  clink() { tone([[1400, 0.04, 'square', 0.04], [1050, 0.06, 'square', 0.03]]); Audio.noiseHit(2500, 0.05, 0.15); },
  // The hammer: a short knock of iron on wood (or on stone, or into straw); and the chalk line of a plan
  hammer(kind) {
    const k = 0.92 + Math.random() * 0.16;
    if (kind === 'stone') { tone([[1250 * k, 0.03, 'square', 0.022], [820 * k, 0.05, 'triangle', 0.04]]); Audio.noiseHit(1900 * k, 0.05, 0.2); }
    else if (kind === 'twig') { Audio.noiseHit(1400 * k, 0.07, 0.2); tone([[150 * k, 0.05, 'triangle', 0.05]]); }
    else { Audio.noiseHit(850 * k, 0.045, 0.32); tone([[310 * k, 0.025, 'triangle', 0.09], [165 * k, 0.06, 'triangle', 0.08]]); }
  },
  chalk() { Audio.noiseHit(2600, 0.06, 0.05, 'highpass'); },
  // (a small dry tick: choosing the bait)
  tick() { tone([[760, 0.025, 'triangle', 0.05]]); },
  swish() { Audio.noiseHit(3000, 0.08, 0.12, 'highpass'); },
  till() { Audio.noiseHit(300, 0.12, 0.3); },
  // La pala: al cavar, el filo que entra raspando y el golpe sordo del bloque que sale; al soltar la tierra, el golpe blando
  // y unos terrones que caen detrás
  dig() { Audio.noiseHit(1800, 0.07, 0.12, 'highpass'); setTimeout(() => { Audio.noiseHit(260, 0.16, 0.42); tone([[95, 0.09, 'triangle', 0.07]]); }, 70); },
  dump() { Audio.noiseHit(170, 0.2, 0.5, 'lowpass'); tone([[80, 0.1, 'sine', 0.08]]); for (let i = 0; i < 3; i++) setTimeout(() => Audio.noiseHit(700 + Math.random() * 600, 0.04, 0.09), 90 + i * 55 + Math.random() * 30); },
  fell: () => tone([[180, 0.08, 'triangle', 0.08], [120, 0.1, 'triangle', 0.08], [80, 0.16, 'triangle', 0.08]]),
  pickup: () => tone([[880, 0.03, 'square', 0.03], [1320, 0.04, 'square', 0.03]]),
  eat: () => tone([[300, 0.05, 'square', 0.04], [240, 0.05, 'square', 0.04], [300, 0.05, 'square', 0.04]]),
  error: () => tone([[160, 0.1, 'sawtooth', 0.04]]),
  // The menus (src/ui/frontend.js): short, soft, at half the volume of the effects; none with Settings › Menu sounds off
  menuSounds: true,
  ui(name) {
    if (!ac || !on || !Audio.menuSounds) return;
    if (name === 'feed') { const T = ac.currentTime; if (T - feedAt < 0.5) return; feedAt = T; Audio.noiseHit(1500, 0.12, 0.035); }   // (a line of the feed: a soft airy touch, one every half second at most)
    else if (name === 'stamp') { tone([[82, 0.22, 'sine', 0.09], [61, 0.3, 'sine', 0.06]]); Audio.noiseHit(180, 0.25, 0.1, 'lowpass'); }   // (a big message)
    else if (name === 'tick') tone([[1600, 0.018, 'sine', 0.03]]);
    else if (name === 'select') tone([[660, 0.05, 'triangle', 0.04], [990, 0.05, 'triangle', 0.04]]);
    else if (name === 'back') tone([[990, 0.05, 'triangle', 0.035], [660, 0.05, 'triangle', 0.035]]);
    else if (name === 'deny') tone([[220, 0.04, 'square', 0.02], [1, 0.03, 'sine', 0.0002], [220, 0.04, 'square', 0.02]]);
    else if (name === 'tab' || name === 'open') {   // (a short airy sweep; opening, over a low thump)
      const src = ac.createBufferSource(), f = ac.createBiquadFilter(), g = ac.createGain(), now = ac.currentTime;
      src.buffer = noise; f.type = 'bandpass'; f.Q.value = 1.2;
      f.frequency.setValueAtTime(900, now); f.frequency.exponentialRampToValueAtTime(2800, now + 0.09);
      g.gain.setValueAtTime(0.05, now); g.gain.exponentialRampToValueAtTime(0.0005, now + 0.09);
      src.connect(f).connect(g).connect(sfx); src.start(now, Math.random() * 0.8, 0.1);
      if (name === 'open') tone([[110, 0.06, 'sine', 0.05]]);
    }
  },
  place() { Audio.noiseHit(220, 0.1, 0.35); tone([[140, 0.08, 'triangle', 0.08]]); },
  craft() { Audio.clink(); setTimeout(() => tone([[660, 0.05, 'square', 0.03], [880, 0.05, 'square', 0.03], [1320, 0.08, 'square', 0.03]]), 120); },
  love: () => tone([[523, 0.22, 'sine', 0.06], [659, 0.22, 'sine', 0.06], [784, 0.22, 'sine', 0.06], [659, 0.22, 'sine', 0.05], [880, 0.3, 'sine', 0.06], [784, 0.3, 'sine', 0.05], [1047, 0.7, 'sine', 0.06]]),
  unlock: () => tone([[523, 0.08, 'triangle', 0.06], [659, 0.08, 'triangle', 0.06], [784, 0.08, 'triangle', 0.06], [1047, 0.16, 'triangle', 0.06]]),
  // Golpe de ruido filtrado (madera, piedra, tierra…)
  noiseHit(freq, dur, vol, type = 'bandpass') {
    if (!ac || !on) return;
    const src = ac.createBufferSource(), f = ac.createBiquadFilter(), g = ac.createGain(), t = ac.currentTime;
    src.buffer = noise; f.type = type; f.frequency.value = freq;
    g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    src.connect(f).connect(g).connect(sfx); src.start(t, Math.random() * 0.8, dur + 0.05);
  },
  blip: () => tone([[880, 0.03, 'square', 0.03]]),
  // Toc, toc, toc: llamar a una puerta
  knock() { for (let i = 0; i < 3; i++) setTimeout(() => { Audio.noiseHit(380, 0.07, 0.5); tone([[150, 0.05, 'triangle', 0.06]]); }, i * 170); },
  // The chapel's bell: the partials of a small bell (hum, prime, the minor third that makes it one, fifth, octave…), each
  // dying on its own, and the knock of the clapper. v: how loud; lo: the stroke back, a little duller
  bell(v = 1, lo = 0) {
    if (!ac || !on) return;
    const t0 = ac.currentTime, f = 523;
    for (const [k, a, d] of [[0.5, 0.05, 3.6], [1, 0.07, 2.6], [1.183, 0.05, 2.0], [1.506, 0.03, 1.4], [2, 0.05, 1.5], [2.51, 0.02, 0.8], [3.01, 0.014, 0.5], [4.17, 0.008, 0.3]]) {
      const o = ac.createOscillator(), g = ac.createGain();
      o.type = 'sine'; o.frequency.value = f * k * (lo ? 0.998 : 1);
      g.gain.setValueAtTime(0.0001, t0); g.gain.exponentialRampToValueAtTime(a * v * (lo && k > 2 ? 0.6 : 1), t0 + 0.006); g.gain.exponentialRampToValueAtTime(0.0001, t0 + d);
      o.connect(g).connect(sfx); o.start(t0); o.stop(t0 + d + 0.02);
    }
    Audio.noiseHit(2600, 0.03, 0.06 * v);
  },
  // Animales: el gallo al amanecer, el perro, el gato, el caballo y el silbato
  crow() { tone([[520, 0.12, 'sawtooth', 0.025], [700, 0.1, 'sawtooth', 0.03], [880, 0.35, 'sawtooth', 0.025], [620, 0.2, 'sawtooth', 0.02]]); },
  bark() { tone([[320, 0.06, 'sawtooth', 0.05], [240, 0.08, 'square', 0.03]]); Audio.noiseHit(600, 0.08, 0.2); },
  // Wild animals (Plan R3): a deer's forefoot on the ground (a dull thud, twice), its bark of alarm (a short hoarse shout that
  // falls) and a boar's huff (air blown through the snout; squeal: a grunt under it, running off). k: how loud (further, less)
  stamp(k = 1) {
    if (!ac || !on || !(k > 0.01)) return;
    const t = ac.currentTime;
    for (const [at, v] of [[0, 1], [0.16, 0.6]]) {
      const o = ac.createOscillator(), g = ac.createGain(), s = t + at;
      o.type = 'sine'; o.frequency.setValueAtTime(110, s); o.frequency.exponentialRampToValueAtTime(48, s + 0.1);
      g.gain.setValueAtTime(0.16 * k * v, s); g.gain.exponentialRampToValueAtTime(0.0001, s + 0.14);
      o.connect(g).connect(sfx); o.start(s); o.stop(s + 0.16);
    }
    Audio.noiseHit(300, 0.06, 0.14 * k);
  },
  alarmBark(k = 1) {
    if (!ac || !on || !(k > 0.01)) return;
    const t = ac.currentTime, o = ac.createOscillator(), f = ac.createBiquadFilter(), g = ac.createGain();
    o.type = 'sawtooth'; f.type = 'bandpass'; f.frequency.value = 900; f.Q.value = 1.2;
    o.frequency.setValueAtTime(330, t); o.frequency.exponentialRampToValueAtTime(420, t + 0.04); o.frequency.exponentialRampToValueAtTime(170, t + 0.24);
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.2 * k, t + 0.025); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.27);
    o.connect(f).connect(g).connect(sfx); o.start(t); o.stop(t + 0.3);
    Audio.noiseHit(1000, 0.16, 0.12 * k, 'bandpass');
  },
  huff(k = 1, squeal = false) {
    if (!ac || !on || !(k > 0.01)) return;
    Audio.noiseHit(520, 0.22, 0.3 * k, 'bandpass');
    if (squeal) tone([[150, 0.09, 'sawtooth', 0.05 * k], [110, 0.14, 'sawtooth', 0.045 * k]]);
  },
  // The rut (Plan R3-4): a stag's roar, far off (k: how loud; pan: -1 left .. 1 right): a low hoarse bellow that rises, holds
  // with a tremble and falls, twice or three times in a row, through a stereo panner. And the deer call, blown by you: a
  // shorter, thinner version of it, through a horn
  roar(pan = 0, k = 1) {
    if (!ac || !on || !(k > 0.01)) return;
    const t0 = ac.currentTime, P = ac.createStereoPanner ? ac.createStereoPanner() : null, out = ac.createGain(), lp = ac.createBiquadFilter();
    lp.type = 'lowpass'; lp.frequency.value = 700 + 900 * k; out.gain.value = 0.55 * k;
    if (P) { P.pan.value = Math.max(-1, Math.min(1, pan)); out.connect(lp).connect(P).connect(sfx); } else out.connect(lp).connect(sfx);
    const n = 2 + (Math.random() < 0.5 ? 1 : 0);
    for (let i = 0; i < n; i++) {
      const t = t0 + i * 0.95, d = i === n - 1 ? 1.5 : 0.75, o = ac.createOscillator(), o2 = ac.createOscillator(), g = ac.createGain(), vib = ac.createOscillator(), vg = ac.createGain();
      o.type = 'sawtooth'; o2.type = 'square';
      o.frequency.setValueAtTime(95, t); o.frequency.linearRampToValueAtTime(150, t + d * 0.35); o.frequency.linearRampToValueAtTime(120, t + d * 0.8); o.frequency.exponentialRampToValueAtTime(70, t + d);
      o2.frequency.setValueAtTime(48, t); o2.frequency.linearRampToValueAtTime(74, t + d * 0.35); o2.frequency.exponentialRampToValueAtTime(36, t + d);
      vib.frequency.value = 7 + Math.random() * 3; vg.gain.value = 9; vib.connect(vg); vg.connect(o.frequency);
      g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.32, t + 0.12); g.gain.setValueAtTime(0.3, t + d * 0.7); g.gain.exponentialRampToValueAtTime(0.0001, t + d);
      o.connect(g); o2.connect(g); g.connect(out);
      for (const x of [o, o2, vib]) { x.start(t); x.stop(t + d + 0.05); }
    }
    // (the breath in it)
    const src = ac.createBufferSource(), f = ac.createBiquadFilter(), ng = ac.createGain();
    src.buffer = noise; f.type = 'bandpass'; f.frequency.value = 420; f.Q.value = 0.8;
    ng.gain.setValueAtTime(0.0001, t0); ng.gain.exponentialRampToValueAtTime(0.09, t0 + 0.2); ng.gain.exponentialRampToValueAtTime(0.0001, t0 + n * 0.95 + 0.6);
    src.connect(f).connect(ng).connect(out); src.start(t0, Math.random() * 0.4, n * 0.95 + 0.7);
  },
  deerCall() {
    if (!ac || !on) return;
    const t = ac.currentTime, o = ac.createOscillator(), g = ac.createGain(), f = ac.createBiquadFilter();
    o.type = 'sawtooth'; f.type = 'bandpass'; f.frequency.value = 520; f.Q.value = 1.4;
    o.frequency.setValueAtTime(130, t); o.frequency.linearRampToValueAtTime(205, t + 0.5); o.frequency.linearRampToValueAtTime(170, t + 1.1); o.frequency.exponentialRampToValueAtTime(95, t + 1.5);
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.22, t + 0.1); g.gain.setValueAtTime(0.2, t + 1.1); g.gain.exponentialRampToValueAtTime(0.0001, t + 1.55);
    o.connect(f).connect(g).connect(sfx); o.start(t); o.stop(t + 1.6);
    Audio.noiseHit(600, 0.6, 0.08, 'bandpass');
  },
  meow() { if (!ac || !on) return; const o = ac.createOscillator(), g = ac.createGain(), t = ac.currentTime; o.type = 'triangle'; o.frequency.setValueAtTime(600, t); o.frequency.linearRampToValueAtTime(900, t + 0.15); o.frequency.linearRampToValueAtTime(500, t + 0.4); g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.05, t + 0.05); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.42); o.connect(g).connect(sfx); o.start(t); o.stop(t + 0.45); },
  neigh(k = 1) { tone([[700, 0.08, 'sawtooth', 0.025 * k], [900, 0.1, 'sawtooth', 0.025 * k], [760, 0.12, 'sawtooth', 0.02 * k], [600, 0.18, 'sawtooth', 0.015 * k]]); },
  whistle() { tone([[1800, 0.12, 'sine', 0.05], [2400, 0.25, 'sine', 0.05]]); },
  // The horse (Plan F §5.4). The long whistle that gets no answer (too far): up, held, and falling away
  whistleLong() {
    if (!ac || !on) return;
    const o = ac.createOscillator(), g = ac.createGain(), t = ac.currentTime;
    o.type = 'sine';
    o.frequency.setValueAtTime(1650, t); o.frequency.exponentialRampToValueAtTime(2450, t + 0.22); o.frequency.setValueAtTime(2450, t + 0.62); o.frequency.exponentialRampToValueAtTime(1750, t + 1.05);
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.05, t + 0.04); g.gain.setValueAtTime(0.05, t + 0.62); g.gain.exponentialRampToValueAtTime(0.0001, t + 1.1);
    o.connect(g).connect(sfx); o.start(t); o.stop(t + 1.15);
  },
  // A snort: air blown hard through the nostrils, a breathy hiss that falls, fluttering (the lips) at about 26 Hz.
  // k: how loud (a horse further away, quieter)
  snort(k = 1) {
    if (!ac || !on || !(k > 0.01)) return;
    const t = ac.currentTime, src = ac.createBufferSource(), f = ac.createBiquadFilter(), g = ac.createGain(), am = ac.createGain(), lfo = ac.createOscillator(), depth = ac.createGain();
    src.buffer = noise; f.type = 'bandpass'; f.Q.value = 0.9;
    f.frequency.setValueAtTime(1100, t); f.frequency.exponentialRampToValueAtTime(420, t + 0.5);
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.34 * k, t + 0.035); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.55);
    am.gain.value = 0.6; lfo.frequency.value = 26 + Math.random() * 6; depth.gain.value = 0.4;
    lfo.connect(depth).connect(am.gain);
    src.connect(f).connect(am).connect(g).connect(sfx);
    src.start(t, Math.random() * 0.4, 0.6); lfo.start(t); lfo.stop(t + 0.6);
  },
  // One hoof strike (three/actors.js plays it as each hoof lands: 2 a cycle at the trot, its diagonal pairs land
  // together; at the gallop each strike sounds its pair, a beat apart, so the four beats come from 2 calls a cycle).
  // hard: a path, stone or something built (a ringing clop: a sharp click and the shoe's knock); otherwise grass or earth
  // (a soft, low thud). k: how loud, 0..1 (another's horse further away, quieter); the walk is lighter
  hooves(gait = 1, hard = false, k = 1) {
    if (!ac || !on || !(k > 0.01)) return;
    const t = ac.currentTime, v = k * (gait === 0 ? 0.7 : 1);   // (3, the canter: its three beats are three calls a cycle, the diagonal pair in one)
    clop(t, hard, v);
    if (gait === 2) clop(t + 0.034, hard, v * 0.8);
  },
  // A sliding stop: hooves ploughing the ground, a rasp that falls and dies in about 0.6 s, with a low thump as it digs in
  skid(k = 1) {
    if (!ac || !on || !(k > 0.01)) return;
    const t = ac.currentTime, src = ac.createBufferSource(), f = ac.createBiquadFilter(), g = ac.createGain();
    src.buffer = noise; src.loop = true; f.type = 'bandpass'; f.Q.value = 0.8;
    f.frequency.setValueAtTime(900, t); f.frequency.exponentialRampToValueAtTime(260, t + 0.6);
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.3 * k, t + 0.04); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.65);
    src.connect(f).connect(g).connect(sfx);
    src.start(t, Math.random() * 0.4); src.stop(t + 0.7);
    clop(t, false, k); clop(t + 0.07, false, k * 0.8);
  },
  // The cart (cart.js): its iron tyres over the ground, a bump each half metre (on stone and paths harder and higher); and the
  // wood of the shafts creaking in a turn
  rumble(hard = false, k = 1) { Audio.noiseHit(hard ? 260 + Math.random() * 90 : 150 + Math.random() * 60, 0.12, (hard ? 0.16 : 0.1) * k, 'lowpass'); if (hard && Math.random() < 0.3) Audio.noiseHit(1800, 0.02, 0.03 * k); },
  creak(k = 1) { if (!ac || !on) return; const o = ac.createOscillator(), g = ac.createGain(), t = ac.currentTime, f = 180 + Math.random() * 80; o.type = 'sawtooth'; o.frequency.setValueAtTime(f, t); o.frequency.linearRampToValueAtTime(f * 1.35, t + 0.22); g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.018 * k, t + 0.05); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.28); o.connect(g).connect(sfx); o.start(t); o.stop(t + 0.3); },
  // Pesca: el corcho cae al agua, una picada de mentira, el chapuzón al clavar y el carrete al recoger
  drip(k = 1) { const f = 900 + Math.random() * 500; tone([[f, 0.025, 'sine', 0.035 * k], [f * 1.6, 0.04, 'sine', 0.02 * k]]); Audio.noiseHit(2600, 0.02, 0.05 * k); },   // (a drop from a leaking roof)
  plop() { Audio.noiseHit(900, 0.12, 0.22, 'lowpass'); tone([[420, 0.05, 'sine', 0.05], [260, 0.08, 'sine', 0.04]]); },
  nibble: () => tone([[1200, 0.02, 'sine', 0.025], [1500, 0.02, 'sine', 0.02]]),
  // Fishing: the float going under (a real bite; low: a deeper one), the reel's ratchet, the line crying before it breaks
  // (for s seconds, rising) and its snap
  bob(low) { Audio.noiseHit(low ? 420 : 620, 0.16, 0.2, 'lowpass'); tone(low ? [[300, 0.06, 'sine', 0.05], [170, 0.1, 'sine', 0.05]] : [[480, 0.05, 'sine', 0.04], [320, 0.07, 'sine', 0.035]]); },
  reel(k = 0.6) { Audio.noiseHit(2300 + 900 * k, 0.018, 0.07 + 0.08 * k); },
  lineCry(s = 1) {
    if (!ac || !on) return;
    const src = ac.createBufferSource(), f = ac.createBiquadFilter(), g = ac.createGain(), now = ac.currentTime, d = Math.max(0.15, Math.min(1.5, s));
    src.buffer = noise; src.loop = true; f.type = 'bandpass'; f.Q.value = 9;
    f.frequency.setValueAtTime(1300, now); f.frequency.exponentialRampToValueAtTime(3400, now + d);
    g.gain.setValueAtTime(0.0005, now); g.gain.exponentialRampToValueAtTime(0.16, now + d);
    src.connect(f).connect(g).connect(sfx); src.start(now); src.stop(now + d);
  },
  // A little brass bell on the tip of a rod (v: how near), and a wicker trap hauled out: water running off, the creel creaking,
  // and what is in it (n) scrabbling
  fishBell(v = 1) {
    if (!ac || !on) return;
    const t0 = ac.currentTime;
    for (const [dt, k] of [[0, 1], [0.11, 0.7], [0.2, 0.85], [0.33, 0.5]]) for (const [f, a, d] of [[2093, 0.05, 0.5], [3140, 0.03, 0.35], [5230, 0.012, 0.2]]) {
      const o = ac.createOscillator(), g = ac.createGain(), at = t0 + dt;
      o.type = 'sine'; o.frequency.value = f * (1 + dt * 0.02);
      g.gain.setValueAtTime(0.0001, at); g.gain.exponentialRampToValueAtTime(a * v * k, at + 0.004); g.gain.exponentialRampToValueAtTime(0.0001, at + d);
      o.connect(g).connect(sfx); o.start(at); o.stop(at + d + 0.02);
    }
  },
  trapRattle(n = 0) {
    Audio.splash();
    for (let i = 0; i < 3; i++) setTimeout(() => Audio.noiseHit(500 + 150 * i, 0.12, 0.1, 'bandpass'), 180 + i * 190);
    for (let i = 0; i < Math.min(9, n * 3); i++) setTimeout(() => Audio.noiseHit(2600 + Math.random() * 1800, 0.02, 0.09, 'highpass'), 260 + i * 85 + Math.random() * 40);
  },
  lineSnap() { Audio.noiseHit(3600, 0.05, 0.4, 'highpass'); tone([[900, 0.03, 'square', 0.04], [300, 0.05, 'triangle', 0.05]]); },
  // A horse drinking (a deep, round gulp) and grazing (a tear and a chew)
  glass(k = 1) { tone([[2350, 0.05, 'sine', 0.05 * k], [3120, 0.09, 'sine', 0.035 * k]]); Audio.noiseHit(5200, 0.02, 0.06 * k, 'highpass'); },   // (a pane or a bell of glass, set down or struck)
  gulp() { Audio.noiseHit(320, 0.09, 0.12, 'lowpass'); tone([[150, 0.05, 'sine', 0.045], [105, 0.08, 'sine', 0.035]]); },
  munch() { Audio.noiseHit(2600, 0.05, 0.05, 'bandpass'); setTimeout(() => Audio.noiseHit(900, 0.07, 0.04, 'bandpass'), 130); },
  wade() { Audio.noiseHit(500 + Math.random() * 300, 0.18, 0.06, 'lowpass'); },   // (un paso con el agua por las rodillas)
  swim() { Audio.noiseHit(700 + Math.random() * 300, 0.32, 0.1, 'lowpass'); setTimeout(() => Audio.noiseHit(2600, 0.12, 0.03, 'highpass'), 60); },   // (una brazada: el agua que se aparta)
  splash() { Audio.noiseHit(1400, 0.3, 0.35, 'lowpass'); Audio.noiseHit(4000, 0.15, 0.1, 'highpass'); },
  // Lluvia de fondo: 0 = nada, 1 = lluvia, 2 = tormenta
  // (glass: on the roof of a greenhouse, over one's head: brighter, a patter)
  rain(level, glass = false) {
    if (!ac) return;
    if (!rainSrc) {
      rainSrc = ac.createBufferSource(); rainSrc.buffer = noise; rainSrc.loop = true;
      const f = rainTone = ac.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = 1800; f.Q.value = 0.4;
      rainGain = ac.createGain(); rainGain.gain.value = 0;
      rainSrc.connect(f).connect(rainGain).connect(sfx); rainSrc.start();
    }
    const v = glass ? level * 0.075 : Audio.indoors ? level * 0.02 : level * 0.06;
    rainTone.frequency.setTargetAtTime(glass ? 3600 : 1800, ac.currentTime, 0.4);
    rainGain.gain.setTargetAtTime(v, ac.currentTime, 0.8);
  },
  thunder() {
    if (!ac || !on) return;
    const src = ac.createBufferSource(), f = ac.createBiquadFilter(), g = ac.createGain(), t = ac.currentTime + 0.3 + Math.random() * 0.8;
    src.buffer = noise; src.loop = true; f.type = 'lowpass'; f.frequency.value = 160;
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.9, t + 0.08); g.gain.exponentialRampToValueAtTime(0.001, t + 2.2);
    src.connect(f).connect(g).connect(sfx); src.start(t); src.stop(t + 2.4);
  },
  // Under the water the world sounds muffled: a lowpass of about 600 Hz on the effects bus while on (diving: engine.js
  // calls it when the camera goes under or comes up), eased over a fifth of a second. The music gets its own gentler one
  // (1.6 kHz, Plan J §3.5) on the same call, so the score stays soft but clear instead of turning to mud. Both are made
  // the first time they are needed (sfx → lowpass → master, musicBus → musicLow → master)
  muffle(down) {
    if (!ac || !master) return;
    if (!lowpass) {
      if (!down) return;
      lowpass = lowPass(); musicLow = lowPass();
      sfx.disconnect(); sfx.connect(lowpass).connect(master);
      wireMusic();
    }
    lowpass.frequency.setTargetAtTime(down ? MUFFLE_HZ.sfx : 20000, ac.currentTime, 0.06);
    musicLow.frequency.setTargetAtTime(down ? MUFFLE_HZ.music : 20000, ac.currentTime, 0.06);
  },
  // The pause (src/ui/pausehub.js): the music goes on quieter and muffled, as through a wall. The effects stay (the menu's own
  // sounds are there)
  duck(down) {
    ducked = down;
    if (!ac || !master) return;
    if (!duckLow) {
      if (!down) return;
      duckLow = lowPass(); duckGain = ac.createGain();
      wireMusic();
    }
    duckLow.frequency.setTargetAtTime(down ? DUCK.hz : 20000, ac.currentTime, 0.05);
    duckGain.gain.setTargetAtTime(down ? DUCK.gain : 1, ac.currentTime, 0.05);
  },
  get ducked() { return ducked; },
  get on() { return on; },
  toggle() { on = !on; if (master) master.gain.value = on ? vol.master : 0; return on; },
  get ctx() { return ac; },
  get musicBus() { return musicBus; },
  get volumes() { return { ...vol }; },
  // Volúmenes de 0 a 1: general, música y efectos
  setVolumes(v) {
    Object.assign(vol, v);
    if (!ac) return;
    master.gain.value = on ? vol.master : 0;
    sfx.gain.value = vol.sfx;
    musicBus.gain.value = vol.music;
  },
};

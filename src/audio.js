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
let rainSrc = null, rainGain = null;
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
  clink() { tone([[1400, 0.04, 'square', 0.04], [1050, 0.06, 'square', 0.03]]); Audio.noiseHit(2500, 0.05, 0.15); },
  swish() { Audio.noiseHit(3000, 0.08, 0.12, 'highpass'); },
  till() { Audio.noiseHit(300, 0.12, 0.3); },
  fell: () => tone([[180, 0.08, 'triangle', 0.08], [120, 0.1, 'triangle', 0.08], [80, 0.16, 'triangle', 0.08]]),
  pickup: () => tone([[880, 0.03, 'square', 0.03], [1320, 0.04, 'square', 0.03]]),
  eat: () => tone([[300, 0.05, 'square', 0.04], [240, 0.05, 'square', 0.04], [300, 0.05, 'square', 0.04]]),
  error: () => tone([[160, 0.1, 'sawtooth', 0.04]]),
  place() { Audio.noiseHit(220, 0.1, 0.35); tone([[140, 0.08, 'triangle', 0.08]]); },
  craft() { Audio.clink(); setTimeout(() => tone([[660, 0.05, 'square', 0.03], [880, 0.05, 'square', 0.03], [1320, 0.08, 'square', 0.03]]), 120); },
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
  // Animales: el gallo al amanecer, el perro, el gato, el caballo y el silbato
  crow() { tone([[520, 0.12, 'sawtooth', 0.025], [700, 0.1, 'sawtooth', 0.03], [880, 0.35, 'sawtooth', 0.025], [620, 0.2, 'sawtooth', 0.02]]); },
  bark() { tone([[320, 0.06, 'sawtooth', 0.05], [240, 0.08, 'square', 0.03]]); Audio.noiseHit(600, 0.08, 0.2); },
  meow() { if (!ac || !on) return; const o = ac.createOscillator(), g = ac.createGain(), t = ac.currentTime; o.type = 'triangle'; o.frequency.setValueAtTime(600, t); o.frequency.linearRampToValueAtTime(900, t + 0.15); o.frequency.linearRampToValueAtTime(500, t + 0.4); g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.05, t + 0.05); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.42); o.connect(g).connect(sfx); o.start(t); o.stop(t + 0.45); },
  neigh() { tone([[700, 0.08, 'sawtooth', 0.025], [900, 0.1, 'sawtooth', 0.025], [760, 0.12, 'sawtooth', 0.02], [600, 0.18, 'sawtooth', 0.015]]); },
  whistle() { tone([[1800, 0.12, 'sine', 0.05], [2400, 0.25, 'sine', 0.05]]); },
  // Pesca: el corcho cae al agua, una picada de mentira, el chapuzón al clavar y el carrete al recoger
  plop() { Audio.noiseHit(900, 0.12, 0.22, 'lowpass'); tone([[420, 0.05, 'sine', 0.05], [260, 0.08, 'sine', 0.04]]); },
  nibble: () => tone([[1200, 0.02, 'sine', 0.025], [1500, 0.02, 'sine', 0.02]]),
  splash() { Audio.noiseHit(1400, 0.3, 0.35, 'lowpass'); Audio.noiseHit(4000, 0.15, 0.1, 'highpass'); },
  reel: () => tone([[1900 + Math.random() * 300, 0.012, 'square', 0.012]]),
  // Lluvia de fondo: 0 = nada, 1 = lluvia, 2 = tormenta
  rain(level) {
    if (!ac) return;
    if (!rainSrc) {
      rainSrc = ac.createBufferSource(); rainSrc.buffer = noise; rainSrc.loop = true;
      const f = ac.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = 1800; f.Q.value = 0.4;
      rainGain = ac.createGain(); rainGain.gain.value = 0;
      rainSrc.connect(f).connect(rainGain).connect(sfx); rainSrc.start();
    }
    const v = Audio.indoors ? level * 0.02 : level * 0.06;
    rainGain.gain.setTargetAtTime(v, ac.currentTime, 0.8);
  },
  thunder() {
    if (!ac || !on) return;
    const src = ac.createBufferSource(), f = ac.createBiquadFilter(), g = ac.createGain(), t = ac.currentTime + 0.3 + Math.random() * 0.8;
    src.buffer = noise; src.loop = true; f.type = 'lowpass'; f.frequency.value = 160;
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.9, t + 0.08); g.gain.exponentialRampToValueAtTime(0.001, t + 2.2);
    src.connect(f).connect(g).connect(sfx); src.start(t); src.stop(t + 2.4);
  },
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

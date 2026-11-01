// Música generada al vuelo (chiptune suave): cada ambiente tiene su tempo, su escala y sus acordes,
// y la melodía sale de una semilla, así suena igual cada vez que vuelve. Cambia con la hora, el clima,
// las cuevas y las mazmorras, con un fundido entre temas.
import { Audio } from './audio.js';
import { ihash } from './util.js';

const MAJOR = [0, 2, 4, 7, 9], MINOR = [0, 3, 5, 7, 10], DORIAN = [0, 2, 3, 7, 9];
const MOODS = {
  dia: { bpm: 104, root: 60, scale: MAJOR, chords: [0, 5, 3, 4], lead: 'square', density: 0.6, vol: 0.05, drums: true },
  tarde: { bpm: 88, root: 57, scale: DORIAN, chords: [0, 3, 4, 0], lead: 'triangle', density: 0.45, vol: 0.06, drums: false },
  noche: { bpm: 70, root: 55, scale: MINOR, chords: [0, 5, 3, 4], lead: 'triangle', density: 0.3, vol: 0.06, drums: false },
  lluvia: { bpm: 76, root: 57, scale: MINOR, chords: [0, 3, 5, 4], lead: 'sine', density: 0.35, vol: 0.07, drums: false },
  invierno: { bpm: 80, root: 62, scale: MAJOR, chords: [0, 3, 4, 5], lead: 'sine', density: 0.4, vol: 0.07, drums: false },
  cueva: { bpm: 60, root: 45, scale: MINOR, chords: [0, 0, 5, 3], lead: 'triangle', density: 0.18, vol: 0.06, drums: false, drone: true },
  templo: { bpm: 72, root: 50, scale: [0, 1, 4, 5, 7], chords: [0, 1, 0, 4], lead: 'square', density: 0.3, vol: 0.035, drums: true },
  casa: { bpm: 84, root: 60, scale: MAJOR, chords: [0, 3, 4, 3], lead: 'triangle', density: 0.4, vol: 0.06, drums: false },
};
const hz = n => 440 * Math.pow(2, (n - 69) / 12);

export const Music = {
  mood: null,
  timer: null,
  next: 0,
  step: 0,
  bus: null,
  enabled: true,

  // Elige el ambiente según dónde y cuándo estás
  pick(game) {
    const sc = game.scene, T = game.days;
    if (!game.player || !sc) return 'dia';
    if (sc.kind === 'grid') return sc.style === 'temple' ? 'templo' : 'cueva';
    if (game.indoors) return 'casa';
    if (T.info.rain) return 'lluvia';
    if (T.season === 3) return T.isNight() ? 'noche' : 'invierno';
    const h = T.hour;
    return h >= 20 || h < 6 ? 'noche' : h >= 17 ? 'tarde' : 'dia';
  },
  update(game) {
    if (!Audio.ctx || !this.enabled) return;
    const want = game.mode === 'menu' ? 'tarde' : this.pick(game);
    if (want !== this.mood) this.play(want);
  },
  play(mood) {
    const ac = Audio.ctx;
    if (!ac) return;
    // Fundido: el tema anterior se apaga en su propio canal
    if (this.bus) { const old = this.bus; old.gain.setTargetAtTime(0, ac.currentTime, 0.6); setTimeout(() => old.disconnect(), 3000); }
    this.bus = ac.createGain();
    this.bus.gain.value = 0;
    this.bus.gain.setTargetAtTime(1, ac.currentTime + 0.3, 0.8);
    this.bus.connect(Audio.musicBus);
    this.mood = mood;
    this.step = 0;
    this.next = ac.currentTime + 0.4;
    if (!this.timer) this.timer = setInterval(() => this.schedule(), 90);
  },
  // Programa las notas de los próximos instantes (así no se oyen saltos aunque el juego vaya a tirones)
  schedule() {
    const ac = Audio.ctx, m = MOODS[this.mood];
    if (!ac || !m || !this.bus) return;
    const beat = 60 / m.bpm / 2;   // corcheas
    while (this.next < ac.currentTime + 0.35) {
      const s = this.step, bar = Math.floor(s / 8) % m.chords.length, inBar = s % 8, t = this.next;
      const deg = m.chords[bar], chordRoot = m.root + m.scale[deg % m.scale.length] + (deg >= m.scale.length ? 12 : 0);
      if (inBar === 0) {   // bajo y acorde
        this.note(t, hz(chordRoot - 12), beat * 7.5, 'triangle', m.vol * 1.1);
        if (m.drone) this.note(t, hz(chordRoot - 24), beat * 8, 'sine', m.vol * 1.4);
        else for (const k of [0, 2, 4]) this.note(t, hz(m.root + m.scale[(deg + k) % 5] + 12 * Math.floor((deg + k) / 5)), beat * 6, 'sine', m.vol * 0.35);
      } else if (inBar === 4 && !m.drone) this.note(t, hz(chordRoot - 12 + 7), beat * 3.5, 'triangle', m.vol * 0.8);
      // Melodía: notas de la escala elegidas con la semilla del compás (se repite cada 4 compases)
      const r = ihash(s % 32, Math.floor(s / 32) % 2, this.mood.length * 97);
      if (r < m.density) {
        const idx = Math.floor(ihash(s % 32, 7, this.mood.length) * 8), note = m.root + 12 + m.scale[idx % 5] + (idx >= 5 ? 12 : 0);
        this.note(t, hz(note), beat * (r < m.density / 3 ? 2 : 1) * 0.9, m.lead, m.vol * (m.lead === 'square' ? 0.5 : 0.9));
      }
      if (m.drums && inBar % 2 === 0) this.hat(t, inBar === 0 || inBar === 4 ? 0.05 : 0.025);
      this.step++;
      this.next += beat;
    }
  },
  note(t, f, d, type, v) {
    const ac = Audio.ctx, o = ac.createOscillator(), g = ac.createGain();
    o.type = type; o.frequency.value = f;
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(v, t + 0.02); g.gain.exponentialRampToValueAtTime(0.0001, t + d);
    o.connect(g).connect(this.bus); o.start(t); o.stop(t + d + 0.05);
  },
  hat(t, v) {
    const ac = Audio.ctx, len = 0.04, buf = ac.createBuffer(1, ac.sampleRate * len, ac.sampleRate), d = buf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / d.length);
    const src = ac.createBufferSource(), f = ac.createBiquadFilter(), g = ac.createGain();
    src.buffer = buf; f.type = 'highpass'; f.frequency.value = 6000; g.gain.value = v;
    src.connect(f).connect(g).connect(this.bus); src.start(t);
  },
};

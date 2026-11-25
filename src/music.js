// The music (Plan J §3, docs/planes/gta/PLAN-J-ruta-musica.md). The dynamic music is a conductor: a mood (where, when)
// × an intensity (idle, moving, ride, danger) decided by musicstate.js, played as up to six layers of a score
// (musicscore.js) whose gains change on bar lines, with stingers, rests between calm pieces, a tavern band heard from
// outside and pre-rendered synthesized voices (musicvoices.js). ?musica=0 (or =chip) keeps the old music exactly:
// LegacyMusic below, chosen at load. Both expose the same object: update(game) (game.js, every 30 frames), enabled and
// calm (settings.js; mode = 'calm' works too), cue(id), venue(spec) and render(ctx, script).
import { Audio } from './audio.js';
import { ihash } from './util.js';
import { apagada, opcion } from './opciones.js';
import { reportFault } from './faults.js';
import { musicState } from './musicstate.js';
import { inTavern } from './world/village.js';
import {
  SCORES, LAYERS, LAYER_GAIN, STALK_GAIN, CUES, STINGER_GAP, REST_CYCLES, REST_S, OUTDOOR, TWO_LEVELS, WEDDING, TAVERN_TUNES,
  resolveScore, rideOf, tenseOf, composeBar, stingerNotes, stingerLength, unitS, barS, beatUnits,
} from './musicscore.js';
import { Voices, Room, cacheBytes } from './musicvoices.js';

// ---------------------------------------------------------------------------------------------------------------------
// LegacyMusic: the music of before Plan J, kept as it was (?musica=0). Only render() is new, for the A/B review WAVs.

// Música generada al vuelo (chiptune suave): cada ambiente tiene su tempo, su escala y sus acordes,
// y la melodía sale de una semilla, así suena igual cada vez que vuelve. Cambia con la hora, el clima,
// las cuevas y las mazmorras, con un fundido entre temas.
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
// (the new English mood ids, for render scripts written for the dynamic music)
const LEGACY_OF = { day: 'dia', dusk: 'tarde', night: 'noche', rain: 'lluvia', winter: 'invierno', cave: 'cueva', temple: 'templo', home: 'casa', menu: 'tarde' };
const hz = n => 440 * Math.pow(2, (n - 69) / 12);

export const LegacyMusic = {
  mood: null,
  timer: null,
  next: 0,
  step: 0,
  bus: null,
  enabled: true,
  calm: false,
  mode: 'dynamic',
  venues: [],
  ac: null,   // (the context: Audio.ctx, or an offline one while render runs)
  cue() {},
  venue(spec) {
    if (!spec || !Number.isFinite(spec.x) || !Number.isFinite(spec.y)) return () => {};
    this.venues.push(spec);
    return () => { const i = this.venues.indexOf(spec); if (i >= 0) this.venues.splice(i, 1); };
  },
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
    const ac = this.ac = Audio.ctx;
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
  schedule(until) {
    const ac = this.ac, m = MOODS[this.mood];
    if (!ac || !m || !this.bus) return;
    const beat = 60 / m.bpm / 2;   // corcheas
    const end = until ?? ac.currentTime + 0.35;
    while (this.next < end) {
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
      this.count = (this.count || 0) + 1;
    }
  },
  note(t, f, d, type, v) {
    const ac = this.ac, o = ac.createOscillator(), g = ac.createGain();
    o.type = type; o.frequency.value = f;
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(v, t + 0.02); g.gain.exponentialRampToValueAtTime(0.0001, t + d);
    o.connect(g).connect(this.bus); o.start(t); o.stop(t + d + 0.05);
  },
  hat(t, v) {
    const ac = this.ac, len = 0.04, buf = ac.createBuffer(1, ac.sampleRate * len, ac.sampleRate), d = buf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / d.length);
    const src = ac.createBufferSource(), f = ac.createBiquadFilter(), g = ac.createGain();
    src.buffer = buf; f.type = 'highpass'; f.frequency.value = 6000; g.gain.value = v;
    src.connect(f).connect(g).connect(this.bus); src.start(t);
  },
  // The old music offline, for the A/B review: script [{ at, mood (an English or old Spanish id) }, …]; every step is
  // scheduled up front on ctx. Returns the steps scheduled. The live state is put back afterwards
  render(ctx, script) {
    const keep = { ac: this.ac, bus: this.bus, mood: this.mood, next: this.next, step: this.step, count: this.count };
    const end = ctx.length / ctx.sampleRate, list = [...(script || [])].sort((a, b) => a.at - b.at);
    this.ac = ctx; this.count = 0; this.mood = null; this.next = 0; this.step = 0;
    this.bus = ctx.createGain(); this.bus.connect(ctx.destination);
    this.bus.gain.value = Audio.volumes?.music ?? 0.5;
    try {
      list.forEach((e, i) => {
        const mood = LEGACY_OF[e.mood] || (MOODS[e.mood] ? e.mood : 'dia');
        if (mood !== this.mood) { this.mood = mood; this.step = 0; this.next = Math.max(e.at, this.next || 0); }
        this.schedule(Math.min(end, i + 1 < list.length ? list[i + 1].at : end));
      });
      return this.count;
    } finally { Object.assign(this, keep); }
  },
};

// ---------------------------------------------------------------------------------------------------------------------
// The dynamic music

const LOOK = 0.35, LOOK_HIDDEN = 1.6;   // (s scheduled ahead: a hidden tab gets one timer a second, so it looks further)
const RESYNC = 0.5;                     // (a track more than this behind the clock jumps to now instead of a burst)
const MAX_CHUNK = 2.6;                  // (bars longer than this are scheduled by halves: changes land within 2.5 s)
const FADE_MAX = 4;                     // (a mood swap crossfades over two bars, at most this long)
// (levels: the whole music sits at MUSIC_LEVEL of the music bus, about as loud as the old music (the review WAVs of 2026-11-23:
// the day piece at 0.45 measured 11 dB above the old day music, so 0.2: about 4 dB above it); then the score, the band
// and the stingers inside it)
const MUSIC_LEVEL = 0.2, SCORE_LEVEL = 0.9, BAND_LEVEL = 0.85, STINGER_LEVEL = 0.8;
const BAND_LP_OUT = 900;                // (the band through the tavern walls)
const SLEEP_LEVEL = 0.15;
const WEDDING_DUCK = 0.3;

const clampFor = (id, I) => (OUTDOOR.includes(id) ? I : TWO_LEVELS.includes(id) ? (I === 3 ? 3 : 1) : 1);
const variantOf = I => (I === 2 ? 'ride' : I === 3 ? 'tense' : 'base');
const levelAt = (lv, t) => (t >= lv.t1 ? lv.v1 : t <= lv.t0 ? lv.v0 : lv.v0 + (lv.v1 - lv.v0) * (t - lv.t0) / (lv.t1 - lv.t0));
// A linear ramp from wherever the param is at T (our own record, so a ramp cut halfway does not jump)
function ramp(param, lv, target, T, dur) {
  const v = levelAt(lv, T);
  if (param.cancelAndHoldAtTime) param.cancelAndHoldAtTime(T); else param.cancelScheduledValues(T);
  param.setValueAtTime(v, T);
  param.linearRampToValueAtTime(target, T + Math.max(0.01, dur));
  lv.v0 = v; lv.v1 = target; lv.t0 = T; lv.t1 = T + Math.max(0.01, dur);
}
const newLevel = (v, t) => ({ v0: v, v1: v, t0: t, t1: t });
// The notes of one chunk (a bar or half of one), sorted by time and played as the look-ahead reaches them, a few per
// tick, instead of all at once when the chunk starts (a busy tavern bar is 44 notes: two nodes each)
const byAt = (a, b) => a.at - b.at;
const newFeed = () => ({ ev: null, i: 0, barT: 0, u: 0, hi: 0, vol: 1 });
function loadFeed(f, ev, barT, u, lo, hi, vol) {
  ev.sort(byAt);
  let i = 0;
  while (i < ev.length && ev[i].at < lo - 1e-6) i++;
  f.ev = ev; f.i = i; f.barT = barT; f.u = u; f.hi = hi; f.vol = vol;
}
const seedOf = (day, a, b) => Math.floor(ihash(day | 0, a | 0, b | 0) * 4294967296) | 0;
const MOOD_INDEX = id => Math.max(0, Object.keys(SCORES).indexOf(id));

// One score playing on its own bus: layer gains → fade → (tone lowpass) → the score duck
class Track {
  constructor(c, id, score, T) {
    const ac = c.ctx;
    this.c = c; this.id = id; this.base = score; this.score = score; this.mi = MOOD_INDEX(id);
    this.fade = ac.createGain(); this.fade.gain.value = 0; this.fadeLv = newLevel(0, T);
    let tail = this.fade;
    if (score.tone) { this.tone = ac.createBiquadFilter(); this.tone.type = 'lowpass'; this.tone.frequency.value = score.tone; this.fade.connect(this.tone); tail = this.tone; }
    tail.connect(c.duck);
    this.tail = tail;
    this.layers = {}; this.lv = {};
    for (const L of LAYERS) { const g = ac.createGain(); g.gain.value = 0; g.connect(this.fade); this.layers[L] = g; this.lv[L] = newLevel(0, T); }
    this.intensity = null; this.stalk = false; this.lowAir = false;
    this.bar = 0; this.cycle = 0; this.half = 0;
    this.nextT = T; this.lastT = T; this.barT = T;
    this.events = null; this.feed = newFeed();
    this.resting = false; this.restUntil = 0; this.cyclesDone = 0; this.restIdx = 0;
    this.cyclesTarget = this.restCycles();
    this.fadingUntil = Infinity; this.dead = false;
  }
  restCycles() { const [a, b] = REST_CYCLES; return a + Math.floor(ihash(this.c.day, this.mi, 401 + this.restIdx) * (b - a + 1)); }
  restSeconds() { const [a, b] = REST_S; return a + ihash(this.c.day, this.mi, 503 + this.restIdx) * (b - a); }
  fadeTo(v, T, dur) { ramp(this.fade.gain, this.fadeLv, v, T, dur); }
  get restable() { return OUTDOOR.includes(this.id) && (this.intensity ?? 1) <= 1 && !this.stalk && this.c.bandLevel < 0.01 && !this.c.piece; }
  gainFor(L, I, stalk) { return stalk ? STALK_GAIN[L] : LAYER_GAIN[L][I]; }
  // The conductor's wish (intensity, stalking, low air) taken at a chunk boundary: the variant score (tempo at a bar
  // line), layer ramps (up over a bar, two when leaving danger; down quickly when the variant changes, so two modes
  // never sound together) and the relief stinger. Returns true when the notes of the bar must be composed again
  applyAt(T) {
    const c = this.c, w = c.want;
    const I = clampFor(this.id, w.intensity), stalk = !!w.stalk && I <= 1, lowAir = !!w.lowAir;
    if (I === this.intensity && stalk === this.stalk && lowAir === this.lowAir) return false;
    const prevI = this.intensity, first = prevI === null;
    const variantChanged = !first && variantOf(prevI) !== variantOf(I);
    const oldU = unitS(this.score);
    this.score = I === 2 ? rideOf(this.base) : I === 3 ? tenseOf(this.base) : this.base;
    const bs = barS(this.score);
    const up = first ? 0.01 : prevI === 3 && I !== 3 ? Math.min(2 * bs, 5) : Math.min(bs, 2.5);
    const down = first ? 0.01 : variantChanged || stalk !== this.stalk ? 0.45 : Math.min(bs, 2.5);
    for (const L of LAYERS) {
      const target = this.gainFor(L, I, stalk), cur = levelAt(this.lv[L], T);
      if (Math.abs(target - this.lv[L].v1) < 1e-4 && !first) continue;
      ramp(this.layers[L].gain, this.lv[L], target, T, target < cur ? down : up);
    }
    // (a tempo change in the middle of a long bar restarts the grid of that bar at T)
    if (this.half && unitS(this.score) !== oldU) this.barT = T - (this.score.meter / 2) * unitS(this.score);
    if (!first && prevI === 3 && I !== 3) c.stinger('relief', T);
    this.intensity = I; this.stalk = stalk; this.lowAir = lowAir;
    return true;
  }
  compose() {
    const seed = seedOf(this.c.day, this.mi, this.cycle);
    this.events = composeBar(this.score, this.bar, seed, { intensity: this.intensity ?? 1, stalk: this.stalk, lowAir: this.lowAir });
  }
  // A hidden tab or a suspended context: jump the grid to now (a fresh bar) instead of playing the backlog in a burst
  resync(now) { this.nextT = this.barT = this.lastT = now + 0.05; this.half = 0; this.events = null; this.feed.ev = null; }
  // Plays the notes of the current chunk that start before until (Infinity: all that are left)
  drain(until) {
    const f = this.feed, ev = f.ev;
    if (!ev) return;
    const c = this.c, active = this === c.track;
    while (f.i < ev.length) {
      const e = ev[f.i];
      if (e.at >= f.hi - 1e-6) break;
      const t = f.barT + e.at * f.u;
      if (t >= until) return;
      f.i++;
      if (this.lv[e.layer].v1 <= 0.001) continue;
      if (!active && e.layer !== 'pad' && e.layer !== 'bass') continue;   // (a fading track keeps only its floor)
      if (t >= this.fadingUntil) continue;
      c.voices.play(e.voice, t, e.midi, e.len * f.u, e.vel * f.vol, this.layers[e.layer], e.layer);
    }
    f.ev = null;
  }
  // Starts one chunk (a bar, or half a long bar) at nextT: its notes go to the feed (drain plays them)
  stepOnce() {
    const c = this.c, T = this.nextT, active = this === c.track;
    this.feed.ev = null;
    if (this.fadingUntil <= T) { this.dead = true; return; }
    let fresh = false;
    if (active) fresh = this.applyAt(T);
    if (this.resting) {
      if (T + 1e-6 >= this.restUntil) {
        // (the rest is over, or something ended it: a fresh cycle from the theme, faded in over a bar)
        this.resting = false; this.bar = 0; this.half = 0; this.barT = T; this.cycle++; this.cyclesDone = 0; this.restIdx++;
        this.cyclesTarget = this.restCycles();
        this.fadeTo(1, T, Math.min(barS(this.score), 2.5));
        fresh = true;
      } else { this.lastT = T; this.nextT = T + Math.min(barS(this.score), MAX_CHUNK); return; }
    }
    if (this.half === 0) {
      if (this.bar >= 16) {
        this.bar = 0; this.cycle++;
        if (active && this.restable && ++this.cyclesDone >= this.cyclesTarget) {
          this.resting = true; this.restUntil = T + this.restSeconds();
          this.fadeTo(0, T, 2.5);
          this.lastT = T; this.nextT = T + Math.min(barS(this.score), MAX_CHUNK);
          return;
        }
      }
      this.barT = T; fresh = true;
    }
    if (fresh || !this.events) this.compose();
    const sc = this.score, u = unitS(sc), m = sc.meter, halves = barS(sc) > MAX_CHUNK;
    const lo = this.half ? m / 2 : 0, hi = halves && !this.half ? m / 2 : m;
    const silent = c.duckTarget < 0.02 || (!active && this.fadeLv.v1 <= 0 && levelAt(this.fadeLv, T) < 0.02);
    if (!silent) loadFeed(this.feed, this.events, this.barT, u, lo, hi, sc.vol ?? 1);
    this.lastT = T;
    this.nextT = this.barT + hi * u;
    if (hi >= m - 1e-6) { this.bar++; this.half = 0; } else this.half = 1;
  }
  fadeOut(T, dur) {
    this.fadeTo(0, T, dur);
    this.fadingUntil = T + dur;
  }
  disconnect() { try { this.tail.disconnect(); } catch { /* gone */ } }
}

// The tavern band (or a venue's music): its own bar clock, bus and lowpass. level 0..1 (musicState band: 0 beyond 25 m,
// up to 0.35 through the walls at 900 Hz, 1 inside and unfiltered)
class Band {
  constructor(c) {
    const ac = c.ctx;
    this.c = c;
    this.bus = ac.createGain(); this.bus.gain.value = 0;
    this.lp = ac.createBiquadFilter(); this.lp.type = 'lowpass'; this.lp.frequency.value = BAND_LP_OUT;
    this.bus.connect(this.lp); this.lp.connect(c.main); this.lp.connect(c.room.input);
    this.level = 0; this.active = false; this.stopAt = Infinity;
    this.bar = 0; this.cycle = 0; this.nextT = 0; this.barT = 0; this.score = null; this.scoreId = null;
    this.patrons = 0; this.claps = false; this.gameUntil = -Infinity; this.venueScore = null;
    this.feed = newFeed();
  }
  drain(until) {
    const f = this.feed, ev = f.ev;
    if (!ev) return;
    while (f.i < ev.length) {
      const e = ev[f.i], t = f.barT + e.at * f.u;
      if (t >= until) return;
      f.i++;
      this.c.voices.play(e.voice, t, e.midi, e.len * f.u, e.vel * f.vol, this.bus, e.layer);
    }
    f.ev = null;
  }
  pickScore() {
    const v = this.venueScore;
    if (v && v !== 'tavern' && SCORES[v]) return resolveScore(v, this.c.outdoorRoot);
    const tune = Math.floor(ihash(this.c.day, this.cycle >> 1, 7) * TAVERN_TUNES.length);
    return resolveScore('tavern', this.c.outdoorRoot, tune);
  }
  set(level, venueScore, patrons, claps, now, duck) {
    level = Math.max(0, Math.min(1, Number.isFinite(level) ? level : 0));
    this.patrons = patrons | 0; this.claps = !!claps;
    if (venueScore !== this.venueScore) { this.venueScore = venueScore; if (this.active) this.score = this.pickScore(); }
    const g = level * BAND_LEVEL * duck;
    if (Math.abs(g - (this.gainSet ?? -1)) > 1e-3) { this.bus.gain.setTargetAtTime(g, now, 0.5); this.gainSet = g; }
    const f = level >= 0.99 ? 20000 : BAND_LP_OUT;
    if (f !== this.lpSet) { this.lp.frequency.setTargetAtTime(f, now, 0.3); this.lpSet = f; }
    if (level > 0.001) {
      this.stopAt = Infinity;
      if (!this.active) { this.active = true; this.bar = 0; this.cycle = 0; this.score = this.pickScore(); this.nextT = this.barT = now + 0.1; }
    } else if (this.active && this.stopAt === Infinity) this.stopAt = now + 2.5;
    this.level = level;
  }
  pump(until, now) {
    if (!this.active) return;
    if (this.nextT < now - RESYNC) { this.nextT = now + 0.05; this.feed.ev = null; }
    this.drain(until);
    while (this.nextT < until) {
      this.drain(Infinity);
      if (this.nextT >= this.stopAt) { this.active = false; return; }
      const sc = this.score, u = unitS(sc), T = this.nextT;
      const ev = composeBar(sc, this.bar, seedOf(this.c.day, 77, this.cycle), { band: { patrons: this.patrons, claps: this.claps, game: T < this.gameUntil } });
      loadFeed(this.feed, ev, T, u, 0, Infinity, sc.vol ?? 1);
      this.barT = T; this.nextT = T + sc.meter * u;
      if (++this.bar >= 16) { this.bar = 0; this.cycle++; if (!(this.cycle & 1)) this.score = this.pickScore(); }
      this.drain(until);
    }
  }
}

// A short piece over the music (the wedding tune): a fixed number of bars on the stinger bus, the score ducked meanwhile
class Piece {
  constructor(c, score, T, bars) { this.c = c; this.score = score; this.bar = 0; this.bars = bars; this.nextT = T; this.end = T + bars * barS(score); this.feed = newFeed(); }
  drain(until) {
    const f = this.feed, ev = f.ev;
    if (!ev) return;
    while (f.i < ev.length) {
      const e = ev[f.i], t = f.barT + e.at * f.u;
      if (t >= until) return;
      f.i++;
      this.c.voices.play(e.voice, t, e.midi, e.len * f.u, e.vel, this.c.stingerBus, e.layer === 'bass' ? 'bass' : 'stinger');
    }
    f.ev = null;
  }
  // Returns whether bars or notes are left. Behind the clock (a hidden tab, a suspended context), the bars it missed are
  // skipped: it goes on from where it would be now, never as a burst of everything missed
  pump(until, now = -Infinity) {
    const sc = this.score, u = unitS(sc), bs = sc.meter * u;
    if (this.nextT < now - RESYNC) {
      const k = Math.ceil((now - this.nextT) / bs);
      this.bar += k; this.nextT += k * bs; this.feed.ev = null;
    }
    this.drain(until);
    while (this.nextT < until && this.bar < this.bars) {
      this.drain(Infinity);
      const T = this.nextT;
      loadFeed(this.feed, composeBar(sc, this.bar, 0, { band: { patrons: 4, claps: true, game: false } }), T, u, 0, Infinity, 1);
      this.nextT = T + bs; this.bar++;
      this.drain(until);
    }
    return this.bar < this.bars || !!this.feed.ev;
  }
}

// The conductor: tracks (one active, at most one fading), the band, stingers and the shared room, on any context
export class Conductor {
  constructor(ctx, out, opts = {}) {
    this.ctx = ctx; this.out = out; this.offline = !!opts.offline;
    this.main = ctx.createGain(); this.main.gain.value = MUSIC_LEVEL; this.main.connect(out);
    this.room = new Room(ctx, this.main);
    this.duck = ctx.createGain(); this.duck.gain.value = SCORE_LEVEL; this.duck.connect(this.main); this.duck.connect(this.room.input);
    this.stingerBus = ctx.createGain(); this.stingerBus.gain.value = STINGER_LEVEL; this.stingerBus.connect(this.main); this.stingerBus.connect(this.room.input);
    this.voices = new Voices(ctx, this.main);
    if (this.offline) this.voices.ignoreHidden = true;
    this.band = new Band(this);
    this.track = null; this.fading = []; this.pendingSwap = null;
    this.want = { intensity: 1, stalk: false, lowAir: false };
    this.calm = false; this.sleeping = false; this.started = false; this.enabled = true;
    this.day = 0; this.outdoorRoot = SCORES.day.root;
    this.bandLevel = 0; this.duckTarget = SCORE_LEVEL; this.piece = null;
    this.lastStinger = {}; this.stingerEnd = -Infinity; this.lastCue = null;
  }
  get notes() { return this.voices.notes; }
  // The state of musicstate.js (plus what Music.update adds: lowAir, patrons, claps, day, calm) at ctx time now
  apply(s, now) {
    if (!s) return;
    this.voices.now = now;
    this.calm = !!s.calm;
    if (Number.isFinite(s.day)) this.day = s.day | 0;
    // Sleep: the piece goes on at 15 %; waking, a short dawn figure
    const sleep = s.mood === 'sleep';
    if (sleep !== this.sleeping) {
      this.sleeping = sleep;
      this.main.gain.setTargetAtTime(MUSIC_LEVEL * (sleep ? SLEEP_LEVEL : 1), now, sleep ? 1.2 : 0.8);
      if (!sleep && this.started) this.stinger('dawn', now + 0.4);
    }
    // The band and the score's duck under it (and under the wedding tune)
    const band = Math.max(0, Math.min(1, Number.isFinite(s.band) ? s.band : 0));
    this.bandLevel = band;
    const pieceOn = !!this.piece;
    this.band.set(band, s.venue?.score ?? null, s.patrons, s.claps, now, pieceOn ? WEDDING_DUCK : 1);
    const duck = SCORE_LEVEL * (1 - band) * (pieceOn ? WEDDING_DUCK : 1);
    if (Math.abs(duck - this.duckTarget) > 1e-3) { this.duck.gain.setTargetAtTime(duck, now, 0.4); this.duckTarget = duck; }
    // The score to play: sleep keeps what plays; inside the tavern (band at 1) the score is ducked away, out of hours it
    // is the quiet indoor one
    let id = s.mood;
    if (id === 'sleep') id = this.pendingSwap?.id ?? this.track?.id ?? 'home';
    else if (id === 'tavern') id = band >= 0.99 ? (this.pendingSwap?.id ?? this.track?.id ?? 'home') : 'home';
    if (!SCORES[id] || id === 'tavern') id = 'day';
    if (OUTDOOR.includes(id)) this.outdoorRoot = SCORES[id].root;
    const target = this.pendingSwap?.id ?? this.track?.id;
    if (id !== target) {
      if (this.track?.id === id) this.pendingSwap = null;
      else this.pendingSwap = { id, score: resolveScore(id, this.outdoorRoot) };
    }
    // Intensity (calm mode: never ride or danger), with the danger stinger on the next beat
    let I = Math.max(0, Math.min(3, (s.intensity ?? 1) | 0));
    if (this.calm) I = Math.min(I, 1);
    I = clampFor(id, I);
    const prevI = this.want.intensity;
    if (I === 3 && prevI !== 3 && this.track && this.started) this.stinger('danger', this.nextBeat(now));
    this.want = { intensity: I, stalk: !!s.stalk, lowAir: !!s.lowAir };
    // A rest ends on a mood change or a change of intensity (settling into idle does not count)
    const tr = this.track;
    if (tr?.resting && (id !== tr.id || (I !== prevI && I > 0) || s.stalk || band > 0.001)) tr.restUntil = 0;
    this.started = true;
  }
  // The next beat of the playing grid (the danger stinger lands there)
  nextBeat(now) {
    const tr = this.track;
    if (!tr || tr.resting) return now + 0.05;
    const b = unitS(tr.score) * beatUnits(tr.score), k = Math.ceil((now + 0.03 - tr.barT) / b);
    return Math.max(now + 0.03, tr.barT + k * b);
  }
  // A stinger: not in calm mode (the dawn figure is not one), none again within STINGER_GAP s, one at a time (a second
  // one waits up to 3 s for the first to end, else it is dropped). Returns whether it plays
  stinger(id, at) {
    if (this.calm && id !== 'dawn') return false;
    if (at - (this.lastStinger[id] ?? -Infinity) < STINGER_GAP) return false;
    if (at < this.stingerEnd) { if (this.stingerEnd - at > 3) return false; at = this.stingerEnd; }
    const score = this.track?.base || resolveScore('day');
    for (const n of stingerNotes(id, score)) this.voices.play(n.voice, at + n.at, n.midi, n.len, n.vel, this.stingerBus, 'stinger');
    this.lastStinger[id] = at; this.stingerEnd = at + stingerLength(id); this.lastCue = id;
    return true;
  }
  // A one-shot event (Music.cue): arrive and found are stingers; game adds tension to the band for 8 bars (only while it
  // is heard); wedding plays its tune over everything (one at a time)
  cue(id, now) {
    if (!CUES.includes(id)) return false;
    this.lastCue = id;
    if (id === 'arrive' || id === 'found') return this.stinger(id, now + 0.05);
    if (id === 'game') {
      if (this.bandLevel <= 0.001 || this.calm) return false;
      this.band.gameUntil = Math.max(this.band.nextT, now) + 8 * barS(this.band.score || SCORES.tavern);
      return true;
    }
    if (id === 'wedding') {
      if (this.piece) return false;
      this.piece = new Piece(this, WEDDING, now + 0.1, WEDDING.progression.length);
      const duck = SCORE_LEVEL * (1 - this.bandLevel) * WEDDING_DUCK;
      this.duck.gain.setTargetAtTime(duck, now, 0.3); this.duckTarget = duck;
      return true;
    }
    return false;
  }
  // Starts the pending score at T: the old one fades over two of its bars (at most FADE_MAX s), keeping only pad and
  // bass, while the new one fades in over two of its own
  swapAt(T) {
    const sw = this.pendingSwap;
    this.pendingSwap = null;
    if (!sw?.score) return;
    const old = this.track;
    for (const f of this.fading) if (!f.dead) { f.fadeOut(T, 0.3); }
    if (old) { old.fadeOut(T, old.resting ? 0.3 : Math.min(2 * barS(old.score), FADE_MAX)); this.fading.push(old); }
    const tr = this.track = new Track(this, sw.id, sw.score, T);
    tr.fadeTo(1, T, old && !old.resting ? Math.min(2 * barS(sw.score), FADE_MAX) : 0.6);
    this.room.send(sw.score.send, T);
  }
  // Schedules everything up to ctx time until (now: the clock, for the resync)
  pump(until, now) {
    if (!this.enabled) return;
    this.voices.now = now;
    if (!this.track && this.pendingSwap) this.swapAt(now + 0.08);
    if (this.track && this.track.nextT < now - RESYNC) this.track.resync(now);
    let guard = 0;
    this.track?.drain(until);
    while (this.track && this.track.nextT < until && guard++ < 64) {
      // (the chunk's last notes, then a swap on the active track's boundary, and the new track schedules from there)
      this.track.drain(Infinity);
      if (this.pendingSwap) this.swapAt(this.track.nextT);
      this.track.stepOnce();
      this.track.drain(until);
    }
    for (const f of this.fading) {
      if (f.nextT < now - RESYNC) { f.dead = true; continue; }
      f.drain(until);
      let g = 0;
      while (!f.dead && f.nextT < until && g++ < 16) { f.drain(Infinity); f.stepOnce(); f.drain(until); }
    }
    if (this.fading.length) {
      for (const f of this.fading) if (f.dead && !this.offline) { const tail = f; setTimeout(() => tail.disconnect(), 3000); }
      this.fading = this.fading.filter(f => !f.dead);
    }
    this.band.pump(until, now);
    if (this.piece && !this.piece.pump(until, now) && now > this.piece.end) {
      this.piece = null;
      const duck = SCORE_LEVEL * (1 - this.bandLevel);
      this.duck.gain.setTargetAtTime(duck, now, 1); this.duckTarget = duck;
    }
  }
  debug() {
    const tr = this.track;
    return { mood: tr?.id ?? null, intensity: tr?.intensity ?? null, variant: tr ? variantOf(tr.intensity ?? 1) : null, stalk: !!tr?.stalk, resting: !!tr?.resting, band: this.bandLevel, live: this.voices.live, notes: this.voices.notes, dropped: this.voices.dropped, cue: this.lastCue, bufferKB: Math.round(cacheBytes() / 1024), ready: [...this.voices.buffers.keys()].length };
  }
}

const idleSlice = fn => (typeof requestIdleCallback === 'function' ? requestIdleCallback(fn, { timeout: 2000 }) : setTimeout(fn, 40));

export const DynamicMusic = {
  enabled: true,
  calm: false,              // (Settings musicMode 'calm': moods change, but no ride, tense or stingers; settings.js sets
  mode: 'dynamic',          // it, as calm = true or as mode = 'calm')
  get isCalm() { return this.calm === true || this.mode === 'calm'; },
  venues: [],               // (places with their own music: Music.venue)
  state: null,              // (the last musicState)
  conductor: null,
  timer: null,
  lastCue: null,
  found: null,              // (how many places were known at the last update: a new one plays the found stinger)
  foundOf: null,            // (and in which set: game.places.found, replaced when a world loads)
  get mood() { return this.state?.mood ?? null; },

  // A one-shot event: id one of musicscore.js CUES ('arrive', 'found', 'game', 'wedding'); unknown ids are ignored, so
  // batches can land in any order. opts reserved ({}). Lasting states (gallop, chase, stalking) are read as flags instead
  cue(id, opts = {}) {
    if (!CUES.includes(id)) return;
    this.lastCue = id;
    const ac = Audio.ctx;
    if (!ac || !this.conductor || !this.enabled) return;
    try { this.conductor.cue(id, ac.currentTime, opts); } catch (e) { reportFault(e, 'Music.cue'); }
  },
  // A place with its own music (Plans H and I): { x, y, rect: { x0, y0, x1, y1 } (tiles, inside = full), hours: [from,
  // to] (village hours; to may pass 24), score: a musicscore.js SCORES id }. Returns a function that removes it
  venue(spec) {
    if (!spec || !Number.isFinite(spec.x) || !Number.isFinite(spec.y)) return () => {};
    this.venues.push(spec);
    return () => { const i = this.venues.indexOf(spec); if (i >= 0) this.venues.splice(i, 1); };
  },
  // Offline render for the review WAVs (§11): schedules every note of script ([{ at (s), mood, intensity, cue?, stalk?,
  // band?, venue?, lowAir?, patrons?, claps?, calm?, day? }, …], sorted by at) up front on ctx (any BaseAudioContext,
  // usually an OfflineAudioContext) into ctx.destination, without setInterval; notes after the context's length are
  // skipped. Returns how many notes it scheduled (then the caller runs ctx.startRendering())
  render(ctx, script) {
    const out = ctx.createGain();
    out.gain.value = Audio.volumes?.music ?? 0.5;
    out.connect(ctx.destination);
    const c = new Conductor(ctx, out, { offline: true });
    c.voices.prerender(null);
    const end = Number.isFinite(ctx.length) ? ctx.length / ctx.sampleRate : Math.max(0, ...(script || []).map(e => e.at)) + 30;
    const list = [...(script || [])].filter(e => e && Number.isFinite(e.at)).sort((a, b) => a.at - b.at);
    let i = 0, last = null;
    for (let t = 0; t < end; t += 0.1) {
      while (i < list.length && list[i].at <= t + 1e-6) {
        const e = list[i++];
        last = { ...(last || {}), ...e };
        if (e.mood || e.intensity !== undefined || e.band !== undefined || e.stalk !== undefined || e.lowAir !== undefined) c.apply(last, e.at);
        if (e.cue) c.cue(e.cue, e.at);
      }
      c.pump(Math.min(end, t + LOOK), t);
    }
    return c.notes;
  },

  update(game) {
    const ac = Audio.ctx;
    if (!ac) return;
    if (!this.enabled) { if (this.conductor) this.conductor.enabled = false; return; }
    if (!this.conductor) this.start(ac);
    const c = this.conductor;
    c.enabled = true;
    this.state = musicState(game, this.state, { now: performance.now(), venues: this.venues, calm: this.isCalm });
    c.apply(this.extras(game, this.state), ac.currentTime);
    // (a place found since the last update: the found stinger. The set is replaced when a world loads, so the first look
    // at a new one, or fewer places, only re-counts)
    const set = game.places?.found, n = set?.size;
    if (Number.isFinite(n)) {
      if (this.foundOf === set && this.found !== null && n > this.found && game.mode !== 'menu') c.cue('found', ac.currentTime);
      this.found = n; this.foundOf = set;
    }
  },
  // What the conductor needs beyond musicState: low air under water (Plan D), the claps (village clock after 20:00), the
  // day for the seeds and calm mode. The seated patrons come from musicState (s.patrons); counted here only if it has none
  extras(game, s) {
    const p = game.player, n = game.needs;
    const lowAir = !!(p?.headUnder && n && Number.isFinite(n.air) && n.airMax > 0 && n.air / n.airMax <= 0.3);
    let patrons = 0, claps = false;
    if (s.band > 0.001) {
      const h = Number.isFinite(s.hour) ? s.hour : game.days?.hour ?? 12;
      claps = h >= 20 || h < 2;
      if (Number.isFinite(s.patrons)) patrons = s.patrons;
      else if (!s.venue || s.venue.tavern) for (const nb of game.neighbors?.people || []) if (!nb.hidden && (nb.def?.sits || nb.pose) && inTavern(nb.x, nb.y)) patrons++;
    }
    return { ...s, lowAir, patrons: Math.max(0, Math.min(4, patrons | 0)), claps, day: game.days?.realDay ?? 0, calm: this.isCalm };
  },
  start(ac) {
    const c = this.conductor = new Conductor(ac, Audio.musicBus);
    c.voices.prerender(idleSlice);
    if (!this.timer) this.timer = setInterval(() => this.tick(), 90);
  },
  // The look-ahead scheduler (90 ms, as before): notes of the next instants, so the game's hitches never reach the music
  tick() {
    const ac = Audio.ctx, c = this.conductor;
    if (!ac || !c || !this.enabled) return;
    try {
      const hidden = typeof document !== 'undefined' && document.hidden;
      c.pump(ac.currentTime + (hidden ? LOOK_HIDDEN : LOOK), ac.currentTime);
    } catch (e) { reportFault(e, 'Music.tick'); }
  },
  // F3 (?musica=ver): mood, intensity, live voices and the last cue
  debugLine() {
    const d = this.conductor?.debug();
    if (!d) return 'music: not started';
    return `music: ${d.mood ?? '-'} · ${d.variant}${d.stalk ? ' (stalking)' : ''} ${d.intensity ?? '-'}${d.resting ? ' · resting' : ''}${d.band > 0 ? ` · band ${d.band.toFixed(2)}` : ''} · ${d.live} voices (${d.notes} notes, ${d.dropped} dropped) · voices ready ${d.ready}/10, ${d.bufferKB} KB · last cue ${d.cue ?? '-'}`;
  },
};

export const MUSIC_DEBUG = opcion('musica') === 'ver';
export const Music = apagada('musica') ? LegacyMusic : DynamicMusic;

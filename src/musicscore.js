// The scores of the dynamic music (Plan J §3.3-3.4): per mood a tempo, a key and mode, the voices of its layers and its
// hand-written ORIGINAL motifs (written for this game: nothing transcribed or imitated from any game or tune), varied by
// a seed. Data and pure helpers only (no Web Audio), so offline renders and tests use them as they are.
//
// A score: { bpm, root (MIDI note of the tonic), mode (a key of SCALES), meter (4: four beats a bar; 6: a 6/8 bar of six
// eighths, the tavern), voices { pad, bass, pluck, lead, drum } (ids of musicvoices.js VOICES, or null), send (share
// into the shared room, §3.5), progression [scale degree of the chord root, per bar; 16 bars, or 8 for a short piece],
// motifs [A, B, C] (each [{ at (units from the bar start, over 2 bars), deg (scale degree, may be < 0 or ≥ 7), len
// (units), vel 0..1 }, …]; A the theme, B the contrast, C the cadence), and the layer patterns (pluck, bass, drum) }.
// Root null (deep): the outdoor key a fifth down (resolveScore). Units: a beat (quarter) in 4, an eighth in 6/8 (bpm
// then counts dotted quarters, two a bar). Extra fields: leadOct (the lead's octave over the root), pluckOct, padTones
// (chord degrees of the pad voicing), padCenter (MIDI the pad voicing gathers around), tone (a lowpass on the mood's
// bus, Hz), vol (the score's level).
//
// The form: 16 bars are 8 slots of a 2-bar motif, FORM: A A A C | B B A C, so at 4 bars it is A A′ B A (theme, theme
// with its cadence, contrast, theme with its cadence). The seed (ihash(realDay, mood, cycle)) only varies the repeats
// (passing notes, octave, rhythm displacement, inversion in the contrast), and strong beats are snapped back to chord
// tones afterwards, so a mood keeps a recognisable tune all day and fresh detail the next.

import { ihash } from './util.js';

export const SCALES = {
  ionian: [0, 2, 4, 5, 7, 9, 11], dorian: [0, 2, 3, 5, 7, 9, 10], phrygian: [0, 1, 3, 5, 7, 8, 10], lydian: [0, 2, 4, 6, 7, 9, 11],
  mixolydian: [0, 2, 4, 5, 7, 9, 10], aeolian: [0, 2, 3, 5, 7, 8, 10], phrygianDominant: [0, 1, 4, 5, 7, 8, 10],
};
const MINOR = new Set(['aeolian', 'phrygian', 'phrygianDominant']);

// The layers of a score and their gain at intensity 0 idle / 1 moving / 2 ride / 3 danger (§3.3)
export const LAYERS = ['pad', 'bass', 'pluck', 'lead', 'ride', 'tense'];
export const LAYER_GAIN = {
  pad: [1, 1, 1, 0.6], bass: [0, 1, 1, 0], pluck: [0.3, 1, 0.6, 0], lead: [0.5, 1, 1, 0], ride: [0, 0, 1, 0], tense: [0, 0, 0, 1],
};
// Plan G stalking (crouched with the bow near an animal): "hold your breath", only the pad and a soft low pulse
export const STALK_GAIN = { pad: 0.8, bass: 0.35, pluck: 0, lead: 0, ride: 0, tense: 0 };
// Tempo lift of the variants, at a bar line
export const RIDE_TEMPO = 1.12, TENSE_TEMPO = 1.08;
// One-shot stingers (one at a time, none again within STINGER_GAP s) and the ids Music.cue accepts (unknown ids ignored)
export const STINGERS = ['danger', 'relief', 'arrive', 'found'];
export const CUES = ['arrive', 'found', 'game', 'wedding'];
export const STINGER_GAP = 20;
// Rests (Decision 2): a calm outdoor piece plays REST_CYCLES cycles, then REST_S seconds of silence (birds, wind, rain)
export const REST_CYCLES = [2, 4], REST_S = [60, 150];
export const FORM = ['A', 'A', 'A', 'C', 'B', 'B', 'A', 'C'];
export const FORM_SHORT = ['A', 'A', 'B', 'C'];   // (an 8-bar piece: the wedding)
// Outdoor moods (all four intensities, rests); cave and temple know only moving and danger; the rest stay at moving
export const OUTDOOR = ['day', 'dusk', 'night', 'rain', 'winter'];
export const TWO_LEVELS = ['cave', 'temple'];

// [at, deg, len, vel?] → { at, deg, len, vel }
const mo = list => list.map(([at, deg, len, vel = 0.8]) => ({ at, deg, len, vel }));
// [at, idx (chord tone: 0 root, 1 third, 2 fifth, 3 root + 8ve, 4 third + 8ve, 5 fifth + 8ve), len, vel]
const pat = list => list.map(([at, idx, len, vel = 0.7]) => ({ at, idx, len, vel }));
// [at, midi (drum tuning: 60 as rendered), vel]
const drums = list => list.map(([at, midi, vel]) => ({ at, midi, vel }));

const S = (bpm, root, mode, voices, send, extra = {}) => ({ bpm, root, mode, meter: 4, voices, send, progression: [], motifs: [], leadOct: 1, pluckOct: 0, padTones: [0, 2, 4], padCenter: 60, vol: 1, pluck: [], bass: [], drum: [], ...extra });

// Day: D Mixolydian, a flute over plucked strings; warm open fifths in the pad
const DAY = {
  progression: [0, 6, 0, 6, 0, 6, 3, 0, 3, 0, 3, 6, 0, 6, 3, 0],
  motifs: [
    mo([[0, 4, 1.5], [1.5, 5, 0.5, 0.6], [2, 4, 1], [3, 2, 1, 0.7], [4, 3, 1.5], [5.5, 1, 0.5, 0.6], [6, -1, 2, 0.75]]),
    mo([[0, 7, 1], [1, 8, 0.5, 0.65], [1.5, 7, 0.5, 0.6], [2, 5, 2], [4, 4, 1], [5, 6, 0.5, 0.6], [5.5, 5, 0.5, 0.6], [6, 4, 1.5, 0.75]]),
    mo([[0, 5, 1], [1, 4, 0.5, 0.6], [1.5, 3, 0.5, 0.6], [2, 5, 1], [3, 7, 1, 0.75], [4, 4, 1], [5, 2, 1, 0.7], [6, 0, 2, 0.8]]),
  ],
  pluck: pat([[0, 0, 0.5, 0.85], [0.5, 2, 0.5, 0.5], [1, 3, 0.5, 0.65], [1.5, 2, 0.5, 0.45], [2, 1, 0.5, 0.75], [2.5, 2, 0.5, 0.5], [3, 3, 0.5, 0.65], [3.5, 4, 0.5, 0.45]]),
  bass: pat([[0, 0, 1.5, 0.9], [1.5, 0, 0.5, 0.55], [2, 2, 1.5, 0.8], [3.5, 0, 0.5, 0.5]]),
  drum: drums([[0, 60, 0.5], [1.5, 64, 0.18], [2, 60, 0.32], [3, 64, 0.22], [3.5, 64, 0.14]]),
  padTones: [0, 4, 9],
};
// Dusk (and the menu): A Dorian, a bowed line; the bright sixth of the mode on the IV chord
const DUSK = {
  progression: [0, 3, 0, 3, 0, 3, 6, 0, 2, 3, 2, 6, 0, 3, 6, 0],
  motifs: [
    mo([[0, 0, 1], [1, 2, 0.5, 0.65], [1.5, 4, 1.5], [3, 3, 0.5, 0.6], [3.5, 2, 0.5, 0.6], [4, 1, 1, 0.7], [5, 3, 1], [6, 5, 2, 0.8]]),
    mo([[0, 6, 1.5], [1.5, 7, 0.5, 0.65], [2, 6, 0.5, 0.6], [2.5, 4, 0.5, 0.6], [3, 2, 1, 0.7], [4, 3, 0.5, 0.7], [4.5, 5, 0.5, 0.65], [5, 7, 1], [6, 5, 1, 0.7], [7, 3, 1, 0.65]]),
    mo([[0, 1, 1], [1, 3, 1, 0.7], [2, 6, 1.5], [3.5, 5, 0.5, 0.6], [4, 4, 1], [5, 2, 1, 0.7], [6, 0, 2, 0.8]]),
  ],
  pluck: pat([[0, 0, 0.75, 0.8], [1, 2, 0.5, 0.55], [1.5, 3, 0.5, 0.55], [2, 1, 0.75, 0.7], [3, 2, 0.5, 0.5], [3.5, 3, 0.5, 0.45]]),
  bass: pat([[0, 0, 2, 0.85], [2, 2, 2, 0.7]]),
};
// Night: E Aeolian, a bell with long rests inside the phrases; no drum
const NIGHT = {
  progression: [0, 5, 0, 5, 0, 5, 3, 0, 5, 6, 3, 6, 0, 5, 3, 0],
  motifs: [
    mo([[0, 4, 2, 0.7], [3, 2, 1, 0.55], [4, 0, 1.5, 0.65], [6, 2, 1, 0.5]]),
    mo([[0, 7, 1.5, 0.7], [2, 5, 1, 0.55], [4, 6, 2, 0.65], [6, 3, 1.5, 0.5]]),
    mo([[0, 5, 1, 0.6], [1, 3, 2, 0.55], [4, 2, 1, 0.6], [5, 1, 1, 0.45], [6, 0, 2, 0.65]]),
  ],
  bass: pat([[0, 0, 4, 0.7]]),
  padCenter: 57,
};
// Rain: D Aeolian, pad and a slow pluck with long notes; no lead
const RAIN = {
  progression: [0, 5, 2, 6, 0, 5, 3, 4, 5, 3, 0, 6, 0, 5, 4, 0],
  pluck: pat([[0, 0, 1.5, 0.75], [1, 2, 1, 0.5], [2, 4, 1.5, 0.55], [3, 3, 1, 0.45]]),
  bass: pat([[0, 0, 3, 0.7], [3, 2, 1, 0.5]]),
  padCenter: 57,
};
// Winter: G Lydian, bells for the pluck and a flute; the raised fourth on the II chord
const WINTER = {
  progression: [0, 1, 0, 1, 0, 1, 4, 0, 5, 1, 5, 4, 0, 1, 4, 0],
  motifs: [
    mo([[0, 2, 1, 0.7], [1, 4, 1, 0.7], [2, 7, 2, 0.8], [4, 8, 1, 0.75], [5, 5, 1, 0.65], [6, 3, 2, 0.7]]),
    mo([[0, 9, 1.5, 0.75], [1.5, 8, 0.5, 0.6], [2, 7, 1, 0.7], [3, 5, 1, 0.6], [4, 5, 1.5, 0.7], [5.5, 6, 0.5, 0.55], [6, 8, 2, 0.75]]),
    mo([[0, 6, 1, 0.7], [1, 4, 1, 0.6], [2, 8, 1, 0.7], [3, 6, 1, 0.6], [4, 7, 3, 0.8]]),
  ],
  pluck: pat([[0, 3, 1, 0.6], [1.5, 2, 1, 0.45], [2, 4, 1, 0.5], [3, 1, 1, 0.4]]),
  bass: pat([[0, 0, 2, 0.7], [2, 2, 2, 0.6]]),
  pluckOct: 1,
};
// Cave: A Aeolian, a low drone (root and fifth) and a rare bell drip high up
const CAVE = {
  progression: [0, 0, 5, 0, 0, 0, 3, 0, 5, 5, 0, 0, 3, 5, 0, 0],
  motifs: [mo([[1, 7, 0.5, 0.5], [6.5, 4, 0.5, 0.4]]), mo([[2, 9, 0.5, 0.45], [3, 7, 0.5, 0.35]]), mo([[5, 2, 1, 0.4]])],
  bass: pat([[0, 0, 4, 0.6]]),
  padTones: [0, 4], padCenter: 50, leadOct: 2,
};
// Temple: E Phrygian dominant, a bowed line over a low drum; I–♭II
const TEMPLE = {
  progression: [0, 1, 0, 1, 0, 1, 6, 0, 3, 0, 3, 1, 0, 1, 6, 0],
  motifs: [
    mo([[0, 0, 0.5, 0.7], [0.5, 1, 0.5, 0.6], [1, 2, 1, 0.75], [2, 3, 0.5, 0.6], [2.5, 2, 0.5, 0.55], [3, 1, 1, 0.65], [4, 1, 1.5, 0.7], [5.5, 0, 0.5, 0.55], [6, -1, 2, 0.7]]),
    mo([[0, 5, 1, 0.7], [1, 4, 0.5, 0.6], [1.5, 5, 0.5, 0.6], [2, 7, 2, 0.8], [4, 4, 1, 0.7], [5, 2, 1, 0.6], [6, 1, 1, 0.6], [7, 2, 1, 0.55]]),
    mo([[0, 3, 1, 0.7], [1, 1, 1, 0.6], [2, -1, 1, 0.6], [3, 1, 1, 0.55], [4, 0, 4, 0.75]]),
  ],
  bass: pat([[0, 0, 1, 0.8], [1.5, 0, 0.5, 0.5], [2, 2, 2, 0.7]]),
  drum: drums([[0, 52, 0.6], [1.5, 52, 0.3], [2, 57, 0.4], [3, 57, 0.25], [3.5, 52, 0.2]]),
};
// Home: C Ionian, a quiet pluck and pad; no lead, no drum
const HOME = {
  progression: [0, 3, 4, 0, 5, 3, 4, 0, 0, 5, 3, 4, 0, 3, 4, 0],
  pluck: pat([[0, 0, 0.5, 0.7], [0.5, 2, 0.5, 0.45], [1, 1, 0.5, 0.5], [2, 0, 0.5, 0.6], [2.5, 2, 0.5, 0.42], [3, 3, 1, 0.48]]),
  bass: pat([[0, 0, 2, 0.6], [2, 2, 2, 0.5]]),
};
// Deep: the outdoor key a fifth down, Aeolian; a muffled pad, a sparse bell and a sub pulse
const DEEP = {
  progression: [0, 0, 5, 0, 0, 0, 3, 0, 5, 5, 0, 0, 3, 3, 0, 0],
  motifs: [mo([[0, 4, 2, 0.5], [4.5, 7, 1.5, 0.45]]), mo([[1, 9, 2, 0.45], [5, 7, 2, 0.4]]), mo([[2, 2, 2, 0.45], [6, 0, 2, 0.45]])],
  bass: pat([[0, 0, 1.2, 0.6], [2, 0, 1.2, 0.45]]),
  padCenter: 55, tone: 900, leadOct: 1,
};

export const SCORES = {
  day: S(96, 62, 'mixolydian', { pad: 'pad', bass: 'bass', pluck: 'pluck', lead: 'flute', drum: 'frame' }, 0.25, DAY),
  dusk: S(84, 57, 'dorian', { pad: 'pad', bass: 'bass', pluck: 'pluck', lead: 'bowed', drum: null }, 0.25, DUSK),
  night: S(64, 52, 'aeolian', { pad: 'pad', bass: 'bass', pluck: null, lead: 'bell', drum: null }, 0.25, NIGHT),
  rain: S(72, 50, 'aeolian', { pad: 'pad', bass: 'bass', pluck: 'pluck', lead: null, drum: null }, 0.25, RAIN),
  winter: S(78, 55, 'lydian', { pad: 'pad', bass: 'bass', pluck: 'bell', lead: 'flute', drum: null }, 0.25, WINTER),
  cave: S(56, 45, 'aeolian', { pad: 'pad', bass: 'bass', pluck: null, lead: 'bell', drum: null }, 0.5, CAVE),
  temple: S(70, 52, 'phrygianDominant', { pad: 'pad', bass: 'bass', pluck: null, lead: 'bowed', drum: 'frame' }, 0.3, TEMPLE),
  home: S(80, 60, 'ionian', { pad: 'pad', bass: 'bass', pluck: 'pluck', lead: null, drum: null }, 0.15, { ...HOME, vol: 0.85 }),
  deep: S(48, null, 'aeolian', { pad: 'pad', bass: 'bass', pluck: null, lead: 'bell', drum: null }, 0.4, DEEP),
  menu: S(84, 57, 'dorian', { pad: 'pad', bass: 'bass', pluck: 'pluck', lead: 'bowed', drum: null }, 0.25, DUSK),
  // (the band: a 6/8 dance; one of TAVERN_TUNES by seed; claps after 20:00; one more voice per seated patron, up to 4)
  tavern: S(116, 55, 'mixolydian', { pad: null, bass: 'bass', pluck: 'pluck', lead: 'bowed', drum: 'frame' }, 0.15, {
    meter: 6, leadOct: 1,
    pluck: pat([[1, 1, 1, 0.5], [1, 2, 1, 0.4], [2, 2, 1, 0.35], [4, 1, 1, 0.5], [4, 2, 1, 0.4], [5, 2, 1, 0.35]]),
    bass: pat([[0, 0, 2, 0.85], [3, 2, 2, 0.7]]),
    drum: drums([[0, 60, 0.6], [2, 64, 0.25], [3, 60, 0.45], [5, 64, 0.3]]),
  }),
};
// Three original dance tunes for the band (6/8; units are eighths, a 2-bar motif spans 12)
export const TAVERN_TUNES = [
  { root: 55, mode: 'mixolydian', progression: [0, 6, 0, 6, 0, 6, 3, 0, 3, 0, 3, 6, 0, 6, 3, 0], motifs: [
    mo([[0, 4, 2, 0.85], [2, 2, 1, 0.6], [3, 0, 1, 0.75], [4, 2, 1, 0.6], [5, 4, 1, 0.65], [6, 3, 1, 0.8], [7, 1, 1, 0.6], [8, 3, 1, 0.6], [9, 6, 2, 0.75], [11, 5, 1, 0.6]]),
    mo([[0, 7, 1, 0.85], [1, 5, 1, 0.6], [2, 7, 1, 0.65], [3, 8, 2, 0.8], [5, 7, 1, 0.6], [6, 4, 1, 0.8], [7, 5, 1, 0.6], [8, 4, 1, 0.6], [9, 2, 3, 0.75]]),
    mo([[0, 5, 1, 0.8], [1, 4, 1, 0.6], [2, 3, 1, 0.6], [3, 2, 1, 0.75], [4, 3, 1, 0.6], [5, 5, 1, 0.6], [6, 4, 2, 0.8], [8, 2, 1, 0.6], [9, 0, 3, 0.8]]),
  ] },
  { root: 62, mode: 'dorian', leadOct: 0, progression: [0, 3, 0, 3, 0, 3, 6, 0, 2, 3, 2, 6, 0, 3, 6, 0], motifs: [
    mo([[0, 0, 1, 0.85], [1, 2, 1, 0.6], [2, 4, 1, 0.65], [3, 7, 2, 0.8], [5, 4, 1, 0.6], [6, 5, 1, 0.8], [7, 3, 1, 0.6], [8, 5, 1, 0.6], [9, 7, 1, 0.75], [10, 5, 1, 0.6], [11, 3, 1, 0.55]]),
    mo([[0, 6, 2, 0.85], [2, 4, 1, 0.6], [3, 2, 1, 0.75], [4, 4, 1, 0.6], [5, 6, 1, 0.6], [6, 7, 2, 0.8], [8, 5, 1, 0.6], [9, 3, 3, 0.75]]),
    mo([[0, 8, 1, 0.8], [1, 6, 1, 0.6], [2, 5, 1, 0.6], [3, 3, 2, 0.75], [5, 1, 1, 0.6], [6, 2, 1, 0.8], [7, 1, 1, 0.6], [8, 2, 1, 0.6], [9, 0, 3, 0.8]]),
  ] },
  { root: 57, mode: 'mixolydian', progression: [0, 3, 0, 6, 0, 3, 6, 0, 3, 3, 0, 6, 0, 3, 6, 0], motifs: [
    mo([[0, 2, 1, 0.85], [1, 4, 1, 0.6], [2, 2, 1, 0.6], [3, 0, 2, 0.8], [5, 2, 1, 0.6], [6, 3, 1, 0.8], [7, 5, 1, 0.6], [8, 7, 1, 0.65], [9, 5, 2, 0.75], [11, 3, 1, 0.55]]),
    mo([[0, 7, 3, 0.85], [3, 8, 1, 0.7], [4, 7, 1, 0.6], [5, 5, 1, 0.6], [6, 4, 2, 0.8], [8, 2, 1, 0.6], [9, 4, 3, 0.75]]),
    mo([[0, 6, 1, 0.8], [1, 5, 1, 0.6], [2, 6, 1, 0.6], [3, 3, 1, 0.75], [4, 1, 1, 0.6], [5, -1, 1, 0.6], [6, 0, 2, 0.8], [8, 2, 1, 0.6], [9, 0, 3, 0.8]]),
  ] },
];
// The wedding tune (Plan I, Music.cue('wedding')): an 8-bar festive 6/8 piece in G Ionian over the band
export const WEDDING = S(104, 55, 'ionian', { pad: 'pad', bass: 'bass', pluck: 'pluck', lead: 'bowed', drum: 'frame' }, 0.2, {
  meter: 6, progression: [0, 4, 0, 4, 3, 0, 4, 0], vol: 1,
  motifs: [
    mo([[0, 0, 1, 0.8], [1, 2, 1, 0.65], [2, 4, 1, 0.7], [3, 7, 3, 0.85], [6, 6, 1, 0.75], [7, 4, 1, 0.6], [8, 6, 1, 0.65], [9, 8, 3, 0.8]]),
    mo([[0, 9, 2, 0.85], [2, 7, 1, 0.65], [3, 5, 2, 0.75], [5, 3, 1, 0.6], [6, 4, 2, 0.8], [8, 2, 1, 0.6], [9, 4, 3, 0.75]]),
    mo([[0, 6, 1, 0.8], [1, 8, 1, 0.7], [2, 6, 1, 0.65], [3, 4, 1, 0.7], [4, 6, 1, 0.65], [5, 8, 1, 0.7], [6, 7, 6, 0.9]]),
  ],
  pluck: SCORES.tavern.pluck, bass: SCORES.tavern.bass, drum: SCORES.tavern.drum,
});

// The MIDI note of a scale degree (any integer: 7 is the tonic an octave up, −1 the seventh below) in a score
export function noteOf(score, deg, octave = 0) {
  const sc = SCALES[score.mode] || SCALES.ionian, n = sc.length, o = Math.floor(deg / n);
  return (score.root ?? 60) + sc[deg - o * n] + 12 * (o + octave);
}
// The ride variant: same key and bar, tempo × RIDE_TEMPO
export const rideOf = score => ({ ...score, bpm: score.bpm * RIDE_TEMPO, variant: 'ride' });
// The tense variant keeps the ROOT: the parallel minor of a major or modal score; a score already minor adds the flat
// second (aeolian → phrygian) and drops an octave. Tempo × TENSE_TEMPO
export function tenseOf(score) {
  const minor = MINOR.has(score.mode);
  return { ...score, bpm: score.bpm * TENSE_TEMPO, mode: minor ? (score.mode === 'aeolian' ? 'phrygian' : score.mode) : 'aeolian', root: score.root === null ? null : score.root - (minor ? 12 : 0), variant: 'tense', baseRoot: score.root };
}
// A score ready to play: deep's root from the outdoor key (a fifth down), a tavern tune folded into the band's score
export function resolveScore(id, outdoorRoot = 62, tune = null) {
  const s = SCORES[id];
  if (!s) return null;
  if (s.root === null) { let r = outdoorRoot - 7; while (r > 57) r -= 12; while (r < 45) r += 12; return { ...s, id, root: r }; }
  if (id === 'tavern') { const t = TAVERN_TUNES[(tune ?? 0) % TAVERN_TUNES.length]; return { ...s, id, ...t }; }
  return { ...s, id };
}
// Seconds per unit (a beat in 4, an eighth in 6/8 where bpm counts dotted quarters), per bar and per beat
export const unitS = score => (score.meter === 6 ? 20 : 60) / score.bpm;
export const barS = score => unitS(score) * score.meter;
export const beatUnits = score => (score.meter === 6 ? 3 : 1);
// The chord of a bar: its root degree and three tones (root, third, fifth as scale degrees)
export const chordOf = (score, bar) => { const p = score.progression; return p?.length ? p[((bar % p.length) + p.length) % p.length] : 0; };
// The highest lead note (the flute's and bell's top buffer plus a fourth): variations and doublings stay under it
export const LEAD_MAX = 89;
const inChord = (deg, r) => { const d = (((deg - r) % 7) + 7) % 7; return d === 0 || d === 2 || d === 4; };

// The lead's notes for one bar: [{ at, deg, midi, len, vel }] from the score's motifs (FORM over 16 bars), varied by seed
// (ihash(realDay, mood, cycle): passing notes, octave, rhythm displacement, inversion). Statements are never varied
export function phrase(score, bar, seed) {
  const motifs = score.motifs;
  if (!motifs?.length) return [];
  const form = (score.progression?.length || 16) <= 8 ? FORM_SHORT : FORM;
  const b = ((bar % (form.length * 2)) + form.length * 2) % (form.length * 2), slot = b >> 1, half = b & 1;
  const letter = form[slot], m = motifs[letter === 'A' ? 0 : letter === 'B' ? 1 % motifs.length : 2 % motifs.length];
  const span = score.meter, strong = score.meter === 6 ? 3 : 2;
  // (which repeat this is: the first A and the first B are statements; the others may vary)
  const first = form.indexOf(letter) === slot;
  const r = k => ihash(seed | 0, slot * 31 + k, 977);
  let notes = m.map(n => ({ at: n.at, deg: n.deg, len: n.len, vel: n.vel }));
  if (!first) {
    if (letter === 'B' && r(1) < 0.35) { const d0 = notes[0].deg; for (const n of notes) n.deg = 2 * d0 - n.deg; }   // (inversion: the contrast mirrored)
    // (an octave up, when the whole motif still fits under the lead's ceiling)
    if (r(2) < 0.3 && notes.every(n => noteOf(score, n.deg + 7, score.leadOct ?? 1) <= LEAD_MAX)) for (const n of notes) n.deg += 7;
    if (r(3) < 0.5) {   // (a passing note filling one leap of a third)
      for (let i = 0; i < notes.length - 1; i++) {
        const a = notes[i], c = notes[i + 1];
        if (Math.abs(c.deg - a.deg) === 2 && a.len >= 1 && r(10 + i) < 0.5) {
          const h = a.len / 2;
          notes.splice(i + 1, 0, { at: a.at + h, deg: (a.deg + c.deg) / 2, len: h, vel: a.vel * 0.75 });
          a.len = h; break;
        }
      }
    }
    if (r(4) < 0.35 && notes.length > 2) {   // (rhythm displacement: one inner note pushed half a unit later)
      const i = 1 + Math.floor(r(5) * (notes.length - 2)), n = notes[i];
      if (n.len > 0.5) { n.at += 0.5; n.len -= 0.5; }
    }
  }
  const out = [], lo = half * span, hi = lo + span, chord = chordOf(score, bar);
  for (const n of notes) {
    if (n.at < lo || n.at >= hi) continue;
    let deg = n.deg;
    const at = n.at - lo;
    // (strong beats back on a chord tone of this bar: a varied note, or the theme over another chord, never clashes)
    if (Math.abs(at % strong) < 1e-6 && !inChord(deg, chord)) deg = inChord(deg - 1, chord) ? deg - 1 : deg + 1;
    out.push({ at, deg, midi: noteOf(score, deg, score.leadOct ?? 1), len: Math.min(n.len, span - at + 0.5), vel: n.vel });
  }
  return out;
}

// The MIDI of chord tone idx (0 root, 1 third, 2 fifth, 3 root + 8ve, …) of the bar's chord in octave oct; high chord
// roots fold an octave down so the figure stays in its register
function toneOf(score, r, idx, oct) {
  const base = r >= 4 ? r - 7 : r;
  return noteOf(score, base + 2 * (idx % 3), oct + Math.floor(idx / 3));
}
// The pad's voicing: the chord root at the octave nearest padCenter, and each tone of padTones above it (so an open
// voicing such as day's root, fifth and tenth keeps its shape)
function voicing(score, r, center, shift = 0) {
  const out = [], r0 = noteOf(score, r, 0);
  let m0 = r0;
  while (m0 > center + 5) m0 -= 12;
  while (m0 < center - 7) m0 += 12;
  for (const t of score.padTones || [0, 2, 4]) out.push(noteOf(score, r + t, 0) - r0 + m0 + shift);
  return out;
}
// Bass notes folded into the bass voice's range (C2 ± a fifth to G3)
const bassRange = m => { while (m < 29) m += 12; while (m > 55) m -= 12; return m; };
// The lowest pad note a stinger plays: its lowest buffer (C3) less half an octave
const PAD_LOW = 42;
// The tense layer's ostinato (eighths, semitones from the root) and its pulse
const OSTINATO = [0, 12, 1, 0, 0, 12, -2, 0];
const OST_VEL = [0.8, 0.45, 0.6, 0.5, 0.7, 0.45, 0.55, 0.5];
// The ride layer's gallop (triplet subdivision of the same bar: a rolling long-short figure) and its driving bass
const GALLOP = [[0, 0.9], [1 / 3, 0.35], [2 / 3, 0.5], [1, 0.6], [5 / 3, 0.45], [2, 0.85], [7 / 3, 0.35], [8 / 3, 0.5], [3, 0.6], [11 / 3, 0.45]];
const DRIVE = [[0, 0, 0.6, 0.85], [2 / 3, 0, 0.3, 0.5], [1, 2, 0.6, 0.7], [5 / 3, 0, 0.3, 0.5], [2, 0, 0.6, 0.8], [8 / 3, 0, 0.3, 0.5], [3, 2, 0.6, 0.7], [11 / 3, 3, 0.3, 0.55]];

// Every note of one bar of a score: [{ layer, voice, at (units), len (units), midi, vel }].
// o: { intensity (0..3), stalk, lowAir (deep: no bell, the pad a semitone down), band: { patrons 0..4, claps, game } (the
// tavern band's parts instead of the intensity layers) }. score is the variant to play (rideOf / tenseOf / as is)
export function composeBar(score, bar, seed, o = {}) {
  const ev = [], v = score.voices || {}, I = o.intensity ?? 1, r = chordOf(score, bar), meter = score.meter;
  const add = (layer, voice, at, len, midi, vel) => { if (voice && vel > 0) ev.push({ layer, voice, at, len, midi: voice === 'bass' ? bassRange(midi) : midi, vel }); };
  const bassOct = (score.root ?? 60) >= 57 ? -2 : -1;
  if (o.band) {
    // The band: lead (bowed), pluck chords and frame drum always; a bass with the first patron, a harmony a third below
    // the lead with the second, a hat with the third, the lead doubled an octave up on the contrast with the fourth;
    // claps after 20:00 (village clock); a game at the table (Plan I) adds a drone and a busy hat
    const p = Math.max(0, Math.min(4, o.band.patrons | 0)), lead = phrase(score, bar, seed);
    for (const n of lead) add('lead', v.lead, n.at, n.len, n.midi, n.vel);
    for (const n of score.pluck) add('pluck', v.pluck, n.at, n.len, toneOf(score, r, n.idx, score.pluckOct), n.vel);
    for (const n of score.drum) add('pluck', v.drum, n.at, 1, n.midi, n.vel);
    if (p >= 1) for (const n of score.bass) add('bass', v.bass, n.at, n.len, toneOf(score, r, n.idx, bassOct), n.vel);
    if (p >= 2) for (const n of lead) add('lead', 'pluck', n.at, n.len, noteOf(score, n.deg - 2, score.leadOct ?? 1), n.vel * 0.45);
    if (p >= 3) for (const at of [1, 2, 4, 5]) add('pluck', 'hat', at, 1, 60, 0.35);
    const slot = (((bar % 16) + 16) % 16) >> 1;
    if (p >= 4 && FORM[slot] === 'B') for (const n of lead) add('lead', 'flute', n.at, n.len, n.midi + 12 <= LEAD_MAX ? n.midi + 12 : n.midi, n.vel * 0.4);
    if (o.band.claps) add('pluck', 'clap', 3, 1, 60, 0.5);
    if (o.band.game) {
      add('bass', 'pad', 0, meter, toneOf(score, 0, 0, bassOct + 1), 0.5);
      for (let i = 0; i < meter; i++) add('pluck', 'hat', i, 1, 62, i % 3 ? 0.25 : 0.45);
    }
    return ev;
  }
  const deep = score.id === 'deep';
  // Pad: one chord a bar (the tense variant voiced lower and darker; under water with little air, a semitone down)
  const center = I === 3 ? score.padCenter - 5 : score.padCenter;
  for (const m of voicing(score, r, center, deep && o.lowAir ? -1 : 0)) add('pad', v.pad, 0, meter + 0.15, m, 0.7);
  if (o.stalk) {
    // (stalking: a soft low pulse on the bass, nothing else but the pad)
    for (const at of meter === 6 ? [0, 3] : [0, 2]) add('bass', v.bass, at, 0.5, toneOf(score, r, 0, bassOct - 1), 0.5);
    return ev;
  }
  if (I === 3) {
    // Tense: a low ostinato in eighths, a pulse drum on every beat and a minor second over the root in the pad
    const root = (score.root ?? 60) + 12 * bassOct;
    const step = meter === 6 ? 1 : 0.5, n = meter === 6 ? 6 : 8;
    for (let i = 0; i < n; i++) add('tense', 'bass', i * step, step * 0.9, root + OSTINATO[i % 8], OST_VEL[i % 8]);
    const beats = meter === 6 ? [0, 3] : [0, 1, 2, 3];
    beats.forEach((at, i) => add('tense', 'kick', at, 1, 60, i % 2 ? 0.35 : 0.6));
    add('tense', 'pad', 0, meter + 0.15, voicing(score, r, center)[0] + 1, 0.4);
    return ev;
  }
  // Bass: the score's root-and-fifth pattern; riding, the driving triplet line (in the bass layer, so it never doubles)
  if (I === 2 && meter === 4) for (const [at, idx, len, vel] of DRIVE) add('bass', v.bass, at, len, toneOf(score, r, idx, bassOct), vel);
  else for (const n of score.bass) add('bass', v.bass, n.at, n.len, toneOf(score, r, n.idx, deep ? bassOct - 1 : bassOct), n.vel);
  // Pluck: the moving figure; the score's drum (soft, only when moving or riding)
  for (const n of score.pluck) add('pluck', v.pluck, n.at, n.len, toneOf(score, r, n.idx, score.pluckOct), n.vel);
  if (I >= 1) for (const n of score.drum) add('pluck', v.drum, n.at, 1, n.midi, n.vel);
  // Lead: the phrase; riding, its notes held to the next one and doubled an octave up (the theme in long notes)
  if (!(deep && o.lowAir)) {
    const lead = phrase(score, bar, seed);
    if (I === 2) {
      const held = lead.filter(n => Math.abs(n.at % 1) < 1e-6);
      held.forEach((n, i) => {
        const len = (i + 1 < held.length ? held[i + 1].at : meter) - n.at;
        add('lead', v.lead, n.at, len, n.midi, n.vel);
        add('lead', v.lead, n.at, len, n.midi + 12 <= LEAD_MAX ? n.midi + 12 : n.midi - 12, n.vel * 0.45);
      });
    } else for (const n of lead) add('lead', v.lead, n.at, n.len, n.midi, n.vel);
  }
  // Ride: the gallop on the frame drum and a kick on one and three
  if (I === 2 && meter === 4) {
    for (const [at, vel] of GALLOP) add('ride', 'frame', at, 1, at % 1 ? 64 : 60, vel);
    add('ride', 'kick', 0, 1, 60, 0.6); add('ride', 'kick', 2, 1, 60, 0.45);
  }
  return ev;
}

// One-shot stingers and short cues in the current key: [{ voice, at (s), midi, len (s), vel }].
// danger (a low swell and a drum hit), relief (IV → I resolving chord), arrive (three rising scale notes), found (a bell
// figure), dawn (waking up: a slow rising bell over the tonic)
export function stingerNotes(id, score) {
  const s = score || SCORES.day, out = [], n = (deg, oct) => noteOf(s, deg, oct);
  const add = (voice, at, midi, len, vel) => out.push({ voice, at, midi, len, vel });
  if (id === 'danger') {
    // (the swell an octave under the tense key's root, folded into what the voices play: a score already minor drops
    // its tense root an octave, which put the pad near 30 Hz, far below its lowest buffer and below a laptop's speakers)
    let low = noteOf(tenseOf(s), 0, -1);
    while (low < PAD_LOW) low += 12;
    add('pad', 0, low, 2.2, 0.9); add('pad', 0, low + 1, 2.2, 0.5);
    add('bass', 0, bassRange(low), 1.6, 1); add('kick', 0, 60, 1, 1); add('frame', 0, 55, 1, 0.8);
  } else if (id === 'relief') {
    for (const d of [3, 5, 7]) add('pad', 0, n(d, 0), 1.2, 0.55);
    for (const d of [0, 2, 4, 7]) add('pad', 1.1, n(d, 0), 2.6, 0.6);
    add('bell', 1.1, n(4, 1), 2, 0.5);
  } else if (id === 'arrive') {
    [[0, 2], [0.18, 4], [0.36, 7]].forEach(([at, d], i) => add('bell', at, n(d, 1), i === 2 ? 1.4 : 0.35, 0.7));
    add('pad', 0.36, n(0, 0), 1.6, 0.4);
  } else if (id === 'found') {
    [[0, 7], [0.16, 9], [0.32, 11], [0.56, 9]].forEach(([at, d], i) => add('bell', at, n(d, 0), i === 3 ? 1.5 : 0.3, i === 3 ? 0.6 : 0.5));
    add('pad', 0, n(0, 0), 2, 0.35); add('pad', 0, n(4, 0), 2, 0.3);
  } else if (id === 'dawn') {
    [[0, 0], [0.5, 4], [1.0, 7], [1.6, 9]].forEach(([at, d], i) => add('bell', at, n(d, 1), i === 3 ? 2.5 : 0.6, 0.5));
    for (const d of [0, 4]) add('pad', 0, n(d, 0), 4, 0.4);
  }
  return out;
}
// How long a stinger lasts (s), for "one at a time"
export const stingerLength = id => (id === 'danger' ? 2.4 : id === 'relief' ? 3.8 : id === 'dawn' ? 4.2 : 2);

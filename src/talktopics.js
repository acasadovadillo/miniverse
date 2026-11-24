// What a neighbour talks about: a weighted pick among topics that fit the moment (hour, place, today's weather, tomorrow's
// real one, season, crops and fish of the season, how well you know each other, your house, animals and family, their
// request on the board…). Design: docs/planes/realismo/PLAN-R6-gente.md §3.1 (phase R6.1). No DOM and no state of its
// own: what it remembers is in the neighbour's friend object (friends[id], saved whole by neighbors.js).
//
//   talkContext(game, id, n)   everything the topics look at, built once per talk (nothing per frame)
//   pickTopic(ctx, f)          → { topic, key, li, params, text } (marks f.said and f.tops, and does what the topic does:
//                              f.known, f.wish), or null when there is nothing to say
//   topicWeights(ctx)          { topic: weight } of this context (the tests read it)
//   topicLines(ctx, topic)     every line a topic has now: [{ key, li, src, params, learn? }]
//   moodOf(id, realDay, game, f)  -1 low, 0 fine, 1 high (a pure function of the day, the weather and a loved gift)
//   forecastBy(id, game)       { w, sure, rain? } or null: tomorrow's weather as this neighbour says it. Never a false one
//                              told as true: who is not sure says so (Eusebio always says rain, and says he always does)
//   cropNews(ctx)              what Rosa can say of each crop today (the village's field weather, farm.js almanac)
//   tierOf(hearts), thing(id)
//
// The lines: npc.topic.<topic>[.<sub>].<id> (that neighbour's own), .<temper> and the plain key, all pooled. A line is
// skipped for REST days after it was said to you (f.said), and a topic for the next KEEP_TOPICS picks (f.tops).
// Every line must be true: a topic without its data is not offered.
import { PEOPLE } from './neighbors.js';   // (a cycle, read only inside functions)
import { ITEMS, CROPS, FISH, itemNoun } from './items.js';
import { GROW, MULCH_FROST, rateAt, seedOf } from './cropdata.js';
import { SHOPS } from './economy.js';
import { ORES } from './world/underground.js';
import { DAY_MS } from './time.js';
import { Profile } from './accounts.js';
import { ihash } from './util.js';
import { recent } from './reputation.js';
import { t, tList, has, noun, formatMessage } from './i18n.js';

export const REST = 10;            // days a line rests after being said
export const KEEP_TOPICS = 2;      // topics that do not come back at once
export const SAID_MAX = 64;        // lines remembered per neighbour
export const KNOWN_MAX = 12;       // likes known per neighbour
export const WISH_DAYS = 30;       // days a wish stands
export const SEASON_IDS = ['spring', 'summer', 'autumn', 'winter'];
// How often each one is sure of tomorrow's weather (the others, FORECAST_SURE)
export const SURE = { lia: 0.9, nilo: 0.8, rosa: 0.7 };
export const FORECAST_SURE = 0.6;
const ALWAYS_RAIN = 'eusebio';
const GEMS = ['amatista', 'esmeralda', 'rubi', 'diamante', 'hierro', 'oro'];
const pick = a => a[Math.floor(Math.random() * a.length)];
const idNum = id => { let h = 7; for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) % 9973; return h; };
function fnv(s) { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; }
export const lineHash = (key, li) => (fnv(key) % 1e5) * 64 + (li % 64);

// A thing's name as a noun: its item key, else the talk's own (thing.<id>: the older items have no English name yet)
export const thing = id => (!has(`item.${id}`) && has(`thing.${id}`) ? noun('thing', id) : itemNoun(id));
// The same in general, in the plural where that is how it is said: "me gustan las manzanas" (some.<id>), else thing()
export const someOf = id => (has(`some.${id}`) ? noun('some', id) : thing(id));
// "3 eggs", "20 de madera": a number of things as it is said
export const countOf = (id, n) => (has(`npc.count.${id}`) ? t(`npc.count.${id}`, { n }) : t('npc.count.other', { n, item: thing(id) }));
export const tierOf = hearts => (hearts >= 6 ? 'close' : hearts >= 2 ? 'friend' : 'acquaintance');
const weatherOn = (game, realDay) => { const T = game.days; return realDay === T.realDay ? T.weather : T.weatherFor(realDay - T.base); };

// ---------- mood ----------
export function moodOf(id, realDay, game, f = game.neighbors?.friends?.[id]) {
  const r = ihash(realDay, idNum(id), 431), W = PEOPLE[id]?.weather || {}, w = weatherOn(game, realDay);
  let m = r < 0.2 ? -1 : r > 0.75 ? 1 : 0;
  if (W.likes?.includes(w)) m++;
  if (W.hates?.includes(w)) m--;
  if (f?.giftMood === realDay) m++;
  return Math.max(-1, Math.min(1, m));
}

// ---------- tomorrow ----------
// The real weather of tomorrow, or null when nobody can know it (an op's weather that ends tomorrow, a stopped clock)
export function tomorrowsWeather(game) {
  const T = game.days, lock = game.weatherLock;
  if (game.rules?.doDaylightCycle === false) return null;
  if (lock && lock.until === null) return lock.w;
  if (lock && lock.until > Date.now() + (DAY_MS - T.now % DAY_MS)) return null;   // (it runs into tomorrow)
  return T.weatherFor(T.dayIndex + 1);
}
export function forecastBy(id, game, day = game.days.realDay) {
  const w = tomorrowsWeather(game);
  if (!w) return null;
  if (id === ALWAYS_RAIN) return { w: 'lluvia', sure: false, rain: true };
  return { w, sure: ihash(day, idNum(id), 517) < (SURE[id] ?? FORECAST_SURE) };
}

// ---------- the context ----------
// Where they are, as a word: 'work', 'tavern', 'road' (walking), 'plaza', 'pond', 'board' or null (somewhere else)
function placeOf(id, n) {
  if (id === 'nilo') return 'plaza';
  if (!n) return null;
  if (n.def.seat) return n.def.shop && n.def.work === 'taberna' && !n.def.sits ? 'work' : 'tavern';
  if (n.path.length) return 'road';
  if (n.node === n.def.work) return 'work';
  return n.node.startsWith('pond') ? 'pond' : n.node === 'plaza' || n.node === 'board' ? n.node : null;
}
export function talkContext(game, id, n) {
  const T = game.days, N = game.neighbors, f = N.friend(id), def = PEOPLE[id], hearts = N.hearts(id);
  const guest = !!game.live?.guest, me = Profile.id || 'yo';
  const ctx = {
    game, id, def, f, temper: def.temper, hour: T.hour, realDay: T.realDay, place: placeOf(id, n), hearts, tier: tierOf(hearts),
    weather: T.weather, season: T.season, seasonId: SEASON_IDS[T.season], mood: moodOf(id, T.realDay, game, f), guest,
    goal: n?.path?.length ? n.path[n.path.length - 1] : null,
    name: game.player?.name || '', sex: game.player?.look?.sex === 'chica' ? 'girl' : 'boy',
    others: ['nilo', ...N.people.map(p => p.id)].filter(o => o !== id),
    request: game.board?.requestOf?.(id) || null,
  };
  // (your house is the world owner's: a guest has none of their own here)
  ctx.house = guest ? null : game.house?.family ? 'family' : game.house?.big ? 'big' : null;
  // Your animals (a name only if it was given one)
  const mine = (game.ranch?.animals || []).filter(a => a.owner === me);
  ctx.animals = mine;
  ctx.petOf = type => { const l = mine.filter(a => a.type === type && a.name && a.named !== false); return l.length ? pick(l).name : null; };
  // Your children: those that name you as a parent; the ones from before (no parents) are the world owner's
  const F = game.family?.v || {}, ours = k => (Array.isArray(k?.parents) ? k.parents.includes(me) : !guest);
  ctx.kids = (Array.isArray(F.kids) ? F.kids : []).filter(k => k?.name && k.named !== false && ours(k));
  const x = F.expecting;
  ctx.expecting = !!x && (x.mother === me || x.father === me || (!x.father && !guest));
  return ctx;
}
// The crops growing anywhere in this world (a guest only has the land around: null, unknown). Read once per context
function cropsIn(ctx) {
  if (ctx.crops !== undefined) return ctx.crops;
  if (ctx.guest) return (ctx.crops = null);
  const out = new Set();
  for (const d of ctx.game.world?.deltas?.values?.() || []) if (d.crops) for (const c of Object.values(d.crops)) if (c && !c.dead && CROPS[c.id]) out.add(c.id);
  return (ctx.crops = out);
}
// What there is to say of the crops in the village today: what decides is the weather of its fields (farm.js), as the
// diary's almanac has it. [{ sub, params }]: 'sow' (a good day: about n days), 'slow' (it grows, but little by little),
// 'cold' / 'hot' (nothing today: a seed would wait), 'frost' (a fine day, but tonight would kill what is sown), 'wont' (it
// would not make it), 'none_sown' (a good one that nobody has in the ground, and Rosa sells), 'grow' (in the ground),
// 'frost_sown' (near you, and tonight may bite it) and 'no_crops' (too cold for all of them)
const FIELDS = { x: 0, y: 30 };    // (a tile of the village: its fields' weather)
const GOOD = 0.5, SLOWER = 1.5;    // sow: a day at least this good, and no more than this many times the days of its best
const SOLD = (id, season) => (SHOPS.rosa?.stock || []).some(e => e.id === seedOf(id) && (!e.seasons || e.seasons.includes(season)));
export function cropNews(ctx) {
  const farm = ctx.game.farm, out = [];
  if (!farm) return out;
  const a = farm.almanac(FIELDS.x, FIELDS.y), grown = cropsIn(ctx), danger = ctx.hour >= 5 ? farm.frostTonight() : [];   // (after midnight «tonight» could be either night)
  let alive = false;
  for (const { id, days: n } of a.crops) {
    const g = GROW[id], r = rateAt(id, a.mean), P = { id, crop: someOf(id), n, c: Math.round(a.min) };
    if (r > 0) alive = true;
    if (danger.includes(id)) out.push({ sub: 'frost_sown', params: P });
    if (grown?.has(id)) { out.push({ sub: 'grow', params: P }); continue; }
    if (a.min <= g.kill) { if (r > 0 && ctx.hour >= 5 && a.min + MULCH_FROST <= g.kill) out.push({ sub: 'frost', params: P }); }
    else if (!Number.isFinite(n)) out.push({ sub: 'wont', params: P });
    else if (a.mean <= g.base) out.push({ sub: 'cold', params: P });
    else if (a.mean >= g.stop) out.push({ sub: 'hot', params: P });
    else {
      const good = r >= GOOD && n <= CROPS[id].days * SLOWER;
      out.push({ sub: good ? 'sow' : 'slow', params: P });
      if (good && grown && SOLD(id, ctx.season)) out.push({ sub: 'none_sown', params: P });
    }
  }
  if (!alive && a.mean <= Math.min(...Object.values(GROW).map(g => g.base))) out.push({ sub: 'no_crops' });
  return out;
}
// What bites now and where, as fishing.js picks it: the ones with their own season, hour or weather first
function fishNow(ctx) {
  const T = ctx.game.days, h = T.hour, season = T.season, rain = !!T.info?.rain;
  const okHour = f => !f.hours || (f.hours[0] < f.hours[1] ? h >= f.hours[0] && h < f.hours[1] : h >= f.hours[0] || h < f.hours[1]);
  const okWeather = f => !f.weather || (f.weather === 'lluvia' ? rain : T.weather === f.weather);
  const list = Object.entries(FISH).filter(([, f]) => !f.rare && (!f.seasons || f.seasons.includes(season)) && okHour(f) && okWeather(f))
    .map(([id, f]) => ({ id, own: !!(f.seasons || f.hours || f.weather), water: f.water.filter(w => w !== 'hielo' && has(`npc.water.${w}`)) })).filter(o => o.water.length);
  const own = list.filter(o => o.own);
  return own.length ? own : list;
}
const unknownLikes = ctx => {
  const known = Array.isArray(ctx.f.known) ? ctx.f.known : [], left = l => l.filter(i => ITEMS[i] && !known.includes(i));
  const likes = left(ctx.def.likes);
  return likes.length ? likes : left(ctx.def.loves);
};
const wishOpen = ctx => Array.isArray(ctx.f.wish) && recent(ctx.realDay, ctx.f.wish[1], WISH_DAYS);
const shopStock = id => (SHOPS[id]?.stock || []).filter(e => e.id && ITEMS[e.id]);

// ---------- the topics ----------
// weight(ctx): 0, not now. subs(ctx): what it can be about, [{ sub, params, done }] (sub: part of the key, '' for none;
// done: what saying it does). Lines: npc.topic.<topic>[.<sub>].<id|temper> and npc.topic.<topic>[.<sub>]
const one = () => [{ sub: '' }];
export const TOPICS = {
  weather_now: { weight: c => (['lluvia', 'tormenta', 'nieve', 'niebla'].includes(c.weather) ? 3 : 1), subs: c => [{ sub: c.weather === 'sol' && (c.hour >= 20 || c.hour < 7) ? 'clear_night' : c.weather }] },
  forecast: {
    weight: c => (c.hour >= 5 && forecastBy(c.id, c.game) ? (c.hour >= 16 ? 3 : 1.5) : 0),   // (after midnight «tomorrow» could be either day)
    subs: c => { const fc = forecastBy(c.id, c.game); return !fc ? [] : fc.rain ? [{ sub: 'always_rain' }] : [{ sub: fc.sure ? fc.w : 'unsure' }]; },
  },
  season_work: {
    weight: () => 2,
    subs: c => {
      const out = [{ sub: c.seasonId }];
      if (c.id === 'rosa') out.push(...cropNews(c));
      if (c.id === 'lia') for (const o of fishNow(c)) out.push({ sub: 'fish', params: { fish: thing(o.id), water: t(`npc.water.${pick(o.water)}`) } });
      if (c.id === 'bruno') for (const [id, lvl] of ORES) if (GEMS.includes(id) && lvl > 1) out.push({ sub: 'ore', params: { item: someOf(id), n: lvl } });
      if (c.id === 'anselmo' && c.place === 'work') for (const e of shopStock('anselmo')) out.push({ sub: 'menu', params: { item: thing(e.id) } });
      if (c.id === 'marta') for (const e of shopStock('marta')) if (e.seasons?.includes(c.season)) out.push({ sub: 'clothes', params: { item: thing(e.id) } });
      return out;
    },
  },
  their_day: {
    weight: c => (c.place ? 1.5 : 0),
    subs: c => (c.place === 'road' ? (c.goal && has(`npc.goal.${goalKey(c.goal)}`) ? [{ sub: 'road', params: { goal: t(`npc.goal.${goalKey(c.goal)}`) } }] : []) : [{ sub: c.place }]),
  },
  hour: { weight: c => (c.hour < 8 || c.hour >= 22 ? 2 : 0), subs: c => [{ sub: c.hour >= 22 || c.hour < 5 ? 'late' : 'early' }] },
  // (keys npc.opinion.<id>.<other>: only about who lives in the village now)
  village: { weight: () => 1, keys: c => c.others.map(o => ({ key: `npc.opinion.${c.id}.${o}` })) },
  your_place: {
    weight: c => (c.hearts >= 1 ? 1 : 0),
    subs: c => {
      const out = [], farm = c.animals.filter(a => !a.def?.pet && !a.def?.ride).length, hens = c.animals.filter(a => a.type === 'gallina').length;
      for (const type of ['perro', 'gato', 'caballo']) { const animal = c.petOf(type); if (animal) out.push({ sub: type, params: { animal } }); }
      if (hens >= 2) out.push({ sub: 'hens', params: { n: hens } });
      if (farm >= 4) out.push({ sub: 'farm', params: { n: farm } });
      if (c.house) out.push({ sub: c.house });
      return out;
    },
  },
  your_family: {
    weight: c => (c.hearts >= 2 && (c.kids.length || c.expecting) ? 2 : 0),
    subs: c => [...(c.expecting ? [{ sub: 'expecting' }] : []), ...c.kids.map(k => ({ sub: c.game.family.baby(k) ? 'baby' : 'kid', params: { kid: k.name, ksex: k.sex === 'chica' ? 'girl' : 'boy' } }))],
  },
  request: { weight: c => (c.request ? 3 : 0), subs: c => (c.request ? [{ sub: '', params: { what: countOf(c.request.item, c.request.n) } }] : []) },
  likes: {
    weight: c => (c.hearts >= 1 && unknownLikes(c).length ? 1 : 0),
    subs: c => unknownLikes(c).map(id => ({ sub: '', params: { some: someOf(id) }, done: f => learn(f, id) })),
  },
  wish: {
    weight: c => (c.hearts >= 2 && !wishOpen(c) && c.def.loves.some(i => ITEMS[i]) ? 1.5 : 0),
    subs: c => c.def.loves.filter(i => ITEMS[i] && i !== c.f.wish?.[0]).map(id => ({ sub: '', params: { item: thing(id), some: someOf(id) }, done: f => { f.wish = [id, c.realDay]; learn(f, id); } })),
  },
  personal: { weight: c => (c.hearts >= 3 ? 1.5 : 0), keys: c => [{ key: `npc.chat.${c.id}.personal` }] },
  misc: { weight: () => 1, keys: c => [{ key: `npc.chat.${c.id}.misc` }] },
  tip: { weight: c => (c.id === 'nilo' ? 3 : 0), keys: () => [{ key: 'npc.chat.nilo.tip' }] },
};
const goalKey = node => (node.startsWith('door') ? 'home' : node.startsWith('pond') ? 'pond' : node);
// A taste of theirs that you know now (journal)
export function learn(f, item) {
  if (!ITEMS[item]) return;
  const k = Array.isArray(f.known) ? f.known : (f.known = []);
  if (!k.includes(item)) k.push(item);
  if (k.length > KNOWN_MAX) k.shift();
}

// ---------- the pick ----------
export function topicWeights(ctx) { const out = {}; for (const [k, T] of Object.entries(TOPICS)) out[k] = T.weight(ctx); return out; }
export function topicLines(ctx, topic) {
  const T = TOPICS[topic], out = [];
  const add = (key, v) => tList(key).forEach((src, li) => out.push({ topic, key, li, src, params: v.params, done: v.done }));
  if (T.keys) for (const v of T.keys(ctx)) add(v.key, v);
  else for (const v of (T.subs || one)(ctx)) {
    const base = `npc.topic.${topic}${v.sub ? '.' + v.sub : ''}`;
    add(`${base}.${ctx.id}`, v); add(`${base}.${ctx.temper}`, v); add(base, v);
  }
  return out;
}
// The lines said to you in the last REST days (day numbers are the calendar's, so they hold in anyone's world)
const saidSet = (f, realDay) => new Set((Array.isArray(f.said) ? f.said : []).filter(s => Array.isArray(s) && recent(realDay, s[0], REST - 1)).map(s => s[1]));
export function pickTopic(ctx, f = ctx.f) {
  const said = saidSet(f, ctx.realDay), tops = Array.isArray(f.tops) ? f.tops : [], W = topicWeights(ctx);
  const fresh = new Map();   // topic → its unsaid lines (made when the topic is drawn)
  const freshOf = k => { let l = fresh.get(k); if (!l) fresh.set(k, l = topicLines(ctx, k).filter(x => !said.has(lineHash(x.key, x.li)))); return l; };
  for (const skip of [true, false]) {   // (the last topics only when the others have nothing new)
    const left = Object.keys(W).filter(k => W[k] > 0 && !(skip && tops.includes(k)));
    while (left.length) {
      let r = Math.random() * left.reduce((s, k) => s + W[k], 0), i = 0;
      while (i < left.length - 1 && (r -= W[left[i]]) >= 0) i++;
      const lines = freshOf(left[i]);
      if (lines.length) return say(ctx, f, pickLine(lines));
      left.splice(i, 1);
    }
  }
  // Everything was said lately: the one said the longest ago
  const all = Object.keys(W).filter(k => W[k] > 0).flatMap(k => topicLines(ctx, k));
  if (!all.length) return null;
  const at = h => { for (let i = f.said.length - 1; i >= 0; i--) if (f.said[i][1] === h) return i; return -1; };
  return say(ctx, f, all.reduce((b, x) => (at(lineHash(x.key, x.li)) < at(lineHash(b.key, b.li)) ? x : b)));
}
// One of these lines, their own ones (about a crop, a fish, their temper's…) each as likely: by key first, then the line
function pickLine(lines) {
  const keys = [...new Set(lines.map(x => x.key))], k = pick(keys);
  return pick(lines.filter(x => x.key === k));
}
function say(ctx, f, x) {
  const h = lineHash(x.key, x.li);
  if (!Array.isArray(f.said)) f.said = [];
  f.said = f.said.filter(s => Array.isArray(s) && s[1] !== h);
  f.said.push([ctx.realDay, h]);
  if (f.said.length > SAID_MAX) f.said.splice(0, f.said.length - SAID_MAX);
  f.tops = [...(Array.isArray(f.tops) ? f.tops : []), x.topic].slice(-KEEP_TOPICS);
  x.done?.(f);
  return { topic: x.topic, key: x.key, li: x.li, params: x.params, text: formatMessage(x.src, { name: ctx.name, sex: ctx.sex, ...x.params }) };
}

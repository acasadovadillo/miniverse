// Translations. English is the base language: every text has a key in src/lang/en.json, and each language has the
// same keys in its own file (src/lang/es.json). A key missing in a language falls back to English, then to the key.
// Messages use a small subset of ICU MessageFormat, compiled once per key and cached (t() is cheap enough to call
// every frame): {name}, {n, plural, one {# day} other {# days}}, {sex, select, girl {…} other {…}}, {n, number}
// and the noun formatters {item, the}, {item, a}, {item, lower} (and in Spanish {item, al}, {item, del}), with a
// capital first letter for the start of a sentence: {item, The}. See docs/i18n.md.
//
// The files are loaded with top-level await, so every module that imports this one already has its language when it
// runs. If English (or the chosen language) cannot be loaded, the import fails and index.html shows its retry screen.
import { GRAMMAR } from './lang/grammar.js';

// Each language, named in itself
export const LANGS = { en: 'English', es: 'Español' };
// What "Automatic" may choose from the browser's language: only languages the whole game is translated into. The
// game's own texts are still written in Spanish in the code, so English would come out half and half: add 'en' when
// F5 (all texts to keys) is done. Keep the list in index.html (the early script in <head>) in step with this one.
export const AUTO_LANGS = ['es'];

const SETTINGS_KEY = 'pueblo-brotes:ajustes';   // (existing key of the saved settings: never rename it)
const DATA_PREFIX = 'pueblo-brotes:';           // (localStorage keys of the game: settings, windows, version…)
const DATA_DB = 'pueblo-brotes';                // (IndexedDB with the accounts and saves: see db.js)
const hasDoc = typeof document !== 'undefined';
const query = new URLSearchParams(typeof location !== 'undefined' ? location.search : '');
const MODE = query.get('modo');
// The world server and the automatic tests stay in Spanish, as before (their texts are compared and logged in Spanish)
const FIXED_MODE = MODE === 'servidor' || MODE === 'pruebas';
const CHECK = query.get('i18n') === 'check';    // (?i18n=check: warn once for each key without a translation)
const VERSION = hasDoc ? document.querySelector('meta[name="miniverse-version"]')?.content || '' : '';

// ---------- choosing the language ----------
// Order: ?lang=en|es|keys (tests; keys shows the keys instead of the texts) → the saved setting (Settings.v.lang:
// 'en', 'es' or 'auto') → the language of the account that logged in (setAccountLang) → automatic.
export function browserLang() {
  const l = String((typeof navigator !== 'undefined' && (navigator.languages?.[0] || navigator.language)) || 'en').toLowerCase();
  return l.startsWith('es') ? 'es' : 'en';   // (user rule: a Spanish browser gets Spanish, anything else English)
}
export function autoLang() { const b = browserLang(); return AUTO_LANGS.includes(b) ? b : AUTO_LANGS[0]; }
const norm = v => (LANGS[v] ? v : 'auto');
const urlLang = ['en', 'es', 'keys'].includes(query.get('lang')) ? query.get('lang') : null;
let fixed = urlLang || (FIXED_MODE ? 'es' : null);
let setting = 'auto', account = null;
const wanted = () => fixed || (setting !== 'auto' ? setting : account || autoLang());

function readSettings() {
  try { const s = JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}'); return s && typeof s === 'object' ? s : {}; } catch { return {}; }
}
// Games that already exist stay in Spanish: the first time this version runs in a browser that already has data of
// the game (any pueblo-brotes:* key, or the accounts database), the setting becomes 'es'; in a new browser, 'auto'.
// Either way it is saved, so this only happens once. (Old versions just carry the extra field along.)
async function firstSetting() {
  try { for (let i = 0; i < localStorage.length; i++) if (localStorage.key(i)?.startsWith(DATA_PREFIX)) return 'es'; } catch { /* (no storage) */ }
  try {
    const dbs = await Promise.race([indexedDB.databases?.(), new Promise(r => setTimeout(r, 400))]);
    if (dbs?.some(d => d.name === DATA_DB)) return 'es';
  } catch { /* (no IndexedDB, or no list of databases) */ }
  return 'auto';
}
async function initialSetting() {
  const s = readSettings();
  if ('lang' in s) return norm(s.lang);
  if (FIXED_MODE) return 'auto';   // (the server and the tests neither decide nor save it)
  const v = await firstSetting();
  try { localStorage.setItem(SETTINGS_KEY, JSON.stringify({ ...readSettings(), lang: v })); } catch { /* (it is decided again next time) */ }
  return v;
}

// ---------- loading ----------
const dicts = {};
async function fetchLang(l) {
  const url = new URL(`./lang/${l}.json?v=${encodeURIComponent(VERSION)}`, import.meta.url);
  for (let i = 0; ; i++) {
    try {
      const r = await fetch(url);
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return await r.json();
    } catch (e) {
      if (i < 1) continue;   // (one retry: a stray error of the host)
      // The world server shows nothing, and a multijugador.py started before the language files existed does not serve
      // them (it only served src/*.js): it must keep running, with the keys as texts, rather than not start at all
      if (MODE === 'servidor') { console.warn(`i18n: no ${l}.json (${e.message}): the world server goes on without it`); return {}; }
      throw new Error(`Cannot load the language file ${l}.json: ${e.message}`);
    }
  }
}
const load = l => (dicts[l] ||= fetchLang(l).catch(e => { delete dicts[l]; throw e; }));

const baseLoad = load('en');
baseLoad.catch(() => {});   // (awaited below: no "unhandled" warning meanwhile)
if (hasDoc && typeof localStorage !== 'undefined') setting = await initialSetting();
let lang = wanted();
const BASE = (await Promise.all([baseLoad, lang !== 'en' && lang !== 'keys' ? load(lang) : null]))[0];
let locale, dict, showKeys, rules, ordinals;
const compiled = new Map(), nouns = new Map(), intl = new Map(), warned = new Set();
async function use(l) {
  const loc = l === 'keys' ? 'en' : l, d = await dicts[loc];
  lang = l; locale = loc; showKeys = l === 'keys'; dict = d;
  rules = new Intl.PluralRules(locale); ordinals = new Intl.PluralRules(locale, { type: 'ordinal' });
  compiled.clear(); nouns.clear(); intl.clear();
  if (hasDoc) document.documentElement.lang = locale;
}
export const getLang = () => lang;                 // 'en', 'es' (or 'keys' with ?lang=keys)
export const getLocale = () => locale;             // for Intl and <html lang>
export const getLangSetting = () => setting;       // what the player chose: 'auto', 'en' or 'es'

// ---------- messages ----------
const NO_PARAMS = {};
// t('gui.menu.continue'), t('count_item', { n: 3, item: noun('item', 'apple') })
export function t(key, params) {
  let fn = compiled.get(key);
  if (!fn) compiled.set(key, fn = build(key));
  return fn(params || NO_PARAMS);
}
// (own keys only: a key like "constructor" must not find Object's)
const own = (d, k) => (Object.prototype.hasOwnProperty.call(d, k) ? d[k] : undefined);
export const has = key => own(dict, key) !== undefined || own(BASE, key) !== undefined;
function warn(key, what) {
  if (warned.has(key)) return;
  warned.add(key);
  console.warn(`i18n: ${what} "${key}"`);
}
function build(key) {
  if (showKeys) return () => key;
  let src = own(dict, key);
  if (src === undefined && dict !== BASE) { src = own(BASE, key); if (CHECK && src !== undefined) warn(key, `no ${lang} translation for`); }
  if (src === undefined) { warn(key, 'missing key'); return () => key; }
  if (typeof src !== 'string') return () => key;   // (arrays go through tList; noun data is read by the formatters)
  return compileOrText(src, key);
}
function compileOrText(src, key) {
  try { return compile(src); } catch (e) { warn(key, `bad message (${e.message}) in`); return () => src; }
}
// A message that is not in the files, in the current language (tests; formatting a text that comes from elsewhere)
export const formatMessage = (src, params) => compileOrText(src, src)(params || NO_PARAMS);
// For innerHTML: the message is ours (it may carry <b>, <kbd>), the parameters are escaped (player names, chat…)
export const tHtml = (key, params) => t(key, params && Object.fromEntries(Object.entries(params).map(([k, v]) => [k, escapeParam(v)])));
// Arrays in the files: random lines (greetings, chatter)
export function tList(key) {
  if (showKeys) return [key];
  const v = own(dict, key) ?? own(BASE, key);
  return Array.isArray(v) ? v : [];
}
// A noun that can take an article: { noun: 'item.apple' }. Its name and its grammar ("item.apple.g": "f"…) come
// from the language file. A plain object { name, g… } or a plain string (a player's name) also work as nouns
export const noun = (kind, id) => ({ noun: `${kind}.${id}` });

const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
const esc = s => String(s).replace(/[&<>"']/g, c => ESC[c]);
const escapeParam = v => (typeof v === 'string' ? esc(v) : Array.isArray(v) ? v.map(escapeParam) : v && typeof v === 'object' && !v.noun && typeof v.name === 'string' ? { ...v, name: esc(v.name) } : v);

// ---------- numbers, lists and dates (Intl, cached per language) ----------
const cached = (k, make) => { let f = intl.get(k); if (!f) intl.set(k, f = make()); return f; };
export const fmt = {
  num: (n, o) => cached(o ? 'n' + JSON.stringify(o) : 'n', () => new Intl.NumberFormat(locale, o)).format(n),
  list: (a, type = 'conjunction') => cached('l' + type, () => new Intl.ListFormat(locale, { type })).format(a.map(String)),
  date: (ts, o) => cached(o ? 'd' + JSON.stringify(o) : 'd', () => new Intl.DateTimeFormat(locale, o)).format(ts),
  compare: (a, b) => cached('c', () => new Intl.Collator(locale)).compare(a, b),
};

// ---------- the ICU subset ----------
// A message compiles to a list of parts: strings, POUND (the number of the closest plural) and arguments
// { name, type, cases }. Quoting as in ICU: '' is an apostrophe, '{…}' is literal text; a lone ' is just a letter.
const POUND = 0;
const CASED = new Set(['plural', 'select', 'selectordinal']);
function parse(src) {
  let i = 0;
  const fail = what => { throw new Error(`${what} at ${i}`); };
  const ws = () => { while (/\s/.test(src[i] || '')) i++; };
  const word = () => { ws(); const m = /^[^\s,{}]+/.exec(src.slice(i)); if (!m) fail('expected a name'); i += m[0].length; ws(); return m[0]; };
  function message(pound) {
    const parts = [];
    let text = '';
    const flush = () => { if (text) parts.push(text); text = ''; };
    while (i < src.length && src[i] !== '}') {
      const c = src[i];
      if (c === '{') { flush(); parts.push(arg(pound)); continue; }
      if (c === '#' && pound) { flush(); parts.push(POUND); i++; continue; }
      if (c === "'") {
        const n = src[i + 1];
        if (n === "'") { text += "'"; i += 2; continue; }
        if (n === '{' || n === '}' || (n === '#' && pound)) {
          const end = src.indexOf("'", i + 1);
          text += end < 0 ? src.slice(i + 1) : src.slice(i + 1, end);
          i = end < 0 ? src.length : end + 1;
          continue;
        }
      }
      text += c; i++;
    }
    flush();
    return parts;
  }
  function arg(pound) {
    i++;   // ({)
    const name = word();
    if (src[i] === '}') { i++; return { name }; }
    if (src[i] !== ',') fail('expected , or }');
    i++;
    const type = word();
    if (src[i] === '}') { i++; return { name, type }; }
    if (!CASED.has(type)) fail(`unknown type ${type}`);
    if (src[i] !== ',') fail('expected ,');
    i++;
    const cases = {};
    for (;;) {
      ws();
      if (src[i] === '}') { i++; break; }
      const sel = word();
      if (src[i] !== '{') fail(`expected { after ${sel}`);
      i++;
      cases[sel] = message(pound || type !== 'select');
      if (src[i] !== '}') fail('unclosed case');
      i++;
    }
    if (!cases.other) fail(`${type} without other`);
    return { name, type, cases };
  }
  const top = message(false);   // (# only means the number inside a plural, also in a select within it)
  if (i < src.length) fail('unbalanced }');
  return top;
}
function compile(src) {
  if (!/[{}']/.test(src)) return () => src;   // (most texts: a constant)
  const parts = parse(src);
  if (parts.length === 1 && typeof parts[0] === 'string') { const s = parts[0]; return () => s; }
  return p => render(parts, p, undefined);
}
function render(parts, p, num) {
  let out = '';
  for (const part of parts) out += typeof part === 'string' ? part : part === POUND ? fmt.num(num) : arg(part, p, num);
  return out;
}
function arg(a, p, num) {
  const v = p[a.name];
  if (!a.type) return show(v, a.name);
  if (a.type === 'plural' || a.type === 'selectordinal') {
    const n = Number(v), c = a.cases['=' + n] ?? a.cases[(a.type === 'plural' ? rules : ordinals).select(n)] ?? a.cases.other;
    return render(c, p, n);
  }
  if (a.type === 'select') return render(a.cases[String(v)] ?? a.cases.other, p, num);
  if (a.type === 'number') return typeof v === 'number' ? fmt.num(v) : show(v, a.name);
  return nounAs(v, a.type, a.name);
}
function show(v, name) {
  if (v === undefined || v === null) return `{${name}}`;   // (a missing parameter shows, so it gets noticed)
  if (typeof v === 'number') return fmt.num(v);
  if (Array.isArray(v)) return fmt.list(v.map(x => show(x, name)));
  if (typeof v === 'object') return nounOf(v).name;
  return String(v);
}
const NOUN_FIELDS = ['g', 'mass', 'plural', 'an', 'keepCase', 'lower', 'the', 'a'];
function nounOf(v) {
  if (typeof v === 'string') return { name: v };
  if (!v.noun) return v;
  let n = nouns.get(v.noun);
  if (!n) {
    n = { name: t(v.noun) };
    for (const f of NOUN_FIELDS) { const x = own(dict, `${v.noun}.${f}`); if (x !== undefined) n[f] = x; }   // (grammar: from this language only)
    nouns.set(v.noun, n);
  }
  return n;
}
function nounAs(v, style, name) {
  if (v === undefined || v === null) return `{${name}}`;
  const cap = style[0] !== style[0].toLowerCase(), s = style.toLowerCase();
  const f = GRAMMAR[locale]?.[s];
  if (!f) { warn(`${name}, ${style}`, `no formatter in ${locale} for`); return show(v, name); }
  const out = f(nounOf(v));
  return cap ? out[0].toUpperCase() + out.slice(1) : out;
}

// ---------- catalogs ----------
// Turns name/desc of each entry of a data table into getters that read the language file ("<prefix>.<id>" for name,
// "<prefix>.<id>.<field>" for the others), so the hundreds of places that read ITEMS[id].name keep working and change
// language by themselves. While a key is not in the files yet, the old value is used.
export function defineNames(table, prefix, fields = ['name', 'desc']) {
  for (const [id, def] of Object.entries(table)) {
    if (!def || typeof def !== 'object') continue;
    for (const f of fields) {
      const key = f === 'name' ? `${prefix}.${id}` : `${prefix}.${id}.${f}`;
      let old = def[f];
      Object.defineProperty(def, f, { get: () => (has(key) ? t(key) : old), set: v => { old = v; }, enumerable: true, configurable: true });
    }
  }
  return table;
}

// ---------- the static HTML ----------
// data-i18n="key" (text), data-i18n-html="key" (markup from the language file, which is ours: <kbd>, <b>),
// data-i18n-attr="title:key;aria-label:key". The elements whose text the code changes do not carry them.
export function applyDom(root = hasDoc ? document : null) {
  if (!root?.querySelectorAll) return;
  const each = (sel, fn) => { if (root.matches?.(sel)) fn(root); for (const el of root.querySelectorAll(sel)) fn(el); };
  each('[data-i18n]', el => { const s = t(el.dataset.i18n); if (el.textContent !== s) el.textContent = s; });
  each('[data-i18n-html]', el => { const s = t(el.dataset.i18nHtml); if (el.i18nHtml !== s) { el.innerHTML = s; el.i18nHtml = s; } });
  each('[data-i18n-attr]', el => {
    for (const pair of el.dataset.i18nAttr.split(';')) {
      const [attr, key] = pair.split(':').map(x => x.trim());
      if (attr && key) { const s = t(key); if (el.getAttribute(attr) !== s) el.setAttribute(attr, s); }
    }
  });
}

// ---------- switching while playing ----------
// Loads the language if needed, re-translates the static HTML and fires 'langchange' (on window) so the open screens
// redraw their texts. What is already in the chat or in a notice stays as it was, as in Minecraft. Returns false if
// the language could not be loaded (it stays as it was).
let switching = 0;
export async function setLang(l) {
  if (l !== 'keys' && !LANGS[l]) return false;
  if (l === lang) return true;
  const mine = ++switching;
  try { await load(l === 'keys' ? 'en' : l); } catch (e) { console.warn(e.message); return false; }
  if (mine !== switching) return false;   // (another switch came after this one)
  await use(l);
  applyDom();
  if (typeof dispatchEvent === 'function') dispatchEvent(new Event('langchange'));
  return true;
}
export function onLangChange(fn) { addEventListener('langchange', fn); return () => removeEventListener('langchange', fn); }
// The player's choice ('auto', 'en' or 'es'), from Settings or the login screen: it wins over ?lang=. Saving it is
// up to Settings (Settings.setLang)
export function useLangSetting(v) { setting = norm(v); fixed = null; return setLang(wanted()); }
// The language the account asks for (save.lang), while this device is on automatic. A save from before this version
// has none and stays in Spanish; with 'auto' (or no save yet) it is the device's automatic choice
export function setAccountLang(v) { account = LANGS[v] ? v : null; return setLang(wanted()); }
export const accountLangOf = save => (!save ? null : save.lang === undefined ? 'es' : LANGS[save.lang] ? save.lang : null);
// What goes in the save (save.lang): the explicit choice of this device or, on automatic, the account's, so an
// account from before keeps its Spanish; 'auto' otherwise
export const savedLang = () => (setting !== 'auto' ? setting : account || 'auto');

// ---------- start ----------
// (last, once everything above exists: the page is translated before main.js shows any screen)
await use(lang);
applyDom();

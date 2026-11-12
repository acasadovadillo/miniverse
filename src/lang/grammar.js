// Per-language grammar for nouns inside messages: the formatters {x, the}, {x, a}, {x, lower} and, only in Spanish,
// {x, al} and {x, del}. A noun is { name, g, mass, plural, an, keepCase, lower, the, a }: its name in the current
// language plus the optional data from the language file ("item.planks.g": "fp", "item.wood.mass": true…).
// The rules that need code live here; everything else (words, word order) lives in the JSON files.

// Lowercase a noun's name inside a sentence, unless it is a proper name (keepCase) or the file says how (lower)
const low = n => n.lower ?? (n.keepCase ? n.name : n.name.toLowerCase());

const ES_THE = { m: 'el', f: 'la', mp: 'los', fp: 'las' };
const ES_A = { m: 'un', f: 'una', mp: 'unos', fp: 'unas' };
const esThe = n => n.the ?? `${ES_THE[n.g] || 'el'} ${low(n)}`;

export const GRAMMAR = {
  en: {
    lower: low,
    the: n => n.the ?? `the ${low(n)}`,
    // (no article for mass nouns and plurals: "some wood" reads better spelled out in the message itself)
    a: n => n.a ?? (n.mass || n.plural ? low(n) : `${(n.an ?? /^[aeiou]/i.test(n.name)) ? 'an' : 'a'} ${low(n)}`),
  },
  es: {
    lower: low,
    the: esThe,
    a: n => n.a ?? `${ES_A[n.g] || 'un'} ${low(n)}`,
    // a + el = al, de + el = del (also for "el hacha", which is feminine but takes "el": it goes by the article)
    al: n => { const t = esThe(n); return t.startsWith('el ') ? `al ${t.slice(3)}` : `a ${t}`; },
    del: n => { const t = esThe(n); return t.startsWith('el ') ? `del ${t.slice(3)}` : `de ${t}`; },
  },
};

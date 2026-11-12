#!/usr/bin/env python3
"""Static check of the translations (no Node needed). See docs/i18n.md.

  python3 tools/i18n_check.py            key parity, parameters, message syntax, keys used in the code and the HTML
  python3 tools/i18n_check.py --strict   also lists Spanish text left in the code (fails until all texts are keys: F5)
  python3 tools/i18n_check.py --unused   also lists keys of en.json that no literal in the code uses (some are built
                                         from ids, like 'lang.' + id: it is only a hint)

Exit status 1 if something is wrong (in --strict, also if there is Spanish text left in the code).
"""
import json, os, re, sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
LANG_DIR = os.path.join(ROOT, 'src', 'lang')
BASE = 'en'
# Grammar data of a noun ("item.planks.g": "fp"): per language, not needed in every file (see src/lang/grammar.js)
NOUN_FIELDS = {'g', 'mass', 'plural', 'an', 'keepCase', 'lower', 'the', 'a'}
GENDERS = {'m', 'f', 'mp', 'fp'}
# Noun formatters each language has (grammar.js), plus the number type; a capital first letter is also valid
FORMATTERS = {'en': {'the', 'a', 'lower'}, 'es': {'the', 'a', 'lower', 'al', 'del'}}
CASED = {'plural', 'select', 'selectordinal'}
PLURAL_SELECTORS = {'zero', 'one', 'two', 'few', 'many', 'other'}

errors, notes = [], []
def err(msg): errors.append(msg)


# ---------- the ICU subset (the same as compile() in src/i18n.js) ----------
class Bad(Exception):
    pass

def parse(src):
    """Returns the arguments of a message: [(name, type, selectors)]. Raises Bad if it is not well formed."""
    i, args = 0, []
    def ws():
        nonlocal i
        while i < len(src) and src[i].isspace(): i += 1
    def word():
        nonlocal i
        ws()
        m = re.match(r'[^\s,{}]+', src[i:])
        if not m: raise Bad(f'expected a name at {i}')
        i += len(m.group(0)); ws()
        return m.group(0)
    def message(pound):
        nonlocal i
        while i < len(src) and src[i] != '}':
            c = src[i]
            if c == '{': arg(pound); continue
            if c == "'" and i + 1 < len(src):
                n = src[i + 1]
                if n == "'": i += 2; continue
                if n in '{}' or (n == '#' and pound):
                    end = src.find("'", i + 1)
                    i = len(src) if end < 0 else end + 1
                    continue
            i += 1
    def arg(pound):
        nonlocal i
        i += 1
        name = word()
        if i < len(src) and src[i] == '}': i += 1; args.append((name, None, None)); return
        if i >= len(src) or src[i] != ',': raise Bad(f'expected , or }} after {name}')
        i += 1
        typ = word()
        if i < len(src) and src[i] == '}': i += 1; args.append((name, typ, None)); return
        if typ not in CASED: raise Bad(f'unknown type {typ}')
        if i >= len(src) or src[i] != ',': raise Bad(f'expected , after {typ}')
        i += 1
        sels = []
        while True:
            ws()
            if i >= len(src): raise Bad(f'unclosed {typ}')
            if src[i] == '}': i += 1; break
            sel = word()
            if i >= len(src) or src[i] != '{': raise Bad(f'expected {{ after {sel}')
            i += 1
            message(pound or typ != 'select')
            if i >= len(src) or src[i] != '}': raise Bad(f'unclosed case {sel}')
            i += 1
            sels.append(sel)
        if 'other' not in sels: raise Bad(f'{typ} of {name} without other')
        if typ != 'select':
            for s in sels:
                if s not in PLURAL_SELECTORS and not re.fullmatch(r'=\d+(\.\d+)?', s): raise Bad(f'{typ} selector {s}')
        args.append((name, typ, sels))
    message(False)
    if i < len(src): raise Bad(f'unbalanced }} at {i}')
    return args

def tags(s):
    return sorted(re.findall(r'</?\s*([a-zA-Z0-9]+)', s))


# ---------- the language files ----------
def load(path):
    try:
        with open(path, encoding='utf-8') as f: d = json.load(f)
    except (OSError, ValueError) as e:
        err(f'{os.path.relpath(path, ROOT)}: cannot be read: {e}'); return {}
    if not isinstance(d, dict): err(f'{os.path.relpath(path, ROOT)}: not an object'); return {}
    return d

def is_meta(key, d):
    head, _, last = key.rpartition('.')
    return last in NOUN_FIELDS and head in d

langs = {f[:-5]: load(os.path.join(LANG_DIR, f)) for f in sorted(os.listdir(LANG_DIR)) if f.endswith('.json')}
base = langs.get(BASE, {})
if not base: err(f'src/lang/{BASE}.json is missing or empty')
KEY_RE = re.compile(r'[a-z0-9_]+(\.[a-zA-Z0-9_]+)*')

parsed = {}
for l, d in langs.items():
    for k, v in d.items():
        if not KEY_RE.fullmatch(k): err(f'{l}.json: key "{k}": lowercase words with dots and snake_case')
        if is_meta(k, d):
            last = k.rpartition('.')[2]
            if last == 'g' and v not in GENDERS: err(f'{l}.json: "{k}" must be one of {sorted(GENDERS)}')
            continue
        if k.rpartition('.')[2] in NOUN_FIELDS and k.rpartition('.')[0] not in d and k.rpartition('.')[0] in base:
            err(f'{l}.json: "{k}" is grammar data of a noun this file does not have')
        texts = v if isinstance(v, list) else [v]
        if not all(isinstance(x, str) for x in texts): err(f'{l}.json: "{k}" must be a text or a list of texts'); continue
        # (an empty translation would show nothing on screen: only where the base is empty too)
        if l != BASE and isinstance(v, str) and not v.strip() and isinstance(base.get(k), str) and base[k].strip(): err(f'{l}.json: "{k}" is empty')
        if l == BASE and isinstance(v, str) and not v.strip(): err(f'{l}.json: "{k}" is empty')
        out = []
        for x in texts:
            try: out.append(parse(x))
            except Bad as e: err(f'{l}.json: "{k}": {e}'); out.append(None)
        parsed[(l, k)] = out
        for a in out:
            for name, typ, _ in a or []:
                if typ and typ not in CASED and typ != 'number' and typ.lower() not in FORMATTERS.get(l, FORMATTERS[BASE]):
                    err(f'{l}.json: "{k}": {{{name}, {typ}}} is not a formatter of {l} (see src/lang/grammar.js)')

def params(l, k):
    out = set()
    for a in parsed.get((l, k)) or []:
        for name, _, _ in a or []: out.add(name)
    return out

for l, d in langs.items():
    if l == BASE: continue
    for k in base:
        if is_meta(k, base): continue
        if k not in d: err(f'{l}.json: missing "{k}"'); continue
        if isinstance(base[k], list) != isinstance(d[k], list): err(f'{l}.json: "{k}" is a {"list" if isinstance(base[k], list) else "text"} in {BASE}.json')
        elif params(BASE, k) != params(l, k): err(f'{l}.json: "{k}" has the parameters {sorted(params(l, k))}, {BASE}.json {sorted(params(BASE, k))}')
        elif isinstance(base[k], str) and tags(base[k]) != tags(d[k]): err(f'{l}.json: "{k}" has other markup than {BASE}.json ({tags(d[k])} / {tags(base[k])})')
    for k in d:
        if k not in base and not is_meta(k, d): err(f'{l}.json: "{k}" is not in {BASE}.json (the base: add it there first)')


# ---------- keys used in the code and in the HTML ----------
def files():
    yield os.path.join(ROOT, 'index.html')
    for dirpath, _, names in os.walk(os.path.join(ROOT, 'src')):
        for n in names:
            if n.endswith('.js'): yield os.path.join(dirpath, n)

used = {}
CALL = re.compile(r'\b(?:t|tHtml|tList)\(\s*([\'"])([^\'"\\]+)\1\s*[,)]')   # (a whole literal: 'lang.' + id is built)
ATTR = re.compile(r'data-i18n(?:-html)?\s*=\s*"([^"]+)"|(?:dataset\.i18n(?:Html)?)\s*=\s*([\'"])([^\'"]+)\2')
ATTR_PAIRS = re.compile(r'data-i18n-attr\s*=\s*"([^"]+)"|dataset\.i18nAttr\s*=\s*([\'"])([^\'"]+)\2')
IMPORTS_T = re.compile(r'import\s*\{[^}]*\b(?:t|tHtml|tList)\b[^}]*\}\s*from\s*[\'"][./]*i18n\.js[\'"]')
LIBRARY = {os.path.join(ROOT, 'src', 'i18n.js'), os.path.join(LANG_DIR, 'grammar.js')}   # (their comments show examples)
for path in files():
    if path in LIBRARY: continue
    with open(path, encoding='utf-8') as f: src = f.read()
    rel = os.path.relpath(path, ROOT)
    found = []
    if path.endswith('.js') and IMPORTS_T.search(src): found += [m.group(2) for m in CALL.finditer(src)]
    found += [m.group(1) or m.group(3) for m in ATTR.finditer(src)]
    for m in ATTR_PAIRS.finditer(src):
        for pair in (m.group(1) or m.group(3)).split(';'):
            # (applyDom skips a pair without "attribute:key": that attribute would stay untranslated for good)
            if not re.fullmatch(r'\s*[a-zA-Z][\w-]*\s*:\s*\S+\s*', pair): err(f'{rel}: data-i18n-attr "{pair}" is not "attribute:key"'); continue
            found.append(pair.split(':', 1)[1].strip())
    for k in found:
        used.setdefault(k, rel)
        if k not in base: err(f'{rel}: uses "{k}", which is not in {BASE}.json')

# The early script of index.html chooses the language like i18n.js: the languages and the automatic list have to be
# the same
with open(os.path.join(ROOT, 'index.html'), encoding='utf-8') as f: html = f.read()
with open(os.path.join(ROOT, 'src', 'i18n.js'), encoding='utf-8') as f: i18n_src = f.read()
m1, m2 = re.search(r'\bLANGS = (\[[^\]]*\])', html), re.search(r'export const LANGS = \{([^}]*)\}', i18n_src)
if not m1 or not m2: err('cannot find LANGS (the early script of index.html, or src/i18n.js)')
else:
    early, game_langs = re.findall(r"'(\w+)'", m1.group(1)), re.findall(r'(\w+)\s*:', m2.group(1))
    if early != game_langs: err(f'index.html LANGS {early} is not LANGS {game_langs} of src/i18n.js')
    for l in game_langs:
        if l not in langs: err(f'LANGS has "{l}", which has no src/lang/{l}.json')
m1, m2 = re.search(r'const AUTO = (\[[^\]]*\])', html), re.search(r'export const AUTO_LANGS = (\[[^\]]*\])', i18n_src)
if not m1 or not m2: err('cannot find AUTO (index.html) or AUTO_LANGS (src/i18n.js)')
elif re.findall(r"'(\w+)'", m1.group(1)) != re.findall(r"'(\w+)'", m2.group(1)): err(f'index.html AUTO {m1.group(1)} is not AUTO_LANGS {m2.group(1)} of src/i18n.js')
for l in re.findall(r"'(\w+)'", m2.group(1) if m2 else ''):
    if l not in langs: err(f'AUTO_LANGS has "{l}", which has no src/lang/{l}.json')


# ---------- --unused: keys no literal uses ----------
if '--unused' in sys.argv:
    unused = [k for k in base if not is_meta(k, base) and k not in used]
    notes.append(f'{len(unused)} keys of {BASE}.json not used by any literal (built from ids?): ' + ', '.join(unused[:60]) + (' …' if len(unused) > 60 else ''))


# ---------- --strict: Spanish text left in the code ----------
def js_strings(src):
    """The string literals of a JavaScript file (rough lexer: comments, quotes, templates, regular expressions)."""
    out, i, n, depth, prev = [], 0, len(src), [], ''
    while i < n:
        c = src[i]
        if c == '/' and src.startswith('//', i): i = src.find('\n', i); i = n if i < 0 else i; continue
        if c == '/' and src.startswith('/*', i): i = src.find('*/', i + 2); i = n if i < 0 else i + 2; continue
        if c == '/' and (prev in '' or prev in '(,=:[!&|?{};+-*%<>~^' ):
            j = i + 1; cls = False
            while j < n and (src[j] != '/' or cls) and src[j] != '\n':
                if src[j] == '\\': j += 1
                elif src[j] == '[': cls = True
                elif src[j] == ']': cls = False
                j += 1
            i = j + 1; prev = 'x'; continue
        if c in '\'"`':
            j, buf = i + 1, []
            while j < n and src[j] != c:
                if src[j] == '\\': buf.append(src[j:j + 2]); j += 2; continue
                if c == '`' and src.startswith('${', j):   # (the expression inside goes back to code: skip it roughly)
                    level, j = 1, j + 2
                    while j < n and level:
                        level += {'{': 1, '}': -1}.get(src[j], 0); j += 1
                    buf.append('{}'); continue
                if c != '`' and src[j] == '\n': break
                buf.append(src[j]); j += 1
            out.append((src.count('\n', 0, i) + 1, ''.join(buf)))
            i = j + 1; prev = 'x'; continue
        if not c.isspace(): prev = c if c in '(,=:[!&|?{};+-*%<>~^' else 'x'
        i += 1
    return out

SPANISH = re.compile(r'[áéíóúñ¿¡ÁÉÍÓÚÑ]|\b(?:de|del|la|las|el|los|que|para|una|con|por|está|tu|tus|se|ya|hay)\s', re.I)
if '--strict' in sys.argv:
    total = 0
    for path in files():
        if not path.endswith('.js') or path.startswith(LANG_DIR): continue
        with open(path, encoding='utf-8') as f: src = f.read()
        hits = [(ln, s) for ln, s in js_strings(src) if SPANISH.search(s) and ' ' in s.strip()]
        if hits:
            total += len(hits)
            rel = os.path.relpath(path, ROOT)
            notes.append(f'{rel}: {len(hits)} texts in Spanish, e.g. ' + ' | '.join(f'l.{ln} "{s[:50]}"' for ln, s in hits[:3]))
    if total: err(f'--strict: {total} texts in Spanish left in the code (they should go through t(): see docs/i18n.md)')


for x in notes: print('note:', x)
for x in errors: print('ERROR:', x)
keys = sum(1 for k in base if not is_meta(k, base))
print(f'i18n: {keys} keys in {BASE}.json, languages: {", ".join(langs)}; {len(used)} keys used literally; ' + (f'{len(errors)} errors' if errors else 'all good'))
sys.exit(1 if errors else 0)

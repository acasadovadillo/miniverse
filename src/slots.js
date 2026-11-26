// Single-player games («partidas individuales»): each one is a character with its own world (the same map, from scratch),
// kept apart from the shared world and from each other. An account may have several.
//
// Each game is one sealed record of its own (sealed like the account's file, with the account's key: vault.js), in this
// browser (IndexedDB 'vaults', key '<account>#slot:<id>') and on GitHub ('<account>-slot-<id>.enc'), and a small sealed index
// says what the menu shows of each one ('<account>#slots', '<account>-slots.enc'). The account's own file (the character of
// the shared world) does not carry them: it does not grow with every world, and an old version of the game, which rewrites
// that file keeping only the fields it knows, cannot lose them.
// The local world of before (data.local of the account's file, «Jugar en local») becomes one of these games by itself, and is
// left where it was: an old version still finds it. If an old version plays it again, the next login brings that in too.
//
// io: { db: { get, put, del } (src/db.js), getFile(account, path), putFile(account, path, bytes, message, sha), deleteFile(account,
// path), onUpload(error or null) }: the tests give their own (no GitHub). The account: { id, key, salt, name, token }
import { seal, unseal } from './vault.js';

export const slotFile = (acc, id) => `${acc}-slot-${id}.enc`;
export const indexFile = acc => `${acc}-slots.enc`;
const slotKey = (acc, id) => `${acc}#slot:${id}`;
const indexKey = acc => `${acc}#slots`;
const UPLOAD_EVERY = 3 * 60 * 1000;   // at most one automatic upload of a game every 3 minutes (as the account's file)
const RETRY_AFTER = 60 * 1000;        // after a failed upload, what is waited before trying again by itself
const FORMAT = 'miniverse-partida', INDEX_FORMAT = 'miniverse-partidas';
const emptyIndex = () => ({ format: INDEX_FORMAT, version: 1, slots: {}, removed: {}, migrated: null });
export const newSlotId = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 6);

// What the menu shows of a game, taken from its save: the character (name, looks, clothes), the coins and its world's calendar
export function cardOf(save) {
  const p = save?.player || {};
  // (a new game starts with 100 coins: game.js start)
  return { player: { name: p.name || '', look: p.look || {} }, inventory: { equip: save?.inventory?.equip || {} }, money: Number.isFinite(save?.money) ? save.money : 100,
    dayBase: save?.dayBase, timeShift: save?.timeShift || 0, savedAt: save?.savedAt || 0 };
}

// Two indexes into one: per game, the newer entry (at: when it was last changed); a game removed on either side stays removed
export function mergeIndex(a, b) {
  const out = emptyIndex();
  for (const x of [a, b]) {
    if (!x) continue;
    for (const [id, at] of Object.entries(x.removed || {})) out.removed[id] = Math.max(out.removed[id] || 0, at);
    for (const [id, s] of Object.entries(x.slots || {})) if (!out.slots[id] || (s.at || 0) > (out.slots[id].at || 0)) out.slots[id] = s;
    if (x.migrated && (!out.migrated || x.migrated.from > out.migrated.from)) out.migrated = x.migrated;
  }
  for (const id of Object.keys(out.removed)) delete out.slots[id];
  return out;
}

export function makeSlots(io) {
  let acc = null, index = emptyIndex(), indexSha, indexBroken = false, remoteKnown = false;   // remoteKnown: GitHub's index has been read (or there is none)
  const sha = new Map(), uploadedAt = new Map(), dirty = new Set();
  let failedAt = 0, queue = Promise.resolve();
  // (one thing at a time: an autosave does not cross the save of quitting. Each step keeps the account it was asked with)
  const run = fn => (queue = queue.then(fn, fn));

  const readLocal = async (a, key) => {
    const r = await io.db.get('vaults', key).catch(() => null);
    if (!r?.bytes) return null;
    return unseal(r.bytes instanceof Uint8Array ? r.bytes : new Uint8Array(r.bytes), a.key, a.salt).catch(() => null);
  };
  // { data, sha, broken }: what GitHub has (data null if there is none; broken: there is, and it does not open)
  const readRemote = async (a, path) => {
    const f = await io.getFile(a, path);
    if (!f) return { data: null, sha: null, broken: false };
    try { return { data: await unseal(f.bytes, a.key, a.salt), sha: f.sha, broken: false }; } catch { return { data: null, sha: f.sha, broken: true }; }
  };
  async function writeIndex(a, upload) {
    const bytes = await seal(a.key, a.salt, index);
    await io.db.put('vaults', { bytes, savedAt: Date.now() }, indexKey(a.id)).catch(() => {});
    if (!upload || indexBroken) return;
    // (another computer may have changed it meanwhile: what it has is merged in first, every time, so that neither loses a game)
    const r = await readRemote(a, indexFile(a.id));
    if (r.broken) { indexBroken = true; return; }
    if (r.data?.format === INDEX_FORMAT) {
      const merged = mergeIndex(index, r.data);
      if (JSON.stringify(merged) !== JSON.stringify(index)) { index = merged; await io.db.put('vaults', { bytes: await seal(a.key, a.salt, index), savedAt: Date.now() }, indexKey(a.id)).catch(() => {}); }
    }
    indexSha = await io.putFile(a, indexFile(a.id), await seal(a.key, a.salt, index), `Partidas de ${a.name || a.id}`, r.sha);
    remoteKnown = true;
  }
  // Seals a game and keeps it here; to GitHub if asked, or if it has been a while (returns { local, remote } as Profile.persist)
  async function writeSlot(a, id, record, upload) {
    const bytes = await seal(a.key, a.salt, record);
    let local = true;
    try { await io.db.put('vaults', { bytes, savedAt: record.save?.savedAt || Date.now() }, slotKey(a.id, id)); } catch { local = false; }
    dirty.add(id);
    const now = Date.now();
    if (!upload && !(now - (uploadedAt.get(id) || 0) > UPLOAD_EVERY && now - failedAt > RETRY_AFTER)) { await writeIndex(a, false); return { local, remote: null }; }
    try {
      sha.set(id, await io.putFile(a, slotFile(a.id, id), bytes, `Partida individual de ${a.name || a.id}`, sha.has(id) ? sha.get(id) : undefined));
      uploadedAt.set(id, Date.now()); dirty.delete(id);
      await writeIndex(a, true);
      io.onUpload?.(null);
      return { local, remote: true };
    } catch (e) { sha.delete(id); failedAt = Date.now(); io.onUpload?.(e); await writeIndex(a, false); return { local, remote: false, error: e }; }
  }
  const entry = (id, save, title) => ({ id, title: title || '', card: cardOf(save), savedAt: save?.savedAt || 0, at: Date.now() });

  const api = {
    get account() { return acc?.id || null; },
    // At login: the index of this browser and GitHub's, merged. Without GitHub (offline), this browser's
    open(a) {
      return run(async () => {
        acc = a; index = emptyIndex(); indexSha = undefined; indexBroken = false; remoteKnown = false; sha.clear(); uploadedAt.clear(); dirty.clear(); failedAt = 0;
        const here = await readLocal(a, indexKey(a.id));
        let there = null;
        try { const r = await readRemote(a, indexFile(a.id)); there = r.data; indexBroken = r.broken; indexSha = r.sha; remoteKnown = !r.broken; } catch (e) { console.warn('Partidas individuales:', e.message); }
        if (acc !== a) return;
        index = mergeIndex(here?.format === INDEX_FORMAT ? here : null, there?.format === INDEX_FORMAT ? there : null);
        if (here && there && JSON.stringify(here) !== JSON.stringify(index)) await writeIndex(a, false);
      });
    },
    close() { acc = null; index = emptyIndex(); indexSha = undefined; sha.clear(); uploadedAt.clear(); dirty.clear(); },
    // [{ id, title, card, savedAt }], the last played first
    list() { return Object.values(index.slots).sort((x, y) => (y.savedAt || 0) - (x.savedAt || 0)); },
    get(id) { return index.slots[id] || null; },
    // A new game: the save of a character just made, in a world from scratch. Its id. upload: false, only here for now (it goes
    // up with its first save)
    create(save, { upload = true } = {}) {
      const a = acc, id = newSlotId();
      return run(async () => {
        if (!a || acc !== a) throw new Error('no account');
        const s = { ...save, savedAt: Date.now() };
        index.slots[id] = entry(id, s);
        if (!upload) uploadedAt.set(id, Date.now());
        await writeSlot(a, id, { format: FORMAT, version: 1, id, save: s, deltas: [] }, upload);
        return id;
      });
    },
    // Opens one: { save, deltas (a Map) }, the newer of this browser's and GitHub's. If neither opens, it throws
    load(id) {
      const a = acc;
      return run(async () => {
        if (!a || acc !== a || !index.slots[id]) throw new Error('no such game');
        const here = await readLocal(a, slotKey(a.id, id));
        // (if GitHub cannot be asked, it throws: this browser's copy may be older than another computer's, and would go up over it)
        const r = await readRemote(a, slotFile(a.id, id)), there = r.data, why = r.broken ? 'broken' : null;
        sha.set(id, r.sha);
        const best = [here, there].filter(d => d?.format === FORMAT && d.save).sort((x, y) => (y.save.savedAt || 0) - (x.save.savedAt || 0))[0];
        if (!best) throw new Error(why === 'broken' ? 'damaged' : 'missing');
        return { save: best.save, deltas: new Map(best.deltas || []) };
      });
    },
    // Saves the game being played (savedAt: now)
    store(id, save, deltas, { upload = false } = {}) {
      const a = acc;
      return run(async () => {
        if (!a || acc !== a || !index.slots[id]) return { local: false, remote: null };   // (logged out meanwhile: it was saved on quitting)
        const s = { ...save, savedAt: Date.now() };
        index.slots[id] = entry(id, s, index.slots[id].title);
        return writeSlot(a, id, { format: FORMAT, version: 1, id, save: s, deltas: [...deltas] }, upload);
      });
    },
    // Its name in the list ('' : the character's)
    rename(id, title) {
      const a = acc;
      return run(async () => {
        const s = index.slots[id];
        if (!a || acc !== a || !s) return false;
        index.slots[id] = { ...s, title: String(title || '').trim().slice(0, 40), at: Date.now() };
        try { await writeIndex(a, true); } catch (e) { io.onUpload?.(e); }
        return true;
      });
    },
    // Removes one: from the index (marked removed, so that another computer does not bring it back), from this browser and from
    // GitHub (git's history still has it). Only that one
    remove(id) {
      const a = acc;
      return run(async () => {
        if (!a || acc !== a || !index.slots[id]) return false;
        delete index.slots[id];
        index.removed[id] = Date.now();
        await io.db.del('vaults', slotKey(a.id, id)).catch(() => {});
        try { await writeIndex(a, true); await io.deleteFile(a, slotFile(a.id, id)); } catch (e) { io.onUpload?.(e); }
        sha.delete(id); dirty.delete(id); uploadedAt.delete(id);
        return true;
      });
    },
    // The local world of before (data.local: { save, deltas }) as a game: the first time, a new one; if an old version has
    // played it since, that game goes on with it (or, if this version has played that game too, another one: nothing is lost)
    migrate(local) {
      const a = acc;
      return run(async () => {
        const from = local?.save?.savedAt;
        if (!a || acc !== a || !local?.save?.player || !Number.isFinite(from)) return null;
        const m = index.migrated;
        if (m && m.from >= from) return null;
        if (!remoteKnown) return null;   // (without GitHub's index it is not known whether it was brought in already: the next login)
        const before = m && index.slots[m.slot];
        let id = before && (before.savedAt || 0) <= m.from ? m.slot : 'l' + from.toString(36);
        if (id !== m?.slot && index.removed[id]) return null;   // (this one was brought in, and then removed)
        // (another computer did it: if its index did not get there, the game is put in this one)
        if (id !== m?.slot) {
          const there = index.slots[id] ? null : await readRemote(a, slotFile(a.id, id));
          if (index.slots[id] || there.sha) {
            if (there?.data?.save) index.slots[id] = entry(id, there.data.save);
            index.migrated = { from, slot: id };
            await writeIndex(a, !!there?.data);
            return null;
          }
        }
        const s = { ...local.save };
        index.slots[id] = entry(id, s, before?.title);
        index.migrated = { from, slot: id };
        await writeSlot(a, id, { format: FORMAT, version: 1, id, save: s, deltas: local.deltas || [] }, true);
        return id;
      });
    },
    whenIdle: () => queue,
  };
  return api;
}

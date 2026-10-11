// Where the app keeps its data on this device. IndexedDB where the browser offers it: it has
// far more room than localStorage, which Safari caps at about 5 MB. localStorage otherwise
// (some private modes, and Node in the tests), as before.
//
// A slot holds one value under one key (the whole dataset, the sync bookkeeping). The first
// time a slot loads from IndexedDB it copies the value over from its old localStorage key,
// reads it back, and marks the copy as moved; the old copy stays untouched as a fallback.
// Saves are batched and written shortly after; flushAll() writes them at once (the app calls
// it when it goes to the background). Failed saves are reported through onProblem().

const DB = 'gt';
const STORE = 'kv';
// Some iOS versions never answer the first open; carry on with localStorage then.
const OPEN_TIMEOUT = 4000;

let opening = null;
const slots = [];
const failing = new Map(); // key -> error
const listeners = new Set();

function openDb() {
  opening ||= new Promise((resolve) => {
    if (typeof indexedDB === 'undefined') return resolve(null);
    const timer = setTimeout(() => resolve(null), OPEN_TIMEOUT);
    const done = (db) => { clearTimeout(timer); resolve(db); };
    let req;
    try { req = indexedDB.open(DB, 1); } catch { return done(null); }
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => done(req.result);
    req.onerror = () => done(null);
    req.onblocked = () => done(null);
  });
  return opening;
}

function run(db, mode, fn) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, mode);
    const req = fn(tx.objectStore(STORE));
    tx.oncomplete = () => resolve(req.result);
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error || new Error('IndexedDB write aborted'));
  });
}

function report(key, error) {
  const had = failing.has(key);
  if (error) failing.set(key, error); else failing.delete(key);
  if (had !== !!error) listeners.forEach((fn) => fn(problem()));
}

// The last save that failed and has not succeeded since, or null.
export const problem = () => (failing.size ? [...failing.values()][0] : null);
export function onProblem(fn) { listeners.add(fn); return () => listeners.delete(fn); }

export function flushAll() { return Promise.all(slots.map((s) => s.flush())); }

export function slot(key, legacyKey, { delay = 400 } = {}) {
  const movedKey = `${legacyKey}.moved`;
  let db = null;
  let loaded = false;
  let value = null;
  let dirty = false;
  let timer = null;
  let writing = Promise.resolve();

  const readLegacy = () => {
    try {
      const raw = localStorage.getItem(legacyKey);
      return raw ? JSON.parse(raw) : null;
    } catch (e) { console.warn('load failed', e); return null; }
  };

  function writeLegacy(v) {
    try {
      if (v == null) localStorage.removeItem(legacyKey); else localStorage.setItem(legacyKey, JSON.stringify(v));
      report(key, null);
    } catch (e) {
      console.warn('save failed', e);
      report(key, e);
    }
  }

  function flush() {
    clearTimeout(timer);
    if (!dirty || !db) return writing;
    dirty = false;
    const v = value;
    // put() copies the value right away, so later changes don't leak into this write.
    writing = run(db, 'readwrite', (s) => (v == null ? s.delete(key) : s.put(v, key)))
      .then(() => report(key, null), (e) => {
        console.warn('save failed', e);
        dirty = true;
        report(key, e);
      });
    return writing;
  }

  const s = {
    // The old localStorage copy has been moved to IndexedDB.
    moved() { try { return !!localStorage.getItem(movedKey); } catch { return false; } },
    readLegacy,
    // The saved value (null if none). After this, saves go to IndexedDB if it works.
    async load() {
      const opened = await openDb();
      if (opened) {
        try {
          let v = await run(opened, 'readonly', (st) => st.get(key));
          if (v === undefined) {
            const legacy = readLegacy();
            if (legacy != null) {
              await run(opened, 'readwrite', (st) => st.put(legacy, key));
              v = await run(opened, 'readonly', (st) => st.get(key));
              if (v === undefined) throw new Error('copy to IndexedDB failed');
            }
          }
          if (v !== undefined) { try { localStorage.setItem(movedKey, String(Date.now())); } catch { /* not kept */ } }
          db = opened;
          loaded = true;
          if (dirty) { flush(); return value; }
          return v ?? null;
        } catch (e) {
          console.warn('IndexedDB unavailable, using localStorage', e);
        }
      }
      loaded = true;
      if (dirty) { dirty = false; writeLegacy(value); return value; }
      return readLegacy();
    },
    save(v) {
      value = v;
      // Before loading, a moved slot must not overwrite its fallback copy: keep the value
      // for after load().
      if (!db && !loaded && s.moved()) { dirty = true; return; }
      if (!db) { writeLegacy(v); return; }
      dirty = true;
      clearTimeout(timer);
      timer = setTimeout(flush, delay);
    },
    flush,
  };
  slots.push(s);
  return s;
}

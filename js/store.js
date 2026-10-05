// Local-first data store. Everything lives in localStorage on this device; the collections
// mirror the spec's data model (words, mistakes, reviewItems, reviews) plus the learner's
// languages and levels. Words, mistakes and reviews carry a `lang` (none means German). When
// the user signs in, sync.js mirrors each record to Firestore, using updatedAt to decide
// which copy is newer.
import { dayStart, addDays } from './srs.js';
import { describe, recLang, lemmaOf, catKey } from './languages.js';

const DATA_KEY = 'gt.data.v1';
const KEY_KEY = 'gt.apiKey';
const SETTINGS_KEY = 'gt.settings.v1';

const DEFAULT_SETTINGS = { lang: 'de', model: 'gemini-flash-latest', newPerDay: 8, newSentencesPerDay: 3, newMistakesPerDay: 4 };

let data = load();
let settings = loadSettings();
const listeners = new Set();

function emptyData() {
  return { words: [], mistakes: [], reviewItems: [], reviews: [], languages: [] };
}

function load() {
  try {
    const raw = localStorage.getItem(DATA_KEY);
    if (raw) return { ...emptyData(), ...JSON.parse(raw) };
  } catch (e) { console.warn('load failed', e); }
  return emptyData();
}

function loadSettings() {
  try {
    return { ...DEFAULT_SETTINGS, ...JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}') };
  } catch { return { ...DEFAULT_SETTINGS }; }
}

// remote: the change came from the server, so the sync layer has nothing to upload.
function persist({ remote = false } = {}) {
  localStorage.setItem(DATA_KEY, JSON.stringify(data));
  listeners.forEach((fn) => fn({ remote }));
}

// A strictly increasing edit time, so an edit always counts as newer than the last sync.
function touch(rec, now = Date.now()) {
  rec.updatedAt = Math.max(now, (rec.updatedAt || 0) + 1);
}

export function onChange(fn) { listeners.add(fn); return () => listeners.delete(fn); }

export const uid = () =>
  (crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2));

// ---- settings and key ----
export function getSettings() { return settings; }
export function setSettings(patch) {
  settings = { ...settings, ...patch };
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
}
export function getApiKey() { return localStorage.getItem(KEY_KEY) || ''; }
export function setApiKey(k) {
  if (k) localStorage.setItem(KEY_KEY, k.trim()); else localStorage.removeItem(KEY_KEY);
}

// ---- languages ----
// The active language is chosen per device; levels and added languages sync with the account.
export function language(code) {
  return describe(code, data.languages.find((l) => l.id === code));
}

export function knownLanguages() {
  const codes = ['de', 'ja', ...data.languages.map((l) => l.id)];
  return [...new Set(codes)].map(language).filter(Boolean);
}

export function activeLanguage() {
  const code = settings.target;
  if (code && language(code)) return language(code);
  // Data from before languages existed is German.
  if ([...data.words, ...data.mistakes].some((r) => !r.lang)) return language('de');
  if (data.languages.length) return language(data.languages[0].id);
  if (data.words.length) return language(recLang(data.words[0]));
  return null;
}

export function setActiveLanguage(code) { setSettings({ target: code }); }

// Saves a language's level, or a whole added language.
export function saveLanguage(code, patch, now = Date.now()) {
  let rec = data.languages.find((l) => l.id === code);
  if (!rec) {
    rec = { id: code, createdAt: now };
    data.languages.push(rec);
  }
  Object.assign(rec, patch);
  touch(rec, now);
  persist();
  return language(code);
}

// ---- words ----
export function words(code) { return code ? data.words.filter((w) => recLang(w) === code) : data.words; }
export function getWord(id) { return data.words.find((w) => w.id === id); }

// Finds a saved word by its dictionary form, ignoring a leading article of that language.
export function findWord(lemma, code = 'de', articles = code === 'de' ? ['der', 'die', 'das'] : []) {
  const key = normKey(lemma, articles);
  if (!key) return null;
  return data.words.find((w) => recLang(w) === code && normKey(lemmaOf(w), articles) === key) || null;
}

export function normKey(s, articles = []) {
  let k = (s || '').normalize('NFKC').toLowerCase().trim();
  for (const a of articles) {
    const p = a.toLowerCase();
    if (k.startsWith(`${p} `)) { k = k.slice(p.length + 1).trim(); break; }
  }
  return k;
}

export function addWord(fields, now = Date.now()) {
  fields = { ...fields, lang: fields.lang || 'de' };
  const existing = findWord(fields.lemma, fields.lang, language(fields.lang)?.articles);
  if (existing) {
    // Keep the first capture but fill gaps (for example a context sentence found later).
    for (const [k, v] of Object.entries(fields)) {
      if (v && !existing[k]) existing[k] = v;
    }
    touch(existing, now);
    persist();
    return { word: existing, created: false };
  }
  const word = {
    id: uid(), lang: 'de', lemma: '', article: '', reading: '', pos: 'other', meaning: '', plural: '',
    verbForms: '', forms: '', recallAnswer: '', register: '', example: '', exampleTranslation: '',
    contextSentence: '', gapSentence: '', gapAnswer: '', source: 'lookup', ...fields, addedAt: now, updatedAt: now,
  };
  data.words.unshift(word);
  ensureReviewItem('word', word.id, now);
  persist();
  return { word, created: true };
}

// Saves a translated sentence (from gemini.translateSentence) as a learnable item.
export function addSentence(r, code, source = 'translate', now = Date.now()) {
  return addWord({
    kind: 'sentence', lang: code, lemma: (r.sentence || '').trim(), reading: r.reading || '', pos: 'sentence',
    meaning: r.translation || '', tone: r.tone || 'everyday', toneNote: r.toneNote || '',
    chunks: (r.chunks || []).filter(Boolean), gapSentence: r.gapSentence || '', gapAnswer: r.gapAnswer || '',
    keyWords: (r.keyWords || []).filter((k) => k && k.lemma).slice(0, 4), query: r.query || '', source,
    furigana: r.furigana || [],
  }, now);
}

export function updateWord(id, patch) {
  const w = getWord(id);
  if (!w) return;
  Object.assign(w, patch);
  // An edit saves the dictionary form under its new name.
  if ('lemma' in patch) delete w.german;
  touch(w);
  persist();
}

export function deleteWord(id) {
  data.words = data.words.filter((w) => w.id !== id);
  const items = data.reviewItems.filter((r) => r.itemType === 'word' && r.itemId === id).map((r) => r.id);
  data.reviewItems = data.reviewItems.filter((r) => !items.includes(r.id));
  persist();
}

// ---- mistakes ----
export function mistakes(code) { return code ? data.mistakes.filter((m) => recLang(m) === code) : data.mistakes; }
export function getMistake(id) { return data.mistakes.find((m) => m.id === id); }

export function addMistakes(list, source, code = 'de', now = Date.now()) {
  const added = [];
  for (const m of list) {
    const mistake = {
      id: uid(), lang: code, original: m.original || '', corrected: m.corrected || '',
      explanation: m.explanation || '', category: m.category || 'other',
      fullSentence: m.sentence || '', correctedSentence: m.correctedSentence || '',
      source, createdAt: now, updatedAt: now,
    };
    data.mistakes.unshift(mistake);
    // Each mistake becomes a "fix your past sentence" drill, and its category gets a
    // drill slot of its own the first time it shows up.
    // Mistakes made inside drills only count toward drill accuracy, so drills don't
    // spawn more drills.
    if (source !== 'drill' && mistake.fullSentence && mistake.correctedSentence) {
      ensureReviewItem('mistake', mistake.id, now);
    }
    if (mistake.category !== 'other') ensureReviewItem('category', catKey(code, mistake.category), now);
    added.push(mistake);
  }
  persist();
  return added;
}

// ---- review items and reviews ----
export function reviewItems() { return data.reviewItems; }
export function reviews(code) { return code ? data.reviews.filter((r) => recLang(r) === code) : data.reviews; }

export function reviewItemFor(itemType, itemId) {
  return data.reviewItems.find((r) => r.itemType === itemType && r.itemId === itemId);
}

function ensureReviewItem(itemType, itemId, now) {
  if (reviewItemFor(itemType, itemId)) return;
  data.reviewItems.push({
    // One id per target, so two devices adding the same grammar category agree on it.
    id: `${itemType}:${itemId}`, itemType, itemId, exerciseType: null,
    // New items can be practised the day they are added (the daily cap still applies).
    due: dayStart(now), interval: 0, ease: 2.5, reps: 0, lapses: 0,
    introducedAt: null, createdAt: now, updatedAt: now,
  });
}

export function saveReview(item, review) {
  const idx = data.reviewItems.findIndex((r) => r.id === item.id);
  if (idx >= 0) {
    touch(item);
    data.reviewItems[idx] = item;
  }
  data.reviews.push({ id: uid(), ...review, updatedAt: Date.now() });
  persist();
}

// ---- backup ----
export function exportData() {
  return JSON.stringify({ app: 'german-trainer', version: 1, exportedAt: new Date().toISOString(), ...data }, null, 2);
}

export function importData(json) {
  const parsed = JSON.parse(json);
  if (!Array.isArray(parsed.words) || !Array.isArray(parsed.mistakes)) throw new Error('Not a German Trainer backup');
  data = { ...emptyData(), words: parsed.words, mistakes: parsed.mistakes,
    reviewItems: parsed.reviewItems || [], reviews: parsed.reviews || [], languages: parsed.languages || [] };
  // An imported backup replaces what is here, so it must also win over the synced copies.
  const now = Date.now();
  for (const list of Object.values(data)) list.forEach((r) => touch(r, now));
  persist();
  return { words: data.words.length, mistakes: data.mistakes.length };
}

export function resetData() {
  data = emptyData();
  persist();
}

// ---- sync ----
// The live data object, for sync.js to diff and merge into. Call commitRemote() after
// changing it so the UI hears about it without the change being uploaded again.
export function rawData() { return data; }
export function commitRemote() { persist({ remote: true }); }

// Test hook: replace in-memory data without touching storage semantics.
export function _setData(d) { data = { ...emptyData(), ...d }; persist(); }

// The language being learnt and whether Gemini can be used, as every screen sees them.
import * as store from '../store.js';
import { t, lang } from '../i18n.js';
import { canUseGemini } from '../gemini.js';
import { categoriesFor, drillableIds } from '../categories.js';
import { catKey, parseCatKey, displayName } from '../languages.js';
import { chunksFor } from '../check.js';

export const gem = () => canUseGemini();

// The language being learnt (null until one is chosen) and its name in the interface language.
export const L = () => store.activeLanguage();
export const code = () => L()?.code || 'de';
export const langName = (x = L()) => displayName(x, lang());
export const cats = (x = L()) => categoriesFor(x);

// Why a feature that needs Gemini can't run right now.
export const noGemini = () => t(store.getApiKey() ? 'err.offline' : 'err.noKey');

// Everything the session needs, limited to the active language.
export function sessionArgs() {
  const c = code();
  const words = store.words(c);
  const mistakes = store.mistakes(c);
  const wordIds = new Set(words.map((w) => w.id));
  const items = store.reviewItems().filter((r) => (r.itemType === 'word' ? wordIds.has(r.itemId)
    : r.itemType === 'mistake' ? false : parseCatKey(r.itemId).lang === c));
  return {
    items, words, mistakes, reviews: store.reviews(c), settings: store.getSettings(),
    gemini: gem() && !!L()?.level, drillable: drillableIds(cats()).map((id) => catKey(c, id)),
    hasChunks: (w) => !!chunksFor(w),
  };
}

// Screen state kept while the app is open: the running session, the last lookup and
// correction, and the word list search.
export const ui = {
  session: null,
  lastLookup: null,
  lastCorrection: null,
  // After a correction the result comes first; the text collapses to one line until reopened.
  correctOpen: false,
  wordQuery: '',
};

// Forgets screen state that belongs to the previous language.
export function resetViews() {
  ui.session = null;
  ui.lastLookup = null;
  ui.lastCorrection = null;
  ui.correctOpen = false;
  ui.wordQuery = '';
}

// After signing out, the last results belonged to the account.
export function forgetResults() {
  ui.lastLookup = null;
  ui.lastCorrection = null;
}

// A deleted word is no longer shown as the last lookup.
export function forgetWord(id) {
  if (ui.lastLookup?.word.id === id) ui.lastLookup = null;
}

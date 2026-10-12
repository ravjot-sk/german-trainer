// The learner's current choices, as both the screens and the background jobs see them: the
// language being learnt, whether Gemini can be used, and how furigana is shown. No UI code.
import * as store from './store.js';
import { canUseGemini } from './gemini.js';
import { categoriesFor } from './categories.js';

export const gem = () => canUseGemini();

// The language being learnt (null until one is chosen).
export const L = () => store.activeLanguage();
export const code = () => L()?.code || 'de';
export const cats = (x = L()) => categoriesFor(x);

export const furiMode = () => store.getSettings().furigana || 'tap';

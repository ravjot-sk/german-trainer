// UI strings. German is the default; English is a setting. This is the interface language,
// separate from the language being learnt ({l} in strings).
import { getSettings } from './store.js';
import de from './i18n/de.js';
import en from './i18n/en.js';

const STRINGS = { de, en };

export function lang() {
  return getSettings().lang === 'en' ? 'en' : 'de';
}

export function t(key, vars = {}) {
  const s = STRINGS[lang()][key] ?? STRINGS.de[key] ?? key;
  return s.replace(/\{(\w+)\}/g, (_, k) => (vars[k] ?? ''));
}

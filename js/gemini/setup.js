// Describes a language the learner wants to add: its code, how its words are written and
// learnt, and the grammar areas its learners most often get wrong. Called once per language.
// ask/read pair as in words.js; needs no learner context.
import { finishCategories, SKELETON } from '../categories.js';
import { S, STR } from './shared.js';

export const setupLanguage = {
  ask(name) {
    const prompt = `A learner wants to practise this language in a vocabulary and writing app: "${name}".
Describe it for the app. Explanations in the app are in English or German.
If this is not a real language with a written standard, set found to false.

For categories, go through this checklist of grammar areas, which comes from research on
learner errors. For each area that exists in this language, give one category named the way
it is taught for this language (split an area in two when learners of this language treat
the halves as separate topics, e.g. particles vs postpositions). Leave out areas the language
does not have (e.g. articles in a language without them). Then add any area that is central
for learners of this language but missing from the list (e.g. tones, aspect pairs, counters).
Aim for 8 to 16 categories in total.
${SKELETON.map((x) => `- ${x}`).join('\n')}`;
    return { prompt, schema: S({
      found: { type: 'BOOLEAN' },
      code: { type: 'STRING', description: 'ISO 639-1 code, or ISO 639-3 if there is none. Lowercase.' },
      english: { type: 'STRING', description: 'The language name in English.' },
      articles: { type: 'ARRAY', items: STR, description: 'Article forms that show a noun\'s gender or class and that learners memorise with each noun, e.g. ["el", "la"] for Spanish or ["le", "la"] for French. Empty if the language has none.' },
      reading: { type: 'STRING', description: 'If the normal script does not show pronunciation (e.g. Chinese characters), the reading system to store with each word, e.g. "pinyin with tone marks". Otherwise empty.' },
      romanized: { type: 'STRING', description: 'If the language is not written in Latin script, the romanisation learners commonly type, e.g. "pinyin". Otherwise empty.' },
      categories: {
        type: 'ARRAY',
        description: 'The grammar areas where learners of this language make mistakes in writing (see the checklist in the prompt), named for this language. Do not include word choice, register, spelling or "other": the app adds those.',
        items: S({
          id: { type: 'STRING', description: 'Short snake_case English id.' },
          en: { type: 'STRING', description: 'Short English label.' },
          de: { type: 'STRING', description: 'The same label in German.' },
          hint: { type: 'STRING', description: 'A few typical examples in the language.' },
        }),
      },
    }, ['found', 'code', 'english', 'articles', 'reading', 'romanized', 'categories']) };
  },
  read(r, name) {
    if (!r.found || !/^[a-z]{2,3}$/.test((r.code || '').toLowerCase())) return null;
    return {
      code: r.code.toLowerCase(), english: r.english || name,
      articles: (r.articles || []).map((a) => String(a).trim()).filter(Boolean).slice(0, 8),
      reading: r.reading || '', romanized: r.romanized || '',
      categories: finishCategories(r.categories),
    };
  },
};

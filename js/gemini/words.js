// Gemini features for vocabulary: dictionary lookups, suggested words, gap sentences, furigana
// and translations. Each feature is a pair: ask(...) builds { prompt, schema, temperature }
// and read(reply, ...) cleans Gemini's reply. Pure; c is the learner context (see shared.js).
import { wordTitle, cleanExamples, MORE_EXAMPLES } from '../languages.js';
import { parse as parseFurigana } from '../furigana.js';
import { S, STR, GAP_ACCEPTABLE, FURIGANA_RULE, hasFurigana, furiganaOf, collectFurigana, isGerman, levelText, wordProps, gapProps, cleanWord } from './shared.js';

export const lookup = {
  ask({ L }, query, context) {
    const name = L.english;
    const prompt = `You are a ${name} dictionary for a learner at ${levelText(L)} whose working language is English.
Query: "${query}"
${context ? `Context sentence where the learner found it: "${context}"\nUse the sense that fits this context.` : ''}
If the query is English${L.romanized ? ` or ${name} written in ${L.romanized}` : ''}, return the most common ${name} equivalent. If it is an inflected ${name} form, return the dictionary form.
If the query is not a real word in either language, set found to false.`;
    const props = wordProps(L);
    props.moreExamples = {
      type: 'ARRAY', items: S({ text: STR, translation: STR, ...gapProps(L, 'text'), ...(hasFurigana(L) ? { furigana: furiganaOf('text') } : {}) }),
      description: `Exactly ${MORE_EXAMPLES} more natural ${name} example sentences for a learner at ${levelText(L)}, each with its English translation. Each shows the word in a different situation or form than the example and each other.`,
    };
    if (hasFurigana(L) && context) props.contextFurigana = furiganaOf('The context sentence');
    return { prompt, schema: S({ found: { type: 'BOOLEAN' }, ...props }, ['found', ...Object.keys(props)]) };
  },
  read(reply, { L }, query, context) {
    const r = cleanWord(reply);
    const extra = cleanExamples(r.moreExamples, r.example);
    r.moreExamples = extra.map(({ text, translation }) => ({ text, translation }));
    // The gapped extras only seed the word's gap sentences (gappool.poolFromLookup).
    r.moreGaps = extra.map(({ gapSentence, gapAnswer, gapAcceptable, translation }) => ({ gapSentence, gapAnswer, gapAcceptable, translation }));
    if (!hasFurigana(L)) return r;
    collectFurigana(r, [['exampleFurigana', (x) => x.example], ['gapFurigana', (x) => x.gapSentence],
      ['contextFurigana', () => context]]);
    for (const e of extra) if (e.furigana && parseFurigana(e.furigana, e.text)) r.furigana.push(e.furigana);
    return r;
  },
};

// Random words that fit the learner's level, as full dictionary entries like a lookup.
// exclude: dictionary forms the learner already has. topic: optional theme.
export const suggestWords = {
  ask({ L }, n, { topic = '', exclude = [] } = {}) {
    const name = L.english;
    const prompt = `You pick new ${name} vocabulary for a learner at ${levelText(L)} whose working language is English.
Suggest ${n} different words that suit this level: useful words the learner will need to speak and write, not ones every beginner knows and not rare or specialist ones. Mix nouns, verbs, adjectives and a phrase or two.
${topic ? `Topic: "${topic}". All words should fit it.` : 'Vary the topics (work, everyday life, feelings, society, travel, ...).'}
${exclude.length ? `The learner already has these, so do not suggest them: ${exclude.join(', ')}` : ''}
Fill every field for each word as a dictionary entry would.`;
    return { prompt, schema: S({ words: { type: 'ARRAY', items: S(wordProps(L)) } }), temperature: 1 };
  },
  read(r, { L }) {
    return (r.words || []).filter((w) => w && w.lemma).map((w) => {
      cleanWord(w);
      return hasFurigana(L) ? collectFurigana(w, [['exampleFurigana', (x) => x.example], ['gapFurigana', (x) => x.gapSentence]]) : w;
    });
  },
};

// New gap-fill sentences for several words in one call. list: [{ word, level, existing }],
// level 1-3 (1: short everyday sentence, 3: demanding context). Returns one list per word,
// in order: [{ sentence (with ___), answer, translation }].
export const GAP_LEVELS = {
  1: 'short, everyday sentences using the most common form of the word',
  2: 'sentences using a different form, case or tense than the basic one, in a less obvious situation',
  3: 'longer sentences with a subordinate clause or an idiomatic, less common use of the word',
};
export const gapSentences = {
  ask({ L }, list, n = 3) {
    const name = L.english;
    const lines = list.map((x, i) => `${i + 1}. "${wordTitle(x.word)}" (${x.word.meaning}). Difficulty: ${GAP_LEVELS[x.level] || GAP_LEVELS[1]}.${x.existing.length
      ? ` Already used, so write different ones: ${x.existing.map((s) => `"${s}"`).join('; ')}` : ''}`).join('\n');
    const prompt = `Write gap-fill exercises for a ${name} learner at ${levelText(L)}. For each word below write ${n} new, natural ${name} sentences, each showing the word in a different situation, then replace the exact form of the word in the sentence with "___".${isGerman(L) ? ' For separable verbs gap only the verb stem part.' : ''}
Return one entry per word, in the same order.
${lines}`;
    return { prompt, temperature: 0.8, schema: S({
      words: { type: 'ARRAY', items: S({
        sentences: { type: 'ARRAY', items: S({
          sentence: { type: 'STRING', description: 'The sentence with the word replaced by "___".' },
          answer: { type: 'STRING', description: 'The exact text replaced by ___.' },
          acceptable: GAP_ACCEPTABLE,
          translation: { type: 'STRING', description: 'English translation of the full sentence.' },
        }) },
      }) },
    }) };
  },
  read: (r, c, list) => list.map((_, i) => r.words?.[i]?.sentences || []),
};

// Furigana for Japanese texts saved before Gemini added it. Returns the markup for each text
// that came back valid.
export const annotate = {
  ask(c, texts) {
    const prompt = `Add furigana to each of these Japanese texts. For each text, in the same order, ${FURIGANA_RULE}
${texts.map((x, i) => `${i + 1}. ${x}`).join('\n')}`;
    return { prompt, temperature: 0, schema: S({ texts: { type: 'ARRAY', items: STR, description: 'The texts with furigana, same order and count.' } }) };
  },
  read: (r, c, texts) => (r.texts || []).filter((m, i) => texts[i] && parseFurigana(m, texts[i])),
};

// English translations of texts in the language being learnt, in the same order.
export const translateTexts = {
  ask({ L }, texts) {
    const prompt = `Translate each of these ${L.english} texts into natural English, keeping the meaning and tone. Return them in the same order.
${texts.map((x, i) => `${i + 1}. ${x}`).join('\n')}`;
    return { prompt, temperature: 0, schema: S({ translations: { type: 'ARRAY', items: STR, description: 'The English translations, same order and count.' } }) };
  },
  read: (r, c, texts) => texts.map((_, i) => String(r.translations?.[i] || '').trim()),
};

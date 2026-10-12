// Gemini features for grammar practice: drills for a category, exercise sets for a rule, and
// sorting older mistakes into categories and rules. ask/read pairs as in words.js.
import { categoriesFor, categoryGuide, categoryLabel } from '../categories.js';
import { KINDS } from '../rules.js';
import { wordTitle } from '../languages.js';
import { parse as parseFurigana } from '../furigana.js';
import { S, STR, hasFurigana, furiganaOf, collectFurigana, isGerman, levelText, explainLang, ruleProps, ruleRules } from './shared.js';

// Grammar drills for a weak category. kind: gapfill | transform | constraint.
export const generateDrill = {
  ask(c, category, kind, { examples = [], word = null } = {}) {
    const { L } = c;
    const name = L.english;
    const list = categoriesFor(L);
    const label = categoryLabel(category, 'en', list);
    const hint = list.find((x) => x.id === category)?.hint;
    const own = examples.length
      ? `The learner's own past mistakes in this category (use them as inspiration, but do not copy them):\n${examples.map((m) => `- wrote "${m.original}" instead of "${m.corrected}"`).join('\n')}`
      : '';
    const kinds = {
      gapfill: `A single ${name} sentence with exactly one gap written as "___" that tests this category (e.g. ${isGerman(L) ? 'an ending, a preposition, an auxiliary' : 'an ending, a particle, a verb form'}). answer is the exact text for the gap; acceptableAnswers lists other fully correct fillings.`,
      transform: isGerman(L)
        ? 'A transformation task: give one or two German sentences in prompt and an instruction such as combining with "weil", moving to the Perfekt, or switching to indirect speech, so that the result tests this category. answer is the model result sentence.'
        : `A transformation task: give one or two ${name} sentences in prompt and an instruction such as combining them, changing the tense, or changing the politeness level, so that the result tests this category. answer is the model result sentence.`,
      constraint: `A free-writing task: the instruction asks the learner to write one sentence that must use a specific structure from this category${word ? ` and the word "${wordTitle(word)}"` : ''}. prompt may be empty. answer is one model sentence.`,
    };
    const prompt = `Create one ${name} grammar exercise for a learner at ${levelText(L)}.
Category: ${label}${hint ? ` (${hint})` : ''}
Exercise type: ${kinds[kind]}
${own}
Write the instruction in ${explainLang(c)}. Keep sentences natural and everyday (work, travel, friends, news), with vocabulary and grammar that suit the learner's level.`;
    return { prompt, temperature: 0.9, schema: S({
      instruction: STR,
      prompt: { type: 'STRING', description: `${name} sentence(s) shown to the learner; for gapfill it contains ___.` },
      answer: STR,
      acceptableAnswers: { type: 'ARRAY', items: STR },
      explanation: { type: 'STRING', description: `Why the answer is right, in ${explainLang(c)}.` },
      ...(hasFurigana(L) ? { promptFurigana: furiganaOf('prompt (empty if prompt is empty)'), answerFurigana: furiganaOf('answer') } : {}),
    }) };
  },
  read(r, { L }) {
    if (!hasFurigana(L)) return r;
    // A gapfill answer is shown in its sentence afterwards, so the filled sentence gets furigana too.
    const valid = (m, plain) => (m && plain && parseFurigana(m, plain) ? m : '');
    const pm = valid(r.promptFurigana, r.prompt);
    const am = valid(r.answerFurigana, r.answer) || r.answer || '';
    collectFurigana(r, [['promptFurigana', (x) => x.prompt], ['answerFurigana', (x) => x.answer]]);
    if (pm.includes('___')) r.furigana.push(pm.replace('___', am));
    return r;
  },
};

// One set of exercises per rule, one for each rung of the ladder (see rules.js). Each set
// trains the rule itself: new sentences every time, the learner's own mistakes only as a hint
// of what goes wrong. list: [{ rule, examples: [mistake] }]. Returns one set per rule, in order.
export const ruleExercises = {
  ask(c, list) {
    const { L } = c;
    const name = L.english;
    const lines = list.map(({ rule, examples = [] }, i) => `${i + 1}. ${rule.name}${rule.statement ? `: ${rule.statement}` : ''} (category ${categoryLabel(rule.category, 'en', categoriesFor(L))}${rule.level ? `, level ${rule.level}` : ''})${examples.length
      ? `\n   The learner got it wrong like this: ${examples.slice(0, 3).map((m) => `"${m.original}" instead of "${m.corrected}"`).join('; ')}` : ''}`).join('\n');
    const prompt = `Write grammar exercises for a ${name} learner at ${levelText(L)}. Each exercise must train exactly the rule named, in fresh everyday sentences (work, travel, friends, home, news) with vocabulary that suits the learner's level. Never reuse the learner's own sentences.
For each rule below, write one exercise of each kind:
- pair: two versions of the same ${name} sentence that differ only where the rule decides. correct follows the rule, wrong breaks it the way learners do.
- gap: one sentence with "___" exactly where the rule decides (e.g. the auxiliary, the ending, the particle, the comma). answer is the exact text for the gap; acceptable lists other fully correct fillings. If the gap needs a base form to be fair, put it in brackets after the gap, e.g. "___ (passieren)".
- transform: an instruction and 3 short items, each a ${name} sentence or phrase to change (into another tense, into a subordinate clause, into a noun phrase …) so that the result needs the rule. Use different verbs or nouns in each item. answer is the model result, acceptable other correct results.
- spot: a short text of 2 or 3 ${name} sentences with 1 or 2 mistakes against this rule and no other mistakes. corrected is the same text with only those mistakes fixed.
- produce: an instruction to write one new sentence that needs the rule, in a situation the learner has not seen (give the situation and, if useful, a word to use). model is one model sentence.
Write instructions and explanations in ${explainLang(c)}. Give each kind a one-line explanation of the rule as it applies there.

Rules:
${lines}`;
    const alt = { type: 'ARRAY', items: STR };
    return { prompt, temperature: 0.9, schema: S({
      sets: { type: 'ARRAY', items: S({
        pair: S({ correct: STR, wrong: STR, explanation: STR }),
        gap: S({ sentence: { type: 'STRING', description: 'Contains ___ once.' }, answer: STR, acceptable: alt, explanation: STR }),
        transform: S({ instruction: STR, items: { type: 'ARRAY', items: S({ prompt: STR, answer: STR, acceptable: alt }) }, explanation: STR }),
        spot: S({ text: STR, corrected: STR, explanation: STR }),
        produce: S({ instruction: STR, model: STR, explanation: STR }),
      }) },
    }) };
  },
  read(r, c, list) {
    return list.map((_, i) => {
      const set = r.sets?.[i] || {};
      for (const k of KINDS) if (set[k]) set[k].id = `${Date.now().toString(36)}${i}${k}`;
      return set;
    });
  },
};

// Sorts older mistakes into the current categories and gives each its rule. list: mistakes.
// Returns one { category, rule, ruleName, ruleStatement, ruleLevel } per mistake, in order.
export const classifyMistakes = {
  ask(c, list) {
    const { L } = c;
    const cats = categoriesFor(L);
    const prompt = `These are mistakes a ${L.english} learner at ${levelText(L)} made in writing, with their corrections.
For each one, pick its category from this fixed list and name the grammar rule it breaks.
${categoryGuide(cats)}

${ruleRules(c)}

Mistakes:
${list.map((m, i) => `${i + 1}. wrote "${m.original}" instead of "${m.corrected}"${m.fullSentence ? ` in "${m.fullSentence}"` : ''}${m.explanation ? ` (${m.explanation})` : ''}`).join('\n')}`;
    return { prompt, schema: S({
      mistakes: { type: 'ARRAY', items: S({ category: { type: 'STRING', enum: cats.map((x) => x.id) }, ...ruleProps(c) }) },
    }) };
  },
  read: (r, c, list) => list.map((_, i) => r.mistakes?.[i] || null),
};

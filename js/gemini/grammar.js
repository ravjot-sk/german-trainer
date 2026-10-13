// Gemini features for grammar practice: drills for a category, exercise sets for a rule, and
// sorting older mistakes into categories and rules. ask/read pairs as in words.js.
import { categoriesFor, categoryGuide, categoryLabel } from '../categories.js';
import { KINDS, rulePrompt } from '../rules.js';
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

// Exercises for rules, the kinds each rule needs next (see rules.js). Each set trains the
// rule itself, in new sentences. The learner's own wrong sentences are not sent: a small model
// quotes what it is shown, which is how an exercise came to explain a misspelling the learner
// never saw in it (#31). A rule of the learner's own gets its pattern and the corrected
// sentence instead. list: [{ rule, kinds, examples: [correct sentence] }]. Returns one set per
// rule, in order.
const KIND_TEXT = (name) => ({
  pair: `pair: correct follows the rule; wrong is the same ${name} sentence breaking it the way learners do. Nothing else differs.`,
  gap: `gap: write full first (a correct ${name} sentence), then pick answer (the words in full that the rule decides, one connected piece), then sentence: full with answer replaced by ___, everything else exactly as in full, commas included. The gap is where answer stands in full. Optionally the base form in brackets right after the gap.`,
  transform: `transform: an instruction and 3 short items, each a ${name} sentence or phrase to change (another tense, a subordinate clause, a noun phrase …) so that the result needs the rule. Different verbs or nouns in each item. answer is the model result, acceptable other correct results.`,
  spot: `spot: write corrected first (2 or 3 correct ${name} sentences), then text: the same with 1 or 2 mistakes against this rule put in and nothing else changed.`,
  produce: 'produce: an instruction to write one new sentence that needs the rule, in a new situation (give the situation and, if useful, a word to use). model is one model sentence.',
});

const GAP_EXAMPLE = {
  de: `Example gap for "zu + infinitive after hoffen":
  full "Sie hofft, ihre Prüfung zu bestehen." answer "zu bestehen" sentence "Sie hofft, ihre Prüfung ___ (bestehen)."
  NOT "Sie hofft ___ (bestehen) ihre Prüfung." (no filling makes that a correct sentence).`,
};

const EXPLAIN_EXAMPLE = {
  de: `Good: "Nach »hoffen« steht zu + Infinitiv am Satzende, mit Komma."
Bad: "Man schreibt es mit kurzem u und ohne Dehnungs-e." (an invented reason about sounds)`,
};

export const ruleExercises = {
  ask(c, list) {
    const { L } = c;
    const name = L.english;
    const kinds = KIND_TEXT(name);
    const lines = list.map(({ rule, kinds: want, examples = [] }, i) => {
      const p = rulePrompt(rule);
      const head = `${i + 1}. [${rule.category}/${rule.key}] ${p.standard ? p.statement : `${p.name}${p.statement ? `: ${p.statement}` : ''}`}${p.level ? ` (${p.level})` : ''}`;
      const extra = p.standard ? '' : `${p.pattern ? `\n   Pattern: ${p.pattern}` : ''}${examples.length ? `\n   Correct example: ${examples.slice(0, 2).map((x) => `"${x}"`).join('; ')}` : ''}`;
      return `${head}${extra}\n   Write: ${want.join(', ')}`;
    }).join('\n');
    const used = KINDS.filter((k) => list.some((x) => x.kinds.includes(k)));
    const prompt = `Write grammar exercises for a ${name} learner at ${levelText(L)}. Each set trains ONE rule, given by its statement. Use fresh everyday sentences (work, travel, friends, home, news) with vocabulary that suits the learner's level, and vary the verbs and nouns; never build the exercises around one single word.

For each rule, write the kinds listed under it:
${used.map((k) => `- ${kinds[k]}`).join('\n')}
${used.includes('gap') && GAP_EXAMPLE[L.code] ? `${GAP_EXAMPLE[L.code]}\n` : ''}
Each exercise also gets trigger and explanation. trigger: the word or words in this exercise that make the rule apply. explanation: in ${explainLang(c, { simpler: true })}, one sentence of at most 20 words: why the rule applies here, naming the trigger, in the rule's own terms (case, verb position, comma, ß after a long vowel …). Never explain with sounds or letters unless the rule is about them. Never mention a wrong form that is not in this exercise. If unsure, say the rule statement in simple words.
${EXPLAIN_EXAMPLE[L.code] || ''}

Rules:
${lines}`;
    const alt = { type: 'ARRAY', items: STR };
    const why = { trigger: { type: 'STRING', description: 'The word or words in this exercise that make the rule apply.' }, explanation: STR };
    const shapes = {
      pair: S({ correct: STR, wrong: STR, ...why }),
      gap: S({
        full: { type: 'STRING', description: 'The complete correct sentence, with normal punctuation.' },
        answer: { type: 'STRING', description: 'The words from full that the rule decides, copied exactly; one connected piece of full.' },
        sentence: { type: 'STRING', description: 'full with answer replaced by ___ (once). Everything else exactly as in full. Optionally the base form in brackets right after the gap.' },
        acceptable: alt, ...why,
      }),
      transform: S({ instruction: STR, items: { type: 'ARRAY', items: S({ prompt: STR, answer: STR, acceptable: alt }) }, ...why }),
      spot: S({ corrected: STR, text: STR, ...why }),
      produce: S({ instruction: STR, model: STR, ...why }),
    };
    return { prompt, temperature: 0.6, schema: S({
      sets: { type: 'ARRAY', items: S(Object.fromEntries(used.map((k) => [k, shapes[k]])), []) },
    }) };
  },
  read(r, c, list) {
    return list.map(({ kinds }, i) => {
      const got = r.sets?.[i] || {};
      const set = {};
      for (const k of kinds) {
        if (!got[k]) continue;
        set[k] = { ...got[k], id: `${Date.now().toString(36)}${i}${k}` };
      }
      return set;
    });
  },
};

// Sorts mistakes into the current categories and gives each its rule: older mistakes saved
// before rules existed, and those of rules that look wrongly filed (background.recheckRules).
// list: mistakes. Returns one { rulePattern, rule, category, ruleName, ruleStatement, ruleLevel }
// per mistake, in order. Each answer repeats the mistake's words, so a reply that skipped or
// merged one is noticed instead of giving every later mistake the wrong rule.
export const classifyMistakes = {
  ask(c, list) {
    const { L } = c;
    const cats = categoriesFor(L);
    const prompt = `These are mistakes a ${L.english} learner at ${levelText(L)} made in writing, with their corrections.
For each one, in the same order, copy its wrong words into original, name the pattern, then the rule, then pick its category from this fixed list.
${categoryGuide(cats)}

${ruleRules(c)}

Mistakes:
${list.map((m, i) => `${i + 1}. wrote "${m.original}" instead of "${m.corrected}"${m.fullSentence ? ` in "${m.fullSentence}"` : ''}${m.correctedSentence ? ` (corrected: "${m.correctedSentence}")` : ''}${m.explanation ? ` (${m.explanation})` : ''}`).join('\n')}`;
    const { rulePattern, rule, ...rest } = ruleProps(c);
    return { prompt, temperature: 0.2, schema: S({
      mistakes: { type: 'ARRAY', items: S({
        original: { type: 'STRING', description: 'The wrong words of this mistake, copied exactly.' },
        rulePattern, rule,
        category: { type: 'STRING', enum: cats.map((x) => x.id) },
        ...rest,
      }) },
    }) };
  },
  read(r, c, list) {
    const got = r.mistakes || [];
    const n = (s) => String(s || '').replace(/\s+/g, ' ').trim().toLowerCase();
    if (got.length !== list.length || got.some((x, i) => n(x?.original) !== n(list[i].original))) {
      throw new Error('classifyMistakes: answers out of order');
    }
    return got;
  },
};

// Gemini features for whole texts: correcting what the learner wrote and translating
// sentences into a tone. ask/read pairs as in words.js.
import { S, STR, hasFurigana, furiganaOf, collectFurigana, explainLang, levelText, toneGuide, TONES,
  naturalProps, cleanNatural, correctionProps, correctionRules, cleanMistakes, recheckNote, recheckTemp } from './shared.js';

export const correctText = {
  ask(c, text, { recheck } = {}) {
    const { L } = c;
    const prompt = `You correct ${L.english} written by a learner at ${levelText(L)}. Correct this text:
"""${text}"""

${correctionRules(c)}
Separately, if the text would sound clearly more natural phrased differently, put that version in natural. That is a suggestion, not a mistake.${recheckNote(recheck)}`;
    return { prompt, schema: S({ ...correctionProps(c), ...naturalProps(c) }), temperature: recheckTemp(recheck) };
  },
  read(reply) {
    const r = cleanMistakes(reply);
    return cleanNatural(r, r.correctedText);
  },
};

// Translates a sentence (English or any language) into the language being learnt, in a tone.
// keep: the text is already in that language (a suggestion being saved), so only describe it;
// tone is then detected.
export const translateSentence = {
  ask(c, text, tone = 'everyday', { keep = false } = {}) {
    const { L } = c;
    const name = L.english;
    const unspaced = L.code === 'ja' || /^(zh|th|lo|km|my)$/.test(L.code);
    const task = keep
      ? `This ${name} text is correct and natural. Keep it exactly as given in sentence, and work out which tone it has.
Text: """${text}"""`
      : `Translate this text into natural ${name} in the ${tone} tone. If it is already ${name}, rewrite it in that tone.
Text: """${text}"""
Match what a native speaker would really say in that tone, not a word-for-word translation.`;
    const props = {
      sentence: { type: 'STRING', description: `The ${name} sentence (or short text) in normal ${name} script.` },
      ...(L.reading ? { reading: { type: 'STRING', description: `The sentence read aloud, in ${L.reading}.` } } : {}),
      translation: { type: 'STRING', description: 'Natural English meaning of the sentence.' },
      tone: { type: 'STRING', enum: TONES },
      toneNote: { type: 'STRING', description: `One short line in ${explainLang(c)} on what makes it sound ${keep ? 'like this tone' : tone} (forms of address, verb forms, word choice, contractions).` },
      chunks: { type: 'ARRAY', items: STR, description: `The sentence split, in order, into 3 to 9 meaningful pieces for a word-order exercise (short phrases or single words, punctuation attached to the piece before it). Joined ${unspaced ? 'without spaces' : 'with single spaces'} they must give the sentence exactly.` },
      gapSentence: { type: 'STRING', description: 'The sentence with its most useful phrase or expression (the part a learner would most likely not produce on their own) replaced by "___".' },
      gapAnswer: { type: 'STRING', description: 'The exact text that was replaced by ___.' },
      ...(hasFurigana(L) ? { sentenceFurigana: furiganaOf('The sentence'), gapFurigana: furiganaOf('gapSentence') } : {}),
      keyWords: {
        type: 'ARRAY', description: `Up to 4 words or expressions from the sentence worth learning for a learner at ${levelText(L)}, in dictionary form. Skip very basic words.`,
        items: S({ lemma: STR, meaning: { type: 'STRING', description: 'Short English meaning.' } }),
      },
    };
    const prompt = `You help a ${name} learner at ${levelText(L)} whose working language is English say whole sentences.
${task}

${toneGuide(L)}`;
    return { prompt, schema: S(props), temperature: 0.4 };
  },
  read(r, { L }, text, tone = 'everyday', { keep = false } = {}) {
    if (keep) r.sentence = text.trim();
    if (!TONES.includes(r.tone)) r.tone = keep ? 'everyday' : tone;
    if (hasFurigana(L)) collectFurigana(r, [['sentenceFurigana', (x) => (x.sentence || '').trim()], ['gapFurigana', (x) => x.gapSentence]]);
    return r;
  },
};

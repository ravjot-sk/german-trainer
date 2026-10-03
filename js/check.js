// Local answer checking and a small word diff for showing corrections.

export function normalize(s) {
  return (s || '')
    .normalize('NFC')
    .replace(/[„“”"«»‚‘’']/g, '')
    .replace(/\s+/g, ' ')
    .replace(/\s*([,;:])\s*/g, '$1 ')
    .replace(/[.!?…]+$/g, '')
    .trim();
}

// Returns 'correct', 'almost' (differs only in capitalisation) or 'wrong'.
export function compare(answer, expected) {
  const a = normalize(answer);
  const e = normalize(expected);
  if (!a || !e) return 'wrong';
  if (a === e) return 'correct';
  if (a.toLowerCase() === e.toLowerCase()) return 'almost';
  return 'wrong';
}

// Best result across several acceptable answers.
export function compareAny(answer, expectedList) {
  let best = 'wrong';
  for (const e of expectedList.filter(Boolean)) {
    const r = compare(answer, e);
    if (r === 'correct') return r;
    if (r === 'almost') best = r;
  }
  return best;
}

export function stripArticle(s) {
  return (s || '').trim().replace(/^(der|die|das)\s+/i, '');
}

// Typed recall for a word. Nouns need article + word, and the plural if the word has one.
export function checkRecall(word, answer, pluralAnswer) {
  const target = word.pos === 'noun' && word.article ? `${word.article} ${word.german}` : word.german;
  let main = compare(answer, target);
  if (main === 'wrong' && word.pos !== 'noun') {
    // Accept "sich erinnern" when the stored form is "erinnern" and vice versa.
    main = compare(answer.replace(/^sich\s+/i, ''), target.replace(/^sich\s+/i, ''));
  }
  let plural = null;
  if (needsPlural(word)) {
    plural = compare(stripArticle(pluralAnswer), stripArticle(word.plural));
  }
  const parts = [main, plural].filter(Boolean);
  const grade = parts.includes('wrong') ? 'wrong' : parts.includes('almost') ? 'almost' : 'correct';
  return { grade, main, plural, target, pluralTarget: needsPlural(word) ? stripArticle(word.plural) : '' };
}

export function needsPlural(word) {
  if (word.pos !== 'noun') return false;
  const p = stripArticle(word.plural || '');
  return !!p && !/^(-|–|—|kein|no plural|nur singular|ohne plural)/i.test(p);
}

// Gap sentence for a word: the stored one, or a best-effort local guess.
export function gapFor(word) {
  if (word.gapSentence && word.gapSentence.includes('___') && word.gapAnswer) {
    return { sentence: word.gapSentence, answer: word.gapAnswer };
  }
  const source = word.contextSentence || word.example;
  if (!source) return null;
  const stem = word.german.toLowerCase().slice(0, Math.max(3, Math.min(5, word.german.length - 1)));
  const tokens = source.split(/(\s+)/);
  for (let i = 0; i < tokens.length; i++) {
    const bare = tokens[i].replace(/[.,!?;:„“"()]/g, '');
    if (bare.length > 1 && bare.toLowerCase().startsWith(stem)) {
      tokens[i] = tokens[i].replace(bare, '___');
      return { sentence: tokens.join(''), answer: bare };
    }
  }
  return null;
}

// Word-level diff (LCS) returning [{type: 'same'|'del'|'add', text}].
export function wordDiff(a, b) {
  const x = (a || '').split(/(\s+)/).filter((s) => s !== '');
  const y = (b || '').split(/(\s+)/).filter((s) => s !== '');
  const n = x.length, m = y.length;
  if (n * m > 250000) return [{ type: 'add', text: b }];
  const dp = Array.from({ length: n + 1 }, () => new Uint16Array(m + 1));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i][j] = x[i] === y[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }
  const out = [];
  const push = (type, text) => {
    const last = out[out.length - 1];
    if (last && last.type === type) last.text += text; else out.push({ type, text });
  };
  let i = 0, j = 0;
  while (i < n && j < m) {
    if (x[i] === y[j]) { push('same', x[i]); i++; j++; }
    else if (dp[i + 1][j] >= dp[i][j + 1]) { push('del', x[i]); i++; }
    else { push('add', y[j]); j++; }
  }
  while (i < n) push('del', x[i++]);
  while (j < m) push('add', y[j++]);
  return out;
}

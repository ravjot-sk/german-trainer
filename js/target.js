// The word or words a transformation is about ("Setze das unterstrichene Nomen in den
// Plural"). Gemini names them in target; the app underlines them in the sentence and tells
// the grader which word was meant (#44: nothing was marked, so the learner had to guess).

// An instruction that refers to a mark in the text: underlined, highlighted, bold …
const MARK = /unterstrich|markiert|hervorgehoben|\bfett|kursiv|underlin|highlight|\bbold|\bmarked|下線|太字|強調/i;
export const mentionsMark = (instruction) => MARK.test(String(instruction || ''));

// Where target stands in text: [start, end], or null. The exact spelling first, then any case.
export function targetSpan(text, target) {
  const s = String(text || '');
  const w = String(target || '').trim();
  if (!s || !w) return null;
  let i = s.indexOf(w);
  if (i < 0) i = s.toLowerCase().indexOf(w.toLowerCase());
  return i < 0 ? null : [i, i + w.length];
}

// An item's target is fine when there is none, or when it stands in the sentence.
export const targetFits = (item) => !String(item?.target || '').trim() || !!targetSpan(item.prompt, item.target);

// Splits text segments ({ text, rt? }, as furigana.js makes them) into runs inside and outside
// [start, end]. Plain text is cut at the edges; a word with a reading that crosses an edge
// stays whole, inside. Returns [{ segs, mark }].
export function markRuns(segments, [start, end]) {
  const runs = [];
  const push = (seg, mark) => {
    const last = runs[runs.length - 1];
    if (last && last.mark === mark) last.segs.push(seg);
    else runs.push({ segs: [seg], mark });
  };
  let pos = 0;
  for (const seg of segments) {
    const a = pos;
    const b = pos + seg.text.length;
    pos = b;
    if (b <= start || a >= end) { push(seg, false); continue; }
    if (seg.rt) { push(seg, true); continue; }
    const from = Math.max(start, a) - a;
    const to = Math.min(end, b) - a;
    if (from > 0) push({ text: seg.text.slice(0, from) }, false);
    push({ text: seg.text.slice(from, to) }, true);
    if (to < seg.text.length) push({ text: seg.text.slice(to) }, false);
  }
  return runs;
}

// The task for the grader, with the word that was underlined for the learner.
export const withTarget = (instruction, target) => (String(target || '').trim()
  ? `${instruction} (The words to change, underlined for the learner: "${String(target).trim()}".)`
  : instruction);

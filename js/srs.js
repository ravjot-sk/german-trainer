// Spaced repetition (SM-2 variant). One scheduler for words, past mistakes and grammar
// categories. Pure functions so they can be unit-tested in Node.

const DAY = 24 * 60 * 60 * 1000;

export function dayStart(ts) {
  const d = new Date(ts);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

// Calendar-day arithmetic that survives daylight-saving changes.
export function addDays(ts, n) {
  const d = new Date(ts);
  d.setDate(d.getDate() + n);
  return d.getTime();
}

// Items never practised are due from the day they are added (older data stored them as due
// the next day, so their due date is not trusted).
export function isDue(item, now = Date.now()) {
  return !item.introducedAt || item.due < addDays(dayStart(now), 1);
}

export function isNew(item) {
  return !item.introducedAt;
}

// grade: 'correct' | 'almost' | 'wrong'
export function schedule(item, grade, now = Date.now()) {
  const next = { ...item };
  const today = dayStart(now);
  if (!next.introducedAt) next.introducedAt = now;
  const q = grade === 'correct' ? 5 : grade === 'almost' ? 3 : 1;

  if (q < 3) {
    // A wrong answer brings the item back tomorrow and resets its run.
    next.reps = 0;
    next.lapses = (next.lapses || 0) + 1;
    next.interval = 1;
    next.ease = Math.max(1.3, (next.ease || 2.5) - 0.2);
  } else {
    next.reps = (next.reps || 0) + 1;
    if (next.reps === 1) next.interval = 1;
    else if (next.reps === 2) next.interval = 3;
    else next.interval = Math.round((next.interval || 1) * (next.ease || 2.5));
    next.ease = Math.max(1.3, (next.ease || 2.5) + (0.1 - (5 - q) * (0.08 + (5 - q) * 0.02)));
  }
  next.interval = Math.min(next.interval, 365);
  next.due = addDays(today, next.interval);
  next.lastReviewedAt = now;
  return next;
}

// Practice answers: a miss always counts (the item comes back tomorrow), and new or due items
// are scheduled as in the daily session. A right answer on an item that is not due yet leaves
// its schedule alone, so practising early never pushes a word further out. Returns the item
// unchanged in that case.
export function schedulePractice(item, grade, now = Date.now()) {
  if (grade === 'wrong' || isNew(item) || isDue(item, now)) return schedule(item, grade, now);
  return item;
}

export const _DAY = DAY;

// The mistake profile's numbers: per grammar category, how often it went wrong lately and
// whether that is getting better. Pure functions so they can be unit-tested in Node.
import { DAY } from './srs.js';
import { migrateCategory } from './categories.js';

// Mistakes made in drills count toward the drill's accuracy, not the profile.
export const writingMistakes = (mistakes) => mistakes.filter((m) => m.source !== 'drill');

// One entry per category that has mistakes or drill answers. cats: the language's category
// list; lang: its code.
export function categoryStats({ mistakes, reviews, cats, lang, now = Date.now() }) {
  const d14 = now - 14 * DAY, d28 = now - 28 * DAY;
  const writing = writingMistakes(mistakes);
  return cats.map((c) => {
    // Mistakes synced from a device that still runs an older version keep old category ids.
    const mine = writing.filter((m) => migrateCategory(lang, m.category) === c.id);
    const recent = mine.filter((m) => m.createdAt >= d14).length;
    const prev = mine.filter((m) => m.createdAt >= d28 && m.createdAt < d14).length;
    const drills = reviews.filter((r) => r.category === c.id).slice(-10);
    const acc = drills.length ? drills.filter((r) => r.correct).length / drills.length : null;
    let trend = 'steady';
    if (prev > 0 && recent > prev) trend = 'worse';
    else if (recent < prev && drills.length >= 3 && acc >= 0.7) trend = 'improving';
    return { ...c, total: mine.length, recent, prev, drills: drills.length, acc, trend };
  }).filter((s) => s.total || s.drills);
}

// Most mistakes in the last two weeks first, then most mistakes overall.
export const byRecent = (a, b) => b.recent - a.recent || b.total - a.total;

// Trimming old reviews, so the data on the device and in the account stops growing without
// end. Pure functions so they can be unit-tested in Node.
//
// The app reads reviews for: the latest review of each item (practice weighting), the last
// drills per grammar category (profile accuracy, stats.js) and today's reviews (Heute counts).
// Everything newer than KEEP_DAYS stays; older reviews stay only if they are one of those.
import { DAY } from './srs.js';

export const KEEP_DAYS = 90;
// stats.categoryStats looks at the last 10 drills of a category.
export const PER_CATEGORY = 10;

// The reviews to keep, in their original order.
export function trimReviews(reviews, now = Date.now(), { keepDays = KEEP_DAYS, perCategory = PER_CATEGORY } = {}) {
  const cutoff = now - keepDays * DAY;
  if (!reviews.some((r) => (r.reviewedAt || 0) < cutoff)) return reviews;
  const keep = new Set();
  const latest = new Map();
  const byCategory = new Map();
  for (const r of reviews) {
    if ((r.reviewedAt || 0) >= cutoff) keep.add(r);
    const cur = latest.get(r.reviewItemId);
    if (!cur || (r.reviewedAt || 0) >= (cur.reviewedAt || 0)) latest.set(r.reviewItemId, r);
    if (r.category) {
      const key = `${r.lang || 'de'}:${r.category}`;
      if (!byCategory.has(key)) byCategory.set(key, []);
      byCategory.get(key).push(r);
    }
  }
  latest.forEach((r) => keep.add(r));
  for (const list of byCategory.values()) {
    // Reviews are stored oldest first; sort anyway so synced ones in any order count right.
    [...list].sort((a, b) => (a.reviewedAt || 0) - (b.reviewedAt || 0)).slice(-perCategory).forEach((r) => keep.add(r));
  }
  return reviews.filter((r) => keep.has(r));
}

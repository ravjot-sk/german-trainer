// Merge rules for account sync. Pure functions so they can be unit-tested in Node.
//
// Every record is one Firestore document with the record's own id. `synced` remembers, per
// collection, the updatedAt of each record as last agreed with the server. From that:
// - a local record that is newer than its synced version (or never synced) gets uploaded;
// - an id in `synced` that is gone locally was deleted here and gets a tombstone;
// - a remote record wins when it is newer than the local one ("latest wins").

export const COLLECTIONS = ['words', 'mistakes', 'reviewItems', 'reviews'];

// Records written before sync existed have no updatedAt; fall back to their creation time.
export function stamp(r) {
  return r.updatedAt || r.reviewedAt || r.addedAt || r.createdAt || 0;
}

export function pendingChanges(data, synced, inflight = {}) {
  const ups = [];
  const dels = [];
  for (const coll of COLLECTIONS) {
    const seen = synced[coll] || {};
    const ids = new Set();
    for (const rec of data[coll] || []) {
      ids.add(rec.id);
      const t = stamp(rec);
      const key = `${coll}/${rec.id}`;
      if ((!(rec.id in seen) || t > seen[rec.id]) && inflight[key] !== t) ups.push({ coll, rec, t });
    }
    for (const id of Object.keys(seen)) {
      if (!ids.has(id) && inflight[`${coll}/${id}`] !== 'del') dels.push({ coll, id });
    }
  }
  return { ups, dels };
}

const ORDER = {
  words: (a, b) => (b.addedAt || 0) - (a.addedAt || 0),
  mistakes: (a, b) => (b.createdAt || 0) - (a.createdAt || 0),
  reviews: (a, b) => (a.reviewedAt || 0) - (b.reviewedAt || 0),
};

// Applies server documents ({ id, ...fields, deleted?, updatedAt }) to the local data.
// Mutates data and synced; returns true when local data changed.
export function applyRemote(data, synced, coll, docs) {
  const seen = (synced[coll] ||= {});
  const list = (data[coll] ||= []);
  let changed = false;
  for (const d of docs) {
    const t = d.updatedAt || 0;
    const idx = list.findIndex((r) => r.id === d.id);
    if (d.deleted) {
      if (idx >= 0) {
        if (stamp(list[idx]) <= t) { list.splice(idx, 1); delete seen[d.id]; changed = true; }
      } else {
        delete seen[d.id];
      }
      continue;
    }
    const { syncedAt, deleted, ...rec } = d;
    if (idx >= 0) {
      const lt = stamp(list[idx]);
      if (t > lt) { list[idx] = rec; seen[d.id] = t; changed = true; }
      else if (t === lt) seen[d.id] = t;
    } else if (d.id in seen && t <= seen[d.id]) {
      // Deleted on this device and the tombstone is still on its way: keep it deleted.
    } else {
      list.push(rec);
      seen[d.id] = t;
      changed = true;
    }
  }
  if (coll === 'reviewItems' && dedupeReviewItems(data)) changed = true;
  if (changed && ORDER[coll]) list.sort(ORDER[coll]);
  return changed;
}

// Two devices that both had data before signing in can each hold a review item for the same
// word or grammar category. Keep one per target, chosen the same way on every device (most
// practised, then lowest id), so the loser gets tombstoned everywhere.
export function dedupeReviewItems(data) {
  const best = new Map();
  for (const r of data.reviewItems) {
    const key = `${r.itemType}:${r.itemId}`;
    const cur = best.get(key);
    if (!cur || (r.reps || 0) > (cur.reps || 0) || ((r.reps || 0) === (cur.reps || 0) && r.id < cur.id)) best.set(key, r);
  }
  if (best.size === data.reviewItems.length) return false;
  const keep = new Set(best.values());
  data.reviewItems = data.reviewItems.filter((r) => keep.has(r));
  return true;
}

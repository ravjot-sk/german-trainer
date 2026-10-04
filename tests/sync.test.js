import test from 'node:test';
import assert from 'node:assert/strict';
import { pendingChanges, applyRemote, stamp } from '../js/syncmerge.js';

const empty = () => ({ words: [], mistakes: [], reviewItems: [], reviews: [] });
const word = (id, updatedAt, o = {}) => ({ id, german: id, addedAt: 1, updatedAt, ...o });

test('records made before sync count as changed until uploaded', () => {
  const data = { ...empty(), words: [{ id: 'a', german: 'a', addedAt: 5 }], reviews: [{ id: 'r', reviewedAt: 9 }] };
  const { ups, dels } = pendingChanges(data, {});
  assert.deepEqual(ups.map((u) => [u.coll, u.rec.id, u.t]), [['words', 'a', 5], ['reviews', 'r', 9]]);
  assert.equal(dels.length, 0);
  assert.equal(stamp({ createdAt: 3 }), 3);
});

test('only newer local edits and local deletes are pending', () => {
  const data = { ...empty(), words: [word('a', 10), word('b', 20)] };
  const synced = { words: { a: 10, b: 15, gone: 7 } };
  const { ups, dels } = pendingChanges(data, synced);
  assert.deepEqual(ups.map((u) => u.rec.id), ['b']);
  assert.deepEqual(dels, [{ coll: 'words', id: 'gone' }]);
  // Already on its way: not sent twice.
  assert.equal(pendingChanges(data, synced, { 'words/b': 20, 'words/gone': 'del' }).ups.length, 0);
  assert.equal(pendingChanges(data, synced, { 'words/b': 20, 'words/gone': 'del' }).dels.length, 0);
});

test('remote records: newer wins, older is ignored, new ones are added', () => {
  const data = { ...empty(), words: [word('a', 10, { meaning: 'local' }), word('b', 30, { meaning: 'local' })] };
  const synced = { words: { a: 10, b: 20 } };
  const changed = applyRemote(data, synced, 'words', [
    word('a', 12, { meaning: 'remote', syncedAt: {} }),
    word('b', 20, { meaning: 'remote' }),
    word('c', 5, { addedAt: 99 }),
  ]);
  assert.ok(changed);
  const byId = Object.fromEntries(data.words.map((w) => [w.id, w]));
  assert.equal(byId.a.meaning, 'remote');
  assert.equal(byId.b.meaning, 'local');
  assert.ok(byId.c);
  assert.equal('syncedAt' in byId.a, false);
  assert.equal(data.words[0].id, 'c', 'words stay newest first');
  assert.deepEqual(synced.words, { a: 12, b: 20, c: 5 });
  // b is still newer locally, so it goes back up.
  assert.deepEqual(pendingChanges(data, synced).ups.map((u) => u.rec.id), ['b']);
});

test('tombstones delete older local copies but not newer edits', () => {
  const data = { ...empty(), words: [word('a', 10), word('b', 50)] };
  const synced = { words: { a: 10, b: 40, c: 3 } };
  applyRemote(data, synced, 'words', [
    { id: 'a', deleted: true, updatedAt: 20 },
    { id: 'b', deleted: true, updatedAt: 45 },
    { id: 'c', deleted: true, updatedAt: 9 },
  ]);
  assert.deepEqual(data.words.map((w) => w.id), ['b']);
  assert.equal('a' in synced.words, false);
  assert.equal('c' in synced.words, false);
  assert.deepEqual(pendingChanges(data, synced).ups.map((u) => u.rec.id), ['b']);
});

test('a record deleted here stays deleted when its old copy comes back', () => {
  const data = empty();
  const synced = { words: { a: 10 } };
  assert.equal(applyRemote(data, synced, 'words', [word('a', 10)]), false);
  assert.equal(data.words.length, 0);
  assert.deepEqual(pendingChanges(data, synced).dels, [{ coll: 'words', id: 'a' }]);
  // ...but an edit made elsewhere after that wins.
  applyRemote(data, synced, 'words', [word('a', 11)]);
  assert.equal(data.words.length, 1);
});

test('duplicate review items from two devices collapse the same way everywhere', () => {
  const item = (id, reps) => ({ id, itemType: 'category', itemId: 'cases', reps, updatedAt: 1 });
  const phone = { ...empty(), reviewItems: [item('x1', 3)] };
  const laptop = { ...empty(), reviewItems: [item('x2', 1)] };
  applyRemote(phone, {}, 'reviewItems', [item('x2', 1)]);
  applyRemote(laptop, {}, 'reviewItems', [item('x1', 3)]);
  assert.deepEqual(phone.reviewItems.map((r) => r.id), ['x1']);
  assert.deepEqual(laptop.reviewItems.map((r) => r.id), ['x1']);
});

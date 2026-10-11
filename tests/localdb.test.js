import test from 'node:test';
import assert from 'node:assert/strict';

// Node has no IndexedDB, so slots use localStorage: the fallback path some browsers take.
const mem = new Map();
let full = false;
globalThis.localStorage = {
  getItem: (k) => (mem.has(k) ? mem.get(k) : null),
  setItem: (k, v) => { if (full) throw new Error('QuotaExceededError'); mem.set(k, String(v)); },
  removeItem: (k) => mem.delete(k),
};
const { slot, problem, onProblem } = await import('../js/localdb.js');

test('without IndexedDB a slot reads and writes its localStorage key', async () => {
  mem.set('t.a', JSON.stringify({ x: 1 }));
  const s = slot('a', 't.a');
  assert.deepEqual(await s.load(), { x: 1 });
  s.save({ x: 2 });
  assert.equal(mem.get('t.a'), '{"x":2}');
  s.save(null);
  assert.equal(mem.has('t.a'), false);
  assert.equal(s.moved(), false);
});

test('a failed save is reported until a save works again', async () => {
  const s = slot('b', 't.b');
  await s.load();
  const seen = [];
  const off = onProblem((e) => seen.push(e ? 'failed' : 'ok'));
  full = true;
  s.save({ big: true });
  assert.ok(problem());
  full = false;
  s.save({ big: false });
  assert.equal(problem(), null);
  assert.deepEqual(seen, ['failed', 'ok']);
  off();
});

test('a moved slot keeps saves made before loading off its fallback copy', async () => {
  mem.set('t.c', '"old"');
  mem.set('t.c.moved', '1');
  const s = slot('c', 't.c');
  s.save('new');
  assert.equal(mem.get('t.c'), '"old"');
  // Loading finds no IndexedDB here, so the kept value is written and returned.
  assert.equal(await s.load(), 'new');
  assert.equal(mem.get('t.c'), '"new"');
});

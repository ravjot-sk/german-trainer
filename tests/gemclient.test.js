import test from 'node:test';
import assert from 'node:assert/strict';
import { retryWait, isDailyLimit, send, createQueue, textModels, CallError } from '../js/gemclient.js';

const reply = (status, json = {}) => ({ res: { ok: status === 200, status }, json });
const retryInfo = (s) => ({ '@type': 'type.googleapis.com/google.rpc.RetryInfo', retryDelay: s });
const quota = (id) => ({ '@type': 'type.googleapis.com/google.rpc.QuotaFailure', violations: [{ quotaId: id }] });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

test('busy replies are retried twice, with the wait Google asks for', () => {
  assert.equal(retryWait(503, {}, 0), 2000);
  assert.equal(retryWait(500, {}, 1), 5000);
  assert.equal(retryWait(503, {}, 2), null);
  assert.equal(retryWait(429, { error: { details: [retryInfo('3s')] } }, 0), 3000);
  assert.equal(retryWait(429, { error: { details: [retryInfo('43s')] } }, 0), 20000, 'capped');
  assert.equal(retryWait(400, {}, 0), null);
  assert.equal(retryWait(404, {}, 0), null);
});

test('a used-up daily quota is not retried', () => {
  const json = { error: { details: [quota('GenerateRequestsPerDayPerProjectPerModel-FreeTier'), retryInfo('30s')] } };
  assert.ok(isDailyLimit(json));
  assert.equal(retryWait(429, json, 0), null);
  assert.ok(!isDailyLimit({ error: { details: [quota('GenerateRequestsPerMinutePerProjectPerModel-FreeTier')] } }));
});

test('send retries a busy reply and returns the good one', async () => {
  const replies = [reply(503, { error: { details: [retryInfo('0.01s')] } }), reply(200, { ok: 1 })];
  let limits = 0;
  const r = await send(async () => replies.shift(), { onLimit: () => limits++ });
  assert.equal(r.res.status, 200);
  assert.equal(replies.length, 0);
  assert.equal(limits, 0);
});

test('send reports a rate limit and hands back a reply it gives up on', async () => {
  let limits = 0;
  const json = { error: { details: [quota('PerDay')] } };
  const r = await send(async () => reply(429, json), { onLimit: () => limits++ });
  assert.equal(r.res.status, 429);
  assert.equal(limits, 1);
});

// A request that only ends when it is aborted, like fetch on a dead connection.
const hanging = (signal) => new Promise((_, reject) => signal.addEventListener('abort', () => reject(new Error('aborted'))));

test('send gives up after its time limit', async () => {
  await assert.rejects(send(hanging, { ms: 30 }), (e) => e instanceof CallError && e.kind === 'timeout');
});

test('send stops when the learner cancels', async () => {
  const ctl = new AbortController();
  const p = send(hanging, { signal: ctl.signal, ms: 5000 });
  ctl.abort();
  await assert.rejects(p, (e) => e.kind === 'cancel');
});

test('send turns a failed connection into a network error', async () => {
  await assert.rejects(send(async () => { throw new TypeError('Failed to fetch'); }), (e) => e.kind === 'network');
});

// A job that records when it starts and finishes once release() is called.
function job(log, name) {
  let release;
  const done = new Promise((r) => (release = r));
  return { fn: async () => { log.push(name); await done; return name; }, release };
}

test('background calls wait for the learner\'s call and run one at a time', async () => {
  const q = createQueue();
  const log = [];
  const fg = job(log, 'fg');
  const b1 = job(log, 'b1');
  const b2 = job(log, 'b2');
  const pf = q.run(fg.fn);
  const p1 = q.run(b1.fn, { background: true });
  const p2 = q.run(b2.fn, { background: true });
  await sleep(5);
  assert.deepEqual(log, ['fg']);
  fg.release();
  await pf;
  await sleep(5);
  assert.deepEqual(log, ['fg', 'b1']);
  b1.release();
  assert.equal(await p1, 'b1');
  await sleep(5);
  assert.deepEqual(log, ['fg', 'b1', 'b2']);
  b2.release();
  assert.equal(await p2, 'b2');
});

test('a queued background call starts at once when its task comes up', async () => {
  const q = createQueue();
  const log = [];
  const fg = job(log, 'fg');
  const task = {};
  const b = job(log, 'drill');
  q.run(fg.fn);
  const p = q.run(b.fn, { background: true, tags: [task] });
  await sleep(5);
  assert.deepEqual(log, ['fg']);
  q.promote(task);
  await sleep(5);
  assert.deepEqual(log, ['fg', 'drill']);
  assert.equal(q.waiting, 0);
  b.release();
  fg.release();
  assert.equal(await p, 'drill');
});

test('background calls pause after a rate limit; the learner\'s calls do not', async () => {
  const q = createQueue({ pauseMs: 40 });
  const log = [];
  q.limited();
  const b = job(log, 'bg');
  const f = job(log, 'fg');
  q.run(b.fn, { background: true });
  q.run(f.fn);
  f.release();
  await sleep(10);
  assert.deepEqual(log, ['fg']);
  await sleep(50);
  assert.deepEqual(log, ['fg', 'bg']);
  b.release();
});

test('the model list keeps text models, recommended first', () => {
  assert.deepEqual(textModels([
    'gemini-2.5-flash', 'gemini-2.5-flash-image', 'gemini-flash-latest', 'gemini-2.5-flash-preview-tts',
    'gemini-flash-lite-latest', 'gemini-2.5-pro', 'gemma-3-27b-it', 'gemini-embedding-001', 'gemini-2.5-flash',
  ]), ['gemini-flash-lite-latest', 'gemini-flash-latest', 'gemini-2.5-pro', 'gemini-2.5-flash']);
});

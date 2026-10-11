// Sending requests to Gemini: a time limit for every call, retries when Google is busy, and a
// queue that lets what the learner is waiting for go before background work. Nothing here reads
// the app's data, so it can be tested in Node.

export const FOREGROUND_MS = 30000;
export const BACKGROUND_MS = 90000;
const RETRY_STATUSES = [429, 500, 503];
const WAITS = [2000, 5000];
const MAX_WAIT = 20000;
export const PAUSE_AFTER_LIMIT = 60000;
export const RECOMMENDED_MODEL = 'gemini-flash-lite-latest';

// kind: 'timeout', 'cancel' (the learner tapped Abbrechen), 'offline' or 'network'.
export class CallError extends Error {
  constructor(kind, message = kind) {
    super(message);
    this.kind = kind;
  }
}

const details = (json) => json?.error?.details || [];

// Google's 429 names the quota that ran out; a daily one won't come back by retrying.
export function isDailyLimit(json) {
  return details(json).some((d) => (d.violations || []).some((v) => /PerDay/i.test(v.quotaId || '')));
}

// The wait Google asks for, e.g. "retryDelay": "43s", in ms.
export function retryDelay(json) {
  const d = details(json).find((x) => /RetryInfo$/.test(x['@type'] || ''));
  const s = parseFloat(d?.retryDelay);
  return Number.isFinite(s) ? Math.round(s * 1000) : null;
}

// How long to wait before trying again after a failed reply (attempt counts from 0), or null
// to give up.
export function retryWait(status, json, attempt) {
  if (!RETRY_STATUSES.includes(status) || attempt >= WAITS.length) return null;
  if (status === 429 && isDailyLimit(json)) return null;
  return Math.min(retryDelay(json) ?? WAITS[attempt], MAX_WAIT);
}

const pause = (ms, signal) => new Promise((resolve, reject) => {
  const id = setTimeout(resolve, ms);
  signal.addEventListener('abort', () => { clearTimeout(id); reject(signal.reason); }, { once: true });
});

// Sends request(signal) → { res, json } and retries busy replies. The call ends after ms, when
// signal aborts, or when the device goes offline, with a CallError. A reply that is still not
// ok after the retries is returned as it is.
export async function send(request, { signal, ms = FOREGROUND_MS, onLimit } = {}) {
  const ctl = new AbortController();
  let why = null;
  const stop = (kind) => { if (!why) { why = kind; ctl.abort(); } };
  const deadline = Date.now() + ms;
  const timer = setTimeout(() => stop('timeout'), ms);
  const onAbort = () => stop('cancel');
  const onOffline = () => stop('offline');
  if (signal?.aborted) stop('cancel');
  signal?.addEventListener('abort', onAbort);
  globalThis.addEventListener?.('offline', onOffline);
  try {
    for (let attempt = 0; ; attempt++) {
      let res, json;
      try {
        ({ res, json } = await request(ctl.signal));
      } catch (e) {
        throw why ? new CallError(why) : new CallError('network', e?.message);
      }
      if (why) throw new CallError(why);
      if (res.ok) return { res, json };
      if (res.status === 429) onLimit?.();
      const wait = retryWait(res.status, json, attempt);
      if (wait == null || Date.now() + wait >= deadline) return { res, json };
      try { await pause(wait, ctl.signal); } catch { throw new CallError(why); }
    }
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', onAbort);
    globalThis.removeEventListener?.('offline', onOffline);
  }
}

// Calls the learner waits for run at once. Background calls run one at a time, only while no
// foreground call is running, and not for a while after Google said "too many requests".
// promote(tag) starts a waiting background call now, as a foreground one, when the learner
// reaches what it is for.
export function createQueue({ pauseMs = PAUSE_AFTER_LIMIT } = {}) {
  let running = 0;
  let bgBusy = false;
  let pausedUntil = 0;
  let timer = null;
  const waiting = [];

  function pump() {
    if (bgBusy || running || !waiting.length) return;
    const left = pausedUntil - Date.now();
    if (left > 0) {
      timer ||= setTimeout(() => { timer = null; pump(); }, left);
      return;
    }
    const job = waiting.shift();
    bgBusy = true;
    job.fn(true).then(job.resolve, job.reject).finally(() => { bgBusy = false; pump(); });
  }

  async function foreground(fn) {
    running++;
    try { return await fn(false); } finally { running--; pump(); }
  }

  // fn(background) does the call; background says which time limit applies.
  function run(fn, { background = false, tags = [] } = {}) {
    if (!background) return foreground(fn);
    return new Promise((resolve, reject) => {
      waiting.push({ fn, tags, resolve, reject });
      pump();
    });
  }

  function promote(tag) {
    for (const job of waiting.filter((j) => j.tags.includes(tag))) {
      waiting.splice(waiting.indexOf(job), 1);
      foreground(job.fn).then(job.resolve, job.reject);
    }
  }

  return {
    run,
    promote,
    limited() { pausedUntil = Date.now() + pauseMs; },
    get waiting() { return waiting.length; },
  };
}

// The models offered in Settings: Gemini text models only (no image, speech, live or embedding
// models), the recommended one first, then the "-latest" names, then the rest newest first.
export function textModels(names) {
  const rank = (n) => (n === RECOMMENDED_MODEL ? 0 : n.endsWith('-latest') ? 1 : 2);
  return [...new Set(names)]
    .filter((n) => n.startsWith('gemini') && !/image|tts|audio|live|embedding|vision|robotics|computer-use/.test(n))
    .sort((a, b) => rank(a) - rank(b) || b.localeCompare(a, undefined, { numeric: true }));
}

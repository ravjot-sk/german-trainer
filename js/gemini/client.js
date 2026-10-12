// Sending one structured request to Gemini and reading its JSON reply. The API key and model
// come from this device's settings; the key is sent only to Google. Time limits, retries and
// the queue are in gemclient.js.
import { getApiKey, getSettings, setSettings } from '../store.js';
import { t } from '../i18n.js';
import { send, createQueue, isDailyLimit, textModels, CallError, FOREGROUND_MS, BACKGROUND_MS, RECOMMENDED_MODEL } from '../gemclient.js';

const BASE = 'https://generativelanguage.googleapis.com/v1beta';

// kind: 'cancel' when the learner stopped the call, otherwise why it failed.
export class GeminiError extends Error {
  constructor(message, kind = 'api') {
    super(message);
    this.kind = kind;
  }
}

export const isCancel = (e) => e?.kind === 'cancel';

export function canUseGemini() {
  return !!getApiKey() && navigator.onLine !== false;
}

const queue = createQueue();

// Starts a background call that was queued for a task now, because the learner reached it.
export const promote = (tag) => queue.promote(tag);

const ERRORS = { timeout: 'err.timeout', cancel: 'err.cancelled', offline: 'err.offline', network: 'err.network' };

// One request with the time limit and retries of gemclient.js; network problems become a
// GeminiError the screens can show.
async function request(path, { body, signal, background } = {}) {
  try {
    return await send(async (abort) => {
      const res = await fetch(`${BASE}/${path}`, {
        method: body ? 'POST' : 'GET',
        headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), 'x-goog-api-key': getApiKey() },
        body: body ? JSON.stringify(body) : undefined,
        signal: abort,
      });
      const json = await res.json().catch(() => ({}));
      return { res, json };
    }, { signal, ms: background ? BACKGROUND_MS : FOREGROUND_MS, onLimit: queue.limited });
  } catch (e) {
    if (e instanceof CallError) throw new GeminiError(t(ERRORS[e.kind] || 'err.network'), e.kind);
    throw e;
  }
}

function replyError({ res, json }) {
  if (res.status === 429 && isDailyLimit(json)) return new GeminiError(t('err.dailyLimit'), 'daily');
  if (res.status === 429 || res.status === 503) return new GeminiError(t('err.busy'), 'busy');
  return new GeminiError(t('err.api', { m: json?.error?.message || res.status }));
}

// The text of a reply, without the model's thoughts, as JSON (also when wrapped in ```json).
export function replyJson(json) {
  const text = (json.candidates?.[0]?.content?.parts || [])
    .filter((p) => !p.thought).map((p) => p.text || '').join('');
  try {
    return JSON.parse(text.replace(/^```(?:json)?\s*|\s*```$/g, ''));
  } catch {
    throw new GeminiError(t('err.api', { m: 'invalid JSON' }));
  }
}

// call: { signal } to let the learner stop it, { background, tags } for work done ahead
// (see createQueue). ask: { prompt, schema, temperature } from one of the feature files.
export async function generate({ signal, background = false, tags = [] }, { prompt, schema, temperature = 0.2 }) {
  if (!getApiKey()) throw new GeminiError(t('err.noKey'));
  if (navigator.onLine === false) throw new GeminiError(t('err.offline'), 'offline');
  const body = {
    contents: [{ role: 'user', parts: [{ text: prompt }] }],
    generationConfig: { temperature, responseMimeType: 'application/json', responseSchema: schema },
  };
  return queue.run(async (bg) => {
    const ask = (model) => request(`models/${encodeURIComponent(model)}:generateContent`, { body, signal, background: bg });
    let model = getSettings().model || RECOMMENDED_MODEL;
    let reply = await ask(model);
    if (reply.res.status === 404) {
      // The saved model name no longer exists: pick a current one and retry once.
      const fallback = await pickDefaultModel(signal);
      if (fallback && fallback !== model) {
        model = fallback;
        setSettings({ model });
        reply = await ask(model);
      }
    }
    if (!reply.res.ok) throw replyError(reply);
    return replyJson(reply.json);
  }, { background, tags });
}

// The text models this key can use, the recommended one first.
export async function listModels({ signal } = {}) {
  if (!getApiKey()) throw new GeminiError(t('err.noKey'));
  const reply = await request('models?pageSize=200', { signal });
  if (!reply.res.ok) throw replyError(reply);
  return textModels((reply.json.models || [])
    .filter((m) => (m.supportedGenerationMethods || []).includes('generateContent'))
    .map((m) => m.name.replace(/^models\//, '')));
}

async function pickDefaultModel(signal) {
  try {
    const names = await listModels({ signal });
    if (names.includes(RECOMMENDED_MODEL)) return RECOMMENDED_MODEL;
    return names.find((n) => /flash/.test(n)) || names[0];
  } catch { return null; }
}

export async function testKey(call = {}) {
  const r = await generate(call, { prompt: 'Reply with {"ok": true}.', schema: {
    type: 'OBJECT', properties: { ok: { type: 'BOOLEAN' } }, required: ['ok'],
  } });
  return { ok: !!r.ok, model: getSettings().model };
}

// Bug reports: what the app captures when the learner reports a problem, and how a report
// becomes a GitHub issue. The app saves reports to Firestore (bugReports); the hourly
// GitHub Action in .github/workflows/bug-reports.yml turns them into issues with
// issueFromReport. No browser APIs here, so the Action and the tests can import it too.

// Must match VERSION in sw.js (a test checks), so a report says which build it came from.
export const APP_VERSION = 'gt-v18';

export const TEXT_MAX = 2000;
export const CAPTURE_MAX = 20000;

const BLOCK = new Set(['ADDRESS', 'ARTICLE', 'ASIDE', 'BUTTON', 'DD', 'DETAILS', 'DIV', 'DL', 'DT', 'FIELDSET', 'FIGURE',
  'FOOTER', 'FORM', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'HEADER', 'HR', 'LABEL', 'LI', 'MAIN', 'NAV', 'OL', 'P', 'PRE',
  'SECTION', 'SUMMARY', 'TABLE', 'TR', 'UL']);
const SKIP = new Set(['SCRIPT', 'STYLE', 'TEMPLATE', 'svg', 'SVG', 'RT', 'RP']);

const clip = (s, n) => (s.length > n ? `${s.slice(0, n)}\n… (gekürzt)` : s);

// The screen as text, top to bottom. Typed answers show as [Eingabe: …], text the app crossed
// out as ~~…~~ and highlighted corrections as **…**. Works on any DOM-like tree (nodeType,
// tagName, childNodes, value), so it can be tested without a browser.
export function screenText(root) {
  let out = '';
  const nl = () => { if (out && !out.endsWith('\n')) out += '\n'; };
  const walk = (n) => {
    if (n.nodeType === 3) { out += n.textContent.replace(/\s+/g, ' '); return; }
    if (n.nodeType !== 1) return;
    const tag = n.tagName;
    if (SKIP.has(tag) || n.hidden || n.classList?.contains('hidden')) return;
    if (tag === 'BR') { out += '\n'; return; }
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') {
      const type = (n.type || '').toLowerCase();
      if (type === 'checkbox' || type === 'radio') { out += n.checked ? '[x] ' : '[ ] '; return; }
      if (type === 'password') return;
      const v = String(n.value ?? '').trim();
      if (type === 'hidden') { if (v) out += ` [Auswahl: ${v}] `; return; }
      out += ` [Eingabe: ${v || '–'}] `;
      return;
    }
    const block = BLOCK.has(tag);
    if (block) nl();
    const mark = tag === 'DEL' || tag === 'S' ? '~~' : tag === 'INS' || tag === 'MARK' ? '**' : '';
    out += mark;
    // Label and value rows (.kv, e.g. "Lösung  der Hund") read as "Lösung: der Hund".
    const kv = n.classList?.contains('kv');
    let first = true;
    for (const c of n.childNodes) {
      if (kv && c.nodeType === 1) { if (!first) out += ': '; first = false; }
      walk(c);
    }
    out += mark;
    if (block) nl();
  };
  walk(root);
  const text = out.split('\n').map((l) => l.replace(/[ \t]+/g, ' ').trim()).filter(Boolean).join('\n');
  return clip(text, CAPTURE_MAX);
}

// Internal fields of a practice task that say nothing about what the learner saw: pending
// requests, and the feedback HTML (the screen text already has it).
const DROP = new Set(['feedback']);

// The exercise as the app holds it (word, exercise, expected answer, verdict), as JSON.
export function exerciseData(task) {
  if (!task) return '';
  const seen = new WeakSet();
  const json = JSON.stringify(task, (k, v) => {
    if (DROP.has(k) || k.endsWith('Promise') || typeof v === 'function') return undefined;
    if (v instanceof Error) return v.message;
    if (v instanceof Set) return [...v];
    if (v && typeof v === 'object') {
      if (seen.has(v)) return undefined;
      seen.add(v);
    }
    return v;
  }, 1);
  return clip(json || '', CAPTURE_MAX);
}

// The Firestore document for a report (sync adds uid and createdAt). Without capture, only
// the description and the basic fields go.
export function buildReport({ text, capture, screen, screenTextValue, exercise, language, uiLang, userAgent }) {
  const doc = {
    text: String(text || '').trim().slice(0, TEXT_MAX),
    appVersion: APP_VERSION,
    screen: String(screen || '').slice(0, 100),
    language: String(language || '').slice(0, 100),
    uiLang: String(uiLang || '').slice(0, 10),
    userAgent: String(userAgent || '').slice(0, 500),
  };
  if (capture) {
    if (screenTextValue) doc.screenText = clip(screenTextValue, CAPTURE_MAX);
    if (exercise) doc.exercise = clip(exercise, CAPTURE_MAX);
  }
  return doc;
}

// ---------- GitHub issue ----------
const escHtml = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
// Escaped @ so text like "@name" in a report can't notify anyone on GitHub.
const safe = (s) => escHtml(s).replace(/@/g, '&#64;');
// Markdown would read user text as formatting; as escaped HTML it stays plain.
const plain = (s) => safe(s).replace(/[\\`*_~[\]#|]/g, (c) => `&#${c.charCodeAt(0)};`).replace(/\n/g, '<br>\n');

// The screen text as HTML: ~~crossed out~~ and **highlighted** become real strike-through
// and highlight, like in the app.
export function screenHtml(text) {
  return safe(text)
    .replace(/~~([\s\S]*?)~~/g, '<del>$1</del>')
    .replace(/\*\*([\s\S]*?)\*\*/g, '<ins>$1</ins>');
}

const fence = (s) => {
  const ticks = '`'.repeat(Math.max(3, ...[...String(s).matchAll(/`+/g)].map((m) => m[0].length + 1)));
  return `${ticks}json\n${s}\n${ticks}`;
};

const ISSUE_MAX = 60000;

// The issue for a report: { title, body, labels }. reporter is a short tag (not the email).
export function issueFromReport(r, { reporter = '', createdAt = '' } = {}) {
  const first = String(r.text || '').split('\n')[0].trim();
  const title = `Fehlerbericht: ${first.length > 70 ? `${first.slice(0, 69)}…` : first || '(ohne Text)'}`;
  const meta = [
    ['App-Version', r.appVersion], ['Bildschirm', r.screen], ['Lernsprache', r.language], ['App-Sprache', r.uiLang],
    ['Gerät', r.userAgent], ['Gemeldet', createdAt], ['Melder', reporter],
  ].filter(([, v]) => v).map(([k, v]) => `<tr><td>${k}</td><td>${safe(v)}</td></tr>`).join('\n');
  let body = `${plain(r.text || '')}\n\n<table>\n${meta}\n</table>\n`;
  if (r.screenText) body += `\n<details open><summary>Bildschirm</summary>\n\n<pre>${screenHtml(r.screenText)}</pre>\n\n</details>\n`;
  if (r.exercise) body += `\n<details><summary>Übungsdaten</summary>\n\n${fence(r.exercise)}\n\n</details>\n`;
  if (!r.screenText && !r.exercise) body += '\n_Ohne Bildschirminhalt gesendet._\n';
  if (body.length > ISSUE_MAX) body = `${body.slice(0, ISSUE_MAX)}\n\n… (gekürzt)`;
  return { title, body, labels: ['user-report'] };
}

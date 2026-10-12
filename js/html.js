// Building HTML safely. html`…` escapes every value put into it, so text from the learner or
// from Gemini can never turn into markup. Values that are already HTML pass through: the result
// of another html`…`, or raw(…) for markup made elsewhere (only for markup the app itself built,
// never for text). Lists are joined; null and undefined give nothing.
// Screens put the result on the page with setHtml (ui/dom.js), which escapes anything else.
class Html {
  constructor(s) { this.s = s; }
  toString() { return this.s; }
  toJSON() { return this.s; } // bug reports show the markup, not { s }
}

export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export const raw = (s) => new Html(String(s ?? ''));
export const isHtml = (v) => v instanceof Html;

function part(v) {
  if (v instanceof Html) return v.s;
  if (Array.isArray(v)) return v.map(part).join('');
  return esc(v);
}

export function html(strings, ...values) {
  let out = strings[0];
  values.forEach((v, i) => { out += part(v) + strings[i + 1]; });
  return new Html(out);
}

// The markup as a string, escaping v if it is not HTML.
export const toMarkup = (v) => part(v);

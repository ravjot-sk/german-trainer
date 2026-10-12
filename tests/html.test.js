import test from 'node:test';
import assert from 'node:assert/strict';
import { html, raw, esc, isHtml, toMarkup } from '../js/html.js';

test('values are escaped', () => {
  const s = `<img src=x onerror="alert('x')">&`;
  assert.equal(String(html`<p title="${s}">${s}</p>`),
    '<p title="&lt;img src=x onerror=&quot;alert(&#39;x&#39;)&quot;&gt;&amp;">&lt;img src=x onerror=&quot;alert(&#39;x&#39;)&quot;&gt;&amp;</p>');
});

test('nested html and raw pass through, once', () => {
  const inner = html`<b>${'a<b'}</b>`;
  assert.equal(String(html`<p>${inner}${raw('<i>x</i>')}</p>`), '<p><b>a&lt;b</b><i>x</i></p>');
});

test('lists are joined; null and undefined give nothing', () => {
  assert.equal(String(html`<ul>${['<1>', 2].map((x) => html`<li>${x}</li>`)}</ul>`), '<ul><li>&lt;1&gt;</li><li>2</li></ul>');
  assert.equal(String(html`${null}${undefined}${0}`), '0');
});

test('toMarkup escapes plain text and keeps html', () => {
  assert.equal(toMarkup('<x>'), '&lt;x&gt;');
  assert.equal(toMarkup(html`<x>`), '<x>');
  assert.equal(toMarkup(''), '');
  assert.equal(esc(`"'`), '&quot;&#39;');
  assert.ok(isHtml(raw('')) && !isHtml('<x>'));
});

test('html serialises as its markup', () => {
  assert.equal(JSON.stringify({ h: html`<b>${'&'}</b>` }), '{"h":"<b>&amp;</b>"}');
});

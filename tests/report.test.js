import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { APP_VERSION, screenText, exerciseData, buildReport, issueFromReport, screenHtml } from '../js/report.js';

// A tiny stand-in for the DOM: elements with tagName and childNodes, text nodes, inputs.
const txt = (s) => ({ nodeType: 3, textContent: s });
const el = (tagName, kids = [], o = {}) => ({ nodeType: 1, tagName, childNodes: kids.map((k) => (typeof k === 'string' ? txt(k) : k)), ...o });

test('report version matches the service worker version', () => {
  const sw = readFileSync(new URL('../sw.js', import.meta.url), 'utf8');
  assert.equal(sw.match(/const VERSION = '([^']+)'/)[1], APP_VERSION);
});

test('screen text: lines, typed answers, crossed-out and highlighted parts', () => {
  const root = el('MAIN', [
    el('DIV', ['Übersetze:']),
    el('DIV', ['Ich bin gestern  ', el('SPAN', ['gegangen'])]),
    el('INPUT', [], { value: 'Ich habe gegangen' }),
    el('DIV', [el('DEL', ['habe']), ' ', el('INS', ['bin'])]),
    el('INPUT', [], { type: 'hidden', value: '' }),
    el('INPUT', [], { type: 'password', value: 'secret' }),
    el('DIV', ['nicht sichtbar'], { hidden: true }),
    el('DIV', ['auch nicht'], { classList: { contains: (c) => c === 'hidden' } }),
    el('RUBY', ['漢', el('RT', ['かん'])]),
    el('DIV', [el('SPAN', ['Lösung']), el('B', ['der Hund'])], { classList: { contains: (c) => c === 'kv' } }),
  ]);
  assert.equal(screenText(root), 'Übersetze:\nIch bin gestern gegangen\n[Eingabe: Ich habe gegangen]\n~~habe~~ **bin**\n漢\nLösung: der Hund');
});

test('exercise data leaves out pending requests and feedback HTML', () => {
  const task = { kind: 'word', word: { lemma: 'gehen' }, exPromise: Promise.resolve(), exError: new Error('boom'),
    state: { phase: 'feedback', grade: 'wrong', feedback: '<p>x</p>', verdict: 'Falsch' }, seen: new Set(['a']) };
  const data = JSON.parse(exerciseData(task));
  assert.equal(data.exPromise, undefined);
  assert.equal(data.exError, 'boom');
  assert.equal(data.state.feedback, undefined);
  assert.equal(data.state.verdict, 'Falsch');
  assert.deepEqual(data.seen, ['a']);
  assert.equal(exerciseData(null), '');
});

test('report without the screen sends only the description and basic fields', () => {
  const base = { text: ' Falsch markiert ', screen: 'session', screenTextValue: 'Bildschirm', exercise: '{}', language: 'de B2', uiLang: 'de', userAgent: 'UA' };
  const off = buildReport({ ...base, capture: false });
  assert.deepEqual(Object.keys(off).sort(), ['appVersion', 'language', 'screen', 'text', 'uiLang', 'userAgent']);
  assert.equal(off.text, 'Falsch markiert');
  const on = buildReport({ ...base, capture: true });
  assert.equal(on.screenText, 'Bildschirm');
  assert.equal(on.exercise, '{}');
  assert.equal(buildReport({ ...base, text: 'x'.repeat(3000) }).text.length, 2000);
});

test('issue: no email, no mentions, user text stays plain, corrections show as strike and highlight', () => {
  const issue = issueFromReport({ text: '@ravi **wichtig** <b>x</b>', appVersion: 'gt-v17', screen: 'session',
    screenText: 'Antwort: ~~habe~~ **bin** <script>', exercise: '{"a":"```"}' }, { reporter: 'abcd1234' });
  assert.equal(issue.title, 'Fehlerbericht: @ravi **wichtig** <b>x</b>');
  assert.deepEqual(issue.labels, ['user-report']);
  assert.ok(!issue.body.includes('@'));
  assert.ok(!issue.body.includes('<b>'));
  assert.ok(!issue.body.includes('**wichtig**'));
  assert.ok(issue.body.includes('<del>habe</del> <ins>bin</ins> &lt;script&gt;'));
  assert.ok(issue.body.includes('````json\n{"a":"```"}\n````'));
  assert.ok(issue.body.includes('abcd1234'));
  assert.equal(screenHtml('a ~~b~~'), 'a <del>b</del>');
});

test('issue without the screen says so', () => {
  assert.match(issueFromReport({ text: 'x' }).body, /Ohne Bildschirminhalt/);
});

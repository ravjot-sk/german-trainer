import test from 'node:test';
import assert from 'node:assert/strict';
import { newCode, normCode, isCode, CODE_LEN } from '../js/invites.js';

test('new codes are 8 characters without look-alikes', () => {
  for (let i = 0; i < 200; i++) {
    const c = newCode();
    assert.equal(c.length, CODE_LEN);
    assert.ok(isCode(c), c);
    assert.doesNotMatch(c, /[01IO]/);
  }
  // Matches the pattern firestore.rules accepts.
  assert.match(newCode(), /^[A-HJ-NP-Z2-9]{8}$/);
  assert.equal(newCode(() => [0, 31, 32, 255, 8, 9, 23, 24]), 'A9A9JKZ2');
});

test('typed codes are normalised before checking', () => {
  assert.equal(normCode(' abcd-2345 '), 'ABCD2345');
  assert.equal(normCode('abcd 2345'), 'ABCD2345');
  assert.ok(isCode(normCode('abcd-2345')));
  assert.equal(isCode('ABCD234'), false);
  assert.equal(isCode('ABCD2340'), false); // 0 is never used
  assert.equal(isCode(normCode(undefined)), false);
});

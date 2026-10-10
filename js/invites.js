// Invite codes: 8 characters without the look-alikes 0/O and 1/I, so they're easy to type from
// a message. firestore.rules checks the same format.
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
export const CODE_LEN = 8;
export const MAX_USES = 100;

export function newCode(random = (n) => crypto.getRandomValues(new Uint8Array(n))) {
  // 256 is a multiple of the 32 letters, so every letter is equally likely.
  return [...random(CODE_LEN)].map((b) => ALPHABET[b % ALPHABET.length]).join('');
}

// What someone typed or pasted: any case, with spaces or dashes.
export const normCode = (s) => String(s ?? '').toUpperCase().replace(/[\s-]/g, '');

export const isCode = (s) => s.length === CODE_LEN && [...s].every((c) => ALPHABET.includes(c));

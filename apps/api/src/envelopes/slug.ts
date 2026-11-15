import { randomInt } from 'node:crypto';

// No 0/o/1/l/i: easy to read aloud and retype from a chat message.
const ALPHABET = '23456789abcdefghjkmnpqrstuvwxyz';

export function randomSlug(length = 6): string {
  let s = '';
  for (let i = 0; i < length; i++) s += ALPHABET[randomInt(ALPHABET.length)];
  return s;
}

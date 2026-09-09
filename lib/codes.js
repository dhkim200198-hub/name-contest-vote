import { randomInt } from 'node:crypto';

// 혼동되는 글자(I, L, O, 0, 1) 제외
const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

export function makeCode() {
  const block = (n) => Array.from({ length: n }, () => ALPHABET[randomInt(ALPHABET.length)]).join('');
  return `${block(4)}-${block(4)}`;
}

export function makeCodes(n, existing = new Set()) {
  const out = [];
  const seen = new Set(existing);
  while (out.length < n) {
    const c = makeCode();
    if (seen.has(c)) continue;
    seen.add(c);
    out.push(c);
  }
  return out;
}

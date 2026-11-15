/** Sats as JSON numbers: safe because total BCH supply (2.1e15 sats) < 2^53. */
export const toNum = (v: bigint) => Number(v);

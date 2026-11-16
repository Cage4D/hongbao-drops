/** "bchtest:qqm4jyu8…t2h7" → "bchtest:qqm4…t2h7" — enough to recognise yourself, not to dox. */
export function truncateAddress(a: string): string {
  const [prefix, body = a] = a.includes(':') ? a.split(':') : ['', a];
  return `${prefix ? prefix + ':' : ''}${body.slice(0, 4)}…${body.slice(-4)}`;
}

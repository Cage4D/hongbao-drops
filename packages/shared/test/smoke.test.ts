import { describe, expect, it } from 'vitest';
import { CreateEnvelopeRequestSchema, ERROR_CATALOG, NetworkSchema, ThemeSchema } from '../src/index.js';

const valid = {
  senderAddress: 'bchtest:qqm4jyu8qcf94wp45qzgfjyqyz586w3jg5r8z4t2h7',
  linkPk: '02' + 'ab'.repeat(32),
  shareCount: 3,
  mode: 'EQUAL',
  totalSats: 30000,
  expiry: 1_800_000_000,
};

describe('shared', () => {
  it('parses enums', () => {
    expect(NetworkSchema.parse('CHIPNET')).toBe('CHIPNET');
    expect(() => ThemeSchema.parse('neon')).toThrow();
  });

  it('applies defaults and validates create requests', () => {
    const r = CreateEnvelopeRequestSchema.parse(valid);
    expect(r.theme).toBe('classic-red');
    expect(r.withSeals).toBe(true);
    expect(() => CreateEnvelopeRequestSchema.parse({ ...valid, linkPk: '04' + 'ab'.repeat(32) })).toThrow();
    expect(() => CreateEnvelopeRequestSchema.parse({ ...valid, extra: 1 })).toThrow();
  });

  it('requires quiz exactly for QUIZ mode', () => {
    expect(() => CreateEnvelopeRequestSchema.parse({ ...valid, mode: 'QUIZ' })).toThrow();
    expect(() => CreateEnvelopeRequestSchema.parse({ ...valid, quiz: { question: 'q', answers: ['a'] } })).toThrow();
    expect(CreateEnvelopeRequestSchema.parse({ ...valid, mode: 'QUIZ', quiz: { question: 'q?', answers: ['a'] } }).quiz?.answers).toEqual(['a']);
  });

  it('has HTTP codes for every error', () => {
    for (const e of Object.values(ERROR_CATALOG)) expect(e.http).toBeGreaterThanOrEqual(400);
  });
});

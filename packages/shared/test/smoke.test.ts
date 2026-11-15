import { describe, expect, it } from 'vitest';
import { NetworkSchema, ThemeSchema } from '../src/index.js';

describe('shared scaffold', () => {
  it('parses enums', () => {
    expect(NetworkSchema.parse('CHIPNET')).toBe('CHIPNET');
    expect(() => ThemeSchema.parse('neon')).toThrow();
  });
});

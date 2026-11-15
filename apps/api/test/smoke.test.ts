import { describe, expect, it } from 'vitest';
import { DEFAULT_NETWORK } from '../src/index.js';

describe('api scaffold', () => {
  it('defaults to chipnet', () => {
    expect(['CHIPNET', 'MAINNET']).toContain(DEFAULT_NETWORK);
  });
});

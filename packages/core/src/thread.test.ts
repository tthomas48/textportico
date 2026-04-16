import { describe, expect, it } from 'vitest';
import { computeThreadId, normalizeAddress } from './thread.js';

describe('thread helpers', () => {
  it('normalizes addresses', () => {
    expect(normalizeAddress('  +1 234 ')).toBe('+1234');
  });

  it('computes stable thread id regardless of order', () => {
    const a = computeThreadId('+100', '+200');
    const b = computeThreadId('+200', '+100');
    expect(a).toBe(b);
  });
});

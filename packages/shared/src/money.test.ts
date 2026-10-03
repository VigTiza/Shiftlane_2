import { describe, expect, it } from 'vitest';

import { formatMxn } from './money.js';

describe('formatMxn', () => {
  it('formatea pesos con separador de miles y dos decimales', () => {
    expect(formatMxn(2000)).toBe('$2,000.00');
    expect(formatMxn(379)).toBe('$379.00');
  });
});

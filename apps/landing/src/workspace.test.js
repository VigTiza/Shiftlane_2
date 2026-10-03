import { formatMxn } from '@shiftlane/shared';
import { describe, expect, it } from 'vitest';

describe('workspace', () => {
  it('usa el código compartido de @shiftlane/shared', () => {
    expect(formatMxn(474)).toBe('$474.00');
  });
});

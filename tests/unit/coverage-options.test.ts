import { describe, expect, it } from 'vitest';
import { unmeasured } from '../coverage-options';

describe('a Playwright web server writes no raw coverage (#913)', () => {
  it('unsets NODE_V8_COVERAGE before the command runs', () => {
    expect(unmeasured('npm run build && npm run preview')).toBe(
      'unset NODE_V8_COVERAGE; npm run build && npm run preview',
    );
  });
});

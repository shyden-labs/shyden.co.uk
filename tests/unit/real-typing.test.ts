import { afterEach, describe, expect, it, vi } from 'vitest';
import { selectAllKeys } from '../real-typing';

/**
 * The select-all keys typeInto clears a field with (#998). From a Mac,
 * `ControlOrMeta` is Meta, which Android Chrome ignores, so the phone run
 * appended to what a field held; the phone takes Control+A.
 */
describe('selectAllKeys', () => {
  afterEach(() => vi.unstubAllEnvs());

  it('is Control+A on the real Android phone', () => {
    vi.stubEnv('PW_REAL_DEVICE', '1');
    expect(selectAllKeys()).toBe('Control+A');
  });

  it("is ControlOrMeta+A everywhere else, the host's own select-all", () => {
    vi.stubEnv('PW_REAL_DEVICE', '');
    expect(selectAllKeys()).toBe('ControlOrMeta+A');
  });
});

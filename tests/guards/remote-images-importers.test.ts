import { describe, expect, it } from 'vitest';
import { importersIn } from '../remote-images';

/**
 * The walk of astro's whole `dist` that answers who imports
 * http-cache-semantics (#457), moved here from tests/unit/remote-images.test.ts
 * (#718): it reads every script of a dependency tree from disk, and on a
 * checkout installed moments before, whose files are not yet in the OS cache,
 * it timed out at the 1 s unit limit on 153 ms of CPU. A test that reads a
 * whole tree belongs in the guards suite. The unit suite keeps the reading
 * each file gets (`namesModule`, one test per specifier form).
 */
describe('the path into http-cache-semantics is the one #457 read', () => {
  it("inside astro, only the build's remote-image cache imports it", () => {
    expect(
      importersIn('node_modules/astro/dist', 'http-cache-semantics'),
    ).toEqual(['assets/build/remote.js']);
  });
});

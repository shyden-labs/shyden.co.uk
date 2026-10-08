import { describe, it, expect } from 'vitest';
import { dockerArgs, splitArgs } from '../../scripts/visual.mjs';
import { IMAGE } from '../visual-runner-shared';

/**
 * The container renders on the architecture CI compares on (#224).
 *
 * The baselines were captured on the operator's arm64 Mac and are compared on
 * CI's `x86_64` runner. Measured on run 35657436585: **every one of the ten**
 * differs at zero per-pixel tolerance, between 25% and 48% of all pixels. The
 * gate saw none of it, because `threshold: 0.1` scores a YIQ distance of ~352
 * as identical — so what the tolerance was really buying was a whole
 * architecture's worth of text rasterisation, and a real regression smaller
 * than that noise would ship green. That is #33 in a different medium.
 *
 * Operator decision, 2026-09-21: pin the architecture in the local capture
 * rather than record a reason not to, and re-capture all ten on it.
 */
describe('the visual container renders on CI architecture (#224)', () => {
  const argsFor = (update: boolean) =>
    dockerArgs({ image: IMAGE, cwd: '/repo', update, forwarded: [] });

  it('pins linux/amd64 when comparing', () => {
    const argv = argsFor(false);
    expect(argv[argv.indexOf('--platform') + 1]).toBe('linux/amd64');
  });

  it('pins it when CAPTURING too, which is where it decides the pixels', () => {
    // A comparison on the wrong architecture is a false red someone
    // investigates. A CAPTURE on the wrong architecture writes the drift into
    // the committed file, where it is invisible and permanent.
    const argv = argsFor(true);
    expect(argv[argv.indexOf('--platform') + 1]).toBe('linux/amd64');
  });

  it('pins it BEFORE the image, which is the only place docker reads it', () => {
    // `docker run [OPTIONS] IMAGE [COMMAND]`. A `--platform` after the image
    // name is not an option at all — it is handed to the entrypoint, where it
    // means nothing, and docker runs the host's architecture without a word.
    // Presence is not the assertion; position is.
    const argv = argsFor(false);
    expect(argv.indexOf('--platform')).toBeGreaterThan(-1);
    expect(argv.indexOf('--platform')).toBeLessThan(argv.indexOf(IMAGE));
  });
});

describe("Playwright's own update flag, forwarded (#390)", () => {
  it('takes the runner’s --update out, and forwards the rest in order', () => {
    expect(splitArgs(['-g', 'home', '--update', '--headed'])).toEqual({
      update: true,
      forwarded: ['-g', 'home', '--headed'],
    });
    expect(splitArgs(['-g', 'home'])).toEqual({
      update: false,
      forwarded: ['-g', 'home'],
    });
  });

  it.each([['--update-snapshots'], ['--update-snapshots=changed'], ['-u']])(
    'refuses %s, which would rewrite baselines past test:visual:update',
    (flag) => {
      expect(() => splitArgs(['-g', 'home', flag])).toThrow(
        `visual: ${flag} is Playwright's own update flag`,
      );
    },
  );
});

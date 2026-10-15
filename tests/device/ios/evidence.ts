import { execFileSync } from 'node:child_process';
import { appendFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { expect } from 'vitest';
import {
  EVIDENCE_MANIFEST,
  captureFile,
  manifestRow,
} from '../../../scripts/evidence-files.mjs';

/**
 * Capture, from the leg that cannot use `shoot`.
 *
 * `tests/e2e/evidence.ts` reads `test.info()` for the project name and the
 * title, which only exists under Playwright. These journeys run under Vitest
 * and drive a real iPhone over WebDriver, so `shoot` is not merely
 * inconvenient here -- it is uncallable.
 *
 * #189 AC11 is why this exists: the reported clipping case has to be confirmed
 * on a real phone, and an operator can only judge it by seeing it. The desktop
 * suite has to STUB the refused fullscreen grant (`addInitScript`); the phone
 * refuses natively, which is the whole point of asking for one.
 *
 * Two properties copied deliberately from `shoot`, because they are what make
 * the evidence worth anything:
 *
 * 1. **Captured DURING the run, never retrofitted**, and called AFTER the
 *    assertion it documents -- so the existence of the image is itself the
 *    result. Vitest stops a test at the first failed `expect`, exactly as
 *    Playwright does, so a missing shot is a failed or unreached assertion.
 * 2. **Free when not wanted.** Gated on `EVIDENCE_DIR`. A screenshot is a
 *    round trip to a physical device, so an ordinary gauntlet must not pay for
 *    captures nobody asked for.
 *
 * The format is PNG, not the JPEG every other leg writes: WebDriver returns
 * base64 PNG and re-encoding would mean a new dependency, which is an operator
 * decision. Nothing downstream cares -- `mediaType` in the page builder sniffs
 * MAGIC BYTES rather than the extension, and throws on anything it cannot
 * recognise instead of emitting a src the browser cannot paint. That seam is
 * asserted in `tests/unit/device-evidence.test.ts` against this leg's own
 * bytes, because neither side proves it alone.
 */

/**
 * The only thing a capture needs from a driver.
 *
 * Structural, not `WebDriver`, so the unit test can prove the counter, the
 * paths and the manifest row without a phone in the room -- and so that "did
 * not capture" is provable by a driver that counts its own calls.
 */
export interface Screenshotter {
  /** Base64 PNG, as WebDriver's `GET /screenshot` returns it. */
  screenshot(): Promise<string>;
}

/** What one capture says about itself; `order` is this module's to assign. */
export interface DeviceCapture {
  project: string;
  /**
   * The journey, spelled as the run report spells it. Left out, it is the
   * running test's name (`expect.getState().currentTestName`: its describes
   * and its title joined with ` > `), which is what the evidence page joins a
   * capture to its test by (#354). Given only where one test captures more
   * than one journey on purpose.
   */
  title?: string;
  label: string;
}

/**
 * The longest edge a capture is kept at: the phone's CSS viewport, not its
 * device pixels.
 *
 * `tests/e2e/evidence.ts` passes `scale: 'css'` for exactly this reason -- "a
 * device pixel ratio of 3 triples the bytes to say the same thing". WebDriver
 * offers no such option: `GET /screenshot` returns the full device-pixel
 * buffer, 1260x2736 on this phone at ~400KB a shot. Thirty of those is 12MB,
 * and the page builder REFUSED to write the evidence page at 23.48MB against
 * the 16MB one published document may carry.
 *
 * Trimming captures would have bought the same bytes by deleting evidence.
 * Resampling to CSS scale costs nine tenths of the pixels and no evidence at
 * all: measured, 387KB -> 92KB, 1260x2736 -> 420x912.
 */
const CSS_MAX_PX = 912;

/**
 * Resample a capture down to CSS scale, in place. Returns whether it ran.
 *
 * `sips` is a macOS built-in rather than a dependency, and this file is
 * already macOS-only by construction -- it needs `safaridriver` and a physical
 * iPhone on USB, neither of which exists anywhere else. Node has no image
 * resize of its own, and adding one would be an operator decision.
 *
 * DEGRADES, never fails: a capture at the wrong scale is still evidence, while
 * a journey that threw here would lose the assertion it was documenting. The
 * caller keeps the original bytes when this returns false.
 *
 * Only shrinks. `sips -Z` resamples to fit a MAXIMUM dimension, which would
 * happily UPSCALE a small image -- the 1x1 fixture in the unit tests would
 * become 912x912 -- so the size is read first and the resample is skipped
 * when there is nothing to shrink.
 */
export const shrinkToCssScale = (path: string): boolean => {
  try {
    const read = execFileSync(
      'sips',
      ['-g', 'pixelWidth', '-g', 'pixelHeight', path],
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] },
    );
    const longest = Math.max(
      ...[...read.matchAll(/pixel(?:Width|Height):\s*(\d+)/g)].map((m) =>
        Number(m[1]),
      ),
    );
    if (!Number.isFinite(longest) || longest <= CSS_MAX_PX) return false;

    execFileSync('sips', ['-Z', String(CSS_MAX_PX), path], {
      stdio: ['ignore', 'ignore', 'ignore'],
    });
    return true;
  } catch {
    return false;
  }
};

const counters = new Map<string, number>();

/**
 * Forget the per-journey capture numbering.
 *
 * Exported for the unit test alone. A counter that survived between test cases
 * would number the second case's first shot `02`, and the assertion would then
 * be describing test order rather than the journey.
 */
export const resetDeviceCaptureCounters = (): void => counters.clear();

/**
 * Record one assertion as an image plus a manifest line.
 *
 * `EVIDENCE_DIR` is read HERE rather than once at module load, unlike
 * `tests/e2e/evidence.ts`. The device harness spawns each group with its own
 * environment (`scripts/test-devices.mjs`), and a module-level read is also a
 * value no test can change without resetting the module registry.
 *
 * Returns the manifest-relative path it wrote, or `null` when no evidence was
 * asked for, so a caller can assert what happened rather than infer it.
 */
export const shootDevice = async (
  driver: Screenshotter,
  capture: DeviceCapture,
  now: () => Date = () => new Date(),
): Promise<string | null> => {
  const dir = process.env.EVIDENCE_DIR;
  if (!dir) return null;

  const { project, label } = capture;
  const title = capture.title ?? expect.getState().currentTestName;
  if (!title)
    throw new Error(
      `shootDevice(${label}): no title was given and no test is running, so ` +
        'the capture names no journey the evidence page could join it to',
    );
  const key = `${project}|${title}`;
  const order = (counters.get(key) ?? 0) + 1;
  counters.set(key, order);

  const file = captureFile({ project, title, order, label, ext: 'png' });

  mkdirSync(dirname(join(dir, file)), { recursive: true });
  writeFileSync(
    join(dir, file),
    Buffer.from(await driver.screenshot(), 'base64'),
  );
  shrinkToCssScale(join(dir, file));
  appendFileSync(
    join(dir, EVIDENCE_MANIFEST),
    JSON.stringify(manifestRow({ project, title, order, label, file }, now())) +
      '\n',
    'utf8',
  );

  return file;
};

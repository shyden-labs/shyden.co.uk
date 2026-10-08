import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';
import { crc32, deflateSync } from 'node:zlib';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { mediaType } from '../../scripts/build-evidence-page.mjs';
import { scratchDir } from '../scratch-dir';
import {
  EVIDENCE_MANIFEST,
  captureFile,
  manifestRow,
} from '../../scripts/evidence-files.mjs';
import {
  resetDeviceCaptureCounters,
  shootDevice,
  shrinkToCssScale,
} from '../device/ios/evidence';
import { PNG_BASE64, fakeDriver } from '../device-evidence-shared';

/**
 * A real RGB PNG of any size, one grey, encoded here because nothing in the
 * tree writes PNGs and a new dependency is an operator decision.
 */
const pngOf = (width: number, height: number): Buffer => {
  const chunk = (type: string, data: Buffer) => {
    const length = Buffer.alloc(4);
    length.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type, 'latin1'), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(body));
    return Buffer.concat([length, body, crc]);
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header.writeUInt8(8, 8); // bit depth
  header.writeUInt8(2, 9); // colour type: RGB
  // Each scanline is a filter byte (0, none) and then its pixels.
  const row = Buffer.concat([Buffer.from([0]), Buffer.alloc(width * 3, 0x80)]);
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(Buffer.concat(Array(height).fill(row)))),
    chunk('IEND', Buffer.alloc(0)),
  ]);
};

/** Width and height from a PNG's IHDR, which always sits at byte 16. */
const pngSize = (png: Buffer) => ({
  width: png.readUInt32BE(16),
  height: png.readUInt32BE(20),
});

const evidenceDir = () => scratchDir('device-evidence-');

const rowsIn = (dir: string) =>
  readFileSync(join(dir, EVIDENCE_MANIFEST), 'utf8')
    .split('\n')
    .filter((line) => line.trim() !== '')
    .map((line) => JSON.parse(line));

afterEach(() => {
  vi.unstubAllEnvs();
  resetDeviceCaptureCounters();
});

describe('the device leg writes the same evidence every other leg does', () => {
  it('writes the image and exactly one manifest row, through the shared row builder', async () => {
    const dir = evidenceDir();
    vi.stubEnv('EVIDENCE_DIR', dir);
    const driver = fakeDriver();
    const at = new Date('2026-09-16T12:00:00.000Z');

    const file = await shootDevice(
      driver,
      {
        project: 'ios-safari-real-device',
        title: 'Journey 14 -- the board on a refused grant',
        label: 'nothing out of reach',
      },
      () => at,
    );

    // The positive control for the test above: the same helper DOES call the
    // phone once a directory is asked for, so `toBe(0)` there is a decision
    // this code makes and not a fake driver that never worked.
    expect(driver.calls(), 'the phone was asked exactly once').toBe(1);

    expect(file).toBe(
      captureFile({
        project: 'ios-safari-real-device',
        title: 'Journey 14 -- the board on a refused grant',
        order: 1,
        label: 'nothing out of reach',
        ext: 'png',
      }),
    );
    expect(existsSync(join(dir, file!)), `${file} was written`).toBe(true);

    const rows = rowsIn(dir);
    expect(rows).toEqual([
      manifestRow(
        {
          project: 'ios-safari-real-device',
          title: 'Journey 14 -- the board on a refused grant',
          order: 1,
          label: 'nothing out of reach',
          file: file!,
        },
        at,
      ),
    ]);
  });

  it('writes bytes the page builder can still recognise -- the seam, not the sides', async () => {
    const dir = evidenceDir();
    vi.stubEnv('EVIDENCE_DIR', dir);

    const file = await shootDevice(fakeDriver(), {
      project: 'ios-safari-real-device',
      title: 'Journey 14 -- the board on a refused grant',
      label: 'nothing out of reach',
    });

    // Asserting the builder's own sniffer against the device leg's own bytes.
    // Either side alone proves nothing: the builder is happy with PNG in the
    // abstract, and this leg is happy to write whatever WebDriver hands back.
    expect(mediaType(readFileSync(join(dir, file!)))).toBe('image/png');
  });

  it('leaves a capture alone rather than losing it when it cannot be resampled', () => {
    const dir = evidenceDir();
    const notAnImage = join(dir, 'not-an-image.png');
    writeFileSync(notAnImage, 'this is not a PNG', 'utf8');

    // DEGRADES, never throws: a capture at the wrong scale is still evidence,
    // while a journey that threw here would lose the assertion it documents.
    expect(shrinkToCssScale(notAnImage)).toBe(false);
    expect(readFileSync(notAnImage, 'utf8')).toBe('this is not a PNG');
  });

  it('does not UPSCALE a capture that is already within CSS scale', async () => {
    const dir = evidenceDir();
    vi.stubEnv('EVIDENCE_DIR', dir);

    // `sips -Z` resamples to fit a MAXIMUM dimension, so an unguarded call
    // would blow this 1x1 fixture up to 912x912 -- bigger bytes to say less.
    const file = await shootDevice(fakeDriver(), {
      project: 'ios-safari-real-device',
      title: 'Journey 14 -- the projector board on a refused grant',
      label: 'nothing out of reach',
    });

    const written = readFileSync(join(dir, file!));
    expect(written.length, 'a 1x1 capture was not resampled upwards').toBe(
      Buffer.from(PNG_BASE64, 'base64').length,
    );
  });

  // The leg runs only on a Mac (safaridriver, an iPhone on USB), and `sips` is
  // a macOS built-in, so elsewhere there is nothing here to measure: a Linux
  // runner has no `sips`, and the resample degrades to a no-op by design.
  it.runIf(process.platform === 'darwin')(
    'shrinks a full-size phone capture to CSS scale, read back from its own header',
    async () => {
      const dir = evidenceDir();
      vi.stubEnv('EVIDENCE_DIR', dir);

      // The phone's device-pixel buffer, 1260x2736: thirty of these pushed the
      // evidence page to 23.48MB against the 16MB one document may carry.
      const file = await shootDevice(
        fakeDriver(pngOf(1260, 2736).toString('base64')),
        {
          project: 'ios-safari-real-device',
          title: 'Journey 14 -- the board on a refused grant',
          label: 'nothing out of reach',
        },
      );

      // Read from the IHDR bytes rather than asked of `sips`, so the tool
      // that did the resample is not also the one that vouches for it.
      expect(pngSize(readFileSync(join(dir, file!)))).toEqual({
        width: 420,
        height: 912,
      });
    },
  );

  // The test above this one never reaches the catch on a Mac: measured,
  // `sips -g` exits 0 on a file it cannot read (`pixelWidth: <nil>`), so the
  // size is unknown and the resample is skipped. The catch is reached when the
  // size reads and the resample itself fails: here a read-only folder, where
  // `sips -Z` exits 13 and writes nothing.
  it.runIf(process.platform === 'darwin')(
    'keeps the capture as it was when the resample itself fails',
    () => {
      const dir = join(evidenceDir(), 'read-only');
      mkdirSync(dir);
      const capture = join(dir, 'capture.png');
      const phoneSize = pngOf(1260, 2736);
      writeFileSync(capture, phoneSize);
      chmodSync(dir, 0o555);
      try {
        expect(shrinkToCssScale(capture)).toBe(false);
        expect(Buffer.compare(readFileSync(capture), phoneSize)).toBe(0);
      } finally {
        chmodSync(dir, 0o755);
      }
    },
  );

  it('numbers repeat captures within one journey, and starts each journey again at one', async () => {
    const dir = evidenceDir();
    vi.stubEnv('EVIDENCE_DIR', dir);
    const driver = fakeDriver();
    const journey = {
      project: 'ios-safari-real-device',
      title: 'Journey 14 -- the board on a refused grant',
    };

    await shootDevice(driver, { ...journey, label: 'before full screen' });
    await shootDevice(driver, { ...journey, label: 'nothing out of reach' });
    await shootDevice(driver, {
      ...journey,
      title: 'Journey 1 -- groups render',
      label: 'twelve students',
    });

    expect(rowsIn(dir).map((r) => [r.title, r.order, r.label])).toEqual([
      [journey.title, 1, 'before full screen'],
      [journey.title, 2, 'nothing out of reach'],
      ['Journey 1 -- groups render', 1, 'twelve students'],
    ]);
  });
});

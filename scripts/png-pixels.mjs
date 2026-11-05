/**
 * The pixels of a visual baseline, and how many two renders disagree on
 * (#678). Plain Node (zlib and the five PNG row filters), so no package is
 * added (CLAUDE.md: a new npm package is an operator decision).
 *
 * The capture (`visual-capture.mjs`) commits a rewritten baseline only when
 * more than `CAPTURE_PIXEL_RULE` pixels differ, and these two functions are
 * how it counts. Measured with this decoder on every baseline rewrite on
 * develop (2026-10-11, #678): untouched pages differed by 1 to 17 pixels, real
 * changes by 210 or more.
 */
import { inflateSync } from 'node:zlib';

const SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/** Channels per pixel for the colour types a baseline can be: RGB and RGBA. */
const CHANNELS = new Map([
  [2, 3],
  [6, 4],
]);

/**
 * @typedef {{ width: number, height: number, channels: number, pixels: Buffer }} Picture
 */

/**
 * The 8-bit RGB or RGBA pixels of a PNG, row after row. Anything else (a
 * palette, 16-bit depth, interlacing) is refused rather than misread: a
 * misread picture would count as changed or quiet for the wrong reason.
 *
 * @param {Uint8Array} file
 * @returns {Picture}
 */
export const decodePng = (file) => {
  const bytes = Buffer.from(file.buffer, file.byteOffset, file.byteLength);
  if (bytes.length < 8 || !bytes.subarray(0, 8).equals(SIGNATURE))
    throw new Error(
      'not a PNG: the first eight bytes are not the PNG signature',
    );
  let width = 0;
  let height = 0;
  let depth = 0;
  let type = 0;
  let interlace = 0;
  /** @type {Buffer[]} */
  const data = [];
  for (let at = 8; at + 8 <= bytes.length;) {
    const length = bytes.readUInt32BE(at);
    const kind = bytes.toString('latin1', at + 4, at + 8);
    const body = bytes.subarray(at + 8, at + 8 + length);
    if (kind === 'IHDR') {
      width = body.readUInt32BE(0);
      height = body.readUInt32BE(4);
      depth = body[8] ?? 0;
      type = body[9] ?? 0;
      interlace = body[12] ?? 0;
    } else if (kind === 'IDAT') data.push(body);
    at += 12 + length;
  }
  const channels = CHANNELS.get(type);
  if (depth !== 8 || channels === undefined || interlace !== 0)
    throw new Error(
      `unsupported PNG (depth ${depth}, colour type ${type}, interlace ${interlace}): ` +
        'baselines are 8-bit RGB or RGBA, not interlaced',
    );
  const raw = inflateSync(Buffer.concat(data));
  const stride = width * channels;
  const pixels = Buffer.alloc(height * stride);
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)];
    for (let x = 0; x < stride; x++) {
      const left = x >= channels ? (pixels[y * stride + x - channels] ?? 0) : 0;
      const up = y > 0 ? (pixels[(y - 1) * stride + x] ?? 0) : 0;
      const corner =
        x >= channels && y > 0
          ? (pixels[(y - 1) * stride + x - channels] ?? 0)
          : 0;
      const value = raw[y * (stride + 1) + 1 + x] ?? 0;
      pixels[y * stride + x] =
        (value + predict(filter, left, up, corner)) & 255;
    }
  }
  return { width, height, channels, pixels };
};

/**
 * What row filter `filter` predicted a byte to be from its neighbours.
 *
 * @param {number | undefined} filter
 * @param {number} left
 * @param {number} up
 * @param {number} corner
 * @returns {number}
 */
const predict = (filter, left, up, corner) => {
  if (filter === 0) return 0;
  if (filter === 1) return left;
  if (filter === 2) return up;
  if (filter === 3) return (left + up) >> 1;
  if (filter === 4) {
    const guess = left + up - corner;
    const toLeft = Math.abs(guess - left);
    const toUp = Math.abs(guess - up);
    const toCorner = Math.abs(guess - corner);
    return toLeft <= toUp && toLeft <= toCorner
      ? left
      : toUp <= toCorner
        ? up
        : corner;
  }
  throw new Error(`unknown PNG row filter ${filter}`);
};

/**
 * How many pixels two renders disagree on, at zero tolerance: a pixel counts
 * once however many of its channels moved. A pixel without alpha is opaque.
 * Two renders of different sizes have no such count, so the answer is
 * `undefined`.
 *
 * @param {Picture} before
 * @param {Picture} after
 * @returns {number | undefined}
 */
export const differingPixels = (before, after) => {
  if (before.width !== after.width || before.height !== after.height)
    return undefined;
  let differing = 0;
  for (let pixel = 0; pixel < before.width * before.height; pixel++) {
    for (let channel = 0; channel < 4; channel++) {
      if (
        channelOf(before, pixel, channel) !== channelOf(after, pixel, channel)
      ) {
        differing++;
        break;
      }
    }
  }
  return differing;
};

/**
 * @param {Picture} picture
 * @param {number} pixel
 * @param {number} channel 0-2 colour, 3 alpha
 * @returns {number}
 */
const channelOf = (picture, pixel, channel) =>
  channel < picture.channels
    ? (picture.pixels[pixel * picture.channels + channel] ?? 0)
    : 255;

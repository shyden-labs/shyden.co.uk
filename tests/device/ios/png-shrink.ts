import { crc32, deflateSync, inflateSync } from 'node:zlib';

/**
 * Shrinks a phone capture in-process (#1069), on Node's own `zlib`, so the
 * resample is the same on a Mac and on CI's Linux runner. It replaced `sips`,
 * a macOS built-in that left the resample untested anywhere automated.
 *
 * Reads what a phone capture is: 8-bit RGB or RGBA, not interlaced. Anything
 * else is refused by name, and the caller keeps the capture as it was.
 */

/** A decoded 8-bit PNG: `channels` bytes per pixel, rows top to bottom. */
export interface Image {
  width: number;
  height: number;
  channels: 3 | 4;
  pixels: Buffer;
}

const SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
const RGB = 2;
const RGBA = 6;

const paeth = (a: number, b: number, c: number): number => {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  if (pa <= pb && pa <= pc) return a;
  return pb <= pc ? b : c;
};

/** The width and height the IHDR declares, read without decoding. */
const declaredSize = (png: Buffer): { width: number; height: number } => {
  if (png.length < 24 || !png.subarray(0, 8).equals(SIGNATURE))
    throw new Error('not a PNG: the signature is missing');
  return { width: png.readUInt32BE(16), height: png.readUInt32BE(20) };
};

export function decodePng(png: Buffer): Image {
  const { width, height } = declaredSize(png);
  let header: Buffer | undefined;
  const data: Buffer[] = [];
  for (let at = 8; at + 8 <= png.length;) {
    const length = png.readUInt32BE(at);
    const type = png.toString('latin1', at + 4, at + 8);
    const body = png.subarray(at + 8, at + 8 + length);
    if (type === 'IHDR') header = body;
    else if (type === 'IDAT') data.push(body);
    else if (type === 'IEND') break;
    at += 12 + length;
  }
  if (header === undefined) throw new Error('not a PNG: no IHDR chunk');
  const [depth, colour, , , interlace] = header.subarray(8, 13);
  if (depth !== 8) throw new Error(`unsupported PNG: bit depth ${depth}`);
  if (colour !== RGB && colour !== RGBA)
    throw new Error(`unsupported PNG: colour type ${colour}`);
  if (interlace !== 0) throw new Error('unsupported PNG: interlaced');

  const channels = colour === RGBA ? 4 : 3;
  const stride = width * channels;
  const raw = inflateSync(Buffer.concat(data));
  if (raw.length !== height * (stride + 1))
    throw new Error(
      `corrupt PNG: ${raw.length} bytes of image data, ${height * (stride + 1)} declared`,
    );

  const pixels = Buffer.alloc(height * stride);
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)];
    const line = y * (stride + 1) + 1;
    const row = y * stride;
    const above = row - stride;
    for (let i = 0; i < stride; i++) {
      const a = i >= channels ? pixels[row + i - channels] : 0;
      const b = y > 0 ? pixels[above + i] : 0;
      const c = y > 0 && i >= channels ? pixels[above + i - channels] : 0;
      let predictor: number;
      if (filter === 0) predictor = 0;
      else if (filter === 1) predictor = a;
      else if (filter === 2) predictor = b;
      else if (filter === 3) predictor = (a + b) >> 1;
      else if (filter === 4) predictor = paeth(a, b, c);
      else throw new Error(`corrupt PNG: row ${y} has filter ${filter}`);
      pixels[row + i] = (raw[line + i] + predictor) & 0xff;
    }
  }
  return { width, height, channels, pixels };
}

const chunk = (type: string, body: Buffer): Buffer => {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(body.length);
  const typed = Buffer.concat([Buffer.from(type, 'latin1'), body]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(typed));
  return Buffer.concat([length, typed, crc]);
};

function encodePng({ width, height, channels, pixels }: Image): Buffer {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header.writeUInt8(8, 8);
  header.writeUInt8(channels === 4 ? RGBA : RGB, 9);
  const stride = width * channels;
  const raw = Buffer.alloc(height * (stride + 1));
  for (let y = 0; y < height; y++)
    pixels.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  return Buffer.concat([
    SIGNATURE,
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/** Each output pixel is the mean of the block of source pixels it covers. */
function boxShrink(image: Image, width: number, height: number): Image {
  const { channels, pixels } = image;
  const out = Buffer.alloc(width * height * channels);
  for (let y = 0; y < height; y++) {
    const top = Math.floor((y * image.height) / height);
    const bottom = Math.floor(((y + 1) * image.height) / height);
    for (let x = 0; x < width; x++) {
      const left = Math.floor((x * image.width) / width);
      const right = Math.floor(((x + 1) * image.width) / width);
      const count = (bottom - top) * (right - left);
      for (let k = 0; k < channels; k++) {
        let sum = 0;
        for (let sy = top; sy < bottom; sy++)
          for (let sx = left; sx < right; sx++)
            sum += pixels[(sy * image.width + sx) * channels + k];
        out[(y * width + x) * channels + k] = Math.round(sum / count);
      }
    }
  }
  return { width, height, channels, pixels: out };
}

/**
 * `png` with its longest side fitted to `maxPx`, or undefined when it already
 * fits: this only ever shrinks, never enlarges. Throws on a PNG it cannot read.
 */
export function shrinkPng(png: Buffer, maxPx: number): Buffer | undefined {
  const { width, height } = declaredSize(png);
  const longest = Math.max(width, height);
  if (longest <= maxPx) return undefined;
  const scale = maxPx / longest;
  return encodePng(
    boxShrink(
      decodePng(png),
      Math.max(1, Math.round(width * scale)),
      Math.max(1, Math.round(height * scale)),
    ),
  );
}

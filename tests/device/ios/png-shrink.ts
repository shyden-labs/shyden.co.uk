/** A decoded 8-bit PNG: `channels` bytes per pixel, rows top to bottom. */
export interface Image {
  width: number;
  height: number;
  channels: 3 | 4;
  pixels: Buffer;
}

export function decodePng(_png: Buffer): Image {
  throw new Error('not written yet (#1069)');
}

export function shrinkPng(_png: Buffer, _maxPx: number): Buffer | undefined {
  throw new Error('not written yet (#1069)');
}

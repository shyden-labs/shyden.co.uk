import { describe, expect, it } from 'vitest';
import {
  FrameReader,
  MAX_FRAME_LENGTH,
  encodeLengthFrame,
  encodeUsbmuxFrame,
} from '../device/ios/inspector/framing';

/**
 * usbmuxd frames (16-byte little-endian header: total length, version 1,
 * type 8 for a plist, tag) and lockdown's and the Web Inspector service's
 * frames (4-byte big-endian length), read back as they arrive in pieces
 * (#811; layout read from appium-ios-device 3.1.24, 2026-10-16).
 */
const PAYLOAD = Buffer.from('payload');
const USBMUX = encodeUsbmuxFrame(5, PAYLOAD);
const LENGTH = encodeLengthFrame(PAYLOAD);

describe('writes frames', () => {
  it('a usbmuxd header: length 23, version 1, type 8, tag 5, little-endian', () => {
    expect(USBMUX.subarray(0, 16).toString('hex')).toBe(
      '17000000010000000800000005000000',
    );
    expect(USBMUX.subarray(16)).toEqual(PAYLOAD);
  });
  it('a length frame: 7, big-endian, then the payload', () => {
    expect(LENGTH.toString('hex')).toBe(`00000007${PAYLOAD.toString('hex')}`);
  });
});

describe('reads a usbmuxd frame split at every byte', () => {
  for (let split = 1; split < USBMUX.length; split += 1) {
    it(`split after byte ${split}`, () => {
      const reader = new FrameReader('usbmux');
      // Both pushes in one verdict: the first yields nothing, the second the frame.
      const yielded = [
        reader.push(USBMUX.subarray(0, split)),
        reader.push(USBMUX.subarray(split)),
      ];
      expect(yielded).toEqual([[], [{ tag: 5, payload: PAYLOAD }]]);
    });
  }
});

describe('reads a length frame split at every byte', () => {
  for (let split = 1; split < LENGTH.length; split += 1) {
    it(`split after byte ${split}`, () => {
      const reader = new FrameReader('length');
      // Both pushes in one verdict: the first yields nothing, the second the frame.
      const yielded = [
        reader.push(LENGTH.subarray(0, split)),
        reader.push(LENGTH.subarray(split)),
      ];
      expect(yielded).toEqual([[], [{ tag: 0, payload: PAYLOAD }]]);
    });
  }
});

describe('reads what arrives together', () => {
  it('two frames in one chunk, in order', () => {
    const reader = new FrameReader('length');
    const second = encodeLengthFrame(Buffer.from('two'));
    expect(reader.push(Buffer.concat([LENGTH, second]))).toEqual([
      { tag: 0, payload: PAYLOAD },
      { tag: 0, payload: Buffer.from('two') },
    ]);
  });
  it('keeps the bytes after the last whole frame for whoever reads next', () => {
    const reader = new FrameReader('usbmux');
    reader.push(Buffer.concat([USBMUX, Buffer.from('tunnel')]));
    expect(reader.takeRemainder()).toEqual(Buffer.from('tunnel'));
    expect(reader.takeRemainder()).toEqual(Buffer.alloc(0));
  });
});

describe('refuses a frame it cannot trust, by name', () => {
  it('a usbmuxd version other than 1', () => {
    const frame = Buffer.from(USBMUX);
    frame.writeUInt32LE(2, 4);
    expect(() => new FrameReader('usbmux').push(frame)).toThrow(
      /usbmuxd frame of version 2, type 8/,
    );
  });
  it('a usbmuxd length shorter than its own header', () => {
    const frame = Buffer.from(USBMUX);
    frame.writeUInt32LE(4, 0);
    expect(() => new FrameReader('usbmux').push(frame)).toThrow(
      /claims 4 bytes, less than its 16-byte header/,
    );
  });
  it('a length past the ceiling', () => {
    const header = Buffer.alloc(4);
    header.writeUInt32BE(MAX_FRAME_LENGTH + 1, 0);
    expect(() => new FrameReader('length').push(header)).toThrow(
      /past the 20971520-byte ceiling/,
    );
  });
});

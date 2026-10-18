/**
 * The two frame shapes on the way to Safari's Web Inspector (#811; read
 * from appium-ios-device 3.1.24 on 2026-10-16, re-pinned from the phone's
 * own bytes in step 1 of Part B):
 *
 * - usbmuxd: a 16-byte little-endian header (total length including the
 *   header, version 1, type 8 for a plist, a tag the answer echoes), then
 *   an XML plist.
 * - lockdown and the Web Inspector service: a 4-byte big-endian length,
 *   then a plist.
 *
 * A socket delivers bytes in whatever pieces it likes, so FrameReader
 * keeps what it has until a frame is whole.
 */
export const USBMUX_HEADER_LENGTH = 16;
const LENGTH_HEADER = 4;
const USBMUX_VERSION = 1;
const USBMUX_PLIST = 8;
/** appium-ios-device's ceiling for the Web Inspector service; nothing the phone sends here comes near it. */
export const MAX_FRAME_LENGTH = 20 * 1024 * 1024;

/** A frame whose header cannot be trusted; the connection is not read further. */
export class FrameError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'FrameError';
  }
}

export interface Frame {
  /** usbmuxd's tag; 0 for a length frame, which has none. */
  readonly tag: number;
  readonly payload: Buffer;
}

export function encodeUsbmuxFrame(tag: number, payload: Buffer): Buffer {
  const header = Buffer.alloc(USBMUX_HEADER_LENGTH);
  header.writeUInt32LE(USBMUX_HEADER_LENGTH + payload.length, 0);
  header.writeUInt32LE(USBMUX_VERSION, 4);
  header.writeUInt32LE(USBMUX_PLIST, 8);
  header.writeUInt32LE(tag, 12);
  return Buffer.concat([header, payload]);
}

export function encodeLengthFrame(payload: Buffer): Buffer {
  const header = Buffer.alloc(LENGTH_HEADER);
  header.writeUInt32BE(payload.length, 0);
  return Buffer.concat([header, payload]);
}

export class FrameReader {
  private pending: Buffer = Buffer.alloc(0);

  constructor(private readonly kind: 'usbmux' | 'length') {}

  /** Adds bytes as they arrive; returns every frame now whole, in order. */
  push(chunk: Buffer): Frame[] {
    this.pending =
      this.pending.length === 0 ? chunk : Buffer.concat([this.pending, chunk]);
    const frames: Frame[] = [];
    const headerLength =
      this.kind === 'usbmux' ? USBMUX_HEADER_LENGTH : LENGTH_HEADER;
    for (;;) {
      if (this.pending.length < headerLength) return frames;
      const total =
        this.kind === 'usbmux'
          ? this.pending.readUInt32LE(0)
          : LENGTH_HEADER + this.pending.readUInt32BE(0);
      if (total < headerLength) {
        throw new FrameError(
          `a usbmuxd frame claims ${total} bytes, less than its ${headerLength}-byte header`,
        );
      }
      if (total - headerLength > MAX_FRAME_LENGTH) {
        throw new FrameError(
          `a ${this.kind} frame of ${total - headerLength} bytes is past the ${MAX_FRAME_LENGTH}-byte ceiling`,
        );
      }
      if (this.kind === 'usbmux') {
        const version = this.pending.readUInt32LE(4);
        const type = this.pending.readUInt32LE(8);
        if (version !== USBMUX_VERSION || type !== USBMUX_PLIST) {
          throw new FrameError(
            `a usbmuxd frame of version ${version}, type ${type}: this client reads version 1, type 8`,
          );
        }
      }
      if (this.pending.length < total) return frames;
      const tag = this.kind === 'usbmux' ? this.pending.readUInt32LE(12) : 0;
      frames.push({
        tag,
        payload: Buffer.from(this.pending.subarray(headerLength, total)),
      });
      this.pending = this.pending.subarray(total);
    }
  }

  /** The bytes after the last whole frame: a tunnel's first bytes once usbmuxd hands the socket over. */
  takeRemainder(): Buffer {
    const rest = Buffer.from(this.pending);
    this.pending = Buffer.alloc(0);
    return rest;
  }
}

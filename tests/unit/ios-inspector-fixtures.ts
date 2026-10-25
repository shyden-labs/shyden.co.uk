import { readFileSync } from 'node:fs';

/**
 * The phone's own exchanges, recorded on the iPhone Air (iOS 27.0.1) on
 * 2026-10-24 and redacted before they were written (#811 Task 4). Each is a
 * frame's payload without its header, in the order it crossed the wire.
 */
export type Channel = 'usbmux' | 'lockdown' | 'wir';
export type Direction = 'out' | 'in';

interface RecordedFrame {
  readonly channel: Channel;
  readonly dir: Direction;
  readonly base64: string;
  readonly redacted?: boolean;
}

const FRAMES = (
  JSON.parse(
    readFileSync(
      new URL(
        './fixtures/ios-inspector/exchanges-2026-10-24.json',
        import.meta.url,
      ),
      'utf8',
    ),
  ) as { frames: RecordedFrame[] }
).frames;

export function recordedFrames(
  channel: Channel,
  dir: Direction,
): readonly Buffer[] {
  return FRAMES.filter(
    (frame) => frame.channel === channel && frame.dir === dir,
  ).map((frame) => Buffer.from(frame.base64, 'base64'));
}

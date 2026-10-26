import { EventEmitter } from 'node:events';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  encodeLengthFrame,
  encodeUsbmuxFrame,
  FrameError,
} from '../device/ios/inspector/framing';
import {
  CeilingError,
  FrameLink,
  LinkError,
  socketTransport,
} from '../device/ios/inspector/link';
import { recordedFrames } from './ios-inspector-fixtures';
import { FakeTransport } from './ios-inspector-transport';

/** The link between the inspector and the phone: frames over any byte transport, each wait with a ceiling (#811 Task 5). */

/** The shortest frame the phone sent on a length link, header included: the fewest split points to walk. */
const SHORTEST = recordedFrames('wir', 'in')
  .map((payload) => encodeLengthFrame(payload))
  .reduce((a, b) => (b.length < a.length ? b : a));
const SHORTEST_PAYLOAD = SHORTEST.subarray(4);

describe('sending', () => {
  it('a length link writes the payload behind its 4-byte length', () => {
    const transport = new FakeTransport();
    new FrameLink(transport, 'length').send(Buffer.from('abc'));
    expect(transport.written).toEqual([
      Buffer.from([0, 0, 0, 3, 0x61, 0x62, 0x63]),
    ]);
  });

  it("a usbmux link writes usbmuxd's 16-byte header with the tag", () => {
    const transport = new FakeTransport();
    new FrameLink(transport, 'usbmux').send(Buffer.from('ab'), 7);
    expect(transport.written).toEqual([
      Buffer.from([
        18, 0, 0, 0, 1, 0, 0, 0, 8, 0, 0, 0, 7, 0, 0, 0, 0x61, 0x62,
      ]),
    ]);
  });
});

describe(`a ${SHORTEST.length}-byte recorded frame split in two`, () => {
  const points = Array.from({ length: SHORTEST.length - 1 }, (_, i) => i + 1);
  it.each(points)('at byte %i still arrives whole', async (k) => {
    const transport = new FakeTransport();
    const link = new FrameLink(transport, 'length');
    const next = link.next('a split frame', 1000);
    transport.deliver(SHORTEST.subarray(0, k));
    transport.deliver(SHORTEST.subarray(k));
    expect((await next).payload).toEqual(SHORTEST_PAYLOAD);
  });
});

describe('frames and the waits for them', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('two frames in one chunk answer two waits in order', async () => {
    const transport = new FakeTransport();
    const link = new FrameLink(transport, 'length');
    const first = link.next('the first', 1000);
    const second = link.next('the second', 1000);
    transport.deliver(
      Buffer.concat([
        encodeLengthFrame(Buffer.from('one')),
        encodeLengthFrame(Buffer.from('two')),
      ]),
    );
    expect((await first).payload.toString()).toBe('one');
    expect((await second).payload.toString()).toBe('two');
  });

  it('a frame that arrives before anyone waits is kept for the next wait', async () => {
    const transport = new FakeTransport();
    const link = new FrameLink(transport, 'length');
    transport.deliver(encodeLengthFrame(Buffer.from('early')));
    expect((await link.next('an early frame', 1000)).payload.toString()).toBe(
      'early',
    );
  });

  it('a wait past its ceiling fails naming what it waited for and how long', async () => {
    const link = new FrameLink(new FakeTransport(), 'usbmux');
    const next = link.next('ListDevices answer', 10_000);
    const verdict = expect(next).rejects.toThrow(/ListDevices answer.*10 s/);
    await vi.advanceTimersByTimeAsync(10_000);
    await verdict;
    await expect(next).rejects.toBeInstanceOf(CeilingError);
  });

  it('a wait is still pending one millisecond before its ceiling', async () => {
    const transport = new FakeTransport();
    const link = new FrameLink(transport, 'length');
    const next = link.next('a late frame', 10_000);
    await vi.advanceTimersByTimeAsync(9_999);
    transport.deliver(encodeLengthFrame(Buffer.from('late')));
    expect((await next).payload.toString()).toBe('late');
  });

  it('the transport ending while a wait is open fails it, naming the wait and carrying the cause', async () => {
    const transport = new FakeTransport();
    const link = new FrameLink(transport, 'length');
    const next = link.next('StartService answer', 1000);
    const cause = new Error('socket reset');
    transport.end(cause);
    const error = await next.then(
      () => undefined,
      (reason: unknown) => reason,
    );
    expect(error).toBeInstanceOf(LinkError);
    expect(error).not.toBeInstanceOf(CeilingError);
    expect((error as LinkError).message).toMatch(/StartService answer/);
    expect((error as LinkError).cause).toBe(cause);
  });

  it('a bad header fails the open wait with the frame error, and every later wait too', async () => {
    const transport = new FakeTransport();
    const link = new FrameLink(transport, 'usbmux');
    const open = link.next('a usbmuxd answer', 1000);
    transport.deliver(
      Buffer.from([3, 0, 0, 0, 1, 0, 0, 0, 8, 0, 0, 0, 0, 0, 0, 0]),
    );
    await expect(open).rejects.toBeInstanceOf(FrameError);
    await expect(link.next('anything after', 1000)).rejects.toBeInstanceOf(
      FrameError,
    );
  });
});

describe('handing the socket over once usbmuxd connects it', () => {
  it('returns the bytes that came in the same chunk after the last frame, and reads no more', async () => {
    const transport = new FakeTransport();
    const link = new FrameLink(transport, 'usbmux');
    const answer = link.next('Connect answer', 1000);
    transport.deliver(
      Buffer.concat([
        encodeUsbmuxFrame(3, Buffer.from('ok')),
        Buffer.from([0, 0, 0, 9]),
      ]),
    );
    await answer;
    const { transport: handed, firstBytes } = link.handOver();
    expect(handed).toBe(transport);
    expect(firstBytes).toEqual(Buffer.from([0, 0, 0, 9]));
    expect(() => link.send(Buffer.from('x'))).toThrow(LinkError);
  });
});

describe('a link that starts where another left off', () => {
  it('reads the handed-over bytes as the start of its first frame', async () => {
    const transport = new FakeTransport();
    const frame = encodeLengthFrame(Buffer.from('tunnel'));
    const link = new FrameLink(transport, 'length', frame.subarray(0, 5));
    const next = link.next('the first tunnel frame', 1000);
    transport.deliver(frame.subarray(5));
    expect((await next).payload.toString()).toBe('tunnel');
  });
});

describe('a Node socket as a byte transport', () => {
  function standIn(): EventEmitter & {
    written: Buffer[];
    destroyed: number;
    write(bytes: Buffer): boolean;
    destroy(): void;
  } {
    const socket = Object.assign(new EventEmitter(), {
      written: [] as Buffer[],
      destroyed: 0,
      write(bytes: Buffer): boolean {
        socket.written.push(bytes);
        return true;
      },
      destroy(): void {
        socket.destroyed += 1;
      },
    });
    return socket;
  }

  it("passes the socket's data to the listener", () => {
    const socket = standIn();
    const transport = socketTransport(socket);
    const seen: Buffer[] = [];
    transport.onData((chunk) => seen.push(chunk));
    socket.emit('data', Buffer.from('hi'));
    expect(seen).toEqual([Buffer.from('hi')]);
  });

  it('writes go to the socket', () => {
    const socket = standIn();
    socketTransport(socket).write(Buffer.from('to the phone'));
    expect(socket.written).toEqual([Buffer.from('to the phone')]);
  });

  it('an error then a close end the transport once, with the error', () => {
    const socket = standIn();
    const transport = socketTransport(socket);
    const ends: (Error | undefined)[] = [];
    transport.onEnd((error) => ends.push(error));
    const error = new Error('EPIPE');
    socket.emit('error', error);
    socket.emit('close', true);
    expect(ends).toEqual([error]);
  });

  it('a clean close ends it with no error', () => {
    const socket = standIn();
    const transport = socketTransport(socket);
    const ends: (Error | undefined)[] = [];
    transport.onEnd((error) => ends.push(error));
    socket.emit('close', false);
    expect(ends).toEqual([undefined]);
  });

  it('closing the transport destroys the socket', () => {
    const socket = standIn();
    socketTransport(socket).close();
    expect(socket.destroyed).toBe(1);
  });
});

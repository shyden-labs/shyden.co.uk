/**
 * The link to the phone (#811 Task 5): frames over any byte transport, each
 * wait with a ceiling.
 *
 * Every layer above (usbmuxd, lockdown, the Web Inspector service) speaks in
 * frames over a socket that hands bytes over in whatever pieces it likes.
 * The link reassembles them with a FrameReader, queues frames nobody has
 * asked for yet, and gives each wait a ceiling that names what it waited for:
 * a phone that stops answering is a failure with a cause, never a hang.
 *
 * The transport is a parameter, so every layer is unit-tested with no socket;
 * `socketTransport` is the one adapter to a real one.
 */
import {
  encodeLengthFrame,
  encodeUsbmuxFrame,
  type Frame,
  FrameReader,
} from './framing';

export interface ByteTransport {
  write(bytes: Buffer): void;
  onData(listener: (chunk: Buffer) => void): void;
  /** Called once, when the transport ends: with the error that ended it, or with nothing on a clean close. */
  onEnd(listener: (error: Error | undefined) => void): void;
  close(): void;
}

/** A wait that could not be met: the transport ended, the ceiling passed, or the link was handed on. */
export class LinkError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'LinkError';
  }
}

/** The part of a Node socket (`net.Socket`, `tls.TLSSocket`) the transport uses. */
export interface SocketLike {
  write(bytes: Buffer): unknown;
  on(event: 'data', listener: (chunk: Buffer) => void): unknown;
  on(event: 'error', listener: (error: Error) => void): unknown;
  on(event: 'close', listener: () => void): unknown;
  destroy(): unknown;
}

export function socketTransport(socket: SocketLike): ByteTransport {
  let failure: Error | undefined;
  let ended = false;
  let endListener: ((error: Error | undefined) => void) | undefined;
  socket.on('error', (error: Error) => {
    failure = error;
  });
  socket.on('close', () => {
    if (ended) return;
    ended = true;
    endListener?.(failure);
  });
  return {
    write: (bytes) => {
      socket.write(bytes);
    },
    onData: (listener) => {
      socket.on('data', listener);
    },
    onEnd: (listener) => {
      endListener = listener;
    },
    close: () => {
      socket.destroy();
    },
  };
}

interface Waiter {
  readonly what: string;
  resolve(frame: Frame): void;
  reject(error: Error): void;
  timer: ReturnType<typeof setTimeout>;
}

export class FrameLink {
  private readonly reader: FrameReader;
  private readonly arrived: Frame[] = [];
  private readonly waiting: Waiter[] = [];
  /** Once set, every open and later wait fails with it. */
  private broken: Error | undefined;
  private handedOver = false;

  /** `firstBytes`: what a link handed over had already read past its last frame (see `handOver`). */
  constructor(
    private readonly transport: ByteTransport,
    private readonly kind: 'usbmux' | 'length',
    firstBytes: Buffer = Buffer.alloc(0),
  ) {
    this.reader = new FrameReader(kind);
    transport.onData((chunk) => {
      if (this.handedOver || this.broken) return;
      this.take(chunk);
    });
    transport.onEnd((error) => {
      if (this.handedOver) return;
      this.breakWith(
        (what) =>
          new LinkError(`the connection ended while waiting for the ${what}`, {
            cause: error,
          }),
      );
    });
    if (firstBytes.length > 0) this.take(firstBytes);
  }

  send(payload: Buffer, tag = 0): void {
    if (this.handedOver)
      throw new LinkError(
        'this link has been handed over; send through its transport',
      );
    this.transport.write(
      this.kind === 'usbmux'
        ? encodeUsbmuxFrame(tag, payload)
        : encodeLengthFrame(payload),
    );
  }

  next(what: string, ceilingMs: number): Promise<Frame> {
    if (this.broken) return Promise.reject(this.broken);
    const early = this.arrived.shift();
    if (early) return Promise.resolve(early);
    return new Promise<Frame>((resolve, reject) => {
      const waiter: Waiter = {
        what,
        resolve,
        reject,
        timer: setTimeout(() => {
          this.waiting.splice(this.waiting.indexOf(waiter), 1);
          reject(
            new LinkError(`no ${what} within ${ceilingMs / 1000} s of asking`),
          );
        }, ceilingMs),
      };
      this.waiting.push(waiter);
    });
  }

  /**
   * usbmuxd's Connect turns this socket into a tunnel to the phone's port:
   * the link stops reading, and any bytes that came after the answer in the
   * same chunk belong to the tunnel.
   */
  handOver(): { transport: ByteTransport; firstBytes: Buffer } {
    this.handedOver = true;
    return {
      transport: this.transport,
      firstBytes: this.reader.takeRemainder(),
    };
  }

  close(): void {
    this.transport.close();
  }

  private take(chunk: Buffer): void {
    let frames: Frame[];
    try {
      frames = this.reader.push(chunk);
    } catch (error) {
      const cause = error as Error;
      this.breakWith(() => cause, cause);
      return;
    }
    for (const frame of frames) {
      const waiter = this.waiting.shift();
      if (waiter) {
        clearTimeout(waiter.timer);
        waiter.resolve(frame);
      } else this.arrived.push(frame);
    }
  }

  /** Fails every open wait; later waits fail with `later`, or with the message an open one would have had. */
  private breakWith(errorFor: (what: string) => Error, later?: Error): void {
    this.broken = later ?? errorFor('next frame');
    for (const waiter of this.waiting.splice(0)) {
      clearTimeout(waiter.timer);
      waiter.reject(errorFor(waiter.what));
    }
  }
}

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { encodeBinaryPlist } from '../device/ios/inspector/bplist';
import { type Dialer, openInspector } from '../device/ios/inspector/connect';
import {
  encodeLengthFrame,
  encodeUsbmuxFrame,
} from '../device/ios/inspector/framing';
import type { ByteTransport } from '../device/ios/inspector/link';
import { InspectorError } from '../device/ios/inspector/protocol';
import { THROWAWAY_PAIR } from './fixtures/ios-inspector/throwaway-pair';
import { recordedFrames } from './ios-inspector-fixtures';
import { decodeWritten, fromTarget, pageData } from './ios-inspector-transport';

/** The wiring: the recorded route, connection by connection, through one call (#811 Task 10). */
const MUX = recordedFrames('usbmux', 'in');
const LOCKDOWN = recordedFrames('lockdown', 'in');
const WIR = recordedFrames('wir', 'in');
const at = (needle: string): number =>
  WIR.findIndex((frame) => frame.includes(needle));
const SAFARI_AT = at('com.apple.mobilesafari');
const LISTING = WIR[at('_rpc_applicationSentListing:')];
const TARGET = WIR[at('Target.targetCreated')];

/** A transport that answers its i-th write with `replies[i]`, and remembers every write. */
class ScriptedTransport implements ByteTransport {
  readonly written: Buffer[] = [];
  closed = false;
  private data: ((chunk: Buffer) => void) | undefined;
  constructor(
    private readonly replies: readonly (readonly Buffer[])[],
    private readonly closings: ByteTransport[],
  ) {}
  write(bytes: Buffer): void {
    if (this.closed) throw new Error('written after its connection closed');
    const reply = this.replies[this.written.length] ?? [];
    this.written.push(bytes);
    queueMicrotask(() => {
      for (const chunk of reply) this.data?.(chunk);
    });
  }
  onData(listener: (chunk: Buffer) => void): void {
    this.data = listener;
  }
  onEnd(): void {}
  close(): void {
    this.closed = true;
    this.closings.push(this);
  }
}

/** TLS over a tunnel: its own transport, passing bytes through to the one beneath, as a TLS socket does. */
class TlsLayer implements ByteTransport {
  constructor(
    readonly under: ScriptedTransport,
    private readonly closings: ByteTransport[],
  ) {}
  write(bytes: Buffer): void {
    if (this.closings.includes(this))
      throw new Error('written after its TLS layer closed');
    this.under.write(bytes);
  }
  onData(listener: (chunk: Buffer) => void): void {
    this.under.onData(listener);
  }
  onEnd(): void {}
  close(): void {
    this.closings.push(this);
  }
}

const mux = (payload: Buffer): Buffer => encodeUsbmuxFrame(1, payload);
const len = (payload: Buffer): Buffer => encodeLengthFrame(payload);

/** Safari's listing of one web page at `url`. */
const listingOf = (url: string): Buffer =>
  encodeBinaryPlist({
    __selector: '_rpc_applicationSentListing:',
    __argument: {
      WIRApplicationIdentifierKey: 'PID:86196',
      WIRListingKey: {
        '1': {
          WIRPageIdentifierKey: 1,
          WIRTypeKey: 'WIRTypeWebPage',
          WIRURLKey: url,
        },
      },
    },
  });

/**
 * `listings`: what Safari lists, in order (the recorded listing by default).
 * `held`: another inspector holds the page, as measured on 2026-10-26 (#811
 * step 6): no target at all (row 5), or a target that answers nothing (row 1).
 * `enableRefused`: the page answers `Page.enable` with an error.
 */
function dialer(
  options: {
    peerDer?: Buffer;
    listings?: readonly Buffer[];
    held?: 'no target' | 'silent target';
    enableRefused?: string;
  } = {},
): {
  dial: Dialer;
  transports: ScriptedTransport[];
  layers: TlsLayer[];
  closings: ByteTransport[];
} {
  const transports: ScriptedTransport[] = [];
  const layers: TlsLayer[] = [];
  const closings: ByteTransport[] = [];
  const scripts: Buffer[][][] = [
    [[mux(MUX[0])]],
    [[mux(MUX[1])]],
    [[mux(MUX[2])], [len(LOCKDOWN[0])], [len(LOCKDOWN[1])], [len(LOCKDOWN[2])]],
    [
      [mux(MUX[3])],
      WIR.slice(0, SAFARI_AT + 1).map(len),
      (options.listings ?? [LISTING]).map(len),
      options.held === 'no target' ? [] : [len(TARGET)],
      options.held
        ? []
        : [
            len(pageData('{"result":{},"id":2}')),
            len(
              fromTarget(
                options.enableRefused === undefined
                  ? { result: {}, id: 1 }
                  : { error: { message: options.enableRefused }, id: 1 },
              ),
            ),
          ],
    ],
  ];
  const dial: Dialer = {
    usbmux: () => {
      const transport = new ScriptedTransport(
        scripts[transports.length] ?? [],
        closings,
      );
      transports.push(transport);
      return Promise.resolve(transport);
    },
    tls: (transport) => {
      const layer = new TlsLayer(transport as ScriptedTransport, closings);
      layers.push(layer);
      return Promise.resolve({
        transport: layer,
        peerDer: options.peerDer ?? THROWAWAY_PAIR.deviceCertificateDer,
      });
    },
  };
  return { dial, transports, layers, closings };
}

/** What each write asked for, across every connection, in order. */
function asked(transports: readonly ScriptedTransport[]): string[] {
  return transports.flatMap((transport, connection) =>
    transport.written.map((bytes) => {
      const usbmux =
        bytes.length >= 16 &&
        bytes.readUInt32LE(4) === 1 &&
        bytes.readUInt32LE(8) === 8;
      const body = decodeWritten(bytes, usbmux ? 'usbmux' : 'length');
      const named = body.MessageType ?? body.Request ?? body.__selector;
      return `${connection}: ${String(named)}`;
    }),
  );
}

const onPage = (url: string): boolean => url.includes('/classroom-groups');

/** The words that name the likely holder of a page that answers nothing. */
const HOLDER =
  "another Web Inspector, such as Safari's on the Mac, may hold this page: close it and run again";

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

describe('opening the inspector on the phone', () => {
  it('walks the recorded route in order, ending with Page.enable', async () => {
    const { dial, transports } = dialer();
    const inspector = await openInspector({ url: onPage, dial });
    expect(asked(transports)).toEqual([
      '0: ListDevices',
      '1: ReadPairRecord',
      '2: Connect',
      '2: QueryType',
      '2: StartSession',
      '2: StartService',
      '3: Connect',
      '3: _rpc_reportIdentifier:',
      '3: _rpc_forwardGetListing:',
      '3: _rpc_forwardSocketSetup:',
      '3: _rpc_forwardSocketData:',
    ]);
    expect(inspector.page.targetId).toBe('page-39');
  });

  it('a phone whose certificate is not its pair record’s stops before any service starts', async () => {
    const forged = Buffer.from(THROWAWAY_PAIR.deviceCertificateDer);
    forged[forged.length - 1] ^= 0x01;
    const { dial, transports } = dialer({ peerDer: forged });
    await expect(openInspector({ url: onPage, dial })).rejects.toThrow(
      "the phone's certificate is not the one in its pair record",
    );
    expect(asked(transports)).not.toContain('2: StartService');
  });

  it('no page at the URL, past the listing ceiling, lists the pages Safari has and never detaches', async () => {
    const { dial, transports } = dialer({
      listings: [listingOf('https://elsewhere.example/')],
    });
    const opening = openInspector({ url: onPage, dial });
    const verdict = expect(opening).rejects.toThrow(
      'Safari showed no page this run opened within 15 s (its listings held: WIRTypeWebPage https://elsewhere.example/)',
    );
    await vi.advanceTimersByTimeAsync(15_000);
    await verdict;
    expect(asked(transports).at(-1)).toBe('3: _rpc_forwardGetListing:');
    expect(transports.every((transport) => transport.closed)).toBe(true);
  });

  it('a page still loading at the first listing is attached once Safari lists it', async () => {
    const { dial } = dialer({ listings: [listingOf('about:blank'), LISTING] });
    const inspector = await openInspector({ url: onPage, dial });
    expect(inspector.page.targetId).toBe('page-39');
  });

  it('a page that gives no target names the inspector that may hold it, and detaches before closing', async () => {
    const { dial, transports } = dialer({ held: 'no target' });
    const opening = openInspector({ url: onPage, dial });
    const verdict = expect(opening).rejects.toThrow(
      `no Target.targetCreated within 10 s: ${HOLDER}`,
    );
    await vi.advanceTimersByTimeAsync(10_000);
    await verdict;
    expect(asked(transports).slice(-2)).toEqual([
      '3: _rpc_forwardSocketSetup:',
      '3: _rpc_forwardDidClose:',
    ]);
    expect(transports.every((transport) => transport.closed)).toBe(true);
  });

  it('a target that answers nothing names the inspector that may hold it, and detaches before closing', async () => {
    const { dial, transports } = dialer({ held: 'silent target' });
    const opening = openInspector({ url: onPage, dial });
    const verdict = expect(opening).rejects.toThrow(
      `no answer to Page.enable within 15 s: ${HOLDER}`,
    );
    await vi.advanceTimersByTimeAsync(15_000);
    await verdict;
    expect(asked(transports).slice(-2)).toEqual([
      '3: _rpc_forwardSocketData:',
      '3: _rpc_forwardDidClose:',
    ]);
    expect(transports.every((transport) => transport.closed)).toBe(true);
  });

  it('a failure that is not a silence keeps its own words, and still detaches before closing', async () => {
    const { dial, transports } = dialer({ enableRefused: 'Page is busy' });
    const error = await openInspector({ url: onPage, dial }).then(
      () => undefined,
      (reason: unknown) => reason,
    );
    expect(error).toBeInstanceOf(InspectorError);
    expect((error as Error).message).toBe(
      'Page.enable failed on the page: Page is busy',
    );
    expect(asked(transports).slice(-2)).toEqual([
      '3: _rpc_forwardSocketData:',
      '3: _rpc_forwardDidClose:',
    ]);
    expect(transports.every((transport) => transport.closed)).toBe(true);
  });

  it('closing closes each TLS layer before the tunnel beneath it, the newest connection first', async () => {
    const { dial, transports, layers, closings } = dialer();
    const inspector = await openInspector({ url: onPage, dial });
    inspector.close();
    expect(layers.length).toBeGreaterThan(0);
    for (const layer of layers)
      expect(closings.indexOf(layer)).toBeLessThan(
        closings.indexOf(layer.under),
      );
    const tunnels = closings.filter(
      (closed): closed is ScriptedTransport =>
        closed instanceof ScriptedTransport,
    );
    expect(tunnels).toEqual([...transports].reverse());
  });

  it('closing detaches from the page and closes every connection', async () => {
    const { dial, transports } = dialer();
    const inspector = await openInspector({ url: onPage, dial });
    inspector.close();
    expect(asked(transports).at(-1)).toBe('3: _rpc_forwardDidClose:');
    expect(transports.every((transport) => transport.closed)).toBe(true);
  });
});

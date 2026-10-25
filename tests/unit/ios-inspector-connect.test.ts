import { describe, expect, it } from 'vitest';
import { encodeBinaryPlist } from '../device/ios/inspector/bplist';
import { type Dialer, openInspector } from '../device/ios/inspector/connect';
import {
  encodeLengthFrame,
  encodeUsbmuxFrame,
} from '../device/ios/inspector/framing';
import type { ByteTransport } from '../device/ios/inspector/link';
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
  constructor(private readonly replies: readonly (readonly Buffer[])[]) {}
  write(bytes: Buffer): void {
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
  }
}

const mux = (payload: Buffer): Buffer => encodeUsbmuxFrame(1, payload);
const len = (payload: Buffer): Buffer => encodeLengthFrame(payload);

function dialer(options: { peerDer?: Buffer; noPage?: boolean } = {}): {
  dial: Dialer;
  transports: ScriptedTransport[];
} {
  const transports: ScriptedTransport[] = [];
  const scripts: Buffer[][][] = [
    [[mux(MUX[0])]],
    [[mux(MUX[1])]],
    [[mux(MUX[2])], [len(LOCKDOWN[0])], [len(LOCKDOWN[1])], [len(LOCKDOWN[2])]],
    [
      [mux(MUX[3])],
      WIR.slice(0, SAFARI_AT + 1).map(len),
      options.noPage
        ? [
            len(
              encodeBinaryPlist({
                __selector: '_rpc_applicationSentListing:',
                __argument: {
                  WIRApplicationIdentifierKey: 'PID:86196',
                  WIRListingKey: {
                    '1': {
                      WIRPageIdentifierKey: 1,
                      WIRTypeKey: 'WIRTypeWebPage',
                      WIRURLKey: 'https://elsewhere.example/',
                    },
                  },
                },
              }),
            ),
          ]
        : [len(LISTING)],
      [len(TARGET)],
      [
        len(pageData('{"result":{},"id":2}')),
        len(fromTarget({ result: {}, id: 1 })),
      ],
    ],
  ];
  const dial: Dialer = {
    usbmux: () => {
      const transport = new ScriptedTransport(scripts[transports.length] ?? []);
      transports.push(transport);
      return Promise.resolve(transport);
    },
    tls: (transport) =>
      Promise.resolve({
        transport,
        peerDer: options.peerDer ?? THROWAWAY_PAIR.deviceCertificateDer,
      }),
  };
  return { dial, transports };
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

  it('no page at the URL lists the URLs Safari has', async () => {
    const { dial } = dialer({ noPage: true });
    await expect(openInspector({ url: onPage, dial })).rejects.toThrow(
      'Safari has no page this run opened (it has https://elsewhere.example/)',
    );
  });

  it('closing detaches from the page and closes every connection', async () => {
    const { dial, transports } = dialer();
    const inspector = await openInspector({ url: onPage, dial });
    inspector.close();
    expect(asked(transports).at(-1)).toBe('3: _rpc_forwardDidClose:');
    expect(transports.every((transport) => transport.closed)).toBe(true);
  });
});

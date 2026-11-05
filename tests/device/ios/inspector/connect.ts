/**
 * Opening the inspector on the phone (#811 Task 10): the route measured on
 * the iPhone Air (iOS 27.0.1) on 2026-10-24, in one call.
 *
 * usbmuxd lists the phone and hands over its pair record; a tunnel to
 * lockdown (62078) starts a session and turns to TLS, pinned to the record;
 * lockdown starts `com.apple.webinspector`; a second tunnel reaches it, also
 * over pinned TLS; the Web Inspector finds Safari, the page this run opened,
 * and attaches; `Page.enable` runs first, because media emulation takes
 * effect only once the page agent is on (measured).
 *
 * Another inspector on the page holds this one off in silence (measured
 * 2026-10-26, #811 step 6): no target, or a target that answers nothing, and
 * nothing tells a held page from a hung one sooner than the ceiling. So a
 * silent page fails at its ceiling naming the likely holder, and any failure
 * after attaching detaches before it closes, so a failed run never leaves the
 * page held for the next.
 *
 * The sockets come from a Dialer, so the whole route is unit-tested on the
 * recorded frames; `nodeDialer` is the only code here that opens one.
 */
import { randomUUID } from 'node:crypto';
import { createConnection, type Socket } from 'node:net';
import { connect as tlsConnect, type ConnectionOptions } from 'node:tls';
import {
  type ByteTransport,
  CeilingError,
  FrameLink,
  socketTransport,
} from './link';
import { queryType, startService, startSession } from './lockdown';
import { pinnedTlsOptions, verifyPinnedPeer } from './pin';
import { PageProtocol } from './protocol';
import {
  connectPort,
  listDevices,
  onlyIphone,
  type PairRecord,
  readPairRecord,
} from './usbmux';
import { LISTING_CEILING_MS, WirSession } from './wir';

const LOCKDOWN_PORT = 62078;
const WEB_INSPECTOR = 'com.apple.webinspector';
const TARGET_CEILING_MS = 10_000;
const USBMUXD = '/var/run/usbmuxd';
const HOLDER =
  "another Web Inspector, such as Safari's on the Mac, may hold this page: close it and run again";

/** A page that stayed silent past its ceiling fails naming the likely holder. */
async function namingTheHolder<T>(waiting: Promise<T>): Promise<T> {
  try {
    return await waiting;
  } catch (error) {
    if (error instanceof CeilingError)
      throw new CeilingError(`${error.message}: ${HOLDER}`, { cause: error });
    throw error;
  }
}

export interface Dialer {
  usbmux(): Promise<ByteTransport>;
  tls(
    transport: ByteTransport,
    options: ConnectionOptions,
  ): Promise<{ transport: ByteTransport; peerDer: Buffer | undefined }>;
}

export interface Inspector {
  readonly page: PageProtocol;
  close(): void;
}

/** A tunnel to one of the phone's ports, over pinned TLS when the port wants it. */
async function tunnel(
  dial: Dialer,
  deviceId: number,
  port: number,
  pair: PairRecord,
  ssl: boolean,
  opened: ByteTransport[],
): Promise<FrameLink> {
  const transport = await dial.usbmux();
  opened.push(transport);
  const mux = new FrameLink(transport, 'usbmux');
  await connectPort(mux, deviceId, port);
  const { firstBytes } = mux.handOver();
  if (!ssl) return new FrameLink(transport, 'length', firstBytes);
  return secure(dial, transport, pair, opened);
}

async function secure(
  dial: Dialer,
  transport: ByteTransport,
  pair: PairRecord,
  opened: ByteTransport[],
): Promise<FrameLink> {
  const secured = await dial.tls(transport, pinnedTlsOptions(pair));
  verifyPinnedPeer(secured.peerDer, pair);
  if (secured.transport !== transport) opened.push(secured.transport);
  return new FrameLink(secured.transport, 'length');
}

export async function openInspector(options: {
  url: (url: string) => boolean;
  expectedUdid?: string;
  dial: Dialer;
}): Promise<Inspector> {
  const { dial } = options;
  const opened: ByteTransport[] = [];
  let attached: WirSession | undefined;
  const closeAll = (): void => {
    attached?.detach();
    attached = undefined;
    // Newest first, so each TLS layer closes before the tunnel beneath it.
    for (const transport of [...opened].reverse()) transport.close();
  };
  try {
    const listing = await dial.usbmux();
    opened.push(listing);
    const phone = onlyIphone(
      await listDevices(new FrameLink(listing, 'usbmux')),
      options.expectedUdid,
    );
    const pairing = await dial.usbmux();
    opened.push(pairing);
    const pair = await readPairRecord(
      new FrameLink(pairing, 'usbmux'),
      phone.udid,
    );

    let lockdown = await tunnel(
      dial,
      phone.deviceId,
      LOCKDOWN_PORT,
      pair,
      false,
      opened,
    );
    await queryType(lockdown);
    const session = await startSession(lockdown, pair);
    if (session.ssl) {
      const { transport, firstBytes } = lockdown.handOver();
      if (firstBytes.length > 0)
        throw new Error('lockdown sent bytes before TLS began');
      lockdown = await secure(dial, transport, pair, opened);
    }
    const service = await startService(lockdown, WEB_INSPECTOR);

    const link = await tunnel(
      dial,
      phone.deviceId,
      service.port,
      pair,
      service.ssl,
      opened,
    );
    const wir = new WirSession(link, {
      connection: randomUUID().toUpperCase(),
      sender: randomUUID().toUpperCase(),
    });
    wir.identify();
    const safari = await wir.safari(LISTING_CEILING_MS);
    const [page] = await wir.pages(safari, options.url, LISTING_CEILING_MS);
    wir.attach(safari, page.pageId);
    attached = wir;
    const protocol = new PageProtocol(wir);
    await namingTheHolder(protocol.targetCreated(TARGET_CEILING_MS));
    await namingTheHolder(protocol.command('Page.enable'));
    return { page: protocol, close: closeAll };
  } catch (error) {
    closeAll();
    throw error;
  }
}

/** The real sockets: usbmuxd's on this Mac, and TLS over a tunnel it opened. */
export function nodeDialer(): Dialer {
  const sockets = new WeakMap<ByteTransport, Socket>();
  return {
    usbmux: () =>
      new Promise((resolve, reject) => {
        const socket = createConnection(USBMUXD);
        socket.once('error', reject);
        socket.once('connect', () => {
          socket.off('error', reject);
          const transport = socketTransport(socket);
          sockets.set(transport, socket);
          resolve(transport);
        });
      }),
    tls: (transport, options) =>
      new Promise((resolve, reject) => {
        const socket = sockets.get(transport);
        if (!socket) {
          reject(
            new Error('TLS asked over a transport this dialer did not open'),
          );
          return;
        }
        const secured = tlsConnect({ ...options, socket });
        secured.once('error', reject);
        secured.once('secureConnect', () => {
          secured.off('error', reject);
          resolve({
            transport: socketTransport(secured),
            peerDer: secured.getPeerCertificate(true)?.raw,
          });
        });
      }),
  };
}

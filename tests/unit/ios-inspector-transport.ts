import {
  encodeBinaryPlist,
  isPlistDictionary,
  type PlistDictionary,
} from '../device/ios/inspector/bplist';
import { encodeLengthFrame } from '../device/ios/inspector/framing';
import { type ByteTransport, FrameLink } from '../device/ios/inspector/link';
import { decodeAnyPlist } from '../device/ios/inspector/plist-xml';
import type { PairRecord } from '../device/ios/inspector/usbmux';
import { WirSession } from '../device/ios/inspector/wir';
import { THROWAWAY_PAIR } from './fixtures/ios-inspector/throwaway-pair';

/** A byte transport with no socket behind it: it records what is written and delivers what a test hands it (#811). */
export class FakeTransport implements ByteTransport {
  readonly written: Buffer[] = [];
  closed = false;
  private dataListener: ((chunk: Buffer) => void) | undefined;
  private endListener: ((error: Error | undefined) => void) | undefined;

  write(bytes: Buffer): void {
    this.written.push(bytes);
  }
  onData(listener: (chunk: Buffer) => void): void {
    this.dataListener = listener;
  }
  onEnd(listener: (error: Error | undefined) => void): void {
    this.endListener = listener;
  }
  close(): void {
    this.closed = true;
  }
  deliver(chunk: Buffer): void {
    this.dataListener?.(chunk);
  }
  end(error?: Error): void {
    this.endListener?.(error);
  }
}

/** A page message as the phone sends it: protocol text inside `_rpc_applicationSentData:`. */
export const pageData = (text: string): Buffer =>
  encodeBinaryPlist({
    __selector: '_rpc_applicationSentData:',
    __argument: { WIRMessageDataKey: Buffer.from(text) },
  });

/** An answer or event from the page's target, wrapped as the recording shows (target `page-39`). */
export const fromTarget = (inner: object): Buffer =>
  pageData(
    JSON.stringify({
      method: 'Target.dispatchMessageFromTarget',
      params: { targetId: 'page-39', message: JSON.stringify(inner) },
    }),
  );

/** The throwaway pairing material as the record usbmuxd hands over. */
export const PAIR: PairRecord = {
  hostCertificatePem: THROWAWAY_PAIR.hostCertificatePem,
  hostKeyPem: THROWAWAY_PAIR.hostKeyPem,
  deviceCertificatePem: THROWAWAY_PAIR.deviceCertificatePem,
  hostId: THROWAWAY_PAIR.hostId,
  systemBuid: THROWAWAY_PAIR.systemBuid,
};

/** The Web Inspector ids the recording used, so a test can pin them. */
export const IDS = {
  connection: 'C0000000-0000-0000-0000-000000000001',
  sender: 'S0000000-0000-0000-0000-000000000001',
};

export function linkOver(kind: 'usbmux' | 'length'): {
  transport: FakeTransport;
  link: FrameLink;
} {
  const transport = new FakeTransport();
  return { transport, link: new FrameLink(transport, kind) };
}

export function wirOver(): { transport: FakeTransport; wir: WirSession } {
  const { transport, link } = linkOver('length');
  return { transport, wir: new WirSession(link, IDS) };
}

/** One written frame's plist: a usbmux frame has a 16-byte header, a length frame 4. */
export function decodeWritten(
  frame: Buffer,
  kind: 'usbmux' | 'length',
): PlistDictionary {
  const body = decodeAnyPlist(frame.subarray(kind === 'usbmux' ? 16 : 4));
  if (!isPlistDictionary(body))
    throw new Error('a written frame is no dictionary');
  return body;
}

/** Every frame the transport was handed, decoded, in order. */
export const writtenPlists = (
  transport: FakeTransport,
  kind: 'usbmux' | 'length',
): PlistDictionary[] =>
  transport.written.map((frame) => decodeWritten(frame, kind));

/** Hands the transport each payload as a length frame, in order. */
export function deliverFrames(
  transport: FakeTransport,
  ...payloads: readonly Buffer[]
): void {
  for (const payload of payloads) transport.deliver(encodeLengthFrame(payload));
}

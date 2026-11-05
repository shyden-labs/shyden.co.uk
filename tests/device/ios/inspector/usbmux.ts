/**
 * usbmuxd (#811 Task 6): the Mac's daemon for every Apple device on USB.
 *
 * Three requests, each an XML plist behind usbmuxd's 16-byte header, the
 * answer echoing the request's tag (measured 2026-10-24, iPhone Air, iOS
 * 27.0.1): ListDevices names the phone; ReadPairRecord hands over the
 * certificates and identifiers this Mac paired with (no root needed);
 * Connect turns the socket into a tunnel to one of the phone's ports, which
 * usbmuxd reads byte-swapped (62078 is sent as 32498).
 */
import type { PlistDictionary } from './bplist';
import {
  arrayField,
  dataField,
  dictionaryField,
  dictionaryOf,
  numberField,
  stringField,
} from './fields';
import type { FrameLink } from './link';
import { decodeAnyPlist, encodeXmlPlist } from './plist-xml';

export const REPLY_CEILING_MS = 10_000;
const CLIENT = {
  ClientVersionString: 'shyden-inspector',
  ProgName: 'shyden-inspector',
};

/** usbmuxd's result numbers, as libimobiledevice names them. */
const RESULTS: Readonly<Record<number, string>> = {
  1: 'bad command',
  2: 'no such device',
  3: 'connection refused',
  6: 'bad version',
};

export interface UsbDevice {
  readonly deviceId: number;
  readonly udid: string;
  readonly connectionType: string;
}

export interface PairRecord {
  readonly hostCertificatePem: Buffer;
  readonly hostKeyPem: Buffer;
  readonly deviceCertificatePem: Buffer;
  readonly hostId: string;
  readonly systemBuid: string;
}

export class UsbmuxError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'UsbmuxError';
  }
}

const tags = new WeakMap<FrameLink, number>();

async function ask(
  link: FrameLink,
  request: PlistDictionary & { MessageType: string },
): Promise<PlistDictionary> {
  const tag = (tags.get(link) ?? 0) + 1;
  tags.set(link, tag);
  link.send(encodeXmlPlist({ ...request, ...CLIENT }), tag);
  const what = `usbmuxd answer to ${request.MessageType}`;
  const frame = await link.next(what, REPLY_CEILING_MS);
  if (frame.tag !== tag)
    throw new UsbmuxError(
      `usbmuxd answered tag ${frame.tag} to request ${tag} (${request.MessageType})`,
    );
  return dictionaryOf(decodeAnyPlist(frame.payload), what);
}

export async function listDevices(link: FrameLink): Promise<UsbDevice[]> {
  const what = 'usbmuxd device list';
  const answer = await ask(link, { MessageType: 'ListDevices' });
  return arrayField(answer, 'DeviceList', what).map((entry) => {
    const device = dictionaryOf(entry, what);
    const properties = dictionaryField(device, 'Properties', what);
    return {
      deviceId: numberField(device, 'DeviceID', what),
      udid: stringField(properties, 'SerialNumber', what),
      connectionType: stringField(properties, 'ConnectionType', what),
    };
  });
}

/** The one device on USB (usbmuxd lists only Apple devices), or the one named. */
export function onlyIphone(
  devices: readonly UsbDevice[],
  expectedUdid?: string,
): UsbDevice {
  const usb = devices.filter((device) => device.connectionType === 'USB');
  const udids = usb.map((device) => device.udid).join(', ');
  if (expectedUdid !== undefined) {
    const named = usb.find((device) => device.udid === expectedUdid);
    if (!named)
      throw new UsbmuxError(
        `the iPhone ${expectedUdid} is not on USB; usbmuxd has ${udids || 'nothing'}`,
      );
    return named;
  }
  if (usb.length === 0)
    throw new UsbmuxError(
      'no iPhone on USB: is it plugged in, unlocked and trusting this Mac?',
    );
  if (usb.length > 1)
    throw new UsbmuxError(`two devices on USB (${udids}): name the one to use`);
  return usb[0];
}

export async function readPairRecord(
  link: FrameLink,
  udid: string,
): Promise<PairRecord> {
  const answer = await ask(link, {
    MessageType: 'ReadPairRecord',
    PairRecordID: udid,
  });
  if (!Object.hasOwn(answer, 'PairRecordData'))
    throw new UsbmuxError(
      `usbmuxd has no pair record for ${udid} (its answer held ${Object.keys(answer).join(', ')}): trust this Mac on the phone`,
    );
  const what = `the pair record for ${udid}`;
  const record = dictionaryOf(
    decodeAnyPlist(dataField(answer, 'PairRecordData', what)),
    what,
  );
  return {
    hostCertificatePem: dataField(record, 'HostCertificate', what),
    hostKeyPem: dataField(record, 'HostPrivateKey', what),
    deviceCertificatePem: dataField(record, 'DeviceCertificate', what),
    hostId: stringField(record, 'HostID', what),
    systemBuid: stringField(record, 'SystemBUID', what),
  };
}

/** After this resolves, the link's socket is a tunnel to `port`: hand it over. */
export async function connectPort(
  link: FrameLink,
  deviceId: number,
  port: number,
): Promise<void> {
  const answer = await ask(link, {
    MessageType: 'Connect',
    DeviceID: deviceId,
    PortNumber: ((port & 0xff) << 8) | ((port >> 8) & 0xff),
  });
  const result = numberField(answer, 'Number', 'usbmuxd answer to Connect');
  if (result !== 0)
    throw new UsbmuxError(
      `usbmuxd refused port ${port} on device ${deviceId}: ${RESULTS[result] ?? `result ${result}`} (${result})`,
    );
}

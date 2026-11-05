import { describe, expect, it } from 'vitest';
import type { PlistDictionary } from '../device/ios/inspector/bplist';
import { encodeUsbmuxFrame } from '../device/ios/inspector/framing';
import { encodeXmlPlist } from '../device/ios/inspector/plist-xml';
import {
  connectPort,
  listDevices,
  onlyIphone,
  readPairRecord,
  type UsbDevice,
  UsbmuxError,
} from '../device/ios/inspector/usbmux';
import { THROWAWAY_PAIR } from './fixtures/ios-inspector/throwaway-pair';
import { recordedFrames } from './ios-inspector-fixtures';
import {
  decodeWritten,
  type FakeTransport,
  linkOver,
} from './ios-inspector-transport';

/** usbmuxd: find the phone, read its pair record, open one of its ports (#811 Task 6). */
const ANSWERS = recordedFrames('usbmux', 'in');
const LIST_ANSWER = ANSWERS[0];
const PAIR_ANSWER = ANSWERS[1];
const CONNECT_OK = ANSWERS[2];

const setUp = (): ReturnType<typeof linkOver> => linkOver('usbmux');

/** The request the link wrote last, decoded, with the tag it carried. */
function lastRequest(transport: FakeTransport): {
  tag: number;
  body: PlistDictionary;
} {
  const frame = transport.written.at(-1);
  if (!frame) throw new Error('nothing was written');
  return { tag: frame.readUInt32LE(12), body: decodeWritten(frame, 'usbmux') };
}

/** Answers the last request with `payload`, echoing its tag unless told otherwise. */
function answer(
  transport: FakeTransport,
  payload: Buffer,
  tag = lastRequest(transport).tag,
): void {
  transport.deliver(encodeUsbmuxFrame(tag, payload));
}

const USB_PHONE: UsbDevice = {
  deviceId: 9,
  udid: THROWAWAY_PAIR.udid,
  connectionType: 'USB',
};

describe('listing devices', () => {
  it("asks usbmuxd with this client's name", async () => {
    const { transport, link } = setUp();
    const devices = listDevices(link);
    expect(lastRequest(transport)).toEqual({
      tag: 1,
      body: {
        MessageType: 'ListDevices',
        ClientVersionString: 'shyden-inspector',
        ProgName: 'shyden-inspector',
      },
    });
    answer(transport, LIST_ANSWER);
    await devices;
  });

  it('reads the recorded answer as the one phone on USB', async () => {
    const { transport, link } = setUp();
    const devices = listDevices(link);
    answer(transport, LIST_ANSWER);
    expect(await devices).toEqual([USB_PHONE]);
  });

  it('refuses an answer whose tag is not the request’s', async () => {
    const { transport, link } = setUp();
    const devices = listDevices(link);
    answer(transport, LIST_ANSWER, 7);
    await expect(devices).rejects.toThrow(
      'usbmuxd answered tag 7 to request 1 (ListDevices)',
    );
  });

  it('counts tags up on one link', async () => {
    const { transport, link } = setUp();
    const first = listDevices(link);
    answer(transport, LIST_ANSWER);
    await first;
    const second = listDevices(link);
    expect(lastRequest(transport).tag).toBe(2);
    answer(transport, LIST_ANSWER);
    await second;
  });
});

describe('choosing the iPhone', () => {
  const NETWORK: UsbDevice = {
    deviceId: 4,
    udid: 'NETWORK-UDID',
    connectionType: 'Network',
  };
  const OTHER: UsbDevice = {
    deviceId: 5,
    udid: 'OTHER-UDID',
    connectionType: 'USB',
  };

  it('takes the one device on USB', () =>
    expect(onlyIphone([USB_PHONE])).toBe(USB_PHONE));
  it('a device seen only over the network does not count', () =>
    expect(onlyIphone([NETWORK, USB_PHONE])).toBe(USB_PHONE));
  it('no device on USB says to plug it in and trust this Mac', () =>
    expect(() => onlyIphone([NETWORK])).toThrow(
      new UsbmuxError(
        'no iPhone on USB: is it plugged in, unlocked and trusting this Mac?',
      ),
    ));
  it('two on USB names both, so the run can say which', () =>
    expect(() => onlyIphone([USB_PHONE, OTHER])).toThrow(
      `two devices on USB (${THROWAWAY_PAIR.udid}, OTHER-UDID): name the one to use`,
    ));
  it('takes the named one of two', () =>
    expect(onlyIphone([USB_PHONE, OTHER], 'OTHER-UDID')).toBe(OTHER));
  it('a named phone that is absent names both sides', () =>
    expect(() => onlyIphone([USB_PHONE], 'MISSING-UDID')).toThrow(
      `the iPhone MISSING-UDID is not on USB; usbmuxd has ${THROWAWAY_PAIR.udid}`,
    ));
});

describe('reading the pair record', () => {
  it('asks for the record by the phone’s UDID', async () => {
    const { transport, link } = setUp();
    const record = readPairRecord(link, THROWAWAY_PAIR.udid);
    expect(lastRequest(transport).body).toEqual({
      MessageType: 'ReadPairRecord',
      PairRecordID: THROWAWAY_PAIR.udid,
      ClientVersionString: 'shyden-inspector',
      ProgName: 'shyden-inspector',
    });
    answer(transport, PAIR_ANSWER);
    await record;
  });

  it('reads the certificates, key and identifiers from the recorded answer', async () => {
    const { transport, link } = setUp();
    const record = readPairRecord(link, THROWAWAY_PAIR.udid);
    answer(transport, PAIR_ANSWER);
    expect(await record).toEqual({
      hostCertificatePem: THROWAWAY_PAIR.hostCertificatePem,
      hostKeyPem: THROWAWAY_PAIR.hostKeyPem,
      deviceCertificatePem: THROWAWAY_PAIR.deviceCertificatePem,
      hostId: THROWAWAY_PAIR.hostId,
      systemBuid: THROWAWAY_PAIR.systemBuid,
    });
  });

  it('an answer with no record names what it had instead', async () => {
    const { transport, link } = setUp();
    const record = readPairRecord(link, THROWAWAY_PAIR.udid);
    answer(transport, encodeXmlPlist({ MessageType: 'Result', Number: 2 }));
    await expect(record).rejects.toThrow(
      `usbmuxd has no pair record for ${THROWAWAY_PAIR.udid} (its answer held MessageType, Number): trust this Mac on the phone`,
    );
  });
});

describe('opening a port on the phone', () => {
  it('sends the port byte-swapped, as usbmuxd reads it', async () => {
    const { transport, link } = setUp();
    const opened = connectPort(link, 9, 62078);
    expect(lastRequest(transport).body).toEqual({
      MessageType: 'Connect',
      DeviceID: 9,
      PortNumber: 32498,
      ClientVersionString: 'shyden-inspector',
      ProgName: 'shyden-inspector',
    });
    answer(transport, CONNECT_OK);
    await opened;
  });

  it('the recorded service port 50209 goes as 8644', async () => {
    const { transport, link } = setUp();
    const opened = connectPort(link, 9, 50209);
    expect(lastRequest(transport).body.PortNumber).toBe(8644);
    answer(transport, CONNECT_OK);
    await opened;
  });

  it.each([
    [1, 'bad command'],
    [2, 'no such device'],
    [3, 'connection refused'],
    [6, 'bad version'],
  ])('a refusal numbered %i is named %s', async (code, name) => {
    const { transport, link } = setUp();
    const opened = connectPort(link, 9, 62078);
    answer(transport, encodeXmlPlist({ MessageType: 'Result', Number: code }));
    await expect(opened).rejects.toThrow(
      `usbmuxd refused port 62078 on device 9: ${name} (${code})`,
    );
  });

  it('an unknown refusal is named by its number', async () => {
    const { transport, link } = setUp();
    const opened = connectPort(link, 9, 62078);
    answer(transport, encodeXmlPlist({ MessageType: 'Result', Number: 99 }));
    await expect(opened).rejects.toThrow(
      'usbmuxd refused port 62078 on device 9: result 99 (99)',
    );
  });
});

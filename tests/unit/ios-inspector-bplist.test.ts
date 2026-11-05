import { describe, expect, it } from 'vitest';
import {
  PlistFormatError,
  decodeBinaryPlist,
  encodeBinaryPlist,
  type PlistValue,
} from '../device/ios/inspector/bplist';

/**
 * The binary plist codec the iPhone's lockdown and Web Inspector services
 * speak (#811). Every golden document below was written by Python's
 * plistlib (`plistlib.dumps(value, fmt=FMT_BINARY, sort_keys=False)`), an
 * encoder independent of this one, on 2026-10-16.
 */
const PLISTLIB: ReadonlyArray<{
  name: string;
  hex: string;
  value: PlistValue;
}> = [
  {
    name: 'a one-key dictionary',
    hex: '62706c6973743030d1010251611001080b0d000000000000010100000000000000030000000000000000000000000000000f',
    value: { a: 1 },
  },
  {
    name: 'a Web Inspector RPC message',
    hex: '62706c6973743030d2010203045a5f5f73656c6563746f725a5f5f617267756d656e745f10165f7270635f7265706f72744964656e7469666965723ad105065f101a574952436f6e6e656374696f6e4964656e7469666965724b657956633066666565080d18233c3f5c0000000000000101000000000000000700000000000000000000000000000063',
    value: {
      __selector: '_rpc_reportIdentifier:',
      __argument: { WIRConnectionIdentifierKey: 'c0ffee' },
    },
  },
  {
    name: 'a UTF-16 string',
    hex: '62706c69737430306200e9271308000000000000010100000000000000010000000000000000000000000000000d',
    value: String.fromCodePoint(0xe9, 0x2713),
  },
  {
    name: 'an array of sixteen, whose length takes its own integer',
    hex: '62706c6973743030af10100102030405060708090a0b0c0d0e0f101000100110021003100410051006100710081009100a100b100c100d100e100f081b1d1f21232527292b2d2f3133353739000000000000010100000000000000110000000000000000000000000000003b',
    value: Array.from({ length: 16 }, (_, index) => index),
  },
  {
    name: 'every scalar: a negative, a 2^40, a real, both booleans, data, an empty string',
    hex: '62706c6973743030a70102030405060713ffffffffffffffff130000010000000000233ff800000000000009084200ff50081019222b2c2d300000000000000101000000000000000800000000000000000000000000000031',
    value: [-1, 2 ** 40, 1.5, true, false, Buffer.from([0x00, 0xff]), ''],
  },
];

/** A document of the given objects (refs and offsets one byte each), built by hand. */
function document(objects: readonly Buffer[], top = 0): Buffer {
  const head = Buffer.from('bplist00', 'latin1');
  const offsets: number[] = [];
  let at = head.length;
  for (const object of objects) {
    offsets.push(at);
    at += object.length;
  }
  const trailer = Buffer.alloc(32);
  trailer.writeUInt8(1, 6);
  trailer.writeUInt8(1, 7);
  trailer.writeBigUInt64BE(BigInt(objects.length), 8);
  trailer.writeBigUInt64BE(BigInt(top), 16);
  trailer.writeBigUInt64BE(BigInt(at), 24);
  return Buffer.concat([head, ...objects, Buffer.from(offsets), trailer]);
}

describe('decodes what plistlib writes', () => {
  for (const { name, hex, value } of PLISTLIB) {
    it(name, () => {
      expect(decodeBinaryPlist(Buffer.from(hex, 'hex'))).toEqual(value);
    });
  }
});

describe('encodes byte for byte as plistlib does', () => {
  for (const { name, hex, value } of PLISTLIB) {
    it(name, () => {
      expect(encodeBinaryPlist(value).toString('hex')).toBe(hex);
    });
  }
});

describe('sizes its references by the object count', () => {
  it('300 objects take two-byte references, and read back whole', () => {
    const value = Array.from({ length: 299 }, (_, index) => `item ${index}`);
    const bytes = encodeBinaryPlist(value);
    expect(bytes.readUInt8(bytes.length - 32 + 7)).toBe(2);
    expect(decodeBinaryPlist(bytes)).toEqual(value);
  });
});

describe('keeps a __proto__ key as data', () => {
  it('reads it as an own property and leaves the prototype alone', () => {
    const bytes = document([
      Buffer.from([0xd1, 0x01, 0x02]),
      Buffer.concat([Buffer.from([0x59]), Buffer.from('__proto__', 'latin1')]),
      Buffer.from([0x10, 0x07]),
    ]);
    const value = decodeBinaryPlist(bytes) as Record<string, unknown>;
    expect(Object.getPrototypeOf(value)).toBe(Object.prototype);
    expect(Object.getOwnPropertyDescriptor(value, '__proto__')?.value).toBe(7);
  });
});

describe('refuses what it does not read, by name', () => {
  it('a document without the bplist00 magic', () => {
    expect(() =>
      decodeBinaryPlist(
        Buffer.from('<?xml version="1.0"?><plist/>' + ' '.repeat(40)),
      ),
    ).toThrow(/not a bplist00 document/);
  });
  it('a date, which no message this client reads carries', () => {
    expect(() =>
      decodeBinaryPlist(document([Buffer.from('330000000000000000', 'hex')])),
    ).toThrow(/object marker 0x33 at byte 8/);
  });
  it('a 16-byte integer', () => {
    expect(() =>
      decodeBinaryPlist(document([Buffer.from('14' + '00'.repeat(16), 'hex')])),
    ).toThrow(/a 16-byte integer/);
  });
  it('a dictionary key that is not a string', () => {
    expect(() =>
      decodeBinaryPlist(
        document([Buffer.from([0xd1, 0x01, 0x01]), Buffer.from([0x10, 0x01])]),
      ),
    ).toThrow(/dictionary key 0 at 8 is not a string/);
  });
  it('an array that contains itself', () => {
    expect(() =>
      decodeBinaryPlist(document([Buffer.from([0xa1, 0x00])])),
    ).toThrow(/nested deeper than 64/);
  });
  it('an ASCII string holding a byte above 0x7f', () => {
    expect(() =>
      decodeBinaryPlist(document([Buffer.from([0x51, 0xe9])])),
    ).toThrow(/ASCII string at 8 holds 0xe9/);
  });
  it('a string that runs past the object area', () => {
    expect(() =>
      decodeBinaryPlist(document([Buffer.from([0x55, 0x61])])),
    ).toThrow(/run past the object area/);
  });
  it('a reference to an object that is not there', () => {
    expect(() =>
      decodeBinaryPlist(document([Buffer.from([0xa1, 0x05])])),
    ).toThrow(/a reference to object 5 of 1/);
  });
  it('a real that is not finite, on the way out', () => {
    expect(() => encodeBinaryPlist(Number.NaN)).toThrow(PlistFormatError);
  });
  it('an integer past the safe range, on the way out', () => {
    expect(() => encodeBinaryPlist(2 ** 53)).toThrow(/is not a safe integer/);
  });
});

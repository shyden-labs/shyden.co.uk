# iPhone Web Inspector client — Implementation Plan (#811)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A zero-dependency client that reaches Safari's Web Inspector on the paired iPhone, so the iPhone mirror can emulate media, run early scripts, read the console and stub the network as Android does.

**Architecture:** Small layers under `tests/device/ios/inspector/`, each taking its transport as a parameter: plist codecs, framing, a length-framed plist link, then the usbmuxd, lockdown, Web Inspector RPC and JSON protocol clients. Only `connect.ts` touches `node:net` and `node:tls`; everything else is unit-tested over in-memory `duplexPair()` streams.

**Tech Stack:** TypeScript (Astro strict, `astro check`), Vitest, Node 26 built-ins (`node:stream`, `node:net`, `node:tls`, `node:crypto`).

**Spec:** `docs/superpowers/specs/2026-10-16-ios-web-inspector-design.md`

## Status (2026-10-16)

**On hold after Task 3** until the zero-code probe in the spec's section 8 (Safari's own Web Inspector on the phone's page, while WebDriverAgent runs: Shyden's ruling of 2026-10-18 retired `safaridriver`). Its attaching step (a) answered yes by hand on 2026-10-18 (#838 comment 6246973024); steps (b)-(e) remain. Tasks 4-9 (link, usbmux, lockdown, Web Inspector RPC, JSON protocol, the certificate pin and the TLS wiring) are written after it, from what the phone shows; Tasks 1-3 are the codecs any route needs.

## Scope

**Part A (this plan, no phone):** Tasks 1-9. **Part B (phone-gated):** step 1's probe records real exchanges; Part B's own plan (page surface, session wiring, canaries, ported tests, exemption list, forced-colours measurement) is written from those recordings, because its tests are pinned to bytes only the phone can supply.

## Global Constraints

- No new dependency: Node built-ins only (spec section 4, measured 2026-10-16).
- Node 26 (`PATH=/opt/homebrew/opt/node/bin:$PATH`); the typechecker is `npm run typecheck` (`astro check`), never `npx tsc`.
- Unit tests: no socket, no process, under 0.07 s of their own CPU, one test per case (generate at `describe` level), strict TDD: watch each go RED first.
- Fail fast naming the cause; no retries; every wait has a ceiling and names what it waited for.
- TLS: `rejectUnauthorized: false` only together with the pin to the pair record's `DeviceCertificate` (Task 9).
- A key named `__proto__` from the phone stays an own data property.
- The laptop runs unit, format, lint and typecheck only; every other suite is CI's.

## Review Focus

1. A frame split across reads at any byte: the reader reassembles it (Task 3, one test per split point).
2. A dictionary key `__proto__` in a plist: stays data, never the prototype (Tasks 1 and 2).
3. A listener that throws on a malformed message: fails the link with that error, never an uncaught exception (Task 4).
4. Cross-origin navigation swaps WebKit's target (`Target.didCommitProvisionalTarget`): later commands go to the new target (Task 8).
5. Bytes arriving in the same chunk as usbmuxd's `Connect` result: belong to the tunnel, not lost (Task 5).

---

### Task 1: Binary plist codec

**Files:**
- Create: `tests/device/ios/inspector/bplist.ts`
- Test: `tests/unit/ios-inspector-bplist.test.ts`

**Interfaces:**
- Produces: `type PlistValue`, `interface PlistDictionary`, `class PlistFormatError`, `isPlistDictionary(value)`, `setEntry(target, key, value)`, `decodeBinaryPlist(bytes: Buffer): PlistValue`, `encodeBinaryPlist(value: PlistValue): Buffer`.

- [ ] **Step 1: Write the failing test**

```ts
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
const PLISTLIB: ReadonlyArray<{ name: string; hex: string; value: PlistValue }> = [
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
    expect(() => decodeBinaryPlist(Buffer.from('<?xml version="1.0"?><plist/>' + ' '.repeat(40)))).toThrow(
      /not a bplist00 document/,
    );
  });
  it('a date, which no message this client reads carries', () => {
    expect(() => decodeBinaryPlist(document([Buffer.from('330000000000000000', 'hex')]))).toThrow(
      /object marker 0x33 at byte 8/,
    );
  });
  it('a 16-byte integer', () => {
    expect(() => decodeBinaryPlist(document([Buffer.from('14' + '00'.repeat(16), 'hex')]))).toThrow(
      /a 16-byte integer/,
    );
  });
  it('a dictionary key that is not a string', () => {
    expect(() =>
      decodeBinaryPlist(document([Buffer.from([0xd1, 0x01, 0x01]), Buffer.from([0x10, 0x01])])),
    ).toThrow(/dictionary key 0 at 8 is not a string/);
  });
  it('an array that contains itself', () => {
    expect(() => decodeBinaryPlist(document([Buffer.from([0xa1, 0x00])]))).toThrow(/nested deeper than 64/);
  });
  it('an ASCII string holding a byte above 0x7f', () => {
    expect(() => decodeBinaryPlist(document([Buffer.from([0x51, 0xe9])]))).toThrow(/ASCII string at 8 holds 0xe9/);
  });
  it('a string that runs past the object area', () => {
    expect(() => decodeBinaryPlist(document([Buffer.from([0x55, 0x61])]))).toThrow(/run past the object area/);
  });
  it('a reference to an object that is not there', () => {
    expect(() => decodeBinaryPlist(document([Buffer.from([0xa1, 0x05])]))).toThrow(
      /a reference to object 5 of 1/,
    );
  });
  it('a real that is not finite, on the way out', () => {
    expect(() => encodeBinaryPlist(Number.NaN)).toThrow(PlistFormatError);
  });
  it('an integer past the safe range, on the way out', () => {
    expect(() => encodeBinaryPlist(2 ** 53)).toThrow(/is not a safe integer/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `PATH=/opt/homebrew/opt/node/bin:$PATH npx vitest run tests/unit/ios-inspector-bplist.test.ts`
Expected: FAIL, `Failed to resolve import "../device/ios/inspector/bplist"`.

- [ ] **Step 3: Write the implementation**

```ts
/**
 * Binary property lists (`bplist00`): the subset the iPhone's lockdown and
 * Web Inspector services speak, namely dictionaries with string keys,
 * arrays, strings (ASCII and UTF-16), integers, reals, booleans and data
 * (#811). Anything else is refused by name rather than read as something
 * it is not.
 *
 * Layout (Apple's CFBinaryPList.c): the magic, every object, a table of
 * each object's offset, and a 32-byte trailer giving the size of an offset
 * and of an object reference, the object count, the top object and where
 * the table starts. Objects are written depth-first, a dictionary's keys
 * before its values, which is also the order Python's plistlib writes, so
 * the unit tests compare bytes with it.
 */

export type PlistValue = string | number | boolean | Buffer | readonly PlistValue[] | PlistDictionary;

export interface PlistDictionary {
  readonly [key: string]: PlistValue;
}

/** A plist that is malformed, or uses a type this client does not read. */
export class PlistFormatError extends Error {
  constructor(message: string) {
    super(`plist: ${message}`);
    this.name = 'PlistFormatError';
  }
}

const MAGIC = Buffer.from('bplist00', 'latin1');
const TRAILER_LENGTH = 32;
/** Deeper than any message the phone sends; stops a cycle recursing forever. */
const MAX_DEPTH = 64;

export function isPlistDictionary(value: PlistValue): value is PlistDictionary {
  return typeof value === 'object' && !Buffer.isBuffer(value) && !Array.isArray(value);
}

/** Sets `key` as an own property, so a key named `__proto__` stays data. */
export function setEntry(target: Record<string, PlistValue>, key: string, value: PlistValue): void {
  Object.defineProperty(target, key, { value, enumerable: true, writable: true, configurable: true });
}

function hex(byte: number): string {
  return byte.toString(16).padStart(2, '0');
}

function readUnsigned(bytes: Buffer, offset: number, size: number): number {
  if (size === 1) return bytes.readUInt8(offset);
  if (size === 2) return bytes.readUInt16BE(offset);
  if (size === 4) return bytes.readUInt32BE(offset);
  if (size === 8) {
    const value = bytes.readBigUInt64BE(offset);
    if (value > BigInt(Number.MAX_SAFE_INTEGER)) {
      throw new PlistFormatError(`${value} is past any safe integer`);
    }
    return Number(value);
  }
  throw new PlistFormatError(`no ${size}-byte unsigned integer`);
}

function writeUnsigned(target: Buffer, value: number, offset: number, size: number): void {
  if (size === 1) target.writeUInt8(value, offset);
  else if (size === 2) target.writeUInt16BE(value, offset);
  else if (size === 4) target.writeUInt32BE(value, offset);
  else target.writeBigUInt64BE(BigInt(value), offset);
}

/** The fewest of 1, 2, 4 or 8 bytes that hold `count`. */
function sizeFor(count: number): number {
  if (count < 0x100) return 1;
  if (count < 0x10000) return 2;
  if (count < 0x100000000) return 4;
  return 8;
}

export function decodeBinaryPlist(bytes: Buffer): PlistValue {
  if (bytes.length < MAGIC.length + TRAILER_LENGTH || !bytes.subarray(0, MAGIC.length).equals(MAGIC)) {
    throw new PlistFormatError(
      `not a bplist00 document: ${bytes.length} bytes starting ${JSON.stringify(bytes.subarray(0, 8).toString('latin1'))}`,
    );
  }
  const end = bytes.length - TRAILER_LENGTH;
  const offsetSize = bytes.readUInt8(end + 6);
  const refSize = bytes.readUInt8(end + 7);
  const objectCount = readUnsigned(bytes, end + 8, 8);
  const topObject = readUnsigned(bytes, end + 16, 8);
  const tableStart = readUnsigned(bytes, end + 24, 8);
  if (tableStart < MAGIC.length || tableStart + objectCount * offsetSize > end) {
    throw new PlistFormatError(
      `an offset table of ${objectCount} x ${offsetSize} bytes at ${tableStart} does not fit before the trailer at ${end}`,
    );
  }
  const span = (start: number, length: number): Buffer => {
    if (start + length > tableStart) {
      throw new PlistFormatError(`${length} bytes at ${start} run past the object area`);
    }
    return bytes.subarray(start, start + length);
  };
  const offsetOf = (ref: number): number => {
    if (ref >= objectCount) throw new PlistFormatError(`a reference to object ${ref} of ${objectCount}`);
    const offset = readUnsigned(bytes, tableStart + ref * offsetSize, offsetSize);
    if (offset < MAGIC.length || offset >= tableStart) {
      throw new PlistFormatError(`object ${ref} is said to start at ${offset}, outside the object area`);
    }
    return offset;
  };
  const lengthAfter = (offset: number, low: number): { length: number; start: number } => {
    if (low !== 0x0f) return { length: low, start: offset + 1 };
    const marker = span(offset + 1, 1).readUInt8(0);
    if (marker >> 4 !== 0x1 || (marker & 0x0f) > 3) {
      throw new PlistFormatError(`a length at ${offset + 1} has marker 0x${hex(marker)}, not an integer`);
    }
    const size = 1 << (marker & 0x0f);
    return { length: readUnsigned(span(offset + 2, size), 0, size), start: offset + 2 + size };
  };
  const refsAt = (start: number, count: number): number[] => {
    const area = span(start, count * refSize);
    return Array.from({ length: count }, (_, index) => readUnsigned(area, index * refSize, refSize));
  };
  const read = (ref: number, depth: number): PlistValue => {
    if (depth > MAX_DEPTH) throw new PlistFormatError(`nested deeper than ${MAX_DEPTH}`);
    const offset = offsetOf(ref);
    const marker = bytes.readUInt8(offset);
    const high = marker >> 4;
    const low = marker & 0x0f;
    if (marker === 0x08) return false;
    if (marker === 0x09) return true;
    if (high === 0x1) {
      if (low > 3) throw new PlistFormatError(`a ${2 ** low}-byte integer at ${offset}`);
      const size = 1 << low;
      const body = span(offset + 1, size);
      if (size < 8) return readUnsigned(body, 0, size);
      const value = body.readBigInt64BE(0);
      if (value > BigInt(Number.MAX_SAFE_INTEGER) || value < BigInt(Number.MIN_SAFE_INTEGER)) {
        throw new PlistFormatError(`the integer ${value} at ${offset} is past the safe range`);
      }
      return Number(value);
    }
    if (marker === 0x22) return span(offset + 1, 4).readFloatBE(0);
    if (marker === 0x23) return span(offset + 1, 8).readDoubleBE(0);
    if (high === 0x4 || high === 0x5 || high === 0x6 || high === 0xa || high === 0xd) {
      const { length, start } = lengthAfter(offset, low);
      if (high === 0x4) return Buffer.from(span(start, length));
      if (high === 0x5) {
        const body = span(start, length);
        const wide = body.find((byte) => byte > 0x7f);
        if (wide !== undefined) throw new PlistFormatError(`the ASCII string at ${offset} holds 0x${hex(wide)}`);
        return body.toString('latin1');
      }
      if (high === 0x6) {
        const units = Buffer.from(span(start, length * 2));
        units.swap16();
        return units.toString('utf16le');
      }
      if (high === 0xa) return refsAt(start, length).map((child) => read(child, depth + 1));
      const refs = refsAt(start, length * 2);
      const result: Record<string, PlistValue> = {};
      for (let index = 0; index < length; index += 1) {
        const key = read(refs[index], depth + 1);
        if (typeof key !== 'string') {
          throw new PlistFormatError(`dictionary key ${index} at ${offset} is not a string`);
        }
        setEntry(result, key, read(refs[length + index], depth + 1));
      }
      return result;
    }
    throw new PlistFormatError(`object marker 0x${hex(marker)} at byte ${offset} is not one this client reads`);
  };
  if (topObject >= objectCount) {
    throw new PlistFormatError(`the top object ${topObject} is not among ${objectCount}`);
  }
  return read(topObject, 0);
}

function encodeInteger(value: number): Buffer {
  if (!Number.isSafeInteger(value)) throw new PlistFormatError(`${value} is not a safe integer`);
  if (value >= 0 && value <= 0xff) return Buffer.from([0x10, value]);
  if (value >= 0 && value <= 0xffff) {
    const bytes = Buffer.alloc(3);
    bytes.writeUInt8(0x11, 0);
    bytes.writeUInt16BE(value, 1);
    return bytes;
  }
  if (value >= 0 && value <= 0xffffffff) {
    const bytes = Buffer.alloc(5);
    bytes.writeUInt8(0x12, 0);
    bytes.writeUInt32BE(value, 1);
    return bytes;
  }
  const bytes = Buffer.alloc(9);
  bytes.writeUInt8(0x13, 0);
  bytes.writeBigInt64BE(BigInt(value), 1);
  return bytes;
}

function marker(high: number, length: number): Buffer {
  if (length < 0x0f) return Buffer.from([(high << 4) | length]);
  return Buffer.concat([Buffer.from([(high << 4) | 0x0f]), encodeInteger(length)]);
}

function isAscii(text: string): boolean {
  for (let index = 0; index < text.length; index += 1) {
    if (text.charCodeAt(index) > 0x7f) return false;
  }
  return true;
}

function encodeObject(value: PlistValue, refs: readonly number[], refSize: number): Buffer {
  if (typeof value === 'boolean') return Buffer.from([value ? 0x09 : 0x08]);
  if (typeof value === 'number') {
    if (Number.isInteger(value)) return encodeInteger(value);
    if (!Number.isFinite(value)) throw new PlistFormatError(`${value} is not a finite real`);
    const bytes = Buffer.alloc(9);
    bytes.writeUInt8(0x23, 0);
    bytes.writeDoubleBE(value, 1);
    return bytes;
  }
  if (typeof value === 'string') {
    if (isAscii(value)) return Buffer.concat([marker(0x5, value.length), Buffer.from(value, 'latin1')]);
    const units = Buffer.from(value, 'utf16le');
    units.swap16();
    return Buffer.concat([marker(0x6, units.length / 2), units]);
  }
  if (Buffer.isBuffer(value)) return Buffer.concat([marker(0x4, value.length), value]);
  const refBytes = Buffer.alloc(refs.length * refSize);
  refs.forEach((ref, index) => writeUnsigned(refBytes, ref, index * refSize, refSize));
  const isArray = Array.isArray(value);
  return Buffer.concat([marker(isArray ? 0xa : 0xd, isArray ? refs.length : refs.length / 2), refBytes]);
}

export function encodeBinaryPlist(value: PlistValue): Buffer {
  const nodes: { readonly value: PlistValue; refs: number[] }[] = [];
  const visit = (node: PlistValue, depth: number): number => {
    if (depth > MAX_DEPTH) throw new PlistFormatError(`nested deeper than ${MAX_DEPTH}`);
    const entry = { value: node, refs: [] as number[] };
    const index = nodes.push(entry) - 1;
    if (Array.isArray(node)) {
      entry.refs = (node as readonly PlistValue[]).map((child) => visit(child, depth + 1));
    } else if (isPlistDictionary(node)) {
      const keys = Object.keys(node);
      const keyRefs = keys.map((key) => visit(key, depth + 1));
      entry.refs = [...keyRefs, ...keys.map((key) => visit(node[key], depth + 1))];
    }
    return index;
  };
  visit(value, 0);
  const refSize = sizeFor(nodes.length);
  const bodies = nodes.map((node) => encodeObject(node.value, node.refs, refSize));
  const offsets: number[] = [];
  let at = MAGIC.length;
  for (const body of bodies) {
    offsets.push(at);
    at += body.length;
  }
  const offsetSize = sizeFor(at);
  const table = Buffer.alloc(offsets.length * offsetSize);
  offsets.forEach((offset, index) => writeUnsigned(table, offset, index * offsetSize, offsetSize));
  const trailer = Buffer.alloc(TRAILER_LENGTH);
  trailer.writeUInt8(offsetSize, 6);
  trailer.writeUInt8(refSize, 7);
  trailer.writeBigUInt64BE(BigInt(nodes.length), 8);
  trailer.writeBigUInt64BE(BigInt(0), 16);
  trailer.writeBigUInt64BE(BigInt(at), 24);
  return Buffer.concat([MAGIC, ...bodies, table, trailer]);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `PATH=/opt/homebrew/opt/node/bin:$PATH npx vitest run tests/unit/ios-inspector-bplist.test.ts`
Expected: PASS, every test. If an "encodes byte for byte" case differs, print both hex strings and find the first differing byte before changing anything: it names which size rule disagrees with plistlib.

- [ ] **Step 5: Commit**

```bash
git add tests/device/ios/inspector/bplist.ts tests/unit/ios-inspector-bplist.test.ts
git commit -m "The iPhone inspector reads and writes binary plists, byte for byte as plistlib does (Refs #811)"
```

---

### Task 2: XML plists, and reading either kind

**Files:**
- Create: `tests/device/ios/inspector/plist-xml.ts`
- Test: `tests/unit/ios-inspector-plist-xml.test.ts`

**Interfaces:**
- Consumes: Task 1's `PlistValue`, `PlistFormatError`, `decodeBinaryPlist`, `isPlistDictionary`, `setEntry`.
- Produces: `encodeXmlPlist(value: PlistValue): Buffer`, `decodeXmlPlist(text: string): PlistValue`, `decodeAnyPlist(bytes: Buffer): PlistValue`.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from 'vitest';
import { encodeBinaryPlist } from '../device/ios/inspector/bplist';
import { decodeAnyPlist, decodeXmlPlist, encodeXmlPlist } from '../device/ios/inspector/plist-xml';

/**
 * XML plists: usbmuxd's messages and the pair record it hands out are XML
 * (#811). PLISTLIB_XML was written by Python's plistlib on 2026-10-16.
 */
const PLISTLIB_XML = [
  '<?xml version="1.0" encoding="UTF-8"?>',
  '<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">',
  '<plist version="1.0">',
  '<dict>',
  '\t<key>MessageType</key>',
  '\t<string>ListDevices</string>',
  '\t<key>n</key>',
  '\t<integer>3</integer>',
  '\t<key>d</key>',
  '\t<data>',
  '\taGk=',
  '\t</data>',
  '\t<key>t</key>',
  '\t<true/>',
  '\t<key>s</key>',
  '\t<string>a&lt;b&amp;c</string>',
  '</dict>',
  '</plist>',
  '',
].join('\n');

const plist = (body: string): string => `<?xml version="1.0" encoding="UTF-8"?>\n<plist version="1.0">${body}</plist>`;

describe('reads XML plists', () => {
  it('what plistlib writes, doctype, whitespace and entities included', () => {
    expect(decodeXmlPlist(PLISTLIB_XML)).toEqual({
      MessageType: 'ListDevices',
      n: 3,
      d: Buffer.from('hi'),
      t: true,
      s: 'a<b&c',
    });
  });
  it('empty elements', () => {
    expect(decodeXmlPlist(plist('<array><string/><dict/><array/><data/><false/></array>'))).toEqual([
      '',
      {},
      [],
      Buffer.alloc(0),
      false,
    ]);
  });
  it('a negative integer and a real', () => {
    expect(decodeXmlPlist(plist('<array><integer>-12</integer><real>2.5</real></array>'))).toEqual([-12, 2.5]);
  });
  it('numeric character references', () => {
    expect(decodeXmlPlist(plist('<string>&#65;&#x42;</string>'))).toBe('AB');
  });
  it('a __proto__ key as an own property', () => {
    const value = decodeXmlPlist(plist('<dict><key>__proto__</key><integer>7</integer></dict>')) as Record<string, unknown>;
    expect(Object.getPrototypeOf(value)).toBe(Object.prototype);
    expect(Object.getOwnPropertyDescriptor(value, '__proto__')?.value).toBe(7);
  });
});

describe('writes XML plists it reads back', () => {
  it('every type, with markup characters escaped', () => {
    const value = { s: 'a<b>&c', n: 62078, r: 0.5, t: true, f: false, d: Buffer.from([1, 2, 3]), a: ['x', { y: 1 }] };
    const text = encodeXmlPlist(value).toString('utf8');
    expect(text).toContain('<string>a&lt;b&gt;&amp;c</string>');
    expect(decodeXmlPlist(text)).toEqual(value);
  });
});

describe('refuses what it does not read, by name', () => {
  it('a date element', () => {
    expect(() => decodeXmlPlist(plist('<date>2026-10-16T00:00:00Z</date>'))).toThrow(/<date> is not a plist element/);
  });
  it('markup inside a string', () => {
    expect(() => decodeXmlPlist(plist('<string>a<b/></string>'))).toThrow(/<string> holds markup/);
  });
  it('an unknown entity', () => {
    expect(() => decodeXmlPlist(plist('<string>&nbsp;</string>'))).toThrow(/unknown entity &nbsp;/);
  });
  it('an integer that is not one', () => {
    expect(() => decodeXmlPlist(plist('<integer>1e3</integer>'))).toThrow(/"1e3" is not an integer/);
  });
  it('data that is not base64', () => {
    expect(() => decodeXmlPlist(plist('<data>a*b</data>'))).toThrow(/is not base64/);
  });
  it('a dictionary entry without its key', () => {
    expect(() => decodeXmlPlist(plist('<dict><string>x</string></dict>'))).toThrow(/expected <key>, got <string>/);
  });
  it('anything after the closing plist tag', () => {
    expect(() => decodeXmlPlist(`${plist('<true/>')}<true/>`)).toThrow(/trailing content/);
  });
  it('a document with no plist element', () => {
    expect(() => decodeXmlPlist('<dict></dict>')).toThrow(/expected <plist>/);
  });
});

describe('reads either kind from bytes', () => {
  it('a binary plist, by its magic', () => {
    expect(decodeAnyPlist(encodeBinaryPlist({ Port: 49152 }))).toEqual({ Port: 49152 });
  });
  it('an XML plist otherwise', () => {
    expect(decodeAnyPlist(Buffer.from(plist('<dict><key>Number</key><integer>0</integer></dict>')))).toEqual({ Number: 0 });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `PATH=/opt/homebrew/opt/node/bin:$PATH npx vitest run tests/unit/ios-inspector-plist-xml.test.ts`
Expected: FAIL, `Failed to resolve import "../device/ios/inspector/plist-xml"`.

- [ ] **Step 3: Write the implementation**

```ts
/**
 * XML property lists: usbmuxd's messages and the pair record it hands out
 * are XML, and lockdown may answer in either kind (#811). The same subset
 * as bplist.ts; anything else is refused by name.
 *
 * The writer leaves out the DOCTYPE line Apple's tools add: usbmuxd parses
 * with libplist, which does not need it (measured in step 1 of the plan
 * that uses this), and leaving it out keeps a third-party URL out of the
 * source.
 */
import {
  PlistFormatError,
  decodeBinaryPlist,
  isPlistDictionary,
  setEntry,
  type PlistValue,
} from './bplist';

const HEAD = '<?xml version="1.0" encoding="UTF-8"?>\n<plist version="1.0">\n';
const MAGIC = Buffer.from('bplist00', 'latin1');

function escape(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

const ENTITIES: Readonly<Record<string, string>> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };

function unescape(text: string): string {
  return text.replace(/&(#x[0-9a-fA-F]+|#[0-9]+|[A-Za-z]+);/g, (whole: string, name: string) => {
    if (name.startsWith('#x')) return String.fromCodePoint(Number.parseInt(name.slice(2), 16));
    if (name.startsWith('#')) return String.fromCodePoint(Number.parseInt(name.slice(1), 10));
    const known = ENTITIES[name];
    if (known === undefined) throw new PlistFormatError(`unknown entity ${whole}`);
    return known;
  });
}

function element(value: PlistValue): string {
  if (typeof value === 'string') return `<string>${escape(value)}</string>`;
  if (typeof value === 'boolean') return value ? '<true/>' : '<false/>';
  if (typeof value === 'number') {
    if (Number.isInteger(value)) {
      if (!Number.isSafeInteger(value)) throw new PlistFormatError(`${value} is not a safe integer`);
      return `<integer>${value}</integer>`;
    }
    if (!Number.isFinite(value)) throw new PlistFormatError(`${value} is not a finite real`);
    return `<real>${value}</real>`;
  }
  if (Buffer.isBuffer(value)) return `<data>${value.toString('base64')}</data>`;
  if (Array.isArray(value)) return `<array>${(value as readonly PlistValue[]).map(element).join('')}</array>`;
  if (!isPlistDictionary(value)) throw new PlistFormatError('a value of no plist type');
  const entries = Object.keys(value).map((key) => `<key>${escape(key)}</key>${element(value[key])}`);
  return `<dict>${entries.join('')}</dict>`;
}

export function encodeXmlPlist(value: PlistValue): Buffer {
  return Buffer.from(`${HEAD}${element(value)}\n</plist>\n`, 'utf8');
}

interface Tag {
  readonly name: string;
  readonly closing: boolean;
  readonly empty: boolean;
}

export function decodeXmlPlist(xml: string): PlistValue {
  const body = xml
    .replace(/^﻿/, '')
    .replace(/<\?xml[\s\S]*?\?>/, '')
    .replace(/<!DOCTYPE[^>]*>/, '')
    .replace(/<!--[\s\S]*?-->/g, '');
  let at = 0;
  const skipSpace = (): void => {
    while (at < body.length && /\s/.test(body.charAt(at))) at += 1;
  };
  const tag = (): Tag => {
    skipSpace();
    const match = /^<(\/?)([A-Za-z]+)(?:\s[^>]*?)?(\/?)>/.exec(body.slice(at));
    if (!match) {
      throw new PlistFormatError(`expected a tag at character ${at}: ${JSON.stringify(body.slice(at, at + 24))}`);
    }
    at += match[0].length;
    return { name: match[2], closing: match[1] === '/', empty: match[3] === '/' };
  };
  const text = (name: string): string => {
    const close = `</${name}>`;
    const end = body.indexOf(close, at);
    if (end < 0) throw new PlistFormatError(`<${name}> at character ${at} is never closed`);
    const raw = body.slice(at, end);
    at = end + close.length;
    if (raw.includes('<')) throw new PlistFormatError(`<${name}> holds markup`);
    return unescape(raw);
  };
  const closeOf = (open: Tag): void => {
    if (open.empty) return;
    const next = tag();
    if (!next.closing || next.name !== open.name) throw new PlistFormatError(`<${open.name}> is not closed`);
  };
  const value = (open: Tag): PlistValue => {
    if (open.closing) throw new PlistFormatError(`unexpected </${open.name}>`);
    switch (open.name) {
      case 'string':
        return open.empty ? '' : text('string');
      case 'integer': {
        const raw = text('integer').trim();
        if (!/^[+-]?\d+$/.test(raw)) throw new PlistFormatError(`${JSON.stringify(raw)} is not an integer`);
        const number = Number(raw);
        if (!Number.isSafeInteger(number)) throw new PlistFormatError(`${raw} is past the safe range`);
        return number;
      }
      case 'real': {
        const raw = text('real').trim();
        const number = Number(raw);
        if (raw === '' || !Number.isFinite(number)) throw new PlistFormatError(`${JSON.stringify(raw)} is not a real`);
        return number;
      }
      case 'true':
        closeOf(open);
        return true;
      case 'false':
        closeOf(open);
        return false;
      case 'data': {
        if (open.empty) return Buffer.alloc(0);
        const raw = text('data').replace(/\s+/g, '');
        if (!/^[A-Za-z0-9+/]*={0,2}$/.test(raw)) throw new PlistFormatError(`${JSON.stringify(raw.slice(0, 24))} is not base64`);
        return Buffer.from(raw, 'base64');
      }
      case 'array': {
        const items: PlistValue[] = [];
        if (open.empty) return items;
        for (;;) {
          const next = tag();
          if (next.closing) {
            if (next.name !== 'array') throw new PlistFormatError(`</${next.name}> closes an <array>`);
            return items;
          }
          items.push(value(next));
        }
      }
      case 'dict': {
        const result: Record<string, PlistValue> = {};
        if (open.empty) return result;
        for (;;) {
          const next = tag();
          if (next.closing) {
            if (next.name !== 'dict') throw new PlistFormatError(`</${next.name}> closes a <dict>`);
            return result;
          }
          if (next.name !== 'key') throw new PlistFormatError(`expected <key>, got <${next.name}>`);
          const key = next.empty ? '' : text('key');
          setEntry(result, key, value(tag()));
        }
      }
      default:
        throw new PlistFormatError(`<${open.name}> is not a plist element this client reads`);
    }
  };
  const root = tag();
  if (root.name !== 'plist' || root.closing || root.empty) throw new PlistFormatError(`expected <plist>, got <${root.name}>`);
  const result = value(tag());
  const end = tag();
  if (!end.closing || end.name !== 'plist') throw new PlistFormatError(`expected </plist>, got <${end.name}>`);
  skipSpace();
  if (at !== body.length) throw new PlistFormatError(`trailing content after </plist> at character ${at}`);
  return result;
}

/** Lockdown answers in either kind: a binary plist starts with its magic. */
export function decodeAnyPlist(bytes: Buffer): PlistValue {
  if (bytes.subarray(0, MAGIC.length).equals(MAGIC)) return decodeBinaryPlist(bytes);
  return decodeXmlPlist(bytes.toString('utf8'));
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `PATH=/opt/homebrew/opt/node/bin:$PATH npx vitest run tests/unit/ios-inspector-plist-xml.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add tests/device/ios/inspector/plist-xml.ts tests/unit/ios-inspector-plist-xml.test.ts
git commit -m "The iPhone inspector reads and writes XML plists, and reads either kind (Refs #811)"
```

---

### Task 3: Frames, and fields read off a message

**Files:**
- Create: `tests/device/ios/inspector/framing.ts`, `tests/device/ios/inspector/fields.ts`
- Test: `tests/unit/ios-inspector-framing.test.ts`, `tests/unit/ios-inspector-fields.test.ts`

**Interfaces:**
- Consumes: Task 1's `PlistValue`, `PlistDictionary`, `isPlistDictionary`.
- Produces: `USBMUX_HEADER_LENGTH = 16`, `MAX_FRAME_LENGTH`, `class FrameError`, `encodeUsbmuxFrame(tag: number, payload: Buffer): Buffer`, `encodeLengthFrame(payload: Buffer): Buffer`, `interface Frame { tag: number; payload: Buffer }`, `class FrameReader { constructor(kind: 'usbmux' | 'length'); push(chunk: Buffer): Frame[]; takeRemainder(): Buffer }`; `class ProtocolShapeError`, `dictionaryOf(value, what)`, `dictionaryField(message, key, what)`, `arrayField`, `stringField`, `numberField`, `dataField`, `flagOr(message, key, fallback, what): boolean`, `stringOr(message, key, fallback, what): string`.

- [ ] **Step 1: Write the failing tests**

`tests/unit/ios-inspector-framing.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import {
  FrameReader,
  MAX_FRAME_LENGTH,
  encodeLengthFrame,
  encodeUsbmuxFrame,
} from '../device/ios/inspector/framing';

/**
 * usbmuxd frames (16-byte little-endian header: total length, version 1,
 * type 8 for a plist, tag) and lockdown's and the Web Inspector service's
 * frames (4-byte big-endian length), read back as they arrive in pieces
 * (#811; layout read from appium-ios-device 3.1.24, 2026-10-16).
 */
const PAYLOAD = Buffer.from('payload');
const USBMUX = encodeUsbmuxFrame(5, PAYLOAD);
const LENGTH = encodeLengthFrame(PAYLOAD);

describe('writes frames', () => {
  it('a usbmuxd header: length 23, version 1, type 8, tag 5, little-endian', () => {
    expect(USBMUX.subarray(0, 16).toString('hex')).toBe('17000000010000000800000005000000');
    expect(USBMUX.subarray(16)).toEqual(PAYLOAD);
  });
  it('a length frame: 7, big-endian, then the payload', () => {
    expect(LENGTH.toString('hex')).toBe(`00000007${PAYLOAD.toString('hex')}`);
  });
});

describe('reads a usbmuxd frame split at every byte', () => {
  for (let split = 1; split < USBMUX.length; split += 1) {
    it(`split after byte ${split}`, () => {
      const reader = new FrameReader('usbmux');
      expect(reader.push(USBMUX.subarray(0, split))).toEqual([]);
      expect(reader.push(USBMUX.subarray(split))).toEqual([{ tag: 5, payload: PAYLOAD }]);
    });
  }
});

describe('reads a length frame split at every byte', () => {
  for (let split = 1; split < LENGTH.length; split += 1) {
    it(`split after byte ${split}`, () => {
      const reader = new FrameReader('length');
      expect(reader.push(LENGTH.subarray(0, split))).toEqual([]);
      expect(reader.push(LENGTH.subarray(split))).toEqual([{ tag: 0, payload: PAYLOAD }]);
    });
  }
});

describe('reads what arrives together', () => {
  it('two frames in one chunk, in order', () => {
    const reader = new FrameReader('length');
    const second = encodeLengthFrame(Buffer.from('two'));
    expect(reader.push(Buffer.concat([LENGTH, second]))).toEqual([
      { tag: 0, payload: PAYLOAD },
      { tag: 0, payload: Buffer.from('two') },
    ]);
  });
  it('keeps the bytes after the last whole frame for whoever reads next', () => {
    const reader = new FrameReader('usbmux');
    reader.push(Buffer.concat([USBMUX, Buffer.from('tunnel')]));
    expect(reader.takeRemainder()).toEqual(Buffer.from('tunnel'));
    expect(reader.takeRemainder()).toEqual(Buffer.alloc(0));
  });
});

describe('refuses a frame it cannot trust, by name', () => {
  it('a usbmuxd version other than 1', () => {
    const frame = Buffer.from(USBMUX);
    frame.writeUInt32LE(2, 4);
    expect(() => new FrameReader('usbmux').push(frame)).toThrow(/usbmuxd frame of version 2, type 8/);
  });
  it('a usbmuxd length shorter than its own header', () => {
    const frame = Buffer.from(USBMUX);
    frame.writeUInt32LE(4, 0);
    expect(() => new FrameReader('usbmux').push(frame)).toThrow(/claims 4 bytes, less than its 16-byte header/);
  });
  it('a length past the ceiling', () => {
    const header = Buffer.alloc(4);
    header.writeUInt32BE(MAX_FRAME_LENGTH + 1, 0);
    expect(() => new FrameReader('length').push(header)).toThrow(/past the 20971520-byte ceiling/);
  });
});
```

`tests/unit/ios-inspector-fields.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import {
  arrayField,
  dataField,
  dictionaryField,
  dictionaryOf,
  flagOr,
  numberField,
  stringField,
  stringOr,
} from '../device/ios/inspector/fields';

/** Fields read off a decoded message, each refusing the wrong kind by name (#811). */
const MESSAGE = { s: 'x', n: 3, d: Buffer.from('b'), a: [1], m: { k: 'v' }, t: true, one: 1, zero: 0 };

describe('reads each kind of field', () => {
  it('a string', () => expect(stringField(MESSAGE, 's', 'probe')).toBe('x'));
  it('a number', () => expect(numberField(MESSAGE, 'n', 'probe')).toBe(3));
  it('data', () => expect(dataField(MESSAGE, 'd', 'probe')).toEqual(Buffer.from('b')));
  it('an array', () => expect(arrayField(MESSAGE, 'a', 'probe')).toEqual([1]));
  it('a dictionary', () => expect(dictionaryField(MESSAGE, 'm', 'probe')).toEqual({ k: 'v' }));
  it('a boolean flag', () => expect(flagOr(MESSAGE, 't', false, 'probe')).toBe(true));
  it('a flag written as 1', () => expect(flagOr(MESSAGE, 'one', false, 'probe')).toBe(true));
  it('a flag written as 0', () => expect(flagOr(MESSAGE, 'zero', true, 'probe')).toBe(false));
  it('a missing flag, as the fallback', () => expect(flagOr(MESSAGE, 'absent', true, 'probe')).toBe(true));
  it('a missing string, as the fallback', () => expect(stringOr(MESSAGE, 'absent', '', 'probe')).toBe(''));
});

describe('refuses the wrong kind, naming the message, the key and what came', () => {
  it('a number where a string was expected', () => {
    expect(() => stringField(MESSAGE, 'n', 'ListDevices')).toThrow('ListDevices: expected n to be a string, got the number 3');
  });
  it('a missing number', () => {
    expect(() => numberField(MESSAGE, 'absent', 'Connect')).toThrow('Connect: expected absent to be a number, got nothing');
  });
  it('a string where a flag was expected', () => {
    expect(() => flagOr(MESSAGE, 's', false, 'StartService')).toThrow('StartService: expected s to be a flag, got the string "x"');
  });
  it('an array where a dictionary was expected', () => {
    expect(() => dictionaryOf([1], 'a usbmuxd answer')).toThrow('a usbmuxd answer: expected a dictionary, got an array of 1');
  });
  it('an inherited key, which is not the message own', () => {
    expect(() => stringField(MESSAGE, 'toString', 'probe')).toThrow('probe: expected toString to be a string, got nothing');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `PATH=/opt/homebrew/opt/node/bin:$PATH npx vitest run tests/unit/ios-inspector-framing.test.ts tests/unit/ios-inspector-fields.test.ts`
Expected: FAIL, both imports unresolved.

- [ ] **Step 3: Write the implementations**

`tests/device/ios/inspector/framing.ts`:

```ts
/**
 * The two frame shapes on the way to Safari's Web Inspector (#811; read
 * from appium-ios-device 3.1.24 on 2026-10-16, re-pinned from the phone's
 * own bytes in step 1 of Part B):
 *
 * - usbmuxd: a 16-byte little-endian header (total length including the
 *   header, version 1, type 8 for a plist, a tag the answer echoes), then
 *   an XML plist.
 * - lockdown and the Web Inspector service: a 4-byte big-endian length,
 *   then a plist.
 *
 * A socket delivers bytes in whatever pieces it likes, so FrameReader
 * keeps what it has until a frame is whole.
 */
export const USBMUX_HEADER_LENGTH = 16;
const LENGTH_HEADER = 4;
const USBMUX_VERSION = 1;
const USBMUX_PLIST = 8;
/** appium-ios-device's ceiling for the Web Inspector service; nothing the phone sends here comes near it. */
export const MAX_FRAME_LENGTH = 20 * 1024 * 1024;

/** A frame whose header cannot be trusted; the connection is not read further. */
export class FrameError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'FrameError';
  }
}

export interface Frame {
  /** usbmuxd's tag; 0 for a length frame, which has none. */
  readonly tag: number;
  readonly payload: Buffer;
}

export function encodeUsbmuxFrame(tag: number, payload: Buffer): Buffer {
  const header = Buffer.alloc(USBMUX_HEADER_LENGTH);
  header.writeUInt32LE(USBMUX_HEADER_LENGTH + payload.length, 0);
  header.writeUInt32LE(USBMUX_VERSION, 4);
  header.writeUInt32LE(USBMUX_PLIST, 8);
  header.writeUInt32LE(tag, 12);
  return Buffer.concat([header, payload]);
}

export function encodeLengthFrame(payload: Buffer): Buffer {
  const header = Buffer.alloc(LENGTH_HEADER);
  header.writeUInt32BE(payload.length, 0);
  return Buffer.concat([header, payload]);
}

export class FrameReader {
  private pending: Buffer = Buffer.alloc(0);

  constructor(private readonly kind: 'usbmux' | 'length') {}

  /** Adds bytes as they arrive; returns every frame now whole, in order. */
  push(chunk: Buffer): Frame[] {
    this.pending = this.pending.length === 0 ? chunk : Buffer.concat([this.pending, chunk]);
    const frames: Frame[] = [];
    const headerLength = this.kind === 'usbmux' ? USBMUX_HEADER_LENGTH : LENGTH_HEADER;
    for (;;) {
      if (this.pending.length < headerLength) return frames;
      const total =
        this.kind === 'usbmux' ? this.pending.readUInt32LE(0) : LENGTH_HEADER + this.pending.readUInt32BE(0);
      if (total < headerLength) {
        throw new FrameError(`a usbmuxd frame claims ${total} bytes, less than its ${headerLength}-byte header`);
      }
      if (total - headerLength > MAX_FRAME_LENGTH) {
        throw new FrameError(`a ${this.kind} frame of ${total - headerLength} bytes is past the ${MAX_FRAME_LENGTH}-byte ceiling`);
      }
      if (this.kind === 'usbmux') {
        const version = this.pending.readUInt32LE(4);
        const type = this.pending.readUInt32LE(8);
        if (version !== USBMUX_VERSION || type !== USBMUX_PLIST) {
          throw new FrameError(`a usbmuxd frame of version ${version}, type ${type}: this client reads version 1, type 8`);
        }
      }
      if (this.pending.length < total) return frames;
      const tag = this.kind === 'usbmux' ? this.pending.readUInt32LE(12) : 0;
      frames.push({ tag, payload: Buffer.from(this.pending.subarray(headerLength, total)) });
      this.pending = this.pending.subarray(total);
    }
  }

  /** The bytes after the last whole frame: a tunnel's first bytes once usbmuxd hands the socket over. */
  takeRemainder(): Buffer {
    const rest = Buffer.from(this.pending);
    this.pending = Buffer.alloc(0);
    return rest;
  }
}
```

`tests/device/ios/inspector/fields.ts`:

```ts
/**
 * Fields read off a decoded plist message (#811). The phone's messages are
 * undocumented, so every read names the message, the key and what came
 * instead: a renamed key on a new iOS reads as that, never as `undefined`
 * travelling on.
 */
import { isPlistDictionary, type PlistDictionary, type PlistValue } from './bplist';

export class ProtocolShapeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ProtocolShapeError';
  }
}

function describe(value: PlistValue | undefined): string {
  if (value === undefined) return 'nothing';
  if (typeof value === 'string') return `the string ${JSON.stringify(value.slice(0, 80))}`;
  if (typeof value === 'number' || typeof value === 'boolean') return `the ${typeof value} ${value}`;
  if (Buffer.isBuffer(value)) return `${value.length} bytes of data`;
  if (Array.isArray(value)) return `an array of ${value.length}`;
  return `a dictionary of ${Object.keys(value).join(', ') || 'nothing'}`;
}

/** The message's OWN value at `key`: an inherited name such as `toString` is not a field. */
function own(message: PlistDictionary, key: string): PlistValue | undefined {
  return Object.hasOwn(message, key) ? message[key] : undefined;
}

function refuse(what: string, key: string, kind: string, value: PlistValue | undefined): never {
  throw new ProtocolShapeError(`${what}: expected ${key} to be ${kind}, got ${describe(value)}`);
}

export function dictionaryOf(value: PlistValue | undefined, what: string): PlistDictionary {
  if (value === undefined || !isPlistDictionary(value)) {
    throw new ProtocolShapeError(`${what}: expected a dictionary, got ${describe(value)}`);
  }
  return value;
}

export function dictionaryField(message: PlistDictionary, key: string, what: string): PlistDictionary {
  const value = own(message, key);
  if (value === undefined || !isPlistDictionary(value)) refuse(what, key, 'a dictionary', value);
  return value;
}

export function arrayField(message: PlistDictionary, key: string, what: string): readonly PlistValue[] {
  const value = own(message, key);
  if (!Array.isArray(value)) refuse(what, key, 'an array', value);
  return value as readonly PlistValue[];
}

export function stringField(message: PlistDictionary, key: string, what: string): string {
  const value = own(message, key);
  if (typeof value !== 'string') refuse(what, key, 'a string', value);
  return value;
}

export function numberField(message: PlistDictionary, key: string, what: string): number {
  const value = own(message, key);
  if (typeof value !== 'number') refuse(what, key, 'a number', value);
  return value;
}

export function dataField(message: PlistDictionary, key: string, what: string): Buffer {
  const value = own(message, key);
  if (!Buffer.isBuffer(value)) refuse(what, key, 'data', value);
  return value;
}

/** A flag the phone writes as a boolean or as 0/1; `fallback` when absent. */
export function flagOr(message: PlistDictionary, key: string, fallback: boolean, what: string): boolean {
  const value = own(message, key);
  if (value === undefined) return fallback;
  if (typeof value === 'boolean') return value;
  if (value === 0 || value === 1) return value === 1;
  return refuse(what, key, 'a flag', value);
}

export function stringOr(message: PlistDictionary, key: string, fallback: string, what: string): string {
  const value = own(message, key);
  if (value === undefined) return fallback;
  if (typeof value !== 'string') refuse(what, key, 'a string', value);
  return value;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `PATH=/opt/homebrew/opt/node/bin:$PATH npx vitest run tests/unit/ios-inspector-framing.test.ts tests/unit/ios-inspector-fields.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add tests/device/ios/inspector/framing.ts tests/device/ios/inspector/fields.ts tests/unit/ios-inspector-framing.test.ts tests/unit/ios-inspector-fields.test.ts
git commit -m "The iPhone inspector reads frames as they arrive in pieces, and names a field of the wrong kind (Refs #811)"
```

---

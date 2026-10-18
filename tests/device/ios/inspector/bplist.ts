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

export type PlistValue =
  string | number | boolean | Buffer | readonly PlistValue[] | PlistDictionary;

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
  return (
    typeof value === 'object' &&
    !Buffer.isBuffer(value) &&
    !Array.isArray(value)
  );
}

/** Sets `key` as an own property, so a key named `__proto__` stays data. */
export function setEntry(
  target: Record<string, PlistValue>,
  key: string,
  value: PlistValue,
): void {
  Object.defineProperty(target, key, {
    value,
    enumerable: true,
    writable: true,
    configurable: true,
  });
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

function writeUnsigned(
  target: Buffer,
  value: number,
  offset: number,
  size: number,
): void {
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
  if (
    bytes.length < MAGIC.length + TRAILER_LENGTH ||
    !bytes.subarray(0, MAGIC.length).equals(MAGIC)
  ) {
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
  if (
    tableStart < MAGIC.length ||
    tableStart + objectCount * offsetSize > end
  ) {
    throw new PlistFormatError(
      `an offset table of ${objectCount} x ${offsetSize} bytes at ${tableStart} does not fit before the trailer at ${end}`,
    );
  }
  const span = (start: number, length: number): Buffer => {
    if (start + length > tableStart) {
      throw new PlistFormatError(
        `${length} bytes at ${start} run past the object area`,
      );
    }
    return bytes.subarray(start, start + length);
  };
  const offsetOf = (ref: number): number => {
    if (ref >= objectCount)
      throw new PlistFormatError(
        `a reference to object ${ref} of ${objectCount}`,
      );
    const offset = readUnsigned(
      bytes,
      tableStart + ref * offsetSize,
      offsetSize,
    );
    if (offset < MAGIC.length || offset >= tableStart) {
      throw new PlistFormatError(
        `object ${ref} is said to start at ${offset}, outside the object area`,
      );
    }
    return offset;
  };
  const lengthAfter = (
    offset: number,
    low: number,
  ): { length: number; start: number } => {
    if (low !== 0x0f) return { length: low, start: offset + 1 };
    const marker = span(offset + 1, 1).readUInt8(0);
    if (marker >> 4 !== 0x1 || (marker & 0x0f) > 3) {
      throw new PlistFormatError(
        `a length at ${offset + 1} has marker 0x${hex(marker)}, not an integer`,
      );
    }
    const size = 1 << (marker & 0x0f);
    return {
      length: readUnsigned(span(offset + 2, size), 0, size),
      start: offset + 2 + size,
    };
  };
  const refsAt = (start: number, count: number): number[] => {
    const area = span(start, count * refSize);
    return Array.from({ length: count }, (_, index) =>
      readUnsigned(area, index * refSize, refSize),
    );
  };
  const read = (ref: number, depth: number): PlistValue => {
    if (depth > MAX_DEPTH)
      throw new PlistFormatError(`nested deeper than ${MAX_DEPTH}`);
    const offset = offsetOf(ref);
    const marker = bytes.readUInt8(offset);
    const high = marker >> 4;
    const low = marker & 0x0f;
    if (marker === 0x08) return false;
    if (marker === 0x09) return true;
    if (high === 0x1) {
      if (low > 3)
        throw new PlistFormatError(`a ${2 ** low}-byte integer at ${offset}`);
      const size = 1 << low;
      const body = span(offset + 1, size);
      if (size < 8) return readUnsigned(body, 0, size);
      const value = body.readBigInt64BE(0);
      if (
        value > BigInt(Number.MAX_SAFE_INTEGER) ||
        value < BigInt(Number.MIN_SAFE_INTEGER)
      ) {
        throw new PlistFormatError(
          `the integer ${value} at ${offset} is past the safe range`,
        );
      }
      return Number(value);
    }
    if (marker === 0x22) return span(offset + 1, 4).readFloatBE(0);
    if (marker === 0x23) return span(offset + 1, 8).readDoubleBE(0);
    if (
      high === 0x4 ||
      high === 0x5 ||
      high === 0x6 ||
      high === 0xa ||
      high === 0xd
    ) {
      const { length, start } = lengthAfter(offset, low);
      if (high === 0x4) return Buffer.from(span(start, length));
      if (high === 0x5) {
        const body = span(start, length);
        const wide = body.find((byte) => byte > 0x7f);
        if (wide !== undefined)
          throw new PlistFormatError(
            `the ASCII string at ${offset} holds 0x${hex(wide)}`,
          );
        return body.toString('latin1');
      }
      if (high === 0x6) {
        const units = Buffer.from(span(start, length * 2));
        units.swap16();
        return units.toString('utf16le');
      }
      if (high === 0xa)
        return refsAt(start, length).map((child) => read(child, depth + 1));
      const refs = refsAt(start, length * 2);
      const result: Record<string, PlistValue> = {};
      for (let index = 0; index < length; index += 1) {
        const key = read(refs[index], depth + 1);
        if (typeof key !== 'string') {
          throw new PlistFormatError(
            `dictionary key ${index} at ${offset} is not a string`,
          );
        }
        setEntry(result, key, read(refs[length + index], depth + 1));
      }
      return result;
    }
    throw new PlistFormatError(
      `object marker 0x${hex(marker)} at byte ${offset} is not one this client reads`,
    );
  };
  if (topObject >= objectCount) {
    throw new PlistFormatError(
      `the top object ${topObject} is not among ${objectCount}`,
    );
  }
  return read(topObject, 0);
}

function encodeInteger(value: number): Buffer {
  if (!Number.isSafeInteger(value))
    throw new PlistFormatError(`${value} is not a safe integer`);
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
  return Buffer.concat([
    Buffer.from([(high << 4) | 0x0f]),
    encodeInteger(length),
  ]);
}

function isAscii(text: string): boolean {
  for (let index = 0; index < text.length; index += 1) {
    if (text.charCodeAt(index) > 0x7f) return false;
  }
  return true;
}

function encodeObject(
  value: PlistValue,
  refs: readonly number[],
  refSize: number,
): Buffer {
  if (typeof value === 'boolean') return Buffer.from([value ? 0x09 : 0x08]);
  if (typeof value === 'number') {
    if (Number.isInteger(value)) return encodeInteger(value);
    if (!Number.isFinite(value))
      throw new PlistFormatError(`${value} is not a finite real`);
    const bytes = Buffer.alloc(9);
    bytes.writeUInt8(0x23, 0);
    bytes.writeDoubleBE(value, 1);
    return bytes;
  }
  if (typeof value === 'string') {
    if (isAscii(value))
      return Buffer.concat([
        marker(0x5, value.length),
        Buffer.from(value, 'latin1'),
      ]);
    const units = Buffer.from(value, 'utf16le');
    units.swap16();
    return Buffer.concat([marker(0x6, units.length / 2), units]);
  }
  if (Buffer.isBuffer(value))
    return Buffer.concat([marker(0x4, value.length), value]);
  const refBytes = Buffer.alloc(refs.length * refSize);
  refs.forEach((ref, index) =>
    writeUnsigned(refBytes, ref, index * refSize, refSize),
  );
  const isArray = Array.isArray(value);
  return Buffer.concat([
    marker(isArray ? 0xa : 0xd, isArray ? refs.length : refs.length / 2),
    refBytes,
  ]);
}

export function encodeBinaryPlist(value: PlistValue): Buffer {
  const nodes: { readonly value: PlistValue; refs: number[] }[] = [];
  const visit = (node: PlistValue, depth: number): number => {
    if (depth > MAX_DEPTH)
      throw new PlistFormatError(`nested deeper than ${MAX_DEPTH}`);
    const entry = { value: node, refs: [] as number[] };
    const index = nodes.push(entry) - 1;
    if (Array.isArray(node)) {
      entry.refs = (node as readonly PlistValue[]).map((child) =>
        visit(child, depth + 1),
      );
    } else if (isPlistDictionary(node)) {
      const keys = Object.keys(node);
      const keyRefs = keys.map((key) => visit(key, depth + 1));
      entry.refs = [
        ...keyRefs,
        ...keys.map((key) => visit(node[key], depth + 1)),
      ];
    }
    return index;
  };
  visit(value, 0);
  const refSize = sizeFor(nodes.length);
  const bodies = nodes.map((node) =>
    encodeObject(node.value, node.refs, refSize),
  );
  const offsets: number[] = [];
  let at = MAGIC.length;
  for (const body of bodies) {
    offsets.push(at);
    at += body.length;
  }
  const offsetSize = sizeFor(at);
  const table = Buffer.alloc(offsets.length * offsetSize);
  offsets.forEach((offset, index) =>
    writeUnsigned(table, offset, index * offsetSize, offsetSize),
  );
  const trailer = Buffer.alloc(TRAILER_LENGTH);
  trailer.writeUInt8(offsetSize, 6);
  trailer.writeUInt8(refSize, 7);
  trailer.writeBigUInt64BE(BigInt(nodes.length), 8);
  trailer.writeBigUInt64BE(BigInt(0), 16);
  trailer.writeBigUInt64BE(BigInt(at), 24);
  return Buffer.concat([MAGIC, ...bodies, table, trailer]);
}

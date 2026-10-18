/**
 * XML property lists: usbmuxd's messages and the pair record it hands out
 * are XML, and lockdown may answer in either kind (#811). The same subset
 * as bplist.ts; anything else is refused by name.
 *
 * The writer leaves out the DOCTYPE line Apple's tools add: usbmuxd parses
 * with libplist, which does not need it (assumed until the phone probe in
 * the design's section 8 records an exchange), and leaving it out keeps a
 * third-party URL out of the source.
 */
import {
  PlistFormatError,
  decodeBinaryPlist,
  isPlistDictionary,
  setEntry,
  type PlistValue,
} from './bplist';

const HEAD = '<?xml version="1.0" encoding="UTF-8"?>\n<plist version="1.0">\n';
/** A decimal real as plistlib and libplist write it; `Number` alone would also take `0x10`. */
const REAL = /^[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?$/;
const MAGIC = Buffer.from('bplist00', 'latin1');

function escape(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

const MAX_CODE_POINT = 0x10ffff;
const ENTITIES: Readonly<Record<string, string>> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
};

function unescape(text: string): string {
  return text.replace(
    /&(#x[0-9a-fA-F]+|#[0-9]+|[A-Za-z]+);/g,
    (whole: string, name: string) => {
      if (name.startsWith('#')) {
        const code = name.startsWith('#x')
          ? Number.parseInt(name.slice(2), 16)
          : Number.parseInt(name.slice(1), 10);
        if (code > MAX_CODE_POINT)
          throw new PlistFormatError(`${whole} is past the last code point`);
        return String.fromCodePoint(code);
      }
      const known = ENTITIES[name];
      if (known === undefined)
        throw new PlistFormatError(`unknown entity ${whole}`);
      return known;
    },
  );
}

function element(value: PlistValue): string {
  if (typeof value === 'string') return `<string>${escape(value)}</string>`;
  if (typeof value === 'boolean') return value ? '<true/>' : '<false/>';
  if (typeof value === 'number') {
    if (Number.isInteger(value)) {
      if (!Number.isSafeInteger(value))
        throw new PlistFormatError(`${value} is not a safe integer`);
      return `<integer>${value}</integer>`;
    }
    if (!Number.isFinite(value))
      throw new PlistFormatError(`${value} is not a finite real`);
    return `<real>${value}</real>`;
  }
  if (Buffer.isBuffer(value)) return `<data>${value.toString('base64')}</data>`;
  if (Array.isArray(value))
    return `<array>${(value as readonly PlistValue[]).map(element).join('')}</array>`;
  if (!isPlistDictionary(value))
    throw new PlistFormatError('a value of no plist type');
  const entries = Object.keys(value).map(
    (key) => `<key>${escape(key)}</key>${element(value[key])}`,
  );
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
    .replace(/^\uFEFF/, '')
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
      throw new PlistFormatError(
        `expected a tag at character ${at}: ${JSON.stringify(body.slice(at, at + 24))}`,
      );
    }
    at += match[0].length;
    return {
      name: match[2],
      closing: match[1] === '/',
      empty: match[3] === '/',
    };
  };
  const text = (name: string): string => {
    const close = `</${name}>`;
    const end = body.indexOf(close, at);
    if (end < 0)
      throw new PlistFormatError(
        `<${name}> at character ${at} is never closed`,
      );
    const raw = body.slice(at, end);
    at = end + close.length;
    if (raw.includes('<')) throw new PlistFormatError(`<${name}> holds markup`);
    return unescape(raw);
  };
  const closeOf = (open: Tag): void => {
    if (open.empty) return;
    const next = tag();
    if (!next.closing || next.name !== open.name)
      throw new PlistFormatError(`<${open.name}> is not closed`);
  };
  const value = (open: Tag): PlistValue => {
    if (open.closing) throw new PlistFormatError(`unexpected </${open.name}>`);
    switch (open.name) {
      case 'string':
        return open.empty ? '' : text('string');
      case 'integer': {
        const raw = text('integer').trim();
        if (!/^[+-]?\d+$/.test(raw))
          throw new PlistFormatError(
            `${JSON.stringify(raw)} is not an integer`,
          );
        const number = Number(raw);
        if (!Number.isSafeInteger(number))
          throw new PlistFormatError(`${raw} is past the safe range`);
        return number;
      }
      case 'real': {
        const raw = text('real').trim();
        const number = Number(raw);
        if (!REAL.test(raw) || !Number.isFinite(number))
          throw new PlistFormatError(`${JSON.stringify(raw)} is not a real`);
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
        if (!/^[A-Za-z0-9+/]*={0,2}$/.test(raw))
          throw new PlistFormatError(
            `${JSON.stringify(raw.slice(0, 24))} is not base64`,
          );
        return Buffer.from(raw, 'base64');
      }
      case 'array': {
        const items: PlistValue[] = [];
        if (open.empty) return items;
        for (;;) {
          const next = tag();
          if (next.closing) {
            if (next.name !== 'array')
              throw new PlistFormatError(`</${next.name}> closes an <array>`);
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
            if (next.name !== 'dict')
              throw new PlistFormatError(`</${next.name}> closes a <dict>`);
            return result;
          }
          if (next.name !== 'key')
            throw new PlistFormatError(`expected <key>, got <${next.name}>`);
          const key = next.empty ? '' : text('key');
          setEntry(result, key, value(tag()));
        }
      }
      default:
        throw new PlistFormatError(
          `<${open.name}> is not a plist element this client reads`,
        );
    }
  };
  const root = tag();
  if (root.name !== 'plist' || root.closing || root.empty)
    throw new PlistFormatError(`expected <plist>, got <${root.name}>`);
  const result = value(tag());
  const end = tag();
  if (!end.closing || end.name !== 'plist')
    throw new PlistFormatError(`expected </plist>, got <${end.name}>`);
  skipSpace();
  if (at !== body.length)
    throw new PlistFormatError(
      `trailing content after </plist> at character ${at}`,
    );
  return result;
}

/** Lockdown answers in either kind: a binary plist starts with its magic. */
export function decodeAnyPlist(bytes: Buffer): PlistValue {
  if (bytes.subarray(0, MAGIC.length).equals(MAGIC))
    return decodeBinaryPlist(bytes);
  return decodeXmlPlist(bytes.toString('utf8'));
}

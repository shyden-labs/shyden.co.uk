import { describe, expect, it } from 'vitest';
import { encodeBinaryPlist } from '../device/ios/inspector/bplist';
import {
  decodeAnyPlist,
  decodeXmlPlist,
  encodeXmlPlist,
} from '../device/ios/inspector/plist-xml';

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

const plist = (body: string): string =>
  `<?xml version="1.0" encoding="UTF-8"?>\n<plist version="1.0">${body}</plist>`;

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
    expect(
      decodeXmlPlist(
        plist('<array><string/><dict/><array/><data/><false/></array>'),
      ),
    ).toEqual(['', {}, [], Buffer.alloc(0), false]);
  });
  it('a negative integer and a real', () => {
    expect(
      decodeXmlPlist(
        plist('<array><integer>-12</integer><real>2.5</real></array>'),
      ),
    ).toEqual([-12, 2.5]);
  });
  it('a byte-order mark before the declaration', () => {
    expect(decodeXmlPlist(`\uFEFF${plist('<true/>')}`)).toBe(true);
  });
  it('numeric character references', () => {
    expect(decodeXmlPlist(plist('<string>&#65;&#x42;</string>'))).toBe('AB');
  });
  it('a __proto__ key as an own property', () => {
    const value = decodeXmlPlist(
      plist('<dict><key>__proto__</key><integer>7</integer></dict>'),
    ) as Record<string, unknown>;
    expect(Object.getPrototypeOf(value)).toBe(Object.prototype);
    expect(Object.getOwnPropertyDescriptor(value, '__proto__')?.value).toBe(7);
  });
});

describe('writes XML plists it reads back', () => {
  it('every type, with markup characters escaped', () => {
    const value = {
      s: 'a<b>&c',
      n: 62078,
      r: 0.5,
      t: true,
      f: false,
      d: Buffer.from([1, 2, 3]),
      a: ['x', { y: 1 }],
    };
    const text = encodeXmlPlist(value).toString('utf8');
    expect(text).toContain('<string>a&lt;b&gt;&amp;c</string>');
    expect(decodeXmlPlist(text)).toEqual(value);
  });
});

describe('refuses what it does not read, by name', () => {
  it('a date element', () => {
    expect(() =>
      decodeXmlPlist(plist('<date>2026-10-16T00:00:00Z</date>')),
    ).toThrow(/<date> is not a plist element/);
  });
  it('markup inside a string', () => {
    expect(() => decodeXmlPlist(plist('<string>a<b/></string>'))).toThrow(
      /<string> holds markup/,
    );
  });
  it('an unknown entity', () => {
    expect(() => decodeXmlPlist(plist('<string>&nbsp;</string>'))).toThrow(
      /unknown entity &nbsp;/,
    );
  });
  it('an integer that is not one', () => {
    expect(() => decodeXmlPlist(plist('<integer>1e3</integer>'))).toThrow(
      /"1e3" is not an integer/,
    );
  });
  it('a character reference past the last code point', () => {
    expect(() => decodeXmlPlist(plist('<string>&#x110000;</string>'))).toThrow(
      /&#x110000; is past the last code point/,
    );
  });
  it('a real written in hexadecimal', () => {
    expect(() => decodeXmlPlist(plist('<real>0x10</real>'))).toThrow(
      /"0x10" is not a real/,
    );
  });
  it('data that is not base64', () => {
    expect(() => decodeXmlPlist(plist('<data>a*b</data>'))).toThrow(
      /is not base64/,
    );
  });
  it('a dictionary entry without its key', () => {
    expect(() =>
      decodeXmlPlist(plist('<dict><string>x</string></dict>')),
    ).toThrow(/expected <key>, got <string>/);
  });
  it('anything after the closing plist tag', () => {
    expect(() => decodeXmlPlist(`${plist('<true/>')}<true/>`)).toThrow(
      /trailing content/,
    );
  });
  it('a document with no plist element', () => {
    expect(() => decodeXmlPlist('<dict></dict>')).toThrow(/expected <plist>/);
  });
});

describe('reads either kind from bytes', () => {
  it('a binary plist, by its magic', () => {
    expect(decodeAnyPlist(encodeBinaryPlist({ Port: 49152 }))).toEqual({
      Port: 49152,
    });
  });
  it('an XML plist otherwise', () => {
    expect(
      decodeAnyPlist(
        Buffer.from(
          plist('<dict><key>Number</key><integer>0</integer></dict>'),
        ),
      ),
    ).toEqual({ Number: 0 });
  });
});

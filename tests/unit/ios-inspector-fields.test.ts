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
const MESSAGE = {
  s: 'x',
  n: 3,
  d: Buffer.from('b'),
  a: [1],
  m: { k: 'v' },
  t: true,
  one: 1,
  zero: 0,
};

describe('reads each kind of field', () => {
  it('a string', () => expect(stringField(MESSAGE, 's', 'probe')).toBe('x'));
  it('a number', () => expect(numberField(MESSAGE, 'n', 'probe')).toBe(3));
  it('data', () =>
    expect(dataField(MESSAGE, 'd', 'probe')).toEqual(Buffer.from('b')));
  it('an array', () => expect(arrayField(MESSAGE, 'a', 'probe')).toEqual([1]));
  it('a dictionary', () =>
    expect(dictionaryField(MESSAGE, 'm', 'probe')).toEqual({ k: 'v' }));
  it('a boolean flag', () =>
    expect(flagOr(MESSAGE, 't', false, 'probe')).toBe(true));
  it('a flag written as 1', () =>
    expect(flagOr(MESSAGE, 'one', false, 'probe')).toBe(true));
  it('a flag written as 0', () =>
    expect(flagOr(MESSAGE, 'zero', true, 'probe')).toBe(false));
  it('a missing flag, as the fallback', () =>
    expect(flagOr(MESSAGE, 'absent', true, 'probe')).toBe(true));
  it('a missing string, as the fallback', () =>
    expect(stringOr(MESSAGE, 'absent', '', 'probe')).toBe(''));
});

describe('refuses the wrong kind, naming the message, the key and what came', () => {
  it('a number where a string was expected', () => {
    expect(() => stringField(MESSAGE, 'n', 'ListDevices')).toThrow(
      'ListDevices: expected n to be a string, got the number 3',
    );
  });
  it('a missing number', () => {
    expect(() => numberField(MESSAGE, 'absent', 'Connect')).toThrow(
      'Connect: expected absent to be a number, got nothing',
    );
  });
  it('a string where a flag was expected', () => {
    expect(() => flagOr(MESSAGE, 's', false, 'StartService')).toThrow(
      'StartService: expected s to be a flag, got the string "x"',
    );
  });
  it('an array where a dictionary was expected', () => {
    expect(() => dictionaryOf([1], 'a usbmuxd answer')).toThrow(
      'a usbmuxd answer: expected a dictionary, got an array of 1',
    );
  });
  it("an inherited key, which is not the message's own", () => {
    expect(() => stringField(MESSAGE, 'toString', 'probe')).toThrow(
      'probe: expected toString to be a string, got nothing',
    );
  });
});

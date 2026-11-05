/**
 * Fields read off a decoded plist message (#811). The phone's messages are
 * undocumented, so every read names the message, the key and what came
 * instead: a renamed key on a new iOS reads as that, never as `undefined`
 * travelling on.
 */
import {
  isPlistDictionary,
  type PlistDictionary,
  type PlistValue,
} from './bplist';

export class ProtocolShapeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ProtocolShapeError';
  }
}

function summarise(value: PlistValue | undefined): string {
  if (value === undefined) return 'nothing';
  if (typeof value === 'string')
    return `the string ${JSON.stringify(value.slice(0, 80))}`;
  if (typeof value === 'number' || typeof value === 'boolean')
    return `the ${typeof value} ${value}`;
  if (Buffer.isBuffer(value)) return `${value.length} bytes of data`;
  if (Array.isArray(value)) return `an array of ${value.length}`;
  return `a dictionary of ${Object.keys(value).join(', ') || 'nothing'}`;
}

/** The message's OWN value at `key`: an inherited name such as `toString` is not a field. */
function own(message: PlistDictionary, key: string): PlistValue | undefined {
  return Object.hasOwn(message, key) ? message[key] : undefined;
}

function refuse(
  what: string,
  key: string,
  kind: string,
  value: PlistValue | undefined,
): never {
  throw new ProtocolShapeError(
    `${what}: expected ${key} to be ${kind}, got ${summarise(value)}`,
  );
}

export function dictionaryOf(
  value: PlistValue | undefined,
  what: string,
): PlistDictionary {
  if (value === undefined || !isPlistDictionary(value)) {
    throw new ProtocolShapeError(
      `${what}: expected a dictionary, got ${summarise(value)}`,
    );
  }
  return value;
}

export function dictionaryField(
  message: PlistDictionary,
  key: string,
  what: string,
): PlistDictionary {
  const value = own(message, key);
  if (value === undefined || !isPlistDictionary(value))
    refuse(what, key, 'a dictionary', value);
  return value;
}

export function arrayField(
  message: PlistDictionary,
  key: string,
  what: string,
): readonly PlistValue[] {
  const value = own(message, key);
  if (!Array.isArray(value)) refuse(what, key, 'an array', value);
  return value as readonly PlistValue[];
}

export function stringField(
  message: PlistDictionary,
  key: string,
  what: string,
): string {
  const value = own(message, key);
  if (typeof value !== 'string') refuse(what, key, 'a string', value);
  return value;
}

export function numberField(
  message: PlistDictionary,
  key: string,
  what: string,
): number {
  const value = own(message, key);
  if (typeof value !== 'number') refuse(what, key, 'a number', value);
  return value;
}

export function dataField(
  message: PlistDictionary,
  key: string,
  what: string,
): Buffer {
  const value = own(message, key);
  if (!Buffer.isBuffer(value)) refuse(what, key, 'data', value);
  return value;
}

/** A flag the phone writes as a boolean or as 0/1; `fallback` when absent. */
export function flagOr(
  message: PlistDictionary,
  key: string,
  fallback: boolean,
  what: string,
): boolean {
  const value = own(message, key);
  if (value === undefined) return fallback;
  if (typeof value === 'boolean') return value;
  if (value === 0 || value === 1) return value === 1;
  return refuse(what, key, 'a flag', value);
}

export function stringOr(
  message: PlistDictionary,
  key: string,
  fallback: string,
  what: string,
): string {
  const value = own(message, key);
  if (value === undefined) return fallback;
  if (typeof value !== 'string') refuse(what, key, 'a string', value);
  return value;
}

/**
 * Lockdown, the phone's service broker on port 62078 (#811 Task 7).
 *
 * Length-framed plists, measured on the iPhone Air (iOS 27.0.1) on
 * 2026-10-24: QueryType answers `com.apple.mobile.lockdown`; StartSession,
 * sent the pair record's HostID and SystemBUID, answers a session id and
 * `EnableSessionSSL: true`, after which the same socket speaks TLS (pin.ts);
 * StartService answers the port a service listens on and whether it too
 * wants TLS.
 */
import type { PlistDictionary } from './bplist';
import { dictionaryOf, flagOr, numberField, stringField } from './fields';
import type { FrameLink } from './link';
import { decodeAnyPlist, encodeXmlPlist } from './plist-xml';
import { REPLY_CEILING_MS, type PairRecord } from './usbmux';

const LABEL = 'shyden-inspector';
const LOCKDOWN = 'com.apple.mobile.lockdown';

/** What a person can do about a refusal the phone names. */
const REMEDIES: Readonly<Record<string, string>> = {
  PasswordProtected: 'unlock the phone',
  InvalidHostID: 're-pair: trust this Mac again',
};

export class LockdownError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'LockdownError';
  }
}

async function ask(
  link: FrameLink,
  request: PlistDictionary & { Request: string },
): Promise<PlistDictionary> {
  link.send(encodeXmlPlist({ Label: LABEL, ...request }));
  const what = `lockdown answer to ${request.Request}`;
  const frame = await link.next(what, REPLY_CEILING_MS);
  return dictionaryOf(decodeAnyPlist(frame.payload), what);
}

function refusal(answer: PlistDictionary, refused: string): void {
  if (!Object.hasOwn(answer, 'Error')) return;
  const error = stringField(answer, 'Error', `lockdown ${refused}`);
  const remedy = REMEDIES[error];
  throw new LockdownError(
    `the phone refused ${refused}: ${error}${remedy ? ` (${remedy})` : ''}`,
  );
}

export async function queryType(link: FrameLink): Promise<string> {
  const answer = await ask(link, { Request: 'QueryType' });
  const type = stringField(answer, 'Type', 'lockdown QueryType');
  if (type !== LOCKDOWN)
    throw new LockdownError(`port 62078 answered as ${type}, not ${LOCKDOWN}`);
  return type;
}

export async function startSession(
  link: FrameLink,
  pair: PairRecord,
): Promise<{ sessionId: string; ssl: boolean }> {
  const answer = await ask(link, {
    Request: 'StartSession',
    HostID: pair.hostId,
    SystemBUID: pair.systemBuid,
  });
  refusal(answer, 'the session');
  const what = 'lockdown StartSession';
  return {
    sessionId: stringField(answer, 'SessionID', what),
    ssl: flagOr(answer, 'EnableSessionSSL', false, what),
  };
}

export async function startService(
  link: FrameLink,
  service: string,
): Promise<{ port: number; ssl: boolean }> {
  const answer = await ask(link, { Request: 'StartService', Service: service });
  refusal(answer, `the service ${service}`);
  const what = `lockdown StartService ${service}`;
  return {
    port: numberField(answer, 'Port', what),
    ssl: flagOr(answer, 'EnableServiceSSL', false, what),
  };
}

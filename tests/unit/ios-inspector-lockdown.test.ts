import { describe, expect, it } from 'vitest';
import type { PlistDictionary } from '../device/ios/inspector/bplist';
import {
  LockdownError,
  queryType,
  startService,
  startSession,
} from '../device/ios/inspector/lockdown';
import { encodeXmlPlist } from '../device/ios/inspector/plist-xml';
import { recordedFrames } from './ios-inspector-fixtures';
import {
  deliverFrames,
  type FakeTransport,
  linkOver,
  PAIR,
  writtenPlists,
} from './ios-inspector-transport';

/** Lockdown, the phone's service broker on port 62078 (#811 Task 7). */
const [QUERY_ANSWER, SESSION_ANSWER, SERVICE_ANSWER] = recordedFrames(
  'lockdown',
  'in',
);
const setUp = (): ReturnType<typeof linkOver> => linkOver('length');
const lastRequest = (transport: FakeTransport): PlistDictionary | undefined =>
  writtenPlists(transport, 'length').at(-1);
const answer = deliverFrames;

describe('asking what answers on the port', () => {
  it('sends QueryType with this client’s label', async () => {
    const { transport, link } = setUp();
    const type = queryType(link);
    expect(lastRequest(transport)).toEqual({
      Label: 'shyden-inspector',
      Request: 'QueryType',
    });
    answer(transport, QUERY_ANSWER);
    expect(await type).toBe('com.apple.mobile.lockdown');
  });

  it('refuses anything that is not lockdown', async () => {
    const { transport, link } = setUp();
    const type = queryType(link);
    answer(
      transport,
      encodeXmlPlist({ Request: 'QueryType', Type: 'com.example.other' }),
    );
    await expect(type).rejects.toThrow(
      'port 62078 answered as com.example.other, not com.apple.mobile.lockdown',
    );
  });
});

describe('starting a session', () => {
  it('sends exactly the pair record’s HostID and SystemBUID', async () => {
    const { transport, link } = setUp();
    const session = startSession(link, PAIR);
    expect(lastRequest(transport)).toEqual({
      Label: 'shyden-inspector',
      Request: 'StartSession',
      HostID: 'AAAAAAAA-AAAA-AAAA-AAAA-AAAAAAAAAAAA',
      SystemBUID: 'BBBBBBBB-BBBB-BBBB-BBBB-BBBBBBBBBBBB',
    });
    answer(transport, SESSION_ANSWER);
    await session;
  });

  it('reads the recorded answer: a session that wants TLS', async () => {
    const { transport, link } = setUp();
    const session = startSession(link, PAIR);
    answer(transport, SESSION_ANSWER);
    expect(await session).toEqual({
      sessionId: '46E3653A-A9A8-47A2-AF42-52758B9D6402',
      ssl: true,
    });
  });

  it.each([
    [
      'PasswordProtected',
      'the phone refused the session: PasswordProtected (unlock the phone)',
    ],
    [
      'InvalidHostID',
      'the phone refused the session: InvalidHostID (re-pair: trust this Mac again)',
    ],
    ['SomethingNew', 'the phone refused the session: SomethingNew'],
  ])('a refusal %s is named', async (error, message) => {
    const { transport, link } = setUp();
    const session = startSession(link, PAIR);
    answer(
      transport,
      encodeXmlPlist({ Request: 'StartSession', Error: error }),
    );
    await expect(session).rejects.toThrow(new LockdownError(message));
  });
});

describe('starting a service', () => {
  it('asks for the service by name', async () => {
    const { transport, link } = setUp();
    const service = startService(link, 'com.apple.webinspector');
    expect(lastRequest(transport)).toEqual({
      Label: 'shyden-inspector',
      Request: 'StartService',
      Service: 'com.apple.webinspector',
    });
    answer(transport, SERVICE_ANSWER);
    await service;
  });

  it('reads the recorded answer: the port, behind TLS', async () => {
    const { transport, link } = setUp();
    const service = startService(link, 'com.apple.webinspector');
    answer(transport, SERVICE_ANSWER);
    expect(await service).toEqual({ port: 50209, ssl: true });
  });

  it('a service without TLS says so', async () => {
    const { transport, link } = setUp();
    const service = startService(link, 'com.example.plain');
    answer(transport, encodeXmlPlist({ Request: 'StartService', Port: 1234 }));
    expect(await service).toEqual({ port: 1234, ssl: false });
  });

  it('a refused service is named with the reason', async () => {
    const { transport, link } = setUp();
    const service = startService(link, 'com.example.missing');
    answer(
      transport,
      encodeXmlPlist({ Request: 'StartService', Error: 'InvalidService' }),
    );
    await expect(service).rejects.toThrow(
      new LockdownError(
        'the phone refused the service com.example.missing: InvalidService',
      ),
    );
  });
});

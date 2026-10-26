import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  encodeBinaryPlist,
  type PlistDictionary,
} from '../device/ios/inspector/bplist';
import { ProtocolShapeError } from '../device/ios/inspector/fields';
import { CeilingError } from '../device/ios/inspector/link';
import { recordedFrames } from './ios-inspector-fixtures';
import {
  deliverFrames,
  type FakeTransport,
  IDS,
  wirOver,
  writtenPlists,
} from './ios-inspector-transport';

/** The Web Inspector RPC: Safari, its pages, and a page's socket (#811 Task 8). */
const SAFARI = 'PID:86196';
const IN = recordedFrames('wir', 'in');
/** The recorded frames up to and including Safari's _rpc_applicationConnected:. */
const UNTIL_SAFARI = IN.slice(0, 4);
/** The recorded listing of Safari's pages. */
const LISTING = IN.find((frame) =>
  frame.includes('_rpc_applicationSentListing:'),
);
const TARGET_CREATED = IN.find((frame) =>
  frame.includes('Target.targetCreated'),
);
/** Every web page, and only the page the recorded run opened. */
const ANY = (): boolean => true;
const OPENED = (url: string): boolean => url.includes('/classroom-groups');

const setUp = wirOver;
const written = (transport: FakeTransport): PlistDictionary[] =>
  writtenPlists(transport, 'length');
const deliver = (transport: FakeTransport, frames: readonly Buffer[]): void =>
  deliverFrames(transport, ...frames);

const message = (selector: string, argument: PlistDictionary): Buffer =>
  encodeBinaryPlist({ __selector: selector, __argument: argument });

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

describe('identifying this client', () => {
  it('sends _rpc_reportIdentifier: with the connection id', () => {
    const { transport, wir } = setUp();
    wir.identify();
    expect(written(transport)).toEqual([
      {
        __selector: '_rpc_reportIdentifier:',
        __argument: { WIRConnectionIdentifierKey: IDS.connection },
      },
    ]);
  });
});

describe('finding Safari', () => {
  it('from the _rpc_applicationConnected: that followed the recorded list', async () => {
    const { transport, wir } = setUp();
    const safari = wir.safari(15_000);
    deliver(transport, UNTIL_SAFARI);
    expect(await safari).toBe(SAFARI);
  });

  it('from the connected-application list itself', async () => {
    const { transport, wir } = setUp();
    const safari = wir.safari(15_000);
    deliver(transport, [
      message('_rpc_reportConnectedApplicationList:', {
        WIRApplicationDictionaryKey: {
          'PID:7': {
            WIRApplicationIdentifierKey: 'PID:7',
            WIRApplicationBundleIdentifierKey: 'com.apple.mobilesafari',
          },
        },
      }),
    ]);
    expect(await safari).toBe('PID:7');
  });

  it('past its ceiling, names the applications it saw and the switch that hides Safari', async () => {
    const { transport, wir } = setUp();
    const safari = wir.safari(15_000);
    const verdict = expect(safari).rejects.toThrow(
      'Safari did not appear to the Web Inspector within 15 s (it saw com.apple.amsengagementd',
    );
    deliver(transport, UNTIL_SAFARI.slice(0, 3));
    await vi.advanceTimersByTimeAsync(15_000);
    await verdict;
    await expect(safari).rejects.toThrow(
      'is Settings > Apps > Safari > Advanced > Web Inspector on, and Safari open?',
    );
    await expect(safari).rejects.toBeInstanceOf(CeilingError);
  });
});

describe("listing Safari's pages", () => {
  it('asks Safari for its listing', () => {
    const { transport, wir } = setUp();
    void wir.pages(SAFARI, ANY, 15_000).catch(() => undefined);
    expect(written(transport)).toEqual([
      {
        __selector: '_rpc_forwardGetListing:',
        __argument: {
          WIRConnectionIdentifierKey: IDS.connection,
          WIRApplicationIdentifierKey: SAFARI,
        },
      },
    ]);
  });

  it('reads the recorded listing as the one web page', async () => {
    const { transport, wir } = setUp();
    const pages = wir.pages(SAFARI, OPENED, 15_000);
    deliver(transport, [LISTING as Buffer]);
    expect(await pages).toEqual([
      {
        pageId: 1,
        url: 'https://shyden.co.uk/classroom-groups/',
        type: 'WIRTypeWebPage',
      },
    ]);
  });

  it('leaves out what is not a web page, and listings of other applications', async () => {
    const { transport, wir } = setUp();
    const pages = wir.pages(SAFARI, ANY, 15_000);
    deliver(transport, [
      message('_rpc_applicationSentListing:', {
        WIRApplicationIdentifierKey: 'PID:1',
        WIRListingKey: {
          '9': {
            WIRPageIdentifierKey: 9,
            WIRTypeKey: 'WIRTypeWebPage',
            WIRURLKey: 'https://other.example/',
          },
        },
      }),
      message('_rpc_applicationSentListing:', {
        WIRApplicationIdentifierKey: SAFARI,
        WIRListingKey: {
          '2': {
            WIRPageIdentifierKey: 2,
            WIRTypeKey: 'WIRTypeJavaScript',
            WIRURLKey: 'about:blank',
          },
          '3': {
            WIRPageIdentifierKey: 3,
            WIRTypeKey: 'WIRTypeWebPage',
            WIRURLKey: 'https://shyden.co.uk/',
          },
        },
      }),
    ]);
    expect(await pages).toEqual([
      { pageId: 3, url: 'https://shyden.co.uk/', type: 'WIRTypeWebPage' },
    ]);
  });

  it('a listing with no web page waits on, and past the ceiling says what it saw', async () => {
    const { transport, wir } = setUp();
    const pages = wir.pages(SAFARI, ANY, 15_000);
    const verdict = expect(pages).rejects.toThrow(
      'Safari showed no page this run opened within 15 s (its listings held: WIRTypeJavaScript about:blank)',
    );
    deliver(transport, [
      message('_rpc_applicationSentListing:', {
        WIRApplicationIdentifierKey: SAFARI,
        WIRListingKey: {
          '2': {
            WIRPageIdentifierKey: 2,
            WIRTypeKey: 'WIRTypeJavaScript',
            WIRURLKey: 'about:blank',
          },
        },
      }),
    ]);
    await vi.advanceTimersByTimeAsync(15_000);
    await verdict;
  });

  // Measured 2026-10-26 (#811 step 6, row 3): straight after a relaunch the
  // first listing held only about:blank, and the page loaded a moment later.
  const blank = message('_rpc_applicationSentListing:', {
    WIRApplicationIdentifierKey: SAFARI,
    WIRListingKey: {
      '1': {
        WIRPageIdentifierKey: 1,
        WIRTypeKey: 'WIRTypeWebPage',
        WIRURLKey: 'about:blank',
      },
    },
  });

  it('a listing without the page this run opened waits for the next listing', async () => {
    const { transport, wir } = setUp();
    let settled = false;
    const pages = wir.pages(SAFARI, OPENED, 15_000).finally(() => {
      settled = true;
    });
    deliver(transport, [blank]);
    await vi.advanceTimersByTimeAsync(14_999);
    expect(settled).toBe(false);
    deliver(transport, [LISTING as Buffer]);
    expect(await pages).toEqual([
      {
        pageId: 1,
        url: 'https://shyden.co.uk/classroom-groups/',
        type: 'WIRTypeWebPage',
      },
    ]);
  });

  it('past the ceiling, names the pages the listings held that this run did not open', async () => {
    const { transport, wir } = setUp();
    const pages = wir.pages(SAFARI, OPENED, 15_000);
    const verdict = expect(pages).rejects.toThrow(
      'Safari showed no page this run opened within 15 s (its listings held: WIRTypeWebPage about:blank)',
    );
    deliver(transport, [blank]);
    await vi.advanceTimersByTimeAsync(15_000);
    await verdict;
    await expect(pages).rejects.toBeInstanceOf(CeilingError);
  });
});

describe("a page's socket", () => {
  it('attaching sends _rpc_forwardSocketSetup: for the page, unpaused', () => {
    const { transport, wir } = setUp();
    wir.attach(SAFARI, 1);
    expect(written(transport)).toEqual([
      {
        __selector: '_rpc_forwardSocketSetup:',
        __argument: {
          WIRConnectionIdentifierKey: IDS.connection,
          WIRApplicationIdentifierKey: SAFARI,
          WIRPageIdentifierKey: 1,
          WIRSenderKey: IDS.sender,
          WIRAutomaticallyPause: false,
        },
      },
    ]);
  });

  it('protocol text goes to the page as data', () => {
    const { transport, wir } = setUp();
    wir.attach(SAFARI, 1);
    wir.sendData('{"id":1}');
    expect(written(transport)[1]).toEqual({
      __selector: '_rpc_forwardSocketData:',
      __argument: {
        WIRConnectionIdentifierKey: IDS.connection,
        WIRApplicationIdentifierKey: SAFARI,
        WIRPageIdentifierKey: 1,
        WIRSenderKey: IDS.sender,
        WIRSocketDataKey: Buffer.from('{"id":1}'),
      },
    });
  });

  it("the page's text reaches every listener before the wait looks", async () => {
    const { transport, wir } = setUp();
    const seen: string[] = [];
    wir.onData((text) => seen.push(text));
    const waited = wir.until('the target', 10_000, () =>
      seen.length > 0 ? seen[0] : undefined,
    );
    deliver(transport, [TARGET_CREATED as Buffer]);
    expect(await waited).toBe(
      '{"method":"Target.targetCreated","params":{"targetInfo":{"targetId":"page-39","type":"page"}}}',
    );
  });

  it('a selector this client does not know is passed over, not thrown', async () => {
    const { transport, wir } = setUp();
    const waited = wir.until('anything', 10_000, (incoming) =>
      incoming.__selector === '_rpc_somethingNew:' ? 'seen' : undefined,
    );
    deliver(transport, [message('_rpc_somethingNew:', {})]);
    expect(await waited).toBe('seen');
  });

  it('page data that is not data is refused by name', async () => {
    const { transport, wir } = setUp();
    wir.onData(() => undefined);
    const waited = wir.until('the target', 10_000, () => undefined);
    deliver(transport, [
      message('_rpc_applicationSentData:', {
        WIRMessageDataKey: 'text, not data',
      }),
    ]);
    await expect(waited).rejects.toBeInstanceOf(ProtocolShapeError);
  });

  it('detaching sends _rpc_forwardDidClose:', () => {
    const { transport, wir } = setUp();
    wir.attach(SAFARI, 1);
    wir.detach();
    expect(written(transport)[1]).toEqual({
      __selector: '_rpc_forwardDidClose:',
      __argument: {
        WIRConnectionIdentifierKey: IDS.connection,
        WIRApplicationIdentifierKey: SAFARI,
        WIRPageIdentifierKey: 1,
        WIRSenderKey: IDS.sender,
      },
    });
  });
});

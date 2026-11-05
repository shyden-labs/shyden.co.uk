/**
 * The Web Inspector RPC (#811 Task 8): `com.apple.webinspector`'s own
 * messages, each a binary plist `{ __selector, __argument }` behind a 4-byte
 * length.
 *
 * Measured on the iPhone Air (iOS 27.0.1), 2026-10-24: after
 * `_rpc_reportIdentifier:` the phone sends its state, the applications it
 * knows and its drivers; Safari can arrive later on its own
 * `_rpc_applicationConnected:`. `_rpc_forwardGetListing:` answers with
 * `_rpc_applicationSentListing:`; `_rpc_forwardSocketSetup:` opens the page's
 * socket, and the page's protocol text then travels as data in
 * `_rpc_forwardSocketData:` (out) and `_rpc_applicationSentData:` (in).
 *
 * The session reads in pull mode: `until` reads frames, hands every page
 * message to the data listeners first, then asks its own question of the
 * frame. Frames nobody is reading wait in the link.
 */
import { encodeBinaryPlist, type PlistDictionary } from './bplist';
import {
  dataField,
  dictionaryField,
  dictionaryOf,
  numberField,
  stringField,
  stringOr,
} from './fields';
import { CeilingError, type FrameLink, LinkError } from './link';
import { decodeAnyPlist } from './plist-xml';

export const SAFARI_BUNDLE = 'com.apple.mobilesafari';
export const LISTING_CEILING_MS = 15_000;
const WEB_PAGE = 'WIRTypeWebPage';

export interface WirPage {
  readonly pageId: number;
  readonly url: string;
  readonly type: string;
}

export class WirSession {
  private readonly listeners: ((text: string) => void)[] = [];
  private page: { app: string; pageId: number } | undefined;

  constructor(
    private readonly link: FrameLink,
    private readonly ids: { connection: string; sender: string },
  ) {}

  identify(): void {
    this.send('_rpc_reportIdentifier:', {});
  }

  async safari(ceilingMs: number): Promise<string> {
    const seen: string[] = [];
    return this.until(
      'Safari in the application list',
      ceilingMs,
      (message) => {
        for (const app of applications(message)) {
          const bundle = stringOr(
            app,
            'WIRApplicationBundleIdentifierKey',
            '',
            'an application',
          );
          if (bundle === SAFARI_BUNDLE)
            return stringField(app, 'WIRApplicationIdentifierKey', 'Safari');
          if (bundle) seen.push(bundle);
        }
        return undefined;
      },
      () =>
        `Safari did not appear to the Web Inspector within ${ceilingMs / 1000} s (it saw ${seen.join(', ') || 'no application'}): is Settings > Apps > Safari > Advanced > Web Inspector on, and Safari open?`,
    );
  }

  /**
   * The web pages Safari lists whose URL `accept` takes. A listing without
   * one is passed over and the next awaited, until the ceiling: straight after
   * a relaunch Safari listed only about:blank, and the page loaded a moment
   * later (measured 2026-10-26, #811 step 6).
   */
  async pages(
    appId: string,
    accept: (url: string) => boolean,
    ceilingMs: number,
  ): Promise<WirPage[]> {
    this.send('_rpc_forwardGetListing:', {
      WIRApplicationIdentifierKey: appId,
    });
    const seen: string[] = [];
    return this.until(
      'a page this run opened in the listing',
      ceilingMs,
      (message) => {
        if (message.__selector !== '_rpc_applicationSentListing:')
          return undefined;
        const what = 'Safari listing';
        const argument = dictionaryField(message, '__argument', what);
        if (
          stringField(argument, 'WIRApplicationIdentifierKey', what) !== appId
        )
          return undefined;
        const listing = dictionaryField(argument, 'WIRListingKey', what);
        const pages = Object.values(listing).map((entry) => {
          const page = dictionaryOf(entry, what);
          return {
            pageId: numberField(page, 'WIRPageIdentifierKey', what),
            url: stringOr(page, 'WIRURLKey', '', what),
            type: stringField(page, 'WIRTypeKey', what),
          };
        });
        seen.push(...pages.map((page) => `${page.type} ${page.url}`));
        const opened = pages.filter(
          (page) => page.type === WEB_PAGE && accept(page.url),
        );
        return opened.length > 0 ? opened : undefined;
      },
      () =>
        `Safari showed no page this run opened within ${ceilingMs / 1000} s (its listings held: ${seen.join(', ') || 'nothing'})`,
    );
  }

  attach(appId: string, pageId: number): void {
    this.page = { app: appId, pageId };
    this.send('_rpc_forwardSocketSetup:', {
      ...this.pageKeys(),
      WIRAutomaticallyPause: false,
    });
  }

  sendData(text: string): void {
    this.send('_rpc_forwardSocketData:', {
      ...this.pageKeys(),
      WIRSocketDataKey: Buffer.from(text),
    });
  }

  onData(listener: (text: string) => void): void {
    this.listeners.push(listener);
  }

  detach(): void {
    this.send('_rpc_forwardDidClose:', this.pageKeys());
    this.page = undefined;
  }

  /**
   * Reads frames until `pick` returns a value, handing every page message to
   * the data listeners before `pick` sees it. Past the ceiling it fails with
   * `onTimeout`'s words, or names `what`.
   */
  async until<T>(
    what: string,
    ceilingMs: number,
    pick: (message: PlistDictionary) => T | undefined,
    onTimeout?: () => string,
  ): Promise<T> {
    const deadline = Date.now() + ceilingMs;
    for (;;) {
      const remaining = deadline - Date.now();
      let frame;
      try {
        if (remaining <= 0) throw new CeilingError(`no ${what}`);
        frame = await this.link.next(what, remaining);
      } catch (error) {
        if (error instanceof CeilingError && Date.now() >= deadline)
          throw new CeilingError(
            onTimeout?.() ?? `no ${what} within ${ceilingMs / 1000} s`,
            { cause: error },
          );
        throw error;
      }
      const message = dictionaryOf(
        decodeAnyPlist(frame.payload),
        'a Web Inspector message',
      );
      if (message.__selector === '_rpc_applicationSentData:') {
        const argument = dictionaryField(message, '__argument', 'page data');
        const text = dataField(
          argument,
          'WIRMessageDataKey',
          'page data',
        ).toString('utf8');
        for (const listener of this.listeners) listener(text);
      }
      const picked = pick(message);
      if (picked !== undefined) return picked;
    }
  }

  private pageKeys(): PlistDictionary {
    if (!this.page) throw new LinkError('no page is attached');
    return {
      WIRApplicationIdentifierKey: this.page.app,
      WIRPageIdentifierKey: this.page.pageId,
      WIRSenderKey: this.ids.sender,
    };
  }

  private send(selector: string, argument: PlistDictionary): void {
    this.link.send(
      encodeBinaryPlist({
        __selector: selector,
        __argument: {
          WIRConnectionIdentifierKey: this.ids.connection,
          ...argument,
        },
      }),
    );
  }
}

/** The applications a message names: a whole list, or the one just connected. */
function applications(message: PlistDictionary): PlistDictionary[] {
  const what = 'an application message';
  if (message.__selector === '_rpc_reportConnectedApplicationList:') {
    const argument = dictionaryField(message, '__argument', what);
    return Object.values(
      dictionaryField(argument, 'WIRApplicationDictionaryKey', what),
    ).map((app) => dictionaryOf(app, what));
  }
  if (message.__selector === '_rpc_applicationConnected:')
    return [dictionaryField(message, '__argument', what)];
  return [];
}

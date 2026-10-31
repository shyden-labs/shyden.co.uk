/**
 * The iPhone run's page driver (#859): Safari's page, driven through our own
 * Web Inspector client (`./inspector/`) rather than `safaridriver`, which held
 * the phone in Guided Access and so could not share it with WebDriverAgent's
 * taps (Shyden's ruling on #838, 2026-10-18).
 *
 * `PageDriver` and `PageElement` keep the method names and argument shapes the
 * journeys already call, so the journey file barely changes. Each method is a
 * few `Runtime`/`Page` commands, chosen from what the iPhone Air (iOS 27.0.1)
 * answered on 2026-10-31 (design: docs/superpowers/specs/2026-10-31-ios-page-driving-design.md):
 * `Runtime.evaluate`'s `awaitPromise` is ignored there, so a promise is awaited
 * with `Runtime.awaitPromise`; `Page.navigate` is absent, so navigation is
 * `location.assign` and a wait for `Page.loadEventFired`.
 *
 * Nothing here retries (global rule): a failure names what failed.
 */
import { messageOf } from '../../../scripts/errors.mjs';
import type { PageProtocol } from './inspector/protocol';

/** The two calls the driver makes on the page's protocol. */
export type PagePort = Pick<PageProtocol, 'command' | 'on'>;

/** What `Runtime.evaluate`, `callFunctionOn` and `awaitPromise` answer. */
interface RemoteResult {
  readonly result: {
    readonly type?: string;
    readonly value?: unknown;
    readonly objectId?: string;
    readonly className?: string;
    readonly description?: string;
  };
  readonly wasThrown?: boolean;
}

/** An exception the page threw while running a script: which script, which error. */
export class PageScriptError extends Error {
  constructor(
    message: string,
    readonly scriptLine: string,
    readonly errorClass: string,
  ) {
    super(message);
    this.name = 'PageScriptError';
  }
}

/** The first line of a script that says anything, to name it in an error. */
const firstLine = (script: string): string =>
  script
    .split('\n')
    .map((line) => line.trim())
    .find((line) => line !== '') ?? '(empty script)';

/** The answer's value, or the page's exception as a PageScriptError. */
function valueOf(answer: RemoteResult, script: string): unknown {
  if (answer.wasThrown) {
    const line = firstLine(script);
    const errorClass = answer.result.className ?? 'Error';
    throw new PageScriptError(
      `page script failed (${line}): ${answer.result.description ?? errorClass}`,
      line,
      errorClass,
    );
  }
  return answer.result.value;
}

/** The handle an answer carries, refused when it carries none. */
function handleOf(answer: RemoteResult, what: string): string {
  const { objectId } = answer.result;
  if (typeof objectId !== 'string')
    throw new Error(
      `expected ${what} to come back as a handle, got ${JSON.stringify(answer.result)}`,
    );
  return objectId;
}

/** A script argument as `Runtime.callFunctionOn` takes it. */
const callArgument = (arg: unknown): { value: unknown } => ({ value: arg });

/** Runs `body` as an async function: its last argument is the callback that settles it. */
const asyncDeclaration = (body: string): string =>
  [
    'function () {',
    '  var args = Array.prototype.slice.call(arguments);',
    '  var self = this;',
    '  return new Promise(function (resolve) {',
    '    args.push(resolve);',
    `    (function () {${body}\n    }).apply(self, args);`,
    '  });',
    '}',
  ].join('\n');

export class PageDriver {
  constructor(private readonly page: PagePort) {}

  /**
   * Runs `script` as a function body on the page, as WebDriver's `execute/sync`
   * does, and returns its value. Each call takes a fresh handle to `window`
   * (2 ms measured), so no handle a reload invalidated is ever reused.
   */
  async executeScript<T = unknown>(
    script: string,
    args: unknown[] = [],
  ): Promise<T> {
    const answer = await this.callOnWindow(
      `function () {${script}\n}`,
      args,
      true,
    );
    return valueOf(answer, script) as T;
  }

  /**
   * Runs `script` as WebDriver's `execute/async` does: its last argument is a
   * callback, and the call returns what the script hands it.
   */
  async executeAsyncScript<T = unknown>(
    script: string,
    args: unknown[] = [],
  ): Promise<T> {
    const started = await this.callOnWindow(
      asyncDeclaration(script),
      args,
      false,
    );
    valueOf(started, script);
    const settled = await this.page.command<RemoteResult>(
      'Runtime.awaitPromise',
      {
        promiseObjectId: handleOf(started, 'an async script'),
        returnByValue: true,
      },
    );
    return valueOf(settled, script) as T;
  }

  private async callOnWindow(
    functionDeclaration: string,
    args: unknown[],
    returnByValue: boolean,
  ): Promise<RemoteResult> {
    const window = await this.page.command<RemoteResult>('Runtime.evaluate', {
      expression: 'window',
    });
    return this.page.command<RemoteResult>('Runtime.callFunctionOn', {
      objectId: handleOf(window, 'window'),
      functionDeclaration,
      arguments: args.map(callArgument),
      ...(returnByValue ? { returnByValue } : {}),
    });
  }
}

// ── Waiting on a condition (moved unchanged from webdriver.ts) ──────────────

export interface WaitForOptions {
  readonly timeout?: number;
  readonly interval?: number;
  readonly describe: string;
  /**
   * Whether an error the predicate threw is worth another poll. Omitted,
   * every thrown error is. An error this rejects ends the wait at once and
   * is rethrown as-is: the caller already knows no later poll can succeed.
   */
  readonly retryable?: (error: unknown) => boolean;
}

const DEFAULT_WAIT_TIMEOUT_MS = 10_000;
const DEFAULT_WAIT_INTERVAL_MS = 200;

const UNSETTLED = Symbol('unsettled');

/**
 * `promise`'s value, or `UNSETTLED` if `deadline` passes first. A request
 * nobody answers never settles, and awaiting it outright would carry the
 * wait past any deadline.
 */
async function settledBy<T>(
  promise: Promise<T>,
  deadline: number,
): Promise<T | typeof UNSETTLED> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const expiry = new Promise<typeof UNSETTLED>((resolve) => {
    // A poll can start after the deadline, since the pause between polls is
    // not cut short at it. Node would clamp the negative delay to 1 ms anyway,
    // and warn on every run (#327); clamping here keeps the same timing.
    timer = setTimeout(
      () => resolve(UNSETTLED),
      Math.max(0, deadline - Date.now()),
    );
  });
  try {
    return await Promise.race([promise, expiry]);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Polls `predicate` until it returns a truthy value, or throws naming what
 * was awaited and the last observed value (or thrown error).
 *
 * This is NOT the bare `sleep(500)` this project's standards forbid: the
 * pass/fail verdict is decided entirely by the observed condition, never by
 * how much time has elapsed -- `timeout` is a safety net against a hung
 * device or session, not the thing that decides success. A poll still
 * pending at the deadline is abandoned, so a request that is never answered
 * cannot hold the wait past it (#309). The delay between
 * polls below is the cadence of a condition-based wait (the same shape
 * `expect.poll` uses internally), not a substitute for checking one.
 *
 * A thrown predicate (e.g. a transient fetch failure) is caught and
 * recorded rather than aborting the wait -- callers do not need their own
 * try/catch just to poll for an element that has not appeared yet. A caller
 * that knows a failure is terminal says so with `retryable`, and that
 * failure ends the wait at once instead of being retried until the timeout:
 * a `safaridriver` that has already exited will never answer (#309).
 */
export async function waitFor<T>(
  predicate: () => Promise<T | undefined | null | false | 0 | ''>,
  options: WaitForOptions,
): Promise<T> {
  const timeout = options.timeout ?? DEFAULT_WAIT_TIMEOUT_MS;
  const interval = options.interval ?? DEFAULT_WAIT_INTERVAL_MS;
  const retryable = options.retryable ?? (() => true);
  const deadline = Date.now() + timeout;

  for (;;) {
    let observed: string;
    try {
      const result = await settledBy(predicate(), deadline);
      if (result === UNSETTLED) {
        observed = 'a poll that had not settled when the time ran out';
      } else if (result) {
        return result;
      } else {
        observed = `resolved to ${JSON.stringify(result)}`;
      }
    } catch (error) {
      if (!retryable(error)) throw error;
      observed = `threw ${messageOf(error)}`;
    }

    if (Date.now() >= deadline) {
      throw new Error(
        `Timed out after ${timeout}ms waiting for: ${options.describe}. Last observed: ${observed}`,
      );
    }

    await new Promise((resolve) => setTimeout(resolve, interval));
  }
}

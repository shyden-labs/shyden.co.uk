import { expect, type Page } from '@playwright/test';
import { searched } from '../source-files';

/**
 * Browser-event recorders — the only place in the suite that subscribes to a
 * collected event. `tests/unit/event-collectors.test.ts` fails if a spec
 * hand-rolls one.
 *
 * WHY A HOME AT ALL. A collected event reaches Node asynchronously over the
 * browser protocol, so reading the array the instant an action returns races
 * delivery. CI proved it (run 34391533802, 2026-09-09): six `fetch` calls had
 * already been issued and `expect(audioRequests).toHaveLength(6)` saw `[]`.
 *
 * As a flake that costs a re-run. The same expression asserting ABSENCE costs
 * the guard entirely — `expect(scripts).toEqual([])` is satisfied by "the
 * events have not arrived yet", so `the homepage still ships no JavaScript`
 * (now `the homepage ships the theme script and nothing else`, #142)
 * would have passed on a homepage full of JavaScript, silently, forever.
 *
 * So absence is never asserted here without a control proving the recorder
 * was live. A convention at the call site cannot do that job: forgetting it
 * is invisible, which is how nine of these came to be written the same way.
 */

export interface RecordedRequest {
  readonly url: string;
  readonly resourceType: string;
}

export type RequestPredicate = (request: RecordedRequest) => boolean;

/** `url` matches `pattern` — the common case, spelled once. */
export const urlMatching =
  (pattern: RegExp): RequestPredicate =>
  (request) =>
    pattern.test(request.url);

/**
 * The requests every engine makes of a page, whatever it renders: documents,
 * stylesheets, scripts and `fetch` calls. Images and fonts are left out
 * because their count differs by engine (a favicon on Firefox, font subsets
 * on the others), and a floor recorded for one engine would break on the next.
 * Measured on all five engines (#610): the same count on each, per caller.
 *
 * This is the population a request absence is drawn from. A recorder that
 * heard nothing returns an empty list, which `searched` refuses, and one that
 * lost part of the load returns fewer, which the caller's floor refuses.
 */
export const requestsEveryEngineMakes = (
  requests: readonly RecordedRequest[],
): RecordedRequest[] =>
  requests.filter(({ resourceType }) =>
    ['document', 'stylesheet', 'script', 'fetch'].includes(resourceType),
  );

export interface RequestRecorder {
  /** Every request seen, in arrival order. */
  readonly all: readonly RecordedRequest[];
  /** The URLs of the requests `predicate` accepts. Pure: never asserts. */
  matching(predicate: RequestPredicate): string[];
}

export function recordRequests(page: Page): RequestRecorder {
  const all: RecordedRequest[] = [];
  page.on('request', (request) =>
    all.push({ url: request.url(), resourceType: request.resourceType() }),
  );
  return {
    all,
    matching: (predicate) => all.filter(predicate).map(({ url }) => url),
  };
}

export interface ErrorRecorder {
  /** Messages the page logged through `console.error`. */
  readonly consoleErrors: readonly string[];
  /** Exceptions that reached the top level and were never caught. */
  readonly uncaught: readonly string[];
  /** Neither channel reported anything. */
  expectNone(because: string): Promise<void>;
  /**
   * No UNCAUGHT exception — console output is allowed.
   *
   * Kept separate because the two are not interchangeable: the fallback test
   * aborts every `.m4a` request on purpose, and a blocked request logs to the
   * console by design. Asserting both there would fail the test for doing
   * exactly what it set out to do, while asserting only console output on the
   * pages that care about crashes would miss the crash.
   */
  expectNoUncaught(because: string): Promise<void>;
}

/**
 * Collects both error channels, separately.
 *
 * LIVENESS. A total-count control cannot work here: silence is the healthy
 * state, so "zero events" is what a passing test looks like AND what a dead
 * listener looks like. The control is a sentinel this helper emits itself and
 * waits for. Page events share one protocol channel and arrive in order, so
 * the sentinel's arrival also proves everything raised BEFORE it has already
 * been delivered — the barrier all nine of the old sites lacked.
 *
 * KNOWN LIMIT, stated so nobody trusts it further than it goes: the sentinel
 * travels the CONSOLE channel. It vouches for `pageerror` only through that
 * shared ordering, not by exercising it.
 */
export function recordErrors(page: Page): ErrorRecorder {
  // One sentinel PER VERDICT, not per recorder (#390 F129). With one, a flag
  // set by the first verdict's sentinel stayed set, and every later verdict
  // returned at once, before anything raised since had been delivered.
  const SENTINEL = `__liveness_${Math.random().toString(36).slice(2)}n`;
  let verdicts = 0;
  // Any sentinel, not just this recorder's own. `classroom-groups-controls`
  // once built one recorder per sampled path against the same page, so
  // recorder A could still be listening when recorder B emits — and A, not
  // recognising B's sentinel, would have filed it as a genuine error.
  const ANY_SENTINEL = /__liveness_[a-z0-9]+__/;
  const consoleErrors: string[] = [];
  const uncaught: string[] = [];
  /**
   * EVERY console message, sentinels included -- the population the verdicts
   * below are drawn from (#118).
   *
   * `flush` already waits for the sentinel, so this is not a second control
   * for the same fact: it is that fact, carried into the assertion's own
   * expression instead of standing next to it. A reader of the verdict can
   * see what was searched without tracing back to the poll.
   */
  const delivered: string[] = [];
  const sentinelsSeen = new Set<string>();
  page.on('console', (message) => {
    const text = message.text();
    delivered.push(text);
    if (text.startsWith(SENTINEL)) sentinelsSeen.add(text);
    else if (message.type() === 'error' && !ANY_SENTINEL.test(text))
      consoleErrors.push(text);
  });
  page.on('pageerror', (error) => uncaught.push(String(error)));

  const flush = async (because: string): Promise<readonly string[]> => {
    // Emitted through `console.error`, not `console.log`, so the sentinel
    // travels the same filter as a real error. A control that took an easier
    // path than the thing it vouches for proves nothing about it.
    const sentinel = `${SENTINEL}${++verdicts}__`;
    await page.evaluate((s) => console.error(s), sentinel);
    await expect
      .poll(() => sentinelsSeen.has(sentinel), {
        message: `${because}: the console channel never delivered this helper's own sentinel, so an empty error list would mean nothing (#79)`,
      })
      .toBe(true);
    return delivered;
  };

  return {
    consoleErrors,
    uncaught,
    async expectNone(because) {
      const seen = await flush(because);
      expect(
        searched([...consoleErrors, ...uncaught], {
          of: seen,
          what: 'console messages delivered',
        }),
        because,
      ).toEqual([]);
    },
    async expectNoUncaught(because) {
      // The KNOWN LIMIT above applies to the population as much as to the
      // sentinel: `pageerror` is vouched for only by sharing this channel's
      // ordering, never by being exercised itself.
      const seen = await flush(because);
      expect(
        searched(uncaught, {
          of: seen,
          what: 'console messages delivered (pageerror rides their ordering)',
        }),
        because,
      ).toEqual([]);
    },
  };
}

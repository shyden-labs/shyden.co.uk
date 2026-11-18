import { describe, it, expect, vi } from 'vitest';
import { waitFor } from '../device/ios/page-driver';

/**
 * `waitFor` treats a thrown predicate as "not yet" and polls again (#309).
 *
 * That is right for a transient failure, such as a `fetch` refused because a
 * server is still starting, and wrong for a terminal one: a server
 * that had already exited will never answer, yet its exit was re-thrown and
 * swallowed on every poll until the 15 s timeout, and only then reported.
 *
 * A caller now says which thrown errors are worth another poll. Anything else
 * ends the wait at once, rejecting with the very error the predicate threw.
 */
describe('waitFor', () => {
  it('ends the wait at once on an error the caller says is not worth retrying', async () => {
    const exited = new Error(
      'the server exited before answering GET /status (code=1, signal=null)',
    );
    let polls = 0;
    const started = performance.now();

    const outcome = await waitFor(
      async () => {
        polls += 1;
        throw exited;
      },
      {
        timeout: 15_000,
        describe: 'a server that has already exited',
        retryable: (error) => error !== exited,
      },
    ).catch((error: unknown) => error);

    const elapsed = Math.round(performance.now() - started);
    expect(
      { polls, withinOneSecond: elapsed < 1_000 },
      `the wait took ${elapsed} ms over ${polls} polls`,
    ).toEqual({ polls: 1, withinOneSecond: true });
    expect(outcome).toBe(exited);
  });

  it('polls again on an error the caller says is worth retrying, until the condition holds', async () => {
    const exited = new Error('the server exited');
    let polls = 0;

    const value = await waitFor(
      async () => {
        polls += 1;
        if (polls < 3) throw new TypeError('fetch failed');
        return 'ready';
      },
      {
        timeout: 5_000,
        interval: 10,
        describe: 'a server that is still starting',
        retryable: (error) => error !== exited,
      },
    );

    expect({ value, polls }).toEqual({ value: 'ready', polls: 3 });
  });

  it('polls again on every thrown error when the caller names no rule, as it always has', async () => {
    let polls = 0;

    const value = await waitFor(
      async () => {
        polls += 1;
        if (polls < 3) throw new Error('no such element');
        return 'found';
      },
      { timeout: 5_000, interval: 10, describe: 'an element to appear' },
    );

    expect({ value, polls }).toEqual({ value: 'found', polls: 3 });
  });

  // On the test clock (#1205): paid in real time, each of these waited its
  // whole 300 ms timeout, and under heavy load that is a third of the 1 s
  // limit before anything is checked.
  it('gives up at its timeout even while a poll has not settled', async () => {
    vi.useFakeTimers();
    try {
      let outcome: unknown = 'still waiting';
      const waiting = waitFor(() => new Promise<never>(() => undefined), {
        timeout: 300,
        describe: 'a session that has stopped answering',
      }).catch((error: unknown) => {
        outcome = error;
      });
      await vi.advanceTimersByTimeAsync(299);
      expect(outcome, 'gave up before its timeout').toBe('still waiting');
      await vi.advanceTimersByTimeAsync(1);
      await waiting;
      expect(outcome).toBeInstanceOf(Error);
      expect((outcome as Error).message).toContain(
        'Timed out after 300ms waiting for: a session that has stopped answering.',
      );
    } finally {
      vi.useRealTimers();
    }
  });

  it('reports a retryable error that never clears at the timeout, naming it', async () => {
    vi.useFakeTimers();
    try {
      const verdict = expect(
        waitFor(
          async () => {
            throw new TypeError('fetch failed');
          },
          {
            timeout: 300,
            interval: 50,
            describe: 'a server that never starts',
            retryable: () => true,
          },
        ),
      ).rejects.toThrow(
        'Timed out after 300ms waiting for: a server that never starts. Last observed: threw fetch failed',
      );
      await vi.advanceTimersByTimeAsync(300);
      await verdict;
    } finally {
      vi.useRealTimers();
    }
  });
});

/**
 * The pause between polls is not cut short at the deadline, so a poll can
 * start after it. That poll's timer was armed with a negative delay, which
 * Node clamps to 1 ms and warns about on every unit run (#327).
 */
describe('waitFor, polled past its deadline', () => {
  it('arms no negative timer, so Node has nothing to warn about', async () => {
    const heard: string[] = [];
    const listen = (warning: Error): void => {
      heard.push(warning.name);
    };
    // Node prints each warning through its own listener. This test takes the
    // event over while it runs, so its sentinel below is heard and not printed.
    const printers = process.listeners('warning');
    process.removeAllListeners('warning');
    process.on('warning', listen);
    try {
      // The second poll starts about 25 ms after a 5 ms deadline. Real time,
      // not the test clock: the warning is Node's own, and a fake timer never
      // raises it (#1205 kept this wait as short as it can be).
      await expect(
        waitFor(async () => false, {
          timeout: 5,
          interval: 30,
          describe: 'a condition that never holds',
        }),
      ).rejects.toThrow(
        'Timed out after 5ms waiting for: a condition that never holds.',
      );
      // A warning raised here must be heard, or an empty list could come
      // from a listener that hears nothing at all.
      process.emitWarning('the listener is live', 'WaitForSentinelWarning');
      await new Promise((resolve) => setImmediate(resolve));
    } finally {
      process.off('warning', listen);
      for (const printer of printers) process.on('warning', printer);
    }
    expect(heard, 'the listener heard its own sentinel').toContain(
      'WaitForSentinelWarning',
    );
    expect(heard).not.toContain('TimeoutNegativeWarning');
  });
});

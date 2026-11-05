import { describe, expect, it } from 'vitest';
import {
  BASE_URL,
  DATABASE_ID,
  QUERY_CEILING_MS,
  WAIT_REPORTED_MS,
  query,
} from '../functions/local.mjs';

/**
 * The functions tests reach D1 through the running dev server's own D1
 * object, which takes the server's statements and theirs one at a time
 * (#737). Real Response objects; the network, the clock and the ceiling are
 * stood in, so nothing here opens a socket or waits for real.
 */
const ROWS = {
  success: true,
  errors: [],
  messages: [],
  result: [
    {
      results: {
        columns: ['note', 'locale'],
        rows: [
          ['first', 'vi'],
          ['second', 'th'],
        ],
      },
    },
  ],
};

/** A dev server that answers every statement with `body` and `status`, keeping what it was sent. */
const answering = (body: unknown, status = 200) => {
  const sent: Array<{ url: string; body: unknown }> = [];
  const fetch = async (url: string | URL | Request, init?: RequestInit) => {
    sent.push({ url: String(url), body: JSON.parse(String(init?.body)) });
    return new Response(JSON.stringify(body), { status });
  };
  return { fetch: fetch as typeof globalThis.fetch, sent };
};

/** A clock that reads each of `readings` in turn. */
const clock = (...readings: number[]) => {
  let next = 0;
  return () => readings[next++] ?? Number.NaN;
};

describe('query: the functions tests reach D1 through the dev server (#737)', () => {
  it('posts the statement and its parameters to the server’s own D1 object', async () => {
    const server = answering(ROWS);
    await query('SELECT note FROM reports WHERE note = ?', ['n'], {
      fetch: server.fetch,
      now: clock(0, 1),
      log: () => {},
    });
    expect(server.sent).toEqual([
      {
        url: `${BASE_URL}/cdn-cgi/local/explorer/api/d1/database/00000000-0000-4000-8000-000000000097/raw`,
        body: { sql: 'SELECT note FROM reports WHERE note = ?', params: ['n'] },
      },
    ]);
    expect(DATABASE_ID).toBe('00000000-0000-4000-8000-000000000097');
  });

  it('returns each row as an object keyed by its columns', async () => {
    const rows = await query('SELECT note, locale FROM reports', [], {
      fetch: answering(ROWS).fetch,
      now: clock(0, 1),
      log: () => {},
    });
    expect(rows).toEqual([
      { note: 'first', locale: 'vi' },
      { note: 'second', locale: 'th' },
    ]);
  });

  it('says how long a call waited once it passes the threshold', async () => {
    const lines: string[] = [];
    await query('SELECT note FROM reports', [], {
      fetch: answering(ROWS).fetch,
      now: clock(1_000, 1_251),
      log: (line) => lines.push(line),
    });
    expect(lines).toEqual([
      `d1: waited 251 ms for the dev server's D1 at ${BASE_URL}, queued behind its own statements: SELECT note FROM reports`,
    ]);
  });

  it('says nothing for a call answered at the threshold itself, only past it', async () => {
    const lines: string[] = [];
    const log = (line: string) => lines.push(line);
    const server = answering(ROWS);
    await query('SELECT 1', [], {
      fetch: server.fetch,
      now: clock(0, 250),
      log,
    });
    await query('SELECT 2', [], {
      fetch: server.fetch,
      now: clock(0, 251),
      log,
    });
    // Both calls ran; only the one past the threshold speaks.
    expect(server.sent).toHaveLength(2);
    expect(lines).toEqual([
      `d1: waited 251 ms for the dev server's D1 at ${BASE_URL}, queued behind its own statements: SELECT 2`,
    ]);
  });

  it('fails at its ceiling naming the dev server it was queued on', async () => {
    const silent = ((_: unknown, init?: RequestInit) =>
      new Promise((_resolve, reject) =>
        init?.signal?.addEventListener('abort', () =>
          reject(init.signal?.reason),
        ),
      )) as typeof globalThis.fetch;
    await expect(
      query('SELECT note FROM reports', [], {
        fetch: silent,
        now: clock(0, 5),
        log: () => {},
        ceilingMs: 5,
      }),
    ).rejects.toThrow(
      `queued 5 ms on the dev server's D1 at ${BASE_URL} without an answer: SELECT note FROM reports`,
    );
  });

  it('fails with the endpoint’s own words when it refuses the statement', async () => {
    const refusing = answering(
      {
        success: false,
        errors: [{ code: 7500, message: 'near "SELEC": syntax error' }],
        messages: [],
        result: null,
      },
      400,
    );
    await expect(
      query('SELEC note FROM reports', [], {
        fetch: refusing.fetch,
        now: clock(0, 1),
        log: () => {},
      }),
    ).rejects.toThrow('near "SELEC": syntax error');
  });

  it('waits 10 s at most, under the test’s own 30 s, and says so past 250 ms (the measured maximum was 648 ms)', () => {
    expect(QUERY_CEILING_MS).toBe(10_000);
    expect(WAIT_REPORTED_MS).toBe(250);
  });
});

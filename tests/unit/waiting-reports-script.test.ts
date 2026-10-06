import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { spawn } from 'node:child_process';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { join } from 'node:path';
import { FAILURE_NOTICE } from '../../src/lib/waiting-reports';
import { searched } from '../source-files';
import { floorBreach } from '../floors';

/**
 * `scripts/waiting-reports.mjs` as a real process (#349, spec 15.5), against
 * two local stand-ins answering in Cloudflare's and GitHub's shapes. Each
 * stand-in records what it received, so "no request reached GitHub" is read
 * off GitHub's own record, after a sentinel proves that record is live (#118).
 *
 * Spawned with async `spawn`, never `spawnSync`: the stand-ins answer from
 * this process's event loop, which `spawnSync` would block.
 */

const SCRIPT = join(process.cwd(), 'scripts/waiting-reports.mjs');
const ACCOUNT = '0123456789abcdef0123456789abcdef';
const PROD_ID = '0b9e6c1a-2f4d-4e8a-9c3b-5d7e1f2a3b4c';
const DEV_ID = '7f3a2b1c-9d8e-4f6a-8b5c-1e2d3c4b5a69';
const ISSUE = '4242';
const SENTINEL = '/sentinel';

type Received = { method: string; url: string; body: string; auth: string };

/** A local HTTP server that records each request and answers via `respond`. */
const standIn = (side: string) => {
  const received: Received[] = [];
  let respond: (
    request: Received,
  ) => { status: number; body: unknown } | null = () => ({
    status: 404,
    body: {},
  });
  let server: Server;
  let url = '';
  return {
    received,
    get url() {
      return url;
    },
    answer(next: typeof respond) {
      respond = next;
    },
    async start() {
      server = createServer((request, response) => {
        let body = '';
        request.on('data', (chunk) => (body += chunk));
        request.on('end', () => {
          const got = {
            method: request.method ?? '',
            url: request.url ?? '',
            body,
            auth: request.headers.authorization ?? '',
          };
          received.push(got);
          if (got.url === SENTINEL) {
            response.writeHead(200).end('{}');
            return;
          }
          const reply = respond(got);
          if (reply === null) return; // never answer: the script must time out
          response.writeHead(reply.status, {
            'content-type': 'application/json',
          });
          // A string body goes out as it is, so a test can send what is not JSON.
          response.end(
            typeof reply.body === 'string'
              ? reply.body
              : JSON.stringify(reply.body),
          );
        });
      });
      await new Promise<void>((resolve) =>
        server.listen(0, '127.0.0.1', resolve),
      );
      url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    },
    stop: () =>
      new Promise<void>((resolve) => {
        server.closeAllConnections();
        server.close(() => resolve());
      }),
    /** What reached this stand-in, closed by a sentinel it must also hold. */
    async record() {
      await fetch(`${url}${SENTINEL}`);
      expect(received.at(-1)?.url, 'the stand-in is recording').toBe(SENTINEL);
      return received.slice(0, -1);
    },
    /**
     * That nothing reached this stand-in: the requests before the sentinel,
     * searched with the sentinel in the population, so an empty record is
     * proved to be a live one (#118).
     */
    async expectNothingReceived() {
      await fetch(`${url}${SENTINEL}`);
      const all = [...received];
      expect(all.at(-1)?.url, 'the stand-in is recording').toBe(SENTINEL);
      const before = all.slice(0, -1);
      expect(
        searched(before, {
          of: all,
          what: `requests the ${side} stand-in recorded, the sentinel included`,
        }),
      ).toEqual([]);
      expect(
        floorBreach('waiting-reports-script/stand-in-requests', all.length),
      ).toBeUndefined();
    },
  };
};

const cloudflare = standIn('Cloudflare');
const github = standIn('GitHub');

/** Cloudflare's answers, per scenario. */
let databases: unknown[];
let queryAnswer: { status: number; body: unknown };
/** GitHub's list of the issue's comments, per scenario. */
let comments: unknown[];

const envelope = (result: unknown) => ({
  success: true,
  errors: [],
  messages: [],
  result,
});
const waiting = (count: number) => ({
  status: 200,
  body: envelope([
    { success: true, meta: {}, results: [{ 'count(*)': count }] },
  ]),
});

beforeAll(async () => {
  await cloudflare.start();
  await github.start();
});
afterAll(async () => {
  await cloudflare.stop();
  await github.stop();
});
beforeEach(() => {
  cloudflare.received.length = 0;
  github.received.length = 0;
  databases = [
    { uuid: DEV_ID, name: 'shyden-reports-dev' },
    { uuid: PROD_ID, name: 'shyden-reports' },
  ];
  queryAnswer = waiting(3);
  comments = [];
  cloudflare.answer(({ method, url }) => {
    if (
      method === 'GET' &&
      url === `/accounts/${ACCOUNT}/d1/database?name=shyden-reports`
    )
      return { status: 200, body: envelope(databases) };
    if (
      method === 'POST' &&
      url === `/accounts/${ACCOUNT}/d1/database/${PROD_ID}/query`
    )
      return queryAnswer;
    return { status: 404, body: { success: false, errors: [] } };
  });
  github.answer(({ method, url }) => {
    const path = `/repos/shyden-labs/shyden.co.uk/issues/${ISSUE}/comments`;
    if (method === 'GET' && url.startsWith(`${path}?`))
      return { status: 200, body: comments };
    if (method === 'POST' && url === path) return { status: 201, body: {} };
    return { status: 404, body: {} };
  });
});

/** Run the script with only the variables the workflow gives it. */
const run = (
  args: string[] = [],
  overrides: Record<string, string> = {},
): Promise<{ code: number | null; out: string }> =>
  new Promise((resolve) => {
    const child = spawn(process.execPath, [SCRIPT, ...args], {
      env: {
        PATH: process.env.PATH,
        CLOUDFLARE_API_BASE: cloudflare.url,
        CLOUDFLARE_ACCOUNT_ID: ACCOUNT,
        CLOUDFLARE_D1_READ_TOKEN: 'cf-read-token',
        GITHUB_API_URL: github.url,
        GITHUB_SERVER_URL: 'https://github.com',
        GITHUB_REPOSITORY: 'shyden-labs/shyden.co.uk',
        GITHUB_RUN_ID: '36000000001',
        GITHUB_TOKEN: 'gh-token',
        NOTICE_ISSUE: ISSUE,
        ...overrides,
      },
    });
    let out = '';
    child.stdout.on('data', (chunk) => (out += chunk));
    child.stderr.on('data', (chunk) => (out += chunk));
    child.on('close', (code) => resolve({ code, out }));
  });

const posts = (requests: Received[]) =>
  requests.filter(({ method }) => method === 'POST');

describe('the count mode', () => {
  it('3 waiting posts one comment, and nothing else', async () => {
    const { code, out } = await run();
    expect(code, out).toBe(0);
    expect(out).toContain('Waiting reports: 3');
    const sent = await github.record();
    expect(posts(sent).map(({ body }) => JSON.parse(body))).toEqual([
      { body: '3 translation reports are waiting.' },
    ]);
    expect(sent.every(({ auth }) => auth === 'Bearer gh-token')).toBe(true);
  });

  it('asks Cloudflare with the read token, for the production id only', async () => {
    await run();
    const asked = await cloudflare.record();
    expect(asked.map(({ method, url }) => `${method} ${url}`)).toEqual([
      `GET /accounts/${ACCOUNT}/d1/database?name=shyden-reports`,
      `POST /accounts/${ACCOUNT}/d1/database/${PROD_ID}/query`,
    ]);
    expect(JSON.parse(asked[1].body)).toEqual({
      sql: 'SELECT count(*) FROM reports',
    });
    expect(asked.every(({ auth }) => auth === 'Bearer cf-read-token')).toBe(
      true,
    );
  });

  it("lists only today's comments, so an old issue's first page cannot hide today's", async () => {
    const before = new Date().toISOString().slice(0, 10);
    await run();
    const after = new Date().toISOString().slice(0, 10);
    const [list] = await github.record();
    const since = new URL(list.url, github.url).searchParams.get('since');
    // Either side of midnight UTC, if the run straddled it.
    expect([`${before}T00:00:00Z`, `${after}T00:00:00Z`]).toContain(since);
  });

  it('0 waiting exits 0 and sends GitHub nothing at all', async () => {
    queryAnswer = waiting(0);
    const { code, out } = await run();
    expect(code, out).toBe(0);
    expect(out).toContain('Waiting reports: 0');
    await github.expectNothingReceived();
  });

  it('a bot count from today means nothing is posted', async () => {
    comments = [
      {
        user: { login: 'github-actions[bot]' },
        body: '2 translation reports are waiting.',
        created_at: new Date().toISOString(),
      },
    ];
    const { code, out } = await run();
    expect(code, out).toBe(0);
    const sent = await github.record();
    expect(sent.map(({ method }) => method)).toEqual(['GET']);
  });

  it("today's failure notice does not stop a re-run's count", async () => {
    comments = [
      {
        user: { login: 'github-actions[bot]' },
        body: `${FAILURE_NOTICE}\n\nhttps://github.com/x/y/actions/runs/1`,
        created_at: new Date().toISOString(),
      },
    ];
    const { code, out } = await run();
    expect(code, out).toBe(0);
    expect(posts(await github.record())).toHaveLength(1);
  });
});

describe('a count that cannot be read is a failure, never a zero', () => {
  /** A failed run: non-zero, no count claimed, and GitHub never reached. */
  const expectFailedQuietly = async ({
    code,
    out,
  }: {
    code: number | null;
    out: string;
  }) => {
    expect(code, out).toBe(1);
    expect(out).toMatch(/^✗ /m);
    expect(out).not.toMatch(/0 translation report|Waiting reports/);
    await github.expectNothingReceived();
  };

  it('a D1 port with nothing listening', async () => {
    const closed = createServer();
    await new Promise<void>((resolve) =>
      closed.listen(0, '127.0.0.1', resolve),
    );
    const port = (closed.address() as AddressInfo).port;
    await new Promise<void>((resolve) => closed.close(() => resolve()));
    await expectFailedQuietly(
      await run([], { CLOUDFLARE_API_BASE: `http://127.0.0.1:${port}` }),
    );
  });

  it('success: false', async () => {
    queryAnswer = {
      status: 200,
      body: { success: false, errors: [{ code: 7500, message: 'x' }] },
    };
    await expectFailedQuietly(await run());
  });

  it('an HTTP 403 whose body is not JSON, named as such', async () => {
    cloudflare.answer(() => ({ status: 403, body: '<html>' }));
    const result = await run();
    await expectFailedQuietly(result);
    expect(result.out).toContain('Cloudflare answered HTTP 403, not JSON');
  });

  it('a list holding only shyden-reports-dev, which sends no query', async () => {
    databases = [{ uuid: DEV_ID, name: 'shyden-reports-dev' }];
    await expectFailedQuietly(await run());
    const asked = await cloudflare.record();
    expect(asked.map(({ method }) => method)).toEqual(['GET']);
  });

  it('a Cloudflare that never answers times out, rather than outliving the job', async () => {
    cloudflare.answer(() => null);
    const started = Date.now();
    await expectFailedQuietly(
      await run([], { WAITING_REPORTS_TIMEOUT_MS: '300' }),
    );
    expect(Date.now() - started).toBeLessThan(10_000);
  });

  it('a missing secret stops before any request', async () => {
    await expectFailedQuietly(await run([], { CLOUDFLARE_D1_READ_TOKEN: '' }));
    await cloudflare.expectNothingReceived();
  });

  it('an account id one digit short stops before any request', async () => {
    // It goes into a URL path, so its shape is exact: 32 hex digits.
    const result = await run([], { CLOUDFLARE_ACCOUNT_ID: ACCOUNT.slice(1) });
    await expectFailedQuietly(result);
    expect(result.out).toContain('CLOUDFLARE_ACCOUNT_ID is not set');
    await cloudflare.expectNothingReceived();
  });

  it('an API base that is not http(s) stops before any request', async () => {
    const result = await run([], { CLOUDFLARE_API_BASE: 'file:///etc' });
    await expectFailedQuietly(result);
    expect(result.out).toContain(
      'CLOUDFLARE_API_BASE is not set, or not an http(s) URL',
    );
  });
});

describe('what the script is given', () => {
  it('an API base with a trailing slash asks the same paths', async () => {
    const { code, out } = await run([], {
      CLOUDFLARE_API_BASE: `${cloudflare.url}/`,
    });
    expect(code, out).toBe(0);
    const asked = await cloudflare.record();
    expect(asked.map(({ url }) => url)).toEqual([
      `/accounts/${ACCOUNT}/d1/database?name=shyden-reports`,
      `/accounts/${ACCOUNT}/d1/database/${PROD_ID}/query`,
    ]);
  });

  it('a comment GitHub refuses is a failure, never "Posted."', async () => {
    // GitHub refuses in JSON, so only the status says the comment was not
    // made: a refusal read as an answer would report a notice no one sees.
    github.answer(({ method }) =>
      method === 'POST'
        ? {
            status: 403,
            body: { message: 'Resource not accessible by integration' },
          }
        : { status: 200, body: [] },
    );
    const { code, out } = await run();
    expect(code, out).toBe(1);
    expect(out).toContain('GitHub answered HTTP 403');
    expect(out).not.toContain('Posted.');
  });
});

describe('the report-failure mode', () => {
  it("posts the fixed sentence with the run's URL, and asks Cloudflare nothing", async () => {
    const { code, out } = await run(['report-failure'], {
      CLOUDFLARE_ACCOUNT_ID: '',
      CLOUDFLARE_D1_READ_TOKEN: '',
    });
    expect(code, out).toBe(0);
    expect(
      posts(await github.record()).map(({ body }) => JSON.parse(body)),
    ).toEqual([
      {
        body:
          'The waiting-reports count could not be read.\n\n' +
          'https://github.com/shyden-labs/shyden.co.uk/actions/runs/36000000001',
      },
    ]);
    await cloudflare.expectNothingReceived();
  });

  it.each([[['report-failures']], [['report-failure', 'extra']]])(
    'refuses %j with exit 2, sending nothing',
    async (args) => {
      const { code } = await run(args);
      expect(code).toBe(2);
      await github.expectNothingReceived();
      await cloudflare.expectNothingReceived();
    },
  );
});

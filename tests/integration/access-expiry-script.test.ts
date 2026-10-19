import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { join } from 'node:path';
import { FAILURE_TITLE } from '../../src/lib/access-expiry';
import { searched } from '../source-files';
import { floorBreach } from '../floors';
import { dailyJobRunner, standIn, type Received } from '../json-stand-in';
import { PROD_SANITY, tokenList } from '../access-expiry-shared';

/**
 * `scripts/access-expiry.mjs` as a real process (#796), against two local
 * stand-ins answering in Cloudflare's and GitHub's shapes. Each scenario
 * dates its tokens from now, so "10 days out" stays 10 days out whenever the
 * suite runs. Scenario 1 is the planted near-expiry the issue asks for.
 */

const SCRIPT = join(process.cwd(), 'scripts/access-expiry.mjs');
const ACCOUNT = '0123456789abcdef0123456789abcdef';
const REPO = 'shyden-labs/shyden.co.uk';
const ISSUES = `/repos/${REPO}/issues`;
const DAY_MS = 86_400_000;
const RUN_URL = `https://github.com/${REPO}/actions/runs/36000000001`;

const cloudflare = standIn();
const github = standIn();

/** An ISO `expires_at` this many days from now, to the second. */
const daysOut = (days: number) =>
  new Date(Date.now() + days * DAY_MS).toISOString().replace(/\.\d+Z$/, 'Z');
const dayOf = (iso: string) => iso.slice(0, 10);
const titleOf = (name: string, iso: string) =>
  `The Access service token ${name} expires on ${dayOf(iso)}`;
const botIssue = (fields: Record<string, unknown>) => ({
  number: 12,
  state: 'closed',
  user: { login: 'github-actions[bot]' },
  ...fields,
});
const filler = (count: number) =>
  Array.from({ length: count }, (_, index) =>
    botIssue({ number: 1000 + index, title: `Another issue ${index}` }),
  );

/** Cloudflare's answer, GitHub's issue pages, and what a POST answers. */
let tokensAnswer: { status: number; body: unknown } | null;
let issuePages: unknown[][];
let assignees: { login: string }[];

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
  tokensAnswer = { status: 200, body: tokenList([PROD_SANITY]) };
  issuePages = [[]];
  assignees = [{ login: 'ShydenMcM' }];
  cloudflare.answer(({ method, url }) =>
    method === 'GET' &&
    url === `/accounts/${ACCOUNT}/access/service_tokens?per_page=1000`
      ? tokensAnswer
      : { status: 404, body: { success: false, errors: [] } },
  );
  github.answer(({ method, url }) => {
    const page =
      /^\/repos\/[^?]+\/issues\?state=all&per_page=100&page=(\d+)$/.exec(url);
    if (method === 'GET' && page !== null)
      return { status: 200, body: issuePages[Number(page[1]) - 1] ?? [] };
    if (method === 'POST' && url === ISSUES)
      return { status: 201, body: { number: 99, assignees } };
    if (
      method === 'POST' &&
      /^\/repos\/[^/]+\/[^/]+\/issues\/\d+\/comments$/.test(url)
    )
      return { status: 201, body: { id: 1 } };
    return { status: 404, body: {} };
  });
});

/** Run the script with only the variables the workflow gives it. */
const run = dailyJobRunner({
  script: SCRIPT,
  account: ACCOUNT,
  repository: REPO,
  token: ['CLOUDFLARE_ACCESS_READ_TOKEN', 'cf-access-read-token'],
  urls: () => ({ cloudflare: cloudflare.url, github: github.url }),
});

const posts = (requests: Received[]) =>
  requests
    .filter(({ method }) => method === 'POST')
    .map(({ url, body }) => ({ url, body: JSON.parse(body) as unknown }));

/** That GitHub received nothing, with the sentinel in the population (#118). */
const expectGitHubUntouched = async () => {
  const all = await github.everything();
  expect(
    searched(all.slice(0, -1), {
      of: all,
      what: 'requests the GitHub stand-in recorded, the sentinel included',
    }),
  ).toEqual([]);
  expect(
    floorBreach('access-expiry-script/github-untouched', all.length),
  ).toBeUndefined();
};

describe('the check mode', () => {
  it('a token 10 days out opens one issue, assigned to ShydenMcM (the planted near-expiry)', async () => {
    const expires = daysOut(10);
    tokensAnswer = {
      status: 200,
      body: tokenList([{ name: 'prod-sanity-2', expires_at: expires }]),
    };
    const { code, out } = await run();
    expect(code, out).toBe(0);
    expect(posts(await github.record())).toEqual([
      {
        url: ISSUES,
        body: {
          title: titleOf('prod-sanity-2', expires),
          body: expect.stringMatching(
            /^The Cloudflare Access service token `prod-sanity-2` expires at .+ UTC, (9|10) days after this check\.\n\n/,
          ),
          assignees: ['ShydenMcM'],
        },
      },
    ]);
    expect(out).toContain(`Opened: ${titleOf('prod-sanity-2', expires)}`);
  });

  it('a warning already opened, though closed, is not opened again', async () => {
    const expires = daysOut(10);
    tokensAnswer = {
      status: 200,
      body: tokenList([{ name: 'prod-sanity-2', expires_at: expires }]),
    };
    issuePages = [[botIssue({ title: titleOf('prod-sanity-2', expires) })]];
    const { code, out } = await run();
    expect(code, out).toBe(0);
    const sent = await github.record();
    expect(sent.map(({ method }) => method)).toEqual(['GET']);
  });

  it('a warning on the second page of issues is found, so none is opened', async () => {
    const expires = daysOut(10);
    tokensAnswer = {
      status: 200,
      body: tokenList([{ name: 'prod-sanity-2', expires_at: expires }]),
    };
    issuePages = [
      filler(100),
      [botIssue({ title: titleOf('prod-sanity-2', expires) })],
    ];
    const { code, out } = await run();
    expect(code, out).toBe(0);
    const sent = await github.record();
    expect(
      sent.map(({ method, url }) => `${method} ${url.replace(/^.*\?/, '')}`),
    ).toEqual([
      'GET state=all&per_page=100&page=1',
      'GET state=all&per_page=100&page=2',
    ]);
  });

  it('a token 200 days out sends GitHub nothing', async () => {
    tokensAnswer = {
      status: 200,
      body: tokenList([{ name: 'prod-sanity-2', expires_at: daysOut(200) }]),
    };
    const { code, out } = await run();
    expect(code, out).toBe(0);
    expect(out).toContain('1 watched; none expires within 45 days.');
    await expectGitHubUntouched();
  });

  it('of two tokens, only the one due is warned about', async () => {
    const due = daysOut(20);
    tokensAnswer = {
      status: 200,
      body: tokenList([
        { name: 'later', expires_at: daysOut(300) },
        { name: 'soon', expires_at: due },
      ]),
    };
    const { code, out } = await run();
    expect(code, out).toBe(0);
    expect(
      posts(await github.record()).map(
        ({ body }) => (body as { title: string }).title,
      ),
    ).toEqual([titleOf('soon', due)]);
  });

  it('asks Cloudflare for every token on one page, with the read token', async () => {
    tokensAnswer = {
      status: 200,
      body: tokenList([{ name: 'prod-sanity-2', expires_at: daysOut(200) }]),
    };
    expect((await run()).code).toBe(0);
    expect(
      (await cloudflare.record()).map(({ method, url, auth }) => ({
        method,
        url,
        auth,
      })),
    ).toEqual([
      {
        method: 'GET',
        url: `/accounts/${ACCOUNT}/access/service_tokens?per_page=1000`,
        auth: 'Bearer cf-access-read-token',
      },
    ]);
  });
});

describe('the check fails loudly, and GitHub hears nothing from it', () => {
  it.each([
    [
      'an empty token list',
      tokenList([]),
      'is empty, so no token can be watched',
    ],
    [
      'a token with no expiry',
      tokenList([{ name: 'prod-sanity-2' }]),
      'the Access service token prod-sanity-2 has no readable expires_at (undefined)',
    ],
  ])('fails on %s', async (_, body, message) => {
    tokensAnswer = { status: 200, body };
    const { code, out } = await run();
    expect(code, out).toBe(1);
    expect(out).toContain(message);
    await expectGitHubUntouched();
  });

  it('fails on a refused Cloudflare request, naming its errors', async () => {
    tokensAnswer = {
      status: 403,
      body: {
        success: false,
        errors: [{ code: 10000, message: 'Authentication error' }],
      },
    };
    const { code, out } = await run();
    expect(code, out).toBe(1);
    expect(out).toContain(
      'Cloudflare answered HTTP 403 (10000 Authentication error)',
    );
    await expectGitHubUntouched();
  });

  it('fails when Cloudflare never answers', async () => {
    tokensAnswer = null;
    const { code, out } = await run([], { ACCESS_EXPIRY_TIMEOUT_MS: '200' });
    expect(code, out).toBe(1);
    expect(out).toMatch(/timeout|aborted/i);
  });

  it('fails when GitHub opens the issue without ShydenMcM assigned', async () => {
    tokensAnswer = {
      status: 200,
      body: tokenList([{ name: 'prod-sanity-2', expires_at: daysOut(10) }]),
    };
    assignees = [];
    const { code, out } = await run();
    expect(code, out).toBe(1);
    expect(out).toContain('was opened without ShydenMcM assigned');
  });

  it('refuses a wrong argument with its usage line', async () => {
    const { code, out } = await run(['report']);
    expect(code, out).toBe(2);
    expect(out).toContain(
      'usage: node scripts/access-expiry.mjs [report-failure]',
    );
  });
});

describe('the report-failure mode', () => {
  it('opens the failure issue, assigned, with the run, and never asks Cloudflare', async () => {
    const { code, out } = await run(['report-failure']);
    expect(code, out).toBe(0);
    expect(posts(await github.record())).toEqual([
      {
        url: ISSUES,
        body: { title: FAILURE_TITLE, body: RUN_URL, assignees: ['ShydenMcM'] },
      },
    ]);
    const asked = await cloudflare.everything();
    expect(
      searched(asked.slice(0, -1), {
        of: asked,
        what: 'requests the Cloudflare stand-in recorded, the sentinel included',
      }),
    ).toEqual([]);
    expect(
      floorBreach('access-expiry-script/cloudflare-untouched', asked.length),
    ).toBeUndefined();
  });

  it('comments the run on the failure issue already open, opening none', async () => {
    issuePages = [
      [botIssue({ number: 7, state: 'open', title: FAILURE_TITLE })],
    ];
    const { code, out } = await run(['report-failure']);
    expect(code, out).toBe(0);
    expect(posts(await github.record())).toEqual([
      { url: `${ISSUES}/7/comments`, body: { body: RUN_URL } },
    ]);
  });
});

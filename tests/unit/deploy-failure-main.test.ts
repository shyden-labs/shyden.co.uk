import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { main } from '../../scripts/deploy-failure.mjs';

/**
 * `deploy-failure.mjs`'s entry point in-process (#725, #1258), with GitHub's
 * API stood in by a fetch that answers by method and URL and records every
 * request. The process itself, with a real server, is
 * `tests/integration/deploy-failure-script.test.ts`'s; the notice's wording is
 * `deploy-failure.test.ts`'s.
 */
const API = 'https://api.github.test';
const REPO = `${API}/repos/shyden-labs/shyden.co.uk`;
const RUN = '38219259063';
const SHA = 'cedea2695eebcb93da9ec1c7277ff71b4363cb8f';
const JOBS = `GET ${REPO}/actions/runs/${RUN}/jobs?filter=latest&per_page=100`;
const LOG = `GET ${REPO}/actions/jobs/2/logs`;
const ISSUES = `GET ${REPO}/issues?state=open&creator=github-actions%5Bbot%5D&per_page=100`;
const NEW_ISSUE = `POST ${REPO}/issues`;
const TITLE = 'The dev deploy failed: dev is behind develop';

const FAILED_NEEDS = JSON.stringify({
  gate: { result: 'success', outputs: {} },
  'deploy-dev': { result: 'failure', outputs: {} },
  'verify-dev': { result: 'skipped', outputs: {} },
});

type Reply = { status: number; body: unknown };

/** The answers of a deploy that failed in its Cloudflare step. */
const failedDeploy = (): Record<string, Reply> => ({
  [JOBS]: {
    status: 200,
    body: {
      total_count: 2,
      jobs: [
        { id: 1, name: 'Gate', conclusion: 'success', steps: [] },
        {
          id: 2,
          name: 'Deploy to Dev',
          conclusion: 'failure',
          steps: [
            {
              name: 'Deploy dist/ to Cloudflare Pages (dev project)',
              conclusion: 'failure',
            },
          ],
        },
      ],
    },
  },
  [LOG]: {
    status: 200,
    body: '2026-10-12T07:43:10.1000000Z ✘ [ERROR] Received a malformed response from the API',
  },
  [ISSUES]: { status: 200, body: [] },
  [NEW_ISSUE]: {
    status: 201,
    body: { number: 731, assignees: [{ login: 'ShydenMcM' }] },
  },
  [`POST ${REPO}/issues/726/comments`]: { status: 201, body: {} },
});

describe('deploy-failure.mjs main() (#725, #1258)', () => {
  let routes: Record<string, Reply>;
  let asked: { at: string; body: unknown; auth: string }[];
  let lines: string[];

  beforeEach(() => {
    routes = failedDeploy();
    asked = [];
    lines = [];
    for (const stream of ['log', 'error'] as const)
      vi.spyOn(console, stream).mockImplementation((line) => {
        lines.push(String(line));
      });
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init: RequestInit = {}) => {
        const at = `${init.method ?? 'GET'} ${url}`;
        const headers = init.headers as Record<string, string>;
        asked.push({
          at,
          body:
            init.body === undefined ? undefined : JSON.parse(String(init.body)),
          auth: headers.authorization,
        });
        const reply = routes[at];
        if (reply === undefined) return new Response('', { status: 404 });
        return new Response(
          typeof reply.body === 'string'
            ? reply.body
            : JSON.stringify(reply.body),
          { status: reply.status },
        );
      }),
    );
    for (const [name, value] of Object.entries({
      GITHUB_API_URL: API,
      GITHUB_SERVER_URL: 'https://github.com',
      GITHUB_REPOSITORY: 'shyden-labs/shyden.co.uk',
      GITHUB_RUN_ID: RUN,
      GITHUB_SHA: SHA,
      GITHUB_TOKEN: 'gh-token',
      GITHUB_REF_NAME: 'develop',
      NEEDS: FAILED_NEEDS,
      DEPLOY_PIPELINE: 'dev',
    }))
      vi.stubEnv(name, value);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it('refuses an argument with its usage, before any request', async () => {
    expect(await main(['--now'])).toBe(2);
    expect(lines).toEqual(['usage: node scripts/deploy-failure.mjs']);
    expect(asked).toEqual([]);
  });

  it('opens one notice assigned to ShydenMcM, asking with the workflow token', async () => {
    expect(await main([])).toBe(0);
    expect(asked.map(({ at }) => at)).toEqual([JOBS, LOG, ISSUES, NEW_ISSUE]);
    expect(new Set(asked.map(({ auth }) => auth))).toEqual(
      new Set(['Bearer gh-token']),
    );
    const notice = asked[3]!.body as Record<string, unknown>;
    expect(notice.title).toBe(TITLE);
    expect(notice.assignees).toEqual(['ShydenMcM']);
    expect(String(notice.body)).toContain(
      `https://github.com/shyden-labs/shyden.co.uk/actions/runs/${RUN}`,
    );
    expect(String(notice.body)).toContain('Received a malformed response');
    expect(lines).toEqual([
      'Failed: deploy-dev.',
      'Fall-back: none.',
      'Opened #731, assigned to ShydenMcM.',
    ]);
  });

  it('comments on the open notice and opens no second one', async () => {
    routes[ISSUES] = {
      status: 200,
      body: [
        {
          number: 726,
          state: 'open',
          user: { login: 'github-actions[bot]' },
          title: TITLE,
        },
      ],
    };
    expect(await main([])).toBe(0);
    expect(asked.map(({ at }) => at)).toEqual([
      JOBS,
      LOG,
      ISSUES,
      `POST ${REPO}/issues/726/comments`,
    ]);
    expect(lines.at(-1)).toBe('Commented on the open notice, #726.');
  });

  it('sends nothing when nothing failed and no fall-back ran', async () => {
    vi.stubEnv(
      'NEEDS',
      JSON.stringify({ 'deploy-dev': { result: 'success', outputs: {} } }),
    );
    expect(await main([])).toBe(0);
    expect(lines).toEqual(['Nothing failed and no fall-back ran: no notice.']);
    expect(asked).toEqual([]);
  });

  it("leaves a dispatched branch's failure to its dispatcher", async () => {
    vi.stubEnv('GITHUB_REF_NAME', '1258-release-checks');
    expect(await main([])).toBe(0);
    expect(lines.at(-1)).toBe(
      'A failure on 1258-release-checks, not develop: no notice.',
    );
    expect(asked).toEqual([]);
  });

  it('still sends the notice when it cannot read the needs, the jobs or the log, naming each', async () => {
    vi.stubEnv('NEEDS', 'not json');
    routes[JOBS] = { status: 500, body: { message: 'boom' } };
    expect(await main([])).toBe(0);
    const notice = String(
      (asked.find(({ at }) => at === NEW_ISSUE)!.body as { body: string }).body,
    );
    expect(notice).toContain("the run's needs (");
    expect(notice).toContain("the run's jobs (GitHub answered HTTP 500)");
  });

  it('names a log it cannot read', async () => {
    delete routes[LOG];
    expect(await main([])).toBe(0);
    const notice = String(
      (asked.find(({ at }) => at === NEW_ISSUE)!.body as { body: string }).body,
    );
    expect(notice).toContain("the failed job's log (GitHub answered HTTP 404)");
  });

  it('opens a new notice when the open issues cannot be read', async () => {
    routes[ISSUES] = { status: 502, body: '<html>' };
    expect(await main([])).toBe(0);
    expect(lines).toContain(
      'The open issues could not be read (GitHub answered HTTP 502); opening a new notice.',
    );
    expect(lines.at(-1)).toBe('Opened #731, assigned to ShydenMcM.');
  });

  it('fails naming the status when GitHub refuses the notice', async () => {
    routes[NEW_ISSUE] = { status: 403, body: { message: 'no' } };
    expect(await main([])).toBe(1);
    expect(lines.at(-1)).toBe('✗ GitHub answered HTTP 403');
  });

  it('fails when the notice is opened without its assignee, since it would reach no one', async () => {
    routes[NEW_ISSUE] = { status: 201, body: { number: 731, assignees: [] } };
    expect(await main([])).toBe(1);
    expect(lines.at(-1)).toBe(
      '✗ Opened #731, but it is not assigned to ShydenMcM',
    );
  });

  it('fails naming a pipeline that is neither dev nor prod, before any request', async () => {
    vi.stubEnv('DEPLOY_PIPELINE', 'staging');
    expect(await main([])).toBe(1);
    expect(lines).toEqual(['✗ DEPLOY_PIPELINE is neither dev nor prod']);
    expect(asked).toEqual([]);
  });
});

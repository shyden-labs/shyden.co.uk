import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { spawn } from 'node:child_process';
import { join } from 'node:path';
import { standInApi, type Reply } from './stand-in-api';

/**
 * `scripts/deploy-failure.mjs` as a real process (#725), as the
 * `report-failure` job of `deploy-dev.yml` runs it, against a local stand-in
 * answering in GitHub's shapes. The stand-in records every request, so what
 * the script asked and posted is read off GitHub's own record.
 *
 * Spawned with async `spawn`, never `spawnSync`: the stand-in answers from
 * this process's event loop, which `spawnSync` would block.
 */

const SCRIPT = join(process.cwd(), 'scripts/deploy-failure.mjs');
const REPO = '/repos/shyden-labs/shyden.co.uk';
const RUN = '38219259063';
const SHA = 'cedea2695eebcb93da9ec1c7277ff71b4363cb8f';
const JOBS = `${REPO}/actions/runs/${RUN}/jobs?filter=latest&per_page=100`;
const LOG = `${REPO}/actions/jobs/2/logs`;
const STORED_LOG = '/storage/job-2.log';
const ISSUES = `${REPO}/issues?state=open&creator=github-actions%5Bbot%5D&per_page=100`;
const NEW_ISSUE = `${REPO}/issues`;

/** The tail of run 38219259063's failed deploy step, as its log held it. */
const LOG_524 = [
  '2026-10-12T07:43:09.0000000Z ##[group]Run npx wrangler pages deploy dist --project-name shyden-site-dev --branch main',
  '2026-10-12T07:43:10.0000000Z POST /accounts/***/pages/projects/shyden-site-dev/deployments -> 524',
  '2026-10-12T07:43:10.1000000Z ✘ [ERROR] Received a malformed response from the API',
  '2026-10-12T07:43:10.2000000Z ##[error]Process completed with exit code 1.',
].join('\n');

const TITLE = 'The dev deploy failed: dev is behind develop';

/** The needs of a run whose deploy failed, as `toJSON(needs)` gives them. */
const FAILED_NEEDS = JSON.stringify({
  gate: { result: 'success', outputs: {} },
  test: { result: 'skipped', outputs: {} },
  'deploy-dev': { result: 'failure', outputs: {} },
  'verify-dev': { result: 'skipped', outputs: {} },
});

const stand = standInApi();

/** The answers of a deploy that failed in its Cloudflare step. */
const failedDeploy = (): Record<string, Reply> => ({
  [`GET ${JOBS}`]: {
    status: 200,
    body: {
      total_count: 3,
      jobs: [
        {
          id: 1,
          name: 'Gate — this tree already passed on its PR',
          conclusion: 'success',
          steps: [
            {
              name: 'Refuse unless the deployed tree is the tree that passed',
              conclusion: 'success',
            },
          ],
        },
        {
          id: 2,
          name: 'Deploy to Dev',
          conclusion: 'failure',
          steps: [
            { name: 'Build (dev)', conclusion: 'success' },
            {
              name: 'Deploy dist/ to Cloudflare Pages (dev project)',
              conclusion: 'failure',
            },
          ],
        },
        { id: 3, name: 'Report a failed deploy', conclusion: null, steps: [] },
      ],
    },
  },
  // A job log answers with a redirect to its storage, as GitHub's does.
  [`GET ${LOG}`]: { status: 302, body: '', location: STORED_LOG },
  [`GET ${STORED_LOG}`]: { status: 200, body: LOG_524 },
  [`GET ${ISSUES}`]: { status: 200, body: [] },
  [`POST ${NEW_ISSUE}`]: {
    status: 201,
    body: { number: 731, assignees: [{ login: 'ShydenMcM' }] },
  },
  [`POST ${REPO}/issues/726/comments`]: { status: 201, body: {} },
});

beforeAll(() => stand.start());
afterAll(() => stand.stop());
beforeEach(() => {
  stand.received.length = 0;
  stand.routes = failedDeploy();
});

/** Run the script with only the variables the workflow gives it. */
const run = (
  overrides: Record<string, string> = {},
  args: string[] = [],
): Promise<{ code: number | null; out: string }> =>
  new Promise((resolve) => {
    const child = spawn(process.execPath, [SCRIPT, ...args], {
      env: {
        PATH: process.env.PATH,
        GITHUB_API_URL: stand.url,
        GITHUB_SERVER_URL: 'https://github.com',
        GITHUB_REPOSITORY: 'shyden-labs/shyden.co.uk',
        GITHUB_RUN_ID: RUN,
        GITHUB_SHA: SHA,
        GITHUB_TOKEN: 'gh-token',
        GITHUB_REF_NAME: 'develop',
        PIPELINE: 'dev',
        REPORT: 'failure',
        NEEDS: FAILED_NEEDS,
        ...overrides,
      },
    });
    let out = '';
    child.stdout.on('data', (chunk) => (out += chunk));
    child.stderr.on('data', (chunk) => (out += chunk));
    child.on('close', (code) => resolve({ code, out }));
  });

const asked = () => stand.received.map(({ method, url }) => `${method} ${url}`);

/** The JSON body of the one request GitHub received at `method url`. */
const posted = (method: string, url: string) => {
  const matching = stand.received.filter(
    (request) => request.method === method && request.url === url,
  );
  expect(matching.length, `requests at ${method} ${url}`).toBe(1);
  return JSON.parse(matching[0].body) as Record<string, unknown>;
};

describe('a failed deploy with no open notice', () => {
  it('opens one issue assigned to ShydenMcM, after reading the jobs, the log and the open issues', async () => {
    const { code, out } = await run();
    expect(code, out).toBe(0);
    expect(asked()).toEqual([
      `GET ${JOBS}`,
      `GET ${LOG}`,
      `GET ${STORED_LOG}`,
      `GET ${ISSUES}`,
      `POST ${NEW_ISSUE}`,
    ]);
    expect(out).toContain('Opened #731, assigned to ShydenMcM.');
  });

  it('the issue names the run, the commit, the failed step and its last error line', async () => {
    await run();
    const issue = posted('POST', NEW_ISSUE);
    expect(issue.title).toBe('The dev deploy failed: dev is behind develop');
    expect(issue.assignees).toEqual(['ShydenMcM']);
    expect(String(issue.body).split('\n').slice(0, 6)).toEqual([
      'A deploy of `develop` to dev failed, so dev.shyden.co.uk is behind `develop`.',
      '',
      `- Run: https://github.com/shyden-labs/shyden.co.uk/actions/runs/${RUN}`,
      `- Commit: \`${SHA}\``,
      '- Failed: Deploy to Dev › Deploy dist/ to Cloudflare Pages (dev project)',
      '- Last error line: `✘ [ERROR] Received a malformed response from the API`',
    ]);
  });

  it('asks GitHub with the workflow token', async () => {
    await run();
    expect(stand.received[0].auth).toBe('Bearer gh-token');
  });
});

describe('only a failure on develop is reported', () => {
  it('a run in which nothing failed says so, and nothing else', async () => {
    const { code, out } = await run({
      NEEDS: JSON.stringify({
        gate: { result: 'success', outputs: {} },
        test: { result: 'skipped', outputs: {} },
        'deploy-dev': { result: 'success', outputs: {} },
        'verify-dev': { result: 'success', outputs: {} },
      }),
    });
    expect(code, out).toBe(0);
    expect(out).toBe('Nothing failed: no notice.\n');
  });

  it("a failure on a dispatched branch is its dispatcher's to read", async () => {
    const { code, out } = await run({ GITHUB_REF_NAME: '725-plant' });
    expect(code, out).toBe(0);
    expect(out).toBe(
      'Failed: deploy-dev.\nA failure on 725-plant, not develop: no notice.\n',
    );
  });

  it('needs it cannot read still send the notice, naming them', async () => {
    const { code, out } = await run({ NEEDS: 'not json' });
    expect(code, out).toBe(0);
    expect(String(posted('POST', NEW_ISSUE).body)).toContain(
      "- Could not be read: the run's needs (",
    );
  });
});

describe('a notice still open', () => {
  it("the bot's open notice gets a comment, and no second issue is opened", async () => {
    stand.routes[`GET ${ISSUES}`] = {
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
    const { code, out } = await run();
    expect(code, out).toBe(0);
    expect(asked().slice(3)).toEqual([
      `GET ${ISSUES}`,
      `POST ${REPO}/issues/726/comments`,
    ]);
    expect(
      String(posted('POST', `${REPO}/issues/726/comments`).body),
    ).toContain(
      '- Last error line: `✘ [ERROR] Received a malformed response from the API`',
    );
    expect(out).toContain('Commented on the open notice, #726.');
  });

  it("a stranger's issue carrying the title is passed over for a new issue", async () => {
    stand.routes[`GET ${ISSUES}`] = {
      status: 200,
      body: [
        {
          number: 727,
          state: 'open',
          user: { login: 'someone-else' },
          title: TITLE,
        },
      ],
    };
    const { code, out } = await run();
    expect(code, out).toBe(0);
    expect(asked().at(-1)).toBe(`POST ${NEW_ISSUE}`);
  });
});

describe('what cannot be read is named in the notice, never a reason to send none', () => {
  it('a jobs list GitHub refuses', async () => {
    stand.routes[`GET ${JOBS}`] = {
      status: 500,
      body: { message: 'Server Error' },
    };
    const { code, out } = await run();
    expect(code, out).toBe(0);
    expect(asked()).toEqual([
      `GET ${JOBS}`,
      `GET ${ISSUES}`,
      `POST ${NEW_ISSUE}`,
    ]);
    expect(
      String(posted('POST', NEW_ISSUE).body).split('\n').slice(4, 7),
    ).toEqual([
      '- Failed: not named by the run',
      '- Last error line: none read',
      "- Could not be read: the run's jobs (GitHub answered HTTP 500)",
    ]);
  });

  it('a log GitHub has not got', async () => {
    stand.routes[`GET ${STORED_LOG}`] = {
      status: 404,
      body: { message: 'Not Found' },
    };
    const { code, out } = await run();
    expect(code, out).toBe(0);
    expect(
      String(posted('POST', NEW_ISSUE).body).split('\n').slice(4, 7),
    ).toEqual([
      '- Failed: Deploy to Dev › Deploy dist/ to Cloudflare Pages (dev project)',
      '- Last error line: none read',
      "- Could not be read: the failed job's log (GitHub answered HTTP 404)",
    ]);
  });

  it('an issue list GitHub refuses opens a new notice', async () => {
    stand.routes[`GET ${ISSUES}`] = {
      status: 403,
      body: { message: 'Forbidden' },
    };
    const { code, out } = await run();
    expect(code, out).toBe(0);
    expect(asked().at(-1)).toBe(`POST ${NEW_ISSUE}`);
    expect(out).toContain(
      'The open issues could not be read (GitHub answered HTTP 403); opening a new notice.',
    );
  });
});

describe('a notice that does not reach the operator is a failure', () => {
  it('a notice GitHub refuses exits 1, naming the status', async () => {
    stand.routes[`POST ${NEW_ISSUE}`] = {
      status: 403,
      body: { message: 'Resource not accessible by integration' },
    };
    const { code, out } = await run();
    expect(code).toBe(1);
    expect(out).toContain('GitHub answered HTTP 403');
  });

  it('a notice opened without its assignee exits 1', async () => {
    stand.routes[`POST ${NEW_ISSUE}`] = {
      status: 201,
      body: { number: 731, assignees: [] },
    };
    const { code, out } = await run();
    expect(code).toBe(1);
    expect(out).toContain('Opened #731, but it is not assigned to ShydenMcM');
  });

  it('a GitHub that never answers the notice times out, rather than outliving the job', async () => {
    stand.routes[`POST ${NEW_ISSUE}`] = null;
    const { code, out } = await run({ DEPLOY_FAILURE_TIMEOUT_MS: '300' });
    expect(code).toBe(1);
    expect(out).toMatch(/aborted|timeout/i);
  });
});

describe('what the script is given', () => {
  it('a commit that is not a full SHA stops before any request', async () => {
    const { code, out } = await run({ GITHUB_SHA: 'cedea269' });
    expect(code).toBe(1);
    expect(out).toContain(
      'GITHUB_SHA is not set, or not in its expected shape',
    );
  });

  it('an argument is refused with the usage line and exit 2', async () => {
    const { code, out } = await run({}, ['report']);
    expect(code).toBe(2);
    expect(out).toContain('usage: node scripts/deploy-failure.mjs');
  });
});

describe('a failed production release (#748)', () => {
  const RUN_URL = `https://github.com/shyden-labs/shyden.co.uk/actions/runs/${RUN}`;
  const COMMENT = `${REPO}/issues/801/comments`;
  const DEPLOYED = {
    id: 11,
    name: 'Deploy to Prod (needs approval)',
    conclusion: 'success',
    steps: [{ name: 'Read the live deployment', conclusion: 'success' }],
  };
  const CHECK_FAILED = {
    id: 12,
    name: 'Post-prod smoke + prod-verified',
    conclusion: 'failure',
    steps: [
      { name: 'Smoke and verify the live prod site', conclusion: 'failure' },
    ],
  };
  const rollbackJob = (conclusion: string | null, steps: object[]) => ({
    id: 13,
    name: 'Roll prod back to the deployment before this release',
    conclusion,
    steps,
  });
  const jobsWith = (rollback: object) => ({
    total_count: 3,
    jobs: [DEPLOYED, CHECK_FAILED, rollback],
  });
  // A job behind approval lists no steps while it waits, nor ever once refused.
  const WAITING = rollbackJob(null, []);
  const ROLLED_BACK = rollbackJob('success', [
    { name: 'Check the secrets are set', conclusion: 'success' },
    {
      name: 'Roll back to the deployment before this deploy',
      conclusion: 'success',
    },
  ]);
  const OPEN_NOTICE = [
    {
      number: 801,
      state: 'open',
      user: { login: 'github-actions[bot]' },
      title: 'A production release failed',
    },
  ];
  const failureStage = {
    PIPELINE: 'prod',
    REPORT: 'failure',
    GITHUB_REF_NAME: 'main',
    NEEDS: JSON.stringify({
      'deploy-prod': { result: 'success', outputs: { before: 'd-prev' } },
      'smoke-and-verify': { result: 'failure', outputs: {} },
    }),
  };
  const rollbackStage = (result: string) => ({
    PIPELINE: 'prod',
    REPORT: 'rollback',
    GITHUB_REF_NAME: 'main',
    NEEDS: JSON.stringify({
      'deploy-prod': { result: 'success', outputs: { before: 'd-prev' } },
      'rollback-prod': { result, outputs: {} },
    }),
  });

  beforeEach(() => {
    stand.routes[`GET ${JOBS}`] = { status: 200, body: jobsWith(WAITING) };
    stand.routes[`GET ${REPO}/actions/jobs/12/logs`] = {
      status: 200,
      body: '2026-10-14T00:00:00.0000000Z ##[error]1 failed\n',
    };
    stand.routes[`POST ${COMMENT}`] = { status: 201, body: {} };
  });

  it('opens "A production release failed" for ShydenMcM at once, naming the rollback that waits for approval', async () => {
    const { code, out } = await run(failureStage);
    expect(code, out).toBe(0);
    const issue = posted('POST', NEW_ISSUE);
    expect(issue.title).toBe('A production release failed');
    expect(issue.assignees).toEqual(['ShydenMcM']);
    expect(String(issue.body).split('\n')).toEqual([
      'A production release of `main` failed.',
      '',
      `- Run: ${RUN_URL}`,
      `- Commit: \`${SHA}\``,
      '- Failed: Post-prod smoke + prod-verified › Smoke and verify the live prod site',
      '- Last error line: `1 failed`',
      `- Rollback: waiting for your approval. Approve it in ${RUN_URL} to put production back to deployment \`d-prev\`, the one before this release, or reject it to keep this release live. Until you do, this run holds the production lock: a fix pushed to \`main\` waits behind it, and a manual \`rollback.yml\` cancels it.`,
      '',
      'This issue is retired by hand once production serves a release that passed its live check (`prod-verified` on its commit).',
    ]);
  });

  it('adds a rolled-back outcome to the open notice, saying main and the live site differ', async () => {
    stand.routes[`GET ${ISSUES}`] = { status: 200, body: OPEN_NOTICE };
    stand.routes[`GET ${JOBS}`] = { status: 200, body: jobsWith(ROLLED_BACK) };
    const { code, out } = await run(rollbackStage('success'));
    expect(code, out).toBe(0);
    expect(String(posted('POST', COMMENT).body).split('\n')[6]).toBe(
      `- Rollback: production now serves deployment \`d-prev\`, the one before this release. \`main\` (commit \`${SHA}\`) and the live site now differ. Next: fix forward and redeploy \`main\`, or revert the release on \`main\`.`,
    );
    expect(out).toContain('Commented on the open notice, #801.');
  });

  it('adds "did not run" to the open notice when the approval was refused and the job never started', async () => {
    stand.routes[`GET ${ISSUES}`] = { status: 200, body: OPEN_NOTICE };
    stand.routes[`GET ${JOBS}`] = {
      status: 200,
      body: jobsWith(rollbackJob('failure', [])),
    };
    const { code, out } = await run(rollbackStage('failure'));
    expect(code, out).toBe(0);
    expect(String(posted('POST', COMMENT).body).split('\n')[6]).toBe(
      '- Rollback: did not run (its approval was refused or expired), so production still serves the release that failed its check. Roll back by hand with `rollback.yml` (deployment `d-prev`).',
    );
  });

  it('with no rollback queued, the outcome report stops before any request', async () => {
    const { code, out } = await run(rollbackStage('skipped'));
    expect(code).toBe(0);
    expect(out).toBe('No rollback was queued: nothing to add.\n');
  });

  it('a production failure on another branch sends nothing', async () => {
    const { code, out } = await run({
      ...failureStage,
      GITHUB_REF_NAME: 'develop',
    });
    expect(code, out).toBe(0);
    expect(out).toBe(
      'Failed: smoke-and-verify.\nA failure on develop, not main: no notice.\n',
    );
  });

  it('no pipeline stops before any request, naming it', async () => {
    const { code, out } = await run({ PIPELINE: '' });
    expect(code).toBe(1);
    expect(out).toBe('✗ PIPELINE is "", not dev or prod\n');
  });

  it('no report stops before any request, naming it', async () => {
    const { code, out } = await run({ REPORT: '' });
    expect(code).toBe(1);
    expect(out).toBe('✗ REPORT is "", not failure or rollback\n');
  });
});

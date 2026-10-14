import { describe, it, expect } from 'vitest';
import {
  ERROR_LINE_LIMIT,
  NOTICE_ASSIGNEE,
  NOTICE_AUTHOR,
  PIPELINES,
  ROLLBACK_JOB,
  ROLLBACK_STEP,
  beforeOf,
  failureOf,
  failedNeeds,
  lastErrorLine,
  noticeBody,
  openNoticeOf,
  pipelineOf,
  reportOf,
  rollbackAfter,
  rollbackOf,
  rollbackQueued,
  rollbackWaits,
} from '../../src/lib/deploy-failure';
import { floorBreach } from '../floors';
import { searched } from '../source-files';

/**
 * A develop deploy that fails opens, or comments on, one issue (#725). The
 * pure half: which job and step failed, the log's last error line, the
 * notice's text, and which open issue already carries it.
 */

/** A job log line as the runner writes it: a timestamp, then the text. */
const stamped = (text: string) => `2026-10-12T07:43:10.1234567Z ${text}`;

/** The tail of run 38219259063's failed deploy step, as its log held it. */
const LOG_524 = [
  '##[group]Run npx wrangler pages deploy dist --project-name shyden-site-dev --branch main',
  '✨ Success! Uploaded 0 files (60 already uploaded) (0.41 sec)',
  'POST /accounts/***/pages/projects/shyden-site-dev/deployments -> 524',
  '✘ [ERROR] Received a malformed response from the API',
  '🪵  Logs were written to "/home/runner/.config/.wrangler/logs/wrangler.log"',
  '##[error]Process completed with exit code 1.',
  'Post job cleanup.',
]
  .map(stamped)
  .join('\n');

const job = (
  id: number,
  name: string,
  conclusion: string | null,
  steps: { name: string; conclusion: string | null }[],
) => ({ id, name, conclusion, steps });

describe('the constants are pinned to their literal values', () => {
  it('the notice goes to ShydenMcM, posted by the workflow token', () => {
    expect(NOTICE_ASSIGNEE).toBe('ShydenMcM');
    expect(NOTICE_AUTHOR).toBe('github-actions[bot]');
  });

  it('each pipeline names its notice for what it means', () => {
    expect([PIPELINES.dev.title, PIPELINES.prod.title]).toEqual([
      'The dev deploy failed: dev is behind develop',
      'A production release failed',
    ]);
  });
  it('each pipeline reports for its own branch', () => {
    expect([PIPELINES.dev.ref, PIPELINES.prod.ref]).toEqual([
      'develop',
      'main',
    ]);
  });
  it('both workflows roll back in one step name the notice finds', () => {
    expect(ROLLBACK_STEP).toBe(
      'Roll back to the deployment before this deploy',
    );
  });

  it('an error line is cut at 300 characters', () => {
    expect(ERROR_LINE_LIMIT).toBe(300);
  });
});

describe('failedNeeds', () => {
  it('names each need whose result is failure, in the order the run lists them', () => {
    expect(
      failedNeeds({
        gate: { result: 'skipped', outputs: {} },
        test: { result: 'failure', outputs: {} },
        'deploy-dev': { result: 'skipped', outputs: {} },
        'verify-dev': { result: 'failure', outputs: {} },
      }),
    ).toEqual(['test', 'verify-dev']);
  });

  it('a run in which nothing failed names none', () => {
    const needs = {
      gate: { result: 'success', outputs: {} },
      test: { result: 'skipped', outputs: {} },
      'deploy-dev': { result: 'success', outputs: {} },
      'verify-dev': { result: 'success', outputs: {} },
    };
    expect(
      searched(failedNeeds(needs), {
        of: Object.keys(needs),
        what: 'needs of a run in which nothing failed',
      }),
    ).toEqual([]);
    expect(
      floorBreach(
        'deploy-failure/needs-none-failed',
        Object.keys(needs).length,
      ),
    ).toBeUndefined();
  });

  it('a cancelled need is not a failure to report', () => {
    const needs = { 'deploy-dev': { result: 'cancelled' } };
    expect(
      searched(failedNeeds(needs), {
        of: Object.keys(needs),
        what: 'needs of a run someone cancelled',
      }),
    ).toEqual([]);
    expect(
      floorBreach('deploy-failure/needs-cancelled', Object.keys(needs).length),
    ).toBeUndefined();
  });

  it('needs that are not an object throw, rather than read as nothing failed', () => {
    expect(() => failedNeeds([])).toThrow(
      'the needs are not an object of jobs',
    );
  });

  it('a need with no result throws, rather than read as not failed', () => {
    expect(() => failedNeeds({ gate: { outputs: {} } })).toThrow(
      "need 'gate' has no result",
    );
  });
});

describe('failureOf', () => {
  it('names the failed job, its failed step and the job id its log is read by', () => {
    const answer = {
      total_count: 3,
      jobs: [
        job(1, 'Gate — this tree already passed on its PR', 'success', [
          {
            name: 'Refuse unless the deployed tree is the tree that passed',
            conclusion: 'success',
          },
        ]),
        job(2, 'Deploy to Dev', 'failure', [
          { name: 'Build (dev)', conclusion: 'success' },
          {
            name: 'Deploy dist/ to Cloudflare Pages (dev project)',
            conclusion: 'failure',
          },
          { name: 'Post actions/checkout', conclusion: 'success' },
        ]),
        job(3, 'Report a failed deploy', null, []),
      ],
    };
    expect(failureOf(answer)).toEqual({
      jobId: 2,
      job: 'Deploy to Dev',
      step: 'Deploy dist/ to Cloudflare Pages (dev project)',
    });
  });

  it('a failed job listing no failed step names the job, and no step', () => {
    const answer = {
      jobs: [job(7, 'Comprehensive web tests / checks', 'failure', [])],
    };
    expect(failureOf(answer)).toEqual({
      jobId: 7,
      job: 'Comprehensive web tests / checks',
      step: undefined,
    });
  });

  it('a run listing no failed job answers undefined', () => {
    const answer = { jobs: [job(1, 'Deploy to Dev', 'cancelled', [])] };
    expect(failureOf(answer)).toBeUndefined();
  });

  it('an answer holding no jobs list throws', () => {
    expect(() => failureOf({ message: 'Not Found' })).toThrow(
      "the run's jobs answer holds no list of jobs",
    );
  });

  it('a failed job without a whole-number id throws, since its log is read by it', () => {
    const answer = {
      jobs: [
        { id: '2', name: 'Deploy to Dev', conclusion: 'failure', steps: [] },
      ],
    };
    expect(() => failureOf(answer)).toThrow('the failed job has no numeric id');
  });
});

describe('lastErrorLine', () => {
  it("names the 524's own error, not the runner's exit line after it", () => {
    expect(lastErrorLine(LOG_524)).toBe(
      '✘ [ERROR] Received a malformed response from the API',
    );
  });

  it("falls back to the runner's exit line when no other line names an error", () => {
    const log = ['Run exit 1', '##[error]Process completed with exit code 1.']
      .map(stamped)
      .join('\n');
    expect(lastErrorLine(log)).toBe('Process completed with exit code 1.');
  });

  it("strips the runner's ##[error] prefix from an annotated line", () => {
    const log = [
      '##[error]Planted failure (#725): nothing was deployed',
      '##[error]Process completed with exit code 1.',
    ]
      .map(stamped)
      .join('\n');
    expect(lastErrorLine(log)).toBe(
      'Planted failure (#725): nothing was deployed',
    );
  });

  it('reads a CRLF log as a LF one', () => {
    expect(lastErrorLine(LOG_524.replaceAll('\n', '\r\n'))).toBe(
      '✘ [ERROR] Received a malformed response from the API',
    );
  });

  it('a log naming no error answers undefined', () => {
    expect(
      lastErrorLine(['Run true', 'done'].map(stamped).join('\n')),
    ).toBeUndefined();
  });

  it('a line longer than the limit is cut to it, with an ellipsis', () => {
    const long = `Error: ${'x'.repeat(400)}`;
    const line = lastErrorLine(stamped(long));
    expect(line).toBe(`${long.slice(0, 299)}…`);
    expect(line?.length).toBe(300);
  });
});

describe('noticeBody', () => {
  const RUN =
    'https://github.com/shyden-labs/shyden.co.uk/actions/runs/38219259063';
  const SHA = 'cedea2695eebcb93da9ec1c7277ff71b4363cb8f';

  it('names the run, the commit, the step and the error line', () => {
    expect(
      noticeBody({
        pipeline: 'dev',
        rollback: 'none',
        before: undefined,
        runUrl: RUN,
        sha: SHA,
        failure: {
          jobId: 2,
          job: 'Deploy to Dev',
          step: 'Deploy dist/ to Cloudflare Pages (dev project)',
        },
        errorLine: '✘ [ERROR] Received a malformed response from the API',
        unread: [],
      }),
    ).toBe(
      [
        'A deploy of `develop` to dev failed, so dev.shyden.co.uk is behind `develop`.',
        '',
        `- Run: ${RUN}`,
        `- Commit: \`${SHA}\``,
        '- Failed: Deploy to Dev › Deploy dist/ to Cloudflare Pages (dev project)',
        '- Last error line: `✘ [ERROR] Received a malformed response from the API`',
        '',
        "If the cause is outside our code, dispatch `deploy-dev.yml` on develop's head (CLAUDE.md, Releasing). This issue is retired by hand once `dev-verified` is on develop's head.",
      ].join('\n'),
    );
  });

  it('says what could not be read instead of leaving it out', () => {
    const body = noticeBody({
      pipeline: 'dev',
      rollback: 'none',
      before: undefined,
      runUrl: RUN,
      sha: SHA,
      failure: undefined,
      errorLine: undefined,
      unread: ["the run's jobs (GitHub answered HTTP 500)"],
    });
    expect(body.split('\n').slice(4, 7)).toEqual([
      '- Failed: not named by the run',
      '- Last error line: none read',
      "- Could not be read: the run's jobs (GitHub answered HTTP 500)",
    ]);
  });

  it('a job with no failed step is named alone', () => {
    const body = noticeBody({
      pipeline: 'dev',
      rollback: 'none',
      before: undefined,
      runUrl: RUN,
      sha: SHA,
      failure: {
        jobId: 7,
        job: 'Comprehensive web tests / checks',
        step: undefined,
      },
      errorLine: undefined,
      unread: [],
    });
    expect(body.split('\n')[4]).toBe(
      '- Failed: Comprehensive web tests / checks',
    );
  });

  it('a backtick in the error line cannot end its code span', () => {
    const body = noticeBody({
      pipeline: 'dev',
      rollback: 'none',
      before: undefined,
      runUrl: RUN,
      sha: SHA,
      failure: undefined,
      errorLine: 'Error: `wrangler` exited',
      unread: [],
    });
    expect(body.split('\n')[5]).toBe(
      "- Last error line: `Error: 'wrangler' exited`",
    );
  });
});

describe('openNoticeOf', () => {
  const TITLE = 'The dev deploy failed: dev is behind develop';
  const issue = (
    number: number,
    login: string,
    title: string,
    extra: Record<string, unknown> = {},
  ) => ({ number, state: 'open', user: { login }, title, ...extra });

  it('finds the prod notice by its own title, not the dev one', () => {
    expect(
      openNoticeOf(
        [
          issue(726, 'github-actions[bot]', TITLE),
          issue(801, 'github-actions[bot]', 'A production release failed'),
        ],
        'A production release failed',
      ),
    ).toBe(801);
  });

  it("answers the bot's open issue carrying the notice's title", () => {
    expect(
      openNoticeOf(
        [
          issue(360, 'github-actions[bot]', 'Translation reports are waiting'),
          issue(726, 'github-actions[bot]', TITLE),
        ],
        TITLE,
      ),
    ).toBe(726);
  });

  it("a stranger's issue carrying the title is not the notice", () => {
    expect(
      openNoticeOf([issue(727, 'someone-else', TITLE)], TITLE),
    ).toBeUndefined();
  });

  it('a pull request carrying the title is not the notice', () => {
    expect(
      openNoticeOf(
        [
          issue(728, 'github-actions[bot]', TITLE, {
            pull_request: { url: 'x' },
          }),
        ],
        TITLE,
      ),
    ).toBeUndefined();
  });

  it("a title that only begins with the notice's is not the notice", () => {
    expect(
      openNoticeOf(
        [issue(729, 'github-actions[bot]', `${TITLE} (again)`)],
        TITLE,
      ),
    ).toBeUndefined();
  });

  it('a closed issue is not the notice', () => {
    expect(
      openNoticeOf(
        [issue(730, 'github-actions[bot]', TITLE, { state: 'closed' })],
        TITLE,
      ),
    ).toBeUndefined();
  });

  it('an answer that is not a list throws', () => {
    expect(() => openNoticeOf({ message: 'Bad credentials' }, TITLE)).toThrow(
      'the open issues are not a list',
    );
  });
});

describe('pipelineOf', () => {
  it('reads dev', () => {
    expect(pipelineOf('dev')).toBe('dev');
  });
  it('reads prod', () => {
    expect(pipelineOf('prod')).toBe('prod');
  });
  it('refuses anything else, naming it', () => {
    expect(() => pipelineOf('production')).toThrow(
      'PIPELINE is "production", not dev or prod',
    );
  });
  it('refuses an unset pipeline', () => {
    expect(() => pipelineOf(undefined)).toThrow(
      'PIPELINE is undefined, not dev or prod',
    );
  });
});

describe('reportOf', () => {
  it('reads failure', () => {
    expect(reportOf('failure')).toBe('failure');
  });
  it('reads rollback', () => {
    expect(reportOf('rollback')).toBe('rollback');
  });
  it('refuses anything else, naming it', () => {
    expect(() => reportOf('outcome')).toThrow(
      'REPORT is "outcome", not failure or rollback',
    );
  });
  it('refuses an unset report', () => {
    expect(() => reportOf(undefined)).toThrow(
      'REPORT is undefined, not failure or rollback',
    );
  });
});

describe('rollbackWaits', () => {
  const needs = (deploy: string, check: string) => ({
    'deploy-prod': { result: deploy, outputs: {} },
    'smoke-and-verify': { result: check, outputs: {} },
  });
  it('names the results rollback-prod runs under', () => {
    expect(PIPELINES.prod.rollbackWhen).toEqual({
      'deploy-prod': 'success',
      'smoke-and-verify': 'failure',
    });
  });
  it('waits after a deploy that succeeded and a check that failed', () => {
    expect(rollbackWaits(needs('success', 'failure'), 'prod')).toBe(true);
  });
  it('does not wait after a check that passed', () => {
    expect(rollbackWaits(needs('success', 'success'), 'prod')).toBe(false);
  });
  it('does not wait after a deploy that failed, which changed nothing live', () => {
    expect(rollbackWaits(needs('failure', 'skipped'), 'prod')).toBe(false);
  });
  it('never waits on dev, whose rollback is a step that has already run', () => {
    expect(
      rollbackWaits(
        {
          'deploy-dev': { result: 'success', outputs: {} },
          'verify-dev': { result: 'failure', outputs: {} },
        },
        'dev',
      ),
    ).toBe(false);
  });
  it('does not wait on needs that are not an object', () => {
    expect(rollbackWaits('not json', 'prod')).toBe(false);
  });
});

describe('rollbackQueued', () => {
  it('reads the job it names', () => {
    expect(ROLLBACK_JOB).toBe('rollback-prod');
  });
  it('a skipped rollback job was never queued', () => {
    expect(
      rollbackQueued({ 'rollback-prod': { result: 'skipped', outputs: {} } }),
    ).toBe(false);
  });
  it('a rollback job that failed was queued', () => {
    expect(
      rollbackQueued({ 'rollback-prod': { result: 'failure', outputs: {} } }),
    ).toBe(true);
  });
  it('a rollback job that succeeded was queued', () => {
    expect(
      rollbackQueued({ 'rollback-prod': { result: 'success', outputs: {} } }),
    ).toBe(true);
  });
  it('needs that do not name it count as queued: a notice too many beats none', () => {
    expect(rollbackQueued({})).toBe(true);
  });
});

describe('rollbackOf', () => {
  const rolling = (conclusion: string | null, jobConclusion: string) => ({
    jobs: [
      job(1, 'Post-prod smoke + prod-verified', 'failure', [
        { name: 'Smoke and verify the live prod site', conclusion: 'failure' },
      ]),
      job(
        2,
        'Roll prod back to the deployment before this release',
        jobConclusion,
        [
          {
            name: 'Check the secrets are set',
            conclusion: conclusion === null ? 'failure' : 'success',
          },
          {
            name: 'Roll back to the deployment before this deploy',
            conclusion,
          },
        ],
      ),
    ],
  });
  it('a rollback step that succeeded rolled back', () => {
    expect(rollbackOf(rolling('success', 'success'))).toBe('rolled-back');
  });
  it('a rollback step that failed failed', () => {
    expect(rollbackOf(rolling('failure', 'failure'))).toBe('failed');
  });
  it('a failed job whose rollback step never ran failed (its secrets were missing)', () => {
    expect(rollbackOf(rolling(null, 'failure'))).toBe('failed');
  });
  it('a rollback job skipped whole, listing no steps, is none', () => {
    expect(
      rollbackOf({
        jobs: [
          job(
            2,
            'Roll prod back to the deployment before this release',
            'skipped',
            [],
          ),
        ],
      }),
    ).toBe('none');
  });
  it('a run with no rollback step at all is none', () => {
    expect(
      rollbackOf({
        jobs: [
          job(2, 'Deploy to Dev', 'failure', [
            { name: 'Build (dev)', conclusion: 'failure' },
          ]),
        ],
      }),
    ).toBe('none');
  });
  it('a skipped rollback step in a job that passed is none', () => {
    expect(rollbackOf(rolling('skipped', 'success'))).toBe('none');
  });
  it('an answer holding no jobs list throws', () => {
    expect(() => rollbackOf({})).toThrow(
      "the run's jobs answer holds no list of jobs",
    );
  });
});

describe('rollbackAfter', () => {
  const after = (
    conclusion: string,
    steps: { name: string; conclusion: string | null }[],
  ) =>
    rollbackAfter({
      jobs: [
        job(
          13,
          'Roll prod back to the deployment before this release',
          conclusion,
          steps,
        ),
      ],
    });
  it('a job that never started, listing no steps, did not run (its approval was refused or expired)', () => {
    expect(after('failure', [])).toBe('not-run');
  });
  it('a rollback step that succeeded rolled back', () => {
    expect(
      after('success', [{ name: ROLLBACK_STEP, conclusion: 'success' }]),
    ).toBe('rolled-back');
  });
  it('a rollback step that failed failed', () => {
    expect(
      after('failure', [{ name: ROLLBACK_STEP, conclusion: 'failure' }]),
    ).toBe('failed');
  });
});

describe('beforeOf', () => {
  it("reads the deploy job's before output", () => {
    expect(
      beforeOf(
        { 'deploy-prod': { result: 'success', outputs: { before: 'd-prev' } } },
        'prod',
      ),
    ).toBe('d-prev');
  });
  it("reads dev's from deploy-dev", () => {
    expect(
      beforeOf(
        { 'deploy-dev': { result: 'success', outputs: { before: 'd-dev' } } },
        'dev',
      ),
    ).toBe('d-dev');
  });
  it('a deploy job that recorded nothing gives undefined', () => {
    expect(
      beforeOf({ 'deploy-prod': { result: 'failure', outputs: {} } }, 'prod'),
    ).toBeUndefined();
  });
  it('an output of another shape gives undefined, never reaching the notice', () => {
    expect(
      beforeOf(
        { 'deploy-prod': { result: 'success', outputs: { before: 'a`b' } } },
        'prod',
      ),
    ).toBeUndefined();
  });
  it('needs that are not an object give undefined', () => {
    expect(beforeOf('not json', 'prod')).toBeUndefined();
  });
});

describe('noticeBody, for a release and its rollback (#748)', () => {
  const RUN =
    'https://github.com/shyden-labs/shyden.co.uk/actions/runs/38500000001';
  const SHA = 'cedea2695eebcb93da9ec1c7277ff71b4363cb8f';
  const SMOKE = {
    jobId: 12,
    job: 'Post-prod smoke + prod-verified',
    step: 'Smoke and verify the live prod site',
  };
  const body = (
    pipeline: 'dev' | 'prod',
    rollback: 'rolled-back' | 'failed' | 'waiting' | 'not-run' | 'none',
    before: string | undefined,
  ) =>
    noticeBody({
      pipeline,
      runUrl: RUN,
      sha: SHA,
      failure: SMOKE,
      errorLine: '1 failed',
      unread: [],
      rollback,
      before,
    });

  it('a rolled-back release says what is live, that main differs, and what to do', () => {
    expect(body('prod', 'rolled-back', 'd-prev')).toBe(
      [
        'A production release of `main` failed.',
        '',
        `- Run: ${RUN}`,
        `- Commit: \`${SHA}\``,
        '- Failed: Post-prod smoke + prod-verified › Smoke and verify the live prod site',
        '- Last error line: `1 failed`',
        `- Rollback: production now serves deployment \`d-prev\`, the one before this release. \`main\` (commit \`${SHA}\`) and the live site now differ. Next: fix forward and redeploy \`main\`, or revert the release on \`main\`.`,
        '',
        'This issue is retired by hand once production serves a release that passed its live check (`prod-verified` on its commit).',
      ].join('\n'),
    );
  });
  it('a failed rollback says production still serves the failing release', () => {
    expect(body('prod', 'failed', 'd-prev').split('\n')[6]).toBe(
      '- Rollback: the rollback FAILED, so production still serves the release that failed its check. Roll back by hand with `rollback.yml` (deployment `d-prev`).',
    );
  });
  it('no rollback, with the live deployment read, names it', () => {
    expect(body('prod', 'none', 'd-prev').split('\n')[6]).toBe(
      '- Rollback: none. Nothing was deployed, or the deploy itself failed, so production should still serve deployment `d-prev`: check https://shyden.co.uk.',
    );
  });
  it('no rollback, with nothing read, says the live deployment was not read', () => {
    expect(body('prod', 'none', undefined).split('\n')[6]).toBe(
      '- Rollback: none, and the live deployment was not read before the deploy: check https://shyden.co.uk.',
    );
  });
  it('a dev rollback says dev now serves the deployment before, and develop differs', () => {
    expect(body('dev', 'rolled-back', 'd-dev').split('\n')[6]).toBe(
      `- Rollback: dev now serves deployment \`d-dev\`, the one before this deploy, so \`develop\` (commit \`${SHA}\`) and dev differ.`,
    );
  });
  it('a failed dev rollback says dev still serves the deploy that failed', () => {
    expect(body('dev', 'failed', 'd-dev').split('\n')[6]).toBe(
      '- Rollback: the automatic rollback failed, so dev still serves the deploy that failed its check (the one before it is `d-dev`).',
    );
  });
  it('dev with no rollback adds no line: its notice is as before', () => {
    expect(body('dev', 'none', 'd-dev').split('\n')).toHaveLength(8);
  });
  it('a waiting rollback names the run to approve it in, and what holding the lock means', () => {
    expect(body('prod', 'waiting', 'd-prev').split('\n')[6]).toBe(
      `- Rollback: waiting for your approval. Approve it in ${RUN} to put production back to deployment \`d-prev\`, the one before this release, or reject it to keep this release live. Until you do, this run holds the production lock: a fix pushed to \`main\` waits behind it, and a manual \`rollback.yml\` cancels it.`,
    );
  });
  it('a rollback that never started says production still serves the failing release', () => {
    expect(body('prod', 'not-run', 'd-prev').split('\n')[6]).toBe(
      '- Rollback: did not run (its approval was refused or expired), so production still serves the release that failed its check. Roll back by hand with `rollback.yml` (deployment `d-prev`).',
    );
  });
  it('dev has no waiting rollback, and refuses one rather than sending a notice without it', () => {
    expect(() => body('dev', 'waiting', 'd-dev')).toThrow(
      'the dev notice has no "waiting" rollback line',
    );
  });
  it('an unread rollback adds no line: the unread jobs are already named', () => {
    expect(
      noticeBody({
        pipeline: 'prod',
        runUrl: RUN,
        sha: SHA,
        failure: undefined,
        errorLine: undefined,
        unread: ["the run's jobs (GitHub answered HTTP 500)"],
        rollback: undefined,
        before: 'd-prev',
      }).split('\n'),
    ).toEqual([
      'A production release of `main` failed.',
      '',
      `- Run: ${RUN}`,
      `- Commit: \`${SHA}\``,
      '- Failed: not named by the run',
      '- Last error line: none read',
      "- Could not be read: the run's jobs (GitHub answered HTTP 500)",
      '',
      'This issue is retired by hand once production serves a release that passed its live check (`prod-verified` on its commit).',
    ]);
  });
});

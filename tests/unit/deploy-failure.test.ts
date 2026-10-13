import { describe, it, expect } from 'vitest';
import {
  ERROR_LINE_LIMIT,
  NOTICE_ASSIGNEE,
  NOTICE_AUTHOR,
  NOTICE_TITLE,
  failureOf,
  failedNeeds,
  lastErrorLine,
  noticeBody,
  openNoticeOf,
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

  it('the notice is titled for what it means, and found again by that title', () => {
    expect(NOTICE_TITLE).toBe('The dev deploy failed: dev is behind develop');
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

  it("answers the bot's open issue carrying the notice's title", () => {
    expect(
      openNoticeOf([
        issue(360, 'github-actions[bot]', 'Translation reports are waiting'),
        issue(726, 'github-actions[bot]', TITLE),
      ]),
    ).toBe(726);
  });

  it("a stranger's issue carrying the title is not the notice", () => {
    expect(openNoticeOf([issue(727, 'someone-else', TITLE)])).toBeUndefined();
  });

  it('a pull request carrying the title is not the notice', () => {
    expect(
      openNoticeOf([
        issue(728, 'github-actions[bot]', TITLE, {
          pull_request: { url: 'x' },
        }),
      ]),
    ).toBeUndefined();
  });

  it("a title that only begins with the notice's is not the notice", () => {
    expect(
      openNoticeOf([issue(729, 'github-actions[bot]', `${TITLE} (again)`)]),
    ).toBeUndefined();
  });

  it('a closed issue is not the notice', () => {
    expect(
      openNoticeOf([
        issue(730, 'github-actions[bot]', TITLE, { state: 'closed' }),
      ]),
    ).toBeUndefined();
  });

  it('an answer that is not a list throws', () => {
    expect(() => openNoticeOf({ message: 'Bad credentials' })).toThrow(
      'the open issues are not a list',
    );
  });
});

import { describe, expect, it } from 'vitest';
import {
  FAILURES_TITLE,
  WINDOW_DAYS,
  failedUpdates,
  failuresBody,
  updateErrorLine,
  windowStart,
} from '../../src/lib/dependabot-failures';
import { ERROR_LINE_LIMIT, openNoticeOf } from '../../src/lib/deploy-failure';

/**
 * A failed Dependabot update run opens, or comments on, one issue (#1119;
 * Shyden's ruling 2026-11-10, "Weekly check"). The pure half: which runs of
 * the last week failed, and the notice's text.
 */

/** Run 42574190341 as the runs list returned it, the 9 November failure. */
const NODE_9_NOV = {
  id: 42574190341,
  name: 'docker in /.github/node - Update #1689136452',
  path: 'dynamic/dependabot/dependabot-updates',
  event: 'dynamic',
  status: 'completed',
  conclusion: 'failure',
  created_at: '2026-11-09T06:37:34Z',
  html_url:
    'https://github.com/shyden-labs/shyden.co.uk/actions/runs/42574190341',
};

const run = (changes: Record<string, unknown>) => ({
  ...NODE_9_NOV,
  ...changes,
});

const SINCE = new Date('2026-11-03T09:00:00Z');

describe('failedUpdates: the Dependabot runs of the window that failed', () => {
  it('keeps a failed update run created inside the window', () => {
    expect(failedUpdates({ workflow_runs: [NODE_9_NOV] }, SINCE)).toEqual([
      {
        id: 42574190341,
        title: 'docker in /.github/node - Update #1689136452',
        created: '2026-11-09T06:37:34Z',
        url: 'https://github.com/shyden-labs/shyden.co.uk/actions/runs/42574190341',
      },
    ]);
  });

  it('leaves out a run that succeeded, was cancelled or is still running', () => {
    expect(
      failedUpdates(
        {
          workflow_runs: [
            run({ conclusion: 'success' }),
            run({ conclusion: 'cancelled' }),
            run({ status: 'in_progress', conclusion: null }),
          ],
        },
        SINCE,
      ),
    ).toEqual([]);
  });

  it('leaves out a failed run that is not a Dependabot update', () => {
    expect(
      failedUpdates(
        {
          workflow_runs: [
            run({ path: 'dynamic/github-code-scanning/codeql' }),
            run({ path: '.github/workflows/ci.yml', event: 'push' }),
          ],
        },
        SINCE,
      ),
    ).toEqual([]);
  });

  it('leaves out a failure from before the window, and keeps one at its start', () => {
    expect(
      failedUpdates(
        {
          workflow_runs: [
            run({ id: 1, created_at: '2026-11-03T08:59:59Z' }),
            run({ id: 2, created_at: '2026-11-03T09:00:00Z' }),
          ],
        },
        SINCE,
      ).map(({ id }) => id),
    ).toEqual([2]);
  });

  it('refuses an answer that is not a runs list, rather than reporting none', () => {
    expect(() => failedUpdates({ message: 'Not Found' }, SINCE)).toThrow(
      'the Dependabot runs are not a list',
    );
    expect(() => failedUpdates(null, SINCE)).toThrow(
      'the Dependabot runs are not a list',
    );
  });

  it('refuses a run missing a field the notice names', () => {
    expect(() =>
      failedUpdates({ workflow_runs: [run({ html_url: undefined })] }, SINCE),
    ).toThrow('a failed Dependabot run has no id, name, date or link');
  });
});

describe('windowStart: the window is the week before the check', () => {
  it(`starts ${WINDOW_DAYS} days before now`, () => {
    expect(windowStart(new Date('2026-11-10T09:00:00Z')).toISOString()).toBe(
      '2026-11-03T09:00:00.000Z',
    );
  });
});

describe('failuresBody: the notice names each failed run', () => {
  it("names the run, its date, its link and its log's error line", () => {
    const body = failuresBody(
      [
        {
          id: 42574190341,
          title: 'docker in /.github/node - Update #1689136452',
          created: '2026-11-09T06:37:34Z',
          url: 'https://github.com/shyden-labs/shyden.co.uk/actions/runs/42574190341',
          errorLine: 'Dependabot encountered an error performing the update',
        },
      ],
      SINCE,
    );
    expect(body).toContain('since 2026-11-03');
    expect(body).toContain(
      '[docker in /.github/node - Update #1689136452](https://github.com/shyden-labs/shyden.co.uk/actions/runs/42574190341), 2026-11-09',
    );
    expect(body).toContain(
      '`Dependabot encountered an error performing the update`',
    );
  });

  it('says so when a log could not be read, rather than leaving the run out', () => {
    const body = failuresBody(
      [
        {
          id: 1,
          title: 'npm_and_yarn in /. - Update #1',
          created: '2026-11-09T06:30:00Z',
          url: 'https://example.test/runs/1',
          unread: 'HTTP 404',
        },
      ],
      SINCE,
    );
    expect(body).toContain('npm_and_yarn in /. - Update #1');
    expect(body).toContain('its log could not be read (HTTP 404)');
  });
});

describe('the notice is found again by its own title', () => {
  const notice = {
    number: 1200,
    state: 'open',
    title: FAILURES_TITLE,
    user: { login: 'github-actions[bot]' },
  };

  it('finds the open Dependabot notice', () => {
    expect(openNoticeOf([notice], FAILURES_TITLE)).toBe(1200);
  });

  it("does not take the dev deploy's notice for it", () => {
    expect(openNoticeOf([notice])).toBeUndefined();
  });
});

/** The tail of run 42574190341's job log, as GitHub served it (9 November). */
const LOG_9_NOV = [
  '2026-11-09T06:38:06.0653402Z 2026/11/09 06:38:06 [054] Remote response: {"errors":[{"status":400,"title":"Bad Request","detail":"The request contains invalid or unauthorized changes"}]}',
  '2026-11-09T06:38:06.2179717Z updater | 2026/11/09 06:38:06 INFO <job_1689136452> Handled error whilst updating node: dependency_file_not_supported {message: "{\\"errors\\":[{\\"status\\":400,\\"title\\":\\"Bad Request\\",\\"detail\\":\\"The request contains invalid or unauthorized changes\\"}]}"}',
  "2026-11-09T06:38:06.6959733Z Dependabot encountered '1' error(s) during execution, please check the logs for more details.",
  '2026-11-09T06:38:07.8949599Z ##[error]Dependabot encountered an error performing the update',
  '2026-11-09T06:38:07.8958666Z 🤖 ~ finished: error reported to Dependabot ~',
].join('\n');

describe("updateErrorLine: the line of an update run's log that names its failure", () => {
  it("takes the updater's own account of the error, not the closing banner", () => {
    expect(updateErrorLine(LOG_9_NOV)).toBe(
      'Handled error whilst updating node: dependency_file_not_supported {message: "{\\"errors\\":[{\\"status\\":400,\\"title\\":\\"Bad Request\\",\\"detail\\":\\"The request contains invalid or unauthorized changes\\"}]}"}',
    );
  });

  it("falls back to the run's error annotation when the updater named none", () => {
    expect(
      updateErrorLine(
        [
          '2026-11-09T06:38:07.8949599Z ##[error]Dependabot encountered an error performing the update',
          '2026-11-09T06:38:07.8958666Z 🤖 ~ finished: error reported to Dependabot ~',
        ].join('\n'),
      ),
    ).toBe('Dependabot encountered an error performing the update');
  });

  it('names nothing in a log with no error at all', () => {
    expect(
      updateErrorLine(
        '2026-11-09T06:38:07.0000000Z all dependencies up to date',
      ),
    ).toBeUndefined();
  });

  it(`keeps the line under ${ERROR_LINE_LIMIT} characters`, () => {
    const line = updateErrorLine(
      `2026-11-09T06:38:06.2179717Z updater | 2026/11/09 06:38:06 INFO <job_1> Handled error whilst updating x: ${'y'.repeat(400)}`,
    );
    expect(line).toHaveLength(ERROR_LINE_LIMIT);
    expect(line?.endsWith('…')).toBe(true);
  });
});

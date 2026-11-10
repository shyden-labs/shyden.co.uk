import { ERROR_LINE_LIMIT, lastErrorLine } from './deploy-failure.ts';
import { isRecord } from './is-record.ts';

/**
 * A failed Dependabot update run tells the operator (#1119; Shyden's ruling
 * 2026-11-10, "Weekly check"). Dependabot's Node job failed on 2 and 9
 * November and GitHub told no one, so CI stayed a release behind (#1117).
 * The pure half: which update runs of the last week failed, and the notice's
 * text. `scripts/dependabot-failures.mjs` reads GitHub and writes the issue.
 */

/** The title the notice is opened under, and found again by. */
export const FAILURES_TITLE = 'A Dependabot update run failed';

/** The check runs once a week, so it reads one week back. */
export const WINDOW_DAYS = 7;

/** The workflow path every Dependabot update run carries. */
const UPDATES_PATH = 'dynamic/dependabot/dependabot-updates';

export type FailedUpdate = {
  id: number;
  title: string;
  created: string;
  url: string;
};

/** A failed run as the notice names it: its log's error line, or why not. */
export type ReportedUpdate = FailedUpdate & {
  errorLine?: string;
  unread?: string;
};

/** The start of the window the check reads: `WINDOW_DAYS` before `now`. */
export const windowStart = (now: Date): Date =>
  new Date(now.getTime() - WINDOW_DAYS * 24 * 60 * 60 * 1000);

/**
 * The Dependabot update runs in GitHub's runs list (`answer`) that completed
 * as failures at or after `since`. An answer that is not a runs list throws,
 * so a check that cannot read the runs is never taken for a week with none.
 */
export const failedUpdates = (answer: unknown, since: Date): FailedUpdate[] => {
  if (!isRecord(answer) || !Array.isArray(answer.workflow_runs))
    throw new Error('the Dependabot runs are not a list');
  return answer.workflow_runs
    .filter(
      (run): run is Record<string, unknown> =>
        isRecord(run) &&
        run.path === UPDATES_PATH &&
        run.status === 'completed' &&
        run.conclusion === 'failure',
    )
    .map((run) => {
      const { id, name, created_at: created, html_url: url } = run;
      if (
        typeof id !== 'number' ||
        typeof name !== 'string' ||
        typeof created !== 'string' ||
        typeof url !== 'string'
      )
        throw new Error(
          'a failed Dependabot run has no id, name, date or link',
        );
      return { id, title: name, created, url };
    })
    .filter(({ created }) => new Date(created).getTime() >= since.getTime());
};

/** The updater's own account of a failure, after its log prefix. */
const HANDLED = /<job_\d+> (Handled error whilst updating .*)$/;

/**
 * The line of an update run's job log that names its failure: the updater's
 * last "Handled error whilst updating ..." line, which names the dependency,
 * the error type and GitHub's answer. Without one, the log's last error line
 * as a deploy's is read (`lastErrorLine`). The run's own closing banner
 * ("finished: error reported to Dependabot") names nothing, so the
 * updater's line is looked for first.
 */
export const updateErrorLine = (log: string): string | undefined => {
  const handled = log
    .split(/\r?\n/)
    .map((line) => HANDLED.exec(line)?.[1])
    .findLast((line) => line !== undefined);
  if (handled === undefined)
    return lastErrorLine(
      log
        .split(/\r?\n/)
        .filter((line) => !/finished: error reported to Dependabot/.test(line))
        .join('\n'),
    );
  return handled.length > ERROR_LINE_LIMIT
    ? `${handled.slice(0, ERROR_LINE_LIMIT - 1)}…`
    : handled;
};

const day = (iso: string) => iso.slice(0, 10);

/** The notice: one line per failed run, with its log's error line. */
export const failuresBody = (failures: ReportedUpdate[], since: Date): string =>
  [
    `Dependabot update runs that failed since ${day(since.toISOString())}:`,
    '',
    ...failures.map(({ title, url, created, errorLine, unread }) => {
      const why =
        errorLine !== undefined
          ? `\`${errorLine}\``
          : `its log could not be read (${unread ?? 'no error line found'})`;
      return `- [${title}](${url}), ${day(created)}: ${why}`;
    }),
    '',
    'A failed update leaves its dependency where it was until someone acts: read the run, fix the cause, and close this issue by hand once the next run succeeds.',
  ].join('\n');

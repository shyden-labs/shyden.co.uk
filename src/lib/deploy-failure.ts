/**
 * A develop deploy that fails opens, or comments on, one issue assigned to
 * the operator (#725), so dev never sits behind `develop` with no one told.
 * Seen on run 38219259063: Cloudflare answered a 524, `dev-verified` was
 * simply absent, and nothing said so.
 *
 * Pure: every function here works from its arguments alone, and returns a
 * value or throws. `scripts/deploy-failure.mjs` does the fetching. Node runs
 * this file by stripping its types, with no build step, so it uses erasable
 * TypeScript only, and imports only `is-record.ts`, by its full name.
 */
import { isRecord } from './is-record.ts';

/** Who the notice is assigned to. */
export const NOTICE_ASSIGNEE = 'ShydenMcM';

/** Who posts with the workflow's `GITHUB_TOKEN`. */
export const NOTICE_AUTHOR = 'github-actions[bot]';

/** The notice's title, by which a later failure finds it again. */
export const NOTICE_TITLE = 'The dev deploy failed: dev is behind develop';

/** The longest error line a notice quotes. */
export const ERROR_LINE_LIMIT = 300;

/** The job that failed, its failed step if it lists one, and its log's id. */
export type Failure = { jobId: number; job: string; step: string | undefined };

/** The two pipelines that deploy, each with the branch it deploys from (#748). */
export type Pipeline = 'dev' | 'prod';

export const PIPELINES = {
  dev: {
    ref: 'develop',
    title: NOTICE_TITLE,
    deployJob: 'deploy-dev',
    checkJob: 'verify-dev',
    site: 'Dev',
    liveSite: 'dev',
    change: 'deploy',
    opening:
      'A deploy of `develop` to dev failed, so dev.shyden.co.uk is behind `develop`.',
    closing:
      "If the cause is outside our code, dispatch `deploy-dev.yml` on develop's head (CLAUDE.md, Releasing). This issue is retired by hand once `dev-verified` is on develop's head.",
  },
  prod: {
    ref: 'main',
    title: 'A production release failed',
    deployJob: 'deploy-prod',
    checkJob: 'smoke-and-verify',
    site: 'Production',
    liveSite: 'the live site',
    change: 'release',
    opening: 'A production release from `main` failed.',
    closing:
      'A check can fail for a reason that is not the release: read the error first. Then fix forward and release again, or revert the release on `main`. This issue is retired by hand once production serves a release that passed its live check.',
  },
} as const;

/**
 * What the fall-back to the deployment live before the change did: still
 * `waiting` for approval (prod alone holds one), `restored` it, or `failed`
 * (refused at its approval, failed or cancelled). `none` when there is
 * nothing to fall back from: the deploy itself did not succeed.
 */
export type FallBack =
  | { state: 'none' }
  | { state: 'waiting' | 'restored' | 'failed'; to: string | undefined };

const resultOf = (needs: Record<string, unknown>, job: string) => {
  const need = needs[job];
  return isRecord(need) && typeof need.result === 'string'
    ? need.result
    : undefined;
};

/** The fall-back's state, read from the run's `needs` (#748). */
export const fallBackOf = (needs: unknown, pipeline: Pipeline): FallBack => {
  if (!isRecord(needs)) throw new Error('the needs are not an object of jobs');
  const { deployJob, checkJob } = PIPELINES[pipeline];
  const deploy = needs[deployJob];
  const outputs = isRecord(deploy) ? deploy.outputs : undefined;
  const before = isRecord(outputs) ? outputs.before : undefined;
  const to = typeof before === 'string' && before !== '' ? before : undefined;
  const fallBack = resultOf(needs, 'fall-back');
  if (fallBack === 'success') return { state: 'restored', to };
  if (fallBack === 'failure' || fallBack === 'cancelled')
    return { state: 'failed', to };
  if (
    fallBack === undefined &&
    resultOf(needs, deployJob) === 'success' &&
    resultOf(needs, checkJob) === 'failure'
  )
    return { state: 'waiting', to };
  return { state: 'none' };
};

/** A notice is sent when a job failed, or when a fall-back ran at all. */
export const reportNeeded = (needs: unknown): boolean => {
  if (failedNeeds(needs).length > 0) return true;
  const fallBack = resultOf(needs as Record<string, unknown>, 'fall-back');
  return fallBack !== undefined && fallBack !== 'skipped';
};

const fallBackLine = (
  fallBack: FallBack,
  pipeline: Pipeline,
  runUrl: string,
  sha: string,
): string[] => {
  if (fallBack.state === 'none') return [];
  const { site, ref, liveSite, change } = PIPELINES[pipeline];
  const deployment =
    fallBack.to === undefined
      ? 'deployment (id not recorded)'
      : `deployment \`${fallBack.to}\``;
  if (fallBack.state === 'waiting')
    return [
      `- Fall-back: waiting for approval in \`prod-rollback\`. Approving it makes ${site.toLowerCase()} serve ${deployment} again, the one live before this ${change}: ${runUrl}`,
    ];
  if (fallBack.state === 'restored')
    return [
      `- Fall-back: done. ${site} serves ${deployment} again, the one live before this ${change}, so \`${ref}\` (commit \`${sha}\`) and ${liveSite} now differ.`,
    ];
  return [
    `- Fall-back: refused or failed, so ${site.toLowerCase()} still serves the failing ${change}.`,
  ];
};

/**
 * The jobs a run's `needs` context names as failed, from the
 * `${{ toJSON(needs) }}` the report job is handed. A cancelled need is not
 * one: a run someone stopped is not an outage. Anything this cannot read
 * throws, so an unreadable context is never "nothing failed".
 */
export const failedNeeds = (needs: unknown): string[] => {
  if (!isRecord(needs)) throw new Error('the needs are not an object of jobs');
  return Object.entries(needs).flatMap(([id, need]) => {
    const result = isRecord(need) ? need.result : undefined;
    if (typeof result !== 'string')
      throw new Error(`need '${id}' has no result`);
    return result === 'failure' ? [id] : [];
  });
};

/**
 * The first failed job of a run, and its first failed step, from GitHub's
 * `GET /repos/{repo}/actions/runs/{id}/jobs` answer; `undefined` when no
 * job failed. A job's log is read by its id, so a failed job without a
 * whole-number one throws.
 */
export const failureOf = (answer: unknown): Failure | undefined => {
  const jobs = isRecord(answer) ? answer.jobs : undefined;
  if (!Array.isArray(jobs))
    throw new Error("the run's jobs answer holds no list of jobs");
  const failed = jobs.find(
    (job) => isRecord(job) && job.conclusion === 'failure',
  );
  if (!isRecord(failed)) return undefined;
  if (typeof failed.id !== 'number' || !Number.isSafeInteger(failed.id))
    throw new Error('the failed job has no numeric id');
  const steps = Array.isArray(failed.steps) ? failed.steps : [];
  const step = steps.find(
    (each) => isRecord(each) && each.conclusion === 'failure',
  );
  return {
    jobId: failed.id,
    job: String(failed.name),
    step: isRecord(step) ? String(step.name) : undefined,
  };
};

/** The runner's own closing line, which names no cause. */
const EXIT_LINE = /^Process completed with exit code \d+\.$/;

/** The timestamp the runner puts before every log line. */
const STAMP = /^\d{4}-\d\d-\d\dT[\d:.]+Z /;

/** The prefix the runner gives an error annotation. */
const ANNOTATION = '##[error]';

/**
 * The last line of a job log that names an error, without the runner's
 * timestamp or `##[error]` prefix. A line names one when the runner
 * annotated it as an error or its text says "error". The runner's own
 * `Process completed with exit code N.` is taken only when no other line
 * names one, since the line that says WHY comes before it. `undefined` when
 * nothing names an error.
 */
export const lastErrorLine = (log: string): string | undefined => {
  const naming = log
    .split(/\r?\n/)
    .map((line) => line.replace(STAMP, '').trim())
    .filter((line) => line.startsWith(ANNOTATION) || /error/i.test(line))
    .map((line) =>
      line.startsWith(ANNOTATION) ? line.slice(ANNOTATION.length) : line,
    );
  const line =
    naming.findLast((each) => !EXIT_LINE.test(each)) ?? naming.at(-1);
  if (line === undefined) return undefined;
  return line.length > ERROR_LINE_LIMIT
    ? `${line.slice(0, ERROR_LINE_LIMIT - 1)}…`
    : line;
};

/**
 * The notice's Markdown. Whatever could not be read is named in it rather
 * than left out: a notice short of a detail still tells the operator, and
 * one that names what it could not read says where to look.
 */
export const noticeBody = ({
  runUrl,
  sha,
  failure,
  errorLine,
  unread,
  pipeline = 'dev',
  fallBack = { state: 'none' },
}: {
  runUrl: string;
  sha: string;
  failure: Failure | undefined;
  errorLine: string | undefined;
  unread: string[];
  pipeline?: Pipeline;
  fallBack?: FallBack;
}): string => {
  const failed =
    failure === undefined
      ? 'not named by the run'
      : [failure.job, failure.step].filter(Boolean).join(' › ');
  const error =
    errorLine === undefined
      ? 'none read'
      : `\`${errorLine.replaceAll('`', "'")}\``;
  return [
    PIPELINES[pipeline].opening,
    '',
    `- Run: ${runUrl}`,
    `- Commit: \`${sha}\``,
    `- Failed: ${failed}`,
    `- Last error line: ${error}`,
    ...unread.map((what) => `- Could not be read: ${what}`),
    ...fallBackLine(fallBack, pipeline, runUrl, sha),
    '',
    PIPELINES[pipeline].closing,
  ].join('\n');
};

/**
 * The number of the open notice a failure comments on, from GitHub's list
 * of open issues: an issue, not a pull request, opened by `NOTICE_AUTHOR`,
 * whose title is exactly `title` (`NOTICE_TITLE` unless another notice
 * names its own, #1119). The issue tracker is public, so a
 * stranger's issue under the same title is not the notice.
 */
export const openNoticeOf = (
  issues: unknown,
  title: string = NOTICE_TITLE,
): number | undefined => {
  if (!Array.isArray(issues)) throw new Error('the open issues are not a list');
  const notice = issues.find(
    (issue) =>
      isRecord(issue) &&
      issue.state === 'open' &&
      issue.pull_request === undefined &&
      isRecord(issue.user) &&
      issue.user.login === NOTICE_AUTHOR &&
      issue.title === title &&
      typeof issue.number === 'number',
  );
  return isRecord(notice) ? Number(notice.number) : undefined;
};

/**
 * A deploy that fails (develop to dev, #725; main to production, #748) opens,
 * or comments on, one issue assigned to the operator, so no failure sits
 * unseen.
 * Seen on run 38219259063: Cloudflare answered a 524, `dev-verified` was
 * simply absent, and nothing said so.
 *
 * Pure: every function here works from its arguments alone, and returns a
 * value or throws. `scripts/deploy-failure.mjs` does the fetching. Node runs
 * this file by stripping its types, with no build step, so it uses erasable
 * TypeScript only, and imports only `is-record.ts` and `pages.ts`, by their
 * full names.
 */
import { isRecord } from './is-record.ts';
import { DEPLOYMENT_ID } from './pages.ts';

/** Who the notice is assigned to. */
export const NOTICE_ASSIGNEE = 'ShydenMcM';

/** Who posts with the workflow's `GITHUB_TOKEN`. */
export const NOTICE_AUTHOR = 'github-actions[bot]';

/** The pipelines a notice reports for, as each workflow names it in `PIPELINE`. */
export type Pipeline = 'dev' | 'prod';

/** What a notice says, per pipeline. */
export type PipelineText = {
  /** The only branch whose failures are reported. */
  ref: string;
  /** The job that records the live deployment as its `before` output. */
  deployJob: string;
  /** The title, by which a later failure finds the open notice again. */
  title: string;
  opening: string;
  closing: string;
  rolledBack: (before: string | undefined, sha: string) => string;
  rollbackFailed: (before: string | undefined) => string;
  /** `undefined` adds no line: dev's notice with no rollback is as before. */
  noRollback: (before: string | undefined) => string | undefined;
  /** Prod only: the rollback waits for the operator's approval in the run. */
  rollbackWaiting?: (before: string | undefined, runUrl: string) => string;
  /** Prod only: the rollback job never started (its approval was refused or expired). */
  rollbackNotRun?: (before: string | undefined) => string;
  /**
   * Prod only: the needs' results under which `rollback-prod` runs, as its
   * `if:` names them (a guard builds that `if:` from this).
   */
  rollbackWhen?: Readonly<Record<string, string>>;
};

const named = (before: string | undefined) =>
  before === undefined ? 'unknown' : `\`${before}\``;

const byHand = (before: string | undefined) =>
  before === undefined ? '' : ` (deployment \`${before}\`)`;

export const PIPELINES: Record<Pipeline, PipelineText> = {
  dev: {
    ref: 'develop',
    deployJob: 'deploy-dev',
    title: 'The dev deploy failed: dev is behind develop',
    opening:
      'A deploy of `develop` to dev failed, so dev.shyden.co.uk is behind `develop`.',
    closing:
      "If the cause is outside our code, dispatch `deploy-dev.yml` on develop's head (CLAUDE.md, Releasing). This issue is retired by hand once `dev-verified` is on develop's head.",
    rolledBack: (before, sha) =>
      `- Rollback: dev now serves deployment ${named(before)}, the one before this deploy, so \`develop\` (commit \`${sha}\`) and dev differ.`,
    rollbackFailed: (before) =>
      `- Rollback: the automatic rollback failed, so dev still serves the deploy that failed its check (the one before it is ${named(before)}).`,
    noRollback: () => undefined,
  },
  prod: {
    ref: 'main',
    deployJob: 'deploy-prod',
    title: 'A production release failed',
    opening: 'A production release of `main` failed.',
    closing:
      'This issue is retired by hand once production serves a release that passed its live check (`prod-verified` on its commit).',
    rolledBack: (before, sha) =>
      `- Rollback: production now serves deployment ${named(before)}, the one before this release. \`main\` (commit \`${sha}\`) and the live site now differ. Next: fix forward and redeploy \`main\`, or revert the release on \`main\`.`,
    rollbackFailed: (before) =>
      `- Rollback: the rollback FAILED, so production still serves the release that failed its check. Roll back by hand with \`rollback.yml\`${byHand(before)}.`,
    noRollback: (before) =>
      before === undefined
        ? '- Rollback: none, and the live deployment was not read before the deploy: check https://shyden.co.uk.'
        : `- Rollback: none. Nothing was deployed, or the deploy itself failed, so production should still serve deployment \`${before}\`: check https://shyden.co.uk.`,
    rollbackWaiting: (before, runUrl) =>
      `- Rollback: waiting for your approval. Approve it in ${runUrl} to put production back to deployment ${named(before)}, the one before this release, or reject it to keep this release live. Until you do, this run holds the production lock: a fix pushed to \`main\` waits behind it, and a manual \`rollback.yml\` cancels it.`,
    rollbackNotRun: (before) =>
      `- Rollback: did not run (its approval was refused or expired), so production still serves the release that failed its check. Roll back by hand with \`rollback.yml\`${byHand(before)}.`,
    rollbackWhen: { 'deploy-prod': 'success', 'smoke-and-verify': 'failure' },
  },
};

/** The workflow's `PIPELINE`, refused unless it names one. */
export const pipelineOf = (value: unknown): Pipeline => {
  if (value === 'dev' || value === 'prod') return value;
  throw new Error(`PIPELINE is ${JSON.stringify(value)}, not dev or prod`);
};

/** What a run of the script reports: a failed run, or the rollback's outcome after its approval. */
export type Report = 'failure' | 'rollback';

/** The workflow's `REPORT`, refused unless it names one. */
export const reportOf = (value: unknown): Report => {
  if (value === 'failure' || value === 'rollback') return value;
  throw new Error(
    `REPORT is ${JSON.stringify(value)}, not failure or rollback`,
  );
};

/**
 * The step both workflows roll back in (#748): the last step of dev's
 * `verify-dev`, and the step of prod's `rollback-prod`. The notice finds the
 * rollback by this name in the run's jobs.
 */
export const ROLLBACK_STEP = 'Roll back to the deployment before this deploy';

/** What became of the rollback, or that it waits for the operator's approval. */
export type Rollback =
  'rolled-back' | 'failed' | 'waiting' | 'not-run' | 'none';

/** The production job that rolls back, behind the operator's approval. */
export const ROLLBACK_JOB = 'rollback-prod';

/**
 * Whether the pipeline's rollback now waits for approval: every result its
 * `rollbackWhen` names, read from `${{ toJSON(needs) }}`. Never on dev,
 * whose rollback is a step that has already run.
 */
export const rollbackWaits = (needs: unknown, pipeline: Pipeline): boolean => {
  const when = PIPELINES[pipeline].rollbackWhen;
  return (
    when !== undefined &&
    isRecord(needs) &&
    Object.entries(when).every(([job, result]) => {
      const need = needs[job];
      return isRecord(need) && need.result === result;
    })
  );
};

/**
 * Whether the rollback job was queued at all: anything but skipped. Needs
 * that do not say count as queued, since a notice too many beats none.
 */
export const rollbackQueued = (needs: unknown): boolean => {
  const job = isRecord(needs) ? needs[ROLLBACK_JOB] : undefined;
  return !(isRecord(job) && job.result === 'skipped');
};

/**
 * The rollback's outcome, from the run's jobs answer: its step succeeded or
 * failed; or it never ran in a job that failed (a step before it, such as
 * the secrets check, stopped it), which is a failed rollback too; otherwise
 * none was attempted.
 */
export const rollbackOf = (answer: unknown): Rollback => {
  const jobs = isRecord(answer) ? answer.jobs : undefined;
  if (!Array.isArray(jobs))
    throw new Error("the run's jobs answer holds no list of jobs");
  for (const job of jobs) {
    if (!isRecord(job) || !Array.isArray(job.steps)) continue;
    const step = job.steps.find(
      (each) => isRecord(each) && each.name === ROLLBACK_STEP,
    );
    if (!isRecord(step)) continue;
    if (step.conclusion === 'success') return 'rolled-back';
    if (step.conclusion === 'failure' || job.conclusion === 'failure')
      return 'failed';
    return 'none';
  }
  return 'none';
};

/**
 * The outcome once the queued rollback job is done: as `rollbackOf` reads
 * it, except that no rollback step at all means the job never started (its
 * approval was refused or expired).
 */
export const rollbackAfter = (answer: unknown): Rollback => {
  const outcome = rollbackOf(answer);
  return outcome === 'none' ? 'not-run' : outcome;
};

/**
 * The live deployment the deploy job recorded before it changed anything,
 * from `${{ toJSON(needs) }}`; `undefined` when none was recorded, or it is
 * not in a deployment id's shape (it goes into the notice's text).
 */
export const beforeOf = (
  needs: unknown,
  pipeline: Pipeline,
): string | undefined => {
  const job = isRecord(needs)
    ? needs[PIPELINES[pipeline].deployJob]
    : undefined;
  const outputs = isRecord(job) ? job.outputs : undefined;
  const before = isRecord(outputs) ? outputs.before : undefined;
  return typeof before === 'string' && DEPLOYMENT_ID.test(before)
    ? before
    : undefined;
};

/** The longest error line a notice quotes. */
export const ERROR_LINE_LIMIT = 300;

/** The job that failed, its failed step if it lists one, and its log's id. */
export type Failure = { jobId: number; job: string; step: string | undefined };

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
  pipeline,
  runUrl,
  sha,
  failure,
  errorLine,
  unread,
  rollback,
  before,
}: {
  pipeline: Pipeline;
  runUrl: string;
  sha: string;
  failure: Failure | undefined;
  errorLine: string | undefined;
  unread: string[];
  /** `undefined` when the run's jobs could not be read. */
  rollback: Rollback | undefined;
  before: string | undefined;
}): string => {
  const text = PIPELINES[pipeline];
  const failed =
    failure === undefined
      ? 'not named by the run'
      : [failure.job, failure.step].filter(Boolean).join(' › ');
  const error =
    errorLine === undefined
      ? 'none read'
      : `\`${errorLine.replaceAll('`', "'")}\``;
  const prodOnly = <T>(line: T | undefined): T => {
    if (line === undefined)
      throw new Error(
        `the ${pipeline} notice has no "${rollback}" rollback line`,
      );
    return line;
  };
  const rolled =
    rollback === 'rolled-back'
      ? text.rolledBack(before, sha)
      : rollback === 'failed'
        ? text.rollbackFailed(before)
        : rollback === 'waiting'
          ? prodOnly(text.rollbackWaiting)(before, runUrl)
          : rollback === 'not-run'
            ? prodOnly(text.rollbackNotRun)(before)
            : rollback === 'none'
              ? text.noRollback(before)
              : undefined;
  return [
    text.opening,
    '',
    `- Run: ${runUrl}`,
    `- Commit: \`${sha}\``,
    `- Failed: ${failed}`,
    `- Last error line: ${error}`,
    ...unread.map((what) => `- Could not be read: ${what}`),
    ...(rolled === undefined ? [] : [rolled]),
    '',
    text.closing,
  ].join('\n');
};

/**
 * The number of the open notice a failure comments on, from GitHub's list
 * of open issues: an issue, not a pull request, opened by `NOTICE_AUTHOR`,
 * whose title is exactly `title`. The issue tracker is public, so a
 * stranger's issue under the same title is not the notice.
 */
export const openNoticeOf = (
  issues: unknown,
  title: string,
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

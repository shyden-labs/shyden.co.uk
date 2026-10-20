/**
 * The waiting-reports count (#349): how many translation reports wait in the
 * production `reports` table, read from Cloudflare's D1 API and told to the
 * operator as at most one count a day, on one issue, on days any wait.
 *
 * Pure: every function here works from its arguments alone, and returns a
 * value or throws. `scripts/waiting-reports.mjs` does the fetching. Node runs
 * this file by stripping its types, with no build step, so it uses erasable
 * TypeScript only (no enums, namespaces or parameter properties), and imports
 * only `is-record.ts`, which imports nothing, by its full name.
 *
 * Anything this cannot read as a count is an error, never a zero: a zero
 * sends nothing, so a misread zero would silence the notice with no one the
 * wiser.
 */
import { isRecord } from './is-record.ts';

/** The production database. `shyden-reports-dev` is never counted. */
export const REPORTS_DATABASE = 'shyden-reports';

export const COUNT_SQL = 'SELECT count(*) FROM reports';

/** Holds no digit, so no reading of it can pass for a count. */
export const FAILURE_NOTICE = 'The waiting-reports count could not be read.';

/** The workflow a schedule starts on `main` (#877), asked for when it cannot. */
export const WORKFLOW_FILE = '.github/workflows/waiting-reports.yml';

/**
 * The notice for a start that failed because `main` lacks the workflow (#882):
 * until the first release puts it there, that is every scheduled run. Holds no
 * digit, as the failure notice does not.
 */
export const NOT_ON_MAIN_NOTICE =
  'The waiting-reports count was not started: `main` has no ' +
  `\`${WORKFLOW_FILE}\`, so the scheduled run could not start it, and no ` +
  'count was read. Until the first release puts the file on `main`, this is ' +
  'expected.';

/**
 * The failure notice, given the HTTP status GitHub answered when asked for
 * `WORKFLOW_FILE` on `main`, or `undefined` when it gave none. Only a 404 says
 * the file is missing; any other answer, or none, posts the ordinary notice,
 * so a check that itself fails still reports.
 */
export const failureNoticeFor = (workflowStatus: number | undefined): string =>
  workflowStatus === 404 ? NOT_ON_MAIN_NOTICE : FAILURE_NOTICE;

/** Who posts with the workflow's `GITHUB_TOKEN`. */
export const NOTICE_AUTHOR = 'github-actions[bot]';

/** Each Cloudflare and GitHub request gives up after this long. */
export const REQUEST_TIMEOUT_MS = 30_000;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/**
 * The code and message of each entry in an answer's `errors` list, for a
 * failure's text. Nothing this job asks either side for holds a report's
 * content, so no error about it can carry one into the public log.
 */
export const errorsIn = (answer: unknown): string => {
  const errors = isRecord(answer) ? answer.errors : undefined;
  if (!Array.isArray(errors) || errors.length === 0) return '';
  const each = errors.map((error) =>
    isRecord(error)
      ? `${String(error.code)} ${String(error.message)}`
      : JSON.stringify(error),
  );
  return ` (${each.join('; ')})`;
};

/** A Cloudflare answer's `result`, once its envelope says it succeeded. */
const resultOf = (answer: unknown, what: string): unknown => {
  if (!isRecord(answer)) throw new Error(`${what} is not a JSON object`);
  if (answer.success !== true)
    throw new Error(
      `${what} says success: ${JSON.stringify(answer.success)}${errorsIn(answer)}`,
    );
  return answer.result;
};

/**
 * The id of the one database named exactly `shyden-reports`, from the D1
 * list endpoint's answer. The endpoint's `name` filter is undocumented as to
 * whether it matches exactly, so its answer is filtered again here. The id
 * is checked against the UUID shape because it goes into a URL path.
 */
export const databaseIdFrom = (list: unknown): string => {
  const result = resultOf(list, 'the D1 database list');
  if (!Array.isArray(result))
    throw new Error('the D1 database list holds no list of databases');
  const named = result.filter(
    (database) => isRecord(database) && database.name === REPORTS_DATABASE,
  );
  if (named.length !== 1)
    throw new Error(
      `the D1 database list holds ${named.length} databases named ` +
        `${REPORTS_DATABASE}, not exactly 1`,
    );
  const [database] = named;
  const uuid = isRecord(database) ? database.uuid : undefined;
  if (typeof uuid !== 'string' || !UUID.test(uuid))
    throw new Error(`${REPORTS_DATABASE} has no uuid in the D1 database list`);
  return uuid;
};

/** The count from the D1 query endpoint's answer to `COUNT_SQL`. */
export const countFrom = (answer: unknown): number => {
  const result = resultOf(answer, 'the D1 query');
  const statement = Array.isArray(result) ? result[0] : undefined;
  if (!isRecord(statement))
    throw new Error('the D1 query answered no statement');
  if (statement.success === false)
    throw new Error(`the D1 query's statement failed${errorsIn(answer)}`);
  const rows = statement.results;
  if (!Array.isArray(rows) || rows.length !== 1 || !isRecord(rows[0]))
    throw new Error('the D1 query did not answer exactly one row');
  const count = rows[0]['count(*)'];
  if (typeof count !== 'number' || !Number.isSafeInteger(count) || count < 0)
    throw new Error(
      `the D1 query's count is ${JSON.stringify(count)}, not a whole number`,
    );
  return count;
};

/** The day's comment for `count`, or `null` when there is nothing to say. */
export const noticeFor = (count: number): string | null => {
  if (count === 0) return null;
  return count === 1
    ? '1 translation report is waiting.'
    : `${count} translation reports are waiting.`;
};

/** Whether `body` is a count notice, spelled exactly as `noticeFor` spells it. */
const isCountNotice = (body: unknown): boolean => {
  if (typeof body !== 'string') return false;
  const digits = /^([1-9]\d*) /.exec(body)?.[1];
  return digits !== undefined && noticeFor(Number(digits)) === body;
};

/** Midnight UTC on `now`'s day, as the ISO time GitHub's `since` takes. */
export const startOfUtcDay = (now: Date): string =>
  `${now.toISOString().slice(0, 10)}T00:00:00Z`;

/** The UTC day of an ISO time, or `undefined` when it is not one. */
const utcDayOf = (time: unknown): string | undefined => {
  const at = typeof time === 'string' ? Date.parse(time) : Number.NaN;
  return Number.isNaN(at) ? undefined : new Date(at).toISOString().slice(0, 10);
};

/**
 * Whether `NOTICE_AUTHOR` has already posted a count on `now`'s UTC day, from
 * the issue's comments as GitHub lists them. A failure notice, or a count
 * posted by anyone else, does not count, so a re-run after a failed morning
 * still reports.
 *
 * A comment this cannot read as the bot's count is simply not one. The issue
 * is public: a stranger's comment, or one whose author's account was deleted,
 * must not stop every day's count from then on. Only a list this cannot read
 * throws, rather than risk a second count or none.
 */
export const postedToday = (comments: unknown, now: Date): boolean => {
  if (!Array.isArray(comments))
    throw new Error("the issue's comments are not a list");
  const today = now.toISOString().slice(0, 10);
  return comments.some(
    (comment) =>
      isRecord(comment) &&
      isRecord(comment.user) &&
      comment.user.login === NOTICE_AUTHOR &&
      isCountNotice(comment.body) &&
      utcDayOf(comment.created_at) === today,
  );
};

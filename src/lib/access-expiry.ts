/**
 * The Access service token expiry check (#796): every Cloudflare Access
 * service token's expiry, read from Cloudflare's API, and one issue per token
 * per expiry date, assigned to the operator, from `WARN_DAYS` before it.
 *
 * Pure: every function here works from its arguments alone, and returns a
 * value or throws. `scripts/access-expiry.mjs` does the fetching. Node runs
 * this file by stripping its types, with no build step, so it uses erasable
 * TypeScript only (no enums, namespaces or parameter properties), and imports
 * only `is-record.ts` and `cloudflare-envelope.ts`, by their full names.
 *
 * Anything this cannot read as every token's expiry is an error, never an
 * empty result: nothing due sends nothing, so a misread list would silence
 * the warning with no one the wiser.
 */
import { isRecord } from './is-record.ts';
import { resultOf } from './cloudflare-envelope.ts';

/**
 * How far ahead a token is warned about. The issue asks for at least 30 days;
 * a daily check warning at exactly 30 would miss that on its first failed
 * run, so 45 leaves fifteen failed days of margin.
 */
export const WARN_DAYS = 45;

/** Who opens the issues, with the workflow's `GITHUB_TOKEN`. */
export const ISSUE_AUTHOR = 'github-actions[bot]';

/** Who every issue is assigned to. */
export const ASSIGNEE = 'ShydenMcM';

/** Each Cloudflare and GitHub request gives up after this long. */
export const REQUEST_TIMEOUT_MS = 30_000;

/** Holds no digit and no token name, so every failure lands on one issue. */
export const FAILURE_TITLE =
  'The Access service token expiry check could not run';

const DAY_MS = 86_400_000;

/** A full ISO time with a zone: nothing looser `Date.parse` would accept. */
const ISO_TIME =
  /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/;

/** One line holding something besides spaces. */
const NAME = /^[^\r\n]*\S[^\r\n]*$/;

export type WatchedToken = { name: string; expiresAt: Date };

/**
 * The moment an `expires_at` names, or `undefined` when it names none. V8
 * rolls an impossible date over (`2027-02-30` is read as 2 March, hour 24 as
 * the next midnight), so the written fields must survive a round trip too.
 */
const instantOf = (raw: unknown): Date | undefined => {
  const parts = typeof raw === 'string' ? ISO_TIME.exec(raw) : null;
  if (parts === null) return undefined;
  const [year, month, day, hour, minute, second] = parts
    .slice(1, 7)
    .map(Number);
  const wall = new Date(Date.UTC(year, month - 1, day, hour, minute, second));
  const written =
    wall.getUTCFullYear() === year &&
    wall.getUTCMonth() === month - 1 &&
    wall.getUTCDate() === day &&
    wall.getUTCHours() === hour &&
    wall.getUTCMinutes() === minute &&
    wall.getUTCSeconds() === second;
  return written ? new Date(String(raw)) : undefined;
};

/**
 * Every token's name and expiry, from Cloudflare's service token list. An
 * empty list, a second page, a nameless token or an unreadable expiry
 * throws: each would leave a token unwatched.
 */
export const tokensFrom = (answer: unknown): WatchedToken[] => {
  const what = 'the Access service token list';
  const result = resultOf(answer, what);
  if (!Array.isArray(result))
    throw new Error(`${what} holds no list of tokens`);
  const info = isRecord(answer) ? answer.result_info : undefined;
  const pages = isRecord(info) ? info.total_pages : undefined;
  if (pages !== 1)
    throw new Error(
      `${what} says total_pages: ${JSON.stringify(pages)}, not 1`,
    );
  return result.map((token, index) => {
    const name = isRecord(token) ? token.name : undefined;
    if (typeof name !== 'string' || !NAME.test(name))
      throw new Error(
        `token ${index + 1} of ${result.length} in ${what} has no name`,
      );
    const raw = isRecord(token) ? token.expires_at : undefined;
    const expiresAt = instantOf(raw);
    if (expiresAt === undefined)
      throw new Error(
        `the Access service token ${name} has no readable expires_at ` +
          `(${JSON.stringify(raw)})`,
      );
    return { name, expiresAt };
  });
};

/** The tokens expiring within `WARN_DAYS` of `now`, or already expired. */
export const dueSoon = (tokens: WatchedToken[], now: Date): WatchedToken[] =>
  tokens.filter(
    ({ expiresAt }) =>
      expiresAt.getTime() - now.getTime() <= WARN_DAYS * DAY_MS,
  );

const dayOf = (at: Date) => at.toISOString().slice(0, 10);
const minuteOf = (at: Date) => at.toISOString().slice(0, 16).replace('T', ' ');

/** A warning's title: the one issue per token per expiry date is found by it. */
export const titleFor = (token: WatchedToken): string =>
  `The Access service token ${token.name} expires on ${dayOf(token.expiresAt)}`;

/** A warning's body: when, and where the rotation is written down. */
export const bodyFor = (token: WatchedToken, now: Date): string => {
  const left = token.expiresAt.getTime() - now.getTime();
  const days = Math.floor(left / DAY_MS);
  const at = `${minuteOf(token.expiresAt)} UTC`;
  const ahead = days === 1 ? '1 day' : `${days} days`;
  const when =
    left <= 0
      ? `expired at ${at}, before this check`
      : days === 0
        ? `expires at ${at}, within a day of this check`
        : `expires at ${at}, ${ahead} after this check`;
  return (
    `The Cloudflare Access service token \`${token.name}\` ${when}.\n\n` +
    'Rotate it as docs/runbooks/cloudflare-access.md says under ' +
    '"Rotating a service token", then close this issue.'
  );
};

/**
 * The issues `ISSUE_AUTHOR` opened, pull requests left out. The repository is
 * public: a stranger's issue under a warning's title must not silence it.
 * Only a list this cannot read throws.
 */
const botIssues = (issues: unknown): Record<string, unknown>[] => {
  if (!Array.isArray(issues))
    throw new Error("the repository's issues are not a list");
  return issues.filter(
    (issue): issue is Record<string, unknown> =>
      isRecord(issue) &&
      !('pull_request' in issue) &&
      isRecord(issue.user) &&
      issue.user.login === ISSUE_AUTHOR,
  );
};

/**
 * The titles in `wanted` no bot issue carries yet, each once. A closed
 * warning counts: once rotated and closed, the same expiry is not raised
 * again, and a new expiry date is a new title.
 */
export const missingTitles = (wanted: string[], issues: unknown): string[] => {
  const opened = new Set(botIssues(issues).map(({ title }) => title));
  return [...new Set(wanted)].filter((title) => !opened.has(title));
};

/** The number of the bot's open failure issue, if there is one. */
export const openFailureIssue = (issues: unknown): number | undefined => {
  const open = botIssues(issues).find(
    ({ title, state }) => title === FAILURE_TITLE && state === 'open',
  );
  return typeof open?.number === 'number' ? open.number : undefined;
};

/**
 * Whether an issue GitHub answered with went to `ASSIGNEE`. GitHub can drop
 * an assignee it will not accept and still open the issue, which would warn
 * no one.
 */
export const assigned = (issue: unknown): boolean =>
  isRecord(issue) &&
  Array.isArray(issue.assignees) &&
  issue.assignees.some((who) => isRecord(who) && who.login === ASSIGNEE);

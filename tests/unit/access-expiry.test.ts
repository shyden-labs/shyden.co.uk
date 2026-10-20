import { describe, expect, it } from 'vitest';
import {
  ASSIGNEE,
  ISSUE_AUTHOR,
  NOT_ON_MAIN_NOTICE,
  REQUEST_TIMEOUT_MS,
  WARN_DAYS,
  assigned,
  dueSoon,
  failureBodyFor,
  missingTitles,
  openFailureIssue,
  tokensFrom,
  type WatchedToken,
} from '../../src/lib/access-expiry';
import { PROD_SANITY, tokenList } from '../access-expiry-shared';

/**
 * The Access service token expiry check (#796). Every token is watched, and
 * an answer that cannot be read as every token's expiry THROWS: a list read
 * as "nothing due" would silence the warning with no one the wiser. The
 * sentences it posts in public are the logs suite's (#822).
 */

const EXPIRES = new Date('2027-10-15T23:55:00Z');
const DAY_MS = 86_400_000;
const token = (expiresAt: Date, name = 'prod-sanity-2'): WatchedToken => ({
  name,
  expiresAt,
});
const issue = (fields: Record<string, unknown>) => ({
  number: 12,
  state: 'closed',
  title: 'The Access service token prod-sanity-2 expires on 2027-10-15',
  user: { login: 'github-actions[bot]' },
  ...fields,
});
const WANTED = 'The Access service token prod-sanity-2 expires on 2027-10-15';

describe('the constants are pinned to their literal values', () => {
  it('warns 45 days ahead, as the bot, to ShydenMcM, giving up after 30s', () => {
    expect(WARN_DAYS).toBe(45);
    expect(ISSUE_AUTHOR).toBe('github-actions[bot]');
    expect(ASSIGNEE).toBe('ShydenMcM');
    expect(REQUEST_TIMEOUT_MS).toBe(30_000);
  });
});

// A schedule whose start on `main` fails asks GitHub for the workflow file on
// `main` first (#882). Until the release puts it there, the failure is
// expected; and while `main` lacks the waiting-reports workflow too, that
// count's daily notice on #360 already says so, and one notice a day is
// enough (Shyden, 2026-10-20), so nothing is posted.
describe('failureBodyFor', () => {
  const RUN = 'https://github.com/o/r/actions/runs/1';

  it('posts nothing while main lacks this workflow and the shared one alike', () => {
    expect(failureBodyFor(404, 404, RUN)).toBeNull();
  });

  it.each([[200], [500], [undefined]])(
    'puts the not-on-main notice above the run when only this workflow is missing (shared: %s)',
    (shared) => {
      expect(failureBodyFor(404, shared, RUN)).toBe(
        `${NOT_ON_MAIN_NOTICE}\n\n${RUN}`,
      );
    },
  );

  it.each([[200], [403], [500], [undefined]])(
    'is the run alone on %s, so a failed check still reports',
    (status) => {
      expect(failureBodyFor(status, undefined, RUN)).toBe(RUN);
    },
  );
});

describe('tokensFrom reads every token, or throws', () => {
  it('reads each token as its name and expiry', () => {
    expect(tokensFrom(tokenList([PROD_SANITY]))).toEqual([token(EXPIRES)]);
  });

  it('throws on an empty list, which watches nothing', () => {
    expect(() => tokensFrom(tokenList([]))).toThrow(
      'the Access service token list is empty, so no token can be watched',
    );
  });

  it.each([
    ['no result_info', undefined, 'total_pages: undefined, not 1'],
    ['a second page', 2, 'total_pages: 2, not 1'],
  ])('throws on %s, since a token may be unread', (_, pages, message) => {
    const answer: Record<string, unknown> = tokenList([PROD_SANITY], pages);
    if (pages === undefined) delete answer.result_info;
    expect(() => tokensFrom(answer)).toThrow(message);
  });

  it('throws when the envelope says success: false', () => {
    expect(() =>
      tokensFrom({ ...tokenList([PROD_SANITY]), success: false }),
    ).toThrow('the Access service token list says success: false');
  });

  it.each([
    ['a missing name', { expires_at: PROD_SANITY.expires_at }],
    ['a blank name', { ...PROD_SANITY, name: '  ' }],
    ['a name over two lines', { ...PROD_SANITY, name: 'prod\nsanity' }],
  ])('throws on %s', (_, fields) => {
    expect(() => tokensFrom(tokenList([fields]))).toThrow(
      'token 1 of 1 in the Access service token list has no name',
    );
  });

  it.each([
    ['missing', undefined],
    ['null', null],
    ['a bare year', '2027'],
    ['a loose date', 'Oct 15 2027'],
    ['a date with no time', '2027-10-15'],
    ['an empty string', ''],
    // V8 rolls both of these over to a real moment rather than refusing them.
    ['an impossible day', '2027-02-30T00:00:00Z'],
    ['hour 24', '2027-10-15T24:00:00Z'],
  ])('throws on an expires_at that is %s', (_, expiresAt) => {
    expect(() =>
      tokensFrom(tokenList([{ ...PROD_SANITY, expires_at: expiresAt }])),
    ).toThrow(
      `the Access service token prod-sanity-2 has no readable expires_at (${JSON.stringify(expiresAt)})`,
    );
  });

  it('reads an expiry written with an offset as the same moment', () => {
    expect(
      tokensFrom(
        tokenList([
          { ...PROD_SANITY, expires_at: '2027-10-16T06:55:00+07:00' },
        ]),
      ),
    ).toEqual([token(EXPIRES)]);
  });
});

describe('dueSoon keeps the tokens within 45 days', () => {
  const now = new Date(EXPIRES.getTime() - 45 * DAY_MS);

  it('keeps a token expiring exactly 45 days later', () => {
    expect(dueSoon([token(EXPIRES)], now)).toEqual([token(EXPIRES)]);
  });

  // The token at the boundary rides along, so an empty answer cannot pass.
  it('leaves a token expiring 45 days and 1 ms later', () => {
    const later = token(new Date(EXPIRES.getTime() + 1), 'later');
    expect(dueSoon([later, token(EXPIRES)], now)).toEqual([token(EXPIRES)]);
  });

  it('keeps a token that has already expired', () => {
    const gone = token(new Date(now.getTime() - DAY_MS));
    expect(dueSoon([gone], now)).toEqual([gone]);
  });
});

describe('missingTitles finds the warnings not yet opened', () => {
  it.each([
    ['a closed bot issue', issue({})],
    ['an open bot issue', issue({ state: 'open' })],
    // A second title no issue carries rides along, so an empty answer cannot pass.
  ])('counts %s as opened', (_, existing) => {
    const other = 'The Access service token other expires on 2027-11-01';
    expect(missingTitles([WANTED, other], [existing])).toEqual([other]);
  });

  it.each([
    ['a stranger', issue({ user: { login: 'someone-else' } })],
    ['a pull request', issue({ pull_request: { url: 'x' } })],
    ['an issue with no author', issue({ user: null })],
  ])('does not count the same title from %s', (_, existing) => {
    expect(missingTitles([WANTED], [existing])).toEqual([WANTED]);
  });

  it('names a title wanted twice once', () => {
    expect(missingTitles([WANTED, WANTED], [])).toEqual([WANTED]);
  });

  it('throws on issues that are not a list', () => {
    expect(() => missingTitles([WANTED], {})).toThrow(
      "the repository's issues are not a list",
    );
  });
});

describe('openFailureIssue finds the open failure issue', () => {
  const failure = (fields: Record<string, unknown>) =>
    issue({
      number: 7,
      state: 'open',
      title: 'The Access service token expiry check could not run',
      ...fields,
    });

  it("gives the open bot issue's number", () => {
    expect(openFailureIssue([failure({})])).toBe(7);
  });

  it.each([
    ['closed', failure({ state: 'closed' })],
    ["a stranger's", failure({ user: { login: 'someone-else' } })],
  ])('passes over one that is %s', (_, existing) => {
    expect(openFailureIssue([existing])).toBeUndefined();
  });
});

describe('assigned reads who an opened issue went to', () => {
  it('is true with ShydenMcM among the assignees', () => {
    expect(assigned({ assignees: [{ login: 'ShydenMcM' }] })).toBe(true);
  });

  it.each([
    ['no assignees', { assignees: [] }],
    ['someone else', { assignees: [{ login: 'shyden' }] }],
    ['no assignees field', {}],
  ])('is false with %s', (_, answer) => {
    expect(assigned(answer)).toBe(false);
  });
});

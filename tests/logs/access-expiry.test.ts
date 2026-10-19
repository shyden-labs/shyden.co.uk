/**
 * The Access service token expiry check (#796) opens issues on a public
 * repository, so every sentence it can post is pinned here, before every
 * release, with nothing in it but a token's name and expiry. The unit suite
 * keeps the reading of tokens and issues (tests/unit/access-expiry.test.ts).
 */
import { describe, expect, it } from 'vitest';
import {
  FAILURE_TITLE,
  bodyFor,
  titleFor,
  tokensFrom,
} from '../../src/lib/access-expiry';
import { PROD_SANITY, tokenList } from '../access-expiry-shared';

const DAY_MS = 86_400_000;
const [prodSanity] = tokensFrom(tokenList([PROD_SANITY]));
const before = (ms: number) => new Date(prodSanity.expiresAt.getTime() - ms);
const ROTATE =
  'Rotate it as docs/runbooks/cloudflare-access.md says under ' +
  '"Rotating a service token", then close this issue.';

describe('the titles it opens issues under', () => {
  it('the failure title is one fixed sentence holding no digit', () => {
    expect(FAILURE_TITLE).toBe(
      'The Access service token expiry check could not run',
    );
    expect(FAILURE_TITLE).not.toMatch(/\d/);
  });

  it("a warning's title names the token and its expiry day", () => {
    expect(titleFor(prodSanity)).toBe(
      'The Access service token prod-sanity-2 expires on 2027-10-15',
    );
  });
});

describe("a warning's body says when, and how to rotate", () => {
  it.each([
    [
      '40 days ahead',
      40 * DAY_MS,
      'expires at 2027-10-15 23:55 UTC, 40 days after this check',
    ],
    [
      'one day ahead',
      DAY_MS + 60_000,
      'expires at 2027-10-15 23:55 UTC, 1 day after this check',
    ],
    [
      'within the day',
      3_600_000,
      'expires at 2027-10-15 23:55 UTC, within a day of this check',
    ],
    ['at expiry', 0, 'expired at 2027-10-15 23:55 UTC, before this check'],
    [
      'after expiry',
      -DAY_MS,
      'expired at 2027-10-15 23:55 UTC, before this check',
    ],
  ])('%s', (_, ahead, when) => {
    expect(bodyFor(prodSanity, before(ahead))).toBe(
      `The Cloudflare Access service token \`prod-sanity-2\` ${when}.\n\n${ROTATE}`,
    );
  });

  it('holds no client id, secret-shaped string or Cloudflare id', () => {
    const body = bodyFor(prodSanity, before(40 * DAY_MS));
    expect(body).not.toMatch(
      /client|secret|[0-9a-f]{32}|[0-9a-f]{8}-[0-9a-f]{4}/i,
    );
  });
});

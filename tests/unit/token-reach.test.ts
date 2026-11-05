import { describe, expect, it } from 'vitest';
import { reachVerdict } from '../../scripts/token-reach.mjs';

/**
 * Every dev deploy re-proves that the dev token reaches the dev account and
 * nothing else (#415 AC7, the operator's choice of 2026-10-02). The verdict
 * reads Cloudflare's `GET /accounts` answer for that token, and every answer
 * that does not show exactly the dev account, all of it, refuses the deploy.
 * The bodies below are the shape Cloudflare's v4 API returns.
 */
const DEV = '0123456789abcdef0123456789abcdef';
const OTHER = 'fedcba9876543210fedcba9876543210';

const listing = (ids: string[], totalCount = ids.length) => ({
  success: true,
  errors: [],
  result: ids.map((id) => ({ id, name: `account ${id.slice(0, 4)}` })),
  result_info: {
    page: 1,
    per_page: 50,
    count: ids.length,
    total_count: totalCount,
  },
});

describe('the dev token reaches the dev account and nothing else (#415)', () => {
  it('passes a listing of exactly the dev account', () => {
    expect(reachVerdict(listing([DEV]), DEV)).toEqual({
      ok: true,
      reason: 'the token reaches 1 account, the dev one',
    });
  });

  it('refuses a token that also reaches another account', () => {
    expect(reachVerdict(listing([DEV, OTHER]), DEV)).toEqual({
      ok: false,
      reason:
        'the token reaches 2 accounts; it must reach the dev account alone',
    });
  });

  it('refuses a token whose one account is not the dev one', () => {
    expect(reachVerdict(listing([OTHER]), DEV)).toEqual({
      ok: false,
      reason: 'the token reaches 1 account, and it is not the dev one',
    });
  });

  it('refuses an empty listing, which proves nothing about what it reaches', () => {
    expect(reachVerdict(listing([]), DEV)).toEqual({
      ok: false,
      reason:
        'the token lists no account, so what it reaches is unproven; a dev token must list the dev account',
    });
  });

  it('refuses a listing with more pages than it returned', () => {
    expect(reachVerdict(listing([DEV], 2), DEV)).toEqual({
      ok: false,
      reason:
        'the token reaches 2 accounts; it must reach the dev account alone',
    });
  });

  it("refuses Cloudflare's own refusal, quoting it", () => {
    expect(
      reachVerdict(
        {
          success: false,
          errors: [{ code: 9109, message: 'Invalid access token' }],
          result: null,
        },
        DEV,
      ),
    ).toEqual({
      ok: false,
      reason: 'Cloudflare refused the listing: 9109 Invalid access token',
    });
  });

  it('refuses a body that is not a Cloudflare listing', () => {
    expect(reachVerdict('<html>bad gateway</html>', DEV)).toEqual({
      ok: false,
      reason: 'the answer is not a Cloudflare account listing',
    });
  });
});

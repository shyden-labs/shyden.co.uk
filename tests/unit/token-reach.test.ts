import { describe, expect, it } from 'vitest';
import { reachVerdict } from '../../scripts/token-reach.mjs';

/**
 * Every dev deploy re-proves that the dev token reaches the dev account and
 * nothing else (#415 AC7, the operator's choice of 2026-10-02). The verdict
 * reads Cloudflare's `GET /accounts` answer for that token, and every answer
 * that does not show exactly the dev account, all of it, refuses the deploy.
 *
 * Which account is "the dev one" is known apart from the secrets the token
 * sits beside (#501): a repository variable outside the `dev` environment
 * (Shyden's ruling, 2026-11-20). So production's token and account id pasted
 * into `dev` together, one mistake in the secrets form, are refused too.
 * The bodies below are the shape Cloudflare's v4 API returns.
 */
const DEV = '0123456789abcdef0123456789abcdef';
const PROD = 'fedcba9876543210fedcba9876543210';

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

describe('the dev token reaches the dev account and nothing else (#415, #501)', () => {
  it('passes a listing of exactly the dev account, configured as the dev account', () => {
    expect(reachVerdict(listing([DEV]), DEV, DEV)).toEqual({
      ok: true,
      reason: 'the token reaches 1 account, the dev one',
    });
  });

  it("refuses production's token and account id pasted into dev together", () => {
    expect(reachVerdict(listing([PROD]), DEV, PROD)).toEqual({
      ok: false,
      reason:
        'the account configured beside the token (fedc…) is not the dev account (0123…)',
    });
  });

  it('refuses a token whose one account is not the dev one', () => {
    expect(reachVerdict(listing([PROD]), DEV, DEV)).toEqual({
      ok: false,
      reason:
        'the token reaches 1 account (fedc…), and it is not the dev account (0123…)',
    });
  });

  it('never prints either account id in full', () => {
    const { reason } = reachVerdict(listing([PROD]), DEV, PROD);
    expect(reason).not.toContain(DEV);
    expect(reason).not.toContain(PROD);
  });

  it('refuses a token that also reaches another account', () => {
    expect(reachVerdict(listing([DEV, PROD]), DEV, DEV)).toEqual({
      ok: false,
      reason:
        'the token reaches 2 accounts; it must reach the dev account alone',
    });
  });

  it('refuses an empty listing, which proves nothing about what it reaches', () => {
    expect(reachVerdict(listing([]), DEV, DEV)).toEqual({
      ok: false,
      reason:
        'the token lists no account, so what it reaches is unproven; a dev token must list the dev account',
    });
  });

  it('refuses a listing with more pages than it returned', () => {
    expect(reachVerdict(listing([DEV], 2), DEV, DEV)).toEqual({
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
        DEV,
      ),
    ).toEqual({
      ok: false,
      reason: 'Cloudflare refused the listing: 9109 Invalid access token',
    });
  });

  it('refuses a body that is not a Cloudflare listing', () => {
    expect(reachVerdict('<html>bad gateway</html>', DEV, DEV)).toEqual({
      ok: false,
      reason: 'the answer is not a Cloudflare account listing',
    });
  });
});

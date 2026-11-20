import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { main, reachVerdict } from '../../scripts/token-reach.mjs';

/**
 * Every dev deploy re-proves that the dev token reaches the dev account and
 * nothing else (#415 AC7, the operator's choice of 2026-10-02). The verdict
 * reads Cloudflare's `GET /accounts` answer for that token, and every answer
 * that does not show exactly the dev account, all of it, refuses the deploy.
 *
 * Which account is the dev one is known apart from the secrets the token sits
 * beside (#501): `DEV_CLOUDFLARE_ACCOUNT_ID`, a repository variable outside
 * the `dev` environment (Shyden's ruling, 2026-11-20). So production's token
 * and account id pasted into `dev` together are refused as well.
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
        'the account id stored beside the token (fedc…) is not the dev account (0123…)',
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
    for (const [body, stored] of [
      [listing([PROD]), PROD],
      [listing([PROD]), DEV],
    ] as const) {
      const { reason } = reachVerdict(body, DEV, stored);
      expect(reason).not.toContain(DEV);
      expect(reason).not.toContain(PROD);
    }
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

describe('the dev deploy step that runs the check (#501)', () => {
  const USAGE =
    'usage: CLOUDFLARE_API_TOKEN=… CLOUDFLARE_ACCOUNT_ID=… DEV_CLOUDFLARE_ACCOUNT_ID=… node scripts/token-reach.mjs';
  let errors: string[];
  let logs: string[];
  let fetch: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    errors = [];
    logs = [];
    vi.spyOn(console, 'error').mockImplementation((line) => {
      errors.push(String(line));
    });
    vi.spyOn(console, 'log').mockImplementation((line) => {
      logs.push(String(line));
    });
    fetch = vi.fn();
    vi.stubGlobal('fetch', fetch);
    vi.stubEnv('CLOUDFLARE_API_TOKEN', 'a-dev-token');
    vi.stubEnv('CLOUDFLARE_ACCOUNT_ID', DEV);
    vi.stubEnv('DEV_CLOUDFLARE_ACCOUNT_ID', DEV);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  const answers = (body: unknown) =>
    fetch.mockResolvedValue(new Response(JSON.stringify(body)));

  it('refuses with the usage, asking Cloudflare nothing, when the dev account is not given', async () => {
    vi.stubEnv('DEV_CLOUDFLARE_ACCOUNT_ID', '');
    expect(await main()).toBe(1);
    expect(errors).toEqual([USAGE]);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('refuses with the usage when the token is not given', async () => {
    vi.stubEnv('CLOUDFLARE_API_TOKEN', '');
    expect(await main()).toBe(1);
    expect(errors).toEqual([USAGE]);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('refuses with the usage when the stored account id is not given', async () => {
    vi.stubEnv('CLOUDFLARE_ACCOUNT_ID', '');
    expect(await main()).toBe(1);
    expect(errors).toEqual([USAGE]);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('passes the dev token, asking Cloudflare once with it', async () => {
    answers(listing([DEV]));
    expect(await main()).toBe(0);
    expect(fetch).toHaveBeenCalledTimes(1);
    const [url, init] = fetch.mock.calls[0];
    expect(url).toBe(
      'https://api.cloudflare.com/client/v4/accounts?per_page=50',
    );
    expect(init.headers).toEqual({ Authorization: 'Bearer a-dev-token' });
    expect(logs).toEqual([
      'dev token reach: the token reaches 1 account, the dev one',
    ]);
    expect(errors).toEqual([]);
  });

  it("refuses production's token and account id pasted into dev together", async () => {
    vi.stubEnv('CLOUDFLARE_ACCOUNT_ID', PROD);
    answers(listing([PROD]));
    expect(await main()).toBe(1);
    expect(errors).toEqual([
      "::error::the dev token's reach is not proven: the account id stored beside the token (fedc…) is not the dev account (0123…)",
    ]);
  });

  it('refuses when the listing does not arrive, naming why', async () => {
    fetch.mockRejectedValue(
      new Error('The operation was aborted due to timeout'),
    );
    expect(await main()).toBe(1);
    expect(errors).toEqual([
      '::error::the account listing did not arrive: The operation was aborted due to timeout',
    ]);
  });
});

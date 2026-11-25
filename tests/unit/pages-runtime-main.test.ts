import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { main, testedCompatibilityDate } from '../../scripts/pages-runtime.mjs';
import { runtimePatch } from '../../src/lib/pages-runtime';

/**
 * The deploy's entry to the runtime sync (#907), run end to end with
 * Cloudflare's API stood in: what it asks, what it sends, what it prints and
 * the exit code it answers (#1258). The decisions themselves are
 * `pages-runtime.test.ts`'s.
 */
const ACCOUNT = '0123456789abcdef0123456789abcdef';
const TOKEN = 'a-pages-write-token-of-some-length';
const URL_OF = `https://api.cloudflare.com/client/v4/accounts/${ACCOUNT}/pages/projects/shyden-site-dev`;
const USAGE = 'usage: node scripts/pages-runtime.mjs <pages-project-name>';

const project = (compatibilityDate: string) => ({
  success: true,
  errors: [],
  result: {
    name: 'shyden-site-dev',
    deployment_configs: {
      production: {
        compatibility_date: compatibilityDate,
        compatibility_flags: [],
      },
    },
  },
});

describe('pages-runtime.mjs main() (#907, #1258)', () => {
  const fetch = vi.fn();
  let errors: string[];
  let logs: string[];

  /** Each call to Cloudflare answers the next body, as text. */
  const answers = (...bodies: (unknown | string)[]) => {
    for (const body of bodies)
      fetch.mockResolvedValueOnce(
        new Response(typeof body === 'string' ? body : JSON.stringify(body), {
          status: typeof body === 'string' ? 502 : 200,
        }),
      );
  };

  beforeEach(() => {
    errors = [];
    logs = [];
    vi.spyOn(console, 'error').mockImplementation((line) => {
      errors.push(String(line));
    });
    vi.spyOn(console, 'log').mockImplementation((line) => {
      logs.push(String(line));
    });
    vi.stubGlobal('fetch', fetch);
    vi.stubEnv('CLOUDFLARE_API_TOKEN', TOKEN);
    vi.stubEnv('CLOUDFLARE_ACCOUNT_ID', ACCOUNT);
  });

  afterEach(() => {
    fetch.mockReset();
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it('refuses with the usage when no project is named', async () => {
    expect(await main([])).toBe(2);
    expect(errors).toEqual([USAGE]);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('refuses with the usage when more than the project is given', async () => {
    expect(await main(['shyden-site-dev', 'extra'])).toBe(2);
    expect(errors).toEqual([USAGE]);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('refuses with the usage when the project name is not a project name', async () => {
    expect(await main(['Shyden Site'])).toBe(2);
    expect(errors).toEqual([USAGE]);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('asks once and sends nothing when production already runs the tested date', async () => {
    const date = testedCompatibilityDate();
    answers(project(date));
    expect(await main(['shyden-site-dev'])).toBe(0);
    expect(fetch).toHaveBeenCalledTimes(1);
    const [url, init] = fetch.mock.calls[0]!;
    expect(url).toBe(URL_OF);
    expect(init.method).toBe('GET');
    expect(init.headers).toEqual({ authorization: `Bearer ${TOKEN}` });
    expect(init.body).toBeUndefined();
    expect(logs).toEqual([
      `shyden-site-dev: production already runs compatibility date ${date} with no flags.`,
    ]);
    expect(errors).toEqual([]);
  });

  it('sends the runtime as JSON and reads it back', async () => {
    const date = testedCompatibilityDate();
    answers(
      project('2026-07-24'),
      { success: true, errors: [], result: {} },
      project(date),
    );
    expect(await main(['shyden-site-dev'])).toBe(0);
    expect(fetch.mock.calls.map(([, init]) => init.method)).toEqual([
      'GET',
      'PATCH',
      'GET',
    ]);
    const [, patch] = fetch.mock.calls[1]!;
    expect(patch.headers).toEqual({
      authorization: `Bearer ${TOKEN}`,
      'content-type': 'application/json',
    });
    expect(JSON.parse(patch.body)).toEqual(runtimePatch(date));
    expect(logs).toEqual([
      `shyden-site-dev: production moved from compatibility date 2026-07-24 to ${date}, read back.`,
    ]);
  });

  it('fails naming the status when Cloudflare answers what is not JSON', async () => {
    answers('<html>Bad gateway</html>');
    expect(await main(['shyden-site-dev'])).toBe(1);
    expect(errors).toEqual([
      '✗ shyden-site-dev: Cloudflare answered HTTP 502 with what is not JSON',
    ]);
    expect(logs).toEqual([]);
  });

  it('fails naming both dates when the read-back still differs', async () => {
    const date = testedCompatibilityDate();
    answers(
      project('2026-07-24'),
      { success: true, errors: [], result: {} },
      project('2026-07-24'),
    );
    expect(await main(['shyden-site-dev'])).toBe(1);
    expect(errors).toEqual([
      `✗ shyden-site-dev: after the update, production runs compatibility date 2026-07-24 with no flags; the functions suite tests ${date} with no flags`,
    ]);
  });
});

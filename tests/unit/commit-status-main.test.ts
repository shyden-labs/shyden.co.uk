import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { main } from '../../scripts/commit-status.mjs';

/**
 * `commit-status.mjs`'s entry point in-process (#444, #1258), with GitHub's
 * API stood in: the one status it posts, what it prints, and the exit code it
 * answers. `postStatus` itself is `commit-status.test.ts`'s.
 */
const SHA = 'cedea2695eebcb93da9ec1c7277ff71b4363cb8f';
const USAGE = 'usage: node scripts/commit-status.mjs <context> <description>';

describe('commit-status.mjs main() (#444, #1258)', () => {
  const fetch = vi.fn();
  let lines: string[];

  beforeEach(() => {
    lines = [];
    for (const stream of ['log', 'error'] as const)
      vi.spyOn(console, stream).mockImplementation((line) => {
        lines.push(String(line));
      });
    vi.stubGlobal('fetch', fetch);
    for (const [name, value] of Object.entries({
      GITHUB_API_URL: 'https://api.github.test',
      GITHUB_SERVER_URL: 'https://github.com',
      GITHUB_REPOSITORY: 'shyden-labs/shyden.co.uk',
      GITHUB_RUN_ID: '45039049698',
      GITHUB_SHA: SHA,
      GITHUB_TOKEN: 'gh-token',
    }))
      vi.stubEnv(name, value);
  });

  afterEach(() => {
    fetch.mockReset();
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it('refuses with the usage when the description is missing', async () => {
    expect(await main(['dev-verified'])).toBe(2);
    expect(lines).toEqual([USAGE]);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('refuses with the usage when given more than a context and a description', async () => {
    expect(await main(['dev-verified', 'ok', 'extra'])).toBe(2);
    expect(lines).toEqual([USAGE]);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('posts one success status on the commit, pointing at the run', async () => {
    fetch.mockResolvedValueOnce(new Response('{}', { status: 201 }));
    expect(await main(['dev-verified', 'dev serves this commit'])).toBe(0);
    expect(fetch).toHaveBeenCalledTimes(1);
    const [url, init] = fetch.mock.calls[0]!;
    expect(url).toBe(
      `https://api.github.test/repos/shyden-labs/shyden.co.uk/statuses/${SHA}`,
    );
    expect(init.method).toBe('POST');
    expect(init.headers.authorization).toBe('Bearer gh-token');
    expect(JSON.parse(init.body)).toEqual({
      state: 'success',
      context: 'dev-verified',
      description: 'dev serves this commit',
      target_url:
        'https://github.com/shyden-labs/shyden.co.uk/actions/runs/45039049698',
    });
    expect(lines).toEqual([`Posted dev-verified=success on ${SHA}`]);
  });

  it('fails naming the context and the status when GitHub refuses it', async () => {
    fetch.mockResolvedValueOnce(
      new Response('{"message":"Resource not accessible"}', { status: 403 }),
    );
    expect(await main(['dev-verified', 'dev serves this commit'])).toBe(1);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatch(/^✗ dev-verified: GitHub answered HTTP 403/);
  });
});

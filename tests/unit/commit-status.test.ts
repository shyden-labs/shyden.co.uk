import { afterEach, describe, expect, it, vi } from 'vitest';
import { postStatus } from '../../scripts/commit-status.mjs';

/**
 * The deploy verify jobs post `dev-verified` and `prod-verified` without the
 * `gh` CLI, which the pinned Playwright image they run in does not carry
 * (#444): one POST to the commit's statuses, with the same state, context,
 * description and target URL `gh api` sent.
 */

const SHA = 'a96ec1fd9f5353122314c9176e9da2aaa7e55465';
const RUN = 'https://github.com/shyden-labs/shyden.co.uk/actions/runs/42';

describe('postStatus', () => {
  const calls: { url: string; init: RequestInit }[] = [];
  let answer: { status: number; body: unknown } = {
    status: 201,
    body: { state: 'success' },
  };

  const stub = () =>
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init: RequestInit) => {
        calls.push({ url, init });
        return new Response(JSON.stringify(answer.body), {
          status: answer.status,
        });
      }),
    );

  afterEach(() => {
    vi.unstubAllGlobals();
    calls.length = 0;
    answer = { status: 201, body: { state: 'success' } };
  });

  const post = () =>
    postStatus({
      api: 'https://api.github.test',
      repository: 'shyden-labs/shyden.co.uk',
      sha: SHA,
      token: 'gh-token',
      context: 'dev-verified',
      description: 'Dev deployed + verified (run 42)',
      targetUrl: RUN,
      timeoutMs: 1000,
    });

  it('posts success once to the commit, with the token, context, description and run', async () => {
    stub();
    await post();
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe(
      `https://api.github.test/repos/shyden-labs/shyden.co.uk/statuses/${SHA}`,
    );
    expect(calls[0].init.method).toBe('POST');
    expect(new Headers(calls[0].init.headers).get('authorization')).toBe(
      'Bearer gh-token',
    );
    expect(JSON.parse(String(calls[0].init.body))).toEqual({
      state: 'success',
      context: 'dev-verified',
      description: 'Dev deployed + verified (run 42)',
      target_url: RUN,
    });
  });

  it('fails on any answer that is not 2xx, naming the status', async () => {
    stub();
    answer = { status: 403, body: { message: 'Resource not accessible' } };
    await expect(post()).rejects.toThrow('GitHub answered HTTP 403');
  });

  it('refuses a commit that is not a full SHA, before any request', async () => {
    stub();
    await expect(
      postStatus({
        api: 'https://api.github.test',
        repository: 'shyden-labs/shyden.co.uk',
        sha: 'a96ec1f',
        token: 'gh-token',
        context: 'dev-verified',
        description: 'x',
        targetUrl: RUN,
        timeoutMs: 1000,
      }),
    ).rejects.toThrow('the commit is not a full SHA');
    expect(calls).toHaveLength(0);
  });
});

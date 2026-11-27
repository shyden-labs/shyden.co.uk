import { describe, expect, it } from 'vitest';
import { devVerifiedOf } from '../../scripts/build-release-content.mjs';

/**
 * The head's `dev-verified` status, read from GitHub's API directly rather
 * than through `gh` on PATH (SonarCloud S4036, #1295).
 */
function answering(statuses: unknown) {
  const urls: string[] = [];
  const fetch = (async (url: string) => {
    urls.push(url);
    return {
      ok: true,
      status: 200,
      headers: { get: () => null },
      json: async () => statuses,
      text: async () => JSON.stringify(statuses),
    };
  }) as unknown as typeof globalThis.fetch;
  return { fetch, urls };
}

const options = (fetch: typeof globalThis.fetch) => ({
  env: { GITHUB_TOKEN: 't', GITHUB_REPOSITORY: 'o/r' },
  fetch,
  readOrigin: () => {
    throw new Error('read the remote');
  },
});

describe("a release head's dev-verified status (#1295)", () => {
  it("reads the head's statuses and returns the newest dev-verified state", async () => {
    // GitHub lists a commit's statuses newest first.
    const { fetch, urls } = answering([
      { context: 'build-and-test', state: 'success' },
      { context: 'dev-verified', state: 'failure' },
      { context: 'dev-verified', state: 'success' },
    ]);

    expect(await devVerifiedOf('abc123', options(fetch))).toBe('failure');
    expect(urls).toEqual([
      'https://api.github.com/repos/o/r/commits/abc123/statuses?per_page=100',
    ]);
  });

  it('is null when the head has no dev-verified status at all', async () => {
    const { fetch } = answering([
      { context: 'build-and-test', state: 'success' },
    ]);

    expect(await devVerifiedOf('abc123', options(fetch))).toBeNull();
  });
});

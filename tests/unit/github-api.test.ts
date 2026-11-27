import { describe, expect, it } from 'vitest';
import { githubGet, repositoryOf } from '../../scripts/github-api.mjs';

/** A stand-in fetch answering each URL from `pages`, recording every call. */
function fetchAnswering(
  pages: Record<string, { status?: number; body: unknown; next?: string }>,
) {
  const calls: { url: string; headers: Record<string, string> }[] = [];
  const fetch = (async (
    url: string,
    init: { headers: Record<string, string> },
  ) => {
    calls.push({ url, headers: init.headers });
    const page = pages[url];
    if (!page) throw new Error(`no page for ${url}`);
    const status = page.status ?? 200;
    return {
      ok: status >= 200 && status < 300,
      status,
      headers: {
        get: (name: string) =>
          name.toLowerCase() === 'link' && page.next
            ? `<${page.next}>; rel="next", <https://x/last>; rel="last"`
            : null,
      },
      json: async () => page.body,
      text: async () => JSON.stringify(page.body),
    };
  }) as unknown as typeof globalThis.fetch;
  return { fetch, calls };
}

describe("GitHub's API, called directly with the App's token (#1295)", () => {
  it('sends the token and the API version, and reads one page', async () => {
    const { fetch, calls } = fetchAnswering({
      'https://api.github.com/repos/o/r/commits/abc/statuses?per_page=100': {
        body: [{ context: 'dev-verified', state: 'success' }],
      },
    });

    const body = await githubGet('/repos/o/r/commits/abc/statuses', {
      env: { GITHUB_TOKEN: 'tok' },
      fetch,
    });

    expect(body).toEqual([{ context: 'dev-verified', state: 'success' }]);
    expect(calls).toEqual([
      {
        url: 'https://api.github.com/repos/o/r/commits/abc/statuses?per_page=100',
        headers: {
          Accept: 'application/vnd.github+json',
          Authorization: 'Bearer tok',
          'X-GitHub-Api-Version': '2022-11-28',
        },
      },
    ]);
  });

  it('follows every next page, so a long list is never cut short', async () => {
    const { fetch, calls } = fetchAnswering({
      'https://ghe.test/api/repos/o/r/labels?per_page=100': {
        body: [{ name: 'a' }],
        next: 'https://ghe.test/api/repos/o/r/labels?per_page=100&page=2',
      },
      'https://ghe.test/api/repos/o/r/labels?per_page=100&page=2': {
        body: [{ name: 'b' }],
      },
    });

    const body = await githubGet('/repos/o/r/labels', {
      env: { GH_TOKEN: 'tok', GITHUB_API_URL: 'https://ghe.test/api' },
      fetch,
    });

    expect(body).toEqual([{ name: 'a' }, { name: 'b' }]);
    expect(calls.map((c) => c.url)).toEqual([
      'https://ghe.test/api/repos/o/r/labels?per_page=100',
      'https://ghe.test/api/repos/o/r/labels?per_page=100&page=2',
    ]);
  });

  it('refuses to call without a token, naming both variables', async () => {
    const { fetch, calls } = fetchAnswering({});

    await expect(
      githubGet('/repos/o/r/labels', { env: {}, fetch }),
    ).rejects.toThrow(/GITHUB_TOKEN or GH_TOKEN/);
    expect(calls).toEqual([]);
  });

  it('names the status and the path when GitHub refuses', async () => {
    const { fetch } = fetchAnswering({
      'https://api.github.com/repos/o/r/labels?per_page=100': {
        status: 403,
        body: { message: 'Resource not accessible by integration' },
      },
    });

    await expect(
      githubGet('/repos/o/r/labels', { env: { GITHUB_TOKEN: 't' }, fetch }),
    ).rejects.toThrow(
      /GitHub answered 403 for \/repos\/o\/r\/labels: .*Resource not accessible by integration/,
    );
  });
});

describe('the repository a script is about', () => {
  it('is GITHUB_REPOSITORY when the run sets it, without reading the remote', () => {
    const read = () => {
      throw new Error('read the remote');
    };
    expect(repositoryOf({ GITHUB_REPOSITORY: 'o/r' }, read)).toBe('o/r');
  });

  it.each([
    ['git@github.com:shyden-labs/shyden.co.uk.git'],
    ['https://github.com/shyden-labs/shyden.co.uk.git'],
    ['https://github.com/shyden-labs/shyden.co.uk'],
  ])('is read from the origin remote %s otherwise', (url) => {
    expect(repositoryOf({}, () => `${url}\n`)).toBe('shyden-labs/shyden.co.uk');
  });

  it('refuses a remote that is not on GitHub, naming it', () => {
    expect(() => repositoryOf({}, () => 'https://gitlab.com/o/r.git')).toThrow(
      /origin remote https:\/\/gitlab.com\/o\/r.git is not a GitHub repository/,
    );
  });
});

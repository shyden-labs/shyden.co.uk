import { afterEach, describe, expect, it, vi } from 'vitest';
import { main } from '../../scripts/dependabot-labels.mjs';

// die() ends the process through the `exit` it imported, which no spy on
// process.exit reaches: stand it in, printing as it does, then throwing.
vi.mock('../../scripts/errors.mjs', async (original) => ({
  ...(await original<typeof import('../../scripts/errors.mjs')>()),
  die: (message: string) => {
    console.error(`✗ ${message}`);
    throw new Error('exit 1');
  },
}));

/**
 * The labels check, run against what GitHub answers (#1295). These replace the
 * integration tests that put a `gh` stand-in on PATH: the check now asks
 * GitHub's API itself, through the `fetch` it is handed, and every assertion
 * those tests made is kept here.
 */

const CONFIG =
  'version: 2\nupdates:\n  - package-ecosystem: npm\n    directory: /\n' +
  '    labels: [npm, dependencies]\n';

const LABELS = 'https://api.github.com/repos/o/r/labels?per_page=100';

interface Page {
  readonly status?: number;
  readonly body: unknown;
  readonly next?: string;
}

/** Runs main() against `pages`, returning what it printed and how it ended. */
async function run(
  pages: Record<string, Page>,
  {
    config = CONFIG,
    env = { GITHUB_TOKEN: 't', GITHUB_REPOSITORY: 'o/r' },
  } = {},
) {
  const urls: string[] = [];
  const fetch = (async (url: string) => {
    urls.push(url);
    const page = pages[url];
    if (!page) throw new Error(`no page for ${url}`);
    const status = page.status ?? 200;
    return {
      ok: status < 300,
      status,
      headers: {
        get: () => (page.next ? `<${page.next}>; rel="next"` : null),
      },
      json: async () => page.body,
      text: async () => JSON.stringify(page.body),
    };
  }) as unknown as typeof globalThis.fetch;
  const err = vi.spyOn(console, 'error').mockImplementation(() => {});
  const out = vi.spyOn(console, 'log').mockImplementation(() => {});
  let code = 0;
  try {
    await main({
      args: [],
      readConfig: () => config,
      env,
      fetch,
      readOrigin: () => {
        throw new Error('read the remote');
      },
    });
  } catch (error) {
    const match = /^exit (\d+)$/.exec((error as Error).message);
    if (!match) throw error;
    code = Number(match[1]);
  }
  const text = (spy: typeof err) =>
    spy.mock.calls.map((call) => `${String(call[0])}\n`).join('');
  return { code, out: text(out), err: text(err), urls };
}

const named = (...names: string[]) => names.map((name) => ({ name }));

describe('the labels check, run against what GitHub answers (#1295)', () => {
  afterEach(() => vi.restoreAllMocks());

  it('passes when every declared label exists, and says how many', async () => {
    const { code, out, err } = await run({
      [LABELS]: { body: named('dependencies', 'npm', 'javascript') },
    });

    expect(err).toBe('');
    expect(out).toBe(
      '.github/dependabot.yml: all 2 declared labels exist (dependencies, npm)\n',
    );
    expect(code).toBe(0);
  });

  it("asks GitHub for every page of this repository's labels", async () => {
    // Read to the last page: a repository past one page of labels would
    // otherwise report labels it has as missing.
    const second = `${LABELS}&page=2`;
    const { code, urls } = await run({
      [LABELS]: { body: named('dependencies'), next: second },
      [second]: { body: named('npm') },
    });

    expect(urls).toEqual([LABELS, second]);
    expect(code).toBe(0);
  });

  it('refuses one declared label the repository lacks, naming it', async () => {
    const { code, err } = await run({
      [LABELS]: { body: named('dependencies') },
    });

    expect(err).toContain(
      '.github/dependabot.yml names 1 label this repository does not have:\n  npm\n',
    );
    expect(code).toBe(1);
  });

  it('counts two missing labels in the plural', async () => {
    const { code, err } = await run({
      [LABELS]: { body: named('javascript') },
    });

    expect(err).toContain(
      '.github/dependabot.yml names 2 labels this repository does not have:\n  dependencies\n  npm\n',
    );
    expect(code).toBe(1);
  });

  it('refuses a config that names no labels, before asking GitHub', async () => {
    const { code, err, urls } = await run(
      { [LABELS]: { body: named('dependencies', 'npm') } },
      { config: 'version: 2\nupdates: []\n' },
    );

    expect(err).toContain('.github/dependabot.yml names no labels at all.');
    expect(urls).toEqual([]);
    expect(code).toBe(1);
  });

  it('refuses a label YAML does not read as text, before asking GitHub', async () => {
    const { code, err, urls } = await run(
      { [LABELS]: { body: named('npm', '7') } },
      { config: CONFIG.replace('[npm, dependencies]', '[npm, 7]') },
    );

    expect(err).toContain(
      '.github/dependabot.yml names labels YAML does not read as text: 7.',
    );
    expect(urls).toEqual([]);
    expect(code).toBe(1);
  });

  it('refuses an empty answer from GitHub, which cannot be right', async () => {
    const { code, err } = await run({ [LABELS]: { body: [] } });

    expect(err).toContain(
      'GitHub returned no labels for this repository, which cannot be right.',
    );
    expect(code).toBe(1);
  });

  it('refuses an answer GitHub refused, with what GitHub said', async () => {
    const { code, err } = await run({
      [LABELS]: { status: 401, body: { message: 'Bad credentials' } },
    });

    expect(err).toContain(
      "cannot read this repository's labels: GitHub answered 401 for /repos/o/r/labels: ",
    );
    expect(err).toContain('Bad credentials');
    expect(code).toBe(1);
  });

  it('refuses when it has no token to ask GitHub with', async () => {
    const { code, err, urls } = await run(
      { [LABELS]: { body: named('dependencies', 'npm') } },
      { env: { GITHUB_REPOSITORY: 'o/r' } },
    );

    expect(err).toContain(
      "cannot read this repository's labels: GitHub's API needs a token: set GITHUB_TOKEN or GH_TOKEN",
    );
    expect(urls).toEqual([]);
    expect(code).toBe(1);
  });
});

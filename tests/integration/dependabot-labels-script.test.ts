import { spawnSync } from 'node:child_process';
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { GH_STAND_IN, ghCalledWith as ghArgsIn } from '../gh-stand-in';

/**
 * `scripts/dependabot-labels.mjs` as CI runs it: from a checkout, with `gh`
 * on the PATH.
 *
 * `dependabot-labels.test.ts` covers what the script derives from the config.
 * This file covers what it does with each answer `gh` can give, which is
 * where every refusal in `main()` lives, and where none of them was tested:
 * with each one removed, the whole suite stayed green.
 *
 * `gh` is a stand-in here, the one thing the script reaches outside the
 * checkout. The real one needs a token and the network, and CI runs it for
 * real on every pull request (the `checks` job). The stand-in records its
 * arguments, one per line, and answers from the environment.
 */

const SCRIPT = path.resolve(
  import.meta.dirname,
  '../../scripts/dependabot-labels.mjs',
);

const CONFIG =
  'version: 2\nupdates:\n  - package-ecosystem: npm\n    directory: /\n' +
  '    labels: [npm, dependencies]\n';

let dir = '';
beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), 'dependabot-labels-'));
  mkdirSync(path.join(dir, '.github'));
  mkdirSync(path.join(dir, 'bin'));
  writeFileSync(path.join(dir, 'bin', 'gh'), GH_STAND_IN);
  chmodSync(path.join(dir, 'bin', 'gh'), 0o755);
  writeFileSync(path.join(dir, '.github', 'dependabot.yml'), CONFIG);
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

interface Answer {
  readonly out?: string;
  readonly err?: string;
  readonly status?: number;
}

/** Run the script in the scratch checkout, `gh` answering as told. */
const run = (answer: Answer, { withGh = true } = {}) => {
  const result = spawnSync(process.execPath, [SCRIPT], {
    cwd: dir,
    encoding: 'utf8',
    env: {
      PATH: withGh ? `${path.join(dir, 'bin')}:/bin:/usr/bin` : '/nonexistent',
      GH_ARGS: path.join(dir, 'gh-args'),
      GH_OUT: answer.out ?? '',
      GH_ERR: answer.err ?? '',
      GH_STATUS: String(answer.status ?? 0),
    },
  });
  return { code: result.status, out: result.stdout, err: result.stderr };
};

/** The arguments `gh` was called with, or null if it never was. */
const ghCalledWith = () => ghArgsIn(path.join(dir, 'gh-args'));

const useConfig = (labels: string) =>
  writeFileSync(
    path.join(dir, '.github', 'dependabot.yml'),
    `version: 2\nupdates:\n  - package-ecosystem: npm\n    directory: /\n${labels}`,
  );

describe('the labels check, run against what gh answers', () => {
  it('passes when every declared label exists, and says how many', () => {
    const { code, out, err } = run({ out: 'dependencies\nnpm\njavascript\n' });

    expect(err).toBe('');
    expect(out).toBe(
      '.github/dependabot.yml: all 2 declared labels exist (dependencies, npm)\n',
    );
    expect(code).toBe(0);
  });

  it("asks gh for every page of this repository's labels", () => {
    run({ out: 'dependencies\nnpm\n' });

    // Without --paginate, a repository past one page of labels would report
    // labels it has as missing.
    expect(ghCalledWith()).toEqual([
      'api',
      '--paginate',
      '/repos/{owner}/{repo}/labels',
      '--jq',
      '.[].name',
    ]);
  });

  it('refuses one declared label the repository lacks, naming it', () => {
    const { code, err } = run({ out: 'dependencies\n' });

    expect(err).toContain(
      '.github/dependabot.yml names 1 label this repository does not have:\n  npm\n',
    );
    expect(code).toBe(1);
  });

  it('counts two missing labels in the plural', () => {
    const { code, err } = run({ out: 'javascript\n' });

    expect(err).toContain(
      '.github/dependabot.yml names 2 labels this repository does not have:\n  dependencies\n  npm\n',
    );
    expect(code).toBe(1);
  });

  it('refuses a config that names no labels, before asking gh', () => {
    useConfig('');
    const { code, err } = run({ out: 'dependencies\nnpm\n' });

    expect(err).toContain('.github/dependabot.yml names no labels at all.');
    expect(ghCalledWith()).toBeNull();
    expect(code).toBe(1);
  });

  it('refuses a label YAML does not read as text, before asking gh', () => {
    useConfig('    labels: [npm, 7]\n');
    const { code, err } = run({ out: 'npm\n7\n' });

    expect(err).toContain(
      '.github/dependabot.yml names labels YAML does not read as text: 7.',
    );
    expect(ghCalledWith()).toBeNull();
    expect(code).toBe(1);
  });

  it('refuses an empty answer from gh, which cannot be right', () => {
    const { code, err } = run({ out: '' });

    expect(err).toContain(
      'gh returned no labels for this repository, which cannot be right.',
    );
    expect(code).toBe(1);
  });

  it('refuses a gh that failed, with what gh said', () => {
    const { code, err } = run({
      status: 4,
      err: 'HTTP 401: Bad credentials\n',
    });

    expect(err).toContain(
      "gh api exited 4 reading this repository's labels.\nHTTP 401: Bad credentials",
    );
    expect(code).toBe(1);
  });

  it('refuses when gh cannot be run at all', () => {
    const { code, err } = run({}, { withGh: false });

    expect(err).toContain('cannot run gh: spawnSync gh ENOENT');
    expect(code).toBe(1);
  });
});

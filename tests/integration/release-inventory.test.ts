import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  VISITOR_PREFIXES,
  inventoryFor,
  inventoryOf,
  readCommits,
} from '../../scripts/release-inventory.mjs';
import { scratchGit, withoutLocalGit } from '../git-env';
import { writeUnder } from '../scratch-dir';
import { floorBreach } from '../floors';

/** A throwaway repository, driven by the real git. */
const repository = () => {
  const dir = mkdtempSync(join(tmpdir(), 'release-inventory-'));
  const git = scratchGit(dir);
  git(['init', '-q', '-b', 'develop']);
  git(['config', 'user.email', 'fixture@example.test']);
  git(['config', 'user.name', 'Fixture']);
  git(['config', 'commit.gpgsign', 'false']);
  const write = writeUnder(dir);
  const commit = (subject: string) => {
    git(['add', '-A']);
    git(['commit', '-q', '-m', subject]);
    return git(['rev-parse', 'HEAD']).trim();
  };
  return {
    dir,
    git,
    write,
    commit,
    remove: () => rmSync(dir, { recursive: true, force: true }),
  };
};

describe('the release inventory (#362)', () => {
  let repo: ReturnType<typeof repository>;
  const sha: Record<string, string> = {};

  beforeAll(() => {
    repo = repository();
    const { git, write, commit } = repo;
    write('README.md', 'production\n');
    sha.base = commit('the production tree');
    // The squash era: one commit is one pull request, "(#ticket) (#pr)".
    write('src/pages/zh.astro', 'zh\n');
    write('tests/e2e/zh.spec.ts', 'zh\n');
    sha.squash = commit('feat(i18n): serve zh (#22) (#46)');
    // A pull request merged with a merge commit...
    git(['switch', '-q', '-c', '97-report']);
    write('functions/api/report.js', 'report\n');
    commit('the report function');
    git(['switch', '-q', 'develop']);
    // ...while develop moves on beside it, so its branch falls behind.
    write('src/components/Footer.astro', 'footer\n');
    sha.single = commit('fix(footer): one ref (#50)');
    git([
      'merge',
      '-q',
      '--no-ff',
      '-m',
      // Merges before #413 name the org's old handle, and develop's history keeps them.
      'Merge pull request #347 from Shyden-Ltd/97-report',
      '97-report',
    ]);
    sha.merge = git(['rev-parse', 'HEAD']).trim();
    // A pull request whose work is tests and a root file only.
    git(['switch', '-q', '-c', 'dependabot/npm/x']);
    write('tests/unit/x.test.ts', 'x\n');
    write('package.json', '{}\n');
    commit('bump');
    git(['switch', '-q', 'develop']);
    git([
      'merge',
      '-q',
      '--no-ff',
      '-m',
      'Merge pull request #298 from shyden-labs/dependabot/npm/x',
      'dependabot/npm/x',
    ]);
    sha.head = git(['rev-parse', 'HEAD']).trim();
  });
  afterAll(() => repo.remove());

  const commits = () =>
    readCommits({ base: sha.base, head: sha.head, git: repo.git });

  it('walks every first-parent commit, oldest first, squashes and merges alike', () => {
    expect(commits().map((c) => c.sha)).toEqual([
      sha.squash,
      sha.single,
      sha.merge,
      sha.head,
    ]);
  });

  it("credits a merge with its own pull request's files, never develop's", () => {
    const merge = commits().find((c) => c.sha === sha.merge);
    expect(merge?.files).toEqual(['functions/api/report.js']);
  });

  it('credits a squash with its own diff', () => {
    expect(commits()[0]?.files).toEqual([
      'src/pages/zh.astro',
      'tests/e2e/zh.spec.ts',
    ]);
  });

  it('reads the pull request and ticket out of each shape of subject', () => {
    const entries = inventoryOf(commits());
    expect(entries.map(({ pr, ticket }) => ({ pr, ticket }))).toEqual([
      { pr: 46, ticket: 22 },
      { pr: 50, ticket: null },
      { pr: 347, ticket: 97 },
      { pr: 298, ticket: null },
    ]);
  });

  it('marks what a visitor receives, and names every other area', () => {
    const entries = inventoryOf(commits());
    expect(entries.map((e) => e.visitorFacing)).toEqual([
      true,
      true,
      true,
      false,
    ]);
    expect(entries[3]?.areas).toEqual(['(root)', 'tests']);
    expect(entries[0]?.areas).toEqual(['src', 'tests']);
  });

  it('covers exactly the four directories a visitor receives', () => {
    expect([...VISITOR_PREFIXES]).toEqual([
      'src/',
      'functions/',
      'migrations/',
      'public/',
    ]);
    for (const prefix of VISITOR_PREFIXES) {
      const [entry] = inventoryOf([
        { sha: 'x', parents: ['p'], subject: 's', files: [`${prefix}a`] },
      ]);
      expect(entry?.visitorFacing, prefix).toBe(true);
      // The prefix opens the path: a directory of that name deeper down is
      // another area's, and ships nothing.
      const [deeper] = inventoryOf([
        { sha: 'x', parents: ['p'], subject: 's', files: [`docs/${prefix}a`] },
      ]);
      expect(deeper?.visitorFacing, `docs/${prefix}a`).toBe(false);
    }
  });

  it('names each area once, sorted, whatever order its files arrive in', () => {
    // git lists paths in byte order, so a root file can follow a directory.
    const [entry] = inventoryOf([
      {
        sha: 'x',
        parents: ['p'],
        subject: 's',
        files: ['docs/a.md', 'docs/b.md', 'public/x.png', 'z.md'],
      },
    ]);
    expect(entry?.areas).toEqual(['(root)', 'docs', 'public']);
  });

  it('resolves the ends to full shas', () => {
    const inventory = inventoryFor({
      base: 'HEAD~4',
      head: 'HEAD',
      git: repo.git,
    });
    expect(inventory.base).toBe(sha.base);
    expect(inventory.head).toBe(sha.head);
    expect(inventory.entries).toHaveLength(4);
  });

  it('refuses a base that is not an ancestor of the head', () => {
    expect(() =>
      readCommits({ base: sha.head, head: sha.squash, git: repo.git }),
    ).toThrow(/is not an ancestor of/);
  });

  it("names git's own refusal, rather than calling a missing commit no ancestor", () => {
    expect(() =>
      readCommits({ base: 'nosuch', head: sha.head, git: repo.git }),
    ).toThrow(/Not a valid object name nosuch/);
  });
});

describe('a commit the inventory has no rule for (#362)', () => {
  it('refuses an octopus merge rather than guess which parent is the line', () => {
    const repo = repository();
    try {
      const { git, write, commit } = repo;
      write('a', 'a\n');
      const base = commit('base');
      for (const branch of ['one', 'two']) {
        git(['switch', '-q', '-c', branch, base]);
        write(`src/${branch}`, `${branch}\n`);
        commit(branch);
      }
      git(['switch', '-q', 'develop']);
      git(['merge', '-q', '--no-ff', '-m', 'octopus', 'one', 'two']);
      expect(() => readCommits({ base, head: 'HEAD', git })).toThrow(
        /has 3 parents/,
      );
    } finally {
      repo.remove();
    }
  });

  it('refuses a root commit on the line, which has no first parent to diff against', () => {
    const repo = repository();
    try {
      const { git, write, commit } = repo;
      write('a', 'a\n');
      const base = commit('base');
      // Another history's root, joined to this one: the first-parent walk
      // from the join runs down to that root, never through the base.
      git(['switch', '-q', '--orphan', 'other']);
      write('src/b', 'b\n');
      commit('another root');
      git([
        'merge',
        '-q',
        '--no-ff',
        '--allow-unrelated-histories',
        '-m',
        'join',
        'develop',
      ]);
      expect(() => readCommits({ base, head: 'HEAD', git })).toThrow(
        /has 0 parents/,
      );
    } finally {
      repo.remove();
    }
  });
});

describe('release-inventory.mjs as a command (#362)', () => {
  const script = resolve('scripts/release-inventory.mjs');

  it('prints the capture selection of this repository, and it is not empty', () => {
    const run = spawnSync(process.execPath, [script, '--tests'], {
      encoding: 'utf8',
    });
    expect(run.status, run.stderr).toBe(0);
    const lines = run.stdout.trim().split('\n');
    expect(
      floorBreach('release-inventory/capture-lines', lines.length),
    ).toBeUndefined();
    expect(
      lines.every((l) => /^tests\/e2e\/[\w.-]+\.spec\.ts:\d+$/.test(l)),
    ).toBe(true);
    expect(
      lines.some((l) =>
        l.startsWith('tests/e2e/classroom-groups-projector.spec.ts:'),
      ),
    ).toBe(true);
    expect(
      lines.some((l) => l.startsWith('tests/e2e/evidence-page.spec.ts:')),
    ).toBe(false);
  });

  it('prints the inventory of a range as JSON, from full shas', () => {
    const repo = repository();
    try {
      repo.write('README.md', 'production\n');
      const base = repo.commit('the production tree');
      repo.write('src/pages/a.astro', 'a\n');
      const head = repo.commit('feat: a page (#7) (#8)');
      const run = spawnSync(
        process.execPath,
        [script, '--base', base.slice(0, 7), '--head', 'HEAD'],
        { cwd: repo.dir, encoding: 'utf8', env: withoutLocalGit(process.env) },
      );
      expect(run.status, run.stderr).toBe(0);
      expect(JSON.parse(run.stdout)).toEqual({
        base,
        head,
        entries: [
          {
            sha: head,
            subject: 'feat: a page (#7) (#8)',
            pr: 8,
            ticket: 7,
            files: ['src/pages/a.astro'],
            visitorFacing: true,
            areas: ['src'],
          },
        ],
      });
    } finally {
      repo.remove();
    }
  });

  it('names an option it does not know, and refuses', () => {
    const run = spawnSync(process.execPath, [script, '--tests', '--bogus'], {
      encoding: 'utf8',
    });
    expect(run.stderr).toContain("release-inventory: Unknown option '--bogus'");
    expect(run.stderr).toContain('usage: release-inventory.mjs');
    expect(run.status).toBe(2);
  });

  it('refuses a selection that is empty, rather than let a capture run everything', () => {
    const empty = mkdtempSync(join(tmpdir(), 'release-tests-'));
    try {
      mkdirSync(join(empty, 'tests', 'e2e'), { recursive: true });
      scratchGit(empty)(['init', '-q']);
      const run = spawnSync(process.execPath, [script, '--tests'], {
        cwd: empty,
        encoding: 'utf8',
      });
      expect(run.stderr).toContain('no test captures the site');
      expect(run.status).toBe(1);
    } finally {
      rmSync(empty, { recursive: true, force: true });
    }
  });
});

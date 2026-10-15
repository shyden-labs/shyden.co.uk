import { describe, expect, it } from 'vitest';
import { pullRequestChanges } from '../../scripts/docs-only.mjs';
import {
  captureFromDiff,
  captureVerdict,
  importClosure,
  isCapturePath,
  relativeSpecifiers,
} from '../../scripts/capture-scope.mjs';

/** A tree held in memory: path to source. Reading a path it lacks throws. */
const tree = (files: Record<string, string>) => ({
  read: (path: string) => {
    if (!Object.hasOwn(files, path)) throw new Error(`read ${path}`);
    return files[path];
  },
  exists: (path: string) => Object.hasOwn(files, path),
});

describe('relativeSpecifiers: the relative imports a source names', () => {
  it('reads a default import', () => {
    expect(relativeSpecifiers("import x from './a';")).toEqual(['./a']);
  });

  it('reads a re-export', () => {
    expect(relativeSpecifiers("export * from '../b.mjs';")).toEqual([
      '../b.mjs',
    ]);
  });

  it('reads a side-effect import', () => {
    expect(relativeSpecifiers("import './c.css';")).toEqual(['./c.css']);
  });

  it('reads a dynamic import', () => {
    expect(relativeSpecifiers("await import('./d');")).toEqual(['./d']);
  });

  it('reads a JSDoc type import', () => {
    expect(relativeSpecifiers("/** @type {import('./e').E} */")).toEqual([
      './e',
    ]);
  });

  it('reads a multi-line named import', () => {
    expect(relativeSpecifiers("import {\n  a,\n  b,\n} from './f';")).toEqual([
      './f',
    ]);
  });

  it('keeps the relative import among package imports', () => {
    expect(
      relativeSpecifiers(
        "import { readFileSync } from 'node:fs';\n" +
          "import { test } from '@playwright/test';\n" +
          "import { g } from './g';",
      ),
    ).toEqual(['./g']);
  });

  it('drops a query from the specifier', () => {
    expect(relativeSpecifiers("import svg from './h.svg?raw';")).toEqual([
      './h.svg',
    ]);
  });
});

describe('importClosure: every file the roots reach', () => {
  it('follows imports to a fixed point', () => {
    const closure = importClosure(
      ['tests/e2e/a.spec.ts'],
      tree({
        'tests/e2e/a.spec.ts': "import { b } from '../b';",
        'tests/b.ts': "import { c } from '../scripts/c.mjs';",
        'scripts/c.mjs': '',
      }),
    );
    expect([...closure].sort()).toEqual([
      'scripts/c.mjs',
      'tests/b.ts',
      'tests/e2e/a.spec.ts',
    ]);
  });

  it('resolves a .js specifier to its .ts source', () => {
    const closure = importClosure(
      ['a.ts'],
      tree({ 'a.ts': "import { b } from './b.js';", 'b.ts': '' }),
    );
    expect([...closure].sort()).toEqual(['a.ts', 'b.ts']);
  });

  it('resolves a directory to its index', () => {
    const closure = importClosure(
      ['a.ts'],
      tree({ 'a.ts': "import { b } from './b';", 'b/index.ts': '' }),
    );
    expect([...closure].sort()).toEqual(['a.ts', 'b/index.ts']);
  });

  it('follows an import inside an .astro component', () => {
    const closure = importClosure(
      ['src/pages/a.astro'],
      tree({
        'src/pages/a.astro': "---\nimport B from '../B.astro';\n---\n<B />",
        'src/B.astro': '',
      }),
    );
    expect([...closure].sort()).toEqual(['src/B.astro', 'src/pages/a.astro']);
  });

  it('reads a cycle once', () => {
    const closure = importClosure(
      ['a.ts'],
      tree({ 'a.ts': "import './b';", 'b.ts': "import './a';" }),
    );
    expect([...closure].sort()).toEqual(['a.ts', 'b.ts']);
  });

  it('counts a data file it imports without parsing it', () => {
    const files = { 'a.ts': "import data from './d.json';" };
    const closure = importClosure(['a.ts'], {
      read: tree(files).read,
      exists: (path) => path === 'a.ts' || path === 'd.json',
    });
    expect([...closure].sort()).toEqual(['a.ts', 'd.json']);
  });

  it('refuses an import that resolves to no file, naming both', () => {
    expect(() =>
      importClosure(['a.ts'], tree({ 'a.ts': "import './gone';" })),
    ).toThrow("a.ts imports './gone', which resolves to no file");
  });

  it('refuses a root that does not exist', () => {
    expect(() => importClosure(['gone.ts'], tree({}))).toThrow(
      'gone.ts is a root of the trace and does not exist',
    );
  });
});

describe('isCapturePath: whether a changed path can move a picture', () => {
  const reached = new Set(['tests/e2e/a.spec.ts', 'tests/viewports.ts']);

  it('counts a page source', () => {
    expect(isCapturePath('src/pages/index.astro', reached)).toBe(true);
  });

  it('counts a config at the root', () => {
    expect(isCapturePath('tsconfig.json', reached)).toBe(true);
  });

  it('counts a file in a directory nobody listed', () => {
    expect(isCapturePath('fonts/new.woff2', reached)).toBe(true);
  });

  it('counts the workflow that defines the capture job', () => {
    expect(isCapturePath('.github/workflows/ci.yml', reached)).toBe(true);
  });

  it('counts a test helper an e2e spec imports', () => {
    expect(isCapturePath('tests/viewports.ts', reached)).toBe(true);
  });

  it('counts a Markdown file below the root', () => {
    expect(isCapturePath('src/content/note.md', reached)).toBe(true);
  });

  it('leaves out a unit test', () => {
    expect(isCapturePath('tests/unit/a.test.ts', reached)).toBe(false);
  });

  it('leaves out a script no capture file imports', () => {
    expect(isCapturePath('scripts/board.mjs', reached)).toBe(false);
  });

  it('leaves out another workflow', () => {
    expect(isCapturePath('.github/workflows/deploy-dev.yml', reached)).toBe(
      false,
    );
  });

  it('leaves out a git hook', () => {
    expect(isCapturePath('.githooks/commit-msg', reached)).toBe(false);
  });

  it('leaves out documentation', () => {
    expect(isCapturePath('docs/runbooks/a.md', reached)).toBe(false);
  });

  it('leaves out a Markdown file at the root', () => {
    expect(isCapturePath('CLAUDE.md', reached)).toBe(false);
  });
});

describe('captureVerdict: whether the pull request runs the capture', () => {
  const reached = new Set(['tests/e2e/a.spec.ts']);

  it('runs it on an empty diff, which shows nothing', () => {
    expect(captureVerdict([], reached)).toEqual({
      capture: true,
      reasons: ['the diff is empty, so nothing shows the capture is untouched'],
    });
  });

  it('runs it when one path is read by the capture, naming that path', () => {
    expect(
      captureVerdict(
        [
          { status: 'M', paths: ['tests/unit/a.test.ts'] },
          { status: 'M', paths: ['src/pages/index.astro'] },
        ],
        reached,
      ),
    ).toEqual({
      capture: true,
      reasons: ['M src/pages/index.astro: the capture reads it'],
    });
  });

  it('runs it for a rename into the capture', () => {
    expect(
      captureVerdict(
        [{ status: 'R', paths: ['tests/old.ts', 'tests/e2e/a.spec.ts'] }],
        reached,
      ).capture,
    ).toBe(true);
  });

  it('skips it when every path is outside the capture', () => {
    expect(
      captureVerdict(
        [
          { status: 'M', paths: ['tests/unit/a.test.ts'] },
          { status: 'A', paths: ['scripts/board.mjs'] },
        ],
        reached,
      ),
    ).toEqual({ capture: false, reasons: [] });
  });
});

describe('captureFromDiff: the verdict on the checkout a run holds', () => {
  /** A git that answers the three questions a scope run asks. */
  const git =
    (diff: string, parents = 'merge base head') =>
    (args: readonly string[]) => {
      if (args[0] === 'rev-list') return `${parents}\n`;
      if (args[0] === 'ls-files') return 'tests/e2e/a.spec.ts\0';
      if (args.includes('diff')) return diff;
      throw new Error(`unexpected git ${args.join(' ')}`);
    };
  const entries = {
    'playwright.config.ts': '',
    'astro.config.mjs': '',
    'scripts/capture-coverage.mjs': '',
    'scripts/release-inventory.mjs': '',
    'scripts/test-e2e.mjs': '',
  };
  const files = tree({
    ...entries,
    'tests/e2e/a.spec.ts': "import { v } from '../viewports';",
    'tests/viewports.ts': '',
  });

  it('runs it on a run that is not a pull request', () => {
    expect(
      captureFromDiff({
        diff: pullRequestChanges({ event: 'workflow_dispatch', git: git('') }),
        git: git(''),
        ...files,
      }),
    ).toEqual({
      capture: true,
      reasons: [
        'a workflow_dispatch run is not a pull request, so it has no diff to judge',
      ],
    });
  });

  it('skips it on a pull request that changes only a unit test', () => {
    expect(
      captureFromDiff({
        diff: pullRequestChanges({
          event: 'pull_request',
          git: git('M\0tests/unit/a.test.ts\0'),
        }),
        git: git('M\0tests/unit/a.test.ts\0'),
        ...files,
      }),
    ).toEqual({ capture: false, reasons: [] });
  });

  it('runs it on a pull request that changes a helper an e2e spec imports', () => {
    expect(
      captureFromDiff({
        diff: pullRequestChanges({
          event: 'pull_request',
          git: git('M\0tests/viewports.ts\0'),
        }),
        git: git('M\0tests/viewports.ts\0'),
        ...files,
      }),
    ).toEqual({
      capture: true,
      reasons: ['M tests/viewports.ts: the capture reads it'],
    });
  });

  it('runs it when the trace cannot finish', () => {
    expect(
      captureFromDiff({
        diff: pullRequestChanges({
          event: 'pull_request',
          git: git('M\0tests/unit/a.test.ts\0'),
        }),
        git: git('M\0tests/unit/a.test.ts\0'),
        ...tree({ ...entries, 'tests/e2e/a.spec.ts': "import './gone';" }),
      }),
    ).toEqual({
      capture: true,
      reasons: [
        "the capture's files could not be traced: tests/e2e/a.spec.ts imports './gone', which resolves to no file",
      ],
    });
  });
});

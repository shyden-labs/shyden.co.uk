import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  awaitWriters,
  convertScripts,
  fileOf,
  indexCompileCache,
  ledgerNote,
  pairCacheFiles,
  readRaw,
  writerPid,
  type V8Script,
} from '../../scripts/coverage-processes.mjs';
import { PLAYWRIGHT_MEASURE } from '../coverage-options';

/**
 * Raw V8 coverage from a process Node ran outside Vitest's workers, converted
 * to the Istanbul shape `scripts/coverage-merge.mjs` joins (#899). The ranges
 * below were recorded from real runs of these two files under
 * `NODE_V8_COVERAGE` (Node 26.12, 2026-10-21 UTC): the `else` arm never ran.
 */
const ROOT = '/repo';

const JS = [
  'const ran = process.argv.length > 0;',
  'if (ran) {',
  '  globalThis.taken = 1;',
  '} else {',
  '  globalThis.taken = 2;',
  '}',
  '',
].join('\n');

const TS = [
  'const ran: boolean = process.argv.length > 0;',
  'if (ran) {',
  '  (globalThis as { taken?: number }).taken = 1;',
  '} else {',
  '  (globalThis as { taken?: number }).taken = 2;',
  '}',
  '',
].join('\n');

/** One script entry: its whole-script range ends at `end`, its `else` block never ran. */
const script = (
  url: string,
  end: number,
  elseBlock: [number, number],
): V8Script => ({
  url,
  functions: [
    {
      functionName: '',
      isBlockCoverage: true,
      ranges: [
        { startOffset: 0, endOffset: end, count: 1 },
        { startOffset: elseBlock[0], endOffset: elseBlock[1], count: 0 },
      ],
    },
  ],
});

const JS_URL = 'file:///repo/scripts/branch.mjs';
const TS_URL = 'file:///repo/scripts/branch.ts';
// Node appends `\n\n//# sourceURL=<url>` to TypeScript it strips: 164 + 46.
const jsEntry = script(JS_URL, 107, [73, 106]);
const tsEntry = script(TS_URL, 210, [106, 163]);

const texts: Record<string, string> = {
  'scripts/branch.mjs': JS,
  'scripts/branch.ts': TS,
};
const read = (file: string) => {
  const text = texts[file];
  if (text === undefined) throw new Error(`no fixture text for ${file}`);
  return text;
};

/** Each statement as `place=count`, in the report's own order. */
const statements = (report: Record<string, unknown>, file: string) => {
  const coverage = report[`${ROOT}/${file}`] as {
    statementMap: Record<
      string,
      {
        start: { line: number; column: number };
        end: { line: number; column: number | null };
      }
    >;
    s: Record<string, number>;
  };
  return Object.entries(coverage.statementMap).map(
    ([id, { start, end }]) =>
      `${start.line}:${start.column}-${end.line}:${end.column}=${coverage.s[id]}`,
  );
};

describe('raw V8 coverage from a process converts to the joined shape (#899)', () => {
  it('a plain .mjs entry gives each statement its count, the unrun arm 0', async () => {
    const result = await convertScripts([jsEntry], read, ROOT);
    expect(
      'report' in result && statements(result.report, 'scripts/branch.mjs'),
    ).toEqual(['1:12-1:35=1', '2:0-6:null=1', '3:2-3:null=1', '5:2-5:null=0']);
  });

  it('a TypeScript entry is read from its own text, past the suffix Node appends', async () => {
    const result = await convertScripts([tsEntry], read, ROOT);
    expect(
      'report' in result && statements(result.report, 'scripts/branch.ts'),
    ).toEqual(['1:21-1:44=1', '2:0-6:null=1', '3:2-3:null=1', '5:2-5:null=0']);
  });

  it('an entry whose code is not the file’s own text is skipped, naming why', async () => {
    const result = await convertScripts(
      [jsEntry, script(TS_URL, 300, [106, 163])],
      read,
      ROOT,
    );
    expect('report' in result && result.skipped).toEqual([
      {
        file: 'scripts/branch.ts',
        url: TS_URL,
        reason:
          'ran code 300 characters long, not its own text (164, or 210 with the sourceURL Node appends)',
      },
    ]);
  });

  it('two processes’ entries for one file are summed', async () => {
    const result = await convertScripts([jsEntry, jsEntry], read, ROOT);
    expect(
      'report' in result && statements(result.report, 'scripts/branch.mjs'),
    ).toEqual(['1:12-1:35=2', '2:0-6:null=2', '3:2-3:null=2', '5:2-5:null=0']);
  });

  // Measured 2026-10-22: for this text vite's `parse` returns one error and an
  // EMPTY program, so a converter that read only `program` would report the
  // file with no statements at all rather than fail.
  it('a file that does not parse is refused, naming the parser’s error', async () => {
    const broken = JS.replace('if (ran) {', 'if (ran) {{');
    const result = await convertScripts(
      [script('file:///repo/scripts/broken.mjs', broken.length, [74, 107])],
      (file) => (file === 'scripts/broken.mjs' ? broken : read(file)),
      ROOT,
    );
    expect(result).toEqual({
      refusal:
        'coverage-processes: scripts/broken.mjs does not parse (Unexpected token), so its counts have nowhere to go',
    });
  });

  it('nothing measured at all is refused, never written as an empty report', async () => {
    expect(await convertScripts([], read, ROOT)).toEqual({
      refusal:
        'coverage-processes: no process ran a measured file, so there is nothing to report',
    });
  });
});

/**
 * Vitest converts the module vite's SSR transform wrote, where an imported
 * `X.prop` reads `__vite_ssr_import_N__.X.prop`, and coverage-v8 5.0.5 ignores
 * every declarator initialised that way (`provider.js`, "SSR transformed
 * import binding"). The converter reads the file's own text, so it skips the
 * same declarators, or the two reports of a file would not join (#899, PR
 * #926: `scripts/dashboard.mjs` held 142 and 145). Which declarators Vitest
 * drops was measured on Vitest's own route for both texts below (2026-10-22,
 * `.superpowers/sdd/899/stmt-diff.mjs`); counting them is #928.
 */
const READS = [
  "import { env } from 'node:process';",
  "import processDefault from 'node:process';",
  "import * as nodePath from 'node:path';",
  'const fromNamed = env.HOME;',
  'const fromDefault = processDefault.pid;',
  'const fromNamespace = nodePath.sep;',
  'const whole = env;',
  'const deeper = env.HOME.length;',
  "const computed = env['HOME'];",
  'export const exported = env.PATH;',
  'function inner() {',
  '  const nested = env.USER;',
  '  return nested;',
  '}',
  'globalThis.out = [fromNamed, fromDefault, fromNamespace, whole, deeper, computed, inner()];',
  '',
].join('\n');
const SHADOW = [
  "import { env } from 'node:process';",
  'function read(env) {',
  '  const home = env.HOME;',
  '  return home;',
  '}',
  "globalThis.out = read({ HOME: '/' });",
  '',
].join('\n');
const REBOUND_UNREAD = [
  "import { join } from 'node:path';",
  'function wrap(join) {',
  '  return join;',
  '}',
  "globalThis.out = [wrap(1), join('a', 'b')];",
  '',
].join('\n');
const whole = (file: string, text: string) =>
  script(`file:///repo/${file}`, text.length, [text.length, text.length]);
const only = (file: string, text: string) => (name: string) => {
  if (name !== file) throw new Error(`no fixture text for ${name}`);
  return text;
};
const lines = (
  result: Awaited<ReturnType<typeof convertScripts>>,
  file: string,
) =>
  'report' in result
    ? statements(result.report, file).map((place) => place.split(':')[0])
    : result;

describe('a declarator read from an import counts as Vitest counts it (#899)', () => {
  it('skips one read from a named or default import, computed, exported or nested, and counts the rest', async () => {
    const file = 'scripts/reads.mjs';
    expect(
      lines(
        await convertScripts([whole(file, READS)], only(file, READS), ROOT),
        file,
      ),
    ).toEqual(['6', '7', '8', '13', '15']);
  });

  it('refuses a file that binds an import’s name again where such a read uses it', async () => {
    const file = 'scripts/shadow.mjs';
    expect(
      await convertScripts([whole(file, SHADOW)], only(file, SHADOW), ROOT),
    ).toEqual({
      refusal:
        'coverage-processes: scripts/shadow.mjs binds env again, and a declarator on line 3 reads env.HOME, so whether it reads the import (which Vitest skips) cannot be told',
    });
  });

  it('converts a file that binds an import’s name again where no such read uses it', async () => {
    const file = 'scripts/rebound.mjs';
    expect(
      lines(
        await convertScripts(
          [whole(file, REBOUND_UNREAD)],
          only(file, REBOUND_UNREAD),
          ROOT,
        ),
        file,
      ),
    ).toEqual(['3', '5']);
  });
});

describe('which file an entry is (#899)', () => {
  it('a URL with a query names the file before the query', () => {
    expect(
      fileOf(`${TS_URL}?fresh-import-o21ff6dltkj=0,file:///repo/x`, ROOT),
    ).toBe('scripts/branch.ts');
  });

  it('a file outside the repository is left out', () => {
    expect(fileOf('file:///elsewhere/scripts/branch.mjs', ROOT)).toBeNull();
  });

  it('a file outside the measured set is left out', () => {
    expect(fileOf('file:///repo/tests/unit/a.test.ts', ROOT)).toBeNull();
  });

  it('a node: built-in is left out', () => {
    expect(fileOf('node:internal/main/run_main_module', ROOT)).toBeNull();
  });

  it('a measured file outside the root’s own folders is left out', () => {
    expect(fileOf('file:///repo/node_modules/a/index.mjs', ROOT)).toBeNull();
  });

  it('a measured helper directly under tests/ is kept', () => {
    expect(fileOf('file:///repo/tests/device-pixels.ts', ROOT)).toBe(
      'tests/device-pixels.ts',
    );
  });

  it('a spec is left out of the shared set', () => {
    expect(fileOf('file:///repo/tests/e2e/board.spec.ts', ROOT)).toBeNull();
  });
});

/**
 * A Playwright run measures what its runner and workers load (#913): the
 * shared set, the Playwright configs, and every file under tests/, specs
 * and e2e helpers included. Only type declarations are left out.
 */
describe('which file a Playwright run’s entry is (#913)', () => {
  it.each([
    ['a spec', 'tests/e2e/board.spec.ts'],
    ['an e2e helper', 'tests/e2e/published-paths.ts'],
    ['a Playwright config', 'playwright.config.ts'],
    ['a sanity config', 'playwright.dev.config.ts'],
    ['a helper directly under tests/', 'tests/device-pixels.ts'],
    ['a script', 'scripts/test-e2e.mjs'],
  ])('keeps %s', (_, file) => {
    expect(fileOf(`file:///repo/${file}`, ROOT, PLAYWRIGHT_MEASURE)).toBe(file);
  });

  it.each([
    ['a type declaration', 'tests/e2e/globals.d.ts'],
    ['a config of another tool', 'vitest.config.ts'],
    ['a dependency', 'node_modules/@playwright/test/index.mjs'],
  ])('leaves out %s', (_, file) => {
    expect(fileOf(`file:///repo/${file}`, ROOT, PLAYWRIGHT_MEASURE)).toBeNull();
  });
});

/**
 * The converter's two packages, declared by Shyden's rulings ("Yes, if
 * needed" for the converter, #899; `vite` for its non-deprecated `parse`,
 * 2026-10-21) at the versions already installed under Vitest and Astro, as
 * `yaml` was in #157. An exact pin, because a range lets `npm install` on a
 * laptop resolve a release CI's `npm ci` never ran.
 */
describe('the converter’s packages are pinned to the versions installed (#899)', () => {
  const manifest = JSON.parse(readFileSync('package.json', 'utf8')) as {
    devDependencies: Record<string, string>;
  };
  const lock = JSON.parse(readFileSync('package-lock.json', 'utf8')) as {
    packages: Record<string, { version?: string }>;
  };

  it.each(['vite', 'ast-v8-to-istanbul'])(
    '%s is declared at exactly the version the lockfile installs',
    (name) => {
      expect([
        manifest.devDependencies[name],
        lock.packages[`node_modules/${name}`]?.version,
      ]).toEqual([
        expect.stringMatching(/^\d+\.\d+\.\d+$/),
        manifest.devDependencies[name],
      ]);
    },
  );
});

/**
 * Code a tool compiled before Node ran it: Playwright compiles TypeScript with
 * Babel and keeps each file's code and map in its compile cache (#913,
 * measured: 37 of 37 files found there, each code exactly the length V8 ran).
 * The fixture is a small compiled file and a real map back to its source.
 */
const HELPER_TS = [
  'const n: number = process.argv.length;',
  'if (n > 0) {',
  '  globalThis.x = 1;',
  '} else {',
  '  globalThis.x = 2;',
  '}',
  '',
].join('\n');
const HELPER_JS = HELPER_TS.replace(': number', '');
const HELPER_MAP = {
  version: 3,
  sources: ['helper.ts'],
  sourcesContent: [HELPER_TS],
  names: [],
  mappings: 'AAAA,MAAM,CAAS,GAAG;AAClB;AACA;AACA;AACA;AACA;',
};
const HELPER_URL = 'file:///repo/tests/helper.ts';
const compiledRead = (file: string) => {
  if (file !== 'tests/helper.ts')
    throw new Error(`no fixture text for ${file}`);
  return HELPER_TS;
};
const hashed = (code: string) =>
  `// ${createHash('sha1').update(code).digest('hex')}\n${code}`;
const cache = indexCompileCache([
  { js: hashed(HELPER_JS), map: JSON.stringify(HELPER_MAP) },
]);

describe('code a tool compiled converts through its cached map (#913)', () => {
  it('a compiled entry gives each source statement its count', async () => {
    const result = await convertScripts(
      [script(HELPER_URL, 95, [71, 94])],
      compiledRead,
      ROOT,
      { compiled: cache },
    );
    expect(
      'report' in result && statements(result.report, 'tests/helper.ts'),
    ).toEqual([
      '1:18-1:null=1',
      '2:0-6:null=1',
      '3:0-3:null=1',
      '5:0-5:null=0',
    ]);
  });

  it('a compiled copy that rebinds an import is refused, quoting the copy’s own text', async () => {
    // The types make the copy shorter than its source, so a refusal that
    // sliced the source at the copy's offsets would quote the wrong text.
    const source = [
      "import { env } from 'node:process';",
      'function read(env: { HOME: string }) {',
      '  const home = env.HOME;',
      '  return home;',
      '}',
      "globalThis.out = read({ HOME: '/' });",
      '',
    ].join('\n');
    const compiled = source.replace(': { HOME: string }', '');
    const url = 'file:///repo/tests/shadow-helper.ts';
    const result = await convertScripts(
      [script(url, compiled.length, [compiled.length, compiled.length])],
      (file) => {
        if (file !== 'tests/shadow-helper.ts')
          throw new Error(`no fixture text for ${file}`);
        return source;
      },
      ROOT,
      {
        compiled: indexCompileCache([
          {
            js: hashed(compiled),
            map: JSON.stringify({
              version: 3,
              sources: ['shadow-helper.ts'],
              sourcesContent: [source],
              names: [],
              mappings: 'AAAA;AACA;AACA;AACA;AACA;AACA',
            }),
          },
        ]),
      },
    );
    expect(result).toEqual({
      refusal:
        'coverage-processes: tests/shadow-helper.ts binds env again, and a declarator on line 3 reads env.HOME, so whether it reads the import (which Vitest skips) cannot be told',
    });
  });

  it('the cache entry is found by its source text, never by its file name', () => {
    expect([...cache.keys()]).toEqual([HELPER_TS]);
  });

  // With a cache, every entry the tool compiled must be found in it: one that
  // is not is a cache that lost an entry, never code to leave out quietly.
  it('a compiled entry of another length is refused, naming why', async () => {
    const result = await convertScripts(
      [jsEntry, script(HELPER_URL, 96, [71, 94])],
      (file) => (file === 'tests/helper.ts' ? HELPER_TS : read(file)),
      ROOT,
      { compiled: cache },
    );
    expect(result).toEqual({
      refusal:
        'coverage-processes: tests/helper.ts ran code 96 characters long, not its own text (103, or 147 with the sourceURL Node appends) nor any compiled copy cached (95)',
    });
  });

  it('an entry with no compiled copy cached at all is refused, naming it', async () => {
    const result = await convertScripts(
      [jsEntry, script(HELPER_URL, 96, [71, 94])],
      (file) => (file === 'tests/helper.ts' ? HELPER_TS : read(file)),
      ROOT,
      {
        compiled: new Map([
          ['another source', [{ code: 'x', map: HELPER_MAP }]],
        ]),
      },
    );
    expect(result).toEqual({
      refusal:
        'coverage-processes: tests/helper.ts ran code 96 characters long, not its own text (103, or 147 with the sourceURL Node appends) and no compiled copy of it is cached',
    });
  });

  it('a cache file with no hash line is refused', () => {
    expect(() =>
      indexCompileCache([
        { js: 'no hash line', map: JSON.stringify(HELPER_MAP) },
      ]),
    ).toThrow('coverage-processes: a compile-cache entry has no hash line');
  });

  it('a cache file whose code does not match its hash is refused', () => {
    expect(() =>
      indexCompileCache([
        {
          js: hashed(HELPER_JS).replace('x = 2', 'x = 3'),
          map: JSON.stringify(HELPER_MAP),
        },
      ]),
    ).toThrow(
      'coverage-processes: a compile-cache entry does not match its hash',
    );
  });

  it('a compiled copy that does not parse is refused, naming it', async () => {
    const broken = 'if (process.argv.length > 0 {';
    const result = await convertScripts(
      [script(HELPER_URL, broken.length, [0, broken.length])],
      compiledRead,
      ROOT,
      {
        compiled: indexCompileCache([
          { js: hashed(broken), map: JSON.stringify(HELPER_MAP) },
        ]),
      },
    );
    expect('refusal' in result && result.refusal).toMatch(
      /^coverage-processes: tests\/helper\.ts's compiled copy does not parse \(.+\), so its counts have nowhere to go$/,
    );
  });
});

/**
 * Issue 936: once in 16 integration runs, a raw file read as cut-off JSON and
 * the reader died with `Unexpected end of JSON input`, naming nothing. Node
 * writes each process's file at its exit, named `coverage-<pid>-<time>-<n>`,
 * so the reader waits for every writer it can name, and a file it still
 * cannot parse is refused with its name, size and writer.
 */
describe('which process wrote a raw file (#936)', () => {
  it("reads the pid from Node's file name", () => {
    expect(writerPid('coverage-4822-1792704304712-0.json')).toBe(4822);
  });

  it('names no pid for a file Node did not name', () => {
    expect(writerPid('coverage-final.json')).toBeUndefined();
  });
});

/** A clock that moves only when the reader pauses. */
const steppedClock = () => {
  let at = 0;
  const pauses: number[] = [];
  return {
    pauses,
    now: () => at,
    pause: async (ms: number) => {
      pauses.push(ms);
      at += ms;
    },
  };
};

describe('the reader waits for every writer still running (#936)', () => {
  it('does not wait when no writer runs', async () => {
    const clock = steppedClock();
    const waited = await awaitWriters(['coverage-11-1-0.json'], {
      ...clock,
      isRunning: () => false,
      ceilingMs: 30_000,
    });
    expect([waited, clock.pauses]).toEqual([{ waitedFor: [] }, []]);
  });

  it('waits until a running writer exits, then names it', async () => {
    const clock = steppedClock();
    const waited = await awaitWriters(
      ['coverage-11-1-0.json', 'coverage-12-1-0.json'],
      {
        ...clock,
        isRunning: (pid) => pid === 12 && clock.now() < 150,
        ceilingMs: 30_000,
      },
    );
    expect([waited, clock.pauses]).toEqual([{ waitedFor: [12] }, [50, 50, 50]]);
  });

  it('asks about a pid named by two files once per look', async () => {
    const clock = steppedClock();
    const asked: number[] = [];
    await awaitWriters(['coverage-7-1-0.json', 'coverage-7-2-1.json'], {
      ...clock,
      isRunning: (pid) => {
        asked.push(pid);
        return false;
      },
      ceilingMs: 30_000,
    });
    expect(asked).toEqual([7]);
  });

  it('refuses a writer still running at the ceiling, naming it', async () => {
    const clock = steppedClock();
    const waited = await awaitWriters(['coverage-12-1-0.json'], {
      ...clock,
      isRunning: () => true,
      ceilingMs: 200,
    });
    expect(waited).toEqual({
      refusal:
        'coverage-processes: process 12 was still running after 200 ms, so its raw coverage file may be unfinished (coverage-12-1-0.json)',
    });
  });
});

describe('a raw file that is not whole JSON is refused, naming it (#936)', () => {
  it('reads a whole file', () => {
    expect(readRaw('coverage-12-1-0.json', '{"result":[]}', false)).toEqual({
      result: [],
    });
  });

  it('names a cut-off file, its size and a writer that has exited', () => {
    expect(readRaw('coverage-12-1-0.json', '{"res', false)).toEqual({
      refusal:
        'coverage-processes: coverage-12-1-0.json (5 bytes, written by process 12, which has exited) is not whole JSON: Unterminated string in JSON at position 5 (line 1 column 6)',
    });
  });

  it('names an empty file and a writer still running', () => {
    expect(readRaw('coverage-12-1-0.json', '', true)).toEqual({
      refusal:
        'coverage-processes: coverage-12-1-0.json (0 bytes, written by process 12, which is still running) is not whole JSON: Unexpected end of JSON input',
    });
  });

  it('names a file with no pid in its name', () => {
    expect(readRaw('stray.json', '', false)).toEqual({
      refusal:
        'coverage-processes: stray.json (0 bytes, written by an unnamed process) is not whole JSON: Unexpected end of JSON input',
    });
  });
});

/**
 * Playwright's compile cache is a tree of `<name>_<hash>.js` beside its
 * `.map` (and a `.data` the converter does not read), under two-character
 * folders (#913, probe run 39668240107). Half a pair is a cache cut short.
 */
describe('the compile cache is read as pairs of code and map (#913)', () => {
  it('pairs each code file with its map, in any folder, and leaves the rest', () => {
    expect(
      pairCacheFiles([
        'ab/helper_ab12.js',
        'ab/helper_ab12.map',
        'ab/helper_ab12.data',
        'cd/spec_cd34.map',
        'cd/spec_cd34.js',
      ]),
    ).toEqual({
      pairs: [
        { js: 'ab/helper_ab12.js', map: 'ab/helper_ab12.map' },
        { js: 'cd/spec_cd34.js', map: 'cd/spec_cd34.map' },
      ],
    });
  });

  it('refuses code with no map, naming it', () => {
    expect(
      pairCacheFiles([
        'ab/helper_ab12.js',
        'cd/spec_cd34.js',
        'cd/spec_cd34.map',
      ]),
    ).toEqual({
      refusal:
        'coverage-processes: the compile cache holds ab/helper_ab12.js with no map beside it',
    });
  });

  it('refuses a map with no code, naming it', () => {
    expect(pairCacheFiles(['ab/helper_ab12.map'])).toEqual({
      refusal:
        'coverage-processes: the compile cache holds ab/helper_ab12.map with no code beside it',
    });
  });

  it('refuses a cache with no pair at all', () => {
    expect(pairCacheFiles(['ab/helper_ab12.data'])).toEqual({
      refusal:
        'coverage-processes: the compile cache holds no code with its map',
    });
  });
});

/**
 * A CI container runs the checkout at another path than the job that converts
 * it (#913). Each entry is placed in its checkout by the root it was recorded
 * under, and reported under this one; its URL is left as it ran, because Node
 * appended `//# sourceURL=` with that URL (PR #949's first run refused
 * `src/lib/is-record.ts` when the URL was moved first: 660 against 673).
 */
describe('an entry recorded in another checkout (#913)', () => {
  const RECORDED = 'file:///__w/site/scripts/branch.ts';
  // 164 characters of TypeScript, then the suffix with the URL it ran under.
  const recorded = script(
    RECORDED,
    164 + `\n\n//# sourceURL=${RECORDED}`.length,
    [106, 163],
  );

  it('converts against the URL it ran under, reported under this checkout', async () => {
    const result = await convertScripts([recorded], read, ROOT, {
      recordedRoot: '/__w/site',
    });
    expect(
      'report' in result && statements(result.report, 'scripts/branch.ts'),
    ).toEqual(['1:21-1:44=1', '2:0-6:null=1', '3:2-3:null=1', '5:2-5:null=0']);
  });

  it('leaves out a file outside the recorded root, and a sibling sharing its prefix', async () => {
    const result = await convertScripts(
      [
        { ...recorded, url: 'file:///__w/site-other/scripts/branch.ts' },
        { ...recorded, url: TS_URL },
      ],
      read,
      ROOT,
      { recordedRoot: '/__w/site' },
    );
    expect(result).toEqual({
      refusal:
        'coverage-processes: no process ran a measured file, so there is nothing to report',
    });
  });
});

/**
 * Issue 936: an empty raw file names only its writer's pid, and the writer is
 * gone by then. Every process a test starts writes a ledger line as it starts
 * (`tests/coverage-ledger.mjs`), so a refusal names the command too.
 */
describe('a refused raw file names the command that wrote it (#936)', () => {
  it('names the command the ledger holds for its pid', () => {
    expect(
      ledgerNote(
        10539,
        JSON.stringify({
          pid: 10539,
          argv: ['/usr/bin/node', 'playwright', 'test', '--list'],
        }),
      ),
    ).toBe(
      '; process 10539 was started as: /usr/bin/node playwright test --list',
    );
  });

  it('says so when no ledger line names it', () => {
    expect(ledgerNote(10539, undefined)).toBe(
      '; no ledger line names process 10539',
    );
  });

  it('says so when the ledger line cannot be read', () => {
    expect(ledgerNote(10539, '{"pid')).toBe(
      '; the ledger line for process 10539 is not whole JSON',
    );
  });

  it('names nothing for a file Node did not name by a pid', () => {
    expect(ledgerNote(undefined, undefined)).toBe('');
  });
});

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
  type VitestTool,
} from '../../scripts/coverage-processes.mjs';
import { PLAYWRIGHT_MEASURE } from '../coverage-options';
import { fixtureReader } from '../fixture-texts';
import { remap, vlq } from '../source-map-fixtures';

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
const read = fixtureReader(texts);

/** A map placing every character of `text` on itself, as base64 VLQ. */
const identityMap = (text: string, source: string) => {
  // Source line and column run on across lines; an empty line has no segment.
  let line = 0;
  let column = 0;
  const mappings = text
    .split('\n')
    .map((chars, index) =>
      chars
        .split('')
        .map((_, at) => {
          const segment =
            at === 0 ? [0, 0, index - line, -column] : [1, 0, 0, 1];
          line = index;
          column = at;
          return segment.map(vlq).join('');
        })
        .join(','),
    )
    .join(';');
  return { version: 3, sources: [source], names: [], mappings };
};
/**
 * Vitest's transform and converter, stood in for (#913): the transform is the
 * file's own text, mapped character by character onto itself, and the
 * converter is ast-v8-to-istanbul over vite's parse of it, what Vitest's
 * `remapCoverage` runs, without its SSR ignore rules, which have no SSR code
 * to act on here. `tests/integration/coverage-processes-script.test.ts` runs
 * the real pair.
 */
const OWN_TEXT: VitestTool = {
  transform: async (absolute, text) => ({
    code: text,
    map: identityMap(text, absolute.split('/').at(-1) ?? absolute),
  }),
  remap,
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
    const result = await convertScripts([jsEntry], read, ROOT, OWN_TEXT);
    expect(
      'report' in result && statements(result.report, 'scripts/branch.mjs'),
    ).toEqual(['1:12-1:35=1', '2:0-6:null=1', '3:2-3:null=1', '5:2-5:null=0']);
  });

  it('a TypeScript entry is read from its own text, past the suffix Node appends', async () => {
    const result = await convertScripts([tsEntry], read, ROOT, OWN_TEXT);
    expect(
      'report' in result && statements(result.report, 'scripts/branch.ts'),
    ).toEqual(['1:21-1:44=1', '2:0-6:null=1', '3:2-3:null=1', '5:2-5:null=0']);
  });

  it('an entry whose code is not the file’s own text is skipped, naming why', async () => {
    const result = await convertScripts(
      [jsEntry, script(TS_URL, 300, [106, 163])],
      read,
      ROOT,
      OWN_TEXT,
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

  it('a JavaScript entry not its own text names the one length its text has', async () => {
    const result = await convertScripts(
      [jsEntry, script(JS_URL, 300, [70, 106])],
      read,
      ROOT,
      OWN_TEXT,
    );
    expect('report' in result && result.skipped).toEqual([
      {
        file: 'scripts/branch.mjs',
        url: JS_URL,
        reason: 'ran code 300 characters long, not its own text (107)',
      },
    ]);
  });

  it('two processes’ entries for one file are summed', async () => {
    const result = await convertScripts(
      [jsEntry, jsEntry],
      read,
      ROOT,
      OWN_TEXT,
    );
    expect(
      'report' in result && statements(result.report, 'scripts/branch.mjs'),
    ).toEqual(['1:12-1:35=2', '2:0-6:null=2', '3:2-3:null=2', '5:2-5:null=0']);
  });

  it('a transform that throws is refused, naming the file and the error', async () => {
    const result = await convertScripts([jsEntry], read, ROOT, {
      ...OWN_TEXT,
      transform: async () => {
        throw new Error('Unexpected token');
      },
    });
    expect(result).toEqual({
      refusal:
        'coverage-processes: scripts/branch.mjs cannot be transformed as Vitest transforms it (Unexpected token), so its counts have nowhere to go',
    });
  });

  it('a transform whose map cannot be read is refused, naming the file', async () => {
    const result = await convertScripts([jsEntry], read, ROOT, {
      ...OWN_TEXT,
      transform: async () => ({
        code: JS,
        map: {
          version: 3,
          sources: ['a.mjs', 'b.mjs'],
          names: [],
          mappings: '',
        },
      }),
    });
    expect(result).toEqual({
      refusal:
        'coverage-processes: scripts/branch.mjs: carry-counts: Vitest’s transform’s map names 2 sources (a.mjs, b.mjs), not this file alone, so its tokens cannot all be placed in it',
    });
  });

  it('a converter that returns no file is refused, naming it', async () => {
    const result = await convertScripts([jsEntry], read, ROOT, {
      ...OWN_TEXT,
      remap: async () => ({}),
    });
    expect(result).toEqual({
      refusal:
        'coverage-processes: scripts/branch.mjs gave Vitest’s converter nothing to report, so its counts have nowhere to go',
    });
  });

  it('the converter is given the entry’s URL, the transform and the counts placed on it', async () => {
    const calls: unknown[][] = [];
    const transformed = { code: 'X', map: identityMap('X', 'branch.mjs') };
    await convertScripts([jsEntry], read, ROOT, {
      transform: async () => transformed,
      remap: async (...args) => {
        calls.push(args);
        return {};
      },
    });
    expect(calls).toEqual([
      [
        JS_URL,
        transformed,
        [
          {
            functionName: '',
            isBlockCoverage: true,
            ranges: [{ startOffset: 0, endOffset: 1, count: 1 }],
          },
        ],
      ],
    ]);
  });

  it('no Vitest to convert on is refused', async () => {
    expect(
      await convertScripts([jsEntry], read, ROOT, undefined as never),
    ).toEqual({
      refusal:
        'coverage-processes: no Vitest transform was given, so no count can be placed where Vitest’s report places it',
    });
  });

  it('nothing measured at all is refused, never written as an empty report', async () => {
    expect(await convertScripts([], read, ROOT, OWN_TEXT)).toEqual({
      refusal:
        'coverage-processes: no process ran a measured file, so there is nothing to report',
    });
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

  // The conversion calls methods Vitest and its v8 provider do not declare
  // (#913), and the unit stand-in calls vite and ast-v8-to-istanbul.
  it.each(['vitest', '@vitest/coverage-v8', 'vite', 'ast-v8-to-istanbul'])(
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
const compiledRead = fixtureReader({ 'tests/helper.ts': HELPER_TS });
const hashed = (code: string) =>
  `// ${createHash('sha1').update(code).digest('hex')}\n${code}`;
const cache = indexCompileCache([
  { js: hashed(HELPER_JS), map: JSON.stringify(HELPER_MAP) },
]);

describe('code a tool compiled converts onto the file’s own text (#913)', () => {
  // Placed as the own text is, never as Babel's copy is: the copy adds
  // statements and arms Vitest's report does not hold (#913, 2026-10-27).
  it('a compiled entry gives each statement of the own text its count', async () => {
    const result = await convertScripts(
      [script(HELPER_URL, 95, [71, 94])],
      compiledRead,
      ROOT,
      OWN_TEXT,
      { compiled: cache },
    );
    expect(
      'report' in result && statements(result.report, 'tests/helper.ts'),
    ).toEqual(['1:18-1:37=1', '2:0-6:null=1', '3:2-3:null=1', '5:2-5:null=0']);
  });

  it('a compiled entry is placed exactly where an own-text entry of the file is', async () => {
    const elseBlock = HELPER_TS.indexOf('{', HELPER_TS.indexOf('else'));
    const [compiled, own] = await Promise.all([
      convertScripts(
        [script(HELPER_URL, 95, [71, 94])],
        compiledRead,
        ROOT,
        OWN_TEXT,
        {
          compiled: cache,
        },
      ),
      convertScripts(
        [
          script(HELPER_URL, HELPER_TS.length, [
            elseBlock,
            HELPER_TS.lastIndexOf('}') + 1,
          ]),
        ],
        compiledRead,
        ROOT,
        OWN_TEXT,
      ),
    ]);
    expect('report' in compiled && compiled.report).toEqual(
      'report' in own && own.report,
    );
  });

  // `if (x) return;` with nothing mapped after `return` until the next line:
  // the converter reads the braceless consequent one past its start, inside
  // `return`, which must keep `return`'s count (2026-10-27: nine branches of
  // src/lib/grouping.ts read their arms swapped until it did).
  it('a braceless consequent reads its own count, not the next line’s', async () => {
    const BARE_TS = [
      'export function check(x: unknown): void {',
      '  if (x) return;',
      '  globalThis.seen = x;',
      '}',
      '',
    ].join('\n');
    const BARE_JS = BARE_TS.replace(': unknown): void', ')');
    const result = await convertScripts(
      [
        {
          url: 'file:///repo/tests/bare.ts',
          functions: [
            {
              functionName: '',
              isBlockCoverage: true,
              ranges: [{ startOffset: 0, endOffset: BARE_JS.length, count: 1 }],
            },
            {
              functionName: 'check',
              isBlockCoverage: true,
              ranges: [
                {
                  startOffset: BARE_JS.indexOf('function'),
                  endOffset: BARE_JS.lastIndexOf('}') + 1,
                  count: 3,
                },
                {
                  startOffset: BARE_JS.indexOf('return'),
                  endOffset: BARE_JS.indexOf('return;') + 8,
                  count: 0,
                },
              ],
            },
          ],
        },
      ],
      fixtureReader({ 'tests/bare.ts': BARE_TS }),
      ROOT,
      OWN_TEXT,
      {
        compiled: indexCompileCache([
          {
            js: hashed(BARE_JS),
            map: JSON.stringify({
              version: 3,
              sources: ['bare.ts'],
              sourcesContent: [BARE_TS],
              names: ['check', 'x', 'globalThis', 'seen'],
              mappings:
                'AAAA,OAAO,SAASA,KAAKA,CAACC,CAAU,EAAQ;EACtC,IAAIA,CAAC,EAAE;EACPC,UAAU,CAACC,IAAI,GAAGF,CAAC;AACrB',
            }),
          },
        ]),
      },
    );
    const coverage =
      'report' in result ? result.report[`${ROOT}/tests/bare.ts`] : undefined;
    expect([coverage?.b, coverage?.f]).toEqual([{ 0: [0, 3] }, { 0: 3 }]);
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
      OWN_TEXT,
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
      OWN_TEXT,
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

  it('a cached map with no source text is left out, so the code it compiled is refused', async () => {
    const sourceless = [
      {
        js: hashed(HELPER_JS),
        map: JSON.stringify({ ...HELPER_MAP, sourcesContent: undefined }),
      },
      {
        js: hashed(HELPER_JS),
        map: JSON.stringify({ ...HELPER_MAP, sourcesContent: [null] }),
      },
    ];
    const other = 'export const other = 1;\n';
    const beside = indexCompileCache([
      ...sourceless,
      {
        js: hashed(other),
        map: JSON.stringify({ ...HELPER_MAP, sourcesContent: [other] }),
      },
    ]);
    expect([...beside.keys()]).toEqual([other]);
    const withoutSource = indexCompileCache(sourceless);
    const result = await convertScripts(
      [jsEntry, script(HELPER_URL, 95, [71, 94])],
      (file) => (file === 'tests/helper.ts' ? HELPER_TS : read(file)),
      ROOT,
      OWN_TEXT,
      { compiled: withoutSource },
    );
    expect(result).toEqual({
      refusal:
        'coverage-processes: tests/helper.ts ran code 95 characters long, not its own text (103, or 147 with the sourceURL Node appends) and no compiled copy of it is cached',
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

  it('a compiled copy whose map cannot be read is refused, naming the file', async () => {
    const result = await convertScripts(
      [script(HELPER_URL, 95, [71, 94])],
      compiledRead,
      ROOT,
      OWN_TEXT,
      {
        compiled: indexCompileCache([
          {
            js: hashed(HELPER_JS),
            map: JSON.stringify({ ...HELPER_MAP, mappings: 'AA!A' }),
          },
        ]),
      },
    );
    expect(result).toEqual({
      refusal:
        'coverage-processes: tests/helper.ts: carry-counts: the map’s mappings hold "!" at 2, which is not base64, so no position can be read from them',
    });
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
    const result = await convertScripts([recorded], read, ROOT, OWN_TEXT, {
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
      OWN_TEXT,
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

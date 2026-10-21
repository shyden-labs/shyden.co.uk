import { describe, expect, it } from 'vitest';
import {
  convertScripts,
  fileOf,
  type V8Script,
} from '../../scripts/coverage-processes.mjs';

/**
 * Raw V8 coverage from a process Node ran outside Vitest's workers, converted
 * to the Istanbul shape `scripts/coverage-merge.mjs` joins (#899). The ranges
 * below were recorded from real runs of these two files under
 * `NODE_V8_COVERAGE` (Node 26.12, 2026-10-22): the `else` arm never ran.
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

  it('nothing measured at all is refused, never written as an empty report', async () => {
    expect(await convertScripts([], read, ROOT)).toEqual({
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
});

import { describe, it, expect } from 'vitest';
import { spawnSync } from 'node:child_process';
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import ts from 'typescript';
import { floorBreach, readFloors, FLOORS_FILE, RECORD_ENV } from '../floors';
import { searched, specFilesUnder } from '../source-files';
import { parseFile } from './ast';
import {
  decideRecord,
  describeMoves,
  floorSpecs,
  floorsText,
  playwrightRecordArgs,
  RECORD_DIR_PREFIX,
  runRefusal,
} from '../../scripts/record-floors.mjs';
import { localImage } from '../../scripts/playwright-image.mjs';

/**
 * The ratchet on guard liveness floors (#468): a floor is a recorded figure,
 * checked for equality, so a reader that loses one unit fails AND a
 * population that grew fails until the figure is recorded. Growth used to
 * pass in silence: `absence-liveness` was set to `> 420` against a real 421
 * in #467 and read 424 an hour after it merged.
 */
describe('floorBreach', () => {
  const judging = { floors: { 'guard/units': 10 }, record: null };

  it('says nothing when the reader saw exactly the recorded figure', () => {
    expect(floorBreach('guard/units', 10, judging)).toBeUndefined();
  });

  it('names a reader that came back one short, and the hand edit a shrink needs', () => {
    expect(floorBreach('guard/units', 9, judging)).toBe(
      'guard/units: read 9, recorded 10. The reader lost 1, or the corpus ' +
        'shrank: if it shrank, lower the figure in tests/floors.json by hand ' +
        'and say why in the commit.',
    );
  });

  it('names a population that grew, and the command that records it', () => {
    expect(floorBreach('guard/units', 11, judging)).toBe(
      'guard/units: read 11, recorded 10. The population grew by 1: run ' +
        'npm run floors:record, read what it moved, and commit tests/floors.json.',
    );
  });

  it('refuses an id nobody recorded', () => {
    expect(floorBreach('guard/other', 10, judging)).toBe(
      'guard/other is not recorded in tests/floors.json: run npm run floors:record',
    );
  });

  it('names the file it reads the figures from', () => {
    expect(FLOORS_FILE).toBe('tests/floors.json');
  });

  // One test per value and mode, never a loop inside one (one-test-per-case).
  it.each(
    (
      [
        ['a fraction', 9.5],
        ['a negative', -1],
        ['NaN', Number.NaN],
        ['infinity', Number.POSITIVE_INFINITY],
      ] as const
    ).flatMap(([what, actual]) =>
      (['judging', 'recording'] as const).map(
        (mode) => [what, mode, actual] as const,
      ),
    ),
  )('refuses %s as a count while %s', (_, mode, actual) => {
    const dir = mkdtempSync(join(tmpdir(), 'floors-'));
    try {
      const record = mode === 'recording' ? join(dir, 'seen.jsonl') : null;
      expect(floorBreach('guard/units', actual, { ...judging, record })).toBe(
        `guard/units: ${actual} is not a count`,
      );
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('in record mode, writes what it saw and where, and lets the run go on', () => {
    const dir = mkdtempSync(join(tmpdir(), 'floors-'));
    try {
      const record = join(dir, 'seen.jsonl');
      expect(
        floorBreach('guard/units', 12, { ...judging, record }),
      ).toBeUndefined();
      expect(
        floorBreach('guard/new', 3, { ...judging, record }),
      ).toBeUndefined();
      const lines = readFileSync(record, 'utf8')
        .trimEnd()
        .split('\n')
        .map((line) => JSON.parse(line) as Record<string, unknown>);
      const here = expect.stringMatching(/^tests\/unit\/floors\.test\.ts:\d+$/);
      expect(lines).toEqual([
        { id: 'guard/units', actual: 12, site: here },
        { id: 'guard/new', actual: 3, site: here },
      ]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('reads the recorded figures as whole numbers keyed by id', () => {
    const recorded = Object.entries(readFloors());
    const malformed = recorded
      .filter(
        ([id, measured]) =>
          !/^[a-z0-9-]+(\/[a-z0-9-]+)+$/.test(id) ||
          !Number.isInteger(measured) ||
          measured < 0,
      )
      .map(([id]) => id);
    expect(
      searched(malformed, {
        of: recorded.map(([id]) => id),
        what: `ids in ${FLOORS_FILE}`,
      }),
    ).toEqual([]);
  });
});

describe('decideRecord', () => {
  const at = (id: string, actual: number, site = 'tests/unit/a.test.ts:1') => ({
    id,
    actual,
    site,
  });

  it('keeps every figure the run saw unchanged', () => {
    expect(decideRecord({ 'a/b': 4 }, [at('a/b', 4)])).toEqual({
      next: { 'a/b': 4 },
      refusals: [],
    });
  });

  it('raises a figure that grew and adds an id seen for the first time', () => {
    expect(
      decideRecord({ 'a/b': 4 }, [at('a/b', 6), at('c/d', 2, 'x.ts:9')]),
    ).toEqual({ next: { 'a/b': 6, 'c/d': 2 }, refusals: [] });
  });

  it('never lowers a figure: a fall is a blind reader until a person says otherwise', () => {
    const { refusals } = decideRecord({ 'a/b': 4, 'c/d': 1 }, [
      at('a/b', 3),
      at('c/d', 2, 'x.ts:9'),
    ]);
    expect(refusals).toHaveLength(1);
    expect(refusals[0]).toContain('a/b');
    expect(refusals[0]).toContain('would fall from 4 to 3');
  });

  it('refuses a recorded id the run never asserted', () => {
    const { refusals } = decideRecord({ 'a/b': 4, 'gone/x': 7 }, [
      at('a/b', 4),
    ]);
    expect(refusals).toHaveLength(1);
    expect(refusals[0]).toContain('gone/x');
    expect(refusals[0]).toContain('no test asserted it');
  });

  it('refuses an id asserted from two places', () => {
    const { refusals } = decideRecord({}, [
      at('a/b', 4, 'tests/unit/a.test.ts:1'),
      at('a/b', 4, 'tests/unit/b.test.ts:2'),
    ]);
    expect(refusals).toHaveLength(1);
    expect(refusals[0]).toContain('a/b');
    expect(refusals[0]).toContain('tests/unit/a.test.ts:1');
    expect(refusals[0]).toContain('tests/unit/b.test.ts:2');
  });

  it('refuses an id that read two different values', () => {
    const { refusals } = decideRecord({}, [at('a/b', 4), at('a/b', 5)]);
    expect(refusals).toHaveLength(1);
    expect(refusals[0]).toContain('a/b');
    expect(refusals[0]).toContain('4, 5');
  });

  it('accepts one id read twice from one place with one value', () => {
    expect(decideRecord({}, [at('a/b', 4), at('a/b', 4)])).toEqual({
      next: { 'a/b': 4 },
      refusals: [],
    });
  });

  it('reports every refusal at once, not the first', () => {
    const { refusals } = decideRecord({ 'a/b': 4, 'gone/x': 1 }, [
      at('a/b', 3),
      at('c/d', 1),
      at('c/d', 2),
    ]);
    expect(refusals).toHaveLength(3);
  });
});

describe('describeMoves', () => {
  it('says nothing when no figure moved', () => {
    expect(describeMoves({ 'a/b': 4 }, { 'a/b': 4 })).toEqual([]);
  });

  it('prints every figure that moved, its delta, largest first, so a raise is read', () => {
    // A change that adds five units and quietly loses three records +2 and
    // nothing goes red; only a person reading the delta against the diff
    // can see it, so the recorder shows each one (operator, 2026-10-03).
    expect(
      describeMoves(
        { 'a/b': 4, 'c/d': 100, 'e/f': 7 },
        { 'a/b': 6, 'c/d': 125, 'e/f': 7, 'g/h': 3 },
      ),
    ).toEqual(['c/d: 100 -> 125 (+25)', 'g/h: new, 3', 'a/b: 4 -> 6 (+2)']);
  });
});

describe('floorsText', () => {
  it('writes ids sorted, two-space indented, with a final newline', () => {
    expect(floorsText({ 'z/a': 2, 'a/z': 1 })).toBe(
      '{\n  "a/z": 1,\n  "z/a": 2\n}\n',
    );
  });
});

describe('record-floors.mjs refuses a run it cannot trust, and writes nothing', () => {
  // None runs a suite: a stand-in at the process boundary, the one place a
  // failing run can be had on demand, answers for `npx` (the unit suite) and
  // `docker` (the Playwright run, #475). PATH holds the stand-ins and
  // nothing else. Each reads the real record before and after.
  const DOCKER_VERSION_ONLY =
    '#!/bin/sh\n[ "$1" = --version ] && exit 0\nexit 9\n';
  const PASSING_NPX = '#!/bin/sh\nexit 0\n';

  /**
   * A `docker` that answers `--version`, then appends `lines` to the record
   * file it was handed as `FLOORS_RECORD=/work/<path>` (the checkout is the
   * stand-in's cwd, as it is /work in the container), notes that path beside
   * itself, and exits `status`. `${0%/*}` is its own directory: PATH holds
   * no `dirname`.
   */
  const dockerWriting = (lines: readonly string[], status: number) =>
    [
      '#!/bin/sh',
      '[ "$1" = --version ] && exit 0',
      'for a; do case "$a" in FLOORS_RECORD=/work/*) f="${a#FLOORS_RECORD=/work/}";; esac; done',
      'printf "%s\\n" "$f" > "${0%/*}/record-path"',
      ...lines.map((line) => `printf '%s\\n' '${line}' >> "$f"`),
      `exit ${status}`,
    ].join('\n') + '\n';

  const recordWith = (bin: Readonly<Record<string, string>>) => {
    const dir = mkdtempSync(join(tmpdir(), 'floors-path-'));
    const before = readFileSync(FLOORS_FILE);
    try {
      for (const [name, script] of Object.entries(bin))
        writeFileSync(join(dir, name), script, { mode: 0o755 });
      const run = spawnSync(process.execPath, ['scripts/record-floors.mjs'], {
        encoding: 'utf8',
        env: { ...process.env, CI: '', PATH: dir },
      });
      expect(readFileSync(FLOORS_FILE).equals(before), FLOORS_FILE).toBe(true);
      const handed = join(dir, 'record-path');
      const recordPath = existsSync(handed)
        ? readFileSync(handed, 'utf8').trimEnd()
        : undefined;
      return { ...run, recordPath };
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  };

  it('refuses a unit suite that did not start, naming why', () => {
    const run = recordWith({ docker: DOCKER_VERSION_ONLY });
    expect(run.status).toBe(1);
    expect(run.stderr).toBe(
      '✗ the unit suite did not start: spawnSync npx ENOENT\n',
    );
    expect(run.stdout).toBe('');
  });

  it('refuses a unit suite that failed, before judging a single figure', () => {
    const run = recordWith({
      docker: DOCKER_VERSION_ONLY,
      npx: '#!/bin/sh\nexit 3\n',
    });
    expect(run.status).toBe(1);
    expect(run.stderr).toBe(
      '✗ the unit suite failed in record mode (exit 3): nothing recorded\n',
    );
    expect(run.stdout).toBe('');
  });

  it('refuses a Playwright run that cannot start, before the unit suite runs', () => {
    // No `docker` on PATH, and no `npx` either: the unit suite would have
    // been refused had it been reached, so this message proves it never was.
    const run = recordWith({});
    expect(run.status).toBe(1);
    expect(run.stderr).toBe(
      '✗ the Playwright run did not start: spawnSync docker ENOENT\n',
    );
    expect(run.stdout).toBe('');
  });

  it('refuses a Playwright run that failed, and leaves no scratch directory', () => {
    const run = recordWith({ npx: PASSING_NPX, docker: dockerWriting([], 4) });
    expect(run.status).toBe(1);
    expect(run.stderr).toBe(
      '✗ the Playwright run failed in record mode (exit 4): nothing recorded\n',
    );
    expect(run.stdout).toBe(
      `Recording the Playwright floors in ${localImage()}: ` +
        `${floorSpecs().join(' ')}\n`,
    );
    // Handed a file in a scratch directory at the checkout's root, which
    // the container mounts, and gone once the run is refused.
    const handed = run.recordPath ?? '';
    expect(basename(handed)).toBe('e2e.jsonl');
    expect(dirname(dirname(handed))).toBe('.');
    expect(basename(dirname(handed)).slice(0, RECORD_DIR_PREFIX.length)).toBe(
      RECORD_DIR_PREFIX,
    );
    expect(existsSync(dirname(handed)), 'the scratch directory').toBe(false);
  });

  it('judges what the Playwright run saw together with the unit run', () => {
    // The container's record is read and handed to decideRecord: a figure it
    // would lower is refused by name, as a unit one is. The id is read from
    // the record, never spelled: each is spelled once under tests/.
    const [id] = Object.keys(readFloors());
    const run = recordWith({
      npx: PASSING_NPX,
      docker: dockerWriting(
        [JSON.stringify({ id, actual: 0, site: 'tests/e2e/a.spec.ts:1' })],
        0,
      ),
    });
    expect(run.status).toBe(1);
    expect(run.stderr.split('\n').filter((line) => line.includes(id))).toEqual([
      `  ${id} would fall from ${readFloors()[id]} to 0: a blind reader looks ` +
        `like this. If the corpus really shrank, lower it in ${FLOORS_FILE} ` +
        'by hand and say why in the commit.',
    ]);
    expect(
      existsSync(dirname(run.recordPath ?? '')),
      'the scratch directory',
    ).toBe(false);
  });
});

describe('the recorder trusts a Playwright run exactly as it trusts a unit run (#475)', () => {
  // One function judges both, so "exactly as" is the code, not a promise.
  it.each(['unit suite', 'Playwright run'])(
    '%s: one that did not start is refused, naming why',
    (suite) => {
      expect(
        runRefusal(suite, { status: null, error: new Error('spawn x ENOENT') }),
      ).toBe(`the ${suite} did not start: spawn x ENOENT`);
    },
  );

  it.each(['unit suite', 'Playwright run'])(
    '%s: one that failed is refused, naming its exit',
    (suite) => {
      expect(runRefusal(suite, { status: 2, error: undefined })).toBe(
        `the ${suite} failed in record mode (exit 2): nothing recorded`,
      );
    },
  );

  it.each(['unit suite', 'Playwright run'])(
    '%s: one killed by a signal is refused, with no exit to name',
    (suite) => {
      expect(runRefusal(suite, { status: null, error: undefined })).toBe(
        `the ${suite} failed in record mode (exit null): nothing recorded`,
      );
    },
  );

  it('trusts a run that exited 0', () => {
    expect(
      runRefusal('Playwright run', { status: 0, error: undefined }),
    ).toBeUndefined();
  });
});

describe('the Playwright record run (#475)', () => {
  const IMAGE = 'floors.test:image';
  const argsFor = (record: string, specs = ['tests/e2e/a.spec.ts']) =>
    playwrightRecordArgs({ image: IMAGE, cwd: '/repo', record, specs });

  it('runs in the pinned image on CI architecture, like the visual suite', () => {
    const argv = argsFor('/repo/.floors-record-x/e2e.jsonl');
    expect(argv.indexOf('--platform')).toBeGreaterThan(-1);
    expect(argv[argv.indexOf('--platform') + 1]).toBe('linux/amd64');
    expect(argv.indexOf('--platform')).toBeLessThan(argv.indexOf(IMAGE));
  });

  it('hands the container the record file at its path inside the container', () => {
    const argv = argsFor('/repo/.floors-record-x/e2e.jsonl');
    const flag = argv.indexOf(`${RECORD_ENV}=/work/.floors-record-x/e2e.jsonl`);
    expect(flag).toBeGreaterThan(0);
    expect(argv[flag - 1]).toBe('-e');
    expect(flag).toBeLessThan(argv.indexOf(IMAGE));
  });

  it('refuses a record file outside the checkout, which the container cannot see', () => {
    expect(() => argsFor('/tmp/e2e.jsonl')).toThrow(
      '/tmp/e2e.jsonl is outside /repo, where the container cannot write it',
    );
  });

  it('refuses no specs, which Playwright would read as every spec', () => {
    expect(() => argsFor('/repo/.floors-record-x/e2e.jsonl', [])).toThrow(
      'no Playwright spec calls floorBreach',
    );
  });

  it('runs every project over exactly the specs, one worker, rewriting nothing', () => {
    const specs = ['tests/e2e/a.spec.ts', 'tests/e2e/b c.spec.ts'];
    const argv = argsFor('/repo/.floors-record-x/e2e.jsonl', specs);
    const at = argv.indexOf(IMAGE);
    expect(argv.slice(at + 1, at + 3), 'the container runs `sh -c`').toEqual([
      'sh',
      '-c',
    ]);
    expect(argv[at + 3]).toMatch(/ && npx playwright test --workers=1 "\$@"$/);
    expect(argv.slice(at + 4)).toEqual(['sh', ...specs]);
  });
});

describe('floorSpecs', () => {
  it('names every Playwright spec that calls floorBreach, as the parse tree reads them', () => {
    // A second reading (#469): the call in each spec's parse tree, where
    // floorSpecs reads text. A spec reached by an alias, or a walk that
    // missed a directory, puts the two apart.
    const calls = (node: ts.Node): boolean =>
      (ts.isCallExpression(node) &&
        ts.isIdentifier(node.expression) &&
        node.expression.text === 'floorBreach') ||
      (ts.forEachChild(node, (child) => calls(child) || undefined) ?? false);
    const parsed = specFilesUnder('tests/e2e')
      .filter((file) => calls(parseFile(file)))
      .sort();
    expect(floorSpecs()).toEqual(parsed);
    // A known positive, so two readers blind alike cannot agree on nothing.
    const known = 'tests/e2e/copy-reaches-a-page.spec.ts';
    expect(parsed.filter((file) => file === known)).toEqual([known]);
  });
});

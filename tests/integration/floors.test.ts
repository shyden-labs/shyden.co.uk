import { describe, it, expect } from 'vitest';
import { spawnSync } from 'node:child_process';
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import { readFloors, FLOORS_FILE } from '../floors';
import {
  carriedIds,
  carriedLines,
  DEVICE_DIR,
  DEVICE_SUFFIX,
  floorSpecs,
  floorsText,
  RECORD_DIR_PREFIX,
} from '../../scripts/record-floors.mjs';
import { DOCKERFILE, localImage } from '../../scripts/playwright-image.mjs';

/** The recorder by absolute path: its tests run it from a scratch checkout. */
const RECORDER = join(process.cwd(), 'scripts', 'record-floors.mjs');

describe('record-floors.mjs refuses a run it cannot trust, and writes nothing', () => {
  // None runs a suite: a stand-in at the process boundary, the one place a
  // failing run can be had on demand, answers for `npx` (the unit suite) and
  // `docker` (the Playwright run, #475). PATH holds the stand-ins and
  // nothing else. Each reads the real record before and after.
  const DOCKER_VERSION_ONLY =
    '#!/bin/sh\n[ "$1" = --version ] && exit 0\nexit 9\n';
  const PASSING_NPX = '#!/bin/sh\nexit 0\n';
  /**
   * A `git` that answers the untracked-file listing the recorder asks for
   * first (#547) with nothing, and fails anything else: every test below that
   * plants no `git` of its own has a tree with nothing untracked, and no other
   * git question can be answered by accident.
   */
  const NOTHING_UNTRACKED_GIT =
    '#!/bin/sh\n[ "$1" = ls-files ] && exit 0\nexit 9\n';

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

  /**
   * The functions suite's floor spec in the scratch checkout, and the figures
   * the record holds for the ids it spells (#610): a stand-in for the real
   * ones, so these tests judge the recorder and not today's functions specs.
   */
  const PLANTED_FUNCTIONS_SPEC = 'tests/functions/planted.spec.ts';
  const FN_SITE = 'tests/functions/planted.spec.ts:1';
  const plantedSpec = (ids: readonly string[]) =>
    // Always one call, so the recorder finds a functions floor spec even
    // where a test spells no recorded id.
    ['probe/planted', ...ids]
      .map((id) => `expect(floorBreach('${id}', 1)).toBeUndefined();`)
      .join('\n') + '\n';

  /**
   * An `npm` that appends `lines` to the file `FLOORS_RECORD` names (an
   * absolute path on the host: the functions suite is not run in the
   * container), then exits `status`.
   */
  const npmWriting = (lines: readonly string[], status: number) =>
    [
      '#!/bin/sh',
      ...lines.map((line) => `printf '%s\\n' '${line}' >> "$FLOORS_RECORD"`),
      `exit ${status}`,
    ].join('\n') + '\n';

  /**
   * The recorded ids the unit suite owns once `recorded` is added to the
   * record: every id no Playwright spec, functions spec or iPhone journey
   * (#623) spells whole.
   */
  const recordedKeys = (recorded: Readonly<Record<string, number>>) =>
    Object.keys(JSON.parse(floorsText({ ...readFloors(), ...recorded })));
  /** The iPhone journeys' texts, as the recorder reads them. */
  const deviceTexts = () =>
    floorSpecs(DEVICE_DIR, DEVICE_SUFFIX).map((file) =>
      readFileSync(file, 'utf8'),
    );
  const spellingSpecs = (functionsIds: readonly string[]) => [
    ...floorSpecs().map((file) => readFileSync(file, 'utf8')),
    ...deviceTexts(),
    plantedSpec(functionsIds),
  ];
  const carriedBeside = (
    recorded: Readonly<Record<string, number>>,
    functionsIds: readonly string[],
  ) =>
    carriedIds(recordedKeys(recorded), spellingSpecs(functionsIds), new Set());

  /**
   * A unit suite that asserts the ids it owns at their recorded figures, as
   * the real one does: `owned` is baked in, so the stand-in reads no directory.
   */
  const npxAsserting = (owned: readonly string[]) =>
    [
      `#!${process.execPath}`,
      "const { appendFileSync, readFileSync } = require('node:fs');",
      // The recorder runs the guards suite (#638) and the integration suite
      // (#630) after this one: each is another `npx vitest run` with --config,
      // and asserts nothing here.
      "if (process.argv.includes('--config')) process.exit(0);",
      "const floors = JSON.parse(readFileSync('tests/floors.json', 'utf8'));",
      "const site = 'tests/unit/a.test.ts:1';",
      `const owned = ${JSON.stringify(owned)};`,
      'const rows = owned.map((id) => ({ id, actual: floors[id], site }));',
      "appendFileSync(process.env.FLOORS_RECORD, rows.map((row) => JSON.stringify(row)).join('\\n') + '\\n');",
    ].join('\n') + '\n';

  const recordWith = (
    bin: Readonly<Record<string, string>>,
    args: readonly string[] = [],
    {
      functionsIds = [],
      recorded = {},
      writes = false,
      prepare = () => {},
    }: {
      functionsIds?: readonly string[];
      recorded?: Readonly<Record<string, number>>;
      writes?: boolean;
      /** Runs in the scratch checkout, once it holds its copies (#547). */
      prepare?: (checkout: string) => void;
    } = {},
  ) => {
    const dir = mkdtempSync(join(tmpdir(), 'floors-path-'));
    // The recorder runs in a checkout of its own, holding copies of what it
    // reads: the record, the Playwright floor specs, the iPhone journeys whose
    // ids every mode carries (#623), and the lockfile and
    // Dockerfile that pick its image. Every floor in the
    // suite reads the real record from other workers, and a write truncates
    // it first, so a recorder test that wrote it, even to put it back, failed
    // whichever test read it at that instant (#593).
    const checkout = mkdtempSync(join(tmpdir(), 'floors-checkout-'));
    for (const file of [
      FLOORS_FILE,
      ...floorSpecs(),
      ...floorSpecs(DEVICE_DIR, DEVICE_SUFFIX),
      'package-lock.json',
      DOCKERFILE,
    ]) {
      mkdirSync(dirname(join(checkout, file)), { recursive: true });
      copyFileSync(file, join(checkout, file));
    }
    mkdirSync(join(checkout, dirname(PLANTED_FUNCTIONS_SPEC)), {
      recursive: true,
    });
    writeFileSync(
      join(checkout, PLANTED_FUNCTIONS_SPEC),
      plantedSpec(functionsIds),
    );
    const sitting = readFileSync(FLOORS_FILE);
    writeFileSync(
      join(checkout, FLOORS_FILE),
      floorsText({ ...JSON.parse(sitting.toString('utf8')), ...recorded }),
    );
    prepare(checkout);
    const before = readFileSync(join(checkout, FLOORS_FILE));
    // Equal bytes cannot show a write that restored them: the time is held too.
    const writtenAt = statSync(FLOORS_FILE).mtimeMs;
    try {
      for (const [name, script] of Object.entries({
        git: NOTHING_UNTRACKED_GIT,
        ...bin,
      }))
        writeFileSync(join(dir, name), script, { mode: 0o755 });
      const run = spawnSync(process.execPath, [RECORDER, ...args], {
        cwd: checkout,
        encoding: 'utf8',
        env: { ...process.env, CI: '', PATH: dir },
      });
      expect(readFileSync(FLOORS_FILE).equals(sitting), FLOORS_FILE).toBe(true);
      expect(
        statSync(FLOORS_FILE).mtimeMs,
        `${FLOORS_FILE} was written: another worker reading it then saw it empty`,
      ).toBe(writtenAt);
      // And the run's own copy is as it found it: a refused run writes nothing.
      const after = readFileSync(join(checkout, FLOORS_FILE));
      if (!writes)
        expect(
          after.equals(before),
          `the scratch checkout's ${FLOORS_FILE}`,
        ).toBe(true);
      const handed = join(dir, 'record-path');
      const recordPath = existsSync(handed)
        ? readFileSync(handed, 'utf8').trimEnd()
        : undefined;
      // Read here, while the checkout it is relative to still exists.
      const recordDirLeft =
        recordPath !== undefined &&
        existsSync(join(checkout, dirname(recordPath)));
      return {
        ...run,
        recordPath,
        recordDirLeft,
        floors: JSON.parse(after.toString('utf8')) as Record<string, number>,
      };
    } finally {
      rmSync(dir, { recursive: true, force: true });
      rmSync(checkout, { recursive: true, force: true });
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

  it('runs the guards suite after the unit suite, with the limit its own script carries (#638)', () => {
    const run = recordWith({ npx: '#!/bin/sh\necho "ran: $*"\nexit 0\n' }, [
      '--unit',
    ]);
    const script = (
      JSON.parse(readFileSync('package.json', 'utf8')) as {
        scripts: Record<string, string>;
      }
    ).scripts['test:guards'];
    expect(
      run.stdout.split('\n').filter((line) => line.startsWith('ran: ')),
    ).toEqual([
      'ran: vitest run',
      `ran: ${script}`,
      expect.stringContaining('vitest.integration.config.ts'),
      expect.stringContaining('vitest.logs.config.ts'),
    ]);
  });

  it('refuses a guards suite that failed, naming it (#638)', () => {
    const run = recordWith(
      {
        npx: '#!/bin/sh\nfor a; do [ "$a" = vitest.guards.config.ts ] && exit 5; done\nexit 0\n',
      },
      ['--unit'],
    );
    expect(run.status).toBe(1);
    expect(run.stderr).toBe(
      '✗ the guards suite failed in record mode (exit 5): nothing recorded\n',
    );
  });

  it('runs the integration suite after the unit suite, with the limit its own script carries (#630)', () => {
    const run = recordWith({ npx: '#!/bin/sh\necho "ran: $*"\nexit 0\n' }, [
      '--unit',
    ]);
    const script = (
      JSON.parse(readFileSync('package.json', 'utf8')) as {
        scripts: Record<string, string>;
      }
    ).scripts['test:integration'];
    expect(
      run.stdout.split('\n').filter((line) => line.startsWith('ran: ')),
    ).toEqual([
      'ran: vitest run',
      expect.stringContaining('vitest.guards.config.ts'),
      `ran: ${script}`,
      expect.stringContaining('vitest.logs.config.ts'),
    ]);
  });

  it('runs the logs suite after the integration suite, with the limit its own script carries (#822)', () => {
    const run = recordWith({ npx: '#!/bin/sh\necho "ran: $*"\nexit 0\n' }, [
      '--unit',
    ]);
    const script = (
      JSON.parse(readFileSync('package.json', 'utf8')) as {
        scripts: Record<string, string>;
      }
    ).scripts['test:logs'];
    expect(
      run.stdout.split('\n').filter((line) => line.startsWith('ran: ')),
    ).toEqual([
      'ran: vitest run',
      expect.stringContaining('vitest.guards.config.ts'),
      expect.stringContaining('vitest.integration.config.ts'),
      `ran: ${script}`,
    ]);
  });

  it('refuses a logs suite that failed, naming it (#822)', () => {
    const run = recordWith(
      {
        npx: '#!/bin/sh\nfor a; do [ "$a" = vitest.logs.config.ts ] && exit 6; done\nexit 0\n',
      },
      ['--unit'],
    );
    expect(run.status).toBe(1);
    expect(run.stderr).toBe(
      '✗ the logs suite failed in record mode (exit 6): nothing recorded\n',
    );
  });

  it('refuses an integration suite that failed, naming it (#630)', () => {
    const run = recordWith(
      {
        npx: '#!/bin/sh\nfor a; do [ "$a" = vitest.integration.config.ts ] && exit 4; done\nexit 0\n',
      },
      ['--unit'],
    );
    expect(run.status).toBe(1);
    expect(run.stderr).toBe(
      '✗ the integration suite failed in record mode (exit 4): nothing recorded\n',
    );
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
    expect(run.recordDirLeft, 'the scratch directory').toBe(false);
  });

  it('with --unit, never asks for Docker: the unit suite is all it runs (#548)', () => {
    // No docker on PATH: had it been asked for, this would be its refusal.
    const run = recordWith({ npx: '#!/bin/sh\nexit 3\n' }, ['--unit']);
    expect(run.status).toBe(1);
    expect(run.stderr).toBe(
      '✗ the unit suite failed in record mode (exit 3): nothing recorded\n',
    );
    expect(run.stdout).toBe('');
  });

  it('with --unit-suite, runs the unit suite and nothing else (#658)', () => {
    // No docker and no npm on PATH: the Playwright run or the functions
    // suite, had either been asked for, would have refused the record.
    const run = recordWith({ npx: '#!/bin/sh\necho "ran: $*"\nexit 0\n' }, [
      '--unit-suite',
    ]);
    expect(
      run.stdout.split('\n').filter((line) => line.startsWith('ran: ')),
    ).toEqual(['ran: vitest run']);
    expect(run.status).toBe(0);
  });

  it('refuses an argument it does not know, before running anything (#548)', () => {
    const run = recordWith({}, ['--units']);
    expect(run.status).toBe(1);
    expect(run.stderr).toBe(
      '✗ usage: npm run floors:record [-- --unit | --functions | --unit-suite | ' +
        '--device] [--retire <id>]... (got --units)\n',
    );
    expect(run.stdout).toBe('');
  });

  it('refuses two modes at once, before running anything (#610)', () => {
    const run = recordWith({}, ['--unit', '--functions']);
    expect(run.status).toBe(1);
    expect(run.stderr).toBe(
      '✗ usage: npm run floors:record [-- --unit | --functions | --unit-suite | ' +
        '--device] [--retire <id>]... (got --unit --functions)\n',
    );
    expect(run.stdout).toBe('');
  });

  it('refuses a retire when git cannot say what origin/develop holds, before running anything (#640)', () => {
    // A git that answers only the untracked listing (#547): unknown is never
    // read as "not on develop".
    const run = recordWith({}, ['--unit', '--retire', 'planted/branch-only'], {
      recorded: { 'planted/branch-only': 1 },
    });
    expect(run.status).toBe(1);
    expect(run.stderr).toBe(
      '✗ nothing recorded:\n  planted/branch-only cannot be retired: ' +
        'whether origin/develop holds it is unknown (the fetch of ' +
        'origin/develop failed in record mode (exit 9): nothing recorded)\n',
    );
    expect(run.stdout).toBe('');
  });

  it('refuses a tree with an untracked file before running anything, naming it (#547)', () => {
    const run = recordWith({
      git: "#!/bin/sh\nprintf 'tests/new.ts\\0'\n",
      docker: DOCKER_VERSION_ONLY,
    });
    expect(run.status).toBe(1);
    expect(run.stderr).toBe(
      '✗ nothing recorded: 1 untracked file, which the guards that read git ' +
        'would not count and CI, with it committed, would (#547). ' +
        "Stage it first:\n  git add -N -- 'tests/new.ts'\n",
    );
    expect(run.stdout).toBe('');
  });

  it('refuses when git cannot list the untracked files, never reading that as none (#547)', () => {
    const run = recordWith({ git: '#!/bin/sh\nexit 128\n' }, ['--unit']);
    expect(run.status).toBe(1);
    expect(run.stderr).toBe(
      '✗ the untracked-file listing failed in record mode (exit 128): nothing recorded\n',
    );
    expect(run.stdout).toBe('');
  });

  // Real git in a scratch repository, the one place `--others
  // --exclude-standard` means what it means (#547): an untracked file is
  // refused, and the same file staged with `git add -N` is not.
  describe('with real git', () => {
    const realGit = (process.env.PATH ?? '')
      .split(':')
      .map((entry) => join(entry, 'git'))
      .find((candidate) => existsSync(candidate));
    const gitIn = (checkout: string, ...args: string[]) => {
      const run = spawnSync(realGit ?? 'git', args, {
        cwd: checkout,
        encoding: 'utf8',
      });
      expect(run.status, `git ${args.join(' ')}: ${run.stderr}`).toBe(0);
    };
    const withNewFile = (checkout: string) => {
      gitIn(checkout, 'init', '--quiet');
      gitIn(checkout, 'add', '--all');
      writeFileSync(join(checkout, 'tests', 'new.ts'), 'export {};\n');
    };

    it('finds git on the PATH to run', () => {
      expect(realGit).toMatch(/\/git$/);
    });

    it('refuses a new file left untracked', () => {
      const run = recordWith(
        { git: `#!/bin/sh\nexec '${realGit}' "$@"\n` },
        ['--unit'],
        { prepare: withNewFile },
      );
      expect(run.status).toBe(1);
      expect(run.stderr).toBe(
        '✗ nothing recorded: 1 untracked file, which the guards that read git ' +
          'would not count and CI, with it committed, would (#547). ' +
          "Stage it first:\n  git add -N -- 'tests/new.ts'\n",
      );
    });

    it('lets the same file through once it is staged with git add -N', () => {
      const run = recordWith(
        { git: `#!/bin/sh\nexec '${realGit}' "$@"\n` },
        ['--unit'],
        {
          prepare: (checkout) => {
            withNewFile(checkout);
            gitIn(checkout, 'add', '-N', 'tests/new.ts');
          },
        },
      );
      // Past the check, to the next refusal: the unit suite, which no npx on
      // this PATH can start.
      expect(run.stderr).toBe(
        '✗ the unit suite did not start: spawnSync npx ENOENT\n',
      );
    });
  });

  it('refuses a functions suite that did not start, naming why (#610)', () => {
    // Docker answers and the unit suite passes, so the refusal can only be the
    // functions suite's: no `npm` is on PATH.
    const run = recordWith({
      docker: dockerWriting([], 0),
      npx: PASSING_NPX,
    });
    expect(run.status).toBe(1);
    expect(run.stderr).toBe(
      '✗ the functions suite did not start: spawnSync npm ENOENT\n',
    );
  });

  it('refuses a functions suite that failed, after the Playwright run (#610)', () => {
    const run = recordWith({
      docker: dockerWriting([], 0),
      npx: PASSING_NPX,
      npm: npmWriting([], 4),
    });
    expect(run.status).toBe(1);
    expect(run.stderr).toBe(
      '✗ the functions suite failed in record mode (exit 4): nothing recorded\n',
    );
    expect(run.stdout).toBe(
      `Recording the Playwright floors in ${localImage()}: ` +
        `${floorSpecs().join(' ')}\n` +
        'Recording the functions floors: tests/functions/planted.spec.ts\n',
    );
  });

  it('with --functions, asks for neither Docker nor the unit suite, and refuses a functions suite that failed (#610)', () => {
    // Neither `docker` nor `npx` is on PATH: had either been asked for, its
    // refusal would be the message below.
    const run = recordWith({ npm: npmWriting([], 4) }, ['--functions']);
    expect(run.status).toBe(1);
    expect(run.stderr).toBe(
      '✗ the functions suite failed in record mode (exit 4): nothing recorded\n',
    );
    expect(run.stdout).toBe(
      'Recording the functions floors: tests/functions/planted.spec.ts\n',
    );
  });

  it('with --functions, refuses a functions suite that did not start, naming why (#610)', () => {
    const run = recordWith({}, ['--functions']);
    expect(run.status).toBe(1);
    expect(run.stderr).toBe(
      '✗ the functions suite did not start: spawnSync npm ENOENT\n',
    );
  });

  it('with --functions, refuses a functions figure that would fall, and carries every other id (#610)', () => {
    // The only refusal is the functions id's: the unit and Playwright ids the
    // mode did not measure are carried, not refused as unasserted.
    const run = recordWith(
      {
        npm: npmWriting(
          [JSON.stringify({ id: 'probe/fn', actual: 3, site: FN_SITE })],
          0,
        ),
      },
      ['--functions'],
      { functionsIds: ['probe/fn'], recorded: { 'probe/fn': 5 } },
    );
    expect(run.status).toBe(1);
    expect(run.stderr).toBe(
      '✗ nothing recorded:\n' +
        '  probe/fn would fall from 5 to 3: a blind reader looks like this. ' +
        `If the corpus really shrank, lower it in ${FLOORS_FILE} by hand and ` +
        'say why in the commit.\n',
    );
  });

  it('with --functions, refuses a recorded functions id that no functions test asserted (#610)', () => {
    const run = recordWith({ npm: npmWriting([], 0) }, ['--functions'], {
      functionsIds: ['probe/fn'],
      recorded: { 'probe/fn': 5 },
    });
    expect(run.status).toBe(1);
    expect(run.stderr).toBe(
      '✗ nothing recorded:\n' +
        '  probe/fn is recorded but no test asserted it: remove it from ' +
        `${FLOORS_FILE} with the floor that used it, or run the whole suite\n`,
    );
  });

  it('with --functions, records a new functions id, runs the unit suite once to settle, and carries the Playwright ids (#610)', () => {
    const carried = carriedBeside({}, ['probe/fn']);
    const owned = recordedKeys({}).filter((id) => !carried.includes(id));
    const run = recordWith(
      {
        npm: npmWriting(
          [JSON.stringify({ id: 'probe/fn', actual: 2, site: FN_SITE })],
          0,
        ),
        npx: npxAsserting(owned),
      },
      ['--functions'],
      { functionsIds: ['probe/fn'], writes: true },
    );
    expect({ status: run.status, stderr: run.stderr }).toEqual({
      status: 0,
      stderr: '',
    });
    expect(run.floors['probe/fn']).toBe(2);
    // The carried ids in the recorder's own lines (#623): the iPhone's apart.
    const expected = [
      'Recording the functions floors: tests/functions/planted.spec.ts',
      `${FLOORS_FILE}: ids were added, so the unit suite runs again (pass 2): ` +
        'a floor may count the ids the record holds',
      ...carriedLines('--functions', carried, deviceTexts()),
      `${FLOORS_FILE}: 1 floor(s) moved:`,
      '  probe/fn: new, 2',
    ];
    expect(run.stdout.split('\n').slice(0, expected.length)).toEqual(expected);
  });

  it('with --unit, carries a functions id its spec spells as it carries a Playwright one (#610)', () => {
    const recorded = { 'probe/fn': 5 };
    const carried = carriedBeside(recorded, ['probe/fn']);
    const owned = recordedKeys(recorded).filter((id) => !carried.includes(id));
    const run = recordWith({ npx: npxAsserting(owned) }, ['--unit'], {
      functionsIds: ['probe/fn'],
      recorded,
      writes: true,
    });
    expect({ status: run.status, stderr: run.stderr }).toEqual({
      status: 0,
      stderr: '',
    });
    expect(run.floors['probe/fn']).toBe(5);
    expect(run.stdout).toBe(
      [
        ...carriedLines('--unit', carried, deviceTexts()),
        `${FLOORS_FILE}: every floor already matches (${owned.length} read)`,
      ].join('\n') + '\n',
    );
  });

  it('restores the record when a later pass is refused, having written it for that pass', () => {
    // A stand-in suite in node. Pass 1 asserts every recorded id at its
    // figure and adds one, so the recorder writes the record and measures
    // again; pass 2 reads the record and asserts that id at 0. "Would fall"
    // proves the record held it when pass 2 ran ("no test asserted it" would
    // mean it was never written), and recordWith proves it was put back.
    const npx =
      [
        `#!${process.execPath}`,
        "const { appendFileSync, existsSync, readFileSync, writeFileSync } = require('node:fs');",
        "const marker = __dirname + '/passes';",
        'const pass = existsSync(marker) ? 2 : 1;',
        'writeFileSync(marker, String(pass));',
        "const floors = JSON.parse(readFileSync('tests/floors.json', 'utf8'));",
        "const site = 'tests/unit/a.test.ts:1';",
        'const rows = Object.entries(floors).map(([id, actual]) => ({ id, actual, site }));',
        "if (pass === 1) rows.push({ id: 'probe/added', actual: 1, site });",
        "for (const row of rows) if (pass === 2 && row.id === 'probe/added') row.actual = 0;",
        "appendFileSync(process.env.FLOORS_RECORD, rows.map((row) => JSON.stringify(row)).join('\\n') + '\\n');",
      ].join('\n') + '\n';
    const run = recordWith({ npx }, ['--unit']);
    expect(run.status).toBe(1);
    expect(run.stderr).toBe(
      '✗ nothing recorded:\n' +
        '  probe/added would fall from 1 to 0: a blind reader looks like this. ' +
        `If the corpus really shrank, lower it in ${FLOORS_FILE} by hand and ` +
        'say why in the commit.\n',
    );
    expect(run.stdout).toBe(
      `${FLOORS_FILE}: ids were added, so the unit suite runs ` +
        'again (pass 2): a floor may count the ids the record holds\n',
    );
  });

  it('judges what the Playwright run saw together with the unit run', () => {
    // The container's record is read and handed to decideRecord: a figure it
    // would lower is refused by name, as a unit one is. The id is read from
    // the record, never spelled: each is spelled once under tests/.
    const [id] = Object.keys(readFloors());
    const run = recordWith({
      npx: PASSING_NPX,
      npm: PASSING_NPX,
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
    // The record was handed over, so the directory below did exist.
    expect(basename(run.recordPath ?? '')).toBe('e2e.jsonl');
    expect(run.recordDirLeft, 'the scratch directory').toBe(false);
  });
});

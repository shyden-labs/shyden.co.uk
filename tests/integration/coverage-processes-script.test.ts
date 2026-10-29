import { spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  cpSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  realpathSync,
  renameSync,
  rmSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
} from 'vitest';
import { nonEmpty } from '../../scripts/errors.mjs';

/**
 * `scripts/coverage-processes.mjs` on a real child process (#899 AC3): a
 * script run under `NODE_V8_COVERAGE` takes one arm of an `if`, and the
 * converted report says which line ran and which did not, both ways round.
 * `tests/unit/coverage-processes.test.ts` holds the conversion itself.
 *
 * Each run of the converter inherits this suite's own `NODE_V8_COVERAGE`, so
 * a coverage run measures the converter too: blanking it there left its whole
 * command line reading unrun (#913, measured on run 40484222505).
 */
const SCRIPT = path.resolve(
  import.meta.dirname,
  '../../scripts/coverage-processes.mjs',
);

/** The preload every process a test starts loads (#936). */
const LEDGER = pathToFileURL(
  path.resolve(import.meta.dirname, '../coverage-ledger.mjs'),
).href;

const PLANTED = [
  "const take = process.argv[2] === 'yes';",
  'if (take) {',
  "  process.stdout.write('taken');",
  '} else {',
  "  process.stdout.write('not taken');",
  '}',
  '',
].join('\n');

let repo: string;

beforeEach(() => {
  repo = realpathSync(mkdtempSync(path.join(tmpdir(), 'coverage-processes-')));
  mkdirSync(path.join(repo, 'scripts'));
  writeFileSync(path.join(repo, 'scripts/planted.mjs'), PLANTED);
  // The CLI converts on Vitest's transform for the checkout's own unit
  // config (#913); a config with no import needs no packages here. The
  // checkout is ESM, as this repository is, or Vite loads the config as
  // CommonJS and warns on stderr (record run 40476847768).
  writeFileSync(path.join(repo, 'package.json'), '{ "type": "module" }\n');
  writeFileSync(path.join(repo, 'vitest.config.ts'), 'export default {};\n');
});

afterEach(() => {
  rmSync(repo, { recursive: true, force: true });
});

/** Runs the planted script as a child under NODE_V8_COVERAGE, then converts. */
const measure = (answer: 'yes' | 'no') => {
  const raw = path.join(repo, 'raw');
  const child = spawnSync(process.execPath, ['scripts/planted.mjs', answer], {
    cwd: repo,
    encoding: 'utf8',
    env: { ...process.env, NODE_V8_COVERAGE: raw },
  });
  const convert = spawnSync(process.execPath, [SCRIPT, raw, 'processes'], {
    cwd: repo,
    encoding: 'utf8',
    env: process.env,
  });
  return { child, convert };
};

/** Each statement of a file (the planted one by default) as `line=count`, in the checkout `at`. */
const lines = (at = repo, file = 'scripts/planted.mjs') => {
  const report = JSON.parse(
    readFileSync(
      path.join(at, 'coverage/processes/coverage-final.json'),
      'utf8',
    ),
  ) as Record<
    string,
    {
      statementMap: Record<string, { start: { line: number } }>;
      s: Record<string, number>;
    }
  >;
  const planted = report[path.join(at, file)];
  if (!planted) throw new Error(`${file} is not in the report`);
  return Object.entries(planted.statementMap).map(
    ([id, { start }]) => `${start.line}=${planted.s[id]}`,
  );
};

/**
 * Vitest converts the module vite's SSR transform wrote, where an imported
 * `X.prop` reads `__vite_ssr_import_N__.X.prop`, and coverage-v8 5.0.5 ignores
 * every declarator initialised that way (`provider.js`, "SSR transformed
 * import binding"); since #928 both the suites and this converter add those
 * declarators back (`tests/coverage-declarators.mjs`), while a parameter of
 * the same name is not an import and is counted as before. The conversion runs on that same transform (#913), so its lines
 * are the ones measured on Vitest's own route (2026-10-27,
 * `.superpowers/sdd/913/tools`): before #913 the own-text converter skipped
 * them by hand, and refused `shadow.mjs`, whose scope it could not read.
 */
const IMPORT_READS = [
  {
    file: 'reads.mjs',
    text: [
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
    ],
    // coverage-v8's own statements first, then the five declarators it
    // drops, which #928 adds: 4, 5, 9, 10 and 12.
    lines: [
      '6=1',
      '7=1',
      '8=1',
      '13=1',
      '15=1',
      '4=1',
      '5=1',
      '9=1',
      '10=1',
      '12=1',
    ],
  },
  {
    file: 'shadow.mjs',
    text: [
      "import { env } from 'node:process';",
      'function read(env) {',
      '  const home = env.HOME;',
      '  return home;',
      '}',
      "globalThis.out = read({ HOME: '/' });",
      '',
    ],
    lines: ['3=1', '4=1', '6=1'],
  },
  {
    file: 'rebound.mjs',
    text: [
      "import { join } from 'node:path';",
      'function wrap(join) {',
      '  return join;',
      '}',
      "globalThis.out = [wrap(1), join('a', 'b')];",
      '',
    ],
    lines: ['3=1', '5=1'],
  },
];

describe('a declarator read from an import counts as the suites count it (#899, #913, #928)', () => {
  it.each(IMPORT_READS)(
    '$file lists the statements Vitest lists',
    ({ file, text, lines: expected }) => {
      writeFileSync(path.join(repo, 'scripts', file), text.join('\n'));
      const raw = path.join(repo, 'raw');
      const child = spawnSync(process.execPath, [`scripts/${file}`], {
        cwd: repo,
        encoding: 'utf8',
        env: { ...process.env, NODE_V8_COVERAGE: raw },
      });
      const convert = spawnSync(process.execPath, [SCRIPT, raw, 'processes'], {
        cwd: repo,
        encoding: 'utf8',
        env: process.env,
      });
      expect([child.status, convert.status, convert.stderr]).toEqual([
        0,
        0,
        '',
      ]);
      expect(lines(repo, `scripts/${file}`)).toEqual(expected);
    },
  );
});

describe('coverage-processes.mjs on a real child process', () => {
  it('the taken arm’s line reads run and the other unrun', () => {
    const { child, convert } = measure('yes');
    expect([
      child.status,
      child.stdout,
      convert.status,
      convert.stderr,
    ]).toEqual([0, 'taken', 0, '']);
    expect(lines()).toEqual(['1=1', '2=1', '3=1', '5=0']);
  });

  it('the other answer turns the verdict round', () => {
    const { child, convert } = measure('no');
    expect([
      child.status,
      child.stdout,
      convert.status,
      convert.stderr,
    ]).toEqual([0, 'not taken', 0, '']);
    expect(lines()).toEqual(['1=1', '2=1', '3=0', '5=1']);
  });

  it('a directory no process wrote to is refused, naming it', () => {
    mkdirSync(path.join(repo, 'empty'));
    const run = spawnSync(
      process.execPath,
      [SCRIPT, path.join(repo, 'empty'), 'processes'],
      {
        cwd: repo,
        encoding: 'utf8',
        env: process.env,
      },
    );
    expect([run.status, run.stdout, run.stderr]).toEqual([
      1,
      '',
      `✗ found no raw V8 coverage files in ${path.join(repo, 'empty')} — the walk is broken, not the subject clean. A guard handed an empty list asserts nothing at all (#84).\n`,
    ]);
  });

  it('a directory that is not there is refused in one line, naming it', () => {
    const missing = path.join(repo, 'missing');
    const run = spawnSync(process.execPath, [SCRIPT, missing, 'processes'], {
      cwd: repo,
      encoding: 'utf8',
      env: process.env,
    });
    expect([run.status, run.stdout, run.stderr]).toEqual([
      1,
      '',
      `✗ ENOENT: no such file or directory, scandir '${missing}'\n`,
    ]);
  });

  it('a checkout with no vitest.config.ts is refused in one line, naming it', () => {
    rmSync(path.join(repo, 'vitest.config.ts'));
    const { convert } = measure('yes');
    expect([convert.status, convert.stdout, convert.stderr]).toEqual([
      1,
      '',
      `✗ coverage-processes: ${path.join(repo, 'vitest.config.ts')} is not there, so there is no Vitest transform to place counts on\n`,
    ]);
  });

  it('a process that ran no measured file is refused, naming the directory', () => {
    mkdirSync(path.join(repo, 'unmeasured'));
    writeFileSync(
      path.join(repo, 'unmeasured', 'coverage-1.json'),
      JSON.stringify({ result: [] }),
    );
    const run = spawnSync(
      process.execPath,
      [SCRIPT, path.join(repo, 'unmeasured'), 'processes'],
      {
        cwd: repo,
        encoding: 'utf8',
        env: process.env,
      },
    );
    expect([run.status, run.stderr]).toEqual([
      1,
      `✗ coverage-processes: no process ran a measured file, so there is nothing to report (read ${path.join(repo, 'unmeasured')})\n`,
    ]);
  });

  /** Issue 936: a cut-off raw file from a writer that has exited. */
  it('a cut-off raw file is refused, naming it, its size and its writer', () => {
    mkdirSync(path.join(repo, 'cut'));
    const exited = spawnSync(process.execPath, ['-e', ''], {
      encoding: 'utf8',
    });
    const name = `coverage-${exited.pid}-1-0.json`;
    writeFileSync(path.join(repo, 'cut', name), '{"res');
    const run = spawnSync(
      process.execPath,
      [SCRIPT, path.join(repo, 'cut'), 'processes'],
      {
        cwd: repo,
        encoding: 'utf8',
        env: process.env,
      },
    );
    expect([run.status, run.stderr]).toEqual([
      1,
      `✗ coverage-processes: ${name} (5 bytes, written by process ${exited.pid}, which has exited) is not whole JSON: Unterminated string in JSON at position 5 (line 1 column 6); no ledger line names process ${exited.pid}\n`,
    ]);
  });

  /**
   * Issue 936: a writer still finishing its file when the reader starts. The
   * child holds the file half-written for a second, then completes it with
   * the planted script's real coverage and exits.
   */
  it('a writer still running is waited for, then its whole file is read', async () => {
    const raw = path.join(repo, 'raw');
    const measured = spawnSync(
      process.execPath,
      ['scripts/planted.mjs', 'yes'],
      {
        cwd: repo,
        encoding: 'utf8',
        env: { ...process.env, NODE_V8_COVERAGE: raw },
      },
    );
    expect(measured.status).toBe(0);
    // The child names its file by its own pid, as Node does, and completes
    // it a second after the test has planted the unfinished version.
    const writer = spawn(
      process.execPath,
      [
        '-e',
        "const fs = require('node:fs'); const path = require('node:path'); setTimeout(() => fs.writeFileSync(path.join(process.argv[1], `coverage-${process.pid}-1-0.json`), JSON.stringify({ result: [] })), 1000);",
        raw,
      ],
      { stdio: 'ignore' },
    );
    const exited = new Promise((resolve) => writer.once('exit', resolve));
    try {
      const target = path.join(raw, `coverage-${writer.pid}-1-0.json`);
      writeFileSync(target, '{"res');
      // Run without blocking this process: the writer is its child, and
      // until this event loop reaps it the exited writer is a zombie, which
      // still answers signal 0 as running.
      const reader = spawn(process.execPath, [SCRIPT, raw, 'processes'], {
        cwd: repo,
        env: process.env,
      });
      const run = { status: -1, stdout: '', stderr: '' };
      reader.stdout.on('data', (chunk: Buffer) => (run.stdout += chunk));
      reader.stderr.on('data', (chunk: Buffer) => (run.stderr += chunk));
      run.status = await new Promise<number>((resolve) =>
        reader.once('close', (code) => resolve(code ?? -1)),
      );
      expect([run.status, run.stderr]).toEqual([0, '']);
      expect(run.stdout).toContain(
        `coverage-processes: waited for process ${writer.pid} to finish writing\n`,
      );
      expect(readFileSync(target, 'utf8')).toBe('{"result":[]}');
    } finally {
      writer.kill();
      await exited;
    }
  });

  /**
   * Issue 913: a run recorded on another machine names its writers by that
   * machine's pids. One may match a process running here (PR #949's second
   * run waited 30 s on pid 408 and refused), so with --recorded-root no
   * writer is looked for: the run finished before its files were handed on.
   */
  it('a run recorded elsewhere waits for no writer here, whatever its file names', () => {
    const raw = path.join(repo, 'raw');
    const child = spawnSync(process.execPath, ['scripts/planted.mjs', 'yes'], {
      cwd: repo,
      encoding: 'utf8',
      env: { ...process.env, NODE_V8_COVERAGE: raw },
    });
    expect(child.status).toBe(0);
    // Renamed to the pid of a process that is running here: this one.
    const [written] = nonEmpty(
      readdirSync(raw).filter((name) => name.endsWith('.json')),
      'raw coverage files the planted script wrote',
    );
    renameSync(
      path.join(raw, String(written)),
      path.join(raw, `coverage-${process.pid}-1-0.json`),
    );
    const started = Date.now();
    const run = spawnSync(
      process.execPath,
      [SCRIPT, raw, 'processes', '--recorded-root', repo],
      {
        cwd: repo,
        encoding: 'utf8',
        env: process.env,
      },
    );
    expect([run.status, run.stderr]).toEqual([0, '']);
    expect(Date.now() - started).toBeLessThan(10_000);
    expect(lines()).toEqual(['1=1', '2=1', '3=1', '5=0']);
  });

  /**
   * Issue 913: a CI container runs the checkout at another path than the job
   * that converts it. The run is measured in one checkout and converted in a
   * copy at another path, which is where the report places it.
   */
  it('a run recorded in another checkout reads in this one', () => {
    const raw = path.join(repo, 'raw');
    const child = spawnSync(process.execPath, ['scripts/planted.mjs', 'yes'], {
      cwd: repo,
      encoding: 'utf8',
      env: { ...process.env, NODE_V8_COVERAGE: raw },
    });
    expect(child.status).toBe(0);
    const here = realpathSync(
      mkdtempSync(path.join(tmpdir(), 'coverage-here-')),
    );
    try {
      cpSync(repo, here, { recursive: true });
      const run = spawnSync(
        process.execPath,
        [SCRIPT, path.join(here, 'raw'), 'processes', '--recorded-root', repo],
        {
          cwd: here,
          encoding: 'utf8',
          env: process.env,
        },
      );
      expect([run.status, run.stderr]).toEqual([0, '']);
      expect(lines(here)).toEqual(['1=1', '2=1', '3=1', '5=0']);
    } finally {
      rmSync(here, { recursive: true, force: true });
    }
  });

  /** Issue 913: a cache whose entries are read, beside a file run as its own text. */
  it('a compile cache is read, and a file run as its own text still converts', () => {
    const raw = path.join(repo, 'raw');
    spawnSync(process.execPath, ['scripts/planted.mjs', 'yes'], {
      cwd: repo,
      env: { ...process.env, NODE_V8_COVERAGE: raw },
    });
    const code = 'export const other = 1;\n';
    const sha = createHash('sha1').update(code).digest('hex');
    mkdirSync(path.join(repo, 'cache', 'ab'), { recursive: true });
    writeFileSync(
      path.join(repo, 'cache', 'ab', 'other_ab.js'),
      `// ${sha}\n${code}`,
    );
    writeFileSync(
      path.join(repo, 'cache', 'ab', 'other_ab.map'),
      JSON.stringify({
        version: 3,
        mappings: 'AAAA',
        names: [],
        sources: ['other.ts'],
        sourcesContent: ['export const other: number = 1;\n'],
      }),
    );
    const run = spawnSync(
      process.execPath,
      [SCRIPT, raw, 'processes', '--cache', path.join(repo, 'cache')],
      {
        cwd: repo,
        encoding: 'utf8',
        env: process.env,
      },
    );
    expect([run.status, run.stderr]).toEqual([0, '']);
    expect(lines()).toEqual(['1=1', '2=1', '3=1', '5=0']);
  });

  it('a compile cache holding code with no map is refused, naming both', () => {
    const raw = path.join(repo, 'raw');
    spawnSync(process.execPath, ['scripts/planted.mjs', 'yes'], {
      cwd: repo,
      env: { ...process.env, NODE_V8_COVERAGE: raw },
    });
    const cache = path.join(repo, 'cache');
    mkdirSync(path.join(cache, 'ab'), { recursive: true });
    writeFileSync(path.join(cache, 'ab', 'lone_ab.js'), '');
    const run = spawnSync(
      process.execPath,
      [SCRIPT, raw, 'processes', '--cache', cache],
      {
        cwd: repo,
        encoding: 'utf8',
        env: process.env,
      },
    );
    expect([run.status, run.stdout, run.stderr]).toEqual([
      1,
      '',
      `✗ coverage-processes: the compile cache holds ${path.join('ab', 'lone_ab.js')} with no map beside it (read ${cache})\n`,
    ]);
  });

  it('a compile cache that is not there is refused in one line, naming it', () => {
    const cache = path.join(repo, 'no-cache');
    const run = spawnSync(
      process.execPath,
      [SCRIPT, path.join(repo, 'raw'), 'processes', '--cache', cache],
      {
        cwd: repo,
        encoding: 'utf8',
        env: process.env,
      },
    );
    expect([run.status, run.stdout, run.stderr]).toEqual([
      1,
      '',
      `✗ ENOENT: no such file or directory, scandir '${cache}'\n`,
    ]);
  });

  it('a compile-cache entry that cannot be read is refused, naming the cache', () => {
    const cache = path.join(repo, 'cache');
    mkdirSync(path.join(cache, 'ab', 'dir_ab.js'), { recursive: true });
    writeFileSync(path.join(cache, 'ab', 'dir_ab.map'), '{}');
    const run = spawnSync(
      process.execPath,
      [SCRIPT, path.join(repo, 'raw'), 'processes', '--cache', cache],
      {
        cwd: repo,
        encoding: 'utf8',
        env: process.env,
      },
    );
    expect([run.status, run.stdout, run.stderr]).toEqual([
      1,
      '',
      `✗ EISDIR: illegal operation on a directory, read (read ${cache})\n`,
    ]);
  });

  it('a command line missing its suite is refused with the usage', () => {
    const run = spawnSync(process.execPath, [SCRIPT, path.join(repo, 'raw')], {
      cwd: repo,
      encoding: 'utf8',
      env: process.env,
    });
    expect([run.status, run.stdout, run.stderr]).toEqual([
      1,
      '',
      '✗ usage: coverage-processes.mjs <raw-dir> <suite> [--cache <dir>] [--recorded-root <path>]\n',
    ]);
  });

  it('an option the converter does not take is refused, naming it, with the usage', () => {
    const run = spawnSync(
      process.execPath,
      [SCRIPT, path.join(repo, 'raw'), 'processes', '--bogus'],
      {
        cwd: repo,
        encoding: 'utf8',
        env: process.env,
      },
    );
    expect([run.status, run.stdout]).toEqual([1, '']);
    expect(run.stderr).toMatch(
      /^✗ Unknown option '--bogus'\.[^\n]*\nusage: coverage-processes\.mjs <raw-dir> <suite> \[--cache <dir>\] \[--recorded-root <path>\]\n$/,
    );
  });

  /** Issue 936: the ledger every started process writes as it starts. */
  it('a process started with the ledger preloaded writes its pid and command', () => {
    const raw = path.join(repo, 'raw');
    const child = spawnSync(process.execPath, ['scripts/planted.mjs', 'yes'], {
      cwd: repo,
      encoding: 'utf8',
      env: {
        ...process.env,
        NODE_V8_COVERAGE: raw,
        NODE_OPTIONS: `--import=${LEDGER}`,
      },
    });
    expect([child.status, child.stdout, child.stderr]).toEqual([
      0,
      'taken',
      '',
    ]);
    expect(
      JSON.parse(
        readFileSync(path.join(raw, 'ledger', `${child.pid}.json`), 'utf8'),
      ),
    ).toEqual({
      pid: child.pid,
      argv: [process.execPath, path.join(repo, 'scripts/planted.mjs'), 'yes'],
    });
  });

  it('a cut-off raw file names the command its writer was started as', () => {
    mkdirSync(path.join(repo, 'cut', 'ledger'), { recursive: true });
    const exited = spawnSync(process.execPath, ['-e', ''], {
      encoding: 'utf8',
    });
    const name = `coverage-${exited.pid}-1-0.json`;
    writeFileSync(path.join(repo, 'cut', name), '');
    writeFileSync(
      path.join(repo, 'cut', 'ledger', `${exited.pid}.json`),
      JSON.stringify({
        pid: exited.pid,
        argv: ['node', 'playwright', 'test', '--list'],
      }),
    );
    const run = spawnSync(
      process.execPath,
      [SCRIPT, path.join(repo, 'cut'), 'processes'],
      {
        cwd: repo,
        encoding: 'utf8',
        env: process.env,
      },
    );
    expect([run.status, run.stderr]).toEqual([
      1,
      `✗ coverage-processes: ${name} (0 bytes, written by process ${exited.pid}, which has exited) is not whole JSON: Unexpected end of JSON input; process ${exited.pid} was started as: node playwright test --list\n`,
    ]);
  });
});

/**
 * #913 AC3: a helper a Playwright spec runs, compiled by Playwright's own
 * Babel transform and run from its compile cache, as every e2e helper is. One
 * answer takes one arm of the helper's `if`; the converted report reads that
 * arm's line run and the other unrun, and the other answer turns it round.
 */
const PLANTED_HELPER = [
  'export const answer = (take: boolean): string => {',
  '  if (take) {',
  "    return 'taken';",
  '  }',
  "  return 'not taken';",
  '};',
  '',
].join('\n');

const PLANTED_SPEC = [
  "import { expect, test } from '@playwright/test';",
  "import { answer } from './planted-helper';",
  '',
  "const take = process.env.PLANTED === 'yes';",
  "test('the helper answers', () => {",
  "  expect(answer(take)).toBe(take ? 'taken' : 'not taken');",
  '});',
  '',
].join('\n');

const PACKAGES = path.resolve(import.meta.dirname, '../../node_modules');

describe('a helper a Playwright spec runs, measured through the compile cache (#913)', () => {
  beforeEach(() => {
    mkdirSync(path.join(repo, 'tests'));
    writeFileSync(path.join(repo, 'tests/planted-helper.ts'), PLANTED_HELPER);
    writeFileSync(path.join(repo, 'tests/planted.spec.ts'), PLANTED_SPEC);
    writeFileSync(
      path.join(repo, 'playwright.config.ts'),
      "const workers = Number('1');\nexport default { testDir: 'tests', reporter: 'line', workers };\n",
    );
    symlinkSync(PACKAGES, path.join(repo, 'node_modules'), 'dir');
  });

  // The link goes first, by name: the folder's removal then never reaches
  // this checkout's packages, whatever rmSync does with a link.
  afterEach(() => {
    unlinkSync(path.join(repo, 'node_modules'));
  });

  /** Runs the planted spec under real Playwright, then converts what it ran. */
  const playwright = (answer: 'yes' | 'no') => {
    const raw = path.join(repo, 'raw');
    const cache = path.join(repo, 'pwcache');
    const run = spawnSync(
      process.execPath,
      [path.join(PACKAGES, '@playwright/test/cli.js'), 'test'],
      {
        cwd: repo,
        encoding: 'utf8',
        env: {
          ...process.env,
          PLANTED: answer,
          NODE_V8_COVERAGE: raw,
          PWTEST_CACHE_DIR: cache,
        },
      },
    );
    const convert = spawnSync(
      process.execPath,
      [SCRIPT, raw, 'processes', '--cache', cache],
      { cwd: repo, encoding: 'utf8', env: process.env },
    );
    return { run, convert };
  };

  /** The count of the one statement on `line` of `file`, the helper by default. */
  const helperLine = (line: number, file = 'tests/planted-helper.ts') => {
    const counts = lines(repo, file)
      .filter((entry) => entry.startsWith(`${line}=`))
      .map((entry) => Number(entry.slice(`${line}=`.length)));
    if (counts.length !== 1)
      throw new Error(
        `line ${line} holds ${counts.length} statements, not one`,
      );
    return counts[0];
  };

  it('the arm the spec takes reads run and the other unrun, beside the config and spec', () => {
    const { run, convert } = playwright('yes');
    expect([run.status, convert.status, convert.stderr]).toEqual([0, 0, '']);
    expect([helperLine(3), helperLine(5)]).toEqual([1, 0]);
    // The config's and the spec's first statements ran, in the runner and
    // its worker alike, so each reads run however often it was loaded.
    expect(helperLine(1, 'playwright.config.ts')).toBeGreaterThan(0);
    expect(helperLine(4, 'tests/planted.spec.ts')).toBeGreaterThan(0);
  });

  it('the other answer turns the verdict round', () => {
    const { run, convert } = playwright('no');
    expect([run.status, convert.status, convert.stderr]).toEqual([0, 0, '']);
    expect([helperLine(3), helperLine(5)]).toEqual([0, 1]);
  });
});

/** Each file's functions in the converted report of the checkout `at`. */
const functionReport = (at: string) =>
  JSON.parse(
    readFileSync(
      path.join(at, 'coverage/processes/coverage-final.json'),
      'utf8',
    ),
  ) as Record<
    string,
    {
      fnMap: Record<string, { decl: { start: { line: number } } }>;
      f: Record<string, number>;
    }
  >;

/**
 * A function starting with TypeScript-only text reads its own count (#959).
 * Node strips the types of a `.ts` file by blanking them, so V8's range for
 * `private first()` starts at `first` and for `<T,>(x: T) =>` at `(`. The
 * fixture mirrors the shapes found in `src/lib/api-docs.ts` (`askForJson`,
 * never called) and `src/lib/i18n/message.ts` (private methods called many
 * times) rather than running those files; the unit suite holds each form.
 */
const TYPED = [
  'export class Parts {',
  '  private first(): number {',
  '    return 1;',
  '  }',
  '  private second(): number {',
  '    return 2;',
  '  }',
  '  run(): number {',
  '    return this.first() + this.first() + this.first();',
  '  }',
  '}',
  'export const askForJson = <T,>(x: T): T => {',
  '  return x;',
  '};',
  'globalThis.out = new Parts().run();',
  '',
].join('\n');

describe('a function starting with TypeScript-only text, in a type-stripped run (#959)', () => {
  it('a never-called one reads 0 and a called one its own count', () => {
    writeFileSync(path.join(repo, 'scripts/typed.ts'), TYPED);
    const raw = path.join(repo, 'raw');
    const child = spawnSync(process.execPath, ['scripts/typed.ts'], {
      cwd: repo,
      encoding: 'utf8',
      env: { ...process.env, NODE_V8_COVERAGE: raw },
    });
    const convert = spawnSync(process.execPath, [SCRIPT, raw, 'processes'], {
      cwd: repo,
      encoding: 'utf8',
      env: process.env,
    });
    expect([child.status, convert.status, convert.stderr]).toEqual([0, 0, '']);
    const typed = functionReport(repo)[path.join(repo, 'scripts/typed.ts')];
    if (!typed) throw new Error('scripts/typed.ts is not in the report');
    // first (line 2) ran 3 times, second (5) never, run (8) once, askForJson (12) never.
    expect(
      Object.entries(typed.fnMap)
        .map(([id, { decl }]) => `${decl.start.line}=${typed.f[id]}`)
        .toSorted(),
    ).toEqual(['12=0', '2=3', '5=0', '8=1']);
  });
});

/**
 * #959 AC2: the functions the ticket names, in the files it named them in,
 * run type-stripped for real. A driver parses one plural message, which runs
 * message.ts's private methods, and imports api-docs.ts and read-back.ts
 * without calling `askForJson` or `each`. Each function must read the count
 * V8 took of its own range, which the raw file holds, so no figure here is
 * typed in; and that count must differ from the script's, which is what the
 * defect read. `src/lib` and `functions/_lib` are copied whole, so the
 * imports they need are there however they change.
 */
const NAMED = [
  { file: 'src/lib/api-docs.ts', needle: 'export const askForJson = <' },
  { file: 'src/lib/i18n/message.ts', needle: '  private parts(' },
  { file: 'src/lib/i18n/message.ts', needle: '  private slot(' },
  { file: 'src/lib/i18n/message.ts', needle: '  private match(' },
  { file: 'src/lib/i18n/message.ts', needle: '  private skipSpace(' },
  { file: 'src/lib/i18n/read-back.ts', needle: 'const each = <' },
] as const;

const DRIVER = [
  "import { parseMessage } from '../src/lib/i18n/message.ts';",
  "import '../src/lib/api-docs.ts';",
  "import '../src/lib/i18n/read-back.ts';",
  'for (let n = 0; n < 50; n++)',
  "  parseMessage('Hello {name}, you have {count, plural, one {# item} other {# items}}');",
  '',
].join('\n');

describe('the functions #959 names, in a type-stripped run of their own files', () => {
  const checkout = path.resolve(import.meta.dirname, '../..');
  let real: string;
  /** V8's own count of each function starting on a line, per file, read from the raw files. */
  const own = new Map<string, Map<number, number>>();
  /** Each script's own count, per file: what the defect read. */
  const whole = new Map<string, number>();
  let report: ReturnType<typeof functionReport>;

  beforeAll(() => {
    real = realpathSync(mkdtempSync(path.join(tmpdir(), 'coverage-959-')));
    for (const dir of ['src/lib', 'functions/_lib'])
      cpSync(path.join(checkout, dir), path.join(real, dir), {
        recursive: true,
      });
    mkdirSync(path.join(real, 'scripts'));
    writeFileSync(path.join(real, 'scripts/drive.ts'), DRIVER);
    writeFileSync(path.join(real, 'package.json'), '{ "type": "module" }\n');
    writeFileSync(path.join(real, 'vitest.config.ts'), 'export default {};\n');
    const raw = path.join(real, 'raw');
    const child = spawnSync(process.execPath, ['scripts/drive.ts'], {
      cwd: real,
      encoding: 'utf8',
      env: { ...process.env, NODE_V8_COVERAGE: raw },
    });
    const convert = spawnSync(process.execPath, [SCRIPT, raw, 'processes'], {
      cwd: real,
      encoding: 'utf8',
      env: process.env,
    });
    expect([child.status, convert.status, convert.stderr]).toEqual([0, 0, '']);
    report = functionReport(real);
    for (const name of nonEmpty(
      readdirSync(raw).filter((n) => n.endsWith('.json')),
      'raw coverage files the driver wrote',
    ))
      for (const script of (
        JSON.parse(readFileSync(path.join(raw, name), 'utf8')) as {
          result: {
            url: string;
            functions: { ranges: { startOffset: number; count: number }[] }[];
          }[];
        }
      ).result) {
        const file = NAMED.find(({ file }) =>
          script.url.endsWith(`/${file}`),
        )?.file;
        if (file === undefined) continue;
        const text = readFileSync(path.join(real, file), 'utf8');
        const [script0, ...functions] = script.functions;
        whole.set(file, script0?.ranges[0]?.count ?? Number.NaN);
        const lines = own.get(file) ?? new Map<number, number>();
        for (const { ranges } of functions) {
          const [first] = ranges;
          if (!first) continue;
          const line = text.slice(0, first.startOffset).split('\n').length;
          lines.set(line, (lines.get(line) ?? 0) + first.count);
        }
        own.set(file, lines);
      }
  });

  afterAll(() => {
    rmSync(real, { recursive: true, force: true });
  });

  for (const { file, needle } of NAMED)
    it(`${file}: \`${needle.trim()}\` reads its own count, not the script's`, () => {
      const text = readFileSync(path.join(real, file), 'utf8');
      const at = text.indexOf(needle);
      expect(at, `${needle} is not in ${file}`).toBeGreaterThanOrEqual(0);
      const line = text.slice(0, at).split('\n').length;
      const coverage = report[path.join(real, file)];
      if (!coverage) throw new Error(`${file} is not in the report`);
      const counted = Object.entries(coverage.fnMap)
        .filter(([, { decl }]) => decl.start.line === line)
        .map(([id]) => coverage.f[id]);
      // V8 lists a function it never compiled under none of its own ranges:
      // such a function never ran, so its own count is 0.
      const expected = own.get(file)?.get(line) ?? 0;
      expect(counted).toEqual([expected]);
      expect(
        expected,
        'the driver must make it differ from the script',
      ).not.toBe(whole.get(file));
    });
});

/**
 * A declarator read from an imported binding's property is counted (#928):
 * coverage-v8 drops `const home = env.HOME` (with `env` imported) as one of
 * Vite's own import bindings, and the converter now adds it back.
 */
const IMPORTED_READS = [
  "import { env } from 'node:process';",
  'function never() {',
  '  const home = env.HOME;',
  '  return home;',
  '}',
  'function called() {',
  '  const path = env.PATH;',
  '  return path;',
  '}',
  'called();',
  'globalThis.never = never;',
  '',
].join('\n');

describe('a declarator read from an imported binding (#928)', () => {
  it('reads unrun where no call reached it and run where one did', () => {
    writeFileSync(path.join(repo, 'scripts/imported.mjs'), IMPORTED_READS);
    const raw = path.join(repo, 'raw');
    const child = spawnSync(process.execPath, ['scripts/imported.mjs'], {
      cwd: repo,
      encoding: 'utf8',
      env: { ...process.env, NODE_V8_COVERAGE: raw },
    });
    const convert = spawnSync(process.execPath, [SCRIPT, raw, 'processes'], {
      cwd: repo,
      encoding: 'utf8',
      env: process.env,
    });
    expect([child.status, convert.status, convert.stderr]).toEqual([0, 0, '']);
    const counted = lines(repo, 'scripts/imported.mjs');
    expect([
      counted.filter((line) => line.startsWith('3=')),
      counted.filter((line) => line.startsWith('7=')),
    ]).toEqual([['3=0'], ['7=1']]);
  });
});

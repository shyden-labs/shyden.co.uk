import { spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  cpSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

/**
 * `scripts/coverage-processes.mjs` on a real child process (#899 AC3): a
 * script run under `NODE_V8_COVERAGE` takes one arm of an `if`, and the
 * converted report says which line ran and which did not, both ways round.
 * `tests/unit/coverage-processes.test.ts` holds the conversion itself.
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
    env: { ...process.env, NODE_V8_COVERAGE: '' },
  });
  return { child, convert };
};

/** Each statement of the planted file as `line=count`, in the checkout `at`. */
const lines = (at = repo) => {
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
  const planted = report[path.join(at, 'scripts/planted.mjs')];
  if (!planted) throw new Error('the planted script is not in the report');
  return Object.entries(planted.statementMap).map(
    ([id, { start }]) => `${start.line}=${planted.s[id]}`,
  );
};

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
        env: { ...process.env, NODE_V8_COVERAGE: '' },
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
      env: { ...process.env, NODE_V8_COVERAGE: '' },
    });
    expect([run.status, run.stdout, run.stderr]).toEqual([
      1,
      '',
      `✗ ENOENT: no such file or directory, scandir '${missing}'\n`,
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
        env: { ...process.env, NODE_V8_COVERAGE: '' },
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
        env: { ...process.env, NODE_V8_COVERAGE: '' },
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
        env: { ...process.env, NODE_V8_COVERAGE: '' },
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
          env: { ...process.env, NODE_V8_COVERAGE: '' },
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
        env: { ...process.env, NODE_V8_COVERAGE: '' },
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
        env: { ...process.env, NODE_V8_COVERAGE: '' },
      },
    );
    expect([run.status, run.stdout, run.stderr]).toEqual([
      1,
      '',
      `✗ coverage-processes: the compile cache holds ${path.join('ab', 'lone_ab.js')} with no map beside it (read ${cache})\n`,
    ]);
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
        env: { ...process.env, NODE_V8_COVERAGE: '' },
      },
    );
    expect([run.status, run.stderr]).toEqual([
      1,
      `✗ coverage-processes: ${name} (0 bytes, written by process ${exited.pid}, which has exited) is not whole JSON: Unexpected end of JSON input; process ${exited.pid} was started as: node playwright test --list\n`,
    ]);
  });
});

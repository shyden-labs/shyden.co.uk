import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  entriesUnder,
  validateArtifact,
} from '../../scripts/visual-rebaseline.mjs';

/**
 * The capture's file commands, run as the workflow runs them, against real
 * files in a temporary checkout (#459). `stage`'s output is read back through
 * `validateArtifact`, so the format the capture writes is the format the
 * commit accepts.
 */
const SCRIPT = resolve('scripts/visual-rebaseline.mjs');
const BASELINE = 'tests/e2e/__screenshots__/home-linux.png';
const SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const COMMITTED = Uint8Array.from([...SIGNATURE, 1]);
const RECAPTURED = Uint8Array.from([...SIGNATURE, 2, 3]);
const hex = (content: Uint8Array) =>
  createHash('sha256').update(content).digest('hex');

const made: string[] = [];
afterEach(() => {
  for (const dir of made.splice(0))
    rmSync(dir, { recursive: true, force: true });
});

/** A checkout with one committed baseline. realpath: macOS's tmpdir is a symlink, and cwd() is not. */
const checkout = () => {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'rebaseline-')));
  made.push(dir);
  mkdirSync(join(dir, dirname(BASELINE)), { recursive: true });
  writeFileSync(join(dir, BASELINE), COMMITTED);
  return dir;
};

const run = (dir: string, args: string[], env: Record<string, string>) =>
  spawnSync(process.execPath, [SCRIPT, ...args], {
    cwd: dir,
    encoding: 'utf8',
    env: {
      PATH: process.env.PATH ?? '',
      GITHUB_OUTPUT: join(dir, 'out.txt'),
      ...env,
    },
  });

const outputs = (dir: string) => readFileSync(join(dir, 'out.txt'), 'utf8');

const reportOf = (dir: string, failing: boolean) => ({
  suites: [
    {
      title: 'visual.spec.ts',
      specs: [
        {
          title: 'home',
          tests: [
            {
              results: [
                failing
                  ? {
                      status: 'failed',
                      errors: [
                        {
                          message:
                            'Error: expect(page).toHaveScreenshot(expected) failed\n\n  77 pixels (ratio 0.01 of all image pixels) are different.',
                        },
                      ],
                      attachments: [
                        {
                          name: 'home-expected.png',
                          path: join(dir, BASELINE),
                        },
                        {
                          name: 'home-actual.png',
                          path: join(dir, 'test-results/home-actual.png'),
                        },
                        {
                          name: 'home-diff.png',
                          path: join(dir, 'test-results/home-diff.png'),
                        },
                      ],
                    }
                  : { status: 'passed', errors: [], attachments: [] },
              ],
            },
          ],
        },
      ],
    },
  ],
  errors: [],
});
const LISTING = {
  suites: [
    {
      title: 'visual.spec.ts',
      specs: [{ title: 'home', tests: [{ results: [] }] }],
    },
  ],
  errors: [],
};
const classify = (dir: string, failing: boolean, exit: string) => {
  writeFileSync(join(dir, 'gate.json'), JSON.stringify(reportOf(dir, failing)));
  writeFileSync(join(dir, 'list.json'), JSON.stringify(LISTING));
  return run(dir, ['classify', 'gate.json', 'list.json'], { GATE_EXIT: exit });
};

describe("entriesUnder: the commit job's walk of the artifact (#459)", () => {
  // Why this walk is not tests/source-files.ts's `filesUnder`: that one skips
  // dotfiles and node_modules, which is right for scanning the repository and
  // would blind a validator to exactly what it exists to refuse.
  it('sees a dotfile, and reports a symlink without following it', () => {
    const dir = checkout();
    writeFileSync(join(dir, '.hidden'), 'x');
    symlinkSync(join(dir, BASELINE), join(dir, 'link.png'));
    const names = entriesUnder(dir).map(({ name, kind }) => `${kind} ${name}`);
    expect(names.sort()).toEqual([
      'directory tests',
      'directory tests/e2e',
      'directory tests/e2e/__screenshots__',
      'file .hidden',
      `file ${BASELINE}`,
      'other link.png',
    ]);
  });
});

describe('visual-rebaseline.mjs, run as the capture runs it (#459)', () => {
  it('fails an unknown command by name', () => {
    const result = run(checkout(), ['bogus'], {});
    expect(result.status).toBe(1);
    expect(result.stdout).toContain(
      '::error::unknown command bogus; expected qualify, classify, stage, find, locked or commit',
    );
  });

  it('classify: a passing gate has nothing to do', () => {
    const dir = checkout();
    const result = classify(dir, false, '0');
    expect(result.status, result.stdout + result.stderr).toBe(0);
    expect(outputs(dir)).toBe('failed=0\n');
  });

  it('classify: records each failed baseline with its committed hash', () => {
    const dir = checkout();
    const result = classify(dir, true, '1');
    expect(result.status, result.stdout + result.stderr).toBe(0);
    expect(outputs(dir)).toBe('failed=1\n');
    expect(JSON.parse(readFileSync(join(dir, 'failed.json'), 'utf8'))).toEqual([
      { path: BASELINE, pixels: 77, before: hex(COMMITTED) },
    ]);
  });

  it('classify: refuses a gate whose exit disagrees with its report', () => {
    const result = classify(checkout(), false, '1');
    expect(result.status).toBe(1);
    expect(result.stdout).toContain(
      '::error::the gate exited 1 with no failed screenshot in its report',
    );
  });

  it('stage: writes what the commit accepts', () => {
    const dir = checkout();
    expect(classify(dir, true, '1').status).toBe(0);
    writeFileSync(join(dir, BASELINE), RECAPTURED);
    mkdirSync(join(dir, 'node_modules/@playwright/test'), { recursive: true });
    writeFileSync(
      join(dir, 'node_modules/@playwright/test/package.json'),
      '{"version":"1.58.2"}',
    );
    const result = run(dir, ['stage', 'rebaseline'], {
      PR_NUMBER: '42',
      HEAD_SHA: 'c'.repeat(40),
    });
    expect(result.status, result.stdout + result.stderr).toBe(0);
    const { manifest, files } = validateArtifact({
      entries: entriesUnder(join(dir, 'rebaseline')),
      run: { pr: 42, headSha: 'c'.repeat(40) },
      headPaths: new Set([BASELINE]),
    });
    expect(manifest).toEqual({
      pr: 42,
      headSha: 'c'.repeat(40),
      playwright: '1.58.2',
      files: [
        {
          path: BASELINE,
          sha256: hex(RECAPTURED),
          bytes: RECAPTURED.length,
          pixels: 77,
        },
      ],
    });
    expect(files[0].content).toEqual(Buffer.from(RECAPTURED));
  });

  it('stage: refuses a baseline the recapture left unchanged', () => {
    const dir = checkout();
    expect(classify(dir, true, '1').status).toBe(0);
    mkdirSync(join(dir, 'node_modules/@playwright/test'), { recursive: true });
    writeFileSync(
      join(dir, 'node_modules/@playwright/test/package.json'),
      '{"version":"1.58.2"}',
    );
    const result = run(dir, ['stage', 'rebaseline'], {
      PR_NUMBER: '42',
      HEAD_SHA: 'c'.repeat(40),
    });
    expect(result.status).toBe(1);
    expect(result.stdout).toContain(
      `::error::the gate failed ${BASELINE}, and the recapture left it unchanged`,
    );
  });
});

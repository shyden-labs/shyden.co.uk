import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { main } from '../../scripts/test-e2e.mjs';

/**
 * `scripts/test-e2e.mjs` cleans up the report it keeps for itself (#390).
 *
 * The report of a run with no `EVIDENCE_DIR` lands in a temp directory that
 * nothing but the reconciliation reads. Its removal sat in a `finally` around
 * code that ends in `process.exit()`, which ends the process without running
 * any `finally`: every run left its directory behind, 739 of them in one
 * session's `$TMPDIR`, each holding a whole report after a real run.
 *
 * Playwright is the runner `main` is handed (#1295, which replaced a `npx`
 * stand-in on PATH): it lists `listed` tests and writes `report` as the run's
 * report, or no report at all, so the script reaches each verdict at once;
 * the temp folder is a scratch one, so what the run leaves there is all it
 * left. No process starts.
 */

const PID = 4242;

let dir = '';
beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), 'e2e-cleanup-'));
  mkdirSync(path.join(dir, 'tmp'));
});
afterEach(() => {
  vi.restoreAllMocks();
  process.exitCode = undefined;
  rmSync(dir, { recursive: true, force: true });
});

const run = ({
  env = {},
  report = '',
  listed = 3,
}: {
  env?: Record<string, string>;
  report?: string;
  listed?: number;
} = {}) => {
  const spawn = ((
    _command: string,
    args: readonly string[],
    options: { env?: NodeJS.ProcessEnv },
  ) => {
    if (args[2] === '--list')
      return {
        status: 0,
        stdout: `Total: ${listed} tests in 1 file\n`,
        stderr: '',
      };
    if (report) {
      writeFileSync(String(options.env?.PLAYWRIGHT_JSON_OUTPUT_NAME), report);
      return { status: 0 };
    }
    return { status: 1 };
  }) as unknown as NonNullable<Parameters<typeof main>[0]>['spawn'];
  const printed: string[] = [];
  const keep = (...parts: unknown[]) => {
    printed.push(`${parts.map(String).join(' ')}\n`);
  };
  vi.spyOn(console, 'error').mockImplementation(keep);
  vi.spyOn(console, 'log').mockImplementation(keep);
  vi.spyOn(process.stderr, 'write').mockImplementation((chunk) => {
    printed.push(String(chunk));
    return true;
  });
  vi.spyOn(process.stdout, 'write').mockImplementation((chunk) => {
    printed.push(String(chunk));
    return true;
  });
  main({ argv: [], env, spawn, pid: PID, tmp: path.join(dir, 'tmp') });
  const status = process.exitCode ?? 0;
  process.exitCode = undefined;
  return { stderr: printed.join(''), status };
};

const own = () => path.join(dir, 'tmp', `e2e-reconcile-${PID}`);

describe('the report a run keeps for itself (#390)', () => {
  it('is removed when the run ends, even by a refusal', () => {
    const result = run();
    // The refusal names the report it could not read, which is the proof the
    // run used this directory: its absence below is then a removal.
    expect(result.stderr).toContain('E2E RECONCILIATION FAILED');
    expect(result.stderr).toContain(own());
    expect(result.status).toBe(1);
    expect(existsSync(own())).toBe(false);
  });

  it("leaves an evidence directory alone, which is the operator's", () => {
    const evidence = path.join(dir, 'evidence');
    const result = run({ env: { EVIDENCE_DIR: evidence } });
    expect(result.status).toBe(1);
    expect(existsSync(evidence)).toBe(true);
  });
});

describe("the run's verdict, from its own report (#390)", () => {
  /** A json report of three passed tests, in a project excused from navigating. */
  const REPORT = JSON.stringify({
    config: {
      projects: [{ name: 'content', metadata: { requiresNavigation: false } }],
    },
    stats: { expected: 3, unexpected: 0, flaky: 0, skipped: 0 },
    suites: [
      {
        title: 'a.spec.ts',
        specs: ['one', 'two', 'three'].map((title) => ({
          title,
          tests: [
            {
              projectName: 'content',
              status: 'expected',
              results: [{ status: 'passed', duration: 1 }],
            },
          ],
        })),
      },
    ],
  });

  it('passes a run that executed the whole suite, and still removes its report', () => {
    const result = run({ report: REPORT });
    expect(result.stderr).not.toContain('RECONCILIATION FAILED');
    expect(result.status).toBe(0);
    expect(existsSync(own())).toBe(false);
  });

  it('fails a green run that executed less than the suite it listed', () => {
    const result = run({ report: REPORT, listed: 4 });
    expect(result.stderr).toContain(
      'E2E RECONCILIATION FAILED — this run measured less than the suite',
    );
    expect(result.stderr).toMatch(/accounted for by this run +: 3\n/);
    expect(result.status).toBe(1);
  });
});

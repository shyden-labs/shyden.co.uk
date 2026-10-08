import { describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { scratchDir } from '../scratch-dir';

/**
 * The live dashboard's Playwright reporter, run by a real Playwright (#390
 * F158).
 *
 * A test declared to fail with `test.fail()` and failing is a PASS to
 * Playwright: the run is green and its summary counts it as expected. The
 * reporter read `result.status` alone, so the dashboard's live counter
 * showed each one failed: /classroom-groups' truncation tests carry five
 * (#409), on every engine the emulated group runs. Only a run can say what
 * Playwright hands a reporter, so this one runs four tests, one per outcome.
 */
describe('the Playwright dashboard reporter', () => {
  it('reports each test as Playwright judges it, not as its body ended', () => {
    const dir = scratchDir('jsonl-reporter-');
    // The ESM entry: the CommonJS one has no named exports to import, and a
    // spec that fails to load is "No tests found", which also exits 1.
    const playwright = resolve('node_modules/@playwright/test/index.mjs');
    writeFileSync(
      join(dir, 'outcomes.spec.mjs'),
      [
        `import { test, expect } from ${JSON.stringify(playwright)};`,
        "test('passes', () => {});",
        "test('fails as declared', () => { test.fail(); expect(1).toBe(2); });",
        "test('passes though declared to fail', () => { test.fail(); });",
        "test('skipped', () => { test.skip(); });",
      ].join('\n'),
    );
    writeFileSync(
      join(dir, 'playwright.config.mjs'),
      `export default ${JSON.stringify({
        testDir: dir,
        reporter: [[resolve('tests/reporters/jsonl-reporter.ts')]],
      })};`,
    );
    const file = join(dir, 'dashboard.jsonl');

    const run = spawnSync(
      process.execPath,
      [
        resolve('node_modules/@playwright/test/cli.js'),
        'test',
        '-c',
        join(dir, 'playwright.config.mjs'),
      ],
      {
        cwd: dir,
        encoding: 'utf8',
        env: { ...process.env, DASHBOARD_JSONL_FILE: file },
      },
    );
    // The one unexpected pass fails the run, which is Playwright's verdict
    // and the reporter's to agree with.
    expect(run.status, `${run.stdout}${run.stderr}`).toBe(1);

    const events = readFileSync(file, 'utf8')
      .split('\n')
      .filter((line) => line !== '')
      .map((line) => JSON.parse(line) as Record<string, unknown>);
    expect(events[0], 'the run found all four tests').toMatchObject({
      event: 'begin',
      total: 4,
    });
    const reported = Object.fromEntries(
      events
        .filter(({ event }) => event === 'test')
        .map(({ title, status }) => [title, status]),
    );
    expect(reported).toEqual({
      passes: 'passed',
      'fails as declared': 'passed',
      'passes though declared to fail': 'failed',
      skipped: 'skipped',
    });
  });
});

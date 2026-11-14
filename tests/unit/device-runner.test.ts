import { describe, it, expect, afterEach } from 'vitest';
import { serversClosedAfterEach } from '../http-stand-in';
import { createServer, type Server } from 'node:http';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  confirmServesBuild,
  contained,
  exitCodeFor,
  once,
  playwrightVerdict,
  iosEvidenceReportOf,
  vitestVerdict,
  waitUntil,
  deviceRunGroups,
  runGroups,
} from '../../scripts/test-devices.mjs';

/**
 * `npm run test:devices` decides what a gauntlet proved, and until #390 none
 * of that decision was run by a test: the file was importable (#227) and its
 * verdicts, its device detection and its cleanup were each held only by being
 * read. Nothing here starts a build, a phone or a preview server. The HTTP
 * cases talk to a server this file starts on a free port of its own, so no
 * request leaves the machine and nothing already listening is touched.
 */

/** A server on a free port answering every request with `answer`. */
async function serving(
  answer: (method: string, url: string) => { status: number; body: string },
): Promise<{ server: Server; port: number; seen: string[] }> {
  const seen: string[] = [];
  const server = createServer((request, response) => {
    seen.push(`${request.method} ${request.url}`);
    const { status, body } = answer(request.method ?? '', request.url ?? '');
    response.writeHead(status, { 'content-type': 'text/html' });
    response.end(body);
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (address === null || typeof address === 'string')
    throw new Error('expected the server to listen on a TCP port');
  return { server, port: address.port, seen };
}

const servers = serversClosedAfterEach();

describe('waitUntil: the timeout bounds the whole wait', () => {
  it('abandons a predicate that never settles at the deadline', async () => {
    const started = Date.now();
    await expect(
      waitUntil(() => new Promise(() => {}), {
        timeoutMs: 50,
        describe: 'a request the server accepted and never answered',
      }),
    ).rejects.toThrow(
      'Timed out after 50ms waiting for: a request the server accepted and never answered',
    );
    expect(Date.now() - started).toBeLessThan(1_000);
  });

  it('answers the predicate’s own value, not a boolean', async () => {
    const answer = { ok: true };
    expect(
      await waitUntil(async () => answer, { timeoutMs: 50, describe: 'x' }),
    ).toBe(answer);
  });

  it('keeps asking until the answer is truthy', async () => {
    let asked = 0;
    const answer = await waitUntil(() => (++asked === 3 ? 'ready' : ''), {
      timeoutMs: 1_000,
      describe: 'the third answer',
      intervalMs: 1,
    });
    expect([answer, asked]).toEqual(['ready', 3]);
  });

  it('takes a slow answer that arrives in time', async () => {
    const answer = await waitUntil(
      () => new Promise((resolve) => setTimeout(() => resolve('late'), 20)),
      { timeoutMs: 1_000, describe: 'a slow answer' },
    );
    expect(answer).toBe('late');
  });

  it('names what it waited for when every answer is falsy', async () => {
    await expect(
      waitUntil(() => false, {
        timeoutMs: 20,
        describe: 'port 4321 to become free',
        intervalMs: 1,
      }),
    ).rejects.toThrow(
      'Timed out after 20ms waiting for: port 4321 to become free',
    );
  });
});

/** A Playwright JSON report's `stats`, clean unless a count is given. */
const stats = (counts: Partial<Record<string, unknown>> = {}) => ({
  stats: { expected: 40, flaky: 0, unexpected: 0, skipped: 5, ...counts },
});

describe('iosEvidenceReportOf: where the iOS report goes for the evidence page (#354)', () => {
  it('names vitest-report.json inside the evidence directory', () => {
    expect(iosEvidenceReportOf({ EVIDENCE_DIR: '/runs/ios' })).toBe(
      '/runs/ios/vitest-report.json',
    );
  });

  it('names nothing when the run asked for no evidence', () => {
    expect(iosEvidenceReportOf({})).toBeNull();
  });

  it('names nothing for an empty evidence directory', () => {
    expect(iosEvidenceReportOf({ EVIDENCE_DIR: '' })).toBeNull();
  });
});

describe('playwrightVerdict: what a Playwright group proved', () => {
  const REPORT = '/repo/test-results/desktop-report.json';
  const judge = (code: number | null, report: unknown, extraSkipped?: number) =>
    playwrightVerdict({
      name: 'desktop',
      code,
      report,
      reportFile: REPORT,
      extraSkipped,
    });

  it('passes a clean report from a clean exit', () => {
    expect(judge(0, stats(), 7)).toEqual({
      name: 'desktop',
      status: 'passed',
      passed: 40,
      failed: 0,
      skippedByDesign: 12,
      reason: undefined,
    });
  });

  it('counts no extra skips when none is given', () => {
    expect(judge(0, stats()).skippedByDesign).toBe(5);
  });

  it('fails a report with failures, saying how many', () => {
    expect(judge(1, stats({ unexpected: 2 }))).toMatchObject({
      status: 'failed',
      failed: 2,
      reason: '2 test(s) failed (process exit code 1)',
    });
  });

  it('fails a clean report from a failed exit, as a disagreement', () => {
    expect(judge(1, stats())).toMatchObject({
      status: 'failed',
      reason:
        'disagreement: process exit code 1 but the report says 0 failed -- treated as failed either way, since these should never disagree',
    });
  });

  it('fails a report with failures from a clean exit, as a disagreement', () => {
    expect(judge(0, stats({ unexpected: 1 }))).toMatchObject({
      status: 'failed',
      reason:
        'disagreement: process exit code 0 but the report says 1 failed -- treated as failed either way, since these should never disagree',
    });
  });

  // #502: Playwright calls a test `flaky` when it failed and then passed on a
  // retry, and exits 0. A retry is not a fix, so the group is failed, and the
  // test is counted with the failures rather than the passes.
  it('fails a test that passed only on a retry, from a clean exit', () => {
    expect(judge(0, stats({ flaky: 1 }))).toEqual({
      name: 'desktop',
      status: 'failed',
      passed: 40,
      failed: 1,
      skippedByDesign: 5,
      reason:
        '1 test(s) passed only on a retry -- a retry is not a fix, so this group is failed',
    });
  });

  it('names the failures before the retries when a group has both', () => {
    expect(judge(1, stats({ unexpected: 2, flaky: 3 }))).toMatchObject({
      status: 'failed',
      failed: 5,
      reason: '2 test(s) failed (process exit code 1)',
    });
  });

  it('fails a group killed by a signal, whose exit code is null', () => {
    expect(judge(null, stats()).status).toBe('failed');
  });

  it('fails a run in which nothing passed: it measured nothing', () => {
    expect(
      judge(0, stats({ expected: 0, flaky: 0, skipped: 40 })),
    ).toMatchObject({
      status: 'failed',
      passed: 0,
      reason:
        'no test passed, so this group proved nothing -- a run that measured nothing is not a pass',
    });
  });

  it('fails a report that was never written, naming it', () => {
    expect(judge(0, null)).toEqual({
      name: 'desktop',
      status: 'failed',
      passed: null,
      failed: null,
      skippedByDesign: null,
      reason: `the process exited with code 0 but its report (${REPORT}) was never written -- cannot verify real counts, so this cannot be reported as anything other than failed.`,
    });
  });

  it.each([
    [
      'a missing count',
      { unexpected: undefined },
      'stats.unexpected',
      'undefined',
    ],
    ['a count written as text', { expected: '40' }, 'stats.expected', '"40"'],
    ['a fractional count', { flaky: 1.5 }, 'stats.flaky', '1.5'],
    ['a missing retry count', { flaky: undefined }, 'stats.flaky', 'undefined'],
    ['a negative count', { skipped: -1 }, 'stats.skipped', '-1'],
  ])('refuses %s, naming the field', (_, counts, field, got) => {
    expect(() => judge(0, stats(counts))).toThrow(
      `expected desktop's Playwright report to carry a count at ${field} -- got ${got}`,
    );
  });

  it('refuses a report with no stats at all', () => {
    expect(() => judge(0, {})).toThrow(
      "expected desktop's Playwright report to carry a count at stats.expected -- got undefined",
    );
  });
});

// #1020: macOS WebKit can abort while a page closes, inside its own Screen
// Time observer. The run stays red (never a skip, never a retry), but the
// reason names which failures were that crash, by its exact text, so a red
// desktop group is not read as the site being wrong.
describe("playwrightVerdict: naming macOS WebKit's Screen Time crash (#1020)", () => {
  const CRASH =
    "browserContext.close: Test ended.\nBrowser logs:\n\n<launching>\n*** Terminating app due to uncaught exception 'NSInternalInconsistencyException', reason: 'Cannot remove an observer <WKScreenTimeConfigurationObserver 0x7b7> for the key path \"configuration.enforcesChildRestrictions\"'";
  const result = (
    status: string,
    message?: string,
    where: 'error' | 'errors' = 'errors',
  ) => ({
    status,
    ...(message === undefined
      ? {}
      : where === 'error'
        ? { error: { message } }
        : { errors: [{ message }] }),
  });
  const spec = (
    title: string,
    projectName: string,
    status: string,
    results: unknown[],
  ) => ({
    title,
    tests: [{ projectName, status, results }],
  });
  const report = (
    specs: unknown[],
    counts: Partial<Record<string, unknown>> = {},
  ) => ({
    ...stats(counts),
    suites: [
      {
        title: 'homepage.spec.ts',
        specs: [],
        suites: [{ title: 'layout', specs }],
      },
    ],
  });
  const judge = (code: number, r: unknown) =>
    playwrightVerdict({
      name: 'desktop',
      code,
      report: r,
      reportFile: 'r.json',
    });
  const NAMED =
    "; 1 of them crashed inside macOS WebKit's own Screen Time teardown, not the site (#1020): ";

  it('names a failed test whose browser logs carry the crash, and stays failed', () => {
    expect(
      judge(
        1,
        report(
          [
            spec('no scroll at 390px', 'webkit', 'unexpected', [
              result('failed', CRASH),
            ]),
          ],
          { unexpected: 1 },
        ),
      ),
    ).toMatchObject({
      status: 'failed',
      reason: `1 test(s) failed${NAMED}[webkit] no scroll at 390px (process exit code 1)`,
    });
  });

  it('reads the crash from a result’s single error too', () => {
    expect(
      judge(
        1,
        report(
          [
            spec('t', 'webkit', 'unexpected', [
              result('failed', CRASH, 'error'),
            ]),
          ],
          { unexpected: 1 },
        ),
      ).reason,
    ).toBe(`1 test(s) failed${NAMED}[webkit] t (process exit code 1)`);
  });

  it('names a test that crashed and then passed on a retry, still failed', () => {
    expect(
      judge(
        0,
        report(
          [
            spec('t', 'webkit', 'flaky', [
              result('failed', CRASH),
              result('passed'),
            ]),
          ],
          { flaky: 1 },
        ),
      ),
    ).toMatchObject({
      status: 'failed',
      reason: `1 test(s) passed only on a retry -- a retry is not a fix, so this group is failed${NAMED}[webkit] t`,
    });
  });

  it('leaves a failure without the crash unnamed', () => {
    expect(
      judge(
        1,
        report(
          [
            spec('t', 'webkit', 'unexpected', [
              result('failed', 'expected 0 got 5'),
            ]),
          ],
          { unexpected: 1 },
        ),
      ).reason,
    ).toBe('1 test(s) failed (process exit code 1)');
  });

  it('does not name a near-miss: another observer the same exception names', () => {
    const other = CRASH.replace(
      'WKScreenTimeConfigurationObserver',
      'NSKeyValueObservance',
    );
    expect(
      judge(
        1,
        report([spec('t', 'webkit', 'unexpected', [result('failed', other)])], {
          unexpected: 1,
        }),
      ).reason,
    ).toBe('1 test(s) failed (process exit code 1)');
  });

  it('does not name a test that passed, whatever its results say', () => {
    expect(
      judge(
        0,
        report([spec('t', 'webkit', 'expected', [result('passed', CRASH)])]),
      ).reason,
    ).toBeUndefined();
  });

  // A `test.fail()` test that failed as declared is `expected`, and keeps its
  // errors: it is not a red, so its crash is not one of the group's failures.
  it('does not name an expected failure beside a real one', () => {
    expect(
      judge(
        1,
        report(
          [
            spec('declared', 'webkit', 'expected', [result('failed', CRASH)]),
            spec('real', 'chromium', 'unexpected', [
              result('failed', 'timeout'),
            ]),
          ],
          { unexpected: 1 },
        ),
      ).reason,
    ).toBe('1 test(s) failed (process exit code 1)');
  });

  it('names only the crashed ones among several failures, counting them', () => {
    expect(
      judge(
        1,
        report(
          [
            spec('a', 'webkit', 'unexpected', [result('failed', CRASH)]),
            spec('b', 'chromium', 'unexpected', [result('failed', 'timeout')]),
            spec('c', 'webkit', 'unexpected', [result('failed', CRASH)]),
          ],
          { unexpected: 3 },
        ),
      ).reason,
    ).toBe(
      "3 test(s) failed; 2 of them crashed inside macOS WebKit's own Screen Time teardown, not the site (#1020): [webkit] a, [webkit] c (process exit code 1)",
    );
  });

  it('names nothing in a report that carries no suites', () => {
    expect(judge(1, stats({ unexpected: 1 })).reason).toBe(
      '1 test(s) failed (process exit code 1)',
    );
  });
});

/** A vitest JSON report's top-level counts, clean unless one is given. */
const vitestReport = (counts: Record<string, unknown> = {}) => ({
  numPassedTests: 30,
  numFailedTests: 0,
  numFailedTestSuites: 0,
  numPendingTests: 2,
  numTodoTests: 1,
  success: true,
  ...counts,
});

describe('vitestVerdict: what the iOS group proved', () => {
  const REPORT = '/repo/test-results/ios-report.json';
  const judge = (code: number | null, report: unknown) =>
    vitestVerdict({ name: 'ios', code, report, reportFile: REPORT });

  it('passes a clean report from a clean exit, todo counted as skipped', () => {
    expect(judge(0, vitestReport())).toEqual({
      name: 'ios',
      status: 'passed',
      passed: 30,
      failed: 0,
      skippedByDesign: 3,
      reason: undefined,
    });
  });

  it('fails failed tests, saying how many', () => {
    expect(
      judge(1, vitestReport({ numFailedTests: 2, success: false })),
    ).toMatchObject({
      status: 'failed',
      reason: '2 test(s) and 0 file(s) failed (process exit code 1)',
    });
  });

  it('names a file that failed to load, where no test failed', () => {
    // Measured: a test file throwing at import gives numFailedTests 0,
    // numFailedTestSuites 1, success false and exit 1. This read "0 test(s)
    // failed" before, which sends the reader looking for a test.
    expect(
      judge(
        1,
        vitestReport({
          numPassedTests: 0,
          numFailedTestSuites: 1,
          success: false,
        }),
      ),
    ).toMatchObject({
      status: 'failed',
      reason: '0 test(s) and 1 file(s) failed (process exit code 1)',
    });
  });

  it('fails a report that says it did not succeed, from a clean exit', () => {
    expect(judge(0, vitestReport({ success: false }))).toMatchObject({
      status: 'failed',
      reason:
        'disagreement: process exit code 0 but the report says 0 failed and success false -- treated as failed either way, since these should never disagree',
    });
  });

  it('fails a clean report from a failed exit, as a disagreement', () => {
    expect(judge(1, vitestReport())).toMatchObject({
      status: 'failed',
      reason:
        'disagreement: process exit code 1 but the report says 0 failed and success true -- treated as failed either way, since these should never disagree',
    });
  });

  it('fails a run in which nothing passed', () => {
    expect(judge(0, vitestReport({ numPassedTests: 0 }))).toMatchObject({
      status: 'failed',
      reason:
        'no test passed, so this group proved nothing -- a run that measured nothing is not a pass',
    });
  });

  it('fails a report that was never written, naming it', () => {
    expect(judge(1, null)).toMatchObject({
      status: 'failed',
      passed: null,
      reason: `the process exited with code 1 but its report (${REPORT}) was never written -- cannot verify real counts, so this cannot be reported as anything other than failed.`,
    });
  });

  it.each([
    ['numPassedTests'],
    ['numFailedTests'],
    ['numFailedTestSuites'],
    ['numPendingTests'],
    ['numTodoTests'],
  ])('refuses a report missing %s, naming it', (field) => {
    expect(() => judge(0, vitestReport({ [field]: undefined }))).toThrow(
      `expected ios's vitest report to carry a count at ${field} -- got undefined`,
    );
  });

  it('refuses a success flag that is not a boolean', () => {
    expect(() => judge(0, vitestReport({ success: 'true' }))).toThrow(
      `expected ios's vitest report to say true or false at success -- got "true"`,
    );
  });
});

describe('contained: one group that cannot report does not take the others with it', () => {
  it('turns a group that threw into a failed row naming why, and keeps its sibling', async () => {
    const sibling = { name: 'desktop', status: 'passed' };
    const [ios, desktop] = await Promise.all([
      contained('ios', async () => {
        throw new Error('expected the iOS report to be valid JSON');
      }),
      contained('desktop', async () => sibling),
    ]);
    expect(desktop).toBe(sibling);
    expect(ios).toMatchObject({
      name: 'ios',
      status: 'failed',
      passed: null,
      failed: null,
      skippedByDesign: null,
      reason:
        'the group stopped before it could report: expected the iOS report to be valid JSON',
    });
    expect(ios.durationMs).toBeGreaterThanOrEqual(0);
  });
});

describe('confirmServesBuild: the preview serves the bytes this run built', () => {
  const dirs: string[] = [];
  afterEach(() => {
    for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true });
  });

  const BUILT =
    '<!doctype html><script type="module" src="/_astro/page.B2x9.js"></script>';
  const builtFile = () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'device-runner-'));
    dirs.push(dir);
    const file = path.join(dir, 'index.html');
    writeFileSync(file, BUILT);
    return file;
  };

  it('accepts the page this run built, byte for byte', async () => {
    const { server, port } = await serving(() => ({
      status: 200,
      body: BUILT,
    }));
    servers.push(server);
    await expect(
      confirmServesBuild(
        `http://127.0.0.1:${port}/classroom-groups`,
        builtFile(),
      ),
    ).resolves.toBeUndefined();
  });

  it('refuses an older build, which carries the /_astro/ marker too', async () => {
    const older =
      '<!doctype html><script type="module" src="/_astro/page.A1b2.js"></script>';
    const { server, port } = await serving(() => ({
      status: 200,
      body: older,
    }));
    servers.push(server);
    const url = `http://127.0.0.1:${port}/classroom-groups`;
    await expect(confirmServesBuild(url, builtFile())).rejects.toThrow(
      `expected ${url} to serve the page this run just built -- it answered 200 with ${older.length} characters that differ from the ${BUILT.length} built`,
    );
  });

  it('refuses an error page, naming its status', async () => {
    const { server, port } = await serving(() => ({
      status: 404,
      body: BUILT,
    }));
    servers.push(server);
    await expect(
      confirmServesBuild(
        `http://127.0.0.1:${port}/classroom-groups`,
        builtFile(),
      ),
    ).rejects.toThrow('it answered 404');
  });
});

describe('once: a second caller waits for the run already under way', () => {
  it('runs the task once and hands every caller the same promise', async () => {
    let runs = 0;
    let finish = () => {};
    const task = once(
      () =>
        new Promise<void>((resolve) => {
          runs += 1;
          finish = resolve;
        }),
    );
    const first = task();
    const second = task();
    expect(second).toBe(first);
    let secondSettled = false;
    void second.then(() => {
      secondSettled = true;
    });
    await Promise.resolve();
    expect(secondSettled).toBe(false);
    finish();
    await second;
    expect([runs, secondSettled]).toEqual([1, true]);
  });
});

describe('exitCodeFor: an interrupted run exits as the shell would report it', () => {
  it.each([
    ['SIGINT', 130],
    ['SIGTERM', 143],
  ] as const)('%s exits %i', (signal, code) => {
    expect(exitCodeFor(signal)).toBe(code);
  });
});

describe('deviceRunGroups: every group, or the iPhone alone (#623)', () => {
  it('runs all three groups when given nothing', () => {
    expect(deviceRunGroups([])).toEqual(['desktop', 'android', 'ios']);
  });

  it('runs the iOS group alone for --ios, the floor record of the iPhone journeys', () => {
    expect(deviceRunGroups(['--ios'])).toEqual(['ios']);
  });

  it('refuses an argument it does not know, naming it', () => {
    expect(deviceRunGroups(['--android'])).toBe(
      'usage: test-devices.mjs [--ios] (got --android)',
    );
  });

  it('refuses --ios given twice, or with anything beside it', () => {
    expect(deviceRunGroups(['--ios', '--ios'])).toBe(
      'usage: test-devices.mjs [--ios] (got --ios --ios)',
    );
  });
});

/**
 * Shyden's ruling on #1157 (2026-11-14): a simulator shares the Mac's CPU, so
 * when the iOS group's device is a simulator it starts only after every other
 * group has finished. With the real iPhone the groups stay concurrent.
 */
describe('runGroups: who runs together, and who runs last', () => {
  function recorder() {
    const events: string[] = [];
    const gates: Record<string, () => void> = {};
    const group = (name: string) => () =>
      new Promise<Record<string, unknown>>((resolve) => {
        events.push(`start ${name}`);
        gates[name] = () => {
          events.push(`end ${name}`);
          resolve({ name, status: 'passed' });
        };
      });
    return { events, gates, group };
  }
  const flush = () => new Promise((r) => setImmediate(r));

  it('starts every group at once when none is held back', async () => {
    const r = recorder();
    const done = runGroups(['desktop', 'android', 'ios'], {
      desktop: r.group('desktop'),
      android: r.group('android'),
      ios: r.group('ios'),
    });
    await flush();
    expect(r.events).toEqual(['start desktop', 'start android', 'start ios']);
    r.gates.ios!();
    r.gates.android!();
    r.gates.desktop!();
    expect((await done).map((g) => g.name)).toEqual([
      'desktop',
      'android',
      'ios',
    ]);
  });

  it('starts the held-back group only after every other group has finished', async () => {
    const r = recorder();
    const done = runGroups(
      ['desktop', 'android', 'ios'],
      {
        desktop: r.group('desktop'),
        android: r.group('android'),
        ios: r.group('ios'),
      },
      { last: 'ios' },
    );
    await flush();
    expect(r.events).toEqual(['start desktop', 'start android']);
    r.gates.desktop!();
    await flush();
    expect(r.events).not.toContain('start ios');
    r.gates.android!();
    await flush();
    expect(r.events).toEqual([
      'start desktop',
      'start android',
      'end desktop',
      'end android',
      'start ios',
    ]);
    r.gates.ios!();
    expect((await done).map((g) => g.name)).toEqual([
      'desktop',
      'android',
      'ios',
    ]);
  });

  it('still runs the held-back group after one of the others fails', async () => {
    const groups = await runGroups(
      ['desktop', 'ios'],
      {
        desktop: async () => {
          throw new Error('report unreadable');
        },
        ios: async () => ({ name: 'ios', status: 'passed' }),
      },
      { last: 'ios' },
    );
    expect(groups.map((g) => [g.name, g.status])).toEqual([
      ['desktop', 'failed'],
      ['ios', 'passed'],
    ]);
  });

  it('runs a held-back group that was not chosen for this run not at all', async () => {
    const r = recorder();
    const done = runGroups(
      ['desktop'],
      { desktop: r.group('desktop'), ios: r.group('ios') },
      { last: 'ios' },
    );
    await flush();
    r.gates.desktop!();
    expect((await done).map((g) => g.name)).toEqual(['desktop']);
    expect(r.events).toEqual(['start desktop', 'end desktop']);
  });
});

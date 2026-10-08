import { describe, it, expect, afterEach } from 'vitest';
import { serversClosedAfterEach } from '../http-stand-in';
import { createServer, type Server } from 'node:http';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  confirmServesBuild,
  contained,
  deleteSession,
  exitCodeFor,
  leakedSessionOf,
  once,
  playwrightVerdict,
  vitestVerdict,
  waitUntil,
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
  stats: { expected: 40, flaky: 2, unexpected: 0, skipped: 5, ...counts },
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

  it('passes a clean report from a clean exit, flaky passes counted as passes', () => {
    expect(judge(0, stats(), 7)).toEqual({
      name: 'desktop',
      status: 'passed',
      passed: 42,
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

describe('leakedSessionOf: a leaked session marker names a port and a session', () => {
  it('reads a well-formed marker', () => {
    expect(leakedSessionOf({ port: 4723, sessionId: 'abc-123' })).toEqual({
      port: 4723,
      sessionId: 'abc-123',
    });
  });

  it.each([
    ['no port', { sessionId: 'abc' }],
    ['a port written as text', { port: '4723', sessionId: 'abc' }],
    ['port 0', { port: 0, sessionId: 'abc' }],
    ['a port past 65535', { port: 65_536, sessionId: 'abc' }],
    ['no session', { port: 4723 }],
    ['an empty session', { port: 4723, sessionId: '' }],
    ['null', null],
  ])('refuses a marker with %s', (_, marker) => {
    expect(() => leakedSessionOf(marker)).toThrow(
      `expected the iOS session marker to name a port and a session id -- got ${JSON.stringify(marker)}`,
    );
  });
});

describe('deleteSession: a leaked session is reported deleted only when it was', () => {
  it('sends DELETE for the session and accepts a 200', async () => {
    const { server, port, seen } = await serving(() => ({
      status: 200,
      body: '{"value":null}',
    }));
    servers.push(server);
    await deleteSession({ port, sessionId: 'abc-123' });
    expect(seen).toEqual(['DELETE /session/abc-123']);
  });

  it('refuses a session safaridriver does not know', async () => {
    const { server, port } = await serving(() => ({ status: 404, body: '' }));
    servers.push(server);
    await expect(deleteSession({ port, sessionId: 'abc-123' })).rejects.toThrow(
      'safaridriver answered 404 to DELETE /session/abc-123',
    );
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

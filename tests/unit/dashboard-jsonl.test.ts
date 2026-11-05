import { readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DashboardLog, toDashboardStatus } from '../reporters/dashboard-jsonl';
import { scratchDir } from '../scratch-dir';

const tmp = () => scratchDir('dashboard-jsonl-');
const lines = (file: string) =>
  readFileSync(file, 'utf8')
    .trim()
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line) as Record<string, unknown>);

afterEach(() => vi.restoreAllMocks());

describe('the dashboard status a framework outcome folds into', () => {
  it('keeps passed and skipped, and folds everything else into failed', () => {
    expect(toDashboardStatus('passed')).toBe('passed');
    expect(toDashboardStatus('skipped')).toBe('skipped');
    // Playwright's own three, then vitest's, then a value neither documents.
    for (const outcome of ['failed', 'timedOut', 'interrupted', 'pending', ''])
      expect(toDashboardStatus(outcome), outcome).toBe('failed');
  });

  it('never folds an unexpected outcome into passed', () => {
    // The direction that matters. A dashboard that reports a timed-out test
    // as green is worse than one that reports a passing test as red, and
    // this project has shipped that confusion before.
    expect(toDashboardStatus('PASSED')).toBe('failed');
    expect(toDashboardStatus('pass')).toBe('failed');
  });
});

describe('the dashboard log', () => {
  it('is off entirely when no file is named', () => {
    const log = new DashboardLog('probe', {});
    expect(log.enabled).toBe(false);
    // Neither call may throw, and neither may invent a file: a bare
    // `npx playwright test` with no dashboard env set runs unaffected.
    expect(log.start()).toBe(false);
    log.append({ event: 'test' });
  });

  it('stamps every line with the group, ahead of the event', () => {
    const file = join(tmp(), 'events.jsonl');
    const log = new DashboardLog('probe', {
      DASHBOARD_JSONL_FILE: file,
      DASHBOARD_GROUP: 'android',
    });
    expect(log.start()).toBe(true);
    log.append({ event: 'test', title: 'one' });
    log.append({ event: 'end' });
    expect(lines(file)).toEqual([
      { group: 'android', event: 'test', title: 'one' },
      { group: 'android', event: 'end' },
    ]);
    // `group` first, so a half-written final line still says whose it was.
    expect(Object.keys(lines(file)[0])[0]).toBe('group');
  });

  it('names the group unknown rather than leaving it out', () => {
    const file = join(tmp(), 'events.jsonl');
    const log = new DashboardLog('probe', { DASHBOARD_JSONL_FILE: file });
    log.start();
    log.append({ event: 'end' });
    expect(lines(file)[0].group).toBe('unknown-group');
  });

  it('truncates, so an old run cannot bleed into this one', () => {
    const file = join(tmp(), 'events.jsonl');
    writeFileSync(file, '{"group":"yesterday","event":"end"}\n');
    const log = new DashboardLog('probe', { DASHBOARD_JSONL_FILE: file });
    expect(log.start()).toBe(true);
    expect(readFileSync(file, 'utf8')).toBe('');
  });

  it('says so once when it cannot write, and never again', () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const log = new DashboardLog('probe', {
      DASHBOARD_JSONL_FILE: join(tmp(), 'no-such-directory', 'events.jsonl'),
      DASHBOARD_GROUP: 'ios',
    });
    expect(log.start()).toBe(false);
    log.append({ event: 'test' });
    log.append({ event: 'end' });
    // One notice, not one per test: a reporter that spams a failure on every
    // event buries the run's real output.
    expect(error).toHaveBeenCalledTimes(1);
    const [notice] = error.mock.calls[0] as [string];
    // The notice has to name the reporter, the group and the cause -- a
    // message that says only "failed to write" sends the reader looking in
    // the wrong group's log (#error-messages-name-the-symptom-not-the-cause).
    expect(notice).toContain('[probe]');
    expect(notice).toContain('ios');
    expect(notice).toContain('ENOENT');
    // A failed truncate and a failed append lose different things: the
    // dashboard never sees this group at all, against stopping where it
    // stopped. A reader chasing a missing group needs to be told which.
    expect(notice).toContain('will not see the');
  });

  it('says something different when it is an append that failed', () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const file = join(tmp(), 'events.jsonl');
    const log = new DashboardLog('probe', { DASHBOARD_JSONL_FILE: file });
    expect(log.start()).toBe(true);
    // The directory goes away under a log that started cleanly -- the shape
    // of a filesystem that fills or a tmpdir that is swept mid-run.
    rmSync(dirname(file), { recursive: true, force: true });
    log.append({ event: 'test' });
    expect(error).toHaveBeenCalledTimes(1);
    expect(error.mock.calls[0][0]).toContain('will stop updating for');
  });

  it('stops being live once a write has failed, and says so', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const file = join(tmp(), 'events.jsonl');
    const log = new DashboardLog('probe', { DASHBOARD_JSONL_FILE: file });
    expect(log.live).toBe(true);
    rmSync(dirname(file), { recursive: true, force: true });
    log.append({ event: 'test' });
    // `enabled` still answers the question it asks -- a file WAS named --
    // which is why a reporter skipping work needs the second question.
    expect(log.enabled).toBe(true);
    expect(log.live).toBe(false);
  });

  it('reports a write failure without failing the run', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const log = new DashboardLog('probe', {
      DASHBOARD_JSONL_FILE: join(tmp(), 'no-such-directory', 'events.jsonl'),
    });
    // The whole contract: the dashboard is an observer. Nothing it does may
    // reach the test run.
    expect(() => {
      log.start();
      log.append({ event: 'test' });
    }).not.toThrow();
  });
});

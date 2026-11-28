import { describe, expect, it, vi } from 'vitest';

/**
 * A failed device command names why in its own words (#1027): a phone run
 * failed on "adb shell uiautomator dump /sdcard/ui.xml failed: Command failed"
 * and nothing more, because what uiautomator printed was dropped.
 */
const failure = (fields: Record<string, unknown>) =>
  Object.assign(
    new Error('Command failed: adb shell uiautomator dump'),
    fields,
  );

const runFailing = async (error: Error) => {
  vi.resetModules();
  vi.doMock('node:child_process', () => ({
    execFileSync: () => {
      throw error;
    },
  }));
  const { runWithDeadline } =
    await import('../../scripts/run-with-deadline.mjs');
  return () =>
    runWithDeadline('adb', ['shell', 'uiautomator', 'dump'], {
      timeoutMs: 1000,
      whenSilent: 'is the phone awake?',
    });
};

describe('runWithDeadline names why a command failed', () => {
  it('quotes the exit status and what the command printed on each stream', async () => {
    const run = await runFailing(
      failure({
        status: 137,
        stdout: 'partial line\n',
        stderr: 'ERROR: could not get idle state.\n',
      }),
    );
    expect(run).toThrow(
      'adb shell uiautomator dump failed with exit status 137: ' +
        'stderr "ERROR: could not get idle state." ' +
        'stdout "partial line"',
    );
  });

  it('says so when the command printed nothing', async () => {
    const run = await runFailing(
      failure({ status: 1, stdout: '', stderr: '' }),
    );
    expect(run).toThrow(
      'adb shell uiautomator dump failed with exit status 1: it printed nothing',
    );
  });

  it('still names the deadline when the command gave no answer', async () => {
    const run = await runFailing(failure({ code: 'ETIMEDOUT' }));
    expect(run).toThrow(
      'adb shell uiautomator dump gave no answer within 1000 ms: is the phone awake?',
    );
  });
});

describe('runWithDeadline runs a tool by its absolute path (#1294)', () => {
  it('hands the absolute path to execFileSync and names the tool by its own name', async () => {
    vi.resetModules();
    const calls: string[] = [];
    vi.doMock('node:child_process', () => ({
      execFileSync: (file: string) => {
        calls.push(file);
        throw failure({ code: 'ETIMEDOUT' });
      },
    }));
    const { runWithDeadline } =
      await import('../../scripts/run-with-deadline.mjs');
    expect(() =>
      runWithDeadline('/opt/homebrew/bin/adb', ['devices'], {
        timeoutMs: 1000,
        whenSilent: 'is the phone awake?',
      }),
    ).toThrow(
      /^adb devices gave no answer within 1000 ms: is the phone awake\?$/,
    );
    expect(calls).toEqual(['/opt/homebrew/bin/adb']);
  });
});

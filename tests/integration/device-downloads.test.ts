import { spawnSync } from 'node:child_process';
import { describe, it, expect } from 'vitest';
import { forDeviceShell } from '../device/device-downloads';

/**
 * `adb exec-out` joins its arguments with spaces and hands the line to the phone's `sh`, so this
 * quoting is all that stands between a download's suggested name and that shell. Each name is
 * run through a real POSIX `sh` here, which quotes as the phone's does, and must come back as the
 * one argument it went in as.
 */
describe('a filename quoted for the phone shell', () => {
  const echoedBySh = (value: string): string => {
    const run = spawnSync(
      'sh',
      ['-c', `printf '%s|' ${forDeviceShell(value)}`],
      {
        encoding: 'utf8',
      },
    );
    expect(run.status, run.stderr).toBe(0);
    return run.stdout;
  };

  it.each([
    'groups.csv',
    'class 4B groups.csv',
    "Ana's class.csv",
    "''",
    '$(echo injected).csv',
    '`id`.csv',
    'a;b&&c|d.csv',
    'line\nbreak.csv',
    '',
  ])('reaches the shell as one argument, unchanged: %j', (value) => {
    expect(echoedBySh(value)).toBe(`${value}|`);
  });
});

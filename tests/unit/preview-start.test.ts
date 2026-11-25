import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { describe, expect, it } from 'vitest';
import {
  recentLines,
  stopProcessGroup,
  untilReadyOrExit,
} from '../../scripts/test-devices.mjs';

/**
 * #1160: `astro preview` found another preview already running, printed its
 * PID and URL, and exited. The device run still waited 30 s for its port and
 * then aborted naming only the timeout, and its cleanup reported
 * `kill ESRCH` for the child that had already gone. The child here is a
 * stand-in: an emitter with two in-process streams, so no process starts.
 */
function standInChild() {
  const child = Object.assign(new EventEmitter(), {
    stdout: new PassThrough(),
    stderr: new PassThrough(),
    pid: 9999,
    exitCode: null as number | null,
    signalCode: null as string | null,
  });
  return child;
}

const ALREADY_RUNNING =
  'Another astro preview server is already running. URL: http://localhost:4329 PID: 9570';

describe('untilReadyOrExit', () => {
  it('fails at once with the exit and the last lines when the child exits first', async () => {
    const child = standInChild();
    const lines = recentLines(child);
    const neverReady = new Promise(() => {});
    const waiting = untilReadyOrExit(child, neverReady, lines, 'the preview');
    child.stdout.write('> shyden-co-uk@0.0.0 preview\n');
    child.stderr.write(`${ALREADY_RUNNING}\n`);
    await new Promise((resolve) => setImmediate(resolve));
    child.emit('exit', 1, null);
    await expect(waiting).rejects.toThrow(
      `the preview exited (code 1) before it answered. Its last lines:\n> shyden-co-uk@0.0.0 preview\n${ALREADY_RUNNING}`,
    );
  });

  it('names a signal when the child was killed', async () => {
    const child = standInChild();
    const waiting = untilReadyOrExit(
      child,
      new Promise(() => {}),
      recentLines(child),
      'the preview',
    );
    child.emit('exit', null, 'SIGKILL');
    await expect(waiting).rejects.toThrow(
      'the preview exited (signal SIGKILL) before it answered. It printed nothing.',
    );
  });

  it('answers with what the ready wait answers when the server comes up', async () => {
    const child = standInChild();
    const ready = Promise.resolve('answered');
    await expect(
      untilReadyOrExit(child, ready, recentLines(child), 'the preview'),
    ).resolves.toBe('answered');
    expect(child.listenerCount('exit')).toBe(0);
  });

  it('passes the ready wait’s own failure on unchanged', async () => {
    const child = standInChild();
    const ready = Promise.reject(new Error('Timed out after 30000ms'));
    await expect(
      untilReadyOrExit(child, ready, recentLines(child), 'the preview'),
    ).rejects.toThrow('Timed out after 30000ms');
  });
});

describe('recentLines', () => {
  it('keeps only the last twenty lines, from both streams', async () => {
    const child = standInChild();
    const lines = recentLines(child);
    for (let n = 1; n <= 25; n += 1) child.stdout.write(`line ${n}\n`);
    child.stderr.write('partial without newline');
    await new Promise((resolve) => setImmediate(resolve));
    expect(lines).toHaveLength(20);
    expect(lines[0]).toBe('line 6');
    expect(lines.at(-1)).toBe('line 25');
  });
});

describe('stopProcessGroup', () => {
  it('signals the whole group of a live child', () => {
    const child = standInChild();
    const calls: unknown[][] = [];
    expect(
      stopProcessGroup(child, (...args: unknown[]) => calls.push(args)),
    ).toBe('stopped');
    expect(calls).toEqual([[-9999, 'SIGTERM']]);
  });

  it('says nothing went wrong when the group is already gone (ESRCH)', () => {
    const child = standInChild();
    child.exitCode = 1;
    const gone = Object.assign(new Error('kill ESRCH'), { code: 'ESRCH' });
    expect(
      stopProcessGroup(child, () => {
        throw gone;
      }),
    ).toBe('already gone');
  });

  it('passes any other failure on', () => {
    const child = standInChild();
    const denied = Object.assign(new Error('kill EPERM'), { code: 'EPERM' });
    expect(() =>
      stopProcessGroup(child, () => {
        throw denied;
      }),
    ).toThrow('kill EPERM');
  });
});

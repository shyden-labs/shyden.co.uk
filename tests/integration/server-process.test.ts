import { describe, it, expect, afterEach, vi } from 'vitest';
import type { ChildProcess } from 'node:child_process';
import { createServer, type Server, type Socket } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startServerProcess } from '../device/ios/server-process';
import { WebDriver } from '../device/ios/webdriver';

/**
 * `startServerProcess` starts `safaridriver` and waits for it to answer
 * (#309).
 *
 * Each case runs a real Node process in the server's place, so the suite
 * needs no phone and no Mac-only binary: one that dies at startup the way
 * `safaridriver` does when its port is taken (measured: exit code 1 after
 * 215 ms, printing "Unable to start the server: Address already in use"),
 * one killed by a signal, one that cannot be started at all, one that takes
 * a moment before it listens, and one that never answers at all.
 */

const node = process.execPath;

const DIES_LIKE_A_TAKEN_PORT =
  "require('node:fs').writeSync(2, 'Unable to start the server: Address already in use'); process.exit(1);";
const KILLED_AT_STARTUP = "process.kill(process.pid, 'SIGKILL');";
const LISTENS_AFTER_A_MOMENT = [
  'const port = Number(process.argv[1]);',
  'setTimeout(() => {',
  "  require('node:http')",
  "    .createServer((_, response) => response.end(JSON.stringify({ value: { message: '', ready: true } })))",
  "    .listen(port, '127.0.0.1');",
  '}, 300);',
].join('\n');
const RUNS_WITHOUT_ANSWERING = 'setInterval(() => undefined, 1_000);';

// Every child `startServerProcess` spawns, kept as `spawn` returned it. Its
// pid is set the moment the process exists, before Node inside it has run a
// line, so a case that must find the child after the wait gave up does not
// depend on how long the child takes to start (#655: a pid file the child
// wrote itself was missing on a loaded machine, where Node took longer than
// the 500 ms wait). `spawn` itself is the real one.
const spawned = vi.hoisted((): ChildProcess[] => []);
vi.mock('node:child_process', async (importOriginal) => {
  const real = await importOriginal<typeof import('node:child_process')>();
  const keep = (...args: Parameters<typeof real.spawn>): ChildProcess => {
    const child = real.spawn(...args);
    spawned.push(child);
    return child;
  };
  return { ...real, spawn: keep as typeof real.spawn };
});

// Awaits each child's `close`, so whatever a server's end sets off happens
// inside the test that started it, not after the file has finished.
const running: ChildProcess[] = [];
afterEach(async () => {
  await Promise.all(
    running.splice(0).map(
      (child) =>
        new Promise<void>((resolve) => {
          if (child.exitCode !== null || child.signalCode !== null) {
            resolve();
            return;
          }
          child.once('close', () => resolve());
          child.kill();
        }),
    ),
  );
});

/** Whether a process with this pid exists; `kill(pid, 0)` sends nothing. */
function isRunning(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ESRCH') return false;
    throw error;
  }
}

async function listenOnAnyPort(server: Server): Promise<number> {
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (address === null || typeof address === 'string') {
    throw new Error(`expected a TCP address, got ${String(address)}`);
  }
  return address.port;
}

/** A port nothing listens on: bound, then let go. */
async function freePort(): Promise<number> {
  const server = createServer();
  const port = await listenOnAnyPort(server);
  await new Promise<void>((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  );
  return port;
}

/**
 * A port held by something that accepts a connection and never answers:
 * what a readiness `fetch` meets when another process owns the port the
 * server failed to bind.
 */
async function silentListener(): Promise<{ port: number; close: () => void }> {
  const sockets = new Set<Socket>();
  const server = createServer((socket) => sockets.add(socket));
  const port = await listenOnAnyPort(server);
  return {
    port,
    close: () => {
      for (const socket of sockets) socket.destroy();
      server.close();
    },
  };
}

/** The readiness check `startSafaridriver` makes, against a server on `port`. */
function answersStatus(port: number): () => Promise<boolean> {
  return () => WebDriver.isReady(`http://127.0.0.1:${port}`);
}

/** Starts `node -e <script>` against a free port and settles, timing it. */
async function attemptStart(
  command: string,
  args: readonly string[],
): Promise<{ outcome: unknown; elapsed: number; port: number }> {
  const port = await freePort();
  const began = performance.now();
  const outcome = await startServerProcess(command, args, {
    isReady: answersStatus(port),
    timeout: 15_000,
    describe: `the server on port ${port} to answer GET /status with ready:true`,
  }).catch((error: unknown) => error);
  return { outcome, elapsed: Math.round(performance.now() - began), port };
}

function messageOf(outcome: unknown): string {
  expect(outcome).toBeInstanceOf(Error);
  return (outcome as Error).message;
}

describe('startServerProcess', () => {
  it('reports a server that dies at startup at once, with its exit code and what it printed', async () => {
    const { outcome, elapsed, port } = await attemptStart(node, [
      '-e',
      DIES_LIKE_A_TAKEN_PORT,
    ]);

    expect(elapsed, `the exit was reported after ${elapsed} ms`).toBeLessThan(
      2_000,
    );
    const message = messageOf(outcome);
    expect(
      {
        exitCode: message.includes('code=1,'),
        signal: message.includes('signal=null'),
        printed: message.includes(
          'Unable to start the server: Address already in use',
        ),
        awaited: message.includes(`port ${port} to answer GET /status`),
      },
      message,
    ).toEqual({ exitCode: true, signal: true, printed: true, awaited: true });
  });

  it('keeps the END of what a talkative server printed, where its diagnosis is', async () => {
    // Start-up chatter first, the diagnosis last: the order a server that
    // logs as it goes prints in. Both on stderr, because two pipes can be
    // read in either order and the test is about which end is kept.
    const { outcome } = await attemptStart(node, [
      '-e',
      "require('node:fs').writeSync(2, 'FIRST-LINE ' + 'chatter '.repeat(250)); " +
        DIES_LIKE_A_TAKEN_PORT,
    ]);

    const message = messageOf(outcome);
    const printed = message.slice(message.indexOf('It printed: '));
    expect(
      {
        diagnosis: printed.includes(
          'Unable to start the server: Address already in use',
        ),
        headDropped: !printed.includes('FIRST-LINE'),
        bounded: printed.length <= 'It printed: '.length + 500,
      },
      message,
    ).toEqual({ diagnosis: true, headDropped: true, bounded: true });
  });

  it('reports a server that dies while its readiness check is still waiting for an answer', async () => {
    const holder = await silentListener();
    const began = performance.now();

    const outcome = await startServerProcess(
      node,
      ['-e', DIES_LIKE_A_TAKEN_PORT],
      {
        isReady: answersStatus(holder.port),
        timeout: 15_000,
        describe: `the server on port ${holder.port} to answer GET /status with ready:true`,
      },
    )
      .catch((error: unknown) => error)
      .finally(holder.close);

    const elapsed = Math.round(performance.now() - began);
    expect(elapsed, `the exit was reported after ${elapsed} ms`).toBeLessThan(
      2_000,
    );
    expect(messageOf(outcome)).toContain(
      'It printed: Unable to start the server: Address already in use',
    );
  });

  it('names the signal that killed a server at startup', async () => {
    const { outcome, elapsed } = await attemptStart(node, [
      '-e',
      KILLED_AT_STARTUP,
    ]);

    expect(elapsed, `the kill was reported after ${elapsed} ms`).toBeLessThan(
      2_000,
    );
    expect(messageOf(outcome)).toContain('code=null, signal=SIGKILL');
  });

  it('reports a command that cannot be started at all, instead of crashing the run', async () => {
    const missing = join(tmpdir(), 'no-such-server-309');
    const { outcome, elapsed } = await attemptStart(missing, []);

    expect(
      elapsed,
      `the failure was reported after ${elapsed} ms`,
    ).toBeLessThan(2_000);
    const message = messageOf(outcome);
    expect(
      { command: message.includes(missing), cause: message.includes('ENOENT') },
      message,
    ).toEqual({ command: true, cause: true });
  });

  it('stops a server that never answers once the wait gives up on it', async () => {
    spawned.splice(0);
    const outcome = await startServerProcess(
      node,
      ['-e', RUNS_WITHOUT_ANSWERING],
      {
        isReady: async () => false,
        timeout: 500,
        describe: 'a server that never answers',
      },
    ).catch((error: unknown) => error);

    expect(messageOf(outcome)).toContain(
      'Timed out after 500ms waiting for: a server that never answers.',
    );
    // Whatever the outcome, a child left running is stopped after the test.
    running.push(...spawned);
    expect(spawned, 'the one server this case started').toHaveLength(1);
    const pid = spawned[0]?.pid ?? 0;
    expect(pid, 'the server was spawned with a pid').toBeGreaterThan(0);
    await expect.poll(() => isRunning(pid), { timeout: 5_000 }).toBe(false);
  });

  it('polls through refused connections until a server that is slow to start answers', async () => {
    const port = await freePort();
    let refusals = 0;
    const ready = answersStatus(port);

    const child = await startServerProcess(
      node,
      ['-e', LISTENS_AFTER_A_MOMENT, String(port)],
      {
        isReady: async () => {
          try {
            return await ready();
          } catch (error) {
            refusals += 1;
            throw error;
          }
        },
        timeout: 15_000,
        describe: `the server on port ${port} to answer GET /status with ready:true`,
      },
    );
    running.push(child);

    expect({
      stillRunning: child.exitCode === null && child.signalCode === null,
      refusedBeforeAnswering: refusals > 0,
    }).toEqual({ stillRunning: true, refusedBeforeAnswering: true });
  });
});

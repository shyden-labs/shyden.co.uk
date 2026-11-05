import { createRequire } from 'node:module';
import { createServer } from 'node:http';
import { connect, createConnection, Socket, type AddressInfo } from 'node:net';
import { connect as tlsConnect } from 'node:tls';
import * as cpNamespace from 'node:child_process';
import cpDefault from 'child_process';
import {
  exec,
  execFile,
  execFileSync,
  execSync,
  fork,
  spawn,
  spawnSync,
} from 'node:child_process';
import { describe, expect, it } from 'vitest';

/**
 * The unit setup refuses any process and any connection off this machine
 * (#632; operator 2026-10-08, "No processes in unit").
 *
 * A unit test's dependencies are stood in; a process or a socket to a real
 * host is a test that belongs in the integration suite. `tests/unit-refusal-
 * setup.ts` makes the call throw, naming the test and the entry point, so the
 * test that reaches out fails by name instead of passing on a service.
 *
 * Each entry point is tried through every way a test file can reach it: a
 * named import (`node:` specifier), a namespace import, a default import (the
 * bare specifier), a dynamic import (bare specifier) and `createRequire`. The
 * calls are harmless if they were NOT refused (`--version`, `true`), and the
 * assertion is on the refusal's own message, which names this test, so a
 * failure inside the process cannot pass for the refusal.
 */

type Entry =
  | 'spawn'
  | 'spawnSync'
  | 'exec'
  | 'execSync'
  | 'execFile'
  | 'execFileSync'
  | 'fork';
const ENTRIES: readonly Entry[] = [
  'spawn',
  'spawnSync',
  'exec',
  'execSync',
  'execFile',
  'execFileSync',
  'fork',
];

type Callable = (...args: unknown[]) => unknown;

const named: Record<Entry, Callable> = {
  spawn,
  spawnSync,
  exec,
  execSync,
  execFile,
  execFileSync,
  fork,
} as unknown as Record<Entry, Callable>;

const through = (module: unknown, entry: Entry): Callable =>
  (module as Record<Entry, Callable>)[entry];

/** Arguments that start nothing harmful if the call is let through. */
const ARGS: Record<Entry, unknown[]> = {
  spawn: ['true'],
  spawnSync: ['true'],
  exec: ['true'],
  execSync: ['true'],
  execFile: ['true'],
  execFileSync: ['true'],
  fork: ['/nonexistent-module-for-the-refusal-test.js'],
};

const currentTest = (): string => expect.getState().currentTestName ?? '';

/** The refusal names the test that called and the entry point it called. */
const refusal = (entry: string): RegExp =>
  new RegExp(
    `unit test refused: "${currentTest().replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}" called ${entry.replace('.', '\\.')}`,
  );

const calledAs = (call: Callable, entry: Entry) => {
  let thrown: unknown;
  try {
    call(...ARGS[entry]);
  } catch (error) {
    thrown = error;
  }
  expect(thrown).toBeInstanceOf(Error);
  expect((thrown as Error).message).toMatch(refusal(`child_process.${entry}`));
};

describe('a unit test starts no process', () => {
  for (const entry of ENTRIES) {
    it(`refuses ${entry} through a named import`, () => {
      calledAs(named[entry], entry);
    });

    it(`refuses ${entry} through a namespace import`, () => {
      calledAs(through(cpNamespace, entry), entry);
    });

    it(`refuses ${entry} through a default import of the bare specifier`, () => {
      calledAs(through(cpDefault, entry), entry);
    });

    it(`refuses ${entry} through a dynamic import`, async () => {
      const module = await import('child_process');
      calledAs(through(module, entry), entry);
    });

    it(`refuses ${entry} through createRequire`, () => {
      const required = createRequire(import.meta.url)('node:child_process');
      calledAs(through(required, entry), entry);
    });
  }
});

describe('a unit test connects to nothing off this machine', () => {
  const refused = (
    attempt: () => unknown,
    entry: string,
    host: string,
  ): void => {
    let thrown: unknown;
    try {
      attempt();
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(Error);
    expect((thrown as Error).message).toMatch(refusal(entry));
    expect((thrown as Error).message).toContain(host);
  };

  it('refuses net.connect to a host that is not loopback', () => {
    refused(
      () => connect({ host: 'example.invalid', port: 443 }),
      'net.connect',
      'example.invalid:443',
    );
  });

  it('refuses net.createConnection to a host that is not loopback', () => {
    refused(
      () => createConnection(443, 'example.invalid'),
      'net.createConnection',
      'example.invalid:443',
    );
  });

  it('refuses tls.connect to a host that is not loopback', () => {
    refused(
      () => tlsConnect({ host: 'example.invalid', port: 443 }),
      'tls.connect',
      'example.invalid:443',
    );
  });

  it('refuses a socket opened by the prototype to a host that is not loopback', () => {
    refused(
      () => new Socket().connect(443, 'example.invalid'),
      'net.Socket.connect',
      'example.invalid:443',
    );
  });

  it('refuses fetch to a host that is not loopback, before any lookup', async () => {
    const failure = await fetch('https://example.invalid/').then(
      () => undefined,
      (error: unknown) => error,
    );
    expect(failure).toBeInstanceOf(Error);
    expect((failure as Error).message).toMatch(refusal('fetch'));
    expect((failure as Error).message).toContain('example.invalid');
  });

  it('allows a connection to a server this test started on loopback', async () => {
    const server = createServer((_request, response) => {
      response.end('stood in');
    });
    await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
    try {
      const { port } = server.address() as AddressInfo;
      const body = await fetch(`http://127.0.0.1:${port}/`).then((response) =>
        response.text(),
      );
      expect(body).toBe('stood in');
    } finally {
      await new Promise<void>((done) => server.close(() => done()));
    }
  });
});

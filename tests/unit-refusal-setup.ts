import childProcess from 'node:child_process';
import { syncBuiltinESMExports } from 'node:module';
import net from 'node:net';
import tls from 'node:tls';
import { expect } from 'vitest';

/**
 * In every unit worker, before any test: a process and a connection off this
 * machine are refused (#632; operator 2026-10-08, "No processes in unit", and
 * the global rule that a unit test never reaches a real service).
 *
 * The refusal throws from the call itself, naming the test that made it and the
 * entry point, so a test that reaches out fails by name. It patches the real
 * module objects and re-syncs the ESM exports, which reaches a named import, a
 * namespace import, a default import, a dynamic import and `createRequire`
 * alike (`tests/unit/unit-refusal.test.ts` plants each).
 *
 * Loopback stays allowed: a test may stand in a server of its own on 127.0.0.1
 * (`serversClosedAfterEach`), and 22 do. A connection to a server outside the
 * test process cannot be told from one inside it here; the reach measurement in
 * #632 found every one of the 22 to be a server the test started itself. A
 * unix-domain socket is local IPC and has no host to refuse.
 */

const PATCHED = Symbol.for('shyden.unit-refusal.patched');

const ENTRY_POINTS = [
  'spawn',
  'spawnSync',
  'exec',
  'execSync',
  'execFile',
  'execFileSync',
  'fork',
] as const;

const LOOPBACK = new Set(['127.0.0.1', '::1', 'localhost']);

const who = (): string => {
  try {
    return expect.getState().currentTestName ?? '(outside a test)';
  } catch {
    return '(outside a test)';
  }
};

const refuse = (call: string, reason: string): never => {
  throw new Error(
    `unit test refused: "${who()}" called ${call}. ${reason} ` +
      'Stand the dependency in, or move the test to tests/integration (#632).',
  );
};

/** The host and port a connect-style call was given, in any of its overloads. */
export function targetOf(args: readonly unknown[]): {
  host: string;
  port: string;
  local: boolean;
} {
  const flat = Array.isArray(args[0]) ? (args[0] as unknown[]) : [...args];
  const [first, second] = flat;
  if (typeof first === 'object' && first !== null) {
    const options = first as { host?: string; port?: number; path?: string };
    if (options.path !== undefined)
      return { host: options.path, port: '', local: true };
    return {
      host: options.host ?? 'localhost',
      port: String(options.port ?? ''),
      local: false,
    };
  }
  if (typeof first === 'string' && Number.isNaN(Number(first)))
    return { host: first, port: '', local: true };
  return {
    host: typeof second === 'string' ? second : 'localhost',
    port: String(first ?? ''),
    local: false,
  };
}

const checkHost = (call: string, args: readonly unknown[]): void => {
  const { host, port, local } = targetOf(args);
  if (local || LOOPBACK.has(host)) return;
  refuse(
    call,
    `It connected to ${host}${port === '' ? '' : `:${port}`}, which is off this machine.`,
  );
};

if (!(PATCHED in net)) {
  Object.defineProperty(net, PATCHED, { value: true });

  const target = childProcess as unknown as Record<string, unknown>;
  for (const entry of ENTRY_POINTS)
    target[entry] = () =>
      refuse(
        `child_process.${entry}`,
        'A unit test starts no process of any kind.',
      );

  const wrapped = (
    owner: Record<string, unknown>,
    name: string,
    label: string,
  ): void => {
    const original = owner[name] as (...args: unknown[]) => unknown;
    owner[name] = function (this: unknown, ...args: unknown[]) {
      checkHost(label, args);
      return original.apply(this, args);
    };
  };
  wrapped(net as unknown as Record<string, unknown>, 'connect', 'net.connect');
  wrapped(
    net as unknown as Record<string, unknown>,
    'createConnection',
    'net.createConnection',
  );
  wrapped(tls as unknown as Record<string, unknown>, 'connect', 'tls.connect');
  wrapped(
    net.Socket.prototype as unknown as Record<string, unknown>,
    'connect',
    'net.Socket.connect',
  );

  const realFetch = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    const host = url.hostname.replace(/^\[|\]$/g, '');
    if (!LOOPBACK.has(host) && url.protocol !== 'data:')
      refuse('fetch', `It fetched ${url.host}, which is off this machine.`);
    return realFetch(input, init);
  }) as typeof fetch;

  syncBuiltinESMExports();
}

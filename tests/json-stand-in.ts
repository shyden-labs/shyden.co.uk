import { expect } from 'vitest';
import { spawn } from 'node:child_process';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';

/**
 * A local HTTP server answering in a JSON API's shape, for the integration
 * tests of the daily jobs that read production (#349, #796). It records what
 * it received, so "no request reached GitHub" is read off GitHub's own
 * record, after a sentinel proves that record is live (#118).
 *
 * One home since #796: the Access token expiry check's test needed the stand-in
 * the waiting-reports count's test had. Each caller keeps its own `searched`
 * and its own floor, with its literal id, on what `everything()` returns.
 */

export type Received = {
  method: string;
  url: string;
  body: string;
  auth: string;
};

type Reply = { status: number; body: unknown } | null;

const SENTINEL = '/sentinel';

export const standIn = () => {
  const received: Received[] = [];
  let respond: (request: Received) => Reply = () => ({ status: 404, body: {} });
  let server: Server;
  let url = '';
  /** Sends the sentinel and checks it is the last thing recorded. */
  const closeRecord = async () => {
    await fetch(`${url}${SENTINEL}`);
    const all = [...received];
    expect(all.at(-1)?.url, 'the stand-in is recording').toBe(SENTINEL);
    return all;
  };
  return {
    received,
    get url() {
      return url;
    },
    answer(next: (request: Received) => Reply) {
      respond = next;
    },
    async start() {
      server = createServer((request, response) => {
        let body = '';
        request.on('data', (chunk) => (body += chunk));
        request.on('end', () => {
          const got = {
            method: request.method ?? '',
            url: request.url ?? '',
            body,
            auth: request.headers.authorization ?? '',
          };
          received.push(got);
          if (got.url === SENTINEL) {
            response.writeHead(200).end('{}');
            return;
          }
          const reply = respond(got);
          if (reply === null) return; // never answer: the script must time out
          response.writeHead(reply.status, {
            'content-type': 'application/json',
          });
          // A string body goes out as it is, so a test can send what is not JSON.
          response.end(
            typeof reply.body === 'string'
              ? reply.body
              : JSON.stringify(reply.body),
          );
        });
      });
      await new Promise<void>((resolve) =>
        server.listen(0, '127.0.0.1', resolve),
      );
      url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    },
    stop: () =>
      new Promise<void>((resolve) => {
        server.closeAllConnections();
        server.close(() => resolve());
      }),
    /** What reached this stand-in, closed by a sentinel it must also hold. */
    record: async () => (await closeRecord()).slice(0, -1),
    /**
     * Every request recorded, the closing sentinel last. A caller asserting
     * that nothing arrived searches the requests before the sentinel with
     * this whole list as the population, so an empty record is a live one.
     */
    everything: closeRecord,
  };
};

export type StandIn = ReturnType<typeof standIn>;

/**
 * Run a script as a real process with exactly `env` (and `PATH`), its stdout
 * and stderr in one string. Async `spawn`, never `spawnSync`: the stand-ins
 * answer from this process's event loop, which `spawnSync` would block.
 */
export const runScript = (
  script: string,
  args: string[],
  env: Record<string, string>,
): Promise<{ code: number | null; out: string }> =>
  new Promise((resolve) => {
    const child = spawn(process.execPath, [script, ...args], {
      env: { PATH: process.env.PATH, ...env },
    });
    let out = '';
    child.stdout.on('data', (chunk) => (out += chunk));
    child.stderr.on('data', (chunk) => (out += chunk));
    child.on('close', (code) => resolve({ code, out }));
  });

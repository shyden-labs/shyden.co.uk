import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';

/**
 * A local stand-in for an HTTP API (GitHub's, Cloudflare's), for integration
 * tests that run a script as a real process. It records every request, so
 * what a script asked and sent is read off the stand-in's own record, and it
 * answers from `routes`, keyed `METHOD url`. A route set to `null` never
 * answers, so a script's time limit can be proved. Spawn scripts with async
 * `spawn`, never `spawnSync`: the stand-in answers from this process's event
 * loop, which `spawnSync` would block.
 */
export type Received = {
  method: string;
  url: string;
  body: string;
  auth: string;
};
export type Reply = { status: number; body: unknown; location?: string } | null;

export interface StandIn {
  /** Every request, in arrival order; empty it in `beforeEach`. */
  readonly received: Received[];
  /** The answers, read at each request, so a test may replace one. */
  routes: Record<string, Reply>;
  /** `http://127.0.0.1:<port>`, set by `start()`. */
  url: string;
  start(): Promise<void>;
  stop(): Promise<void>;
}

export const standInApi = (): StandIn => {
  let server: Server | undefined;
  const stand: StandIn = {
    received: [],
    routes: {},
    url: '',
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
          stand.received.push(got);
          const key = `${got.method} ${got.url}`;
          const reply =
            key in stand.routes
              ? stand.routes[key]
              : { status: 404, body: { message: 'Not Found' } };
          if (reply === null) return; // never answer: the script must time out
          response.writeHead(reply.status, {
            'content-type': 'application/json',
            ...(reply.location === undefined
              ? {}
              : { location: reply.location }),
          });
          response.end(
            typeof reply.body === 'string'
              ? reply.body
              : JSON.stringify(reply.body),
          );
        });
      });
      const listening = server;
      await new Promise<void>((resolve) =>
        listening.listen(0, '127.0.0.1', resolve),
      );
      stand.url = `http://127.0.0.1:${(listening.address() as AddressInfo).port}`;
    },
    stop: () =>
      new Promise<void>((resolve) => {
        if (server === undefined) return resolve();
        server.closeAllConnections();
        server.close(() => resolve());
      }),
  };
  return stand;
};

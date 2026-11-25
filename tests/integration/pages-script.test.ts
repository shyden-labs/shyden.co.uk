import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { spawn } from 'node:child_process';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { join } from 'node:path';

/**
 * `scripts/pages.mjs` as the deploy and fall-back jobs run it (#748), against
 * a stand-in Cloudflare API: what it asks, what it prints, how it exits.
 */

const SCRIPT = join(process.cwd(), 'scripts/pages.mjs');
const ACCOUNT = '0123456789abcdef0123456789abcdef';
const PROJECT = `/accounts/${ACCOUNT}/pages/projects/shyden-site`;
const ROLLBACK = `${PROJECT}/deployments/d-prev/rollback`;

type Reply = { status: number; body: unknown };
const received: { method: string; url: string; auth: string }[] = [];
let routes: Record<string, Reply[]>;
let server: Server;
let api = '';

const serving = (id: string): Reply => ({
  status: 200,
  body: {
    success: true,
    result: { name: 'shyden-site', canonical_deployment: { id } },
  },
});

beforeAll(async () => {
  server = createServer((request, response) => {
    const key = `${request.method} ${request.url}`;
    received.push({
      method: request.method ?? '',
      url: request.url ?? '',
      auth: request.headers.authorization ?? '',
    });
    const reply = routes[key]?.shift() ?? {
      status: 404,
      body: {
        success: false,
        errors: [{ code: 8000007, message: 'not found' }],
      },
    };
    response.writeHead(reply.status, { 'content-type': 'application/json' });
    response.end(JSON.stringify(reply.body));
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  api = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(
  () =>
    new Promise<void>((resolve) => {
      server.closeAllConnections();
      server.close(() => resolve());
    }),
);
beforeEach(() => {
  received.length = 0;
  routes = {};
});

const run = (
  args: string[],
  overrides: Record<string, string> = {},
): Promise<{ code: number | null; out: string }> =>
  new Promise((resolve) => {
    const child = spawn(process.execPath, [SCRIPT, ...args], {
      env: {
        PATH: process.env.PATH,
        CLOUDFLARE_API_BASE: api,
        CLOUDFLARE_ACCOUNT_ID: ACCOUNT,
        CLOUDFLARE_API_TOKEN: 'cf-token',
        ...overrides,
      },
    });
    let out = '';
    child.stdout.on('data', (chunk) => (out += chunk));
    child.stderr.on('data', (chunk) => (out += chunk));
    child.on('close', (code) => resolve({ code, out }));
  });

const asked = () => received.map(({ method, url }) => `${method} ${url}`);

describe('live: the deployment a project serves', () => {
  it('prints the live id alone, from one read with the token', async () => {
    routes[`GET ${PROJECT}`] = [serving('d-live')];
    const { code, out } = await run(['live', 'shyden-site']);
    expect(code, out).toBe(0);
    expect(out).toBe('d-live\n');
    expect(asked()).toEqual([`GET ${PROJECT}`]);
    expect(received[0].auth).toBe('Bearer cf-token');
  });

  it('a refused read exits 1 naming the status, and prints no id', async () => {
    routes[`GET ${PROJECT}`] = [
      {
        status: 403,
        body: {
          success: false,
          errors: [{ code: 10000, message: 'Authentication error' }],
        },
      },
    ];
    const { code, out } = await run(['live', 'shyden-site']);
    expect(code).toBe(1);
    expect(out).toContain('Cloudflare answered HTTP 403');
  });
});

describe('restore: fall back to an earlier deployment', () => {
  it('asks for the rollback once, confirms with one read, and says so', async () => {
    routes[`POST ${ROLLBACK}`] = [
      { status: 200, body: { success: true, result: { id: 'd-prev' } } },
    ];
    routes[`GET ${PROJECT}`] = [serving('d-prev')];
    const { code, out } = await run(['restore', 'shyden-site', 'd-prev']);
    expect(code, out).toBe(0);
    expect(asked()).toEqual([`POST ${ROLLBACK}`, `GET ${PROJECT}`]);
    expect(out).toBe('shyden-site serves d-prev again.\n');
  });

  it('a project still serving the failed release exits 1, naming both', async () => {
    routes[`POST ${ROLLBACK}`] = [
      { status: 200, body: { success: true, result: { id: 'd-prev' } } },
    ];
    routes[`GET ${PROJECT}`] = [serving('d-bad')];
    const { code, out } = await run(['restore', 'shyden-site', 'd-prev']);
    expect(code).toBe(1);
    expect(out).toContain('the project serves d-bad, not d-prev');
  });

  it('a refused rollback exits 1 without the confirming read', async () => {
    routes[`POST ${ROLLBACK}`] = [
      { status: 409, body: { success: false, errors: [] } },
    ];
    const { code, out } = await run(['restore', 'shyden-site', 'd-prev']);
    expect(code).toBe(1);
    expect(asked()).toEqual([`POST ${ROLLBACK}`]);
    expect(out).toContain('Cloudflare answered HTTP 409');
  });
});

describe('what the script is given', () => {
  it('a missing token stops before any request', async () => {
    const { code, out } = await run(['live', 'shyden-site'], {
      CLOUDFLARE_API_TOKEN: '',
    });
    expect(code).toBe(1);
    expect(asked()).toEqual([]);
    expect(out).toContain('CLOUDFLARE_API_TOKEN is not set');
  });

  it('a wrong command is refused with the usage line and exit 2', async () => {
    const { code, out } = await run(['promote', 'shyden-site']);
    expect(code).toBe(2);
    expect(out).toContain('usage: node scripts/pages.mjs');
    expect(asked()).toEqual([]);
  });
});

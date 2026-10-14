import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { spawn } from 'node:child_process';
import { join } from 'node:path';
import { standInApi } from './stand-in-api';

/**
 * `scripts/pages.mjs` as a real process (#748), as the deploy and rollback
 * steps run it, against a stand-in answering in Cloudflare's shapes. What it
 * asked is read off the stand-in's record: `live` makes one GET; `rollback`
 * one POST and one GET, never a list read.
 */

const SCRIPT = join(process.cwd(), 'scripts/pages.mjs');
const ACCOUNT = 'acc0123';
const TOKEN = 'cf-token-never-printed';
const PROJECT = `/accounts/${ACCOUNT}/pages/projects/shyden-site`;
const ROLLBACK = `${PROJECT}/deployments/d-prev/rollback`;

const live = (id: string) => ({
  status: 200,
  body: {
    success: true,
    result: { name: 'shyden-site', canonical_deployment: { id } },
  },
});

const stand = standInApi();
beforeAll(() => stand.start());
afterAll(() => stand.stop());
beforeEach(() => {
  stand.received.length = 0;
  stand.routes = {};
});

const run = (
  args: string[],
  overrides: Record<string, string | undefined> = {},
): Promise<{ code: number | null; out: string }> =>
  new Promise((resolve) => {
    const env: Record<string, string> = {};
    for (const [name, value] of Object.entries({
      PATH: process.env.PATH,
      CLOUDFLARE_API_URL: stand.url,
      CLOUDFLARE_API_TOKEN: TOKEN,
      CLOUDFLARE_ACCOUNT_ID: ACCOUNT,
      ...overrides,
    }))
      if (value !== undefined) env[name] = value;
    const child = spawn(process.execPath, [SCRIPT, ...args], { env });
    let out = '';
    child.stdout.on('data', (chunk) => (out += chunk));
    child.stderr.on('data', (chunk) => (out += chunk));
    child.on('close', (code) => resolve({ code, out }));
  });

const asked = () => stand.received.map(({ method, url }) => `${method} ${url}`);

describe('live', () => {
  it('prints the live deployment from one GET, sending the token as a bearer', async () => {
    stand.routes[`GET ${PROJECT}`] = live('d-prev');
    const { code, out } = await run(['live', 'shyden-site']);
    expect(code, out).toBe(0);
    expect(out).toBe('d-prev\n');
    expect(asked()).toEqual([`GET ${PROJECT}`]);
    expect(stand.received[0].auth).toBe(`Bearer ${TOKEN}`);
  });
  it('an answer naming no live deployment exits 1, saying so', async () => {
    stand.routes[`GET ${PROJECT}`] = {
      status: 200,
      body: { success: true, result: { name: 'shyden-site' } },
    };
    const { code, out } = await run(['live', 'shyden-site']);
    expect(code).toBe(1);
    expect(out).toBe('✗ the project answer names no canonical deployment\n');
  });
  it('a refused read exits 1 naming the status, and never prints the token', async () => {
    stand.routes[`GET ${PROJECT}`] = {
      status: 403,
      body: { success: false, errors: [{ code: 10000, message: TOKEN }] },
    };
    const { code, out } = await run(['live', 'shyden-site']);
    expect(code).toBe(1);
    expect(out).toBe('✗ Cloudflare answered HTTP 403\n');
  });
  it('a Cloudflare that never answers times out, rather than outliving the job', async () => {
    stand.routes[`GET ${PROJECT}`] = null;
    const { code, out } = await run(['live', 'shyden-site'], {
      PAGES_TIMEOUT_MS: '300',
    });
    expect(code).toBe(1);
    expect(out).toMatch(/aborted|timeout/i);
  });
});

describe('rollback', () => {
  it('promotes with one POST, then confirms with one GET, and reads no list', async () => {
    stand.routes[`POST ${ROLLBACK}`] = {
      status: 200,
      body: { success: true, result: { id: 'd-prev' } },
    };
    stand.routes[`GET ${PROJECT}`] = live('d-prev');
    const { code, out } = await run(['rollback', 'shyden-site', 'd-prev']);
    expect(code, out).toBe(0);
    expect(asked()).toEqual([`POST ${ROLLBACK}`, `GET ${PROJECT}`]);
    expect(out).toBe(
      'Rolled shyden-site back: the live deployment is d-prev.\n',
    );
  });
  it('a refused rollback exits 1 with its errors, and reads nothing after', async () => {
    stand.routes[`POST ${ROLLBACK}`] = {
      status: 200,
      body: {
        success: false,
        errors: [{ code: 8000007, message: 'Deployment not found' }],
      },
    };
    const { code, out } = await run(['rollback', 'shyden-site', 'd-prev']);
    expect(code).toBe(1);
    expect(out).toBe(
      '✗ Cloudflare refused the rollback: 8000007 Deployment not found\n',
    );
    expect(asked()).toEqual([`POST ${ROLLBACK}`]);
  });
  it('a canonical that did not move exits 1 naming both ids', async () => {
    stand.routes[`POST ${ROLLBACK}`] = {
      status: 200,
      body: { success: true, result: { id: 'd-prev' } },
    };
    stand.routes[`GET ${PROJECT}`] = live('d-new');
    const { code, out } = await run(['rollback', 'shyden-site', 'd-prev']);
    expect(code).toBe(1);
    expect(out).toBe(
      '✗ the rollback was accepted, but the live deployment is d-new, not d-prev\n',
    );
  });
  it('an id of another shape is refused before any request', async () => {
    const { code, out } = await run(['rollback', 'shyden-site', '../d-prev']);
    expect(code).toBe(1);
    expect(out).toBe('✗ ../d-prev is not a Pages deployment id\n');
  });
  it('an empty id, as an unset BEFORE hands it, is refused before any request', async () => {
    const { code, out } = await run(['rollback', 'shyden-site', '']);
    expect(code).toBe(1);
    expect(out).toBe('✗  is not a Pages deployment id\n');
  });
});

describe('what the script is given', () => {
  it('a missing token stops before any request, naming it', async () => {
    const { code, out } = await run(['live', 'shyden-site'], {
      CLOUDFLARE_API_TOKEN: undefined,
    });
    expect(code).toBe(1);
    expect(out).toBe(
      '✗ CLOUDFLARE_API_TOKEN is not set, or not in its expected shape\n',
    );
  });
  it('a missing account stops before any request, naming it', async () => {
    const { code, out } = await run(['live', 'shyden-site'], {
      CLOUDFLARE_ACCOUNT_ID: undefined,
    });
    expect(code).toBe(1);
    expect(out).toBe(
      '✗ CLOUDFLARE_ACCOUNT_ID is not set, or not in its expected shape\n',
    );
  });
  it('no command is refused with the usage line and exit 2', async () => {
    const { code, out } = await run([]);
    expect(code).toBe(2);
    expect(out).toBe(
      'usage: node scripts/pages.mjs live <project> | rollback <project> <deployment-id>\n',
    );
  });
  it('a project name that could reshape the path is refused with exit 2', async () => {
    const { code, out } = await run(['live', 'shyden-site/../other']);
    expect(code).toBe(2);
    expect(out).toBe(
      'usage: node scripts/pages.mjs live <project> | rollback <project> <deployment-id>\n',
    );
  });
});

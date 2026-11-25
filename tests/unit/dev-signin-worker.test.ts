// The DEV sign-in Worker's entry and its host map (#1262 AC1; the rules it wires are
// shyden-labs/repo-template#207's `handleSignin`, tested in dev-pass-signin.test.ts).
// Every outside call is a stub handed in: no test here reaches Cloudflare.
import { describe, expect, it, vi } from 'vitest';
import {
  DOOR_SECRET_HEADER,
  EMBED_AUDIENCES,
  HOSTS,
  PUBLIC_KEYS,
} from '../../workers/dev-signin/config.ts';
import {
  CERTS_TTL_SECONDS,
  createSignin,
  type SigninEnv,
} from '../../workers/dev-signin/index.ts';
import { handleSignin, type CodeStore } from '../../scripts/dev-pass/signin.ts';
import { mintPass, verifyPass } from '../../scripts/dev-pass/pass.ts';

const TEAM = 'https://shyden.cloudflareaccess.com';
/** ShyDesk's dev API and staff pages (shydesk-4b, measured 2026-11-26). */
const SHYDESK = 'shydesk.shydesk-non-prod.workers.dev';

async function privateJwk(): Promise<string> {
  const pair = (await crypto.subtle.generateKey('Ed25519', true, [
    'sign',
    'verify',
  ])) as CryptoKeyPair;
  return JSON.stringify(await crypto.subtle.exportKey('jwk', pair.privateKey));
}

const codes: CodeStore = {
  get: async () => null,
  put: async () => undefined,
  delete: async () => undefined,
};

async function env(): Promise<SigninEnv> {
  return {
    DOOR_SECRET: 'door-secret',
    DEV_PASS_PRIVATE_JWK: await privateJwk(),
    DEV_PASS_KID: '2026-11',
    ACCESS_TEAM_DOMAIN: TEAM,
    ACCESS_AUD: 'aud-tag',
    CODES: codes,
  };
}

function certsAnswer(): Response {
  return Response.json({
    keys: [{ kid: 'k1', kty: 'RSA', n: 'AQAB', e: 'AQAB' }],
  });
}

const part = (value: object) =>
  Buffer.from(JSON.stringify(value)).toString('base64url');
/** Shaped like Access's token, so the certs are read; its signature is not, so nothing is minted. */
const ACCESS_TOKEN = `${part({ alg: 'RS256', kid: 'k1' })}.${part({})}.c2ln`;

/** A `/pass` request through the door: the secret is right, the Access token is not. */
function passRequest(): Request {
  return new Request('https://signin.example/pass?for=dev.shyden.co.uk', {
    headers: {
      [DOOR_SECRET_HEADER]: 'door-secret',
      'Cf-Access-Jwt-Assertion': ACCESS_TOKEN,
    },
  });
}

describe('the host map', () => {
  it('holds exactly the dev hosts a pass may be minted for', () => {
    expect(Object.keys(HOSTS).sort()).toEqual(
      [
        'dev-api.yaweloidle.com',
        'dev-holding.yaweloidle.com',
        'dev.shyden.co.uk',
        'dev.yaweloidle.com',
        // ShyDesk's dev staff pages and demo page (#1263 AC1).
        SHYDESK,
      ].sort(),
    );
  });

  it('gives no host an app link yet', () => {
    for (const host of Object.keys(HOSTS))
      expect(HOSTS[host]?.appRedirects, host).toEqual([]);
  });
});

describe('the embed audiences (#1263 AC2)', () => {
  it('lets each product dev page get a pass for ShyDesk, and nothing else', () => {
    expect(EMBED_AUDIENCES).toEqual({
      'dev.yaweloidle.com': [SHYDESK],
      'dev.shytalk.app': [SHYDESK],
      'dev.shyden.co.uk': [SHYDESK],
    });
  });

  it("checks the doors' passes with the sign-in's own public key", () => {
    expect(PUBLIC_KEYS).toEqual({
      '2026-11': 'OBLprb_S4Kn2C--HFVaeA3_s6gEsApDiRAWPLc6WsK8',
    });
  });

  async function swap(
    door: string,
    audience: string,
  ): Promise<{ answer: Response; keys: Record<string, string> }> {
    const pair = (await crypto.subtle.generateKey('Ed25519', true, [
      'sign',
      'verify',
    ])) as CryptoKeyPair;
    const { x } = await crypto.subtle.exportKey('jwk', pair.publicKey);
    const signing = { kid: 'test', privateKey: pair.privateKey };
    const now = 1_800_000_000;
    const pass = await mintPass(
      { aud: door, sub: 'person@example.com', kind: 'browser' },
      signing,
      now,
    );
    const keys = { test: x ?? '' };
    const answer = await handleSignin(
      new Request('https://signin.example/embed', {
        method: 'POST',
        headers: {
          [DOOR_SECRET_HEADER]: 'door-secret',
          'content-type': 'application/x-www-form-urlencoded',
        },
        body: new URLSearchParams({ pass, for: audience }).toString(),
      }),
      {
        secretHeader: DOOR_SECRET_HEADER,
        secret: 'door-secret',
        issuer: TEAM,
        audience: 'aud-tag',
        fetchCerts: async () => [],
        hosts: HOSTS,
        signing,
        codes,
        embeds: { keys, audiences: EMBED_AUDIENCES },
        now,
      },
    );
    return { answer, keys };
  }

  it('swaps a dev.shyden.co.uk pass for a ShyDesk embed pass', async () => {
    const { answer, keys } = await swap('dev.shyden.co.uk', SHYDESK);
    expect(answer.status).toBe(200);
    const { pass } = (await answer.json()) as { pass: string };
    expect(
      await verifyPass(pass, { host: SHYDESK, keys, now: 1_800_000_000 }),
    ).toMatchObject({ ok: true, kind: 'embed', sub: 'person@example.com' });
  });

  it('refuses a pair the map does not list', async () => {
    const otherAudience = await swap(
      'dev.shyden.co.uk',
      'dev-api.yaweloidle.com',
    );
    expect(otherAudience.answer.status).toBe(401);
    const otherDoor = await swap('dev-api.yaweloidle.com', SHYDESK);
    expect(otherDoor.answer.status).toBe(401);
  });
});

describe('the sign-in entry', () => {
  it('serves the embed swap, refusing a pass no door key signed (#1263)', async () => {
    const signin = createSignin({
      fetch: vi.fn(async () => certsAnswer()),
      nowSeconds: () => 1_800_000_000,
    });
    const answer = await signin.fetch(
      new Request('https://signin.example/embed', {
        method: 'POST',
        headers: {
          [DOOR_SECRET_HEADER]: 'door-secret',
          'content-type': 'application/x-www-form-urlencoded',
        },
        body: new URLSearchParams({
          pass: 'not-a-pass',
          for: SHYDESK,
        }).toString(),
      }),
      await env(),
    );
    // 404 is the answer of a sign-in with no embeds wired.
    expect(answer.status).toBe(401);
  });

  it('refuses a request without the door secret before reading anything else', async () => {
    const fetchCerts = vi.fn(async () => certsAnswer());
    const signin = createSignin({
      fetch: fetchCerts,
      nowSeconds: () => 1_800_000_000,
    });
    const answer = await signin.fetch(
      new Request('https://signin.example/pass?for=dev.shyden.co.uk'),
      await env(),
    );
    expect(answer.status).toBe(401);
    expect(fetchCerts).not.toHaveBeenCalled();
  });

  it("reads Access's certs from the team domain, once while they are fresh", async () => {
    const fetchCerts = vi.fn(async () => certsAnswer());
    let now = 1_800_000_000;
    const signin = createSignin({ fetch: fetchCerts, nowSeconds: () => now });
    const workerEnv = await env();
    await signin.fetch(passRequest(), workerEnv);
    now += CERTS_TTL_SECONDS - 1;
    await signin.fetch(passRequest(), workerEnv);
    expect(fetchCerts).toHaveBeenCalledTimes(1);
    expect(fetchCerts).toHaveBeenCalledWith(`${TEAM}/cdn-cgi/access/certs`);
  });

  it('reads the certs again once they are stale', async () => {
    const fetchCerts = vi.fn(async () => certsAnswer());
    let now = 1_800_000_000;
    const signin = createSignin({ fetch: fetchCerts, nowSeconds: () => now });
    const workerEnv = await env();
    await signin.fetch(passRequest(), workerEnv);
    now += CERTS_TTL_SECONDS;
    await signin.fetch(passRequest(), workerEnv);
    expect(fetchCerts).toHaveBeenCalledTimes(2);
  });

  it('keeps no failed certs read, and lets nobody in on one', async () => {
    const fetchCerts = vi
      .fn<(url: string) => Promise<Response>>()
      .mockResolvedValueOnce(new Response('down', { status: 503 }))
      .mockResolvedValueOnce(certsAnswer());
    const signin = createSignin({
      fetch: fetchCerts,
      nowSeconds: () => 1_800_000_000,
    });
    const workerEnv = await env();
    expect((await signin.fetch(passRequest(), workerEnv)).status).toBe(401);
    await signin.fetch(passRequest(), workerEnv);
    expect(fetchCerts).toHaveBeenCalledTimes(2);
  });
});

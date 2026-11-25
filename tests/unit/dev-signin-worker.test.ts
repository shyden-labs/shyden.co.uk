// The DEV sign-in Worker's entry and its host map (#1262 AC1; the rules it wires are
// shyden-labs/repo-template#207's `handleSignin`, tested in dev-pass-signin.test.ts).
// Every outside call is a stub handed in: no test here reaches Cloudflare.
import { describe, expect, it, vi } from 'vitest';
import { DOOR_SECRET_HEADER, HOSTS } from '../../workers/dev-signin/config.ts';
import {
  CERTS_TTL_SECONDS,
  createSignin,
  type SigninEnv,
} from '../../workers/dev-signin/index.ts';
import type { CodeStore } from '../../scripts/dev-pass/signin.ts';

const TEAM = 'https://shyden.cloudflareaccess.com';

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
      ].sort(),
    );
  });

  it('gives no host an app link yet', () => {
    for (const host of Object.keys(HOSTS))
      expect(HOSTS[host]?.appRedirects, host).toEqual([]);
  });
});

describe('the sign-in entry', () => {
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

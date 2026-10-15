import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  accessKeys,
  accessOk,
  forgetAccessKeys,
  privatePath,
  verifyAccessJwt,
} from '../../functions/_lib/access.js';
import { onRequest } from '../../functions/_middleware.js';

/**
 * #781. Production's private paths need a Cloudflare Access sign-in, and the
 * site checks Access's signed token itself, so a gap in the dashboard cannot
 * open them. Every token here is signed in-process with a key made once at
 * load; nothing reaches the network (the keys are handed in, or `fetch` is a
 * stand-in).
 */

const TEAM = 'shyden.cloudflareaccess.com';
const AUD = 'a1b2c3';
const NOW = 1_800_000_000;
const PAIR = await crypto.subtle.generateKey(
  {
    name: 'RSASSA-PKCS1-v1_5',
    modulusLength: 2048,
    publicExponent: new Uint8Array([1, 0, 1]),
    hash: 'SHA-256',
  },
  true,
  ['sign', 'verify'],
);
const OTHER = await crypto.subtle.generateKey(
  {
    name: 'RSASSA-PKCS1-v1_5',
    modulusLength: 2048,
    publicExponent: new Uint8Array([1, 0, 1]),
    hash: 'SHA-256',
  },
  true,
  ['sign', 'verify'],
);
const KEYS = {
  keys: [
    {
      ...(await crypto.subtle.exportKey('jwk', PAIR.publicKey)),
      kid: 'k1',
      alg: 'RS256',
      use: 'sig',
    },
  ],
};

const b64url = (bytes: Uint8Array): string =>
  Buffer.from(bytes).toString('base64url');
const part = (value: object): string =>
  b64url(new TextEncoder().encode(JSON.stringify(value)));
const HEADER = { alg: 'RS256', kid: 'k1', typ: 'JWT' };
const CLAIMS = {
  iss: `https://${TEAM}`,
  aud: [AUD],
  exp: NOW + 60,
  iat: NOW - 60,
  email: 'operator@example.test',
};

async function token(
  header: object = HEADER,
  claims: object = CLAIMS,
  key: CryptoKey = PAIR.privateKey,
): Promise<string> {
  const signed = `${part(header)}.${part(claims)}`;
  const signature = await crypto.subtle.sign(
    'RSASSA-PKCS1-v1_5',
    key,
    new TextEncoder().encode(signed),
  );
  return `${signed}.${b64url(new Uint8Array(signature))}`;
}

const verify = (jwt: string | null, options = {}) =>
  verifyAccessJwt(jwt, {
    teamDomain: TEAM,
    aud: AUD,
    now: NOW,
    keys: KEYS,
    ...options,
  });

describe('privatePath: which paths production keeps for signed-in people', () => {
  it.each([
    '/api/docs/private',
    '/api/docs/private/',
    '/api/docs/private/index.html',
    '/api/docs/private.html',
    '/api/docs/%70rivate/',
    '//api/docs//private/',
    '/API/Docs/Private/',
    '/api/docs/%E0%A4%A/',
  ])('%s is private', (path) => {
    expect(privatePath(path)).toBe(true);
  });

  it.each(['/api/docs/', '/api/docs/privateer', '/api/report', '/'])(
    '%s is public',
    (path) => {
      expect(privatePath(path)).toBe(false);
    },
  );
});

describe('verifyAccessJwt: only a token Access signed for this site, still valid', () => {
  it('admits a valid token', async () => {
    expect(await verify(await token())).toBe(true);
  });

  it('admits an audience written as one string', async () => {
    expect(await verify(await token(HEADER, { ...CLAIMS, aud: AUD }))).toBe(
      true,
    );
  });

  it.each([
    ['an expired token', { exp: NOW - 1 }],
    ['a token expiring this second', { exp: NOW }],
    ['a token not valid yet', { nbf: NOW + 1 }],
    ['a token with no expiry', { exp: undefined }],
    ['another audience', { aud: ['someone-else'] }],
    ['another issuer', { iss: 'https://elsewhere.cloudflareaccess.com' }],
  ])('refuses %s', async (_, change) => {
    expect(await verify(await token(HEADER, { ...CLAIMS, ...change }))).toBe(
      false,
    );
  });

  it('refuses a key it does not know', async () => {
    expect(await verify(await token({ ...HEADER, kid: 'k2' }))).toBe(false);
  });

  it('refuses a token signed by another key under the same kid', async () => {
    expect(await verify(await token(HEADER, CLAIMS, OTHER.privateKey))).toBe(
      false,
    );
  });

  it('refuses alg none with no signature', async () => {
    const signed = `${part({ ...HEADER, alg: 'none' })}.${part(CLAIMS)}`;
    expect(await verify(`${signed}.`)).toBe(false);
  });

  // Signed with the team's own key, so only the header check can refuse them.
  it.each(['none', 'HS256', 'RS512'])(
    'refuses a header naming %s, even over a good signature',
    async (alg) => {
      expect(await verify(await token({ ...HEADER, alg }))).toBe(false);
    },
  );

  it('refuses a payload changed after signing', async () => {
    const [header, , signature] = (await token()).split('.');
    const forged = part({ ...CLAIMS, email: 'someone@example.test' });
    expect(await verify(`${header}.${forged}.${signature}`)).toBe(false);
  });

  it.each([
    ['two segments', 'a.b'],
    ['a character outside base64url', 'a+b.c.d'],
    ['an empty string', ''],
  ])('refuses %s', async (_, jwt) => {
    expect(await verify(jwt)).toBe(false);
  });

  it('refuses no token', async () => {
    expect(await verify(null)).toBe(false);
  });

  it.each([
    ['no team domain', { teamDomain: '' }],
    ['no audience', { aud: '' }],
    ['no key set', { keys: {} }],
  ])('refuses everything with %s', async (_, options) => {
    expect(await verify(await token(), options)).toBe(false);
  });
});

describe('accessKeys: the team keys, fetched and kept ten minutes', () => {
  afterEach(() => forgetAccessKeys());

  const answering = (body: unknown, status = 200) =>
    vi.fn(
      async () =>
        new Response(typeof body === 'string' ? body : JSON.stringify(body), {
          status,
        }),
    );

  it('fetches the team certs once, then keeps them', async () => {
    const fetchKeys = answering(KEYS);
    expect(await accessKeys(TEAM, fetchKeys, NOW)).toEqual(KEYS);
    expect(await accessKeys(TEAM, fetchKeys, NOW + 599)).toEqual(KEYS);
    expect(fetchKeys.mock.calls).toEqual([
      [`https://${TEAM}/cdn-cgi/access/certs`],
    ]);
  });

  it('fetches again after ten minutes', async () => {
    const fetchKeys = answering(KEYS);
    await accessKeys(TEAM, fetchKeys, NOW);
    await accessKeys(TEAM, fetchKeys, NOW + 600);
    expect(fetchKeys.mock.calls).toHaveLength(2);
  });

  it('throws on an answer that is not 200', async () => {
    await expect(accessKeys(TEAM, answering(KEYS, 500), NOW)).rejects.toThrow(
      /500/,
    );
  });

  it('throws on an answer that is not JSON', async () => {
    await expect(accessKeys(TEAM, answering('<html>'), NOW)).rejects.toThrow(
      SyntaxError,
    );
  });
});

describe('the middleware on production', () => {
  afterEach(() => {
    forgetAccessKeys();
    vi.unstubAllGlobals();
  });

  const ENV = { ACCESS_TEAM_DOMAIN: TEAM, ACCESS_AUD: AUD };
  const next = vi.fn(async () => new Response('page', { status: 200 }));
  const visit = (
    path: string,
    headers: Record<string, string> = {},
    env: Record<string, string> = ENV,
  ) =>
    onRequest({
      request: new Request(`https://shyden.co.uk${path}`, { headers }),
      env,
      next,
    });

  it('refuses the private docs without a token, with no body', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => Response.json(KEYS)),
    );
    const response = await visit('/api/docs/private/');
    expect(response.status).toBe(403);
    expect(await response.text()).toBe('');
  });

  it('admits the private docs with a valid token', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => Response.json(KEYS)),
    );
    vi.spyOn(Date, 'now').mockReturnValue(NOW * 1000);
    const response = await visit('/api/docs/private/', {
      'Cf-Access-Jwt-Assertion': await token(),
    });
    expect(response.status).toBe(200);
    vi.restoreAllMocks();
  });

  it('refuses everything private when the Access settings are missing', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => Response.json(KEYS)),
    );
    const response = await visit(
      '/api/docs/private/',
      { 'Cf-Access-Jwt-Assertion': await token() },
      {},
    );
    expect(response.status).toBe(403);
  });

  it('refuses when the team keys cannot be fetched', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('', { status: 502 })),
    );
    const response = await visit('/api/docs/private/', {
      'Cf-Access-Jwt-Assertion': await token(),
    });
    expect(response.status).toBe(403);
  });

  it('leaves the public docs alone', async () => {
    const response = await visit('/api/docs/');
    expect(response.status).toBe(200);
  });
});

describe('accessOk reads the request and the environment', () => {
  afterEach(() => forgetAccessKeys());

  it('is false with no token header', async () => {
    const request = new Request('https://shyden.co.uk/api/docs/private/');
    expect(
      await accessOk(
        request,
        { ACCESS_TEAM_DOMAIN: TEAM, ACCESS_AUD: AUD },
        { fetchKeys: async () => Response.json(KEYS), now: NOW },
      ),
    ).toBe(false);
  });
});

import { beforeAll, describe, expect, it, vi } from 'vitest';
import { onRequest } from '../../functions/_middleware.js';
import {
  DEV_DOOR_HOST,
  DEV_PASS_KEYS,
  passKeys,
} from '../../functions/_lib/dev-door.ts';
import {
  PASS_COOKIE,
  PASS_HEADER,
  SIGNIN_ORIGIN,
} from '../../scripts/dev-pass/door.ts';
import { mintPass, type SigningKey } from '../../scripts/dev-pass/pass.ts';

/**
 * dev.shyden.co.uk is gated by the DEV pass (#1262 AC2,
 * shyden-labs/repo-template#207): the Pages middleware runs the shared door
 * before anything is served, and the Basic Auth password is gone. `next` is a
 * mock, so its call count proves what got through.
 */

const NO_INDEX = 'noindex, nofollow, noarchive';
let key: SigningKey;
let testKeys: string;
const gate = (context: Parameters<typeof onRequest>[0]) =>
  onRequest({ ...context, env: { DEV_PASS_KEYS: testKeys, ...context.env } });

beforeAll(async () => {
  const pair = (await crypto.subtle.generateKey('Ed25519', true, [
    'sign',
    'verify',
  ])) as CryptoKeyPair;
  key = { kid: 'test-kid', privateKey: pair.privateKey };
  const jwk = await crypto.subtle.exportKey('jwk', pair.publicKey);
  testKeys = JSON.stringify({ 'test-kid': jwk.x ?? '' });
});

const now = () => Math.floor(Date.now() / 1000);

async function pass(aud = DEV_DOOR_HOST, at = now()): Promise<string> {
  return mintPass({ aud, sub: 'ci@example.test', kind: 'machine' }, key, at);
}

function origin() {
  return vi.fn(
    async (_request?: Request) =>
      new Response('page', { status: 200, headers: { 'x-from': 'origin' } }),
  );
}

const PAGE = { accept: 'text/html' };

describe('the dev gate checks the DEV pass, not a password', () => {
  it('sends a page visitor with no pass to sign in, and serves nothing', async () => {
    const next = origin();
    const res = await gate({
      request: new Request('https://dev.shyden.co.uk/support/?x=1', {
        headers: PAGE,
      }),
      env: {},
      next,
    });
    expect(next).not.toHaveBeenCalled();
    expect(res.status).toBe(302);
    const location = new URL(res.headers.get('location') ?? '');
    expect(location.origin + location.pathname).toBe(`${SIGNIN_ORIGIN}/pass`);
    expect(location.searchParams.get('for')).toBe('dev.shyden.co.uk');
    expect(location.searchParams.get('back')).toBe('/support/?x=1');
    expect(res.headers.get('x-robots-tag')).toBe(NO_INDEX);
  });

  it('answers 401 to a request that is not a page, with no pass', async () => {
    const next = origin();
    const res = await gate({
      request: new Request('https://dev.shyden.co.uk/api/report', {
        method: 'POST',
      }),
      env: {},
      next,
    });
    expect(next).not.toHaveBeenCalled();
    expect(res.status).toBe(401);
    expect(res.headers.get('www-authenticate')).toBeNull();
  });

  it('refuses the old Basic Auth password, even when it is still set', async () => {
    const next = origin();
    const res = await gate({
      request: new Request('https://dev.shyden.co.uk/', {
        headers: {
          ...PAGE,
          Authorization: `Basic ${btoa('dev:old-password')}`,
        },
      }),
      env: { DEV_PASSWORD: 'old-password' },
      next,
    });
    expect(next).not.toHaveBeenCalled();
    expect(res.status).toBe(302);
  });

  it('serves a browser pass in its cookie, without passing the pass on', async () => {
    const next = origin();
    const res = await gate({
      request: new Request('https://dev.shyden.co.uk/', {
        headers: { ...PAGE, cookie: `${PASS_COOKIE}=${await pass()}; a=1` },
      }),
      env: {},
      next,
    });
    expect(next).toHaveBeenCalledTimes(1);
    const forwarded = next.mock.calls[0]?.[0] as Request;
    expect(forwarded.headers.get('cookie')).toBe('a=1');
    expect(res.status).toBe(200);
    expect(res.headers.get('x-from')).toBe('origin');
    expect(res.headers.get('x-robots-tag')).toBe(NO_INDEX);
  });

  it('serves a machine pass in its header on a preview host of the same project', async () => {
    const next = origin();
    const res = await gate({
      request: new Request('https://abc123.shyden-site-dev.pages.dev/', {
        headers: { [PASS_HEADER]: await pass() },
      }),
      env: {},
      next,
    });
    expect(next).toHaveBeenCalledTimes(1);
    const forwarded = next.mock.calls[0]?.[0] as Request;
    expect(forwarded.headers.get(PASS_HEADER)).toBeNull();
    expect(res.status).toBe(200);
  });

  it('refuses a pass made for another door', async () => {
    const next = origin();
    const res = await gate({
      request: new Request('https://dev.shyden.co.uk/', {
        headers: { [PASS_HEADER]: await pass('dev.yaweloidle.com') },
      }),
      env: {},
      next,
    });
    expect(next).not.toHaveBeenCalled();
    expect(res.status).toBe(401);
  });

  it('refuses an expired pass', async () => {
    const next = origin();
    const res = await gate({
      request: new Request('https://dev.shyden.co.uk/', {
        headers: { [PASS_HEADER]: await pass(DEV_DOOR_HOST, now() - 86_400) },
      }),
      env: {},
      next,
    });
    expect(next).not.toHaveBeenCalled();
    expect(res.status).toBe(401);
  });

  it('serves robots.txt before the gate, telling crawlers to stay away', async () => {
    const next = origin();
    const res = await gate({
      request: new Request('https://dev.shyden.co.uk/robots.txt'),
      env: {},
      next,
    });
    expect(next).not.toHaveBeenCalled();
    expect(res.status).toBe(200);
    expect(await res.text()).toContain('Disallow: /');
  });

  it('leaves production ungated', async () => {
    const next = origin();
    const res = await gate({
      request: new Request('https://shyden.co.uk/', { headers: PAGE }),
      env: {},
      next,
    });
    expect(next).toHaveBeenCalledTimes(1);
    expect(res.status).toBe(200);
  });
});

describe('the deployed gate trusts the live key unless DEV_PASS_KEYS names others', () => {
  it('names dev.shyden.co.uk as its door and the 2026-11 key the sign-in signs with', () => {
    expect(DEV_DOOR_HOST).toBe('dev.shyden.co.uk');
    expect(DEV_PASS_KEYS).toEqual({
      '2026-11': 'OBLprb_S4Kn2C--HFVaeA3_s6gEsApDiRAWPLc6WsK8',
    });
  });

  it.each(['not json', '[]', 'null', '"k"', '{"k":1}', '{"k":"x","j":2}'])(
    'trusts no key at all when DEV_PASS_KEYS is %s',
    (setting) => {
      expect(passKeys(setting)).toEqual({});
    },
  );

  it('trusts exactly the keys DEV_PASS_KEYS names, and the live key when unset', () => {
    expect(passKeys('{"a":"x","b":"y"}')).toEqual({ a: 'x', b: 'y' });
    expect(passKeys(undefined)).toBe(DEV_PASS_KEYS);
  });

  it('refuses a test-key pass when DEV_PASS_KEYS is not set', async () => {
    const next = origin();
    const res = await onRequest({
      request: new Request('https://dev.shyden.co.uk/', {
        headers: { [PASS_HEADER]: await pass() },
      }),
      env: {},
      next,
    });
    expect(next).not.toHaveBeenCalled();
    expect(res.status).toBe(401);
  });
});

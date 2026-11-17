import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  DEV_PASS_LIFETIME_S,
  DEV_PASS_TARGETS,
  goResponse,
  mintDevPass,
  onGoRequest,
} from '../../functions/_lib/dev-pass.js';

/**
 * The one-use dev pass (#1192): dev.shyden.co.uk/go/<project> mints a 60 s
 * token, signed with that project's secret, and sends the browser to the
 * project's dev site with it. The format is the one agreed with yawelo-idle-63
 * and shytalk-a2 on 2026-11-17:
 * `base64url(payload) + "." + base64url(HMAC-SHA256(secret, base64url(payload)))`,
 * the payload `{"v":1,"host":…,"exp":…,"nonce":…}`. The clock and the random
 * bytes are stood in, so every value below is exact.
 */

const NOW_MS = 1_763_420_000_123;
const NOW_S = Math.floor(NOW_MS / 1000);
const YAWELO_SECRET = 'yawelo-test-secret';
const SHYTALK_SECRET = 'shytalk-test-secret';
const ENV = {
  DEV_PASS_SECRET_YAWELO: YAWELO_SECRET,
  DEV_PASS_SECRET_SHYTALK: SHYTALK_SECRET,
};

/** Sixteen bytes counting up from `start`, so two calls can differ on purpose. */
const bytesFrom =
  (start: number) =>
  (n: number): Uint8Array =>
    Uint8Array.from({ length: n }, (_, i) => (start + i) % 256);

const b64url = (bytes: Buffer): string => bytes.toString('base64url');

/** Splits a token and checks its signature with node's own HMAC, not the code's. */
const read = (token: string, secret: string) => {
  const [payload, signature, ...rest] = token.split('.');
  const expected = b64url(
    createHmac('sha256', secret).update(payload).digest(),
  );
  return {
    parts: 2 + rest.length,
    signed: signature === expected,
    payload: JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')),
  };
};

const DEV = 'https://dev.shyden.co.uk';

const go = (path: string, env: Record<string, string | undefined> = ENV) =>
  goResponse(new URL(path, DEV), env, {
    nowMs: NOW_MS,
    randomBytes: bytesFrom(0),
  });

describe('mintDevPass: the agreed token (#1192)', () => {
  it('signs base64url(payload) with HMAC-SHA256 of the secret, joined by one dot', async () => {
    const token = await mintDevPass({
      secret: YAWELO_SECRET,
      host: 'dev.yaweloidle.com',
      nowMs: NOW_MS,
      randomBytes: bytesFrom(0),
    });
    const { parts, signed } = read(token, YAWELO_SECRET);
    expect(parts).toBe(2);
    expect(signed).toBe(true);
  });

  it('names the target host, expires 60 s after minting, and carries 16 random bytes as its nonce', async () => {
    const token = await mintDevPass({
      secret: YAWELO_SECRET,
      host: 'dev.yaweloidle.com',
      nowMs: NOW_MS,
      randomBytes: bytesFrom(0),
    });
    expect(DEV_PASS_LIFETIME_S).toBe(60);
    expect(read(token, YAWELO_SECRET).payload).toStrictEqual({
      v: 1,
      host: 'dev.yaweloidle.com',
      exp: NOW_S + 60,
      nonce: b64url(Buffer.from(bytesFrom(0)(16))),
    });
  });

  it('fails verification with the other project’s secret', async () => {
    const token = await mintDevPass({
      secret: YAWELO_SECRET,
      host: 'dev.yaweloidle.com',
      nowMs: NOW_MS,
      randomBytes: bytesFrom(0),
    });
    expect(read(token, SHYTALK_SECRET).signed).toBe(false);
  });

  it('takes a fresh nonce on every mint', async () => {
    const mint = (start: number) =>
      mintDevPass({
        secret: YAWELO_SECRET,
        host: 'dev.yaweloidle.com',
        nowMs: NOW_MS,
        randomBytes: bytesFrom(start),
      });
    const [a, b] = await Promise.all([mint(0), mint(100)]);
    expect(read(a, YAWELO_SECRET).payload.nonce).not.toBe(
      read(b, YAWELO_SECRET).payload.nonce,
    );
  });
});

describe('goResponse: /go/<project> on the dev site (#1192)', () => {
  it('knows exactly two projects, each with its own dev host and secret', () => {
    expect(DEV_PASS_TARGETS).toStrictEqual({
      yawelo: { host: 'dev.yaweloidle.com', secret: 'DEV_PASS_SECRET_YAWELO' },
      shytalk: { host: 'dev.shytalk.app', secret: 'DEV_PASS_SECRET_SHYTALK' },
    });
  });

  for (const [project, host, secret] of [
    ['yawelo', 'dev.yaweloidle.com', YAWELO_SECRET],
    ['shytalk', 'dev.shytalk.app', SHYTALK_SECRET],
  ] as const)
    it(`sends /go/${project} to ${host} with a pass signed by its own secret, uncached and with no referrer`, async () => {
      const response = await go(`/go/${project}`);
      expect(response.status).toBe(302);
      expect(response.headers.get('Cache-Control')).toBe('no-store');
      expect(response.headers.get('Referrer-Policy')).toBe('no-referrer');
      const location = new URL(response.headers.get('Location') ?? '');
      expect(`${location.origin}${location.pathname}`).toBe(`https://${host}/`);
      expect([...location.searchParams.keys()]).toEqual(['dev_pass']);
      const pass = read(location.searchParams.get('dev_pass') ?? '', secret);
      expect(pass.signed).toBe(true);
      expect(pass.payload.host).toBe(host);
    });

  it('answers 404 for a project it does not know, and mints nothing', async () => {
    const response = await go('/go/steadyhand');
    expect(response.status).toBe(404);
    expect(response.headers.get('Location')).toBeNull();
  });

  it('answers 404 on the production hostname, and mints nothing', async () => {
    const response = await goResponse(
      new URL('https://shyden.co.uk/go/yawelo'),
      ENV,
      { nowMs: NOW_MS, randomBytes: bytesFrom(0) },
    );
    expect(response.status).toBe(404);
    expect(response.headers.get('Location')).toBeNull();
  });

  it('fails closed without the project’s secret: a 5xx naming the variable, never its value, and no redirect', async () => {
    const response = await go('/go/shytalk', {
      DEV_PASS_SECRET_YAWELO: YAWELO_SECRET,
    });
    expect(response.status).toBe(503);
    expect(response.headers.get('Location')).toBeNull();
    const body = await response.text();
    expect(body).toContain('DEV_PASS_SECRET_SHYTALK');
    expect(body).not.toContain(YAWELO_SECRET);
  });

  it('treats an empty secret as missing', async () => {
    const response = await go('/go/yawelo', {
      ...ENV,
      DEV_PASS_SECRET_YAWELO: '',
    });
    expect(response.status).toBe(503);
  });

  it('answers 404 for /go itself and for anything below a project', async () => {
    expect((await go('/go')).status).toBe(404);
    expect((await go('/go/yawelo/extra')).status).toBe(404);
  });
});

describe('onGoRequest: the route files hand it the real clock and randomness (#1192)', () => {
  it('mints a pass that expires 60 s from now, with a different nonce each time', async () => {
    const request = () =>
      onGoRequest({ request: new Request(`${DEV}/go/yawelo`), env: ENV });
    const before = Math.floor(Date.now() / 1000);
    const passes = await Promise.all([request(), request()]).then((all) =>
      all.map(
        (r) =>
          read(
            new URL(r.headers.get('Location') ?? '').searchParams.get(
              'dev_pass',
            ) ?? '',
            YAWELO_SECRET,
          ).payload,
      ),
    );
    const after = Math.floor(Date.now() / 1000);
    for (const pass of passes) {
      expect(pass.exp).toBeGreaterThanOrEqual(before + 60);
      expect(pass.exp).toBeLessThanOrEqual(after + 60);
    }
    expect(passes[0].nonce).not.toBe(passes[1].nonce);
  });
});

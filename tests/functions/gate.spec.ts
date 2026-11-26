import { createHmac } from 'node:crypto';
import { test, expect } from '@playwright/test';
import { LEGACY_REDIRECTS } from '../legacy-redirect';
import { robotsDirectives } from '../robots-directives';
import { SIGNIN_ORIGIN } from '../../scripts/dev-pass/door.ts';
import { mintPass } from '../../scripts/dev-pass/pass.ts';
import { BASE_URL, DEV_PASS_SECRET_YAWELO } from './local.mjs';

// The non-prod gate, `functions/_middleware.js`, proven before the merge
// (#394). `wrangler pages dev` serves dist/ with the real Functions on
// 127.0.0.1, which is not the prod host, so the gate runs here exactly as it
// does on dev.shyden.co.uk. dev-sanity checks the deployed site's own gate.

const NO_INDEX = 'noindex, nofollow, noarchive';

test('a visitor without a DEV pass meets the gate', async () => {
  // Raw fetch, NOT the `request` fixture: that carries the config's pass, so
  // a missing gate would pass.
  const anonymous = await fetch(`${BASE_URL}/`, {
    redirect: 'manual',
    headers: { Accept: 'text/html' },
  });
  expect.soft(anonymous.status).toBe(302);
  const signin = new URL(anonymous.headers.get('location') ?? '', BASE_URL);
  expect.soft(signin.origin + signin.pathname).toBe(`${SIGNIN_ORIGIN}/pass`);
  expect.soft(signin.searchParams.get('for')).toBe('dev.shyden.co.uk');
  expect.soft(anonymous.headers.get('www-authenticate')).toBeNull();
  expect.soft(anonymous.headers.get('x-robots-tag')).toBe(NO_INDEX);

  // Not a page: refused outright, never redirected.
  const api = await fetch(`${BASE_URL}/`, { redirect: 'manual' });
  expect.soft(api.status).toBe(401);

  // The old shared password opens nothing any more (#1262 AC2).
  const basic = await fetch(`${BASE_URL}/`, {
    redirect: 'manual',
    headers: { Authorization: `Basic ${btoa('dev:functions-local')}` },
  });
  expect.soft(basic.status).toBe(401);

  // A well-formed pass signed by a key the server does not trust.
  const pair = (await crypto.subtle.generateKey('Ed25519', true, [
    'sign',
    'verify',
  ])) as CryptoKeyPair;
  const forged = await mintPass(
    { aud: 'dev.shyden.co.uk', sub: 'forger', kind: 'machine' },
    { kid: 'functions-local', privateKey: pair.privateKey },
    Math.floor(Date.now() / 1000),
  );
  const refused = await fetch(`${BASE_URL}/`, {
    redirect: 'manual',
    headers: { 'X-Dev-Pass': forged },
  });
  expect.soft(refused.status).toBe(401);

  // robots.txt answers before the gate, so a crawler is told to stay away
  // rather than handed a 401.
  const robots = await fetch(`${BASE_URL}/robots.txt`, { redirect: 'manual' });
  expect.soft(robots.status).toBe(200);
  expect.soft(robots.headers.get('x-robots-tag')).toBe(NO_INDEX);
  // Every directive, whole: `Disallow: /private` contains `Disallow: /`.
  expect
    .soft(robotsDirectives(await robots.text()))
    .toEqual(['User-agent: *', 'Disallow: /']);

  // The moved page (#635) answers before the gate too, in every locale.
  for (const [from, to] of LEGACY_REDIRECTS) {
    const moved = await fetch(`${BASE_URL}${from}`, { redirect: 'manual' });
    expect.soft(moved.status, from).toBe(301);
    const target = new URL(moved.headers.get('location') ?? '', BASE_URL);
    expect.soft(target.pathname + target.hash, from).toBe(to);
  }

  // The hand-off link (#1192) is minted behind the gate, never before it.
  const pass = await fetch(`${BASE_URL}/go/yawelo`, { redirect: 'manual' });
  expect.soft(pass.status).toBe(401);
  expect.soft(pass.headers.get('location')).toBeNull();
});

test('a visitor with a DEV pass is let through, marked noindex', async ({
  request,
}) => {
  const page = await request.get('/', { maxRedirects: 0 });
  expect.soft(page.status()).toBe(200);
  expect.soft(page.headers()['x-robots-tag']).toBe(NO_INDEX);
  expect.soft(page.headers()['www-authenticate']).toBeUndefined();

  // The dev pass (#1192), on workerd: a 302 to Yawelo Idle's dev site with a
  // pass signed by its secret, read back with node's own HMAC.
  const pass = await request.get('/go/yawelo', { maxRedirects: 0 });
  expect.soft(pass.status()).toBe(302);
  expect.soft(pass.headers()['cache-control']).toBe('no-store');
  expect.soft(pass.headers()['referrer-policy']).toBe('no-referrer');
  const location = new URL(pass.headers()['location'] ?? '');
  expect.soft(location.origin).toBe('https://dev.yaweloidle.com');
  const [payload, signature] = (
    location.searchParams.get('dev_pass') ?? ''
  ).split('.');
  expect
    .soft(signature)
    .toBe(
      createHmac('sha256', DEV_PASS_SECRET_YAWELO)
        .update(payload)
        .digest('base64url'),
    );
  const { host, exp } = JSON.parse(
    Buffer.from(payload, 'base64url').toString('utf8'),
  ) as { host: string; exp: number };
  expect.soft(host).toBe('dev.yaweloidle.com');
  expect.soft(exp - Date.now() / 1000).toBeGreaterThan(0);
  expect.soft(exp - Date.now() / 1000).toBeLessThanOrEqual(60);

  // ShyTalk's secret is not bound here: it fails closed, unsigned nowhere.
  const missing = await request.get('/go/shytalk', { maxRedirects: 0 });
  expect.soft(missing.status()).toBe(503);
  expect.soft(missing.headers()['location']).toBeUndefined();
});

import { test, expect } from '@playwright/test';
import { LEGACY_REDIRECTS } from '../legacy-redirect';
import { robotsDirectives } from '../robots-directives';
import { BASE_URL } from './local.mjs';

// The non-prod gate, `functions/_middleware.js`, proven before the merge
// (#394). `wrangler pages dev` serves dist/ with the real Functions on
// 127.0.0.1, which is not the prod host, so the gate runs here exactly as it
// does on dev.shyden.co.uk. dev-sanity checks the deployed site's own gate.

const NO_INDEX = 'noindex, nofollow, noarchive';

test('a visitor without the password meets the gate', async () => {
  // Raw fetch, NOT the `request` fixture: that inherits the config's
  // httpCredentials and would authenticate, so a missing gate would pass.
  const anonymous = await fetch(`${BASE_URL}/`, { redirect: 'manual' });
  expect.soft(anonymous.status).toBe(401);
  expect
    .soft(anonymous.headers.get('www-authenticate'))
    .toMatch(/^Basic realm=/);
  expect.soft(anonymous.headers.get('x-robots-tag')).toBe(NO_INDEX);

  const wrong = await fetch(`${BASE_URL}/`, {
    redirect: 'manual',
    headers: { Authorization: `Basic ${btoa('dev:not-the-password')}` },
  });
  expect.soft(wrong.status).toBe(401);

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
});

test('a visitor with the password is let through, marked noindex', async ({
  request,
}) => {
  const page = await request.get('/', { maxRedirects: 0 });
  expect.soft(page.status()).toBe(200);
  expect.soft(page.headers()['x-robots-tag']).toBe(NO_INDEX);
  expect.soft(page.headers()['www-authenticate']).toBeUndefined();
});

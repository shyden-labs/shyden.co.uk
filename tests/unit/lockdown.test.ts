import { describe, it, expect } from 'vitest';
import {
  isProdHostname,
  wwwRedirectLocation,
  legacyPathRedirectLocation,
  PREFIXED_LOCALE_CODES,
  shouldServeBlockingRobots,
  blockingRobotsBody,
  noIndexHeaderValue,
  basicAuthOk,
  basicAuthChallenge,
} from '../../functions/_lib/lockdown.js';
import { onRequest } from '../../functions/_middleware.js';
import { PREFIXED_LOCALES } from '../../src/lib/i18n';
import { robotsDirectives } from '../robots-directives';

// Base64 a "user:password" credential the way a browser's Basic-auth
// header does — Node's Buffer here, atob/btoa at the Cloudflare edge.
const cred = (user: string, pass: string) =>
  `Basic ${Buffer.from(`${user}:${pass}`).toString('base64')}`;

describe('isProdHostname — exact, case-insensitive, fail-safe', () => {
  it.each(['shyden.co.uk', 'SHYDEN.CO.UK', 'Shyden.Co.Uk'])(
    'accepts the prod apex %j (DNS is case-insensitive)',
    (h) => expect(isProdHostname(h)).toBe(true),
  );
  it.each([
    'dev.shyden.co.uk', // the dev subdomain — must be treated as non-prod
    'shyden-site-dev.pages.dev', // the Pages preview host
    'www.shyden.co.uk', // www is NOT the prod apex (update here if that changes)
    'shyden.co.uk.evil.com', // near-miss suffix attack must not trip the gate
    'notshyden.co.uk',
    '',
  ])('rejects non-prod / near-miss host %j', (h) =>
    expect(isProdHostname(h)).toBe(false),
  );
  it.each([null, undefined, 42, {}])(
    'rejects non-string input %p (no throw)',
    (h) => expect(isProdHostname(h as unknown as string)).toBe(false),
  );
});

describe('wwwRedirectLocation — www → apex, 301, before auth', () => {
  it('redirects the www host to the bare apex, preserving path + query', () => {
    expect(wwwRedirectLocation(new URL('https://www.shyden.co.uk/'))).toBe(
      'https://shyden.co.uk/',
    );
    expect(
      wwwRedirectLocation(new URL('https://www.shyden.co.uk/glory-points?x=1')),
    ).toBe('https://shyden.co.uk/glory-points?x=1');
  });
  it('is case-insensitive on the host (DNS is)', () => {
    expect(wwwRedirectLocation(new URL('https://WWW.SHYDEN.CO.UK/a'))).toBe(
      'https://shyden.co.uk/a',
    );
  });
  it.each([
    'https://shyden.co.uk/', // the apex itself must NOT redirect (no loop)
    'https://dev.shyden.co.uk/', // dev is handled by the auth gate, not here
    'https://shyden-site.pages.dev/', // preview host
    'https://www.shyden.co.uk.evil.com/', // near-miss suffix must not match
  ])('returns null for non-www host %j', (u) =>
    expect(wwwRedirectLocation(new URL(u))).toBeNull(),
  );
  it.each([null, undefined, 42, {}])(
    'returns null (no throw) for non-URL input %p',
    (bad) => expect(wwwRedirectLocation(bad as unknown as URL)).toBeNull(),
  );
});

describe('shouldServeBlockingRobots', () => {
  it('is false on prod, true everywhere else', () => {
    expect(shouldServeBlockingRobots('shyden.co.uk')).toBe(false);
    expect(shouldServeBlockingRobots('dev.shyden.co.uk')).toBe(true);
  });
});

describe('blockingRobotsBody', () => {
  it('disallows all crawling', () => {
    // Every directive, whole: `Disallow: /private` contains `Disallow: /`.
    expect(robotsDirectives(blockingRobotsBody())).toEqual([
      'User-agent: *',
      'Disallow: /',
    ]);
  });
});

describe('noIndexHeaderValue', () => {
  it('is the full noindex directive', () => {
    expect(noIndexHeaderValue()).toBe('noindex, nofollow, noarchive');
  });
});

describe('basicAuthOk — FAILS CLOSED', () => {
  it.each<[string | null | undefined, string]>([
    ['', 'empty password (env var unset) must never open the gate'],
    [undefined, 'undefined password fails closed'],
    [null, 'null password fails closed'],
  ])('rejects when expectedPassword is %j — %s', (pw) =>
    expect(basicAuthOk(cred('u', 'anything'), pw as unknown as string)).toBe(
      false,
    ),
  );
  it.each<[string | null | undefined, string]>([
    [null, 'null header'],
    [undefined, 'undefined header'],
    ['', 'empty header'],
    ['Bearer abc', 'wrong scheme'],
    ['Basic ', 'empty credential'],
    ['Basic ' + Buffer.from('nocolon').toString('base64'), 'no colon'],
    [
      'Basic @@@not-valid-base64@@@',
      'undecodable base64 (atob throws → catch)',
    ],
  ])('rejects %s', (header) =>
    expect(basicAuthOk(header as unknown as string, 'secret')).toBe(false),
  );
  it('rejects a wrong password', () => {
    expect(basicAuthOk(cred('user', 'wrong'), 'secret')).toBe(false);
  });
  it('accepts the correct password', () => {
    expect(basicAuthOk(cred('user', 'secret'), 'secret')).toBe(true);
  });
  it('ignores the username half (any user, empty user)', () => {
    expect(basicAuthOk(cred('anyone', 'secret'), 'secret')).toBe(true);
    expect(basicAuthOk(cred('', 'secret'), 'secret')).toBe(true);
  });
  it('accepts a password that itself contains a colon', () => {
    expect(basicAuthOk(cred('user', 'a:b:c'), 'a:b:c')).toBe(true);
  });
});

describe('basicAuthChallenge', () => {
  it('is a 401 that prompts the browser and stays unindexed', () => {
    const res = basicAuthChallenge();
    expect(res.status).toBe(401);
    expect(res.headers.get('WWW-Authenticate')).toMatch(/^Basic realm=/);
    expect(res.headers.get('X-Robots-Tag')).toBe(noIndexHeaderValue());
  });
});

// #635: the Glory Points page moved to /yeetalk-calculators. The old address
// answers 301 from the Pages middleware, locale prefix and query kept, landing
// on the calculator the bookmark was for. Every prefix and slash form is its
// own generated test (one test per case).
describe('legacyPathRedirectLocation: /glory-points to /yeetalk-calculators', () => {
  const FRAGMENT = '#glory-points';
  const prefixes = ['', ...PREFIXED_LOCALES.map((l) => `/${l}`)];
  const origins = ['https://shyden.co.uk', 'https://dev.shyden.co.uk'];

  describe.each(prefixes)('prefix %j', (prefix) => {
    it.each(['', '/'])(`${prefix}/glory-points%j redirects`, (slash) => {
      expect(
        legacyPathRedirectLocation(
          new URL(`https://shyden.co.uk${prefix}/glory-points${slash}`),
        ),
      ).toBe(`${prefix}/yeetalk-calculators${FRAGMENT}`);
    });
    it(`${prefix}/glory-points keeps the query string`, () => {
      expect(
        legacyPathRedirectLocation(
          new URL(`https://shyden.co.uk${prefix}/glory-points?x=1&y=2`),
        ),
      ).toBe(`${prefix}/yeetalk-calculators?x=1&y=2${FRAGMENT}`);
    });
  });

  it.each(origins)('redirects on %s too (host is not consulted)', (origin) => {
    expect(legacyPathRedirectLocation(new URL(`${origin}/glory-points`))).toBe(
      `/yeetalk-calculators${FRAGMENT}`,
    );
  });

  it.each([
    '/glory-pointsX',
    '/glory-points/extra',
    '/id/glory-points/extra',
    '/id/glory-pointsX',
    '/xx/glory-points',
    '/en/glory-points',
    '/id/id/glory-points',
    '/yeetalk-calculators',
    '/id/yeetalk-calculators',
    '/',
    '/classroom-groups',
    '/x/glory-points',
    '/Glory-Points',
    '//glory-points',
  ])('returns null for %j', (path) => {
    expect(
      legacyPathRedirectLocation(new URL(`https://shyden.co.uk${path}`)),
    ).toBeNull();
  });

  it.each([null, undefined, 42, {}])(
    'returns null (no throw) for non-URL input %p',
    (bad) =>
      expect(legacyPathRedirectLocation(bad as unknown as URL)).toBeNull(),
  );

  it('keeps its written-out locale list equal to PREFIXED_LOCALES, in order', () => {
    expect(PREFIXED_LOCALE_CODES).toEqual([...PREFIXED_LOCALES]);
  });
});

describe('the middleware answers the legacy path before the auth gate', () => {
  const never = () => {
    throw new Error('next() must not be reached for a redirected path');
  };
  it.each([
    [
      'https://dev.shyden.co.uk/glory-points',
      '/yeetalk-calculators#glory-points',
    ],
    ['https://shyden.co.uk/glory-points', '/yeetalk-calculators#glory-points'],
    [
      'https://dev.shyden.co.uk/th/glory-points/?x=1',
      '/th/yeetalk-calculators?x=1#glory-points',
    ],
  ])('%s answers 301 with no credentials', async (href, location) => {
    const res = await onRequest({
      request: new Request(href),
      env: { DEV_PASSWORD: 'secret' },
      next: never as () => Promise<Response>,
    });
    expect(res.status).toBe(301);
    expect(res.headers.get('Location')).toBe(location);
  });
  it('still challenges a dev path that is not legacy', async () => {
    const res = await onRequest({
      request: new Request('https://dev.shyden.co.uk/classroom-groups'),
      env: { DEV_PASSWORD: 'secret' },
      next: never as () => Promise<Response>,
    });
    expect(res.status).toBe(401);
  });
});

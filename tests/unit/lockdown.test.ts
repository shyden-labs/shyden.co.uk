import { describe, it, expect } from 'vitest';
import {
  isProdHostname,
  wwwRedirectLocation,
  legacyPathRedirectLocation,
  PREFIXED_LOCALE_CODES,
  blockingRobotsBody,
  noIndexHeaderValue,
} from '../../functions/_lib/lockdown.js';
import { onRequest } from '../../functions/_middleware.js';
import { PREFIXED_LOCALES } from '../../src/lib/i18n';
import { robotsDirectives } from '../robots-directives';

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

describe('the middleware answers the legacy path before the DEV pass gate', () => {
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
  ])('%s answers 301 with no pass', async (href, location) => {
    const res = await onRequest({
      request: new Request(href),
      env: {},
      next: never as () => Promise<Response>,
    });
    expect(res.status).toBe(301);
    expect(res.headers.get('Location')).toBe(location);
  });
  it('still refuses a dev path that is not legacy', async () => {
    const res = await onRequest({
      request: new Request('https://dev.shyden.co.uk/classroom-groups'),
      env: {},
      next: never as () => Promise<Response>,
    });
    expect(res.status).toBe(401);
  });
});

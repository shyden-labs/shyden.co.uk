import { test, expect } from './fixtures';
import { LOCALE_METADATA } from '../../src/lib/i18n/metadata';
import { LOCALES, localisePath } from '../../src/lib/i18n/index';
import { filesUnder, searched } from '../source-files';
import { readFileSync } from 'node:fs';
import { parse } from 'yaml';

/**
 * The hreflang set every page in the sitemap must declare.
 *
 * Derived from `LOCALE_METADATA.ogLocale` (`en_GB` -> `en-GB`) rather than a
 * second table: that table exists precisely because five separate places used
 * to decide what a locale meant, and each was silently correct for two
 * languages and wrong for the third.
 */
const EXPECTED_ALTERNATES = LOCALES.map((locale) =>
  LOCALE_METADATA[locale].ogLocale.replace('_', '-'),
).sort();
test.describe('the sitemap', () => {
  test('lists every page and pairs the two languages', async ({ request }) => {
    // Nothing tested the sitemap's CONTENTS: seo.spec.ts only checked that
    // robots.txt mentions it. A dropped page or a lost locale went unnoticed.
    const xml = await (await request.get('/sitemap-0.xml')).text();
    const locs = [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) =>
      new URL(m[1]).pathname.replace(/\/$/, ''),
    );

    // Every page the build wrote, not a list. The guards that visit "every
    // published page" generate one test per entry of PUBLISHED_ROUTES, which
    // rendered-text.spec.ts holds to this sitemap (#422), so this is the one
    // check that the sitemap is complete; a hand-written
    // list of three pages could only agree with itself, and a fourth page
    // the sitemap left out would have been invisible to all of them (#390
    // F126). The 404 and the API docs (#781) are the pages deliberately left
    // out. Read here, not at module scope: the web server rebuilds dist/
    // after this file loads.
    const built = filesUnder('dist', (path) => /\.html$/.test(path))
      .filter((path) => path !== 'dist/404.html')
      .filter((path) => !path.startsWith('dist/api/docs/'))
      .map((path) => path.replace(/^dist/, '').replace(/\/?index\.html$/, ''));
    expect(locs.sort()).toEqual(built.sort());

    // And every page in every locale is among them: a hand-written list of
    // six was correct for two languages and silently wrong the moment #22
    // added three more.
    for (const locale of LOCALES)
      for (const page of ['/', '/classroom-groups', '/yeetalk-calculators'])
        expect(built).toContain(localisePath(page, locale).replace(/\/$/, ''));
  });

  test('declares the language relationships search engines need', async ({
    request,
  }) => {
    // @astrojs/sitemap reads its OWN i18n option; the routing config in
    // astro.config.mjs is not inherited. Without it the file carried six
    // <loc> entries and zero alternates, so the English and Indonesian
    // versions of a page looked like unrelated near-duplicates.
    const xml = await (await request.get('/sitemap-0.xml')).text();
    expect(xml).toContain('xhtml:link');

    // Asserted PER <url>, against a set derived from LOCALE_METADATA.
    //
    // This read `toContain('hreflang="en-GB"')` and `id-ID` — two names
    // written by hand, matched anywhere in the file, agreeing with a config
    // that also named those two by hand. Two hand-written lists agreeing with
    // each other is not a check: nine of fifteen URLs (`/zh/*`, `/vi/*`,
    // `/th/*`) carried NO alternates at all and it passed. See #108, and #104
    // for the same drift in the 404.
    const blocks = xml.match(/<url>[\s\S]*?<\/url>/g) ?? [];
    expect(
      blocks.length,
      'no <url> blocks — the parse is broken',
    ).toBeGreaterThan(0);
    const short = (url: string) => url.replace('https://shyden.co.uk', '');
    const wrong = blocks
      .map((block) => ({
        loc: short(/<loc>([^<]*)<\/loc>/.exec(block)?.[1] ?? '?'),
        langs: [...block.matchAll(/hreflang="([^"]+)"/g)]
          .map((m) => m[1])
          .sort(),
      }))
      .filter((u) => u.langs.join() !== EXPECTED_ALTERNATES.join())
      .map((u) => `${u.loc} -> ${u.langs.join(',') || 'NONE'}`);
    expect(
      searched(wrong, { of: blocks, what: 'sitemap <url> blocks' }),
      `expected every page to declare ${EXPECTED_ALTERNATES.join(',')}`,
    ).toEqual([]);

    // Each entry pairs with its own translation, not with the homepage.
    const groups = xml.split('<url>').slice(1);
    const tool = groups.find((g) =>
      g.includes('<loc>https://shyden.co.uk/classroom-groups/</loc>'),
    );
    expect(tool).toBeDefined();
    expect(tool).toContain('href="https://shyden.co.uk/id/classroom-groups/"');
  });
});

// The API docs head (#781) is read on each docs page's walk: checks/head.ts (#1086).

test.describe('each API spec is served only inside its own page (#781)', () => {
  // The private spec has no URL of its own: it reaches visitors only inside
  // the page the middleware gates. A spec imported by a script would land in
  // a public /_astro/ chunk instead, so every built file is read.
  for (const [spec, page] of [
    ['openapi/report.yaml', 'dist/api/docs/index.html'],
    ['openapi/report-health.yaml', 'dist/api/docs/private/index.html'],
  ] as const)
    test(`${spec} appears in ${page} and nowhere else`, () => {
      const said = (
        parse(readFileSync(spec, 'utf8')) as { info: { description: string } }
      ).info.description.slice(0, 40);
      const built = filesUnder('dist', () => true);
      const holding = built.filter((path) =>
        readFileSync(path, 'latin1').includes(said),
      );
      // Equality with one page: a read that saw nothing fails as surely as a
      // spec that leaked.
      expect(holding).toEqual([page]);
    });
});

// The 404 head, and a real page's, are read on their walks: checks/head.ts (#1086).

// Every published page's viewport meta is read on its walk: checks/head.ts (#1086).

// Moved from tests/device/real-device.spec.ts (#1049): the fixture is built apart from the
// `browser`/`context` overrides, so every target measures that it still resolves `baseURL`.
test('the bare request fixture resolves a relative URL against baseURL', async ({
  request,
}) => {
  // Moved from tests/device/real-device.spec.ts (#1049): the fixture is built apart from the
  // `browser`/`context` overrides, so every target measures that it still resolves `baseURL`.
  const res = await request.get('/sitemap-0.xml');
  expect(
    res.ok(),
    `expected the bare \`request\` fixture to resolve '/sitemap-0.xml' against baseURL and ` +
      `return 2xx -- got HTTP ${res.status()}`,
  ).toBe(true);
  expect(
    await res.text(),
    'expected a <loc> entry for a known page in the sitemap body, not an empty or unrelated response',
  ).toContain('<loc>https://shyden.co.uk/classroom-groups/</loc>');
});

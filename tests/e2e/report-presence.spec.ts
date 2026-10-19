import { readFileSync } from 'node:fs';
import { test, expect } from './fixtures';
import { filesUnder, searched } from '../source-files';
import {
  PREFIXED_LOCALES,
  getSiteStrings,
  isBetaLocale,
  isLocale,
} from '../../src/lib/i18n';
import {
  FOOTER_PAGE_IDS,
  pagePath,
  reportOptions,
  type Outcome,
} from '../../src/lib/report';

/**
 * The report form's presence and contents, read from what was built (#97,
 * spec 3.2 and 10). Derived from dist/, so a page added later is judged the
 * day it is built, and English is covered by the same walk that covers the
 * beta locales. Read inside the test, never at module scope: Playwright loads
 * this file before its web server rebuilds dist/, so a module-scope read
 * would judge the previous build, and a mutation would never reach it.
 */
const built = () =>
  filesUnder('dist', (path) => /\.html$/.test(path)).map((file) => ({
    file,
    html: readFileSync(file, 'utf8'),
  }));
/** The footer's markup: the 404 carries forms in its body, never its footer. */
const footerOf = (html: string) =>
  /<footer\b[\s\S]*?<\/footer>/.exec(html)?.[0] ?? '';
const langOf = (html: string) => /<html[^>]*\slang="([^"]+)"/.exec(html)?.[1];

test('a built page with a footer carries the form exactly when its locale is beta', () => {
  const footed = built().filter(({ html }) => html.includes('<footer'));
  const findings = footed.flatMap(({ file, html }) => {
    const lang = langOf(html);
    const want = isLocale(lang) && isBetaLocale(lang);
    const has = footerOf(html).includes('data-report-form');
    return has === want ? [] : [`${file}: lang=${lang} form=${has}`];
  });
  expect(
    searched(findings, {
      of: footed.map(({ file }) => file),
      what: 'built pages with a footer',
    }),
  ).toEqual([]);
  expect(
    footed.filter(({ html }) => footerOf(html).includes('data-report-form'))
      .length,
  ).toBeGreaterThan(0);
});

for (const locale of PREFIXED_LOCALES)
  for (const page of FOOTER_PAGE_IDS)
    test(`${pagePath(page, locale)}: the type-ahead offers exactly this page's strings`, async ({
      page: tab,
    }) => {
      await tab.goto(pagePath(page, locale));
      const offered = await tab
        .locator('footer [data-report-strings] option')
        .evaluateAll((options) =>
          options.map((option) => (option as HTMLOptionElement).value),
        );
      expect(new Set(offered)).toEqual(new Set(reportOptions(page, locale)));
      expect(offered.length).toBe(reportOptions(page, locale).length);
    });

// A Record, so an outcome added to the union without its copy fails to
// compile; the list is the Record's keys.
const COPY: Record<
  Outcome,
  'sent' | 'notFound' | 'rejected' | 'failed' | 'formFull' | 'connectionFull'
> = {
  sent: 'sent',
  'not-found': 'notFound',
  rejected: 'rejected',
  failed: 'failed',
  'form-full': 'formFull',
  'connection-full': 'connectionFull',
};
const OUTCOMES = Object.keys(COPY) as Outcome[];

for (const locale of PREFIXED_LOCALES)
  for (const outcome of OUTCOMES)
    test(`${locale}: #report-${outcome} shows, takes focus, and hides the rest`, async ({
      page,
    }) => {
      await page.goto(`${pagePath('home', locale)}#report-${outcome}`);
      const shown = page.locator(`#report-${outcome}`);
      await expect(shown).toBeVisible();
      await expect(shown).toHaveText(
        getSiteStrings(locale).report[COPY[outcome]],
      );
      await expect(shown).toHaveAttribute('role', 'status');
      await expect(shown).toBeFocused();
      for (const other of OUTCOMES.filter((o) => o !== outcome)) {
        await expect(page.locator(`#report-${other}`)).toHaveCount(1);
        await expect(page.locator(`#report-${other}`)).toBeHidden();
      }
    });

// One test per locale (#420).
for (const locale of PREFIXED_LOCALES)
  test(`${locale}: the disclosure sits right after the BETA notice, and asks for nothing personal`, async ({
    page,
  }) => {
    await page.goto(pagePath('home', locale));
    // AC2: beside the BETA notice, not merely somewhere in the footer.
    await expect(
      page.locator('[data-beta-notice] + details[data-report]'),
    ).toHaveCount(1);
    // AC6: no contact fields. Exactly the fields spec 3.2 names, so a field
    // added later has to be argued for here.
    const named = await page
      .locator('[data-report-form] [name]')
      .evaluateAll((els) => els.map((el) => el.getAttribute('name')));
    expect(named, locale).toEqual([
      'locale',
      'page',
      'quote',
      'suggestion',
      'note',
      'website',
    ]);
  });

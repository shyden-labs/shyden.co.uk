/**
 * The report form on the real iPhone: every test tests/e2e/report-presence.spec.ts
 * and report-completeness.spec.ts run on the real Android phone, under the
 * same titles with an `iOS mirror:` prefix (#804; global rule 2026-10-15,
 * every test mirrored, no exceptions). not-found-report.spec.ts presses keys
 * and report-form.spec.ts stubs the network (`page.route`): both wait for
 * #811, listed in `.superpowers/sdd/804/plan.md`, not exempt.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, test } from 'vitest';
import { catalogueLeaves } from '../../../src/lib/catalogue-leaves';
import {
  getSiteStrings,
  isBetaLocale,
  isLocale,
  PREFIXED_LOCALES,
  rawCatalogue,
  type Locale,
} from '../../../src/lib/i18n';
import { isMessageTemplate } from '../../../src/lib/i18n/message';
import { LOCALE_METADATA } from '../../../src/lib/i18n/metadata';
import {
  FOOTER_PAGE_IDS,
  normalise,
  pagePath,
  reportOptions,
  type Outcome,
} from '../../../src/lib/report';
import { floorBreach } from '../../floors';
import { filesUnder, searched } from '../../source-files';
import { attributesOf, countOf, textsOf, visibilityOf } from './dom';
import { holdIosSession } from './held-session';
import { announceMode } from './session';

const phone = holdIosSession();

const built = () =>
  filesUnder('dist', (path) => /\.html$/.test(path)).map((file) => ({
    file,
    html: readFileSync(file, 'utf8'),
  }));
const footerOf = (html: string) =>
  /<footer\b[\s\S]*?<\/footer>/.exec(html)?.[0] ?? '';
const langOf = (html: string) => /<html[^>]*\slang="([^"]+)"/.exec(html)?.[1];

describe('iOS mirror: the report form is where it should be', () => {
  test('iOS mirror: a built page with a footer carries the form exactly when its locale is beta', () => {
    // Reads the build the iPhone is served (`dist/`), as Android's run reads
    // the build it is served: the same bytes, judged the same way.
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
    expect(
      floorBreach('ios-report/footed-pages', footed.length),
    ).toBeUndefined();
  });

  for (const locale of PREFIXED_LOCALES)
    for (const page of FOOTER_PAGE_IDS)
      test(`iOS mirror: ${pagePath(page, locale)}: the type-ahead offers exactly this page's strings`, async () => {
        announceMode(phone(), `report type-ahead (${pagePath(page, locale)})`);
        await phone().navigateToPath(pagePath(page, locale), 'footer');
        const offered = await attributesOf(
          phone().driver,
          'footer [data-report-strings] option',
          'value',
        );
        expect(new Set(offered)).toEqual(new Set(reportOptions(page, locale)));
        expect(offered.length).toBe(reportOptions(page, locale).length);
      });

  const OUTCOMES: readonly Outcome[] = [
    'sent',
    'not-found',
    'rejected',
    'failed',
  ];
  const COPY: Record<Outcome, 'sent' | 'notFound' | 'rejected' | 'failed'> = {
    sent: 'sent',
    'not-found': 'notFound',
    rejected: 'rejected',
    failed: 'failed',
  };

  for (const locale of PREFIXED_LOCALES)
    for (const outcome of OUTCOMES)
      test(`iOS mirror: ${locale}: #report-${outcome} shows, takes focus, and hides the rest`, async () => {
        announceMode(phone(), `report outcome ${outcome} (${locale})`);
        await phone().navigateToPath(
          `${pagePath('home', locale)}#report-${outcome}`,
          'footer',
        );
        const shown = `#report-${outcome}`;
        expect(await visibilityOf(phone().driver, shown)).toEqual([true]);
        expect(await textsOf(phone().driver, shown)).toEqual([
          getSiteStrings(locale).report[COPY[outcome]],
        ]);
        expect(await attributesOf(phone().driver, shown, 'role')).toEqual([
          'status',
        ]);
        expect(
          await phone().driver.executeScript<string>(
            'return document.activeElement?.id ?? "";',
          ),
          `${shown} takes focus`,
        ).toBe(`report-${outcome}`);
        for (const other of OUTCOMES.filter((o) => o !== outcome)) {
          expect(await countOf(phone().driver, `#report-${other}`)).toBe(1);
          expect(
            await visibilityOf(phone().driver, `#report-${other}`),
          ).toEqual([false]);
        }
      });

  for (const locale of PREFIXED_LOCALES)
    test(`iOS mirror: ${locale}: the disclosure sits right after the BETA notice, and asks for nothing personal`, async () => {
      announceMode(phone(), `report disclosure (${locale})`);
      await phone().navigateToPath(pagePath('home', locale), 'footer');
      expect(
        await countOf(
          phone().driver,
          '[data-beta-notice] + details[data-report]',
        ),
      ).toBe(1);
      expect(
        await attributesOf(phone().driver, '[data-report-form] [name]', 'name'),
        locale,
      ).toEqual(['locale', 'page', 'quote', 'suggestion', 'note', 'website']);
    });
});

const NOT_CATALOGUE_COPY = Object.values(LOCALE_METADATA).map(
  ({ nativeName }) => nativeName,
);

/** Every plain catalogue string for `locale`, normalised, as Android's spec builds it. */
function plainCatalogueTexts(locale: Locale): string[] {
  const english = new Map(catalogueLeaves(rawCatalogue('en')));
  const tool = catalogueLeaves(rawCatalogue(locale)).filter(([key, value]) => {
    const reference = english.get(key);
    return (
      typeof value === 'string' &&
      !(
        typeof reference === 'string' &&
        !key.includes('[') &&
        isMessageTemplate(reference)
      )
    );
  });
  const site = catalogueLeaves(getSiteStrings(locale)).filter(
    ([key, value]) => typeof value === 'string' && !key.startsWith('notFound.'),
  );
  return [
    ...new Set(
      [...tool, ...site].map(([, value]) => normalise(value as string, locale)),
    ),
  ].filter((text) => text.length > 0);
}

describe('iOS mirror: every catalogue string is reportable', () => {
  for (const locale of PREFIXED_LOCALES)
    for (const pageId of FOOTER_PAGE_IDS)
      test(`iOS mirror: ${pagePath(pageId, locale)}: every catalogue string on the page is reportable there`, async () => {
        announceMode(
          phone(),
          `report completeness (${pagePath(pageId, locale)})`,
        );
        await phone().navigateToPath(pagePath(pageId, locale), 'footer');
        await phone().driver.executeScript(
          `for (const toggle of document.querySelectorAll('[aria-expanded="false"][aria-controls]')) toggle.click();
           for (const details of document.querySelectorAll('details')) details.open = true;`,
        );
        const rendered = await phone().driver.executeScript<string[]>(
          `const texts = [];
           const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
           for (let node = walker.nextNode(); node; node = walker.nextNode()) {
             const parent = node.parentElement;
             if (parent && parent.checkVisibility() && node.textContent?.trim()) texts.push(node.textContent);
           }
           for (const select of document.querySelectorAll('select'))
             if (select.checkVisibility())
               for (const option of select.options) if (option.text.trim()) texts.push(option.text);
           return texts;`,
        );
        const onPage = new Set(rendered.map((text) => normalise(text, locale)));
        const offered = new Set(
          reportOptions(pageId, locale).map((option) =>
            normalise(option, locale),
          ),
        );
        const elsewhere = new Set(
          NOT_CATALOGUE_COPY.map((text) => normalise(text, locale)),
        );
        const found = plainCatalogueTexts(locale).filter(
          (text) => onPage.has(text) && !elsewhere.has(text),
        );
        expect(
          searched(
            found.filter((text) => !offered.has(text)),
            { of: found, what: 'catalogue strings rendered on the page' },
          ),
        ).toEqual([]);
        // The strings found, as a floor recorded on the phone (#804): one id
        // per page and language, spelled whole, since each language renders
        // its own copy. Android's copy of this search has no floor.
        const floors: Record<string, () => string | undefined> = {
          'home id': () => floorBreach('ios-report/home-id', found.length),
          'home zh': () => floorBreach('ios-report/home-zh', found.length),
          'home vi': () => floorBreach('ios-report/home-vi', found.length),
          'home th': () => floorBreach('ios-report/home-th', found.length),
          'yeetalk-calculators id': () =>
            floorBreach('ios-report/glory-points-id', found.length),
          'yeetalk-calculators zh': () =>
            floorBreach('ios-report/glory-points-zh', found.length),
          'yeetalk-calculators vi': () =>
            floorBreach('ios-report/glory-points-vi', found.length),
          'yeetalk-calculators th': () =>
            floorBreach('ios-report/glory-points-th', found.length),
          'classroom-groups id': () =>
            floorBreach('ios-report/classroom-groups-id', found.length),
          'classroom-groups zh': () =>
            floorBreach('ios-report/classroom-groups-zh', found.length),
          'classroom-groups vi': () =>
            floorBreach('ios-report/classroom-groups-vi', found.length),
          'classroom-groups th': () =>
            floorBreach('ios-report/classroom-groups-th', found.length),
        };
        const floor = floors[`${pageId} ${locale}`];
        expect(floor, `${pageId} ${locale} has a floor`).toBeDefined();
        expect(floor!()).toBeUndefined();
      });
});

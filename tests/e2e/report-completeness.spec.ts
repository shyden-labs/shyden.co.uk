import { tapOn } from '../real-touch';
import { test, expect } from './fixtures';
import { recorded } from './evidence';

/** More real taps than any page has disclosures: past it, one never opens. */
const OPEN_CEILING = 40;
import { searched } from '../source-files';
import { catalogueLeaves } from '../../src/lib/catalogue-leaves';
import {
  PREFIXED_LOCALES,
  getSiteStrings,
  rawCatalogue,
  type Locale,
} from '../../src/lib/i18n';
import {
  FOOTER_PAGE_IDS,
  normalise,
  pagePath,
  reportOptions,
} from '../../src/lib/report';
import { isMessageTemplate } from '../../src/lib/i18n/message';
import { LOCALE_METADATA } from '../../src/lib/i18n/metadata';

test.use(recorded);

/**
 * Every catalogue string a visitor can see on a page is one that page offers
 * to report (#97, spec 10). Read from the RENDERED DOM after the page's
 * script has run: the tool strings arrive by script, so a static read of the
 * HTML would never find one and pass for nothing (spec review pass 3).
 * Compared by text, not key, because the same words can live under two keys
 * and the visitor picks words. Text the page draws from somewhere other than
 * a catalogue is left out, derived from its source: the language switcher's
 * endonyms come from LOCALE_METADATA, and each locale's own also sits in the
 * tool catalogue's `csvLanguageName`, so on a page without the tool it read
 * as a tool string left unoffered (measured in review pass 4).
 */
const NOT_CATALOGUE_COPY = Object.values(LOCALE_METADATA).map(
  ({ nativeName }) => nativeName,
);
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

for (const locale of PREFIXED_LOCALES)
  for (const pageId of FOOTER_PAGE_IDS)
    test(`${pagePath(pageId, locale)}: every catalogue string on the page is reportable there`, async ({
      page,
    }) => {
      await page.goto(pagePath(pageId, locale));
      // Every disclosure open, read from the DOM: a visitor can open any of
      // them, and a closed one's words fail checkVisibility below. Opening
      // the students section alone left the grouping, files and sound
      // sections and the report form itself unread (RC1). Each is opened by
      // a real tap, as a visitor opens it (#1003), re-read after every tap
      // so a disclosure inside one just opened is found too. A closed one no
      // visitor can see has no visible words to check either. Last in the
      // page first: the header's language list drops over what follows it
      // (it covered a toggle on /zh/classroom-groups), and no visitor taps
      // beneath an open list, so the header's own are opened last.
      const closed = page.locator(
        '[aria-expanded="false"][aria-controls]:visible, details:not([open]) > summary:visible',
      );
      for (let opened = 0; (await closed.count()) > 0; opened++) {
        if (opened >= OPEN_CEILING)
          throw new Error(
            `${await closed.count()} disclosures still closed after ${OPEN_CEILING} real taps: one does not open when tapped`,
          );
        await tapOn(closed.last());
      }
      const rendered = await page.evaluate(() => {
        const texts: string[] = [];
        const walker = document.createTreeWalker(
          document.body,
          NodeFilter.SHOW_TEXT,
        );
        for (let node = walker.nextNode(); node; node = walker.nextNode()) {
          const parent = node.parentElement;
          if (parent && parent.checkVisibility() && node.textContent?.trim())
            texts.push(node.textContent);
        }
        // An option has no box of its own, so it never passes
        // checkVisibility, yet a visitor reads every one in the open list
        // (RC3): each visible select's options are read too.
        for (const select of document.querySelectorAll('select'))
          if (select.checkVisibility())
            for (const option of select.options)
              if (option.text.trim()) texts.push(option.text);
        return texts;
      });
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
      const missing = found.filter((text) => !offered.has(text));
      expect(
        searched(missing, {
          of: found,
          what: 'catalogue strings rendered on the page',
        }),
      ).toEqual([]);
    });

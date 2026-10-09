import { describe, expect, it } from 'vitest';
import {
  FOOTER_PAGE_IDS,
  PAGE_IDS,
  isPageId,
  matchesForm,
  matchingKeys,
  normalise,
  pageIdFromPath,
  pagePath,
  reportOptions,
  reportIdStem,
  reportableStrings,
  type PageId,
} from '../../src/lib/report';
import {
  LOCALES,
  PREFIXED_LOCALES,
  getSiteStrings,
  isBetaLocale,
  rawCatalogue,
  type Locale,
} from '../../src/lib/i18n';
import { isMessageTemplate } from '../../src/lib/i18n/message';
import { catalogueLeaves } from '../../src/lib/catalogue-leaves';
import { renderedOn } from '../../src/lib/i18n/label-check';
import { nonEmpty } from '../source-files';

const ELLIPSIS = String.fromCharCode(0x2026);
const keysOn = (page: PageId, locale: Locale) =>
  new Set(reportableStrings(page, locale).map(({ key }) => key));
const siteLeafKeys = (locale: Locale, section: string) =>
  catalogueLeaves(
    (getSiteStrings(locale) as Record<string, unknown>)[section],
    `site.${section}`,
  )
    .filter(([, value]) => typeof value === 'string')
    .map(([key]) => key);

describe('the page table', () => {
  it('knows the three pages with a footer, and the 404 besides', () => {
    expect(FOOTER_PAGE_IDS).toEqual([
      'home',
      'yeetalk-calculators',
      'classroom-groups',
    ]);
    expect(PAGE_IDS).toEqual([
      'home',
      'yeetalk-calculators',
      'classroom-groups',
      'not-found',
    ]);
    expect(isPageId('home')).toBe(true);
    expect(isPageId('not-found')).toBe(true);
    expect(isPageId('404')).toBe(false);
    expect(isPageId(undefined)).toBe(false);
  });

  it.each([
    ['/', 'home'],
    ['/vi/', 'home'],
    ['/vi', 'home'],
    ['/th/yeetalk-calculators', 'yeetalk-calculators'],
    ['/zh/classroom-groups/', 'classroom-groups'],
    ['/classroom-groups', 'classroom-groups'],
  ])('reads %s as %s', (path, page) => {
    expect(pageIdFromPath(path)).toBe(page);
  });

  it('reads an unknown path as no page', () => {
    expect(pageIdFromPath('/vi/nowhere')).toBeNull();
    expect(pageIdFromPath('/404')).toBeNull();
  });

  it('builds the path the site links use', () => {
    expect(pagePath('home', 'vi')).toBe('/vi/');
    expect(pagePath('classroom-groups', 'vi')).toBe('/vi/classroom-groups');
    expect(pagePath('yeetalk-calculators', 'th')).toBe(
      '/th/yeetalk-calculators',
    );
    // The 404 is one file for every locale (spec 14.3).
    expect(pagePath('not-found', 'vi')).toBe('/404');
    expect(pagePath('not-found', 'th')).toBe('/404');
  });

  it('gives the 404 one id stem per locale, and every other page one', () => {
    expect(reportIdStem('home', 'vi')).toBe('report');
    expect(reportIdStem('classroom-groups', 'th')).toBe('report');
    expect(reportIdStem('not-found', 'vi')).toBe('report-vi');
    expect(reportIdStem('not-found', 'zh')).toBe('report-zh');
  });
});

describe('a page offers its own sections plus the chrome', () => {
  it.each(PREFIXED_LOCALES)(
    '%s: home carries every leaf of site.home',
    (locale) => {
      const keys = keysOn('home', locale);
      for (const key of nonEmpty(
        siteLeafKeys(locale, 'home'),
        'site.home leaves',
      ))
        expect(keys, key).toContain(key);
    },
  );

  it.each(PREFIXED_LOCALES)(
    '%s: yeetalk-calculators carries every leaf of site.calculators and none of site.home',
    (locale) => {
      const keys = keysOn('yeetalk-calculators', locale);
      for (const key of nonEmpty(
        siteLeafKeys(locale, 'calculators'),
        'site.calculators leaves',
      ))
        expect(keys, key).toContain(key);
      expect([...keys].filter((key) => key.startsWith('site.home.'))).toEqual(
        [],
      );
    },
  );

  it.each(PREFIXED_LOCALES)(
    '%s: classroom-groups carries every string leaf of the raw tool catalogue',
    (locale) => {
      const keys = keysOn('classroom-groups', locale);
      const tool = nonEmpty(
        catalogueLeaves(rawCatalogue(locale)).filter(
          ([, v]) => typeof v === 'string',
        ),
        'tool catalogue leaves',
      );
      for (const [key] of tool) expect(keys, key).toContain(key);
    },
  );

  it('no footer page offers the 404 copy', () => {
    for (const page of FOOTER_PAGE_IDS)
      expect(
        [...keysOn(page, 'vi')].filter((key) =>
          key.startsWith('site.notFound.'),
        ),
      ).toEqual([]);
  });

  it.each(LOCALES.filter(isBetaLocale))(
    'the 404 offers the notFound copy its %s block shows, and nothing else',
    (locale) => {
      // No chrome (the 404's is English) and no title or description (a
      // document has one of each, the default locale's): spec 14.2.
      expect(keysOn('not-found', locale)).toEqual(
        new Set([
          'site.notFound.heading',
          'site.notFound.body',
          'site.notFound.backHome',
        ]),
      );
    },
  );

  it('every page carries every chrome entry, bare strings and the report section included', () => {
    const chrome = Object.keys(getSiteStrings('vi')).filter(
      (section) => !['home', 'calculators', 'notFound'].includes(section),
    );
    expect(chrome).toEqual(
      expect.arrayContaining([
        'nav',
        'language',
        'report',
        'menuLabel',
        'skipToContent',
      ]),
    );
    for (const page of FOOTER_PAGE_IDS)
      for (const section of chrome)
        for (const key of siteLeafKeys('vi', section))
          expect(keysOn(page, 'vi'), `${page} ${key}`).toContain(key);
  });

  it('agrees with label-check about which site sections are chrome', () => {
    // Two derivations of one fact: label-check's SITE_PAGES says where a
    // section is read, this module says which pages offer it. A section
    // label-check calls chrome must be on every page here, and one it gives a
    // single page must be on that page alone.
    const CHROME = renderedOn('site.nav.home');
    for (const section of Object.keys(getSiteStrings('vi'))) {
      const where = renderedOn(`site.${section}.x`);
      const pages = PAGE_IDS.filter((page) =>
        [...keysOn(page, 'vi')].some(
          (key) =>
            key === `site.${section}` || key.startsWith(`site.${section}.`),
        ),
      );
      if (where === CHROME)
        expect(pages, section).toEqual([...FOOTER_PAGE_IDS]);
      else if (where === 'the 404 page')
        expect(pages, section).toEqual(['not-found']);
      else
        expect(
          pages.map((page) => pagePath(page, 'en')),
          section,
        ).toEqual([where]);
    }
  });
});

describe('display forms', () => {
  it('gives a message one form per branch, each slot an ellipsis', () => {
    // A select, not a plural: every beta locale has only the `other` plural
    // category, so a plural there renders one form (unless it has `=n` keys).
    const english = catalogueLeaves(rawCatalogue('en'));
    const [key] = nonEmpty(
      english.filter(
        ([k, v]) =>
          !k.includes('[') && typeof v === 'string' && /,\s*select\s*,/.test(v),
      ),
      'select messages',
    )[0];
    const entry = reportableStrings('classroom-groups', 'vi').find(
      (s) => s.key === key,
    );
    expect(entry, key).toBeDefined();
    expect(entry!.forms.length).toBeGreaterThan(1);
    expect(entry!.forms.length).toBeLessThanOrEqual(3);
    for (const form of entry!.forms) {
      expect(form.display).toBe(form.runs.join(ELLIPSIS));
      expect(form.display).not.toMatch(/[{}#]/);
    }
  });

  it('never parses site copy as a message', () => {
    for (const { key, forms } of reportableStrings('home', 'vi').filter((s) =>
      s.key.startsWith('site.'),
    ))
      expect(forms, key).toHaveLength(1);
  });

  it('treats a tool string as a message exactly when its English is one', () => {
    const english = new Map(catalogueLeaves(rawCatalogue('en')));
    const tool = reportableStrings('classroom-groups', 'th').filter(
      (s) => !s.key.startsWith('site.'),
    );
    const isMessage = (key: string) => {
      const reference = english.get(key);
      return (
        !key.includes('[') &&
        typeof reference === 'string' &&
        isMessageTemplate(reference)
      );
    };
    // Both directions, each proven non-empty: plain copy is one literal form,
    // and a message never shows its template syntax.
    for (const { key, forms } of nonEmpty(
      tool.filter((s) => !isMessage(s.key)),
      'plain tool strings',
    )) {
      expect(forms, key).toHaveLength(1);
      expect(forms[0].runs, key).toHaveLength(1);
    }
    for (const { key, forms } of nonEmpty(
      tool.filter((s) => isMessage(s.key)),
      'tool messages',
    ))
      for (const form of forms) expect(form.display, key).not.toMatch(/[{}]/);
  });

  it('offers each display once, and every one of them', () => {
    const options = reportOptions('yeetalk-calculators', 'id');
    expect(new Set(options).size).toBe(options.length);
    const displays = reportableStrings('yeetalk-calculators', 'id').flatMap(
      (s) => s.forms.map((f) => f.display),
    );
    expect(new Set(options)).toEqual(new Set(displays));
  });
});

describe('normalise', () => {
  const NBSP = String.fromCharCode(0x00a0);
  const ZWSP = String.fromCharCode(0x200b);
  const BOM = String.fromCharCode(0xfeff);
  const WJ = String.fromCharCode(0x2060);
  const LSQ = String.fromCharCode(0x2018);
  const RSQ = String.fromCharCode(0x2019);
  const LDQ = String.fromCharCode(0x201c);
  const RDQ = String.fromCharCode(0x201d);
  const FULL_DQ = String.fromCharCode(0xff02);
  const FULL_SQ = String.fromCharCode(0xff07);
  const MOD_APOS = String.fromCharCode(0x02bc);

  it('composes NFD into NFC', () => {
    const nfd = 'Vie' + String.fromCharCode(0x0302, 0x0323) + 't';
    expect(normalise(nfd, 'vi')).toBe(
      normalise('Vi' + String.fromCharCode(0x1ec7) + 't', 'vi'),
    );
  });

  it('removes zero-width characters', () => {
    expect(normalise(`a${ZWSP}b${WJ}c${BOM}`, 'id')).toBe('abc');
  });

  it('maps every Unicode space to one ASCII space and trims', () => {
    expect(normalise(`  a${NBSP}${NBSP}b\t\nc  `, 'id')).toBe('a b c');
  });

  it('folds typographic, fullwidth and modifier quotes to ASCII', () => {
    expect(
      normalise(
        `${LSQ}a${RSQ} ${LDQ}b${RDQ} ${FULL_DQ}c${FULL_DQ} ${FULL_SQ}d${MOD_APOS}`,
        'zh',
      ),
    ).toBe(`'a' "b" "c" 'd'`);
  });

  it('lower-cases in the locale', () => {
    expect(normalise('HELLO', 'id')).toBe('hello');
  });
});

describe('matching a quote (spec 5)', () => {
  const vi = getSiteStrings('vi');

  it('rule 1: the exact text of a form, as the type-ahead offers it', () => {
    expect(matchingKeys(vi.report.open, 'home', 'vi')).toContain(
      'site.report.open',
    );
  });

  it('rule 1 survives case and spacing', () => {
    const noisy = `  ${vi.report.open.toUpperCase()}  `;
    expect(matchingKeys(noisy, 'home', 'vi')).toContain('site.report.open');
  });

  it('rule 2: a piece of fixed wording of at least two characters', () => {
    const piece = vi.report.intro.slice(0, 12);
    expect(matchingKeys(piece, 'home', 'vi')).toContain('site.report.intro');
  });

  it('rule 2 refuses one character and accepts two', () => {
    const text = vi.report.open;
    expect(matchingKeys(text.slice(0, 1), 'home', 'vi')).toEqual([]);
    expect(matchingKeys(text.slice(0, 2), 'home', 'vi').length).toBeGreaterThan(
      0,
    );
  });

  it('rule 2 counts Thai graphemes, not code points', () => {
    // One grapheme cluster, three code points: too short however it is counted
    // in UTF-16. Two clusters are long enough.
    const th = getSiteStrings('th').report.open;
    const clusters = [
      ...new Intl.Segmenter('th', { granularity: 'grapheme' }).segment(th),
    ].map((s) => s.segment);
    // A cluster of several code points that has a cluster after it.
    const at = nonEmpty(
      [...clusters.keys()].filter(
        (i) => i < clusters.length - 1 && [...clusters[i]].length > 1,
      ),
      'multi-code-point Thai clusters with a successor',
    )[0];
    expect(matchingKeys(clusters[at], 'home', 'th')).toEqual([]);
    expect(
      matchingKeys(clusters[at] + clusters[at + 1], 'home', 'th'),
    ).toContain('site.report.open');
  });

  it('rule 3: a whole rendered message with real values in its slots', () => {
    const messages = nonEmpty(
      reportableStrings('classroom-groups', 'vi').filter((s) =>
        s.forms.some(
          (f) =>
            f.runs.length === 2 && f.runs.every((r) => r.trim().length > 0),
        ),
      ),
      'messages with one slot between two literal runs',
    );
    const { key, forms } = messages[0];
    const form = forms.find(
      (f) => f.runs.length === 2 && f.runs.every((r) => r.trim().length > 0),
    )!;
    expect(
      matchingKeys(
        `${form.runs[0]}30${form.runs[1]}`,
        'classroom-groups',
        'vi',
      ),
    ).toContain(key);
  });

  it('refuses a fragment that spans a slot without being the whole message', () => {
    const { forms } = nonEmpty(
      reportableStrings('classroom-groups', 'vi').filter((s) =>
        s.forms.some(
          (f) =>
            f.runs.length === 2 &&
            f.runs[0].trim().length > 3 &&
            f.runs[1].trim().length > 3,
        ),
      ),
      'messages with long runs either side of one slot',
    )[0];
    const form = forms.find(
      (f) =>
        f.runs.length === 2 &&
        f.runs[0].trim().length > 3 &&
        f.runs[1].trim().length > 3,
    )!;
    const spanning = `${form.runs[0].slice(-3)}30${form.runs[1].slice(0, 3)}`;
    expect(matchingKeys(spanning, 'classroom-groups', 'vi')).toEqual([]);
  });

  it('stores every key a quote matches', () => {
    const counts = new Map<string, string[]>();
    for (const { key, forms } of reportableStrings('classroom-groups', 'vi'))
      for (const { display } of forms)
        counts.set(display, [...(counts.get(display) ?? []), key]);
    const [display, keys] = nonEmpty(
      [...counts].filter(([, k]) => new Set(k).size > 1),
      'displays shared by two keys',
    )[0];
    // Every key that owns the display; rule 2 may add a key whose longer text contains it.
    expect(matchingKeys(display, 'classroom-groups', 'vi')).toEqual(
      expect.arrayContaining([...new Set(keys)]),
    );
  });

  it('matches nothing for text that is not on the page', () => {
    expect(
      matchingKeys('this sentence is on no page at all', 'home', 'vi'),
    ).toEqual([]);
    expect(matchingKeys('   ', 'home', 'vi')).toEqual([]);
  });

  it('rule 3 needs two characters of fixed wording (clarification 6)', () => {
    const slotsOnly = { display: `${ELLIPSIS}`, runs: ['', ''] };
    const oneLetter = { display: `a${ELLIPSIS}`, runs: ['a', ''] };
    const worded = { display: `ab${ELLIPSIS}`, runs: ['ab', ''] };
    expect(matchesForm('anything at all', slotsOnly, 'vi')).toBe(false);
    expect(matchesForm('anything at all', oneLetter, 'vi')).toBe(false);
    expect(matchesForm('ab and more', worded, 'vi')).toBe(true);
    expect(matchesForm('ab', worded, 'vi')).toBe(true);
    // A form with no slot has no whole message to scan for: its wording
    // twice, with anything between, is not a quote of it.
    const slotless = { display: 'ab', runs: ['ab'] };
    expect(matchesForm('ab then ab', slotless, 'vi')).toBe(false);
  });

  it('rule 3 wants every slot non-empty and every run in order', () => {
    const form = {
      display: `a${ELLIPSIS}b${ELLIPSIS}c`,
      runs: ['a', 'b', 'c'],
    };
    expect(matchesForm('a1b2c', form, 'vi')).toBe(true);
    expect(matchesForm('abc', form, 'vi')).toBe(false);
    expect(matchesForm('a1bc', form, 'vi')).toBe(false);
    expect(matchesForm('ab1c', form, 'vi')).toBe(false);
    expect(matchesForm('a1c2b', form, 'vi')).toBe(false);
  });

  it('a nonsense quote matches nothing on any page in any locale', () => {
    // Clarification 6: a form made only of slots would match every quote
    // through rule 3. This holds on the live catalogues whatever they gain.
    for (const locale of PREFIXED_LOCALES)
      for (const page of PAGE_IDS)
        expect(
          matchingKeys('zq7 xv9 wk3 on no page', page, locale),
          `${page} ${locale}`,
        ).toEqual([]);
  });

  it('offers only its own page: a home string is not found on yeetalk-calculators', () => {
    const homeOnly = nonEmpty(
      reportOptions('home', 'vi').filter(
        (o) =>
          !reportOptions('yeetalk-calculators', 'vi').includes(o) &&
          o.length > 12,
      ),
      'long home-only displays',
    )[0];
    expect(matchingKeys(homeOnly, 'yeetalk-calculators', 'vi')).toEqual([]);
  });

  it('answers a 1000-unit quote against every classroom-groups form promptly', () => {
    // A tripwire, not the Workers CPU budget: rule 3 is a linear scan
    // (clarification 5). A backtracking pattern such as ^a.+b.+c$ is
    // polynomial on a long quote of this shape; this bound is not a
    // measurement of one, only a line it must stay under.
    const quote = 'a'.repeat(999) + 'b';
    const started = performance.now();
    matchingKeys(quote, 'classroom-groups', 'vi');
    expect(performance.now() - started).toBeLessThan(250);
  });
});

/**
 * The site's chrome on the real iPhone: the same tests the real-Android run
 * executes from chrome, header-room, language-switcher, skip-link, not-found
 * and locale-beta (#800; the homepage's are in homepage.journey.ts). Global rule, 2026-10-15: "android and iOS
 * journeys need to be mirrored". Playwright cannot drive iOS Safari, so each
 * Android test is restated here over the session's WebDriver, under the SAME
 * title with an `iOS mirror:` prefix, generated per locale and per page as the
 * Android one is. What Android runs and this file does not is listed in
 * `.superpowers/sdd/800/plan.md` with its reason. The skip link's first-Tab
 * test needs no twin: Shyden ruled 2026-10-16 (#811) that a hardware key press
 * is exempt, "because it's a phone and phone users are not expected to have a
 * separate usb keyboard for their phones". The console-error tests are a gap,
 * not an exemption: safaridriver has no log endpoint, and #811 gives them one.
 *
 * Interaction goes through `phone().interaction` only, so the canary's mode
 * decides whether a click is a tap or a DOM-dispatched click (ruling
 * 2026-10-15: keep simulated taps), and every test announces that mode.
 *
 * One WebDriver session for the whole file (held-session.ts).
 */
import { describe, expect, test } from 'vitest';
import {
  BETA_BADGE,
  DEFAULT_LOCALE,
  getSiteStrings,
  isBetaLocale,
  LOCALES,
  localisePath,
  otherLocales,
  PREFIXED_LOCALES,
  type Locale,
} from '../../../src/lib/i18n';
import { LOCALE_METADATA } from '../../../src/lib/i18n/metadata';
import { expectedBadges } from '../../beta-badges';
import { DISSOLVED_COMPANY, dissolvedIn } from '../../dissolved-company';
import { floorBreach } from '../../floors';
import { THEMES } from '../../palette';
import { NOT_FOUND_PATH, PUBLISHED_ROUTES, sitePaths } from '../../site-pages';
import { searched } from '../../source-files';
import { paintedContrast } from '../../wcag';
import {
  attributesOf,
  boxesOf,
  countOf,
  paintedTextOf,
  statusOf,
  textsOf,
  visibilityOf,
} from './dom';
import { holdIosSession } from './held-session';
import { announceMode } from './session';

const phone = holdIosSession();

const SWITCHER = 'details.lang-switch';
const SUMMARY = `${SWITCHER} > summary`;

/** Below this width the switcher shows its short code (#329), as on Android. */
const COMPACT_BELOW = 720;

/** A path as Astro serves it, with its trailing slash. */
const withSlash = (path: string): string =>
  path.endsWith('/') ? path : `${path}/`;

/** The locale a published path is served in (docs and the 404 are English). */
function localeOf(path: string): Locale {
  const first = path.split('/')[1] as Locale;
  return LOCALES.includes(first) ? first : DEFAULT_LOCALE;
}

/** Each switcher entry's href, keyed by the language it offers. */
async function switcherTargets(): Promise<Record<string, string>> {
  const languages = await attributesOf(
    phone().driver,
    `${SWITCHER} li a`,
    'hreflang',
  );
  const hrefs = await attributesOf(phone().driver, `${SWITCHER} li a`, 'href');
  return Object.fromEntries(
    languages.map((language, i) => [language ?? '', hrefs[i] ?? '']),
  );
}

/** Opens the switcher the way a visitor does: its summary, clicked. */
async function openSwitcher(): Promise<void> {
  await phone().interaction.click(await phone().driver.findElement(SUMMARY));
  expect(
    await attributesOf(phone().driver, SWITCHER, 'open'),
    'the switcher opened',
  ).toEqual(['']);
}

/** Round to the nearest device pixel, as `rectAtLeast44` does on Android. */
function expectTouchable(
  box: { width: number; height: number } | undefined,
  what: string,
): void {
  expect(box, `${what} has a box`).toBeDefined();
  expect(Math.round(box!.width), `${what} width`).toBeGreaterThanOrEqual(44);
  expect(Math.round(box!.height), `${what} height`).toBeGreaterThanOrEqual(44);
}

describe('iOS mirror: language switcher', () => {
  for (const locale of LOCALES)
    test(`iOS mirror: ${locale}: names the current language in its own language, as its width calls for`, async () => {
      announceMode(phone(), `switcher label (${locale})`);
      await phone().navigateToPath(localisePath('/', locale), SWITCHER);
      const width = await phone().driver.executeScript<number>(
        'return window.innerWidth;',
      );
      const { nativeName, shortName } = LOCALE_METADATA[locale];
      const [shown, hidden, text] =
        width < COMPACT_BELOW
          ? ['.short', '.full', shortName]
          : ['.full', '.short', nativeName];
      const where = `${locale} at ${width}px`;
      expect(
        await visibilityOf(phone().driver, `${SUMMARY} ${shown}`),
        `${where}: ${shown}`,
      ).toEqual([true]);
      expect(await textsOf(phone().driver, `${SUMMARY} ${shown}`)).toEqual([
        text,
      ]);
      expect(
        await visibilityOf(phone().driver, `${SUMMARY} ${hidden}`),
        `${where}: ${hidden}`,
      ).toEqual([false]);
      expect(await attributesOf(phone().driver, SUMMARY, 'aria-label')).toEqual(
        [getSiteStrings(locale).language.label],
      );
    });

  for (const locale of LOCALES)
    test(`iOS mirror: ${locale}: lists every language in one fixed order, the current one ticked in place, every other a link`, async () => {
      announceMode(phone(), `switcher list (${locale})`);
      await phone().navigateToPath(localisePath('/', locale), SWITCHER);
      await openSwitcher();
      expect(await textsOf(phone().driver, `${SWITCHER} li .name`)).toEqual(
        LOCALES.map((l) => LOCALE_METADATA[l].nativeName),
      );
      expect(
        await attributesOf(phone().driver, `${SWITCHER} li`, 'aria-current'),
        'only the current entry is marked',
      ).toEqual(LOCALES.map((l) => (l === locale ? 'true' : null)));
      expect(
        await visibilityOf(
          phone().driver,
          `${SWITCHER} li[aria-current] .tick`,
        ),
        'the current entry is ticked, visibly',
      ).toEqual([true]);
      expect(
        await countOf(phone().driver, `${SWITCHER} li[aria-current] a`),
        'the current entry is a link',
      ).toBe(0);
      expect(await countOf(phone().driver, `${SWITCHER} .tick`)).toBe(1);

      const others = otherLocales(locale);
      expect(await textsOf(phone().driver, `${SWITCHER} li a .name`)).toEqual(
        others.map((other) => LOCALE_METADATA[other].nativeName),
      );
      expect(
        await visibilityOf(phone().driver, `${SWITCHER} li a`),
        'every other entry is visible',
      ).toEqual(others.map(() => true));
      expect(
        await attributesOf(phone().driver, `${SWITCHER} li a`, 'hreflang'),
      ).toEqual(others);
      expect(
        await attributesOf(phone().driver, `${SWITCHER} li a`, 'lang'),
      ).toEqual(others);
    });

  test('iOS mirror: opens and closes without JavaScript', async () => {
    announceMode(phone(), 'switcher opens');
    await phone().navigateToPath('/', SWITCHER);
    const [entryShown] = await visibilityOf(phone().driver, `${SWITCHER} li a`);
    expect(entryShown, 'an entry is hidden while the switcher is shut').toBe(
      false,
    );
    await openSwitcher();
    const [entryOpen] = await visibilityOf(phone().driver, `${SWITCHER} li a`);
    expect(entryOpen, 'an entry shows once it is open').toBe(true);
  });

  for (const path of sitePaths())
    for (const locale of LOCALES) {
      const here = localisePath(path, locale);

      test(`iOS mirror: ${here}: keeps you on the page you were reading`, async () => {
        announceMode(phone(), `switcher targets (${here})`);
        await phone().navigateToPath(here, SWITCHER);
        expect(await switcherTargets()).toEqual(
          Object.fromEntries(
            otherLocales(locale).map((other) => [
              other,
              withSlash(localisePath(path, other)),
            ]),
          ),
        );
      });

      test(`iOS mirror: ${here}: every target is a real page, not a 404`, async () => {
        announceMode(phone(), `switcher targets resolve (${here})`);
        await phone().navigateToPath(here, SWITCHER);
        const targets = Object.values(await switcherTargets());
        expect(targets).toHaveLength(otherLocales(locale).length);
        for (const href of targets)
          expect(await statusOf(phone().driver, href), href).toBe(200);
      });
    }

  test('iOS mirror: the control and its entries are touchable', async () => {
    announceMode(phone(), 'switcher touch targets');
    await phone().navigateToPath('/', SWITCHER);
    const [summary] = await boxesOf(phone().driver, SUMMARY);
    expectTouchable(summary, 'the switcher summary');
    await openSwitcher();
    const [entry] = await boxesOf(phone().driver, `${SWITCHER} li a`);
    expectTouchable(entry, 'the first switcher entry');
    const [current] = await boxesOf(
      phone().driver,
      `${SWITCHER} li[aria-current]`,
    );
    expectTouchable(current, 'the current language entry');
  });
});

describe('iOS mirror: skip link — WCAG 2.4.1', () => {
  for (const path of PUBLISHED_ROUTES)
    test(`iOS mirror: ${path} offers it, in the page's language`, async () => {
      announceMode(phone(), `skip link offered (${path})`);
      await phone().navigateToPath(path, '.skip-link');
      expect(await textsOf(phone().driver, '.skip-link')).toEqual([
        getSiteStrings(localeOf(path)).skipToContent,
      ]);
    });

  test('iOS mirror: it becomes visible when focused, and lands on the content', async () => {
    announceMode(phone(), 'skip link focus and target');
    await phone().navigateToPath('/classroom-groups');
    const inViewport = (): Promise<boolean> =>
      phone().driver.executeScript<boolean>(
        `const r = document.querySelector('.skip-link').getBoundingClientRect();
         return r.bottom > 0 && r.right > 0 && r.top < innerHeight && r.left < innerWidth;`,
      );
    expect(await inViewport(), 'hidden until focused').toBe(false);
    await phone().driver.executeScript(
      `document.querySelector('.skip-link').focus();`,
    );
    expect(await inViewport(), 'shown once focused').toBe(true);

    await phone().interaction.click(
      await phone().driver.findElement('.skip-link'),
    );
    expect(
      await phone().driver.executeScript<string>('return location.hash;'),
    ).toBe('#main');
    expect(
      await phone().driver.executeScript<string>(
        'return document.activeElement?.id ?? "";',
      ),
      'focus lands on the content',
    ).toBe('main');
  });
});

describe('iOS mirror: the 404 answers everyone', () => {
  for (const locale of LOCALES)
    test(`iOS mirror: shows ${locale}, among every language the site serves`, async () => {
      announceMode(phone(), `404 heading (${locale})`);
      await phone().navigateToPath(NOT_FOUND_PATH, 'h1');
      const level = locale === DEFAULT_LOCALE ? 1 : 2;
      const heading = getSiteStrings(locale).notFound.heading;
      const texts = await textsOf(phone().driver, `h${level}`);
      const shown = await visibilityOf(phone().driver, `h${level}`);
      expect(
        texts.flatMap((text, i) => (text === heading ? [shown[i]] : [])),
        `${locale}: no heading on the 404 among h${level}s ${JSON.stringify(texts)}`,
      ).toEqual([true]);
    });

  for (const locale of LOCALES.filter((l) => l !== DEFAULT_LOCALE))
    test(`iOS mirror: marks ${locale} so a screen reader changes voice`, async () => {
      announceMode(phone(), `404 lang (${locale})`);
      await phone().navigateToPath(NOT_FOUND_PATH, 'h1');
      const marked = await phone().driver.executeScript<(string | null)[]>(
        `return Array.from(document.querySelectorAll('h2'))
           .filter((h) => h.innerText.trim() === arguments[0])
           .map((h) => h.getAttribute('lang'));`,
        [getSiteStrings(locale).notFound.heading],
      );
      expect(marked).toEqual([locale]);
    });

  for (const locale of LOCALES)
    test(`iOS mirror: sends a ${locale} visitor home in their own language`, async () => {
      announceMode(phone(), `404 home link (${locale})`);
      await phone().navigateToPath(NOT_FOUND_PATH, 'h1');
      const hrefs = await phone().driver.executeScript<(string | null)[]>(
        `return Array.from(document.querySelectorAll('a'))
           .filter((a) => a.innerText.trim() === arguments[0])
           .map((a) => a.getAttribute('href'));`,
        [getSiteStrings(locale).notFound.backHome],
      );
      expect(hrefs).toEqual([localisePath('/', locale)]);
    });

  const sentences: Record<Locale, string> = {
    en: "That page doesn't exist. Back to the homepage.",
    id: 'Halaman itu tidak ada. Kembali ke beranda.',
    zh: '该页面不存在。返回首页。',
    vi: 'Trang đó không tồn tại. Quay lại trang chủ.',
    th: 'หน้านั้นไม่มีอยู่ กลับสู่หน้าหลัก',
  };

  for (const locale of LOCALES)
    test(`iOS mirror: ends the ${locale} back-home sentence in its own language`, async () => {
      announceMode(phone(), `404 sentence (${locale})`);
      await phone().navigateToPath(NOT_FOUND_PATH, 'h1');
      const paragraphs = await phone().driver.executeScript<
        { text: string; visible: boolean }[]
      >(
        `return Array.from(document.querySelectorAll('a'))
           .filter((a) => a.innerText.trim() === arguments[0])
           .map((a) => a.closest('p'))
           .filter(Boolean)
           .map((p) => ({ text: p.innerText, visible: p.getClientRects().length > 0 }));`,
        [getSiteStrings(locale).notFound.backHome],
      );
      expect(paragraphs, locale).toEqual([
        { text: sentences[locale], visible: true },
      ]);
    });
});

describe('iOS mirror: header + footer', () => {
  test('iOS mirror: nav links are root-relative so they work from every page, not just /', async () => {
    announceMode(phone(), 'nav root-relative');
    await phone().navigateToPath('/yeetalk-calculators', 'header nav');
    expect(await attributesOf(phone().driver, 'header nav a', 'href')).toEqual([
      '/#shytalk',
      '/#yawelo-idle',
      '/#tools',
      '/#contact',
    ]);
  });

  for (const locale of LOCALES)
    test(`iOS mirror: ${locale}: the footer names no company, and still reaches a person`, async () => {
      announceMode(phone(), `footer (${locale})`);
      await phone().navigateToPath(localisePath('/', locale), 'footer');
      expect(await visibilityOf(phone().driver, 'footer')).toEqual([true]);
      expect(await countOf(phone().driver, 'footer .disclosure')).toBe(0);
      const [text] = await phone().driver.executeScript<string[]>(
        `return Array.from(document.querySelectorAll('footer'), (f) => f.textContent ?? '');`,
      );
      expect(
        searched(dissolvedIn(text ?? ''), {
          of: DISSOLVED_COMPANY,
          what: 'dissolved-company forms',
        }),
        `${locale} footer still names the company`,
      ).toEqual([]);
      expect(
        floorBreach(
          'ios-chrome/footer-company-forms',
          DISSOLVED_COMPANY.length,
        ),
      ).toBeUndefined();
      expect(
        await visibilityOf(
          phone().driver,
          'footer a[href="mailto:support@shyden.co.uk"]',
        ),
      ).toEqual([true]);
    });

  test('iOS mirror: no header link overrides the visitor’s own Tab preference', async () => {
    announceMode(phone(), 'header tabindex');
    await phone().navigateToPath('/', 'header');
    const headerLinks = await phone().driver.executeScript<string[]>(
      `return Array.from(document.querySelectorAll('header a'), (e) => e.className || e.textContent.trim());`,
    );
    const withTabindex = await phone().driver.executeScript<string[]>(
      `return Array.from(document.querySelectorAll('header a[tabindex]'),
         (e) => (e.className || e.textContent.trim()) + '=' + e.getAttribute('tabindex'));`,
    );
    expect(
      searched(withTabindex, { of: headerLinks, what: 'header links' }),
    ).toEqual([]);
    expect(
      floorBreach('ios-chrome/header-links', headerLinks.length),
    ).toBeUndefined();
  });
});

describe('iOS mirror: every unverified language is marked BETA', () => {
  const BADGE = '[data-beta]';
  const NOTICE = '[data-beta-notice]';

  for (const locale of LOCALES) {
    const path = localisePath('/', locale);
    const t = getSiteStrings(locale);

    test(`iOS mirror: ${locale}: marks each beta language once in the list, and English never`, async () => {
      announceMode(phone(), `beta badges (${locale})`);
      await phone().navigateToPath(path, SWITCHER);
      expect(
        await countOf(phone().driver, BADGE),
        `${path}: expected one badge per beta locale, and one for the summary`,
      ).toBe(expectedBadges(locale));
      expect(await countOf(phone().driver, `${SUMMARY} ${BADGE}`)).toBe(
        isBetaLocale(locale) ? 1 : 0,
      );
      await openSwitcher();
      expect(
        await countOf(phone().driver, `${SWITCHER} li[aria-current] ${BADGE}`),
        `${path}: the current entry, ${locale}, is badged only if it is unverified`,
      ).toBe(isBetaLocale(locale) ? 1 : 0);
      for (const other of otherLocales(locale))
        expect(
          await countOf(
            phone().driver,
            `${SWITCHER} li a[hreflang="${other}"] ${BADGE}`,
          ),
          `${path}: ${other} is ${isBetaLocale(other) ? 'unverified and unbadged' : 'verified but badged'}`,
        ).toBe(isBetaLocale(other) ? 1 : 0);
    });

    test(`iOS mirror: ${locale}: the footer says why, in ${locale}`, async () => {
      announceMode(phone(), `beta notice (${locale})`);
      await phone().navigateToPath(path, 'footer');
      if (!isBetaLocale(locale)) {
        expect(await countOf(phone().driver, NOTICE)).toBe(0);
        return;
      }
      expect(await visibilityOf(phone().driver, NOTICE)).toEqual([true]);
      const [notice] = await textsOf(phone().driver, NOTICE);
      expect(notice).toContain(t.language.betaNotice);
      expect(notice).toContain(BETA_BADGE);
      if (locale !== DEFAULT_LOCALE)
        expect(notice).not.toContain(
          getSiteStrings(DEFAULT_LOCALE).language.betaNotice,
        );
    });
  }

  for (const locale of PREFIXED_LOCALES)
    test(`iOS mirror: ${locale}: the badge carries a translated name for screen readers`, async () => {
      // Playwright reads this with `ariaSnapshot`, which WebDriver has no
      // twin of; the badge's whole text, its visually-hidden name included,
      // is what a screen reader is given.
      announceMode(phone(), `beta badge name (${locale})`);
      await phone().navigateToPath(localisePath('/', locale), SWITCHER);
      const [spoken] = await phone().driver.executeScript<string[]>(
        `return Array.from(document.querySelectorAll(arguments[0]), (b) => b.textContent ?? '');`,
        [`${SUMMARY} ${BADGE}`],
      );
      expect(spoken, 'badge is a bare token').toContain(
        getSiteStrings(locale).language.betaLabel,
      );
      expect(spoken).toContain(BETA_BADGE);
    });

  /** One recorded floor per locale: each lists its own number of badges. */
  const BADGE_VOICE_FLOORS: Record<Locale, string> = {
    en: 'ios-chrome/badge-voices-en',
    id: 'ios-chrome/badge-voices-id',
    zh: 'ios-chrome/badge-voices-zh',
    vi: 'ios-chrome/badge-voices-vi',
    th: 'ios-chrome/badge-voices-th',
  };

  for (const locale of LOCALES)
    test(`iOS mirror: ${locale}: the badge's spoken label keeps the page's language, even inside another language's entry`, async () => {
      announceMode(phone(), `beta badge voice (${locale})`);
      await phone().navigateToPath(localisePath('/', locale), SWITCHER);
      await openSwitcher();
      const voices = await phone().driver.executeScript<(string | null)[]>(
        `return Array.from(document.querySelectorAll(arguments[0]),
           (label) => label.closest('[lang]')?.getAttribute('lang') ?? null);`,
        [`${SWITCHER} ${BADGE} .visually-hidden`],
      );
      expect(voices, 'one label per badge').toHaveLength(
        expectedBadges(locale),
      );
      expect(
        searched(
          voices.filter((voice) => voice !== locale),
          { of: voices, what: 'badge labels' },
        ),
        'badge labels voiced in another language',
      ).toEqual([]);
      expect(
        floorBreach(BADGE_VOICE_FLOORS[locale], voices.length),
      ).toBeUndefined();
    });

  for (const theme of THEMES)
    test(`iOS mirror: ${theme}, saved: the badge clears the WCAG AA floor for normal text`, async () => {
      announceMode(phone(), `beta badge contrast (${theme})`);
      // NOT YET THE SAME as Android (#811): Android emulates the device colour
      // scheme; WebDriver cannot, so the theme is the SAVED choice. Kept, never
      // deleted (Shyden 2026-10-16), until #811 sets the phone's appearance.
      await phone().navigateToPath(
        localisePath('/', PREFIXED_LOCALES[0]),
        SWITCHER,
        theme,
      );
      await openSwitcher();
      const [summary] = await paintedTextOf(
        phone().driver,
        `${SUMMARY} ${BADGE}`,
      );
      const [entry] = await paintedTextOf(
        phone().driver,
        `${SWITCHER} li ${BADGE}`,
      );
      expect(summary, 'a summary badge was read').toBeDefined();
      expect(entry, 'an entry badge was read').toBeDefined();
      expect(
        paintedContrast(summary!),
        'the summary badge',
      ).toBeGreaterThanOrEqual(4.5);
      expect(paintedContrast(entry!), 'the entry badge').toBeGreaterThanOrEqual(
        4.5,
      );
    });
});

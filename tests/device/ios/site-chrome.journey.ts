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
  accessibleTextsOf,
  attributesOf,
  boxesOf,
  countOf,
  expectEventually,
  expectLocator,
  paintedTextOf,
  textsOf,
  visibilityOf,
} from './dom';
import { shootDevice } from './evidence';
import { holdIosSession } from './held-session';
import { NORMALISE_SOURCE } from './playwright-rules';
import {
  byRole,
  expectAccessibleName,
  expectRole,
  expectRoleAttribute,
} from './roles';
import { announceMode } from './session';

const phone = holdIosSession();

/** `expect(page.locator(selector))`, retried as Playwright retries it (#821); `nth` is `.nth(n)`. */
const on = (selector: string, nth?: number) =>
  expectLocator(phone().driver, selector, { nth });

/** Android's `shoot`: evidence only, written when the run asks for it. */
const shoot = (label: string): Promise<string | null> =>
  shootDevice(phone().driver, { project: 'ios-safari-real-device', label });

/** Runs `script` in the page and returns what it returns. */
const read = <T>(script: string, args: unknown[] = []): Promise<T> =>
  phone().driver.executeScript<T>(script, args);

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

/** `page.locator(`${SWITCHER} > summary`).click()`: the summary, clicked, nothing more. */
async function clickSummary(): Promise<void> {
  await phone().interaction.click(await phone().driver.findElement(SUMMARY));
}

/** `locator.boundingBox()` on a strict locator: one match, or the test fails. */
async function oneBox(
  selector: string,
): Promise<{ width: number; height: number }> {
  const boxes = await boxesOf(phone().driver, selector);
  expect(boxes, `${selector} has one box`).toHaveLength(1);
  return boxes[0]!;
}

/** Android's `rectAtLeast44`: rounded to the nearest device pixel, at least 44 each way. */
function expectTouchable(
  box: { width: number; height: number },
  what: string,
): void {
  expect(Math.round(box.width), `${what} width`).toBeGreaterThanOrEqual(44);
  expect(Math.round(box.height), `${what} height`).toBeGreaterThanOrEqual(44);
}

/** Each entry's text, shown state and language attributes, in page order. */
const entriesOf = (
  selector: string,
): Promise<
  {
    text: string;
    visible: boolean;
    hreflang: string | null;
    lang: string | null;
  }[]
> =>
  phone().driver.executeScript(
    `const norm = ${NORMALISE_SOURCE};
     return Array.from(document.querySelectorAll(arguments[0]), (a) => ({
       text: norm(a.textContent),
       visible: a.checkVisibility() && getComputedStyle(a).visibility === 'visible',
       hreflang: a.getAttribute('hreflang'),
       lang: a.getAttribute('lang'),
     }));`,
    [selector],
  );

describe('iOS mirror: language switcher', () => {
  for (const locale of LOCALES)
    test(`iOS mirror: ${locale}: names the current language in its own language, as its width calls for`, async () => {
      announceMode(phone(), `switcher label (${locale})`);
      await phone().navigateToPath(localisePath('/', locale), SWITCHER);
      const width = await phone().driver.executeScript<number>(
        'return window.innerWidth;',
      );
      // Android's expectLabel, step for step.
      const { nativeName, shortName } = LOCALE_METADATA[locale];
      const [shown, hidden, text] =
        width < COMPACT_BELOW
          ? ['.short', '.full', shortName]
          : ['.full', '.short', nativeName];
      const where = `${locale} at ${width}px`;
      await expectEventually(
        () => visibilityOf(phone().driver, `${SUMMARY} ${shown}`),
        [true],
        `${where}: ${shown}`,
      );
      await on(`${SUMMARY} ${shown}`).toHaveText(text);
      await expectEventually(
        () => countOf(phone().driver, `${SUMMARY} ${hidden}`),
        1,
        `${where}: ${hidden}`,
      );
      await on(`${SUMMARY} ${hidden}`).toBeHidden();
      await expectAccessibleName(
        phone().driver,
        SUMMARY,
        getSiteStrings(locale).language.label,
      );
      await shoot(`${where}: the switcher shows ${text}`);
    });

  for (const locale of LOCALES)
    test(`iOS mirror: ${locale}: lists every language in one fixed order, the current one ticked in place, every other a link`, async () => {
      announceMode(phone(), `switcher list (${locale})`);
      await phone().navigateToPath(localisePath('/', locale), SWITCHER);
      await clickSummary();
      const items = `${SWITCHER} li`;
      await on(items).toHaveCount(LOCALES.length);

      await on(`${items} .name`).toHaveText(
        LOCALES.map((l) => LOCALE_METADATA[l].nativeName),
      );

      // `items.nth(i)`; its `.name` and `.tick` are read through
      // `li[aria-current]`, which the next lines pin as that same entry.
      const at = LOCALES.indexOf(locale);
      await on(items, at).toHaveAttribute('aria-current', 'true');
      await on(`${items}[aria-current] .name`).toBeVisible();
      await on(`${items}[aria-current] .name`).toHaveText(
        LOCALE_METADATA[locale].nativeName,
      );
      await on(`${items}[aria-current] .tick`).toBeVisible();
      await expectEventually(
        () => countOf(phone().driver, `${items}[aria-current] a`),
        0,
        'the current entry is a link',
      );
      await on(`${items}[aria-current]`).toHaveCount(1);
      await on(`${SWITCHER} .tick`).toHaveCount(1);

      const entries = `${SWITCHER} li a`;
      await on(entries).toHaveCount(otherLocales(locale).length);
      for (const other of otherLocales(locale)) {
        // `entries.filter({ hasText })`: the entries whose text holds the name.
        const entry = async () =>
          (await entriesOf(entries)).filter((e) =>
            e.text
              .toLowerCase()
              .includes(LOCALE_METADATA[other].nativeName.toLowerCase()),
          );
        await expectEventually(
          async () => (await entry()).length,
          1,
          `${locale}: an entry for ${other}`,
        );
        await expectEventually(
          async () => (await entry()).map((e) => e.visible),
          [true],
          `${other} entry visible`,
        );
        await expectEventually(
          async () => (await entry()).map((e) => e.hreflang),
          [other],
          `${other} entry hreflang`,
        );
        await expectEventually(
          async () => (await entry()).map((e) => e.lang),
          [other],
          `${other} entry lang`,
        );
      }
      await shoot(
        `${locale}: every language listed in one order, ${LOCALE_METADATA[locale].nativeName} ticked in place`,
      );
    });

  test('iOS mirror: opens and closes without JavaScript', async () => {
    announceMode(phone(), 'switcher opens');
    await phone().navigateToPath('/', SWITCHER);
    const entry = on(`${SWITCHER} li a`, 0);
    await entry.toBeHidden();
    await clickSummary();
    await on(SWITCHER).toHaveAttribute('open', '');
    await entry.toBeVisible();
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
        // `page.request.get`: from the test process, as Android asks.
        for (const href of targets)
          expect(
            (await fetch(new URL(href, phone().baseUrl))).status,
            href,
          ).toBe(200);
      });
    }

  test('iOS mirror: the control and its entries are touchable', async () => {
    announceMode(phone(), 'switcher touch targets');
    await phone().navigateToPath('/', SWITCHER);
    expectTouchable(await oneBox(SUMMARY), 'the switcher summary');
    await clickSummary();
    const [entry] = await boxesOf(phone().driver, `${SWITCHER} li a`);
    expect(entry, 'the first switcher entry has a box').toBeDefined();
    expectTouchable(entry!, 'the first switcher entry');
    expectTouchable(
      await oneBox(`${SWITCHER} li[aria-current]`),
      'the current language entry',
    );
  });
});

describe('iOS mirror: skip link — WCAG 2.4.1', () => {
  for (const path of PUBLISHED_ROUTES)
    test(`iOS mirror: ${path} offers it, in the page's language`, async () => {
      announceMode(phone(), `skip link offered (${path})`);
      await phone().navigateToPath(path, '.skip-link');
      await on('.skip-link').toHaveText(
        getSiteStrings(localeOf(path)).skipToContent,
      );
    });

  test('iOS mirror: it becomes visible when focused, and lands on the content', async () => {
    announceMode(phone(), 'skip link focus and target');
    await phone().navigateToPath('/classroom-groups');
    const inViewport = (): Promise<boolean> =>
      phone().driver.executeScript<boolean>(
        `const r = document.querySelector('.skip-link').getBoundingClientRect();
         return r.bottom > 0 && r.right > 0 && r.top < innerHeight && r.left < innerWidth;`,
      );
    await expectEventually(inViewport, false, 'hidden until focused');
    await phone().driver.executeScript(
      `document.querySelector('.skip-link').focus();`,
    );
    await expectEventually(inViewport, true, 'shown once focused');

    // Android presses Enter on the focused link. A key press needs no iPhone
    // twin (Shyden 2026-10-16, #811): a phone follows the link by a tap.
    await phone().interaction.click(
      await phone().driver.findElement('.skip-link'),
    );
    await expectEventually(
      async () =>
        /#main$/.test(
          await phone().driver.executeScript<string>('return location.href;'),
        ),
      true,
      'the URL ends #main',
    );
    await expectEventually(
      () =>
        phone().driver.executeScript<(string | null)[]>(
          `return Array.from(document.querySelectorAll(':focus'), (el) => el.getAttribute('id'));`,
        ),
      ['main'],
      'focus lands on the content',
    );
  });
});

/**
 * The 404's tests, one per language. Android checks every language inside
 * ONE test of each kind (not-found.spec.ts), which the one-test-per-case rule
 * forbids; #462 splits those, and these titles say the language until then.
 * Each step is Android's, in Android's order, for that language.
 */
describe('iOS mirror: the 404 answers everyone', () => {
  for (const locale of LOCALES)
    test(`iOS mirror: shows ${locale}, among every language the site serves`, async () => {
      announceMode(phone(), `404 heading (${locale})`);
      await phone().navigateToPath(NOT_FOUND_PATH, 'h1');
      const t = getSiteStrings(locale).notFound;
      await expectRole(phone().driver, 'heading', t.heading, {
        exact: false,
        level: locale === DEFAULT_LOCALE ? 1 : 2,
      }).toBeVisible();
      await shoot(`${locale} is answered on the 404`);
    });

  for (const locale of LOCALES.filter((l) => l !== DEFAULT_LOCALE))
    test(`iOS mirror: marks ${locale} so a screen reader changes voice`, async () => {
      announceMode(phone(), `404 lang (${locale})`);
      await phone().navigateToPath(NOT_FOUND_PATH, 'h1');
      const t = getSiteStrings(locale).notFound;
      await expectRoleAttribute(
        phone().driver,
        'heading',
        t.heading,
        { exact: false, level: 2 },
        'lang',
        locale,
      );
      await shoot(`${locale} heading carries lang="${locale}"`);
    });

  for (const locale of LOCALES)
    test(`iOS mirror: sends a ${locale} visitor home in their own language`, async () => {
      announceMode(phone(), `404 home link (${locale})`);
      await phone().navigateToPath(NOT_FOUND_PATH, 'h1');
      const t = getSiteStrings(locale).notFound;
      await expectRoleAttribute(
        phone().driver,
        'link',
        t.backHome,
        { exact: true },
        'href',
        localisePath('/', locale),
      );
      await shoot(`${locale} link goes to its own homepage`);
    });

  const sentences: Record<string, string> = {
    en: "That page doesn't exist. Back to the homepage.",
    id: 'Halaman itu tidak ada. Kembali ke beranda.',
    zh: '该页面不存在。返回首页。',
    vi: 'Trang đó không tồn tại. Quay lại trang chủ.',
    th: 'หน้านั้นไม่มีอยู่ กลับสู่หน้าหลัก',
  };

  for (const locale of LOCALES)
    test(`iOS mirror: ends the ${locale} back-home sentence in its own language`, async () => {
      announceMode(phone(), `404 sentence (${locale})`);
      expect(Object.keys(sentences).sort()).toEqual([...LOCALES].sort());
      await phone().navigateToPath(NOT_FOUND_PATH, 'h1');
      const t = getSiteStrings(locale).notFound;
      // `link.locator('xpath=ancestor::p[1]')`: the link found afresh by its
      // exact name on each read, then its nearest paragraph.
      const sentence = async (): Promise<
        { visible: boolean; text: string }[]
      > => {
        const link = await byRole(phone().driver, 'link', t.backHome, {
          exact: true,
        }).catch(() => null);
        if (link === null) return [];
        return read(
          `const p = arguments[0].parentElement?.closest('p');
           return p ? [{ visible: p.checkVisibility() && getComputedStyle(p).visibility === 'visible', text: p.innerText }] : [];`,
          [phone().driver.elementRef(link.elementId)],
        );
      };
      await expectEventually(
        async () => (await sentence()).length,
        1,
        `${locale} count`,
      );
      await expectEventually(
        async () => (await sentence()).map((s) => s.visible),
        [true],
        `${locale} visible`,
      );
      expect((await sentence())[0]?.text, locale).toBe(sentences[locale]);
      await shoot(`${locale} back-home sentence`);
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
      await on('footer').toBeVisible();
      await on('footer .disclosure').toHaveCount(0);
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
      await on('footer a[href="mailto:support@shyden.co.uk"]').toBeVisible();
      await shoot(`${locale} footer: the support email, and no company`);
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
      await shoot(
        `${locale} page carries exactly ${expectedBadges(locale)} badges`,
      );
      await on(`${SUMMARY} ${BADGE}`).toHaveCount(isBetaLocale(locale) ? 1 : 0);
      await shoot(
        isBetaLocale(locale)
          ? `${locale} is unverified, so the control it is read in is badged`
          : `${locale} is verified, so the control shows no badge`,
      );
      await clickSummary();
      await expectEventually(
        () => countOf(phone().driver, `${SWITCHER} li[aria-current] ${BADGE}`),
        isBetaLocale(locale) ? 1 : 0,
        `${path}: the current entry, ${locale}, is badged only if it is unverified`,
      );
      for (const other of otherLocales(locale)) {
        await expectEventually(
          () =>
            countOf(
              phone().driver,
              `${SWITCHER} li a[hreflang="${other}"] ${BADGE}`,
            ),
          isBetaLocale(other) ? 1 : 0,
          `${path}: ${other} is ${isBetaLocale(other) ? 'unverified and unbadged' : 'verified but badged'}`,
        );
        await shoot(
          `${other} entry ${isBetaLocale(other) ? 'is badged' : 'is NOT badged'}`,
        );
      }
    });

    test(`iOS mirror: ${locale}: the footer says why, in ${locale}`, async () => {
      announceMode(phone(), `beta notice (${locale})`);
      await phone().navigateToPath(path, 'footer');
      const notice = on(NOTICE);
      if (!isBetaLocale(locale)) {
        await notice.toHaveCount(0);
        await shoot('the English footer carries no beta notice');
        return;
      }
      await notice.toBeVisible();
      await notice.toContainText(t.language.betaNotice);
      await notice.toContainText(BETA_BADGE);
      await shoot(`the notice is present and in ${locale}`);
      if (locale !== DEFAULT_LOCALE) {
        // `not.toContainText`, retried as Playwright retries a negation.
        await expectEventually(
          async () =>
            (await textsOf(phone().driver, NOTICE)).map((text) =>
              text.includes(getSiteStrings(DEFAULT_LOCALE).language.betaNotice),
            ),
          [false],
          `${NOTICE} does not contain the English sentence`,
        );
        await shoot(`${locale} does not fall back to the English sentence`);
      }
    });
  }

  for (const locale of PREFIXED_LOCALES)
    test(`iOS mirror: ${locale}: the badge carries a translated name for screen readers`, async () => {
      // `badge.ariaSnapshot()`: what the accessibility tree is given, read by
      // accessibleTextsOf (aria-hidden and unrendered text left out, the
      // visually-hidden name kept). A strict locator: one badge, or a failure.
      announceMode(phone(), `beta badge name (${locale})`);
      await phone().navigateToPath(localisePath('/', locale), SWITCHER);
      const texts = await accessibleTextsOf(
        phone().driver,
        `${SUMMARY} ${BADGE}`,
      );
      expect(texts, 'one summary badge').toHaveLength(1);
      const spoken = texts[0]!;
      expect(spoken, 'badge is a bare token').toContain(
        getSiteStrings(locale).language.betaLabel,
      );
      expect(spoken).toContain(BETA_BADGE);
      await shoot(`${locale} badge is announced as "${spoken.trim()}"`);
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
      await clickSummary();
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
      await clickSummary();
      await on(`${SWITCHER} li ${BADGE}`, 0).toBeVisible();
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
      const summaryRatio = paintedContrast(summary!);
      expect(summaryRatio, 'the summary badge').toBeGreaterThanOrEqual(4.5);
      const entryRatio = paintedContrast(entry!);
      expect(entryRatio, 'the entry badge').toBeGreaterThanOrEqual(4.5);
      await shoot(
        `${theme}: the badge paints ${summaryRatio.toFixed(2)}:1 in the summary and ${entryRatio.toFixed(2)}:1 in the list, floor 4.5:1`,
      );
    });
});

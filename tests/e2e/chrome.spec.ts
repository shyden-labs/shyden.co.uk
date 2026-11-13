import { tabTo } from '../tab-to';
import { tapOn } from '../real-touch';
import type { Page } from '@playwright/test';
import { test, expect } from './fixtures';
import { recorded, shoot } from './evidence';
import { atLeast44, expectNoHorizontalScroll } from '../viewport';
import { LOCALES, getSiteStrings, localisePath } from '../../src/lib/i18n';
import { searched } from '../source-files';
import { atViewport } from '../viewport-at';
import { eachWidth } from '../each-width';

test.use(recorded);

/**
 * Bring the nav into view the way a visitor at this width would (#1046,
 * Shyden 2026-11-07: the phone checks the menu, the laptop the nav row).
 * Where the width puts the nav behind the menu, the menu is opened by a real
 * tap; where it is a row, nothing is pressed. Returns which one the page
 * showed, so a test can say what it measured.
 */
const revealNav = async (page: Page): Promise<'menu' | 'row'> => {
  const summary = page.locator('header details.menu > summary');
  if (!(await summary.isVisible())) return 'row';
  await tapOn(summary);
  await expect(page.locator('header details.menu')).toHaveJSProperty(
    'open',
    true,
  );
  return 'menu';
};

/** The width the page lays out to, scrollbar excluded. */
const layoutWidth = (page: Page): Promise<number> =>
  page.evaluate(() => document.documentElement.clientWidth);

test.describe('header + footer', () => {
  test('nav links point to the section anchors in scroll order', async ({
    page,
  }) => {
    await page.goto('/');
    await revealNav(page);
    const nav = page.locator('header nav');
    await expect(nav.locator('a')).toHaveText([
      'ShyTalk',
      'Yawelo Idle',
      'Tools',
      'Contact',
    ]);
    await expect(nav.locator('a').nth(0)).toHaveAttribute('href', '/#shytalk');
    // Scroll order, as the title says: each link's section sits below the
    // one before it. Read from the links' own fragments, so a section moved
    // on the page without its link fails here.
    const hrefs = await nav
      .locator('a')
      .evaluateAll((els) => els.map((e) => e.getAttribute('href') ?? ''));
    const tops: number[] = [];
    for (const href of hrefs) {
      const box = await page
        .locator(new URL(href, page.url()).hash)
        .boundingBox();
      expect(box, `${href} leads to no section on the page`).not.toBeNull();
      tops.push(box?.y ?? Number.NaN);
    }
    expect(tops, `section tops, in nav order: ${tops.join(', ')}`).toEqual(
      [...tops].sort((a, b) => a - b),
    );
    // Aurora renamed these from Services/Work; this spec is the established
    // home for nav-link facts, so the proof belongs here and not in a second
    // guard elsewhere.
    await shoot(
      page,
      'nav reads ShyTalk / Tools / Contact, in scroll order',
      nav,
    );
  });

  // The nav's root-relative links and each locale's footer are read on their
  // pages' walks: checks/chrome.ts (#1086).

  // Keyboard access in the header is TWO separate contracts, because engines
  // genuinely disagree about one of them and agree about the other.
  //
  // Safari, by default, does not put plain links in the Tab sequence at all —
  // the visitor opts in with "Press Tab to highlight each item". That is the
  // VISITOR's setting to make, so the Tab-sequence test below runs only where
  // links are tabbed, and the contract that must hold everywhere — that each
  // control can take focus and none is removed from the tab order — is
  // asserted separately, on every engine.
  test('the header is keyboard-reachable in order (WCAG 2.1.1)', async ({
    page,
    browserName,
  }) => {
    test.skip(
      browserName === 'webkit',
      'Safari omits plain links from the Tab sequence unless the visitor opts in, ' +
        'so a Tab walk here would assert a browser preference, not our markup. ' +
        'Focusability and order are asserted for WebKit in the tests below.',
    );
    await page.goto('/');
    // Where the width puts the nav behind the menu, the menu is opened first
    // (#1046). Its summary comes before the theme switch in the header, so
    // Tab still runs from the language switcher straight to the links.
    await revealNav(page);
    // Anchor on the language switcher's summary — the last focusable thing
    // in the bar before <nav> — rather than on the wordmark: engines differ on
    // how many Tab presses that gap costs, and tabTo walks to it by Tab on
    // all of them. Tab then advances in DOM order, so this
    // asserts OUR running order.
    const languages = page.locator('header details.lang-switch > summary');
    await tabTo(languages);
    // The theme switch sits immediately before the language switcher
    // (#142 §5). Reached by Shift+Tab, never focused directly, so a switch
    // taken out of the Tab order (tabindex="-1") is stepped over and this
    // fails where a direct focus() would still succeed.
    await page.keyboard.press('Shift+Tab');
    await expect(page.locator('header [data-theme-toggle]')).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(languages).toBeFocused();

    for (const label of ['ShyTalk', 'Yawelo Idle', 'Tools', 'Contact']) {
      await page.keyboard.press('Tab');
      await expect(
        page.locator('header nav a', { hasText: label }),
      ).toBeFocused();
    }
  });

  test('every header link can take focus, on every engine', async ({
    page,
  }) => {
    // The contract that holds regardless of the visitor's Tab preference:
    // reached with Option+Tab on WebKit (tabKey), which includes links whatever
    // Safari's default. This is the whole header, not just
    // the language switcher — a control left out here would be unreachable by
    // keyboard even for a visitor who HAS opted in.
    await page.goto('/');
    // Opened by keys, as a keyboard visitor opens it: WebKit keeps focus on a
    // clicked <summary>, so a walk after a tap never leaves it (measured in
    // CI on webkit and mobile-safari, #1034).
    const menu = page.locator('header details.menu > summary');
    const menuFirst = await menu.isVisible();
    if (menuFirst) {
      await tabTo(menu);
      await page.keyboard.press('Enter');
      await expect(page.locator('header details.menu')).toHaveJSProperty(
        'open',
        true,
      );
    }
    for (const sel of [
      'header .wordmark',
      'header [data-theme-toggle]',
      'header details.lang-switch > summary',
      'header nav a:nth-of-type(1)',
      'header nav a:nth-of-type(2)',
      'header nav a:nth-of-type(3)',
    ]) {
      const el = page.locator(sel);
      await expect(el, sel).toBeVisible();
      await expect(el, sel).not.toHaveAttribute('tabindex', '-1');
      // The wordmark sits just before the menu, so from the opened menu the
      // walk to it goes back.
      await tabTo(
        el,
        menuFirst && sel === 'header .wordmark' ? 'backwards' : 'forwards',
      );
      await expect(el, sel).toBeFocused();
    }
  });

  test('no header link overrides the visitor’s own Tab preference', async ({
    page,
  }) => {
    // The nav links once carried a redundant tabindex="0". It changes nothing
    // on Chromium or Firefox, but on Safari it FORCES a link into the Tab
    // sequence even when the visitor has chosen to keep links out of it — so
    // Tab reached Services/Work/Contact while silently skipping the wordmark
    // and the language switcher, an inconsistency created by our markup rather
    // than chosen by anyone. Links are focusable natively; the attribute is
    // redundant everywhere it is not actively harmful.
    await page.goto('/');
    const headerLinks = await page
      .locator('header a')
      .evaluateAll((els) =>
        els.map((e) => e.className || e.textContent?.trim()),
      );
    const withTabindex = await page
      .locator('header a[tabindex]')
      .evaluateAll((els) =>
        els.map(
          (e) =>
            `${e.className || e.textContent?.trim()}=${e.getAttribute('tabindex')}`,
        ),
      );
    expect(
      searched(withTabindex, { of: headerLinks, what: 'header links' }),
    ).toEqual([]);
  });
});

// One journey per locale, its widths inside (#1086; Shyden 2026-11-13, "One
// test, widths inside"). Four tests per locale used to load the homepage and
// open its menu: the touch targets at 375px, the nav row at 1280px, the nav
// after the menu was opened narrower, and no sideways scroll at 320px with
// the menu open, plus the zero-JS menu in English at 375px. A real phone has
// one width (#1046), so it ran that journey four or five times over. Now an
// emulated target walks each width on its own load, as before, and a phone
// makes every width's checks on its one load.
//
// Every locale (#390 F134): a target's WIDTH is its label's, so a
// two-character Chinese nav label is exactly the case a "including width"
// check exists for, and the open phone menu lays out each language's own
// labels at 320px for the same reason. One test per locale: each has its own
// budget, and a failure names its language in the title.
test.describe('the header and its menu, at every width', () => {
  for (const locale of LOCALES)
    test(`${locale}: touch targets, the nav at each width, and no sideways scroll with the menu open`, async ({
      page,
    }) => {
      const labels = Object.values(getSiteStrings(locale).nav);
      await eachWidth(
        page,
        [320, 375, 1280].map((width) => ({ width, height: 800 })),
        async (took, asked) => {
          await page.goto(localisePath('/', locale));
          const details = page.locator('header details.menu');
          const summary = page.locator('header details.menu > summary');
          const links = page.locator('header nav a');

          if (asked.includes(375)) {
            // Touch targets before the menu opens.
            await atLeast44(page.locator('.wordmark'), 'the wordmark');
            // Derived, not named: the header gained a second disclosure (the
            // language switcher) after this test was written, and a
            // hand-written list would have kept passing while missing it. The
            // selector was then narrowed to `details.menu`, which measured
            // the menu alone (#390 F107), so the count is held to every
            // disclosure.
            const summaries = page.locator('header details > summary');
            const howMany = await summaries.count();
            expect
              .soft(howMany, 'no header disclosures found to measure')
              .toBeGreaterThan(0);
            expect
              .soft(howMany, 'a header disclosure left unmeasured')
              .toBe(await page.locator('header details').count());
            for (let i = 0; i < howMany; i += 1)
              await atLeast44(summaries.nth(i), `header disclosure ${i}`);
            if (locale === 'en') {
              // Zero-JS disclosure: closed by default, the nav is hidden.
              await expect.soft(details).toHaveJSProperty('open', false);
              await expect.soft(links.first()).toBeHidden();
            }
          }

          // The nav brought into view as a visitor at this width would: a
          // real tap on the menu where the width shows one (#1046).
          const shown = await revealNav(page);

          if (asked.includes(375) || asked.includes(320))
            expect
              .soft(shown, `${took.width}px puts the nav behind the menu`)
              .toBe('menu');

          if (asked.includes(375)) {
            // `.all()` resolves to [] when nothing matches, so the count comes
            // first, from the locale's own nav labels: a literal 3 went stale
            // when #403 added a fourth link.
            await expect.soft(links).toHaveCount(labels.length);
            await expect.soft(links).toHaveText(labels);
            for (const a of await links.all())
              await atLeast44(a, `"${await a.textContent()}"`);
            await atLeast44(
              page.locator('footer a[href="mailto:support@shyden.co.uk"]'),
              'the footer email',
            );
            if (locale === 'en') {
              // Opened by a tap: the nav is revealed, with no JS involved.
              await expect.soft(details).toHaveJSProperty('open', true);
              await expect.soft(links.first()).toBeVisible();
            }
          }

          if (asked.includes(320))
            await expectNoHorizontalScroll(
              page,
              `${locale}: sideways scroll at ${took.width}px with the menu open`,
            );

          if (asked.includes(1280)) {
            await expect.soft(links).toHaveCount(labels.length);
            await expect.soft(links).toHaveText(labels);
            for (const a of await links.all()) {
              // Guards the all-browser desktop-nav regression: a collapsed
              // wrapper made these links render off-screen / non-visible on
              // every engine.
              await expect.soft(a).toBeVisible();
              await atLeast44(a, `"${await a.textContent()}"`);
            }
            // The last link (Contact) previously overflowed past the edge.
            const lastBox = await links.last().boundingBox();
            expect
              .soft(lastBox!.x + lastBox!.width)
              .toBeLessThanOrEqual(await layoutWidth(page));
          }

          if (asked.includes(375)) {
            if (locale === 'en') {
              // Keyboard: native <summary> activation toggles the disclosure
              // on Enter. Then it is opened again, by a tap, for the check
              // after it.
              await tabTo(summary);
              await page.keyboard.press('Enter');
              await expect.soft(details).toHaveJSProperty('open', false);
              await expect.soft(links.first()).toBeHidden();
              await revealNav(page);
            }
            // #423: the nav takes the layout its width implies, even after
            // the menu was opened narrower. An emulated target is widened
            // WITHOUT a reload; a real phone keeps its own width (#1046).
            await atViewport(page, { width: 1280, height: 800 });
            const nav = page.locator('header nav');
            if (await summary.isVisible()) {
              await expect.soft(nav).toHaveCSS('flex-direction', 'column');
              await expect.soft(nav).toHaveCSS('position', 'absolute');
            } else {
              await expect.soft(nav).toHaveCSS('flex-direction', 'row');
              await expect.soft(nav).toHaveCSS('position', 'static');
            }
            const lastBox = await links.last().boundingBox();
            expect
              .soft(lastBox!.x + lastBox!.width)
              .toBeLessThanOrEqual(await layoutWidth(page));
          }
        },
      );
    });
});

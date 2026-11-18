import { test, expect } from './fixtures';
import { recorded, shoot } from './evidence';
import { atLeast44, expectNoHorizontalScroll } from '../viewport';
import { LOCALES, localisePath } from '../../src/lib/i18n';

test.use(recorded);

test.describe('header + footer', () => {
  test(
    'nav links point to the section anchors in scroll order',
    { tag: '@emulated-viewport' },
    async ({ page }) => {
      // Pin desktop width: on mobile the nav is hidden until the disclosure opens,
      // so this viewport-dependent test sets its own width (not the project's).
      await page.setViewportSize({ width: 1280, height: 800 });
      await page.goto('/');
      const nav = page.locator('header nav');
      await expect(nav.locator('a')).toHaveText([
        'ShyTalk',
        'Tools',
        'Contact',
      ]);
      await expect(nav.locator('a').nth(0)).toHaveAttribute(
        'href',
        '/#shytalk',
      );
      // Aurora renamed these from Services/Work; this spec is the established
      // home for nav-link facts, so the proof belongs here and not in a second
      // guard elsewhere.
      await shoot(
        page,
        'nav reads ShyTalk / Tools / Contact, in scroll order',
        nav,
      );
    },
  );

  test('nav links are root-relative so they work from every page, not just /', async ({
    page,
  }) => {
    // The Header renders on every page via BaseLayout, but #shytalk/#tools/#contact
    // exist only on the homepage — so the nav hrefs must be root-relative (/#…) or
    // they dead-link on sub-pages. Regression guard for the cross-task defect the
    // whole-branch review caught (nav was #shytalk → /glory-points#shytalk = dead).
    await page.goto('/glory-points');
    const hrefs = await page
      .locator('header nav a')
      .evaluateAll((els) => els.map((e) => e.getAttribute('href')));
    expect(hrefs).toEqual(['/#shytalk', '/#tools', '/#contact']);
  });

  // Shyden Ltd is dissolved (operator, 2026-09-27, #370): the footer names no
  // company, no number and no registered office, in any language. What stays
  // is the way to reach a person. The facts are listed once, here, as the
  // things that must not come back; each is a string a visitor once read.
  const DISSOLVED = [
    'Ltd',
    '17110487',
    'Shelton Street',
    'Registered',
    'Terdaftar',
    'Company No',
    'Perusahaan',
  ];

  for (const locale of LOCALES)
    test(`${locale}: the footer names no company, and still reaches a person`, async ({
      page,
    }) => {
      await page.goto(localisePath('/', locale));
      const footer = page.locator('footer');
      await expect(footer).toBeVisible();
      await expect(footer.locator('.disclosure')).toHaveCount(0);
      for (const fact of DISSOLVED)
        await expect(
          footer,
          `${locale} footer still says ${fact}`,
        ).not.toContainText(fact);
      await expect(
        footer.locator('a[href="mailto:support@shyden.co.uk"]'),
      ).toBeVisible();
      await shoot(
        page,
        `${locale} footer: the support email, and no company`,
        footer,
      );
    });

  test(
    'mobile menu: zero-JS disclosure reveals and hides the nav',
    { tag: '@emulated-viewport' },
    async ({ page }) => {
      await page.setViewportSize({ width: 375, height: 800 });
      await page.goto('/');
      const details = page.locator('header details.menu');
      const firstLink = page.locator('header nav a').first();
      // Closed by default: the nav is hidden.
      await expect(details).toHaveJSProperty('open', false);
      await expect(firstLink).toBeHidden();
      // Click the summary to open: the nav is revealed (no JS involved).
      await page.locator('header details.menu > summary').click();
      await expect(details).toHaveJSProperty('open', true);
      await expect(firstLink).toBeVisible();
      // Keyboard: native <summary> activation toggles the disclosure on Enter.
      await page.locator('header details.menu > summary').focus();
      await page.keyboard.press('Enter');
      await expect(details).toHaveJSProperty('open', false);
      await expect(firstLink).toBeHidden();
    },
  );

  test(
    'nav stays a horizontal row at desktop even if opened at mobile first',
    { tag: '@emulated-viewport' },
    async ({ page }) => {
      await page.setViewportSize({ width: 375, height: 800 });
      await page.goto('/');
      await page.locator('header details.menu > summary').click(); // open at mobile
      await expect(page.locator('header details.menu')).toHaveJSProperty(
        'open',
        true,
      );
      await page.setViewportSize({ width: 1280, height: 800 }); // resize WITHOUT reload
      const nav = page.locator('header nav');
      await expect(nav).toHaveCSS('flex-direction', 'row');
      await expect(nav).toHaveCSS('position', 'static');
      const lastBox = await page.locator('header nav a').last().boundingBox();
      expect(lastBox!.x + lastBox!.width).toBeLessThanOrEqual(1280);
    },
  );

  // Keyboard access in the header is TWO separate contracts, because engines
  // genuinely disagree about one of them and agree about the other.
  //
  // Safari, by default, does not put plain links in the Tab sequence at all —
  // the visitor opts in with "Press Tab to highlight each item". That is the
  // VISITOR's setting to make, so the Tab-sequence test below runs only where
  // links are tabbed, and the contract that must hold everywhere — that each
  // control can take focus and none is removed from the tab order — is
  // asserted separately, on every engine.
  test(
    'desktop: the header is keyboard-reachable in order (WCAG 2.1.1)',
    { tag: '@emulated-viewport' },
    async ({ page, browserName }) => {
      test.skip(
        browserName === 'webkit',
        'Safari omits plain links from the Tab sequence unless the visitor opts in, ' +
          'so a Tab walk here would assert a browser preference, not our markup. ' +
          'Focusability and order are asserted for WebKit in the tests below.',
      );
      await page.setViewportSize({ width: 1280, height: 800 });
      await page.goto('/');
      // Anchor on the language switcher's summary — the last focusable thing
      // in the bar before <nav> — rather than on the wordmark: engines differ on
      // how many Tab presses that gap costs, and an explicit focus() fixes the
      // starting point on all of them. Tab then advances in DOM order, so this
      // asserts OUR running order.
      const languages = page.locator('header details.lang-switch > summary');
      await languages.focus();
      // The theme switch sits immediately before the language switcher
      // (#142 §5). Reached by Shift+Tab, never focused directly, so a switch
      // taken out of the Tab order (tabindex="-1") is stepped over and this
      // fails where a direct focus() would still succeed.
      await page.keyboard.press('Shift+Tab');
      await expect(page.locator('header [data-theme-toggle]')).toBeFocused();
      await page.keyboard.press('Tab');
      await expect(languages).toBeFocused();

      for (const label of ['ShyTalk', 'Tools', 'Contact']) {
        await page.keyboard.press('Tab');
        await expect(
          page.locator('header nav a', { hasText: label }),
        ).toBeFocused();
      }
    },
  );

  test(
    'every header link can take focus, on every engine',
    { tag: '@emulated-viewport' },
    async ({ page }) => {
      // The contract that holds regardless of the visitor's Tab preference:
      // asserted with an explicit focus() rather than a Tab press, so it measures
      // our markup and not Safari's default. This is the whole header, not just
      // the language switcher — a control left out here would be unreachable by
      // keyboard even for a visitor who HAS opted in.
      await page.setViewportSize({ width: 1280, height: 800 });
      await page.goto('/');
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
        await el.focus();
        await expect(el, sel).toBeFocused();
      }
    },
  );

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
    const withTabindex = await page
      .locator('header a[tabindex]')
      .evaluateAll((els) =>
        els.map(
          (e) =>
            `${e.className || e.textContent?.trim()}=${e.getAttribute('tabindex')}`,
        ),
      );
    expect(withTabindex).toEqual([]);
  });
});

test.describe('touch targets ≥ 44×44px (WCAG / mobile-first)', () => {
  test(
    'mobile: wordmark, menu button, nav links and footer email are ≥44px',
    { tag: '@emulated-viewport' },
    async ({ page }) => {
      await page.setViewportSize({ width: 375, height: 800 });
      await page.goto('/');
      await atLeast44(page.locator('.wordmark'));
      // Derived, not named: the header gained a second disclosure (the
      // language switcher) after this test was written, and a hand-written
      // list would have kept passing while missing it.
      const summaries = page.locator('header details.menu > summary');
      const howMany = await summaries.count();
      expect(howMany, 'no header disclosures found to measure').toBeGreaterThan(
        0,
      );
      for (let i = 0; i < howMany; i += 1) await atLeast44(summaries.nth(i));
      await page.locator('header details.menu > summary').click(); // open the nav
      const links = page.locator('header nav a');
      // `.all()` resolves to [] when nothing matches -- it neither waits nor
      // fails -- so without this count the loop below iterates zero times and
      // the test goes green having checked none of the links its own title
      // claims to check. Proven, not assumed: pointing this locator at a
      // non-existent class left the test passing. The desktop case alongside
      // has always guarded this; the mobile one did not.
      await expect(links).toHaveCount(3);
      for (const a of await links.all()) await atLeast44(a);
      await atLeast44(
        page.locator('footer a[href="mailto:support@shyden.co.uk"]'),
      );
    },
  );

  test(
    'desktop: nav links are visible, on-screen and ≥44px including width',
    { tag: '@emulated-viewport' },
    async ({ page }) => {
      await page.setViewportSize({ width: 1280, height: 800 });
      await page.goto('/');
      const links = page.locator('header nav a');
      await expect(links).toHaveCount(3);
      for (const a of await links.all()) {
        // Guards the all-browser desktop-nav regression: a collapsed wrapper made
        // these links render off-screen / non-visible on every engine.
        await expect(a).toBeVisible();
        await atLeast44(a);
      }
      // The last link (Contact) previously overflowed past the viewport edge.
      const lastBox = await links.last().boundingBox();
      expect(lastBox!.x + lastBox!.width).toBeLessThanOrEqual(1280);
    },
  );
});

test.describe('mobile layout: no horizontal overflow', () => {
  test(
    'no horizontal scroll at 320px with the menu open',
    { tag: '@emulated-viewport' },
    async ({ page }) => {
      await page.setViewportSize({ width: 320, height: 800 });
      await page.goto('/');
      await page.locator('header details.menu > summary').click();
      await expectNoHorizontalScroll(page);
    },
  );
});

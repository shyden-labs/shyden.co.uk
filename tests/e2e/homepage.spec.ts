import type { Page } from '@playwright/test';
import { test, expect } from './fixtures';
import { recorded, shoot } from './evidence';
import { recordErrors } from './recorders';
import { SHYTALK_MARK, asComputedRgb } from '../../src/lib/shytalk-brand';
import {
  LOCALES,
  getSiteStrings,
  localisePath,
  type Locale,
} from '../../src/lib/i18n';
import { expectNoHorizontalScroll } from '../viewport';
import { THEMES } from '../palette';
import { emulateTheme, expectTheme, saveTheme } from '../themes';
import { contrastRatio } from './helpers';

test.use(recorded);

// Unset in test builds, so the page falls back to the production host. The
// dev deploy sets PUBLIC_SHYTALK_URL and is covered by the deploy-gate specs.
const SHYTALK_URL = 'https://shytalk.shyden.co.uk';
const SHYTALK_HOST = 'shytalk.shyden.co.uk';
// The same rule for Yawelo Idle (#403): PUBLIC_YAWELO_IDLE_URL is unset here, so
// the page links the production host. That host has no DNS record yet, by the
// operator's choice (2026-10-04), which no assertion here depends on: these
// read the href, they never follow it.
const YAWELO_IDLE_URL = 'https://yawelo-idle.shyden.co.uk';
const YAWELO_IDLE_HOST = 'yawelo-idle.shyden.co.uk';

test.describe('homepage content', () => {
  // #370: the hero names no company. The label above the heading is gone in
  // every locale, and the English heading and title are the operator's pair
  // (chosen 2026-09-27 from four).
  // One test per locale (#420).
  for (const locale of LOCALES)
    test(`${locale}: the hero has no label above its heading`, async ({
      page,
    }) => {
      await page.goto(localisePath('/', locale));
      await expect(page.locator('.hero h1')).toBeVisible();
      await expect(page.locator('.hero .eyebrow')).toHaveCount(0);
    });

  test('the heading and the title say what Shyden makes', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('.hero h1')).toHaveText(
      'Shyden makes small software, with care.',
    );
    await expect(page).toHaveTitle('Shyden — small software, made with care');
  });

  test('the hero leads with ShyTalk and every section is present', async ({
    page,
  }) => {
    await page.goto('/');
    await expect(page.locator('h1')).toContainText(/Shyden/i);
    const cta = page.locator('.hero').getByRole('link', {
      name: /explore shytalk/i,
    });
    await expect(cta).toHaveAttribute('href', SHYTALK_URL);
    // Both halves, or neither: noopener denies the opened page a handle back
    // to ours, noreferrer withholds the referrer.
    await expect(cta).toHaveAttribute('rel', 'noopener noreferrer');
    await expect(cta).toHaveAttribute('target', '_blank');
    for (const id of ['shytalk', 'yawelo-idle', 'tools', 'contact']) {
      await expect(page.locator(`#${id}`)).toBeVisible();
    }
    await shoot(
      page,
      'the Aurora hero leads with ShyTalk',
      page.locator('.hero'),
    );
  });

  // Both halves of a nav fragment, in every locale.
  //
  // An anchor is a contract between two files with no compiler between them:
  // retiring #services left Header.astro pointing at it, and the typechecker
  // caught all eleven i18n key removals in the same refactor while being blind
  // to this one.
  //
  // The PATH is asserted as well as the fragment, because checking only the
  // fragment on the page you are already on cannot fail: a bare `/#shytalk`
  // served on /id/ would resolve its fragment here and throw a real visitor
  // back to the ENGLISH homepage. Header.astro documents that hazard in a
  // comment and nothing tested it.
  //
  // Every locale, derived (#390 F128): this read en, id and th by hand, so a
  // Chinese or Vietnamese header sending visitors to the English page passed.
  for (const locale of LOCALES) {
    const home = localisePath('/', locale);
    test(`${locale}: every header nav item lands on a section of this page`, async ({
      page,
    }) => {
      await page.goto(home);
      const hrefs = await page
        .locator('header nav a')
        .evaluateAll((links) =>
          links.map((l) => (l as HTMLAnchorElement).getAttribute('href') ?? ''),
        );
      const fragmented = hrefs.filter((h) => h.includes('#'));
      // Liveness: an empty nav passes a per-item loop having checked nothing.
      expect(
        fragmented.length,
        `${home} rendered no fragment nav links at all`,
      ).toBeGreaterThan(0);

      for (const href of fragmented) {
        const [path, fragment] = href.split('#');
        // `/id/#tools` and `/id#tools` both stay put; `/#tools` does not.
        expect(
          path.endsWith('/') ? path : `${path}/`,
          `${home}: nav link ${href} leaves this locale`,
        ).toBe(home);
        await expect(
          page.locator(`#${fragment}`),
          `${home}: nav points at #${fragment}, which the page does not render`,
        ).toHaveCount(1);
      }
      // A section id is a contract with no compiler between the files —
      // retiring #services left the header linking at nothing, and `astro
      // check` cannot see it.
      await shoot(
        page,
        `${home}: all ${fragmented.length} nav fragments resolve in-locale`,
        page.locator('header'),
      );
    });
  }

  test('the ShyTalk showcase carries the brand wordmark and links out', async ({
    page,
  }) => {
    await page.goto('/');
    const showcase = page.locator('#shytalk');
    const wordmark = showcase.locator('.shytalk-wordmark');
    await expect(wordmark).toHaveText('ShyTalk');
    await expect(wordmark.locator('span')).toHaveText('Talk');
    // The two-tone logo colours, READ FROM the single source they are
    // rendered from. A literal triple here is unsearchable and survives a
    // rebrand as a silently wrong expectation.
    await expect(wordmark).toHaveCSS('color', asComputedRgb(SHYTALK_MARK.shy));
    await expect(wordmark.locator('span')).toHaveCSS(
      'color',
      asComputedRgb(SHYTALK_MARK.talk),
    );
    await expect(showcase.locator('.features li')).toHaveCount(4);
    await expect(
      showcase.locator(`a[href="${SHYTALK_URL}"]`).last(),
    ).toHaveAttribute('rel', 'noopener noreferrer');
    await shoot(
      page,
      'the ShyTalk showcase and its two-tone wordmark',
      showcase,
    );
  });

  // #142 §3.4, AC14: the mark keeps its own tones in both themes, sits on its
  // own tile in light and on nothing in dark, and prints in the page's own ink
  // with no tile. The tile is pinned to SHYTALK_MARK, the brief, never read
  // back from tokens.css: a value read from the file the page is built from
  // moves with the page, and asserts nothing (S22). One test per theme, and
  // paper its own (#420).
  const TILE = {
    light: asComputedRgb(SHYTALK_MARK.tile),
    dark: 'rgba(0, 0, 0, 0)',
  } as const;
  for (const theme of THEMES)
    test(`${theme}: the ShyTalk wordmark keeps its tones, on its own tile in light only`, async ({
      page,
    }) => {
      await page.goto('/');
      const wordmark = page.locator('#shytalk .shytalk-wordmark');
      await emulateTheme(page, theme);
      await expect(wordmark).toHaveCSS(
        'color',
        asComputedRgb(SHYTALK_MARK.shy),
      );
      await expect(wordmark).toHaveCSS('background-color', TILE[theme]);
    });

  test('on paper: the ShyTalk wordmark prints in the page ink, with no tile', async ({
    page,
  }) => {
    await page.goto('/');
    const wordmark = page.locator('#shytalk .shytalk-wordmark');
    await page.emulateMedia({ media: 'print' });
    const ink = await page
      .locator('body')
      .evaluate((body) => getComputedStyle(body).color);
    await expect(wordmark).toHaveCSS('color', ink);
    await expect(wordmark).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
  });

  // The point of #138 is that the Thai page shows the app IN THAI. One test
  // per locale proves each capture arrives (#420); the test after it holds
  // the load-bearing fact, that the five are DISTINCT, because "an image
  // exists" is satisfied by one capture under five names.
  for (const locale of LOCALES)
    test(`${locale}: the showcase frame shows a real room capture`, async ({
      page,
    }) => {
      await page.goto(localisePath('/', locale));
      const img = page.locator('#shytalk .frame img');
      await expect(img).toHaveCount(1);

      const alt = (await img.getAttribute('alt')) ?? '';
      expect(alt.trim().length, 'alt text').toBeGreaterThan(0);

      // The frame is below the fold and the image is lazy, so it must be
      // scrolled to before it will load at all.
      await img.scrollIntoViewIfNeeded();
      // A broken src still renders an <img> element and still passes
      // toHaveCount(1). naturalWidth is the only thing that separates "the
      // markup is there" from "the picture arrived".
      await expect
        .poll(
          () => img.evaluate((el) => (el as HTMLImageElement).naturalWidth),
          { message: 'capture never decoded' },
        )
        .toBeGreaterThan(0);

      // One frame per locale is the whole ticket, so it is the whole evidence:
      // the operator judges the Thai capture is Thai by looking at it. Clipped
      // to the section so the two-column layout he chose is visible alongside.
      await shoot(
        page,
        `${locale}: the showcase shows a real room capture in that locale`,
        page.locator('#shytalk'),
      );
    });

  // A cross-case fact, so one test, but it renders nothing per language: each
  // homepage's HTML is fetched and its frame's src read in place.
  test('the showcase frame is a different capture in every locale', async ({
    page,
    request,
  }) => {
    const pages = await Promise.all(
      LOCALES.map(async (locale) =>
        (await request.get(localisePath('/', locale))).text(),
      ),
    );
    await page.goto('/');
    const srcs = await page.evaluate(
      (htmls) =>
        htmls.map(
          (html) =>
            new DOMParser()
              .parseFromString(html, 'text/html')
              .querySelector('#shytalk .frame img')
              ?.getAttribute('src') ?? '',
        ),
      pages,
    );
    expect(srcs.filter(Boolean), 'a frame with no src').toHaveLength(
      LOCALES.length,
    );
    expect(
      new Set(srcs).size,
      `distinct captures across ${LOCALES.join(', ')}: ${srcs.join(', ')}`,
    ).toBe(LOCALES.length);
  });

  // A badge's text sits on --glass, a translucent fill, over the card's
  // opaque --surface: the one rendered stack of that shape, so it is what
  // proves contrastRatio composites every layer rather than putting the
  // first over white (#390 F127). Both dark routes, since the device's
  // setting and a saved choice reach different blocks of tokens.css. One
  // test per route (#420).
  const BADGE_ROUTES: ReadonlyArray<{
    name: string;
    show: (page: Page) => Promise<void>;
  }> = [
    ...THEMES.map((theme) => ({
      name: `${theme}, from the device`,
      show: (page: Page) => emulateTheme(page, theme),
    })),
    {
      name: 'dark, saved over a light device',
      show: async (page: Page) => {
        await emulateTheme(page, 'light');
        await saveTheme(page, 'dark');
        await expectTheme(page, 'dark');
      },
    },
  ];
  for (const route of BADGE_ROUTES)
    // Four badges since #403: each tool's "Live now" on its card, and each
    // product's "Coming soon" straight on the page atmosphere, a different
    // stack under the same glass fill.
    test(`${route.name}: every status badge clears AA as painted`, async ({
      page,
    }) => {
      await page.goto('/');
      const badges = page.locator('.status-badge');
      await expect(badges).toHaveCount(4);
      await route.show(page);
      for (const badge of await badges.all())
        expect(
          await contrastRatio(badge),
          `"${await badge.textContent()}"`,
        ).toBeGreaterThanOrEqual(4.5);
    });

  // Every locale (#390 F129). On `/` the English path is also the right one,
  // so English alone cannot fail "in-locale"; this read only `/`, and the
  // Indonesian half sat in classroom-groups.spec.ts with zh, vi and th unread.
  // One test per locale, so each has its own budget and names its language.
  for (const locale of LOCALES)
    test(`${locale}: exactly two tool cards, each badged and linked in-locale`, async ({
      page,
    }) => {
      await page.goto(localisePath('/', locale));
      const tools = page.locator('#tools');
      await expect(tools.locator('.work-card')).toHaveCount(2);
      // Each card's badge says so, in this locale: #403 moved the words into
      // StatusBadge, and an emptied badge left every count here green.
      const live = getSiteStrings(locale).home.toolBadge;
      const badges = tools.locator('.status-badge');
      await expect(badges).toHaveText([live, live]);
      for (const n of [0, 1]) await expect(badges.nth(n)).toBeVisible();
      // The exact set: each tool once, in this locale, and nothing else.
      const hrefs = await tools
        .locator('a[href]')
        .evaluateAll((links) => links.map((l) => l.getAttribute('href')));
      expect(hrefs.sort(), 'the tool links').toEqual(
        ['/classroom-groups', '/glory-points'].map((tool) =>
          localisePath(tool, locale),
        ),
      );
      await shoot(
        page,
        `${locale}: both tool cards, badged and in-locale`,
        tools,
      );
    });

  test('contact section CTA links to the support mailbox', async ({ page }) => {
    await page.goto('/');
    await expect(
      page.locator('#contact').getByRole('link', { name: /email us/i }),
    ).toHaveAttribute('href', 'mailto:support@shyden.co.uk');
  });

  // Asserting the READ sentence, not just that the parts exist: the label and
  // the host are separate expression nodes, and the space between them is
  // dropped whenever a formatter puts them on separate lines — which shipped
  // "building.support@shyden.co.uk" to real phones on the old contact copy.
  // Checking either node alone cannot see that; only the rendered text can.
  //
  // Keyed by Locale, so a sixth language fails to compile until its sentence
  // is written here (#390 F128): this listed English and Indonesian, the two
  // locales there were when it was written, and never read the other three.
  //
  // Two annotations since #403, one under each product's button, in the order
  // the buttons stand.
  const OPENS: Record<Locale, string> = {
    en: 'opens',
    id: 'membuka',
    zh: '打开',
    vi: 'mở',
    th: 'เปิด',
  };
  for (const locale of LOCALES) {
    test(`${locale}: each hero link annotation reads as one line`, async ({
      page,
    }) => {
      await page.goto(localisePath('/', locale));
      await expect(page.locator('.hero .opens')).toHaveText([
        `${OPENS[locale]} ${SHYTALK_HOST}`,
        `${OPENS[locale]} ${YAWELO_IDLE_HOST}`,
      ]);
    });
  }

  test(
    'call-to-action buttons meet the 44×44px touch target',
    { tag: '@emulated-viewport' },
    async ({ page }) => {
      await page.setViewportSize({ width: 375, height: 800 });
      await page.goto('/');
      const btns = page.locator('.btn');
      await expect(btns.first()).toBeVisible();
      // Written inline rather than hoisted to a variable: the unproved-loop
      // scanner in `tests/unit/event-collectors.test.ts` matches this exact
      // shape, so hoisting makes the loop invisible to it and it silently
      // stops being checked for a liveness proof. Use the recognised idiom
      // instead of widening the guard to fit new code.
      for (const b of await btns.all()) {
        const box = await b.boundingBox();
        expect(box).not.toBeNull();
        expect(Math.round(box!.width)).toBeGreaterThanOrEqual(44);
        expect(Math.round(box!.height)).toBeGreaterThanOrEqual(44);
      }
      await shoot(
        page,
        `375px: all ${await btns.count()} buttons clear 44x44px`,
      );
    },
  );
});

// #403: ShyTalk and Yawelo Idle, both coming soon, with equal weight. Every
// expected string is read from the locale's own catalogue, whose English
// tests/unit/home-copy.test.ts pins to the operator's approved copy; one test
// per locale, so a language that drops a part names itself.
test.describe('two products, both coming soon (#403)', () => {
  for (const locale of LOCALES)
    test(`${locale}: the Yawelo Idle showcase follows ShyTalk's, with its badge, four features and link`, async ({
      page,
    }) => {
      const t = getSiteStrings(locale).home;
      await page.goto(localisePath('/', locale));
      const section = page.locator('#yawelo-idle');
      await expect(section).toBeVisible();
      // Straight after ShyTalk's showcase. ShyTalk's position is asserted
      // first, so a page missing it cannot pass on -1 + 1 = 0.
      const ids = await page
        .locator('section[id]')
        .evaluateAll((sections) => sections.map((s) => s.id));
      expect(ids, 'the sections, in page order').toContain('shytalk');
      expect(ids.indexOf('yawelo-idle'), 'Yawelo Idle follows ShyTalk').toBe(
        ids.indexOf('shytalk') + 1,
      );
      await expect(section.locator('.kicker')).toBeVisible();
      await expect(section.locator('.kicker')).toHaveText(t.yaweloIdleKicker);
      await expect(section.locator('h2')).toBeVisible();
      await expect(section.locator('h2')).toHaveText('Yawelo Idle');
      const badge = section.locator('.showcase-head .status-badge');
      await expect(badge).toBeVisible();
      await expect(badge).toHaveText(t.comingSoon);
      await expect(section.locator('.features li')).toHaveText([
        t.yaweloIdleFeature1,
        t.yaweloIdleFeature2,
        t.yaweloIdleFeature3,
        t.yaweloIdleFeature4,
      ]);
      const link = section.getByRole('link', { name: t.visitYaweloIdle });
      await expect(link).toHaveAttribute('href', YAWELO_IDLE_URL);
      await expect(link).toHaveAttribute('rel', 'noopener noreferrer');
      await expect(link).toHaveAttribute('target', '_blank');
      // Text-only: Yawelo Idle has no art yet, and none is invented here.
      await expect(section.locator('img, svg, picture')).toHaveCount(0);
      await shoot(
        page,
        `${locale}: the Yawelo Idle showcase, coming soon`,
        section,
      );
    });

  for (const locale of LOCALES)
    test(`${locale}: ShyTalk wears the same Coming soon badge beside its heading`, async ({
      page,
    }) => {
      const t = getSiteStrings(locale).home;
      await page.goto(localisePath('/', locale));
      const head = page.locator('#shytalk .showcase-head');
      await expect(head.locator('h2 .shytalk-wordmark')).toBeVisible();
      const badge = head.locator('.status-badge');
      await expect(badge).toBeVisible();
      await expect(badge).toHaveText(t.comingSoon);
      await expect(page.locator('#shytalk .kicker')).toHaveText(
        t.shytalkKicker,
      );
      await shoot(page, `${locale}: ShyTalk, coming soon`, head);
    });

  for (const locale of LOCALES)
    test(`${locale}: the hero offers both products, ShyTalk then Yawelo Idle`, async ({
      page,
    }) => {
      const t = getSiteStrings(locale).home;
      await page.goto(localisePath('/', locale));
      const links = page.locator('.hero .cta-item a');
      await expect(links).toHaveText([t.exploreShytalk, t.exploreYaweloIdle]);
      await expect(links.nth(0)).toHaveAttribute('href', SHYTALK_URL);
      await expect(links.nth(1)).toHaveAttribute('href', YAWELO_IDLE_URL);
      for (const n of [0, 1]) {
        await expect(links.nth(n)).toHaveAttribute(
          'rel',
          'noopener noreferrer',
        );
        await expect(links.nth(n)).toHaveAttribute('target', '_blank');
      }
      await shoot(
        page,
        `${locale}: the hero's two products`,
        page.locator('.hero'),
      );
    });

  for (const locale of LOCALES)
    test(`${locale}: the header links to Yawelo Idle, in this locale`, async ({
      page,
    }) => {
      const home = localisePath('/', locale);
      const base = home === '/' ? '' : home.replace(/\/$/, '');
      await page.goto(home);
      const link = page.locator(`header nav a[href="${base}/#yawelo-idle"]`);
      await expect(link).toHaveCount(1);
      await expect(link).toHaveText(getSiteStrings(locale).nav.yaweloIdle);
    });
});

test.describe('mobile-first layout', () => {
  // Every locale at every width (#423): theme-gallery reads every locale at
  // 320 and 1280px only, so 375 and 768px were read in English alone.
  for (const width of [320, 375, 768, 1280]) {
    for (const locale of LOCALES)
      test(
        `${locale}: no horizontal scroll at ${width}px`,
        { tag: '@emulated-viewport' },
        async ({ page }) => {
          await page.setViewportSize({ width, height: 900 });
          await page.goto(localisePath('/', locale));
          const overflow = await expectNoHorizontalScroll(page);
          // This is the guard the marquee tripped: a rotated-and-scaled element
          // is not clipped by an ancestor's `overflow`, so it pushed 10px of
          // sideways scroll at every width. 1217 unit tests could not see it.
          await shoot(
            page,
            `${locale} ${width}px: horizontal overflow is ${overflow}px`,
          );
        },
      );
  }
  // Every locale (#390 F129): each loads its own capture and copy, and this
  // read only the English page.
  for (const locale of LOCALES)
    test(`${locale}: no console errors on load`, async ({ page }) => {
      const reported = recordErrors(page);
      await page.goto(localisePath('/', locale));
      await reported.expectNone(`the ${locale} homepage loads without errors`);
    });
});

test.describe('reduced motion', () => {
  // #390 F61. The global reduced-motion rule in tokens.css shortened every
  // animation to 0.01ms and left the marquee's `infinite` in place, so the
  // band ran a whole cycle every hundredth of a millisecond. Firefox painted
  // it at a different offset on every frame (measured: -1734, -437, -2744,
  // -1161 …), a strobe for exactly the visitors who asked for less motion;
  // Chromium froze it mid-cycle with the animation still running.
  test('the language band holds still when motion is reduced', async ({
    page,
  }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.goto('/');
    const track = page.locator('.marquee-track');
    await expect(track).toHaveCount(1);
    const offsets = await track.evaluate(async (element) => {
      const frame = () => new Promise((done) => requestAnimationFrame(done));
      const seen: number[] = [];
      for (let i = 0; i < 6; i++) {
        await frame();
        seen.push(new DOMMatrix(getComputedStyle(element).transform).m41);
      }
      return seen;
    });
    expect(
      new Set(offsets).size,
      `the band's offset on six frames: ${offsets.join(', ')}`,
    ).toBe(1);
    const running = await track.evaluate(
      (element) =>
        element.getAnimations().filter((a) => a.playState === 'running').length,
    );
    expect(running, 'animations still running on the band').toBe(0);
    await shoot(page, 'reduced motion: the language band holds still');
  });
});

test.describe('pause motion', () => {
  // #598, WCAG 2.2.2 (Pause, Stop, Hide, level A): the band moves for longer
  // than five seconds with nothing the visitor can do about it, and the
  // operating system's reduce-motion setting is not a mechanism the PAGE
  // provides. The control is a native checkbox beside the band, never inside
  // its aria-hidden subtree, and CSS alone pauses the track: the homepage
  // still ships only the theme script.
  const pauseControl = (page: Page, locale: Locale) =>
    page.getByRole('checkbox', {
      name: getSiteStrings(locale).home.pauseMotion,
      exact: true,
    });
  // The track's offset on six consecutive frames; a moving band gives more
  // than one distinct value. Runs in the page, so it reads what is painted.
  const offsetsOf = (track: ReturnType<Page['locator']>) =>
    track.evaluate(async (element) => {
      const frame = () => new Promise((done) => requestAnimationFrame(done));
      const seen: number[] = [];
      for (let i = 0; i < 6; i++) {
        await frame();
        seen.push(new DOMMatrix(getComputedStyle(element).transform).m41);
      }
      return seen;
    });

  // Whether the band moved across those frames.
  const moves = async (track: ReturnType<Page['locator']>) =>
    new Set(await offsetsOf(track)).size !== 1;

  for (const locale of LOCALES)
    test(`${locale}: a visible, unticked checkbox named for the band, outside its hidden subtree`, async ({
      page,
    }) => {
      await page.goto(localisePath('/', locale));
      const control = pauseControl(page, locale);
      await expect(control).toHaveCount(1);
      await expect(control).toBeVisible();
      await expect(control).not.toBeChecked();
      expect(
        await control.evaluate((el) => el.closest('[aria-hidden="true"]')),
        'the control sits inside an aria-hidden ancestor',
      ).toBeNull();
      await expect(page.locator('.marquee-clip')).toHaveAttribute(
        'aria-hidden',
        'true',
      );
    });

  test('Tab reaches the control from the last link before it, and Space ticks it', async ({
    page,
    browserName,
  }) => {
    await page.goto('/');
    const control = pauseControl(page, 'en');
    // The last focusable thing in the hero is the control's predecessor in
    // tab order: the band follows the hero in the DOM.
    await page.locator('.hero a').last().focus();
    // Safari's Tab skips form controls unless Full Keyboard Access is on;
    // its documented way to reach one is Option+Tab, which is what WebKit
    // here is given. Every other engine takes a plain Tab.
    await page.keyboard.press(browserName === 'webkit' ? 'Alt+Tab' : 'Tab');
    await expect(control).toBeFocused();
    await page.keyboard.press('Space');
    await expect(control).toBeChecked();
  });

  test('ticked pauses the band and unticked resumes it', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    await page.goto('/');
    const track = page.locator('.marquee-track');
    await expect(track).toHaveCount(1);
    const control = pauseControl(page, 'en');
    const running = () =>
      track.evaluate(
        (element) =>
          element.getAnimations().filter((a) => a.playState === 'running')
            .length,
      );

    expect(await moves(track), 'the band moves before it is paused').toBe(true);
    expect(await running(), 'animations running before the pause').toBe(1);

    await control.check();
    await expect(track).toHaveCSS('animation-play-state', 'paused');
    expect(await running(), 'animations running while paused').toBe(0);
    const held = await offsetsOf(track);
    expect(
      new Set(held).size,
      `the band's offset on six frames while paused: ${held.join(', ')}`,
    ).toBe(1);

    await control.uncheck();
    await expect(track).toHaveCSS('animation-play-state', 'running');
    expect(await running(), 'animations running after resuming').toBe(1);
    expect(await moves(track), 'the band moves again once resumed').toBe(true);
  });

  test('with motion reduced and the box unticked the band is still stopped', async ({
    page,
  }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.goto('/');
    await expect(pauseControl(page, 'en')).not.toBeChecked();
    const running = await page
      .locator('.marquee-track')
      .evaluate(
        (element) =>
          element.getAnimations().filter((a) => a.playState === 'running')
            .length,
      );
    expect(running, 'animations running with motion reduced').toBe(0);
  });

  // At 320px, in every locale: measured, because Thai and Vietnamese run long.
  for (const locale of LOCALES)
    test(
      `${locale}: at 320px the label fits its band and the control is 44px tall`,
      { tag: '@emulated-viewport' },
      async ({ page }) => {
        await page.setViewportSize({ width: 320, height: 800 });
        await page.goto(localisePath('/', locale));
        const control = pauseControl(page, locale);
        const label = page.locator('.band-pause');
        await expect(label).toHaveCount(1);
        const box = await label.boundingBox();
        const band = await page.locator('.band').boundingBox();
        expect(box).not.toBeNull();
        expect(band).not.toBeNull();
        expect(
          box!.x,
          'label starts inside the viewport',
        ).toBeGreaterThanOrEqual(0);
        expect(
          box!.x + box!.width,
          'label ends inside the viewport',
        ).toBeLessThanOrEqual(320);
        expect(
          box!.x + box!.width,
          'label ends inside its band',
        ).toBeLessThanOrEqual(band!.x + band!.width + 0.5);
        expect(Math.round(box!.height)).toBeGreaterThanOrEqual(44);
        // The text itself must not be clipped by the label's own box.
        const clipped = await control.evaluate((input) => {
          const text = input.parentElement!.querySelector('span')!;
          return text.scrollWidth - text.clientWidth;
        });
        expect(clipped, 'label text overflows its own box').toBeLessThanOrEqual(
          0,
        );
        await expectNoHorizontalScroll(page);
      },
    );

  for (const theme of THEMES)
    test(`${theme}: the label clears AA against what is painted behind it`, async ({
      page,
    }) => {
      await page.goto('/');
      await emulateTheme(page, theme);
      const ratio = await contrastRatio(page.locator('.band-pause span'));
      expect(
        ratio,
        `${theme}: the label's painted contrast`,
      ).toBeGreaterThanOrEqual(4.5);
    });
});

test.describe('the ShyTalk phone frame', () => {
  // #390 F62. The bezel read `var(--line)`, a property defined nowhere, so the
  // whole border declaration was invalid and computed to `0px none`: the
  // frame the component describes was never drawn. Its image's aspect-ratio
  // divided two lengths (`280px / 616px`), which CSS refuses, so it computed
  // to `auto` and only the width and height attributes held the shape.
  test('the bezel is drawn and the capture keeps its ratio', async ({
    page,
  }) => {
    await page.goto('/');
    const frame = page.locator('.frame');
    await expect(frame).toHaveCount(1);
    const drawn = await frame.evaluate((element) => {
      const probe = document.createElement('span');
      probe.style.color = 'var(--border)';
      document.body.append(probe);
      const border = getComputedStyle(probe).color;
      probe.remove();
      const style = getComputedStyle(element);
      const image = element.querySelector('img');
      return {
        width: style.borderTopWidth,
        style: style.borderTopStyle,
        color: style.borderTopColor,
        border,
        ratio: image ? getComputedStyle(image).aspectRatio : 'no image',
      };
    });
    expect(drawn.style, 'bezel border style').toBe('solid');
    expect(drawn.width, 'bezel border width').toBe('2px');
    expect(drawn.color, 'bezel border colour is --border').toBe(drawn.border);
    expect(drawn.ratio, "the capture's aspect-ratio").toBe('280 / 616');
    await shoot(page, 'the ShyTalk phone frame draws its bezel');
  });
});

import type { Page } from '@playwright/test';
import { test, expect } from './fixtures';
import { recorded, shoot } from './evidence';
import {
  recordErrors,
  recordRequests,
  requestsEveryEngineMakes,
  urlMatching,
} from './recorders';
import { SHYTALK_MARK, asComputedRgb } from '../../src/lib/shytalk-brand';
import {
  LOCALES,
  getSiteStrings,
  localisePath,
  type Locale,
} from '../../src/lib/i18n';
import { floorBreach } from '../floors';
import { searched } from '../source-files';
import { expectNoHorizontalScroll } from '../viewport';
import { readsAsLineWidth } from '../device-pixels';
import { THEMES } from '../palette';
import { emulateTheme, expectTheme, saveTheme } from '../themes';
import { contrastRatio } from './helpers';
import { contrast, parseColour } from '../wcag';

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
        ['/classroom-groups', '/yeetalk-calculators'].map((tool) =>
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
    // The label from the catalogue, not a copy of it: #665 changed "Email us"
    // to "Email me", and a literal here went red on copy it does not judge.
    await expect(
      page.locator('#contact').getByRole('link', {
        name: getSiteStrings('en').home.emailMe,
        exact: true,
      }),
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
      // scanner in `tests/guards/event-collectors.test.ts` matches this exact
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
      // No image is invented here: its one picture is the preview video's
      // poster, from the shared media host (the preview's tests below).
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

// The six widths the band is held to (#599 AC2): the four #423 read, plus 390
// (the common phone) and 1024 (the tablet-landscape edge).
const BAND_WIDTHS = [320, 375, 390, 768, 1024, 1280];

test.describe('the language band sits under the header (#599)', () => {
  // The band is the first thing after the header, in normal flow: it scrolls
  // away and is never pinned (operator, 2026-10-07).
  for (const locale of LOCALES)
    test(`${locale}: the band is the first element in main, before the hero, and not pinned`, async ({
      page,
    }) => {
      await page.goto(localisePath('/', locale));
      await expect(page.locator('main > .band')).toHaveCount(1);
      const facts = await page.evaluate(() => {
        const main = document.querySelector('main');
        const band = document.querySelector('.band');
        const hero = document.querySelector('.hero');
        if (!main || !band || !hero)
          throw new Error('main, band or hero missing');
        const positions = [
          band,
          band.querySelector('.marquee-clip'),
          band.querySelector('.marquee'),
        ].map((el) => (el ? getComputedStyle(el).position : 'missing'));
        return {
          first: main.firstElementChild === band,
          before: !!(
            band.compareDocumentPosition(hero) &
            Node.DOCUMENT_POSITION_FOLLOWING
          ),
          positions,
        };
      });
      expect(
        facts.first,
        'the band is not the first element child of main',
      ).toBe(true);
      expect(facts.before, 'the band does not precede the hero').toBe(true);
      expect(
        searched(
          facts.positions.filter(
            (p) => p === 'sticky' || p === 'fixed' || p === 'missing',
          ),
          { of: facts.positions, what: 'band elements whose position is read' },
        ),
        'the band, its clip or its strip is pinned',
      ).toEqual([]);
      expect(
        floorBreach('homepage/band-positions', facts.positions.length),
      ).toBeUndefined();
      expect(facts.positions).toHaveLength(3);
      await shoot(
        page,
        `${locale}: the band is first in main, before the hero, unpinned`,
      );
    });

  // Geometry of the rendered page, read in the page. `clip` is the band's own
  // clip box: the rotated strip never paints outside it.
  const readBand = (page: Page) =>
    page.evaluate(() => {
      const box = (selector: string) => {
        const el = document.querySelector(selector);
        if (!el) throw new Error(`${selector} missing`);
        const r = el.getBoundingClientRect();
        return { top: r.top, bottom: r.bottom, left: r.left, right: r.right };
      };
      return { header: box('header'), clip: box('.marquee-clip') };
    });

  // AC3 at load: the band and the header do not intersect.
  for (const width of BAND_WIDTHS)
    test(
      `at ${width}px the band and the header do not intersect at load`,
      { tag: '@emulated-viewport' },
      async ({ page }) => {
        await page.setViewportSize({ width, height: 900 });
        await page.goto('/');
        const { header, clip } = await readBand(page);
        expect(
          clip.top,
          `the band's top (${clip.top}) is above the header's bottom (${header.bottom})`,
        ).toBeGreaterThanOrEqual(header.bottom);
        await shoot(
          page,
          `${width}px: the band starts at ${Math.round(clip.top)}px, the header ends at ${Math.round(header.bottom)}px`,
        );
      },
    );

  // AC3 after scrolling: the band is unpinned, so it passes beneath the
  // sticky header, and wherever the two meet the header is the topmost thing.
  // `elementFromPoint` is what a click would hit, so it reads the painted
  // stacking order, which a bounding box cannot.
  for (const width of BAND_WIDTHS)
    test(
      `at ${width}px the header paints above the band as it scrolls beneath`,
      { tag: '@emulated-viewport' },
      async ({ page }) => {
        await page.setViewportSize({ width, height: 900 });
        await page.goto('/');
        const hit = await page.evaluate(async () => {
          const header = document.querySelector('header');
          const clip = document.querySelector('.marquee-clip');
          if (!header || !clip) throw new Error('header or band missing');
          const headerHeight = header.getBoundingClientRect().height;
          // The band's top edge halfway up under the header.
          window.scrollTo(
            0,
            clip.getBoundingClientRect().top +
              window.scrollY -
              headerHeight / 2,
          );
          const frame = () =>
            new Promise((done) => requestAnimationFrame(done));
          await frame();
          await frame();
          const h = header.getBoundingClientRect();
          const c = clip.getBoundingClientRect();
          const top = Math.max(h.top, c.top);
          const bottom = Math.min(h.bottom, c.bottom);
          const y = top + (bottom - top) / 2;
          // Runs in the page over a population that exists only at runtime:
          // the overlap's own sample points.
          const samples = [0.1, 0.5, 0.9].map((f) => {
            const x = window.innerWidth * f;
            const el = document.elementFromPoint(x, y);
            return {
              inHeader: !!el?.closest('header'),
              inBand: !!el?.closest('.band'),
            };
          });
          return { overlap: bottom - top, samples };
        });
        // Liveness: the two really overlap, or nothing below was tested.
        expect(
          hit.overlap,
          'the band never reached under the header',
        ).toBeGreaterThan(0);
        expect(
          searched(
            hit.samples.filter((s) => !s.inHeader || s.inBand),
            { of: hit.samples, what: 'points sampled across the overlap' },
          ),
          'the band paints over the header',
        ).toEqual([]);
        expect(
          floorBreach('homepage/overlap-samples', hit.samples.length),
        ).toBeUndefined();
        expect(hit.samples).toHaveLength(3);
        await shoot(
          page,
          `${width}px: the header is the topmost thing over ${Math.round(hit.overlap)}px of overlap`,
        );
      },
    );

  // AC1: the band scrolls away with the page.
  test('the band scrolls away: past it, its box is above the viewport', async ({
    page,
  }) => {
    await page.goto('/');
    const bottom = await page.evaluate(async () => {
      const clip = document.querySelector('.marquee-clip');
      if (!clip) throw new Error('band missing');
      window.scrollTo(
        0,
        clip.getBoundingClientRect().bottom + window.scrollY + 1,
      );
      await new Promise((done) => requestAnimationFrame(done));
      return clip.getBoundingClientRect().bottom;
    });
    expect(
      bottom,
      'the band is still on screen after scrolling past it',
    ).toBeLessThanOrEqual(0);
    await shoot(
      page,
      `scrolled past, the band's bottom is at ${Math.round(bottom)}px`,
    );
  });
});

test.describe('mobile-first layout', () => {
  // Every locale at every width (#423): theme-gallery reads every locale at
  // 320 and 1280px only, so 375 and 768px were read in English alone.
  for (const width of BAND_WIDTHS) {
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

  test('Shift+Tab from the first hero link reaches the control, and Space ticks it', async ({
    page,
    browserName,
  }) => {
    await page.goto('/');
    const control = pauseControl(page, 'en');
    // The band now sits before the hero in the DOM (#599), so the control is
    // the first hero link's predecessor in tab order.
    await page.locator('.hero a').first().focus();
    // Safari's Tab skips form controls unless Full Keyboard Access is on;
    // its documented way to reach one is Option+Tab, which is what WebKit
    // here is given. Every other engine takes a plain Tab.
    await page.keyboard.press(
      browserName === 'webkit' ? 'Alt+Shift+Tab' : 'Shift+Tab',
    );
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
    // Reduced motion does not remove the band's animation: tokens.css makes
    // it ONE 0.01 ms iteration, so it finishes at once (#390 F61). Until the
    // next animation frame ticks it to its end it reads `running`, and the
    // old count straight after goto could beat that frame on a loaded runner
    // (#669, seen on #668's CI). Once finished (no `fill`) it leaves
    // `getAnimations()` altogether, so the band's own declaration is the
    // liveness probe, not the list. Wait for whatever is still there to
    // finish -- a promise, never a timer; one that never finishes (motion
    // not reduced) fails on the test's own budget -- and judge it then.
    const band = await page
      .locator('.marquee-track')
      .evaluate(async (element) => {
        await Promise.all(element.getAnimations().map((a) => a.finished));
        return {
          declared: getComputedStyle(element).animationName,
          running: element
            .getAnimations()
            .filter((a) => a.playState === 'running').length,
        };
      });
    expect(band.declared, 'the band declares its animation').toBe(
      'marquee-slide',
    );
    expect(band.running, 'animations running with motion reduced').toBe(0);
  });

  // The control shows no words, so what a long label once risked (Thai and
  // Vietnamese running past the band) is now the screen-reader text's to
  // risk: it is absolutely positioned, and an absolute box with nothing to
  // contain it can land anywhere, which at 320px means sideways scroll.
  for (const locale of LOCALES)
    test(
      `${locale}: at 320px the control and its hidden name stay inside the band, with no sideways scroll`,
      { tag: '@emulated-viewport' },
      async ({ page }) => {
        await page.setViewportSize({ width: 320, height: 800 });
        await page.goto(localisePath('/', locale));
        const target = page.locator('.band-pause');
        await expect(target).toHaveCount(1);
        const inside = await target.evaluate((label) => {
          const band = label.closest('.band')!.getBoundingClientRect();
          return [label, ...label.querySelectorAll('*')].map((el) => {
            const r = el.getBoundingClientRect();
            return {
              what: el.tagName.toLowerCase() + '.' + el.getAttribute('class'),
              ok:
                r.left >= band.left - 0.5 &&
                r.right <= band.right + 0.5 &&
                r.left >= 0 &&
                r.right <= 320,
            };
          });
        });
        expect(
          searched(
            inside.filter((box) => !box.ok).map((box) => box.what),
            { of: inside, what: 'boxes in the pause control' },
          ),
          'boxes in the control that leave the band or the viewport',
        ).toEqual([]);
        expect(
          inside.map((box) => box.what),
          'the boxes the control is built from, each measured',
        ).toEqual(
          expect.arrayContaining([
            'label.band-pause',
            'input.null',
            'span.band-pause-disc',
            'svg.band-pause-icon',
            // its whole class attribute: the name wears the global recipe (#767)
            'span.band-pause-name visually-hidden',
          ]),
        );
        expect(
          floorBreach('homepage/pause-control-boxes', inside.length),
        ).toBeUndefined();
        await expectNoHorizontalScroll(page);
      },
    );
});

test.describe('the pause control is a small icon on the strip (#619)', () => {
  // Operator 2026-10-07: "make the pause pill much smaller, it's huge". The
  // pill (#606) becomes a 28px disc with an inline SVG icon and no visible
  // words; its name stays the locale's `pauseMotion`, read by a screen reader
  // only. The tap target stays 44px. Geometry is read in the page from layout
  // boxes (`offsetWidth`), because the control sits on a rail tilted like the
  // strip, and a rotated box's bounding rect is larger than the box.

  // The words a visitor can SEE in the control: every non-blank text node
  // whose own element's layout box is more than a pixel in either direction.
  // The hidden name is clipped to a 1px box; `innerText` would still return
  // it. The layout box, not the bounding rect: the rail is tilted -1.6deg,
  // and a 1px square turned that far has a bounding rect 1.0275px on a side
  // (cos + sin), which read the clipped name as visible in every engine.
  const visibleWords = (page: Page) =>
    page.locator('.band-pause').evaluate((label) => {
      const walker = document.createTreeWalker(label, NodeFilter.SHOW_TEXT);
      const seen: string[] = [];
      const all: string[] = [];
      for (let node = walker.nextNode(); node; node = walker.nextNode()) {
        const text = node.textContent?.trim() ?? '';
        if (!text) continue;
        all.push(text);
        const box = node.parentElement!;
        if (box.offsetWidth > 1 || box.offsetHeight > 1) seen.push(text);
      }
      return { seen, all };
    });

  for (const locale of LOCALES)
    test(`${locale}: the control shows an icon and no words, and its name is the band's`, async ({
      page,
    }) => {
      await page.goto(localisePath('/', locale));
      const name = getSiteStrings(locale).home.pauseMotion;
      const words = await visibleWords(page);
      expect(words.all, 'the text the control holds').toEqual([name]);
      expect(
        searched(words.seen, {
          of: words.all,
          what: 'text nodes in the pause control',
        }),
        'words a visitor can see in the control',
      ).toEqual([]);
      expect(
        floorBreach('homepage/pause-control-text', words.all.length),
      ).toBeUndefined();
      const control = page.getByRole('checkbox', { name, exact: true });
      await expect(control).toHaveCount(1);
      await expect(control).toHaveAccessibleName(name);
      // Two icons, and both hidden from the accessibility tree.
      await expect(page.locator('.band-pause svg')).toHaveCount(2);
      await expect(
        page.locator('.band-pause svg[aria-hidden="true"]'),
      ).toHaveCount(2);
      await expect(
        page.locator('.band-pause svg[data-icon="pause"]'),
      ).toBeVisible();
    });

  test('the icon is a pause symbol while the strip moves and a play symbol while it is paused', async ({
    page,
  }) => {
    await page.goto('/');
    const control = page.getByRole('checkbox', {
      name: getSiteStrings('en').home.pauseMotion,
      exact: true,
    });
    const pause = page.locator('.band-pause svg[data-icon="pause"]');
    const play = page.locator('.band-pause svg[data-icon="play"]');
    await expect(pause).toHaveCount(1);
    await expect(play).toHaveCount(1);
    await expect(pause).toBeVisible();
    await expect(play).toBeHidden();
    await control.check();
    await expect(play).toBeVisible();
    await expect(pause).toBeHidden();
    await shoot(page, 'paused: the control shows a play symbol');
    await control.uncheck();
    await expect(pause).toBeVisible();
    await expect(play).toBeHidden();
  });

  for (const width of BAND_WIDTHS)
    test(
      `at ${width}px no row sits between the header and the strip`,
      { tag: '@emulated-viewport' },
      async ({ page }) => {
        await page.setViewportSize({ width, height: 900 });
        await page.goto('/');
        const facts = await page.evaluate(() => {
          const header = document.querySelector('header');
          const strip = document.querySelector<HTMLElement>('.marquee');
          const band = document.querySelector('.band');
          const target = document.querySelector('.band-pause');
          if (!header || !strip || !band || !target)
            throw new Error('header, strip, band or control missing');
          // The strip is rotated, so its bounding box is not its layout box:
          // its LAYOUT top is the band's top plus its own offset.
          const layoutTop = band.getBoundingClientRect().top + strip.offsetTop;
          const t = target.getBoundingClientRect();
          return {
            gap: layoutTop - header.getBoundingClientRect().bottom,
            margin: parseFloat(getComputedStyle(strip).marginTop),
            targetMid: t.top + t.height / 2,
            layoutTop,
          };
        });
        expect(facts.margin, "the strip's own top margin").toBeGreaterThan(0);
        expect(
          facts.gap,
          `${width}px: header bottom to strip top is ${facts.gap}px; the strip's own margin is ${facts.margin}px`,
        ).toBeLessThanOrEqual(facts.margin + 1);
        expect(
          facts.targetMid,
          'the control sits in the gap above the strip',
        ).toBeGreaterThanOrEqual(facts.layoutTop);
      },
    );

  for (const width of BAND_WIDTHS)
    test(
      `at ${width}px the disc is at most 28px, on the strip's tilted middle, and its 44px target takes a click at every edge`,
      { tag: '@emulated-viewport' },
      async ({ page }) => {
        await page.setViewportSize({ width, height: 900 });
        await page.goto('/');
        const control = page.getByRole('checkbox', {
          name: getSiteStrings('en').home.pauseMotion,
          exact: true,
        });
        const at = await page.evaluate(() => {
          const target = document.querySelector<HTMLElement>('.band-pause');
          const disc = document.querySelector<HTMLElement>('.band-pause-disc');
          const strip = document.querySelector<HTMLElement>('.marquee');
          if (!target || !disc || !strip)
            throw new Error('control, disc or strip missing');
          const centre = (el: Element) => {
            const r = el.getBoundingClientRect();
            return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
          };
          // The strip's tilt and scale, from the matrix the browser computed.
          const m = new DOMMatrix(getComputedStyle(strip).transform);
          const angle = Math.atan2(m.b, m.a);
          const scale = Math.hypot(m.a, m.b);
          const s = centre(strip);
          const d = centre(disc);
          // How far the disc's middle is from the strip's middle LINE, measured
          // across the strip, and how much strip there is either side of it.
          const across =
            Math.abs(d.y - (s.y + (d.x - s.x) * Math.tan(angle))) *
            Math.cos(angle);
          const t = centre(target);
          const reach = target.offsetWidth / 2 - 2;
          return {
            disc: { w: disc.offsetWidth, h: disc.offsetHeight },
            target: { w: target.offsetWidth, h: target.offsetHeight },
            stripHeight: strip.offsetHeight,
            across,
            room: (strip.offsetHeight * scale) / 2 - disc.offsetHeight / 2,
            hitsAtCentre: target.contains(document.elementFromPoint(t.x, t.y)),
            edges: [
              { name: 'left', x: t.x - reach, y: t.y },
              { name: 'right', x: t.x + reach, y: t.y },
              { name: 'top', x: t.x, y: t.y - reach },
              { name: 'bottom', x: t.x, y: t.y + reach },
            ],
          };
        });
        expect(
          at.disc.w,
          'the visible disc is no wider than 28px',
        ).toBeLessThanOrEqual(28);
        expect(
          at.disc.h,
          'the visible disc is no taller than 28px',
        ).toBeLessThanOrEqual(28);
        expect(
          at.disc.h,
          "the visible disc is no taller than the strip's layout box",
        ).toBeLessThanOrEqual(at.stripHeight);
        expect(
          at.target.w,
          'the tap target is at least 44px wide',
        ).toBeGreaterThanOrEqual(44);
        expect(
          at.target.h,
          'the tap target is at least 44px tall',
        ).toBeGreaterThanOrEqual(44);
        expect(
          at.across,
          `${width}px: the disc's middle is ${at.across.toFixed(1)}px off the strip's middle line`,
        ).toBeLessThanOrEqual(1.5);
        expect(
          at.across,
          `${width}px: the disc hangs off the strip (room either side ${at.room.toFixed(1)}px)`,
        ).toBeLessThanOrEqual(at.room);
        expect(
          at.hitsAtCentre,
          'a click at the centre misses the control',
        ).toBe(true);
        let ticked = false;
        for (const edge of at.edges) {
          await page.mouse.click(edge.x, edge.y);
          ticked = !ticked;
          await expect(
            control,
            `a click at the target's ${edge.name} edge toggles the control`,
          ).toBeChecked({ checked: ticked });
        }
      },
    );

  for (const theme of THEMES)
    test(`${theme}: the icon clears 3:1 on the disc, and the disc clears 3:1 against the strip`, async ({
      page,
    }) => {
      await page.goto('/');
      await emulateTheme(page, theme);
      const icon = page.locator('.band-pause svg[data-icon="pause"]');
      await expect(icon).toBeVisible();
      const iconRatio = await contrastRatio(icon);
      expect(
        iconRatio,
        `${theme}: the icon on its disc`,
      ).toBeGreaterThanOrEqual(3);
      const grounds = await page.evaluate(() => ({
        disc: getComputedStyle(document.querySelector('.band-pause-disc')!)
          .backgroundColor,
        strip: getComputedStyle(document.querySelector('.marquee')!)
          .backgroundColor,
      }));
      const disc = parseColour(grounds.disc);
      const strip = parseColour(grounds.strip);
      expect(disc?.alpha, `${theme}: the disc paints a solid ground`).toBe(1);
      expect(strip?.alpha, `${theme}: the strip paints a solid ground`).toBe(1);
      expect(
        contrast(disc!.rgb, strip!.rgb),
        `${theme}: the disc (${grounds.disc}) against the strip (${grounds.strip})`,
      ).toBeGreaterThanOrEqual(3);
    });

  for (const theme of THEMES)
    test(`${theme}: keyboard focus draws the site's ring on the disc, clear of the strip and unclipped`, async ({
      page,
      browserName,
    }) => {
      await page.goto('/');
      await emulateTheme(page, theme);
      const control = page.getByRole('checkbox', {
        name: getSiteStrings('en').home.pauseMotion,
        exact: true,
      });
      await page.locator('.hero a').first().focus();
      await page.keyboard.press(
        browserName === 'webkit' ? 'Alt+Shift+Tab' : 'Shift+Tab',
      );
      await expect(control).toBeFocused();
      const ring = await control.evaluate((element) => {
        const input = element as HTMLInputElement;
        const style = getComputedStyle(input);
        const disc = input
          .closest('.band-pause')!
          .querySelector<HTMLElement>('.band-pause-disc')!;
        // --accent as the browser resolves it, to hold the ring's colour to.
        const probe = document.createElement('span');
        probe.style.color = 'var(--accent)';
        document.body.append(probe);
        const accent = getComputedStyle(probe).color;
        probe.remove();
        // The ring's own box, and every ancestor that clips its overflow and
        // does not hold that box whole.
        const reach =
          parseFloat(style.outlineOffset) + parseFloat(style.outlineWidth);
        const r = input.getBoundingClientRect();
        const walked: string[] = [];
        const clipping: string[] = [];
        for (
          let at = input.parentElement;
          at && at !== document.body;
          at = at.parentElement
        ) {
          const name = `${at.tagName.toLowerCase()}.${at.className}`;
          walked.push(name);
          const cs = getComputedStyle(at);
          if (cs.overflowX === 'visible' && cs.overflowY === 'visible')
            continue;
          const a = at.getBoundingClientRect();
          if (
            r.left - reach < a.left ||
            r.right + reach > a.right ||
            r.top - reach < a.top ||
            r.bottom + reach > a.bottom
          )
            clipping.push(name);
        }
        return {
          focusVisible: input.matches(':focus-visible'),
          style: style.outlineStyle,
          width: parseFloat(style.outlineWidth),
          ratio: window.devicePixelRatio,
          offset: parseFloat(style.outlineOffset),
          colour: style.outlineColor,
          accent,
          outer:
            input.offsetWidth / 2 +
            parseFloat(style.outlineOffset) +
            parseFloat(style.outlineWidth),
          discRadius: disc.offsetWidth / 2,
          discGround: getComputedStyle(disc).backgroundColor,
          walked,
          clipping,
        };
      });
      expect(ring.focusVisible, 'the control matches :focus-visible').toBe(
        true,
      );
      expect(ring.style, 'the ring is drawn').toBe('solid');
      // Declared, or snapped at this screen's ratio (#805): 2.857px on the
      // 3.5x phone, 3 on emulated Chrome at 2.75.
      expect(
        readsAsLineWidth(ring.width, 3, ring.ratio),
        `the site's 3px ring: read ${ring.width} at a ratio of ${ring.ratio}`,
      ).toBe(true);
      expect(ring.offset, "the site's 2px offset").toBe(2);
      expect(ring.colour, "the site's --accent ring").toBe(ring.accent);
      // Drawn ON the disc, with disc still showing outside it: an --accent
      // ring outside the disc would sit on the --accent strip and vanish.
      expect(
        ring.outer,
        `the ring reaches ${ring.outer}px from the middle; the disc is ${ring.discRadius}px`,
      ).toBeLessThan(ring.discRadius);
      const colour = parseColour(ring.colour);
      const ground = parseColour(ring.discGround);
      expect(
        contrast(colour!.rgb, ground!.rgb),
        `${theme}: the ring (${ring.colour}) on the disc (${ring.discGround})`,
      ).toBeGreaterThanOrEqual(3);
      expect(
        searched(ring.clipping, {
          of: ring.walked,
          what: "the pause control's ancestors",
        }),
        'ancestors that clip the ring',
      ).toEqual([]);
      expect(
        floorBreach('homepage/pause-ring-ancestors', ring.walked.length),
      ).toBeUndefined();
      await shoot(page, `${theme}: keyboard focus rings the pause disc`);
    });

  test('nothing of the control prints', async ({ page }) => {
    await page.goto('/');
    await page.emulateMedia({ media: 'print' });
    const target = page.locator('.band-pause');
    await expect(target).toHaveCount(1);
    await expect(target).toBeHidden();
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

// The Yawelo Idle preview video, #835. Its files come from the shared media
// host (yawelo-idle#713), which the shared fixture answers from tests/e2e/stand-ins/ (see
// yawelo-media.ts), so these read the page's markup and behaviour; the real
// host is played on the deployed dev site. Literal URLs and types, never the
// page's own constant: a value compared with its source asserts nothing.
const PROMO = 'https://media.shyden.co.uk/yawelo-idle-promo';
// MP4 first (Shyden, 2026-10-20): with WebM first the real iPhone stuck on
// the poster. The codec lists let an engine that cannot play one skip it.
const PROMO_SOURCES = [
  [`${PROMO}.mp4`, 'video/mp4; codecs="avc1.64001F, mp4a.40.2"'],
  [`${PROMO}.webm`, 'video/webm; codecs="vp9, opus"'],
];
const PROMO_WIDTHS = [320, 375, 768, 1280] as const;

test.describe('the Yawelo Idle preview video', () => {
  for (const locale of LOCALES)
    test(`${locale}: the preview is a native player with its poster, sized before it loads`, async ({
      page,
    }) => {
      const t = getSiteStrings(locale).home;
      await page.goto(localisePath('/', locale));
      const video = page.locator('#yawelo-idle video');
      await expect(video).toHaveCount(1);
      await expect(video).toBeVisible();
      await expect(video).toHaveAttribute('controls', '');
      await expect(video).toHaveAttribute('preload', 'none');
      await expect(video).toHaveAttribute('playsinline', '');
      await expect(video).toHaveAttribute('width', '1280');
      await expect(video).toHaveAttribute('height', '720');
      await expect(video).toHaveAttribute('poster', `${PROMO}-poster.jpg`);
      // Tap to play, ruled 2026-10-16: nothing starts on its own.
      await expect(video).not.toHaveAttribute('autoplay');
      await expect(video).not.toHaveAttribute('muted');
      await expect(video).not.toHaveAttribute('loop');
      await expect(video).toHaveAccessibleName(t.yaweloIdleVideoName);
      expect(
        await video
          .locator('source')
          .evaluateAll((sources) =>
            sources.map((s) => [s.getAttribute('src'), s.getAttribute('type')]),
          ),
        'the sources, in order',
      ).toEqual(PROMO_SOURCES);
      // Explicit width and height give the box its 16:9 before a byte loads.
      const box = await video.boundingBox();
      expect(box).not.toBeNull();
      expect(box!.width / box!.height).toBeCloseTo(16 / 9, 1);
    });

  for (const locale of LOCALES)
    test(`${locale}: what the video shows is one tap away, and describes the video`, async ({
      page,
    }) => {
      const t = getSiteStrings(locale).home;
      await page.goto(localisePath('/', locale));
      const shows = page.locator('#yawelo-idle details');
      const summary = shows.locator('summary');
      const description = shows.locator('p');
      await expect(summary).toBeVisible();
      await expect(summary).toHaveText(t.yaweloIdleVideoShows);
      await expect(description).toHaveCount(1);
      await expect(description).toBeHidden();
      const box = await summary.boundingBox();
      expect(box).not.toBeNull();
      expect(Math.round(box!.height)).toBeGreaterThanOrEqual(44);
      await summary.click();
      await expect(description).toBeVisible();
      await expect(description).toHaveText(t.yaweloIdleVideoDescription);
      // The description is the video's own, closed or open.
      await expect(
        page.locator('#yawelo-idle video'),
      ).toHaveAccessibleDescription(t.yaweloIdleVideoDescription);
      await shoot(page, `${locale}: what the Yawelo Idle preview shows`, shows);
    });

  test('nothing of the video downloads before it is played', async ({
    page,
  }) => {
    const seen = recordRequests(page);
    await page.goto('/');
    // Liveness: the recorder heard the poster, which loads with the page.
    await expect
      .poll(() => seen.matching(urlMatching(/yawelo-idle-promo-poster\.jpg$/)))
      .toEqual([`${PROMO}-poster.jpg`]);
    const heard = requestsEveryEngineMakes(seen.all);
    expect(
      searched(seen.matching(urlMatching(/yawelo-idle-promo\.(mp4|webm)$/)), {
        of: heard,
        what: 'requests the homepage made',
      }),
      'preload="none": no rendition is fetched until the visitor plays it',
    ).toEqual([]);
    expect(
      floorBreach('homepage/promo-requests', heard.length),
    ).toBeUndefined();
  });

  test('every request the homepage makes is ours or the media host', async ({
    page,
  }) => {
    const seen = recordRequests(page);
    await page.goto('/');
    await expect
      .poll(() => seen.matching(urlMatching(/yawelo-idle-promo-poster\.jpg$/)))
      .toHaveLength(1);
    const origins = new Set(seen.all.map(({ url }) => new URL(url).origin));
    expect(
      [...origins].sort(),
      'the hosts a homepage load reaches: this site, and the video host by name',
    ).toEqual(
      [new URL(page.url()).origin, 'https://media.shyden.co.uk'].sort(),
    );
  });

  test('pressing play plays the preview', async ({ page }) => {
    await page.goto('/');
    const video = page.locator('#yawelo-idle video');
    await expect(video).toBeVisible();
    // Muted, so no engine's autoplay rule refuses a play that is not a tap;
    // what is under test is that a source loads and time moves.
    await video.evaluate((v: HTMLVideoElement) => {
      v.muted = true;
      return v.play();
    });
    await expect
      .poll(() => video.evaluate((v: HTMLVideoElement) => v.currentTime))
      .toBeGreaterThan(0.2);
    const chosen = await video.evaluate((v: HTMLVideoElement) => v.currentSrc);
    test
      .info()
      .annotations.push({ type: 'source played', description: chosen });
    expect(PROMO_SOURCES.map(([src]) => src)).toContain(chosen);
    await shoot(page, `the preview plays (${chosen.split('/').pop()})`, video);
  });

  for (const width of PROMO_WIDTHS)
    test(
      `at ${width}px the preview and its description stay inside the card`,
      { tag: '@emulated-viewport' },
      async ({ page }) => {
        await page.setViewportSize({ width, height: 900 });
        await page.goto('/');
        await page.locator('#yawelo-idle summary').click();
        await expect(page.locator('#yawelo-idle details p')).toBeVisible();
        const boxes = await page.evaluate(() => {
          const rect = (selector: string) => {
            const el = document.querySelector(selector);
            if (!el) throw new Error(`${selector} missing`);
            const r = el.getBoundingClientRect();
            return {
              left: r.left,
              right: r.right,
              width: r.width,
              height: r.height,
            };
          };
          return {
            card: rect('#yawelo-idle'),
            player: rect('#yawelo-idle video'),
            shows: rect('#yawelo-idle details'),
          };
        });
        expect(
          boxes.player.left,
          "the player's left edge",
        ).toBeGreaterThanOrEqual(boxes.card.left - 0.5);
        expect(
          boxes.player.right,
          "the player's right edge",
        ).toBeLessThanOrEqual(boxes.card.right + 0.5);
        expect(boxes.shows.left, "shows's left edge").toBeGreaterThanOrEqual(
          boxes.card.left - 0.5,
        );
        expect(boxes.shows.right, "shows's right edge").toBeLessThanOrEqual(
          boxes.card.right + 0.5,
        );
        // The player is the tap target that plays it.
        const box = await page.locator('#yawelo-idle video').boundingBox();
        expect(box).not.toBeNull();
        expect(Math.round(box!.width)).toBeGreaterThanOrEqual(44);
        expect(Math.round(box!.height)).toBeGreaterThanOrEqual(44);
        await expectNoHorizontalScroll(page, `${width}px`);
        await shoot(
          page,
          `${width}px: the Yawelo Idle preview in its card`,
          page.locator('#yawelo-idle'),
        );
      },
    );
});

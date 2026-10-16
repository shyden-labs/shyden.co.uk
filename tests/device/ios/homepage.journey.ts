/**
 * The homepage on the real iPhone: the tests the real-Android run executes
 * from tests/e2e/homepage.spec.ts (#800, global rule 2026-10-15: "android and
 * iOS journeys need to be mirrored"), under the same titles with an
 * `iOS mirror:` prefix. Playwright cannot drive iOS Safari, so each is
 * restated over the session's WebDriver.
 *
 * Seven Android tests have no twin here (`.superpowers/sdd/800/plan.md`
 * lists them). The two keyboard walks are exempt: Shyden ruled 2026-10-16
 * (#811) that a hardware key press needs no iPhone twin, "because it's a
 * phone and phone users are not expected to have a separate usb keyboard for
 * their phones". The rest are gaps #811 closes, not exemptions: print and
 * reduced-motion emulation (`emulateMedia` has no WebDriver twin), the
 * console (safaridriver exposes no log), and the device's own colour scheme.
 * Where Android emulates a scheme to pick a palette, this file stamps the
 * saved choice the page honours instead, its title says "saved", and the
 * test is marked NOT YET THE SAME as Android (#811).
 */
import { describe, expect, test } from 'vitest';
import {
  getSiteStrings,
  LOCALES,
  localisePath,
  type Locale,
} from '../../../src/lib/i18n';
import { SHYTALK_MARK, asComputedRgb } from '../../../src/lib/shytalk-brand';
import { floorBreach } from '../../floors';
import { THEMES } from '../../palette';
import { searched } from '../../source-files';
import { contrast, paintedContrast, parseColour } from '../../wcag';
import {
  attributesOf,
  countOf,
  expectEventually,
  expectLocator,
  paintedTextOf,
  textsOf,
} from './dom';
import { shootDevice } from './evidence';
import { holdIosSession } from './held-session';
import { byRole, expectRole, expectRoleAttribute } from './roles';
import { announceMode } from './session';
import { waitFor } from './webdriver';

const phone = holdIosSession();

/** `expect(page.locator(selector))`, retried as Playwright retries it (#821); `nth` is `.nth(n)`. */
const on = (selector: string, nth?: number) =>
  expectLocator(phone().driver, selector, { nth });

/** Android's `shoot`: evidence only, written when the run asks for it. */
const shoot = (label: string): Promise<string | null> =>
  shootDevice(phone().driver, { project: 'ios-safari-real-device', label });

const SHYTALK_URL = 'https://shytalk.shyden.co.uk';
const SHYTALK_HOST = 'shytalk.shyden.co.uk';
const YAWELO_IDLE_URL = 'https://yawelo-idle.shyden.co.uk';
const YAWELO_IDLE_HOST = 'yawelo-idle.shyden.co.uk';

/** Loads a homepage and waits for its hero. */
const openHome = (locale: Locale, theme?: 'light' | 'dark'): Promise<void> =>
  phone().navigateToPath(localisePath('/', locale), '.hero', theme);

/** Runs `script` in the page and returns what it returns. */
const read = <T>(script: string, args: unknown[] = []): Promise<T> =>
  phone().driver.executeScript<T>(script, args);

describe('iOS mirror: homepage content', () => {
  for (const locale of LOCALES)
    test(`iOS mirror: ${locale}: the hero has no label above its heading`, async () => {
      announceMode(phone(), `hero heading (${locale})`);
      await openHome(locale);
      await on('.hero h1').toBeVisible();
      await on('.hero .eyebrow').toHaveCount(0);
    });

  test('iOS mirror: the heading and the title say what Shyden makes', async () => {
    announceMode(phone(), 'hero heading and title');
    await openHome('en');
    await on('.hero h1').toHaveText('Shyden makes small software, with care.');
    await expectEventually(
      () => read<string>('return document.title;'),
      'Shyden — small software, made with care',
      'the title',
    );
  });

  test('iOS mirror: the hero leads with ShyTalk and every section is present', async () => {
    announceMode(phone(), 'hero CTA and sections');
    await openHome('en');
    await on('h1').toContainText(/Shyden/i);
    // `getByRole('link', { name: /explore shytalk/i })`: a case-blind part of
    // the name, which is the rule `exact: false` keeps.
    const cta = (attribute: string, value: string): Promise<void> =>
      expectRoleAttribute(
        phone().driver,
        'link',
        'explore shytalk',
        { exact: false, scope: '.hero' },
        attribute,
        value,
      );
    await cta('href', SHYTALK_URL);
    await cta('rel', 'noopener noreferrer');
    await cta('target', '_blank');
    for (const id of ['shytalk', 'yawelo-idle', 'tools', 'contact'])
      await on(`#${id}`).toBeVisible();
    await shoot('the Aurora hero leads with ShyTalk');
  });

  for (const locale of LOCALES) {
    const home = localisePath('/', locale);
    test(`iOS mirror: ${locale}: every header nav item lands on a section of this page`, async () => {
      announceMode(phone(), `nav fragments (${locale})`);
      await openHome(locale);
      const hrefs = await attributesOf(phone().driver, 'header nav a', 'href');
      const fragmented = hrefs
        .map((h) => h ?? '')
        .filter((h) => h.includes('#'));
      expect(
        fragmented.length,
        `${home} rendered no fragment nav links at all`,
      ).toBeGreaterThan(0);
      for (const href of fragmented) {
        const [path, fragment] = href.split('#');
        expect(
          path.endsWith('/') ? path : `${path}/`,
          `${home}: nav link ${href} leaves this locale`,
        ).toBe(home);
        await expectEventually(
          () => countOf(phone().driver, `#${fragment}`),
          1,
          `${home}: nav points at #${fragment}, which the page does not render`,
        );
      }
      await shoot(
        `${home}: all ${fragmented.length} nav fragments resolve in-locale`,
      );
    });
  }

  test('iOS mirror: the ShyTalk showcase carries the brand wordmark and links out', async () => {
    announceMode(phone(), 'ShyTalk wordmark');
    await openHome('en');
    const wordmark = '#shytalk .shytalk-wordmark';
    await on(wordmark).toHaveText('ShyTalk');
    await on(`${wordmark} span`).toHaveText('Talk');
    await on(wordmark).toHaveCSS('color', asComputedRgb(SHYTALK_MARK.shy));
    await on(`${wordmark} span`).toHaveCSS(
      'color',
      asComputedRgb(SHYTALK_MARK.talk),
    );
    await on('#shytalk .features li').toHaveCount(4);
    await on(`#shytalk a[href="${SHYTALK_URL}"]`, -1).toHaveAttribute(
      'rel',
      'noopener noreferrer',
    );
    await shoot('the ShyTalk showcase and its two-tone wordmark');
  });

  const TILE = {
    light: asComputedRgb(SHYTALK_MARK.tile),
    dark: 'rgba(0, 0, 0, 0)',
  } as const;
  for (const theme of THEMES)
    test(`iOS mirror: ${theme}, saved: the ShyTalk wordmark keeps its tones, on its own tile in light only`, async () => {
      announceMode(phone(), `wordmark tile (${theme})`);
      // NOT YET THE SAME as Android (#811): Android emulates the device colour
      // scheme; WebDriver cannot, so the theme is the SAVED choice. Kept, never
      // deleted (Shyden 2026-10-16), until #811 sets the phone's appearance.
      await openHome('en', theme);
      const wordmark = on('#shytalk .shytalk-wordmark');
      await wordmark.toHaveCSS('color', asComputedRgb(SHYTALK_MARK.shy));
      await wordmark.toHaveCSS('background-color', TILE[theme]);
    });

  for (const locale of LOCALES)
    test(`iOS mirror: ${locale}: the showcase frame shows a real room capture`, async () => {
      announceMode(phone(), `showcase capture (${locale})`);
      await openHome(locale);
      await on('#shytalk .frame img').toHaveCount(1);
      const [alt] = await attributesOf(
        phone().driver,
        '#shytalk .frame img',
        'alt',
      );
      expect((alt ?? '').trim().length, 'alt text').toBeGreaterThan(0);
      await read(
        `document.querySelector('#shytalk .frame img').scrollIntoView();`,
      );
      const width = await waitFor(
        async () => {
          const w = await read<number>(
            `return document.querySelector('#shytalk .frame img').naturalWidth;`,
          );
          return w > 0 ? w : undefined;
        },
        // `expect.poll`'s own ceiling: the 5 s every Playwright assertion has.
        { timeout: 5_000, describe: `the ${locale} capture to decode` },
      );
      expect(width, 'capture never decoded').toBeGreaterThan(0);
      await shoot(
        `${locale}: the showcase shows a real room capture in that locale`,
      );
    });

  test('iOS mirror: the showcase frame is a different capture in every locale', async () => {
    announceMode(phone(), 'distinct captures');
    // `request.get`: from the test process, as Android's request context asks.
    const pages = await Promise.all(
      LOCALES.map(async (locale) =>
        (
          await fetch(new URL(localisePath('/', locale), phone().baseUrl))
        ).text(),
      ),
    );
    await openHome('en');
    const srcs = await read<string[]>(
      `return arguments[0].map((html) =>
         new DOMParser().parseFromString(html, 'text/html')
           .querySelector('#shytalk .frame img')?.getAttribute('src') ?? '');`,
      [pages],
    );
    expect(srcs.filter(Boolean), 'a frame with no src').toHaveLength(
      LOCALES.length,
    );
    expect(
      new Set(srcs).size,
      `distinct captures across ${LOCALES.join(', ')}: ${srcs.join(', ')}`,
    ).toBe(LOCALES.length);
  });

  for (const theme of THEMES)
    test(`iOS mirror: ${theme}, saved: every status badge clears AA as painted`, async () => {
      announceMode(phone(), `status badges (${theme})`);
      // NOT YET THE SAME as Android (#811): Android emulates the device colour
      // scheme; WebDriver cannot, so the theme is the SAVED choice. Kept, never
      // deleted (Shyden 2026-10-16), until #811 sets the phone's appearance.
      await openHome('en', theme);
      await on('.status-badge').toHaveCount(4);
      const badges = await paintedTextOf(phone().driver, '.status-badge');
      const texts = await textsOf(phone().driver, '.status-badge');
      badges.forEach((badge, i) =>
        expect(paintedContrast(badge), `"${texts[i]}"`).toBeGreaterThanOrEqual(
          4.5,
        ),
      );
    });

  for (const locale of LOCALES)
    test(`iOS mirror: ${locale}: exactly two tool cards, each badged and linked in-locale`, async () => {
      announceMode(phone(), `tool cards (${locale})`);
      await openHome(locale);
      await on('#tools .work-card').toHaveCount(2);
      const live = getSiteStrings(locale).home.toolBadge;
      await on('#tools .status-badge').toHaveText([live, live]);
      await on('#tools .status-badge', 0).toBeVisible();
      await on('#tools .status-badge', 1).toBeVisible();
      const hrefs = await attributesOf(
        phone().driver,
        '#tools a[href]',
        'href',
      );
      expect(hrefs.sort(), 'the tool links').toEqual(
        ['/classroom-groups', '/yeetalk-calculators'].map((tool) =>
          localisePath(tool, locale),
        ),
      );
      await shoot(`${locale}: both tool cards, badged and in-locale`);
    });

  test('iOS mirror: contact section CTA links to the support mailbox', async () => {
    announceMode(phone(), 'contact CTA');
    await openHome('en');
    await expectRoleAttribute(
      phone().driver,
      'link',
      getSiteStrings('en').home.emailMe,
      { exact: true, scope: '#contact' },
      'href',
      'mailto:support@shyden.co.uk',
    );
  });

  const OPENS: Record<Locale, string> = {
    en: 'opens',
    id: 'membuka',
    zh: '打开',
    vi: 'mở',
    th: 'เปิด',
  };
  for (const locale of LOCALES)
    test(`iOS mirror: ${locale}: each hero link annotation reads as one line`, async () => {
      announceMode(phone(), `hero annotations (${locale})`);
      await openHome(locale);
      await on('.hero .opens').toHaveText([
        `${OPENS[locale]} ${SHYTALK_HOST}`,
        `${OPENS[locale]} ${YAWELO_IDLE_HOST}`,
      ]);
    });
});

describe('iOS mirror: two products, both coming soon (#403)', () => {
  for (const locale of LOCALES)
    test(`iOS mirror: ${locale}: the Yawelo Idle showcase follows ShyTalk's, with its badge, four features and link`, async () => {
      announceMode(phone(), `Yawelo Idle showcase (${locale})`);
      const t = getSiteStrings(locale).home;
      await openHome(locale);
      const section = '#yawelo-idle';
      await on(section).toBeVisible();
      const ids = await read<string[]>(
        `return Array.from(document.querySelectorAll('section[id]'), (s) => s.id);`,
      );
      expect(ids, 'the sections, in page order').toContain('shytalk');
      expect(ids.indexOf('yawelo-idle'), 'Yawelo Idle follows ShyTalk').toBe(
        ids.indexOf('shytalk') + 1,
      );
      await on(`${section} .kicker`).toBeVisible();
      await on(`${section} .kicker`).toHaveText(t.yaweloIdleKicker);
      await on(`${section} h2`).toBeVisible();
      await on(`${section} h2`).toHaveText('Yawelo Idle');
      const badge = on(`${section} .showcase-head .status-badge`);
      await badge.toBeVisible();
      await badge.toHaveText(t.comingSoon);
      await on(`${section} .features li`).toHaveText([
        t.yaweloIdleFeature1,
        t.yaweloIdleFeature2,
        t.yaweloIdleFeature3,
        t.yaweloIdleFeature4,
      ]);
      // `section.getByRole('link', { name: t.visitYaweloIdle })`: no `exact`.
      const link = (attribute: string, value: string): Promise<void> =>
        expectRoleAttribute(
          phone().driver,
          'link',
          t.visitYaweloIdle,
          { exact: false, scope: section },
          attribute,
          value,
        );
      await link('href', YAWELO_IDLE_URL);
      await link('rel', 'noopener noreferrer');
      await link('target', '_blank');
      await on(
        `${section} img, ${section} svg, ${section} picture`,
      ).toHaveCount(0);
      await shoot(`${locale}: the Yawelo Idle showcase, coming soon`);
    });

  for (const locale of LOCALES)
    test(`iOS mirror: ${locale}: ShyTalk wears the same Coming soon badge beside its heading`, async () => {
      announceMode(phone(), `ShyTalk badge (${locale})`);
      const t = getSiteStrings(locale).home;
      await openHome(locale);
      const head = '#shytalk .showcase-head';
      await on(`${head} h2 .shytalk-wordmark`).toBeVisible();
      const badge = on(`${head} .status-badge`);
      await badge.toBeVisible();
      await badge.toHaveText(t.comingSoon);
      await on('#shytalk .kicker').toHaveText(t.shytalkKicker);
      await shoot(`${locale}: ShyTalk, coming soon`);
    });

  for (const locale of LOCALES)
    test(`iOS mirror: ${locale}: the hero offers both products, ShyTalk then Yawelo Idle`, async () => {
      announceMode(phone(), `hero products (${locale})`);
      const t = getSiteStrings(locale).home;
      await openHome(locale);
      const links = '.hero .cta-item a';
      await on(links).toHaveText([t.exploreShytalk, t.exploreYaweloIdle]);
      await on(links, 0).toHaveAttribute('href', SHYTALK_URL);
      await on(links, 1).toHaveAttribute('href', YAWELO_IDLE_URL);
      await on(links, 0).toHaveAttribute('rel', 'noopener noreferrer');
      await on(links, 0).toHaveAttribute('target', '_blank');
      await on(links, 1).toHaveAttribute('rel', 'noopener noreferrer');
      await on(links, 1).toHaveAttribute('target', '_blank');
      await shoot(`${locale}: the hero's two products`);
    });

  for (const locale of LOCALES)
    test(`iOS mirror: ${locale}: the header links to Yawelo Idle, in this locale`, async () => {
      announceMode(phone(), `header Yawelo Idle (${locale})`);
      const home = localisePath('/', locale);
      const base = home === '/' ? '' : home.replace(/\/$/, '');
      await openHome(locale);
      const link = on(`header nav a[href="${base}/#yawelo-idle"]`);
      await link.toHaveCount(1);
      await link.toHaveText(getSiteStrings(locale).nav.yaweloIdle);
    });
});

describe('iOS mirror: the language band sits under the header (#599)', () => {
  for (const locale of LOCALES)
    test(`iOS mirror: ${locale}: the band is the first element in main, before the hero, and not pinned`, async () => {
      announceMode(phone(), `band placement (${locale})`);
      await openHome(locale);
      await on('main > .band').toHaveCount(1);
      const facts = await read<{
        first: boolean;
        before: boolean;
        positions: string[];
      }>(
        `const main = document.querySelector('main');
         const band = document.querySelector('.band');
         const hero = document.querySelector('.hero');
         return {
           first: main.firstElementChild === band,
           before: !!(band.compareDocumentPosition(hero) & Node.DOCUMENT_POSITION_FOLLOWING),
           positions: [band, band.querySelector('.marquee-clip'), band.querySelector('.marquee')]
             .map((el) => (el ? getComputedStyle(el).position : 'missing')),
         };`,
      );
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
        floorBreach('ios-homepage/band-positions', facts.positions.length),
      ).toBeUndefined();
      expect(facts.positions).toHaveLength(3);
      await shoot(
        `${locale}: the band is first in main, before the hero, unpinned`,
      );
    });

  test('iOS mirror: the band scrolls away: past it, its box is above the viewport', async () => {
    announceMode(phone(), 'band scrolls away');
    await openHome('en');
    const bottom = await phone().driver.executeAsyncScript<number>(
      `const done = arguments[arguments.length - 1];
       const clip = document.querySelector('.marquee-clip');
       window.scrollTo(0, clip.getBoundingClientRect().bottom + window.scrollY + 1);
       requestAnimationFrame(() => done(clip.getBoundingClientRect().bottom));`,
    );
    expect(
      bottom,
      'the band is still on screen after scrolling past it',
    ).toBeLessThanOrEqual(0);
    await shoot(
      `scrolled past, the band's bottom is at ${Math.round(bottom)}px`,
    );
  });
});

/** The strip's horizontal offset on six successive frames. */
const offsets = (): Promise<number[]> =>
  phone().driver.executeAsyncScript<number[]>(
    `const done = arguments[arguments.length - 1];
     const track = document.querySelector('.marquee-track');
     const seen = [];
     const step = () => {
       seen.push(new DOMMatrix(getComputedStyle(track).transform).m41);
       if (seen.length < 6) requestAnimationFrame(step); else done(seen);
     };
     requestAnimationFrame(step);`,
  );

/** How many of the strip's animations are running. */
const runningAnimations = (): Promise<number> =>
  read(
    `return document.querySelector('.marquee-track').getAnimations()
       .filter((a) => a.playState === 'running').length;`,
  );

/** Android's `pauseControl`: `getByRole('checkbox', { name: pauseMotion, exact: true })`. */
const pauseControl = (locale: Locale) =>
  [
    phone().driver,
    'checkbox',
    getSiteStrings(locale).home.pauseMotion,
    { exact: true },
  ] as const;

describe('iOS mirror: pause motion', () => {
  for (const locale of LOCALES)
    test(`iOS mirror: ${locale}: a visible, unticked checkbox named for the band, outside its hidden subtree`, async () => {
      announceMode(phone(), `pause control (${locale})`);
      await openHome(locale);
      const control = expectRole(...pauseControl(locale));
      await control.toHaveCount(1);
      await control.toBeVisible();
      await control.toBeChecked(false);
      const found = await byRole(...pauseControl(locale));
      expect(
        await read<boolean>(
          `return arguments[0].closest('[aria-hidden="true"]') === null;`,
          [phone().driver.elementRef(found.elementId)],
        ),
        'the control sits inside an aria-hidden ancestor',
      ).toBe(true);
      await on('.marquee-clip').toHaveAttribute('aria-hidden', 'true');
    });

  test('iOS mirror: ticked pauses the band and unticked resumes it', async () => {
    // NOT YET THE SAME as Android (#811): Android emulates reduced motion as
    // no-preference first; WebDriver cannot, so this reads the phone's own
    // setting, and with Reduce Motion on the first expectation fails and says
    // why. Kept, never deleted (Shyden 2026-10-16), until #811 emulates it.
    announceMode(phone(), 'pause and resume');
    await openHome('en');
    const track = on('.marquee-track');
    await track.toHaveCount(1);
    const control = await byRole(...pauseControl('en'));
    const moves = async (): Promise<boolean> =>
      new Set(await offsets()).size !== 1;

    expect(
      await moves(),
      'the band moves before it is paused (is Reduce Motion on?)',
    ).toBe(true);
    expect(
      await runningAnimations(),
      'animations running before the pause',
    ).toBe(1);

    await phone().interaction.setChecked(control, true);
    await track.toHaveCSS('animation-play-state', 'paused');
    expect(await runningAnimations(), 'animations running while paused').toBe(
      0,
    );
    const held = await offsets();
    expect(
      new Set(held).size,
      `the band's offset on six frames while paused: ${held.join(', ')}`,
    ).toBe(1);

    await phone().interaction.setChecked(control, false);
    await track.toHaveCSS('animation-play-state', 'running');
    expect(await runningAnimations(), 'animations running after resuming').toBe(
      1,
    );
    expect(await moves(), 'the band moves again once resumed').toBe(true);
  });
});

describe('iOS mirror: the pause control is a small icon on the strip (#619)', () => {
  for (const locale of LOCALES)
    test(`iOS mirror: ${locale}: the control shows an icon and no words, and its name is the band's`, async () => {
      announceMode(phone(), `pause icon (${locale})`);
      await openHome(locale);
      const name = getSiteStrings(locale).home.pauseMotion;
      const words = await read<{ seen: string[]; all: string[] }>(
        `const label = document.querySelector('.band-pause');
         const walker = document.createTreeWalker(label, NodeFilter.SHOW_TEXT);
         const seen = [], all = [];
         for (let node = walker.nextNode(); node; node = walker.nextNode()) {
           const text = node.textContent?.trim() ?? '';
           if (!text) continue;
           all.push(text);
           const box = node.parentElement;
           if (box.offsetWidth > 1 || box.offsetHeight > 1) seen.push(text);
         }
         return { seen, all };`,
      );
      expect(words.all, 'the text the control holds').toEqual([name]);
      expect(
        searched(words.seen, {
          of: words.all,
          what: 'text nodes in the pause control',
        }),
        'words a visitor can see in the control',
      ).toEqual([]);
      expect(
        floorBreach('ios-homepage/pause-control-text', words.all.length),
      ).toBeUndefined();
      // One control found by its exact name is Android's count of one and
      // its `toHaveAccessibleName(name)` together: the name IS the match.
      await expectRole(...pauseControl(locale)).toHaveCount(1);
      await on('.band-pause svg').toHaveCount(2);
      await on('.band-pause svg[aria-hidden="true"]').toHaveCount(2);
      await on('.band-pause svg[data-icon="pause"]').toBeVisible();
    });

  test('iOS mirror: the icon is a pause symbol while the strip moves and a play symbol while it is paused', async () => {
    announceMode(phone(), 'pause and play icons');
    await openHome('en');
    const control = await byRole(...pauseControl('en'));
    const pause = on('.band-pause svg[data-icon="pause"]');
    const play = on('.band-pause svg[data-icon="play"]');
    await pause.toHaveCount(1);
    await play.toHaveCount(1);
    await pause.toBeVisible();
    await play.toBeHidden();
    await phone().interaction.setChecked(control, true);
    await play.toBeVisible();
    await pause.toBeHidden();
    await shoot('paused: the control shows a play symbol');
    await phone().interaction.setChecked(control, false);
    await pause.toBeVisible();
    await play.toBeHidden();
  });

  for (const theme of THEMES)
    test(`iOS mirror: ${theme}, saved: the icon clears 3:1 on the disc, and the disc clears 3:1 against the strip`, async () => {
      announceMode(phone(), `pause icon contrast (${theme})`);
      // NOT YET THE SAME as Android (#811): Android emulates the device colour
      // scheme; WebDriver cannot, so the theme is the SAVED choice. Kept, never
      // deleted (Shyden 2026-10-16), until #811 sets the phone's appearance.
      await openHome('en', theme);
      await on('.band-pause svg[data-icon="pause"]').toBeVisible();
      const [icon] = await paintedTextOf(
        phone().driver,
        '.band-pause svg[data-icon="pause"]',
      );
      expect(icon, 'the icon was read').toBeDefined();
      expect(
        paintedContrast(icon!),
        `${theme}: the icon on its disc`,
      ).toBeGreaterThanOrEqual(3);
      const grounds = await read<{ disc: string; strip: string }>(
        `return {
           disc: getComputedStyle(document.querySelector('.band-pause-disc')).backgroundColor,
           strip: getComputedStyle(document.querySelector('.marquee')).backgroundColor,
         };`,
      );
      const disc = parseColour(grounds.disc);
      const strip = parseColour(grounds.strip);
      expect(disc?.alpha, `${theme}: the disc paints a solid ground`).toBe(1);
      expect(strip?.alpha, `${theme}: the strip paints a solid ground`).toBe(1);
      expect(
        contrast(disc!.rgb, strip!.rgb),
        `${theme}: the disc (${grounds.disc}) against the strip (${grounds.strip})`,
      ).toBeGreaterThanOrEqual(3);
    });
});

describe('iOS mirror: the ShyTalk phone frame', () => {
  test('iOS mirror: the bezel is drawn and the capture keeps its ratio', async () => {
    announceMode(phone(), 'phone frame bezel');
    await openHome('en');
    await on('.frame').toHaveCount(1);
    const drawn = await read<{
      width: string;
      style: string;
      color: string;
      border: string;
      ratio: string;
    }>(
      `const element = document.querySelector('.frame');
       const probe = document.createElement('span');
       probe.style.color = 'var(--border)';
       document.body.append(probe);
       const border = getComputedStyle(probe).color;
       probe.remove();
       const style = getComputedStyle(element);
       const image = element.querySelector('img');
       return {
         width: style.borderTopWidth, style: style.borderTopStyle,
         color: style.borderTopColor, border,
         ratio: image ? getComputedStyle(image).aspectRatio : 'no image',
       };`,
    );
    expect(drawn.style, 'bezel border style').toBe('solid');
    expect(drawn.width, 'bezel border width').toBe('2px');
    expect(drawn.color, 'bezel border colour is --border').toBe(drawn.border);
    expect(drawn.ratio, "the capture's aspect-ratio").toBe('280 / 616');
    await shoot('the ShyTalk phone frame draws its bezel');
  });
});

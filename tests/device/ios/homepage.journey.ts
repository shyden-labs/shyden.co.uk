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
  paintedTextOf,
  textsOf,
  visibilityOf,
} from './dom';
import { holdIosSession } from './held-session';
import { announceMode } from './session';
import { waitFor } from './webdriver';

const phone = holdIosSession();

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

/** Each link's text and attributes, for the links `selector` matches. */
const linksOf = (
  selector: string,
): Promise<
  {
    text: string;
    href: string | null;
    rel: string | null;
    target: string | null;
  }[]
> =>
  read(
    `return Array.from(document.querySelectorAll(arguments[0]), (a) => ({
       text: a.innerText.trim(), href: a.getAttribute('href'),
       rel: a.getAttribute('rel'), target: a.getAttribute('target') }));`,
    [selector],
  );

describe('iOS mirror: homepage content', () => {
  for (const locale of LOCALES)
    test(`iOS mirror: ${locale}: the hero has no label above its heading`, async () => {
      announceMode(phone(), `hero heading (${locale})`);
      await openHome(locale);
      expect(await visibilityOf(phone().driver, '.hero h1')).toEqual([true]);
      expect(await countOf(phone().driver, '.hero .eyebrow')).toBe(0);
    });

  test('iOS mirror: the heading and the title say what Shyden makes', async () => {
    announceMode(phone(), 'hero heading and title');
    await openHome('en');
    expect(await textsOf(phone().driver, '.hero h1')).toEqual([
      'Shyden makes small software, with care.',
    ]);
    expect(await read<string>('return document.title;')).toBe(
      'Shyden — small software, made with care',
    );
  });

  test('iOS mirror: the hero leads with ShyTalk and every section is present', async () => {
    announceMode(phone(), 'hero CTA and sections');
    await openHome('en');
    expect((await textsOf(phone().driver, 'h1')).join(' ')).toMatch(/Shyden/i);
    const ctas = (await linksOf('.hero a')).filter((l) =>
      /explore shytalk/i.test(l.text),
    );
    expect(ctas).toEqual([
      expect.objectContaining({
        href: SHYTALK_URL,
        rel: 'noopener noreferrer',
        target: '_blank',
      }),
    ]);
    for (const id of ['shytalk', 'yawelo-idle', 'tools', 'contact'])
      expect(await visibilityOf(phone().driver, `#${id}`), `#${id}`).toEqual([
        true,
      ]);
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
        expect(
          await countOf(phone().driver, `#${fragment}`),
          `${home}: nav points at #${fragment}, which the page does not render`,
        ).toBe(1);
      }
    });
  }

  test('iOS mirror: the ShyTalk showcase carries the brand wordmark and links out', async () => {
    announceMode(phone(), 'ShyTalk wordmark');
    await openHome('en');
    const wordmark = '#shytalk .shytalk-wordmark';
    expect(await textsOf(phone().driver, wordmark)).toEqual(['ShyTalk']);
    expect(await textsOf(phone().driver, `${wordmark} span`)).toEqual(['Talk']);
    const colours = await read<{ shy: string; talk: string }>(
      `const w = document.querySelector(arguments[0]);
       return { shy: getComputedStyle(w).color, talk: getComputedStyle(w.querySelector('span')).color };`,
      [wordmark],
    );
    expect(colours).toEqual({
      shy: asComputedRgb(SHYTALK_MARK.shy),
      talk: asComputedRgb(SHYTALK_MARK.talk),
    });
    expect(await countOf(phone().driver, '#shytalk .features li')).toBe(4);
    const out = await attributesOf(
      phone().driver,
      `#shytalk a[href="${SHYTALK_URL}"]`,
      'rel',
    );
    expect(out.at(-1)).toBe('noopener noreferrer');
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
      const painted = await read<{ colour: string; tile: string }>(
        `const w = document.querySelector('#shytalk .shytalk-wordmark');
         const s = getComputedStyle(w);
         return { colour: s.color, tile: s.backgroundColor };`,
      );
      expect(painted).toEqual({
        colour: asComputedRgb(SHYTALK_MARK.shy),
        tile: TILE[theme],
      });
    });

  for (const locale of LOCALES)
    test(`iOS mirror: ${locale}: the showcase frame shows a real room capture`, async () => {
      announceMode(phone(), `showcase capture (${locale})`);
      await openHome(locale);
      expect(await countOf(phone().driver, '#shytalk .frame img')).toBe(1);
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
        { timeout: 15_000, describe: `the ${locale} capture to decode` },
      );
      expect(width, 'capture never decoded').toBeGreaterThan(0);
    });

  test('iOS mirror: the showcase frame is a different capture in every locale', async () => {
    announceMode(phone(), 'distinct captures');
    await openHome('en');
    const srcs = await phone().driver.executeAsyncScript<string[]>(
      `const [paths, done] = [arguments[0], arguments[arguments.length - 1]];
       Promise.all(paths.map((p) => fetch(p).then((r) => r.text())))
         .then((htmls) => done(htmls.map((html) =>
           new DOMParser().parseFromString(html, 'text/html')
             .querySelector('#shytalk .frame img')?.getAttribute('src') ?? '')))
         .catch(() => done([]));`,
      [LOCALES.map((locale) => localisePath('/', locale))],
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
      const badges = await paintedTextOf(phone().driver, '.status-badge');
      expect(badges).toHaveLength(4);
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
      expect(await countOf(phone().driver, '#tools .work-card')).toBe(2);
      const live = getSiteStrings(locale).home.toolBadge;
      expect(await textsOf(phone().driver, '#tools .status-badge')).toEqual([
        live,
        live,
      ]);
      expect(
        await visibilityOf(phone().driver, '#tools .status-badge'),
      ).toEqual([true, true]);
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
    });

  test('iOS mirror: contact section CTA links to the support mailbox', async () => {
    announceMode(phone(), 'contact CTA');
    await openHome('en');
    const name = getSiteStrings('en').home.emailMe;
    expect(
      (await linksOf('#contact a'))
        .filter((l) => l.text === name)
        .map((l) => l.href),
    ).toEqual(['mailto:support@shyden.co.uk']);
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
      expect(await textsOf(phone().driver, '.hero .opens')).toEqual([
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
      expect(await visibilityOf(phone().driver, section)).toEqual([true]);
      const ids = await read<string[]>(
        `return Array.from(document.querySelectorAll('section[id]'), (s) => s.id);`,
      );
      expect(ids, 'the sections, in page order').toContain('shytalk');
      expect(ids.indexOf('yawelo-idle'), 'Yawelo Idle follows ShyTalk').toBe(
        ids.indexOf('shytalk') + 1,
      );
      expect(await visibilityOf(phone().driver, `${section} .kicker`)).toEqual([
        true,
      ]);
      expect(await textsOf(phone().driver, `${section} .kicker`)).toEqual([
        t.yaweloIdleKicker,
      ]);
      expect(await visibilityOf(phone().driver, `${section} h2`)).toEqual([
        true,
      ]);
      expect(await textsOf(phone().driver, `${section} h2`)).toEqual([
        'Yawelo Idle',
      ]);
      const badge = `${section} .showcase-head .status-badge`;
      expect(await visibilityOf(phone().driver, badge)).toEqual([true]);
      expect(await textsOf(phone().driver, badge)).toEqual([t.comingSoon]);
      expect(await textsOf(phone().driver, `${section} .features li`)).toEqual([
        t.yaweloIdleFeature1,
        t.yaweloIdleFeature2,
        t.yaweloIdleFeature3,
        t.yaweloIdleFeature4,
      ]);
      expect(
        (await linksOf(`${section} a`)).filter(
          (l) => l.text === t.visitYaweloIdle,
        ),
      ).toEqual([
        expect.objectContaining({
          href: YAWELO_IDLE_URL,
          rel: 'noopener noreferrer',
          target: '_blank',
        }),
      ]);
      expect(
        await countOf(
          phone().driver,
          `${section} img, ${section} svg, ${section} picture`,
        ),
      ).toBe(0);
    });

  for (const locale of LOCALES)
    test(`iOS mirror: ${locale}: ShyTalk wears the same Coming soon badge beside its heading`, async () => {
      announceMode(phone(), `ShyTalk badge (${locale})`);
      const t = getSiteStrings(locale).home;
      await openHome(locale);
      const head = '#shytalk .showcase-head';
      expect(
        await visibilityOf(phone().driver, `${head} h2 .shytalk-wordmark`),
      ).toEqual([true]);
      expect(
        await visibilityOf(phone().driver, `${head} .status-badge`),
      ).toEqual([true]);
      expect(await textsOf(phone().driver, `${head} .status-badge`)).toEqual([
        t.comingSoon,
      ]);
      expect(await textsOf(phone().driver, '#shytalk .kicker')).toEqual([
        t.shytalkKicker,
      ]);
    });

  for (const locale of LOCALES)
    test(`iOS mirror: ${locale}: the hero offers both products, ShyTalk then Yawelo Idle`, async () => {
      announceMode(phone(), `hero products (${locale})`);
      const t = getSiteStrings(locale).home;
      await openHome(locale);
      expect(await linksOf('.hero .cta-item a')).toEqual([
        {
          text: t.exploreShytalk,
          href: SHYTALK_URL,
          rel: 'noopener noreferrer',
          target: '_blank',
        },
        {
          text: t.exploreYaweloIdle,
          href: YAWELO_IDLE_URL,
          rel: 'noopener noreferrer',
          target: '_blank',
        },
      ]);
    });

  for (const locale of LOCALES)
    test(`iOS mirror: ${locale}: the header links to Yawelo Idle, in this locale`, async () => {
      announceMode(phone(), `header Yawelo Idle (${locale})`);
      const home = localisePath('/', locale);
      const base = home === '/' ? '' : home.replace(/\/$/, '');
      await openHome(locale);
      expect(
        await textsOf(
          phone().driver,
          `header nav a[href="${base}/#yawelo-idle"]`,
        ),
      ).toEqual([getSiteStrings(locale).nav.yaweloIdle]);
    });
});

describe('iOS mirror: the language band sits under the header (#599)', () => {
  for (const locale of LOCALES)
    test(`iOS mirror: ${locale}: the band is the first element in main, before the hero, and not pinned`, async () => {
      announceMode(phone(), `band placement (${locale})`);
      await openHome(locale);
      expect(await countOf(phone().driver, 'main > .band')).toBe(1);
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

/** The band's pause checkbox, found by its own label text. */
const PAUSE = '.band-pause input[type="checkbox"]';

describe('iOS mirror: pause motion', () => {
  for (const locale of LOCALES)
    test(`iOS mirror: ${locale}: a visible, unticked checkbox named for the band, outside its hidden subtree`, async () => {
      announceMode(phone(), `pause control (${locale})`);
      await openHome(locale);
      const control = await read<
        {
          name: string;
          checked: boolean;
          visible: boolean;
          hiddenAncestor: boolean;
        }[]
      >(
        `return Array.from(document.querySelectorAll(arguments[0]), (input) => ({
           name: (input.closest('label')?.textContent ?? '').trim(),
           checked: input.checked,
           visible: input.getClientRects().length > 0 && getComputedStyle(input).visibility === 'visible',
           hiddenAncestor: !!input.closest('[aria-hidden="true"]'),
         }));`,
        [PAUSE],
      );
      expect(control).toEqual([
        {
          name: getSiteStrings(locale).home.pauseMotion,
          checked: false,
          visible: true,
          hiddenAncestor: false,
        },
      ]);
      expect(
        await attributesOf(phone().driver, '.marquee-clip', 'aria-hidden'),
      ).toEqual(['true']);
    });

  test('iOS mirror: ticked pauses the band and unticked resumes it', async () => {
    // Android sets reduced motion to no-preference first; WebDriver cannot,
    // so this reads the phone's own setting: with Reduce Motion on, the first
    // expectation below fails and says why.
    announceMode(phone(), 'pause and resume');
    await openHome('en');
    const control = await phone().driver.findElement(PAUSE);
    const moves = async (): Promise<boolean> =>
      new Set(await offsets()).size !== 1;
    const playState = (): Promise<string> =>
      read(
        `return getComputedStyle(document.querySelector('.marquee-track')).animationPlayState;`,
      );

    expect(
      await moves(),
      'the band moves before it is paused (is Reduce Motion on?)',
    ).toBe(true);
    expect(
      await runningAnimations(),
      'animations running before the pause',
    ).toBe(1);

    await phone().interaction.click(control);
    expect(await playState()).toBe('paused');
    expect(await runningAnimations(), 'animations running while paused').toBe(
      0,
    );
    const held = await offsets();
    expect(
      new Set(held).size,
      `the band's offset on six frames while paused: ${held.join(', ')}`,
    ).toBe(1);

    await phone().interaction.click(control);
    expect(await playState()).toBe('running');
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
      expect(await countOf(phone().driver, PAUSE)).toBe(1);
      expect(await countOf(phone().driver, '.band-pause svg')).toBe(2);
      expect(
        await countOf(phone().driver, '.band-pause svg[aria-hidden="true"]'),
      ).toBe(2);
      expect(
        await visibilityOf(
          phone().driver,
          '.band-pause svg[data-icon="pause"]',
        ),
      ).toEqual([true]);
    });

  test('iOS mirror: the icon is a pause symbol while the strip moves and a play symbol while it is paused', async () => {
    announceMode(phone(), 'pause and play icons');
    await openHome('en');
    const shown = async (): Promise<{ pause: boolean[]; play: boolean[] }> => ({
      pause: await visibilityOf(
        phone().driver,
        '.band-pause svg[data-icon="pause"]',
      ),
      play: await visibilityOf(
        phone().driver,
        '.band-pause svg[data-icon="play"]',
      ),
    });
    expect(await shown()).toEqual({ pause: [true], play: [false] });
    const control = await phone().driver.findElement(PAUSE);
    await phone().interaction.click(control);
    expect(await shown()).toEqual({ pause: [false], play: [true] });
    await phone().interaction.click(control);
    expect(await shown()).toEqual({ pause: [true], play: [false] });
  });

  for (const theme of THEMES)
    test(`iOS mirror: ${theme}, saved: the icon clears 3:1 on the disc, and the disc clears 3:1 against the strip`, async () => {
      announceMode(phone(), `pause icon contrast (${theme})`);
      // NOT YET THE SAME as Android (#811): Android emulates the device colour
      // scheme; WebDriver cannot, so the theme is the SAVED choice. Kept, never
      // deleted (Shyden 2026-10-16), until #811 sets the phone's appearance.
      await openHome('en', theme);
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
    expect(await countOf(phone().driver, '.frame')).toBe(1);
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
  });
});

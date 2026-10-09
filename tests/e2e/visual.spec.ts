import type { Page } from '@playwright/test';
import { searched } from '../source-files';
import { test, expect } from './fixtures';
import { openRoster } from './helpers';
import { THEMES } from '../palette';
import { expectTheme } from '../themes';

/**
 * What a 100% green suite cannot see (#33).
 *
 * Every other assertion in this corpus reads the DOM: text, structure,
 * geometry, measured layout. All of it stays true while the page turns
 * visibly wrong -- a font weight shifts, a colour drifts, a decorative image
 * stops painting, two elements that both still exist at their asserted sizes
 * start overlapping. Those ship past a green run, and one of them did, for a
 * whole release (see the `display: flex` note in CLAUDE.md).
 *
 * Screenshots are the only assertion that sees them, and they are also the
 * assertion most likely to be switched off in a week. So the determinism is
 * engineered BEFORE the baselines exist, not patched in after the first
 * flake:
 *
 *  - animations and transitions are disabled, and the caret hidden, from
 *    `expect.toHaveScreenshot` in the config, so no call site can forget;
 *  - `document.fonts.ready` is awaited, because a font that arrives one frame
 *    late re-flows every line of text on the page and is otherwise a coin
 *    toss between runs;
 *  - no page reads the clock, so nothing dated can reach a baseline. The
 *    footer's copyright year was masked here until #370 removed the line;
 *    `no-dated-render.test.ts` now refuses the date at its source;
 *  - `scale: 'css'` pins the device-pixel ratio, so a HiDPI runner and a
 *    normal one produce comparable images;
 *  - a FULL-PAGE capture holds every sticky element in normal flow
 *    (`holdStickyInFlow`, #311), and the one thing that shows docked, the
 *    action bar, gets a viewport-only picture of its own.
 *
 * The widths live here rather than in the config's device list because they
 * are the thing being asserted: this suite exists to see what a phone-width
 * layout does, and a viewport declared three files away is a fact about the
 * test that its reader cannot check.
 */

/**
 * The four the ticket named (both languages, and both tools), and the 404. A
 * sample by decision: every page here is a baseline per width and theme.
 */
const PAGES = [
  { name: 'home-en', path: '/' },
  { name: 'home-id', path: '/id/' },
  { name: 'yeetalk-calculators', path: '/yeetalk-calculators' },
  { name: 'classroom-groups', path: '/classroom-groups' },
  { name: 'not-found', path: '/404' },
] as const;

const WIDTHS = [
  { label: 'desktop', viewport: { width: 1280, height: 900 } },
  { label: 'mobile', viewport: { width: 390, height: 844 } },
] as const;

/**
 * Wait until `page` has stopped changing on its own: script, then fonts,
 * then images.
 */
async function settle(page: Page): Promise<void> {
  // The heading is the last thing to settle on the two tool pages, whose
  // scripts rewrite the DOM after load. On the homepage, whose one script is
  // the theme script and rewrites nothing, it is already there and this
  // returns immediately.
  await expect(page.locator('h1').first()).toBeVisible();
  // Awaited INSIDE the callback, not returned from it.
  // `document.fonts.ready` resolves with the FontFaceSet itself, which is not
  // serialisable across the protocol -- returning it makes Playwright try to
  // marshal a live object back to Node.
  await page.evaluate(async () => {
    await document.fonts.ready;
  });
  // Every image loaded and decoded before any capture (#519). The ShyTalk
  // phone screenshot is `loading="lazy"`, and at 390px it sits below the
  // fold, so it began loading only when a full-page capture enlarged the
  // view: the first capture of the mobile homepage lacked it (153k px, in
  // exactly the phone's box) and only the capture-until-stable loop hid that,
  // until a slow run spent its whole budget there. The page keeps `lazy` for
  // visitors; only the capture asks for every image up front. `decode()`
  // rejects for an image that cannot load, so a broken one fails the test
  // rather than being pictured broken.
  await page.evaluate(async () => {
    const images = [...document.images];
    for (const image of images) image.loading = 'eager';
    await Promise.all(images.map((image) => image.decode()));
  });
}

/**
 * Put every sticky element back in normal flow, for a full-page capture
 * (#311).
 *
 * A full-page capture in Chromium resizes the view to the whole page and
 * back. The action bar is sticky, so Chromium gives it a compositor layer of
 * its own, and a full-page picture stitches it mid-page where the viewport's
 * bottom edge was. On about one run in 150 on the runner, the bar came out of
 * that resize with its label one pixel up and to the left, and it stayed
 * there. The run's trace shows the label in place in every frame before the
 * capture, and moved in every frame after it.
 *
 * In flow, the bar is an ordinary block at the end of the form. Nothing is
 * docked, nothing is stitched over the content it would otherwise hide, and
 * the capture has no docked layer to re-snap. How it looks docked is
 * a separate, viewport-only picture below, which never resizes the view.
 *
 * The elements are found from their computed style rather than by name, so a
 * sticky element added later is held from the day it appears. Each one it
 * finds is returned by name, so the caller can prove what it searched.
 */
async function holdStickyInFlow(
  page: Page,
): Promise<{ held: string[]; stillSticky: string[] }> {
  return page.evaluate(() => {
    const name = (el: Element) =>
      [
        el.tagName.toLowerCase(),
        el.id ? `#${el.id}` : '',
        ...[...el.classList].map((c) => `.${c}`),
      ].join('');
    const sticky = () =>
      [...document.querySelectorAll<HTMLElement>('*')].filter(
        (el) => getComputedStyle(el).position === 'sticky',
      );
    const held = sticky();
    for (const el of held) {
      el.style.setProperty('position', 'static', 'important');
    }
    return { held: held.map(name), stillSticky: sticky().map(name) };
  });
}

/**
 * Settle `page`, then compare it with the `snapshot` baseline: the whole
 * page by default, with every sticky element in flow, or only the viewport
 * with `fullPage: false`, where sticky elements stay docked.
 */
async function expectSamePixels(
  page: Page,
  snapshot: string,
  { fullPage = true }: { fullPage?: boolean } = {},
): Promise<void> {
  await settle(page);

  if (fullPage) {
    const { held, stillSticky } = await holdStickyInFlow(page);
    expect(
      searched(stillSticky, { of: held, what: 'sticky elements' }),
      'a sticky element left docked is the layer a full-page capture ' +
        're-snaps (#311)',
    ).toEqual([]);
  }

  await expect(page).toHaveScreenshot(snapshot, { fullPage });
}

for (const theme of THEMES) {
  // Dark keeps today's file names, so its diff reads file by file against
  // the baselines it replaces; light is new, and says so (#142 §6.5).
  const suffix = theme === 'dark' ? '' : `-${theme}`;

  test.describe(`${theme} theme`, () => {
    test.use({ colorScheme: theme });

    for (const { label, viewport } of WIDTHS) {
      // `test.use({ viewport })` resizes every test in this group, and a real
      // phone has one screen: the tag is what keeps android-chrome from running
      // them (tests/guards/viewport-tagging.test.ts, #218).
      test.describe(
        `${label} @${viewport.width}px`,
        { tag: '@emulated-viewport' },
        () => {
          test.use({ viewport });

          for (const { name, path } of PAGES) {
            test(`${name} renders the same pixels`, async ({ page }) => {
              await page.goto(path);
              await expectTheme(page, theme);
              await expectSamePixels(page, `${name}-${label}${suffix}.png`);
            });
          }

          // The roster's column headings exist only once a student is added, and
          // CSS alone decides whether a sighted teacher sees them: the card layout
          // hides the whole row, the table layout shows it again, and Remove's own
          // heading stays hidden in both. No DOM assertion can tell a hidden heading
          // from a shown one (#200), so the roster is captured with a student in it.
          test('classroom-groups with a student added renders the same pixels', async ({
            page,
          }) => {
            await openRoster(page);
            await expectTheme(page, theme);
            // The state is proved before it can become a baseline: a roster that
            // failed to open would be captured empty, and every later run would
            // compare against that empty picture and pass.
            await expect(page.locator('#cg-roster tbody tr')).toHaveCount(1);
            await expectSamePixels(
              page,
              `classroom-groups-roster-${label}${suffix}.png`,
            );
          });

          // The action bar as a teacher first meets it: docked on the fold, over
          // the form it has not reached yet (#311, operator decision 2026-09-23).
          // The full-page pictures above hold it in flow, so this is the only
          // picture of the docked look. It is viewport-only, and a viewport capture
          // never resizes the view, which is the step that moved the bar's label.
          test('classroom-groups with the action bar docked renders the same pixels', async ({
            page,
          }) => {
            await page.goto('/classroom-groups');
            await expectTheme(page, theme);
            await settle(page);
            // Docking is proved before it can become a baseline. A bar that had
            // stopped docking would be photographed wherever it sat, and every
            // later run would pass against that picture.
            const bar = page.locator('p.actions');
            await expect(bar).toHaveCSS('position', 'sticky');
            const { bottom, fold } = await bar.evaluate((el) => ({
              bottom: el.getBoundingClientRect().bottom,
              fold: window.innerHeight,
            }));
            expect(bottom, 'the action bar rests on the fold').toBeCloseTo(
              fold,
              0,
            );
            await expectSamePixels(
              page,
              `classroom-groups-docked-${label}${suffix}.png`,
              {
                fullPage: false,
              },
            );
          });
        },
      );
    }
  });
}

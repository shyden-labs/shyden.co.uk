import { test, expect } from './fixtures';
import type { Page } from '@playwright/test';
import { docsPaths } from '../site-pages';
import { searched } from '../source-files';
import { contrastRatio } from './helpers';
import { docsSpecFile, requiredTextFields } from '../api-docs-pages';
import { recorded, shoot } from './evidence';
import { IOS_ZOOM_FLOOR_PX, measureTypedFields } from '../typed-fields';
import { offPalette, readPalette } from './palette-readings';

test.use(recorded);

/**
 * #781. The API docs pages meet the site's bar (operator decision
 * 2026-10-15): no sideways scroll at 320px, WCAG AA text, 44px targets, in
 * both themes. Swagger UI draws them at run time, so they are measured with
 * every operation open and Try it out showing, the most the page can show.
 */

const WIDTHS = [320, 1280] as const;
const THEMES = ['light', 'dark'] as const;
/**
 * Each docs page's recorded floors, spelled once here so the floor reader can
 * find them (literal-floors.test.ts); a page with no entry fails its tests.
 */
const FLOORS: Readonly<
  Record<
    string,
    {
      readonly texts: string;
      readonly controls: string;
      readonly typed: string;
      readonly painted: string;
    }
  >
> = {
  '/api/docs/': {
    texts: 'api-docs/public-texts',
    controls: 'api-docs/public-controls',
    typed: 'api-docs/public-typed-fields',
    painted: 'api-docs/public-painted-controls',
  },
  '/api/docs/private/': {
    texts: 'api-docs/private-texts',
    controls: 'api-docs/private-controls',
    typed: 'api-docs/private-typed-fields',
    painted: 'api-docs/private-painted-controls',
  },
};

/**
 * Opens every operation and its Try it out, then sends each, as a visitor
 * exploring would. A preview of dist/ runs no Pages Function, so the API's
 * answer is a stand-in: the response view is what is measured, not the API.
 */
const openEverything = async (page: Page, path: string) => {
  await page.route(
    (url) => url.pathname.startsWith('/api/report'),
    (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json; charset=utf-8',
        body: '{"outcome":"sent"}',
      }),
  );
  const operations = page.locator('#swagger .opblock');
  await expect(operations.first()).toBeVisible();
  // Each step waits for an exact count before it acts: Swagger UI draws an
  // operation's body a moment after the click, and a list read too early is
  // empty, which would measure a collapsed page and pass.
  const count = await operations.count();
  // runtime population: the operations Swagger UI drew from the spec.
  const summaries = page.locator('#swagger .opblock-summary-control');
  await expect(summaries).toHaveCount(count);
  for (const summary of await summaries.all()) await summary.click();
  await expect(page.locator('#swagger .opblock.is-open')).toHaveCount(count);
  const tryOuts = page.locator('#swagger .try-out__btn');
  await expect(tryOuts).toHaveCount(count);
  // runtime population: one Try it out per open operation.
  for (const tryIt of await tryOuts.all()) await tryIt.click();
  const executes = page.locator('#swagger .btn.execute');
  await expect(executes).toHaveCount(count);
  // The fields the page's own spec requires a visitor to type: Swagger UI
  // sends nothing while one is empty, and labels each with its name.
  for (const name of requiredTextFields(docsSpecFile(path)))
    await page.getByPlaceholder(name, { exact: true }).fill('x');
  // runtime population: one Execute per operation.
  for (const execute of await executes.all()) await execute.click();
  await expect(
    page.locator('#swagger .live-responses-table .response'),
  ).toHaveCount(count);
  // Swagger UI's `.btn` eases every property over 0.3 s, so a button the
  // clicks above restyled is still between its old and new colours: WebKit
  // read Execute at 3.83:1 mid-fade (run 38756544561). Every reading below
  // is of the settled page a visitor sees.
  await page.waitForFunction(() => document.getAnimations().length === 0);
};

/** Every visible element in the mount that holds text of its own, with the ratio WCAG asks of it. */
const textsToRead = (page: Page) =>
  page.evaluate(() => {
    const probes: { index: number; said: string; need: number }[] = [];
    let index = 0;
    for (const el of document.querySelectorAll('#swagger *')) {
      if (!el.getClientRects().length) continue;
      const own = [...el.childNodes].some(
        (node) => node.nodeType === Node.TEXT_NODE && node.textContent?.trim(),
      );
      if (!own) continue;
      const style = getComputedStyle(el);
      const size = parseFloat(style.fontSize);
      const bold = Number(style.fontWeight) >= 700;
      el.setAttribute('data-docs-probe', String(index));
      probes.push({
        index,
        said: (el.textContent ?? '').trim().slice(0, 40),
        need: size >= 24 || (bold && size >= 18.66) ? 3 : 4.5,
      });
      index += 1;
    }
    return probes;
  });

/** Every visible control in the mount, with its size. */
const controlSizes = (page: Page) =>
  page.evaluate(() =>
    [
      ...document.querySelectorAll(
        '#swagger button, #swagger a, #swagger select, #swagger input, #swagger textarea, #swagger summary',
      ),
    ]
      .filter((el) => el.getClientRects().length)
      .map((el) => {
        const box = el.getBoundingClientRect();
        return {
          name: `${el.tagName.toLowerCase()} ${(el.textContent ?? '').trim().slice(0, 30)}`,
          width: box.width,
          height: box.height,
        };
      }),
  );

test.describe('the API docs meet the site bar (#781)', () => {
  for (const path of docsPaths())
    for (const theme of THEMES)
      for (const width of WIDTHS)
        test(
          `${path} in the ${theme} theme at ${width}px`,
          { tag: '@emulated-viewport' },
          async ({ page }) => {
            await page.emulateMedia({ colorScheme: theme });
            await page.setViewportSize({ width, height: 900 });
            await page.goto(path);
            await openEverything(page, path);
            const floors = FLOORS[path];
            if (!floors) throw new Error(`${path} has no floors in FLOORS`);

            const box = await page.evaluate(() => {
              const mount = document.querySelector('#swagger');
              const root = document.documentElement;
              return {
                page: root.scrollWidth - root.clientWidth,
                mount: mount ? mount.scrollWidth - mount.clientWidth : -1,
              };
            });
            expect(
              box,
              'nothing pushes the page or the mount sideways',
            ).toEqual({ page: 0, mount: 0 });

            const probes = await textsToRead(page);
            const dim: string[] = [];
            // runtime population: the text Swagger UI drew in this state.
            for (const probe of probes) {
              const ratio = await contrastRatio(
                page.locator(`[data-docs-probe="${probe.index}"]`),
              );
              if (ratio < probe.need)
                dim.push(
                  `'${probe.said}' ${ratio.toFixed(2)}:1 < ${probe.need}`,
                );
            }
            expect(
              searched(dim, { of: probes, what: `${path} text elements` }),
            ).toEqual([]);
            expect(floorBreach(floors.texts, probes.length)).toBeUndefined();

            const controls = await controlSizes(page);
            const small = controls
              .filter((c) => c.width < 44 || c.height < 44)
              .map(
                (c) =>
                  `${c.name} ${Math.round(c.width)}x${Math.round(c.height)}`,
              );
            expect(
              searched(small, { of: controls, what: `${path} controls` }),
            ).toEqual([]);
            expect(
              floorBreach(floors.controls, controls.length),
            ).toBeUndefined();

            // The two page-wide sweeps that read pages as they load hand the
            // docs over to this, the state with every field drawn.
            const typed = await page.evaluate(measureTypedFields);
            const zooming = typed
              .filter(({ fontSize }) => fontSize < IOS_ZOOM_FLOOR_PX)
              .map(({ field, fontSize }) => `${field} ${fontSize}px`);
            expect(
              searched(zooming, { of: typed, what: `${path} typed fields` }),
            ).toEqual([]);
            expect(floorBreach(floors.typed, typed.length)).toBeUndefined();

            const { allowed, readings } = await readPalette(page);
            expect(
              searched(offPalette(readings, allowed), {
                of: readings,
                what: `${path} painted controls`,
              }),
            ).toEqual([]);
            expect(
              floorBreach(floors.painted, readings.length),
            ).toBeUndefined();

            await shoot(page, `${path}, ${theme}, ${width}px, everything open`);
          },
        );
});

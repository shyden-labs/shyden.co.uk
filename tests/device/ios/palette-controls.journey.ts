/**
 * The palette on the real iPhone: every test tests/e2e/palette-controls.spec.ts
 * runs on the real Android phone, under the same title with an `iOS mirror:`
 * prefix (#801; global rule 2026-10-15, every test mirrored, no exceptions).
 * The palette is read by the same in-page function Android's run uses
 * (`readPaletteIn`, palette-readings.ts), sent over WebDriver.
 *
 * Android emulates the device's colour scheme for each theme; WebDriver
 * cannot set Safari's, so the theme arrives as the saved choice the page
 * honours, stamped before the load. The device's own scheme is #811's.
 */
import { describe, expect, test } from 'vitest';
import {
  isBetaLocale,
  localeFromPath,
  PREFIXED_LOCALES,
} from '../../../src/lib/i18n';
import { floorBreach } from '../../floors';
import { THEMES } from '../../palette';
import { docsPaths, NOT_FOUND_PATH, PUBLISHED_ROUTES } from '../../site-pages';
import { searched } from '../../source-files';
import {
  offPalette,
  PAINTED,
  readPaletteScript,
  type PaletteReading,
} from '../../e2e/palette-readings';
import { countOf, expectLocator } from './dom';
import { shootDevice } from './evidence';
import { holdIosSession } from './held-session';
import { announceMode } from './session';

const phone = holdIosSession();

/** Android's `shoot`: evidence only, written when the run asks for it. */
const shoot = (label: string): Promise<string | null> =>
  shootDevice(phone().driver, { project: 'ios-safari-real-device', label });

const PAGES = PUBLISHED_ROUTES.filter((path) => !docsPaths().includes(path));

/** A published path without its locale prefix: `/id/classroom-groups` is `/classroom-groups`. */
const routeOf = (path: string): string => {
  const prefix = PREFIXED_LOCALES.find(
    (locale) => path === `/${locale}/` || path.startsWith(`/${locale}/`),
  );
  if (prefix === undefined) return path;
  const rest = path.slice(prefix.length + 1);
  return rest === '/' || rest === '' ? '/' : rest;
};

describe('iOS mirror: palette controls', () => {
  for (const path of PAGES)
    for (const theme of THEMES)
      test(`iOS mirror: ${path}, ${theme}: every control it paints uses a palette colour`, async () => {
        announceMode(phone(), `palette controls (${path}, ${theme})`);
        // NOT YET THE SAME as Android (#811): Android emulates the device
        // colour scheme after the load; WebDriver cannot, so the theme is the
        // SAVED choice, stamped before it. Kept, never deleted (Shyden
        // 2026-10-16), until #811 sets the phone's appearance.
        await phone().navigateToPath(path, 'body', theme);
        await phone().driver.executeScript(
          `for (const details of document.querySelectorAll('details')) details.open = true;`,
        );
        const { allowed, examined, readings } =
          await phone().driver.executeScript<PaletteReading>(
            readPaletteScript(),
            [PAINTED],
          );

        if (path === '/') {
          expect(
            allowed.length,
            'the homepage served no palette, so nothing was measured at all',
          ).toBeGreaterThan(0);
          expect(
            searched(readings, {
              of: examined,
              what: 'elements on the homepage the selector ran over',
            }),
            'the homepage paints no form controls',
          ).toHaveLength(0);
          expect(
            floorBreach('ios-palette-controls/homepage-elements', examined),
          ).toBeUndefined();
          await shoot(
            `${path}, ${theme}: no form controls among ${examined} elements`,
          );
          return;
        }
        expect(
          readings.length,
          `${path} rendered no controls — the selector or the page changed`,
        ).toBeGreaterThan(0);
        expect(
          searched(offPalette(readings, allowed), {
            of: readings,
            what: `controls measured on ${path}`,
          }),
          `${theme}: off-palette control colours on ${path}; the palette resolved to ${allowed.length} values`,
        ).toEqual([]);
        // The controls read, as a floor recorded on the phone (#801): one id
        // per route and language kind, spelled whole. A beta language's page
        // also carries the report form, so English and the beta languages
        // paint different sets; both themes paint the same one. Android's
        // copy of this search has no floor.
        const beta = isBetaLocale(localeFromPath(path));
        const floor = {
          '/ beta': () =>
            floorBreach('ios-palette-controls/home-beta', readings.length),
          '/yeetalk-calculators': () =>
            floorBreach('ios-palette-controls/glory-points', readings.length),
          '/yeetalk-calculators beta': () =>
            floorBreach(
              'ios-palette-controls/glory-points-beta',
              readings.length,
            ),
          '/classroom-groups': () =>
            floorBreach(
              'ios-palette-controls/classroom-groups',
              readings.length,
            ),
          '/classroom-groups beta': () =>
            floorBreach(
              'ios-palette-controls/classroom-groups-beta',
              readings.length,
            ),
          [NOT_FOUND_PATH]: () =>
            floorBreach('ios-palette-controls/not-found', readings.length),
        }[
          path === NOT_FOUND_PATH
            ? path
            : `${routeOf(path)}${beta ? ' beta' : ''}`
        ];
        expect(floor, `${path} has a controls floor`).toBeDefined();
        expect(floor!()).toBeUndefined();
        await shoot(
          `${path}, ${theme}: all ${readings.length} controls drawn from the palette's ${allowed.length} values`,
        );
      });

  for (const theme of THEMES)
    test(`iOS mirror: ${theme}: the controls the browser draws use the brand accent`, async () => {
      announceMode(phone(), `UA controls accent (${theme})`);
      // NOT YET THE SAME as Android (#811): Android emulates the device
      // colour scheme after the load; WebDriver cannot, so the theme is the
      // SAVED choice, stamped before it. Kept, never deleted (Shyden
      // 2026-10-16), until #811 sets the phone's appearance.
      await phone().navigateToPath('/classroom-groups', '#cg-go', theme);
      const boxes = 'input[type="checkbox"], input[type="radio"]';
      await expectLocator(phone().driver, boxes, { nth: 0 }).toBeVisible();
      const resolved = await phone().driver.executeScript<string>(
        `const accent = getComputedStyle(document.documentElement).getPropertyValue('--accent').trim();
         const probe = document.createElement('span');
         probe.style.color = accent;
         document.body.append(probe);
         const resolved = getComputedStyle(probe).color;
         probe.remove();
         return resolved;`,
      );
      // `for (const box of await boxes.all())`: the boxes there are now, a
      // population known only at run time, each retried as toHaveCSS is.
      const count = await countOf(phone().driver, boxes);
      for (let nth = 0; nth < count; nth++)
        await expectLocator(phone().driver, boxes, { nth }).toHaveCSS(
          'accent-color',
          resolved,
        );
      await shoot(
        `${theme}: all ${count} browser-drawn controls use --accent ${resolved}`,
      );
    });
});

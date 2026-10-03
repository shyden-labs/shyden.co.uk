import type { Page } from '@playwright/test';
import { test, expect } from './fixtures';
import { recorded, shoot } from './evidence';
import { recordErrors } from './recorders';
import { resolvedColour } from './helpers';
import { THEMES, themeColour } from '../palette';
import { emulateTheme, expectTheme } from '../themes';
import { atLeast44 } from '../viewport';
import { LOCALES, getSiteStrings, localisePath } from '../../src/lib/i18n';
import { searched } from '../source-files';
import { PUBLISHED_ROUTES } from './published-paths';

test.use(recorded);

/**
 * The switch, rendered (#142 §6.3). The project's device prefers dark, so a
 * page with no saved choice shows Aurora, and a test that needs another
 * device says so with `test.use({ colorScheme })`.
 */

const SWITCH = 'header [data-theme-toggle]';
const toggle = (page: Page) => page.locator(SWITCH);

/**
 * Record the ground of the first frame that paints one, from an init script,
 * before the page's own scripts run. Until the stylesheet applies, the ground
 * is the UA's transparent. The first frame with a ground is the frame a flash
 * would show in.
 */
const recordFirstGround = (page: Page) =>
  page.addInitScript(() => {
    const read = () => {
      const ground = getComputedStyle(document.documentElement).backgroundColor;
      if (ground === 'rgba(0, 0, 0, 0)') requestAnimationFrame(read);
      else document.documentElement.dataset.firstGround = ground;
    };
    requestAnimationFrame(read);
  });

test.describe('no flash of the other theme (#142 §6.3, AC5)', () => {
  for (const [saved, device] of [
    ['light', 'dark'],
    ['dark', 'light'],
  ] as const) {
    test.describe(`a saved ${saved} choice on a device preferring ${device}`, () => {
      test.use({ colorScheme: device });

      test('the first frame that paints a ground paints the saved theme', async ({
        page,
      }) => {
        await page.goto('/glory-points');
        await expectTheme(page, device);
        await page.evaluate(
          (theme) => localStorage.setItem('theme', theme),
          saved,
        );
        await recordFirstGround(page);
        await page.goto('/');
        await expect(page.locator('html')).toHaveAttribute(
          'data-first-ground',
          themeColour(saved, '--bg'),
        );
        await expectTheme(page, saved);
        await shoot(
          page,
          `a saved ${saved} choice on a ${device} device: the first painted frame is already ${saved}`,
        );
      });
    });
  }
});

test.describe('a saved value that is not exactly light or dark (Review Focus 1)', () => {
  test.use({ colorScheme: 'light' });

  // One test per value (#390 F150): six reloads in one test shared one budget,
  // and the first value to fail hid the rest.
  for (const stale of ['Dark', ' dark', 'dark\n', '"dark"', 'auto', ''])
    test(`${JSON.stringify(stale)} is ignored, and the device setting applies`, async ({
      page,
    }) => {
      await page.goto('/');
      await page.evaluate(
        (value) => localStorage.setItem('theme', value),
        stale,
      );
      await page.reload();
      await expectTheme(page, 'light');
      await expect(
        page.locator('html'),
        `${JSON.stringify(stale)} stamped nothing`,
      ).not.toHaveAttribute('data-theme', /./);
    });
});

test.describe('the switch (#142 §5, AC3)', () => {
  for (const locale of LOCALES) {
    test(`${locale}: a toggle button named in its own language, pressed while dark`, async ({
      page,
    }) => {
      const name = getSiteStrings(locale).themeDarkMode;
      await page.goto(localisePath('/', locale));
      const button = page.getByRole('button', { name, exact: true });
      await expect(button).toHaveCount(1);
      await expect(button).toHaveAttribute('aria-pressed', 'true');
      await button.click();
      await expectTheme(page, 'light');
      await expect(button).toHaveAttribute('aria-pressed', 'false');
      await shoot(
        page,
        `${locale}: "${name}" pressed off, and the page is light`,
        button,
      );
    });
  }

  test('is 44 × 44, with a visible focus ring', async ({ page }) => {
    await page.goto('/');
    await expect(toggle(page)).toBeVisible();
    await atLeast44(toggle(page), 'the theme switch');
    // A keypress first, so the focus below is keyboard focus to every
    // engine's :focus-visible heuristic.
    await page.keyboard.press('Shift');
    await toggle(page).focus();
    await expect(toggle(page)).toHaveCSS('outline-style', 'solid');
    await expect(toggle(page)).toHaveCSS('outline-width', '3px');
    await shoot(
      page,
      'the switch focused: its ring is the accent',
      toggle(page),
    );
  });

  test('Enter and Space each toggle it', async ({ page }) => {
    await page.goto('/');
    await toggle(page).focus();
    await page.keyboard.press('Enter');
    await expectTheme(page, 'light');
    await page.keyboard.press('Space');
    await expectTheme(page, 'dark');
  });

  test('switches instantly: the next frame already paints the new ground', async ({
    page,
  }) => {
    await page.goto('/');
    await expectTheme(page, 'dark');
    const next = await toggle(page).evaluate(
      (button) =>
        new Promise<string>((resolve) => {
          (button as HTMLElement).click();
          requestAnimationFrame(() =>
            resolve(getComputedStyle(document.documentElement).backgroundColor),
          );
        }),
    );
    expect(next).toBe(themeColour('light', '--bg'));
  });

  test('does not print', async ({ page }) => {
    await page.goto('/');
    await expect(toggle(page)).toBeVisible();
    await page.emulateMedia({ media: 'print' });
    await expect(toggle(page)).toHaveCount(1);
    await expect(toggle(page)).toBeHidden();
  });

  test('under forced colours, its icon draws in the system text colour (Review Focus 4)', async ({
    page,
    browserName,
  }) => {
    test.skip(
      browserName !== 'chromium',
      'Playwright emulates forcedColors in Chromium alone',
    );
    await page.emulateMedia({ forcedColors: 'active' });
    await page.goto('/');
    const drawn = await toggle(page).evaluate((button) => ({
      ink: getComputedStyle(button).color,
      paints: [...button.querySelectorAll('svg')]
        .filter((svg) => svg.getClientRects().length > 0)
        .flatMap((svg) => [...svg.querySelectorAll('circle, path')])
        .map((shape) => {
          const style = getComputedStyle(shape);
          return style.fill === 'none' ? style.stroke : style.fill;
        }),
    }));
    expect(
      drawn.paints.length,
      'the visible icon draws something',
    ).toBeGreaterThan(0);
    expect([...new Set(drawn.paints)]).toEqual([drawn.ink]);
  });
});

test.describe('without JavaScript (#142 AC7)', () => {
  test.use({ javaScriptEnabled: false });

  for (const theme of THEMES) {
    test.describe(`on a device preferring ${theme}`, () => {
      test.use({ colorScheme: theme });

      test(
        'the switch is absent, and the device setting applies',
        { tag: '@requires-isolated-context' },
        async ({ page }) => {
          await page.goto('/');
          await expectTheme(page, theme);
          await expect(toggle(page)).toHaveCount(1);
          await expect(toggle(page)).toBeHidden();
          await expect(toggle(page)).not.toHaveAttribute('aria-pressed', /./);
        },
      );
    });
  }
});

test.describe('the choice persists (#142 AC4)', () => {
  test('across a reload and a second page', async ({ page }) => {
    await page.goto('/');
    await expectTheme(page, 'dark');
    await toggle(page).click();
    await expectTheme(page, 'light');
    await page.reload();
    await expectTheme(page, 'light');
    await expect(toggle(page)).toHaveAttribute('aria-pressed', 'false');
    await page.goto('/glory-points');
    await expectTheme(page, 'light');
    await shoot(
      page,
      'a light choice made on the homepage holds on /glory-points',
      toggle(page),
    );
  });

  test(
    'into a new session that carries the same storage',
    { tag: '@requires-isolated-context' },
    async ({ page, browser, baseURL }) => {
      await page.goto('/');
      await toggle(page).click();
      await expectTheme(page, 'light');
      const storageState = await page.context().storageState();
      const session = await browser.newContext({
        storageState,
        baseURL,
        colorScheme: 'dark',
      });
      try {
        const next = await session.newPage();
        await next.goto('/');
        await expectTheme(next, 'light');
      } finally {
        await session.close();
      }
    },
  );

  test('and a press after a stale saved value saves a valid one (Review Focus 1)', async ({
    page,
  }) => {
    await page.goto('/');
    await page.evaluate(() => localStorage.setItem('theme', 'Dark'));
    await page.reload();
    await toggle(page).click();
    await expectTheme(page, 'light');
    expect(await page.evaluate(() => localStorage.getItem('theme'))).toBe(
      'light',
    );
  });

  test('and a double press lands where it started, saving what it shows (Review Focus 2)', async ({
    page,
  }) => {
    await page.goto('/');
    await toggle(page).dblclick();
    await expectTheme(page, 'dark');
    await expect(toggle(page)).toHaveAttribute('aria-pressed', 'true');
    expect(await page.evaluate(() => localStorage.getItem('theme'))).toBe(
      'dark',
    );
  });
});

test.describe('storage refused (#142 AC7)', () => {
  test('the switch still changes the page, nothing is saved, and nothing is logged', async ({
    page,
  }) => {
    await page.addInitScript(() => {
      Object.defineProperty(window, 'localStorage', {
        configurable: true,
        get() {
          throw new DOMException('The operation is insecure.', 'SecurityError');
        },
      });
    });
    const errors = recordErrors(page);
    await page.goto('/');
    await expectTheme(page, 'dark');
    await toggle(page).click();
    await expectTheme(page, 'light');
    await expect(toggle(page)).toHaveAttribute('aria-pressed', 'false');
    await errors.expectNone('the theme script threw where storage is refused');
    // A second page carries no refusal, so it can read what was saved.
    const probe = await page.context().newPage();
    await probe.goto('/');
    expect(
      await probe.evaluate(() => localStorage.getItem('theme')),
    ).toBeNull();
    await probe.close();
  });
});

test.describe('the device (#142 AC2)', () => {
  test('with no choice saved, the page and the switch follow it, live', async ({
    page,
  }) => {
    await page.goto('/');
    await expectTheme(page, 'dark');
    await expect(toggle(page)).toHaveAttribute('aria-pressed', 'true');
    await emulateTheme(page, 'light');
    await expect(toggle(page)).toHaveAttribute('aria-pressed', 'false');
    await emulateTheme(page, 'dark');
    await expect(toggle(page)).toHaveAttribute('aria-pressed', 'true');
  });

  test('with a choice saved, a change on the device changes nothing (Review Focus 5)', async ({
    page,
  }) => {
    await page.goto('/');
    await toggle(page).click();
    await expectTheme(page, 'light');
    await page.emulateMedia({ colorScheme: 'light' });
    await page.emulateMedia({ colorScheme: 'dark' });
    await expectTheme(page, 'light');
    await expect(toggle(page)).toHaveAttribute('aria-pressed', 'false');
  });

  test('an engine without MediaQueryList.addEventListener still switches, and logs nothing (Review Focus 3)', async ({
    page,
  }) => {
    await page.addInitScript(() => {
      // Safari before 14 offered only the deprecated addListener.
      Object.defineProperty(MediaQueryList.prototype, 'addEventListener', {
        configurable: true,
        value: undefined,
      });
    });
    const errors = recordErrors(page);
    await page.goto('/');
    await toggle(page).click();
    await expectTheme(page, 'light');
    await page.reload();
    await expectTheme(page, 'light');
    await errors.expectNone(
      'the theme script threw without MediaQueryList.addEventListener',
    );
  });
});

test.describe('Back (#142 §5 step 5, AC4)', () => {
  test('a page restored from the back-forward cache shows the theme chosen after leaving it', async ({
    page,
  }) => {
    await page.goto('/');
    await expectTheme(page, 'dark');
    await page.evaluate(() => {
      addEventListener('pageshow', (event) => {
        if (event.persisted) document.documentElement.dataset.restored = '';
      });
    });
    await page.goto('/glory-points');
    await toggle(page).click();
    await expectTheme(page, 'light');
    await page.goBack();
    await page.waitForLoadState();
    const restored = await page.evaluate(
      () => 'restored' in document.documentElement.dataset,
    );
    test.skip(
      !restored,
      'this engine reloaded the page instead of restoring it from the back-forward cache ' +
        '(Playwright launches Chromium with --disable-back-forward-cache); a reload re-runs ' +
        'the head script and would pass without the pageshow handler ever running',
    );
    await expectTheme(page, 'light');
    await expect(toggle(page)).toHaveAttribute('aria-pressed', 'false');
  });

  test('the pageshow handler re-applies the saved choice, and aria-pressed with it', async ({
    page,
  }) => {
    // Runs on every engine, so the handler is proven even where every engine
    // skips the real Back above (§6.3).
    await page.goto('/');
    await expectTheme(page, 'dark');
    await expect(toggle(page)).toHaveAttribute('aria-pressed', 'true');
    await page.evaluate(() => {
      localStorage.setItem('theme', 'light');
      dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true }));
    });
    await expectTheme(page, 'light');
    await expect(toggle(page)).toHaveAttribute('aria-pressed', 'false');
  });
});

/**
 * #371. An aurora ribbon: one broad, soft band of the brand's teal, violet
 * and blue across the top of the page, behind the header and the hero,
 * fading out before the content (the operator's choice, 2026-09-27, after a
 * dot grid too faint to see). It is `body::after`, absolutely placed at the
 * top of the document, so it scrolls away with the hero.
 */
test.describe('the aurora ribbon (#371)', () => {
  const TOKENS = ['--ribbon-a', '--ribbon-b', '--ribbon-c'] as const;

  /** body::after as painted, and the ribbon tokens resolved the same way. */
  const ribbon = async (page: Page) => {
    const layer = await page.evaluate(() => {
      const after = getComputedStyle(document.body, '::after');
      return {
        display: after.display,
        position: after.position,
        top: after.top,
        image: after.backgroundImage,
      };
    });
    const colours: string[] = [];
    for (const token of TOKENS)
      colours.push(await resolvedColour(page, `var(${token})`));
    return { ...layer, colours };
  };

  for (const theme of THEMES)
    test(`${theme}: the ribbon is drawn at the top of the page in the theme's own colours`, async ({
      page,
    }) => {
      await page.goto('/');
      await emulateTheme(page, theme);
      const drawn = await ribbon(page);
      expect(drawn.display).not.toBe('none');
      expect(drawn.position).toBe('absolute');
      expect(drawn.top).toBe('0px');
      expect(drawn.image.match(/radial-gradient/g) ?? []).toHaveLength(3);
      for (const [n, colour] of drawn.colours.entries()) {
        expect(colour, `${TOKENS[n]} resolves to a colour`).toMatch(/^rgba?\(/);
        expect(drawn.image, `the ribbon paints ${TOKENS[n]}`).toContain(colour);
      }
    });

  test('the two themes paint different ribbons', async ({ page }) => {
    // Each colour must be one the ribbon paints: an undefined token makes the
    // probe inherit the theme's ink, which also differs by theme (the dot
    // grid's version of this test passed against no grid at all, #371).
    await page.goto('/');
    await emulateTheme(page, 'light');
    const light = await ribbon(page);
    await emulateTheme(page, 'dark');
    const dark = await ribbon(page);
    for (const drawn of [light, dark])
      for (const colour of drawn.colours) expect(drawn.image).toContain(colour);
    expect(light.colours).not.toEqual(dark.colours);
  });

  test('does not print', async ({ page }) => {
    await page.goto('/');
    await page.emulateMedia({ media: 'print' });
    expect((await ribbon(page)).display).toBe('none');
  });

  test('is not drawn under forced colours', async ({ page, browserName }) => {
    test.skip(
      browserName !== 'chromium',
      'Playwright emulates forcedColors in Chromium alone',
    );
    await page.goto('/');
    await page.emulateMedia({ forcedColors: 'active' });
    expect((await ribbon(page)).display).toBe('none');
  });
});

/**
 * Nothing moves when the theme changes (#386). Colour, ground and shadow may
 * change with the theme; geometry may not. The operator saw the ShyTalk
 * wordmark jump ~17px sideways and grow ~12px, because the light theme gave
 * it a tile with padding and the dark theme gave it none, and everything
 * below it moved with it.
 *
 * Derived, not listed: every element in the body, on every page, in every
 * locale, at a phone and a desktop width, is measured in dark, the switch is
 * pressed to light and back to dark, exactly as a visitor does it, and every
 * box is measured again each time, in the same document. Pressing rather than
 * emulating the device matters: a saved choice is served by a different dark
 * block in tokens.css from the device preference. Animations and transitions are frozen
 * identically for both passes, so the marquee's motion cannot read as a
 * theme shift. The theme switch swaps its own sun and moon by design, so its
 * descendants are the one exemption; the switch's own box is still compared.
 */
test.describe('nothing moves when the theme changes (#386)', () => {
  const boxes = (page: Page) =>
    page.evaluate((switchSelector) => {
      const theSwitch = document.querySelector(switchSelector);
      return [...document.body.querySelectorAll('*')].map((el) => {
        const r = el.getBoundingClientRect();
        const classes =
          typeof el.className === 'string' && el.className.trim()
            ? `.${el.className.trim().split(/\s+/).join('.')}`
            : '';
        return {
          what: `${el.tagName.toLowerCase()}${el.id ? `#${el.id}` : ''}${classes}`,
          rendered: el.getClientRects().length > 0,
          inSwitch:
            theSwitch !== null && theSwitch !== el && theSwitch.contains(el),
          box: [r.x, r.y, r.width, r.height].map(
            (v) => Math.round(v * 10) / 10,
          ),
        };
      });
    }, SWITCH);

  // Every published page, the 404 included: walked as every site path in
  // every locale, the 404 and its own switch never changed theme (TG1).
  for (const path of PUBLISHED_ROUTES) {
    for (const width of [390, 1280]) {
      test(
        `${path} at ${width}px: no element moves between dark and light`,
        { tag: '@emulated-viewport' },
        async ({ page }) => {
          await page.setViewportSize({ width, height: 900 });
          await page.goto(path);
          await page.addStyleTag({
            content:
              '*, *::before, *::after { animation: none !important; transition: none !important; }',
          });
          await page.evaluate(() => document.fonts.ready);
          await emulateTheme(page, 'dark');
          const dark = await boxes(page);
          await toggle(page).click();
          await expectTheme(page, 'light');
          const light = await boxes(page);
          await toggle(page).click();
          await expectTheme(page, 'dark');
          const darkAgain = await boxes(page);

          const compared = dark.filter((d) => d.rendered && !d.inSwitch);
          for (const [label, other] of [
            ['light', light],
            ['saved dark', darkAgain],
          ] as const) {
            expect(other, 'the document changed between passes').toHaveLength(
              dark.length,
            );
            const moved = dark
              .map((d, i) => ({ d, o: other[i] }))
              .filter(
                ({ d, o }) =>
                  !d.inSwitch &&
                  (d.rendered !== o.rendered ||
                    d.box.some((v, k) => Math.abs(v - o.box[k]) > 0.5)),
              )
              .map(
                ({ d, o }) => `${d.what} dark ${d.box} -> ${label} ${o.box}`,
              );
            expect(
              searched(moved, {
                of: compared,
                what: 'rendered elements',
              }),
            ).toEqual([]);
          }
        },
      );
    }
  }
});

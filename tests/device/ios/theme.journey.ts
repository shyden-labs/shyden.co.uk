/**
 * The theme switch and ribbon on the real iPhone: the tests from
 * tests/e2e/theme.spec.ts that need nothing Safari's WebDriver lacks, under the
 * same titles with an `iOS mirror:` prefix (#801; global rule 2026-10-15,
 * every test mirrored, no exceptions). The rest need a script injected before
 * the page loads, the device's colour scheme, print or forced-colours
 * emulation, real key presses, or the back-forward cache; each waits for #811,
 * listed in `.superpowers/sdd/801/plan.md`, and is not exempt.
 *
 * Where Android emulates the device's scheme to pick a theme, the theme
 * arrives here as the saved choice the page honours, and the title says so.
 */
import { describe, expect, test } from 'vitest';
import { getSiteStrings, LOCALES, localisePath } from '../../../src/lib/i18n';
import { themeColour, THEMES, type Theme } from '../../palette';
import { expectEventually, expectLocator } from './dom';
import { shootDevice } from './evidence';
import { holdIosSession } from './held-session';
import { byRole, expectRole, expectRoleAttribute } from './roles';
import { announceMode } from './session';

const phone = holdIosSession();

/** `expect(page.locator(selector))`, retried as Playwright retries it (#821). */
const on = (selector: string) => expectLocator(phone().driver, selector);

/** Android's `shoot`: evidence only, written when the run asks for it. */
const shoot = (label: string): Promise<string | null> =>
  shootDevice(phone().driver, { project: 'ios-safari-real-device', label });

const SWITCH = 'header [data-theme-toggle]';

/** The page's ground, as `expectTheme` reads it on Android. */
const ground = (): Promise<string> =>
  phone().driver.executeScript<string>(
    'return getComputedStyle(document.documentElement).backgroundColor;',
  );

/** Waits until the page paints `theme`'s ground, as `toHaveCSS` waits: 5 s. */
const expectTheme = (theme: Theme): Promise<void> =>
  expectEventually(
    ground,
    themeColour(theme, '--bg'),
    `the page to render the ${theme} theme`,
  );

const press = async (): Promise<void> =>
  phone().interaction.click(await phone().driver.findElement(SWITCH));

const saved = (): Promise<string | null> =>
  phone().driver.executeScript<string | null>(
    "return localStorage.getItem('theme');",
  );

describe('iOS mirror: the switch (#142 §5, AC3)', () => {
  for (const locale of LOCALES)
    test(`iOS mirror: ${locale}: a toggle button named in its own language, pressed while dark`, async () => {
      // NOT YET THE SAME as Android (#811): the button is found by the name
      // roles.ts computes, a part of the ARIA naming rules, where Android's
      // getByRole runs Playwright's own. Kept, never deleted (Shyden
      // 2026-10-16), until #811 runs Playwright's name code in Safari.
      announceMode(phone(), `theme switch (${locale})`);
      const name = getSiteStrings(locale).themeDarkMode;
      await phone().navigateToPath(localisePath('/', locale), SWITCH);
      const button = [phone().driver, 'button', name, { exact: true }] as const;
      await expectRole(...button).toHaveCount(1);
      await expectRoleAttribute(...button, 'aria-pressed', 'true');
      await phone().interaction.click(await byRole(...button));
      await expectTheme('light');
      await expectRoleAttribute(...button, 'aria-pressed', 'false');
      await shoot(`${locale}: "${name}" pressed off, and the page is light`);
    });

  test('iOS mirror: switches instantly: the next frame already paints the new ground', async () => {
    announceMode(phone(), 'theme switch, next frame');
    await phone().navigateToPath('/', SWITCH);
    await expectTheme('dark');
    const next = await phone().driver.executeAsyncScript<string>(
      `const done = arguments[arguments.length - 1];
       document.querySelector(arguments[0]).click();
       requestAnimationFrame(() => done(getComputedStyle(document.documentElement).backgroundColor));`,
      [SWITCH],
    );
    expect(next).toBe(themeColour('light', '--bg'));
  });

  test('iOS mirror: across a reload and a second page', async () => {
    announceMode(phone(), 'theme across reload and page');
    await phone().navigateToPath('/', SWITCH);
    await expectTheme('dark');
    await press();
    await expectTheme('light');
    // `page.reload()`: W3C Refresh, and the reads below wait for the NEW
    // document (session.reload marks the old one), never a fresh navigation.
    await phone().reload(SWITCH);
    await expectTheme('light');
    await on(SWITCH).toHaveAttribute('aria-pressed', 'false');
    await phone().driver.navigate(`${phone().baseUrl}/yeetalk-calculators`);
    await expectTheme('light');
    await shoot(
      'a light choice made on the homepage holds on /yeetalk-calculators',
    );
  });

  test('iOS mirror: and a press after a stale saved value saves a valid one (Review Focus 1)', async () => {
    announceMode(phone(), 'theme, stale saved value');
    await phone().navigateToPath('/', SWITCH);
    await phone().driver.executeScript(
      "localStorage.setItem('theme', 'Dark');",
    );
    await phone().reload(SWITCH);
    await press();
    await expectTheme('light');
    expect(await saved()).toBe('light');
  });

  test('iOS mirror: and a double press lands where it started, saving what it shows (Review Focus 2)', async () => {
    // NOT YET THE SAME as Android (#811): Android's `dblclick()` is one
    // gesture (two clicks and a dblclick event); the interaction layer has no
    // double click, so this presses twice. Kept, never deleted (Shyden
    // 2026-10-16), until the harness can double-click.
    announceMode(phone(), 'theme, double press');
    await phone().navigateToPath('/', SWITCH);
    await press();
    await press();
    await expectTheme('dark');
    await on(SWITCH).toHaveAttribute('aria-pressed', 'true');
    expect(await saved()).toBe('dark');
  });
});

describe('iOS mirror: the aurora ribbon (#371)', () => {
  const TOKENS = ['--ribbon-a', '--ribbon-b', '--ribbon-c'] as const;

  /** The ribbon layer and the three colours its tokens resolve to. */
  const ribbon = (): Promise<{
    display: string;
    position: string;
    top: string;
    image: string;
    colours: string[];
  }> =>
    phone().driver.executeScript(
      `const after = getComputedStyle(document.body, '::after');
       const colours = arguments[0].map((token) => {
         const probe = document.createElement('span');
         probe.style.color = 'var(' + token + ')';
         document.body.append(probe);
         const colour = getComputedStyle(probe).color;
         probe.remove();
         return colour;
       });
       return { display: after.display, position: after.position, top: after.top,
                image: after.backgroundImage, colours };`,
      [TOKENS],
    );

  for (const theme of THEMES)
    test(`iOS mirror: ${theme}, saved: the ribbon is drawn at the top of the page in the theme's own colours`, async () => {
      announceMode(phone(), `ribbon (${theme})`);
      // NOT YET THE SAME as Android (#811): Android emulates the device colour
      // scheme; WebDriver cannot, so the theme is the SAVED choice. Kept, never
      // deleted (Shyden 2026-10-16), until #811 sets the phone's appearance.
      await phone().navigateToPath('/', SWITCH, theme);
      const drawn = await ribbon();
      expect(drawn.display).not.toBe('none');
      expect(drawn.position).toBe('absolute');
      expect(drawn.top).toBe('0px');
      expect(drawn.image.match(/radial-gradient/g) ?? []).toHaveLength(3);
      for (const [n, colour] of drawn.colours.entries()) {
        expect(colour, `${TOKENS[n]} resolves to a colour`).toMatch(/^rgba?\(/);
        expect(drawn.image, `the ribbon paints ${TOKENS[n]}`).toContain(colour);
      }
    });

  test('iOS mirror: the two themes paint different ribbons', async () => {
    announceMode(phone(), 'ribbons differ');
    // NOT YET THE SAME as Android (#811): Android emulates the device colour
    // scheme; WebDriver cannot, so the theme is the SAVED choice. Kept, never
    // deleted (Shyden 2026-10-16), until #811 sets the phone's appearance.
    await phone().navigateToPath('/', SWITCH, 'light');
    const light = await ribbon();
    await phone().navigateToPath('/', SWITCH, 'dark');
    const dark = await ribbon();
    for (const drawn of [light, dark])
      for (const colour of drawn.colours) expect(drawn.image).toContain(colour);
    expect(light.colours).not.toEqual(dark.colours);
  });
});

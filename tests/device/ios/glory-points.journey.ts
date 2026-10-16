/**
 * The Glory Points calculator on the real iPhone: every test
 * tests/e2e/yeetalk-calculators.spec.ts and yeetalk-calculators-locale.spec.ts
 * run on the real Android phone, under the same titles with an `iOS mirror:`
 * prefix (#802; global rule 2026-10-15, every test mirrored, no exceptions).
 * `Enter key submits` has no twin: Shyden ruled 2026-10-16 (#811) that a
 * hardware key press needs no iPhone twin, "because it's a phone and phone
 * users are not expected to have a separate usb keyboard for their phones".
 * Each test is Android's step for step (#821): Playwright's fill, retried
 * assertions, and Android's evidence shots.
 */
import { describe, expect, test } from 'vitest';
import {
  getSiteStrings,
  LOCALES,
  localisePath,
  type Locale,
} from '../../../src/lib/i18n';
import { LOCALE_METADATA } from '../../../src/lib/i18n/metadata';
import {
  attributesOf,
  expectEventually,
  expectLocator,
  rawTextsOf,
  textMatchesOf,
  textsOf,
} from './dom';
import { shootDevice } from './evidence';
import { holdIosSession } from './held-session';
import { expectRole } from './roles';
import { announceMode } from './session';

const phone = holdIosSession();

/** `expect(page.locator(selector))`, retried as Playwright retries it (#821); `nth` is `.nth(n)`. */
const on = (selector: string, nth?: number) =>
  expectLocator(phone().driver, selector, { nth });

/** Android's `shoot`: evidence only, written when the run asks for it. */
const shoot = (label: string): Promise<string | null> =>
  shootDevice(phone().driver, { project: 'ios-safari-real-device', label });

const en = getSiteStrings('en').calculators;
const id = getSiteStrings('id').calculators;

const open = (locale: Locale, hash = ''): Promise<void> =>
  phone().navigateToPath(
    `${localisePath('/yeetalk-calculators', locale)}${hash}`,
    '#glory-input',
  );

/** `page.fill('#glory-input', value)`: Playwright's fill, one input event (#821). */
const fill = async (value: string): Promise<void> =>
  phone().interaction.fill(
    await phone().driver.findElement('#glory-input'),
    value,
  );

const submit = async (): Promise<void> =>
  phone().interaction.click(await phone().driver.findElement('#glory-submit'));

/** Android's `expectVisibleText` (tests/e2e/helpers.ts): toBeVisible, then toHaveText. */
const expectVisibleText = async (
  selector: string,
  text: string,
): Promise<void> => {
  await on(selector).toBeVisible();
  await on(selector).toHaveText(text);
};

/** `toBeEmpty()` on an element that is not a field: no text, retried. */
const expectEmpty = (selector: string): Promise<void> =>
  expectEventually(
    () => textsOf(phone().driver, selector),
    [''],
    `${selector} empty`,
  );

describe('iOS mirror: glory points calculator', () => {
  test('iOS mirror: computes the exact breakdown for 1000', async () => {
    announceMode(phone(), 'glory 1000');
    await open('en');
    await fill('1000');
    await submit();
    await expectVisibleText(
      '#glory-result',
      en.glory.resultLine('1,000', '1,112', '2,780'),
    );
    await expectEmpty('#glory-error');
  });

  test('iOS mirror: the Indonesian calculator prints Indonesian numbers', async () => {
    announceMode(phone(), 'glory id numbers');
    await open('id');
    await fill('1000');
    await submit();
    await expectVisibleText(
      '#glory-result',
      id.glory.resultLine('1.000', '1.112', '2.780'),
    );
  });

  test('iOS mirror: the Indonesian calculator refuses in Indonesian', async () => {
    announceMode(phone(), 'glory id refusal');
    await open('id');
    await fill('abc');
    await submit();
    await expectVisibleText('#glory-error', id.errors.notWhole);
    await expectEmpty('#glory-result');
  });

  test('iOS mirror: shows YeeTalk attribution linking to the official site', async () => {
    announceMode(phone(), 'glory attribution');
    await open('en');
    const link = 'a[href="https://yeetalkapp.com/"]';
    await on(link).toBeVisible();
    // `toHaveAttribute('rel', /noopener/)`: the one link's rel matches.
    await expectEventually(
      async () =>
        (await attributesOf(phone().driver, link, 'rel')).map((rel) =>
          /noopener/.test(rel ?? ''),
        ),
      [true],
      `${link} rel`,
    );
    await on(link).toHaveAttribute('target', '_blank');
    // NOT YET THE SAME as Android (#811): `getByText(/YeeTalk/i).first()` is
    // read by textMatchesOf, a restatement of Playwright's text engine (the
    // innermost elements whose text holds it, ignoring case), not its code.
    // Kept, never deleted (Shyden 2026-10-16), until #811 runs Playwright's
    // own engine in Safari.
    await expectEventually(
      async () =>
        (
          await textMatchesOf(phone().driver, 'body', 'YeeTalk', {
            exact: false,
          })
        )[0],
      true,
      'the first text naming YeeTalk is visible',
    );
  });

  for (const [input, message] of [
    ['', 'Please enter a number.'],
    ['abc', 'Please enter a whole number.'],
    ['3.5', 'Please enter a whole number.'],
    ['0', 'Enter a number greater than zero.'],
  ] as const)
    test(`iOS mirror: input ${JSON.stringify(input)} shows error ${JSON.stringify(message)}`, async () => {
      announceMode(phone(), `glory error ${JSON.stringify(input)}`);
      await open('en');
      if (input) await fill(input);
      await submit();
      await expectVisibleText('#glory-error', message);
      await expectEmpty('#glory-result');
    });
});

describe('iOS mirror: glory points — explains what it does and how to use it', () => {
  test('iOS mirror: the lead names both jobs: reach a glory points target, or value a received gift', async () => {
    announceMode(phone(), 'glory lead');
    await open('en');
    await on('.lead').toContainText(
      /what it takes to reach a glory points target.+what a gift is worth once it's received/i,
    );
  });

  test('iOS mirror: gives numbered, in-order steps: enter → calculate → read the result', async () => {
    announceMode(phone(), 'glory how-to');
    await open('en');
    // NOT YET THE SAME as Android (#811): the heading and the list are found
    // by the name roles.ts computes, a part of the ARIA naming rules, where
    // Android's getByRole runs Playwright's own. Kept, never deleted (Shyden
    // 2026-10-16), until #811 runs Playwright's name code in Safari.
    // `{ name: /how to use it/i }`: a case-blind part of the name.
    await expectRole(phone().driver, 'heading', 'how to use it', {
      exact: false,
    }).toBeVisible();
    await expectRole(phone().driver, 'list', 'how to use it', {
      exact: false,
    }).toBeVisible();
    const steps = '.how-to ol > li';
    await on(steps).toHaveCount(3);
    await on(steps, 0).toContainText(/glory points/i);
    await on(steps, 0).toContainText(/enter|type/i);
    await on(steps, 1).toContainText(/calculate/i);
    await on(steps, 2).toContainText(/beans/i);
    await on(steps, 2).toContainText(/total gift value/i);
  });
});

describe('iOS mirror: the Glory Points calculator speaks the page it is on', () => {
  for (const locale of LOCALES) {
    const t = getSiteStrings(locale).calculators;

    test(`iOS mirror: ${locale}: validation is answered in ${locale}`, async () => {
      announceMode(phone(), `glory validation (${locale})`);
      await open(locale);
      await fill('');
      await submit();
      await expectVisibleText('#glory-error', t.errors.empty);
      await shoot(`${locale}: empty input is refused in ${locale}`);
    });

    test(`iOS mirror: ${locale}: numbers use ${locale} conventions`, async () => {
      announceMode(phone(), `glory numbers (${locale})`);
      await open(locale);
      await fill('1112');
      await submit();
      const result = on('#glory-result');
      await result.toBeVisible();
      // `not.toBeEmpty()`, retried as Playwright retries a negation.
      await expectEventually(
        async () =>
          (await textsOf(phone().driver, '#glory-result')).map((s) => s !== ''),
        [true],
        '#glory-result not empty',
      );
      // `result.textContent()`: the raw text, nothing collapsed.
      const shown =
        (await rawTextsOf(phone().driver, '#glory-result'))[0] ?? '';
      const expected = (1112).toLocaleString(
        LOCALE_METADATA[locale].numberLocale,
      );
      expect(
        shown.includes(expected),
        `${locale}: expected ${expected} in "${shown.trim().slice(0, 80)}"`,
      ).toBe(true);
      await shoot(`${locale}: 1112 renders as ${expected}`);
    });

    test(`iOS mirror: ${locale}: #glory-points is the Glory Points section, and the jump link reaches it`, async () => {
      announceMode(phone(), `glory section (${locale})`);
      await open(locale);
      const section = 'section#glory-points';
      await on(section).toHaveCount(1);
      await on('[id="glory-points"]').toHaveCount(1);
      // `section.getByRole('heading', { level: 2 })`: no name, so no name rules.
      await on(
        `${section} :is(h2, [role="heading"][aria-level="2"])`,
      ).toHaveText(t.glory.heading);
      await on(`${section} #glory-input`).toHaveCount(1);
      const jump = on('a[href="#glory-points"]');
      await jump.toHaveCount(1);
      await jump.toBeVisible();
      await jump.toHaveText(t.glory.heading);
      await shoot(`${locale}: the jump link names the Glory section`);
    });

    test(`iOS mirror: ${locale}: arriving on #glory-points shows the calculator`, async () => {
      announceMode(phone(), `glory arrival (${locale})`);
      await open(locale, '#glory-points');
      // `toBeInViewport()`, retried.
      await expectEventually(
        () =>
          phone().driver.executeScript<boolean>(
            `const r = document.querySelector('#glory-input').getBoundingClientRect();
             return r.bottom > 0 && r.right > 0 && r.top < innerHeight && r.left < innerWidth;`,
          ),
        true,
        '#glory-input is in the viewport',
      );
    });
  }
});

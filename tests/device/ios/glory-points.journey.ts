/**
 * The Glory Points calculator on the real iPhone: every test
 * tests/e2e/yeetalk-calculators.spec.ts and yeetalk-calculators-locale.spec.ts
 * run on the real Android phone, under the same titles with an `iOS mirror:`
 * prefix (#802; global rule 2026-10-15, every test mirrored, no exceptions).
 * One waits for #811: `Enter key submits` needs a real key press, which the
 * dom-dispatch canary cannot give; it is listed in
 * `.superpowers/sdd/802/plan.md`, not exempt.
 */
import { describe, expect, test } from 'vitest';
import {
  getSiteStrings,
  LOCALES,
  localisePath,
  type Locale,
} from '../../../src/lib/i18n';
import { LOCALE_METADATA } from '../../../src/lib/i18n/metadata';
import { attributesOf, countOf, textsOf, visibilityOf } from './dom';
import { holdIosSession } from './held-session';
import { announceMode } from './session';
import { waitFor } from './webdriver';

const phone = holdIosSession();

const en = getSiteStrings('en').calculators;
const id = getSiteStrings('id').calculators;

const open = (locale: Locale, hash = ''): Promise<void> =>
  phone().navigateToPath(
    `${localisePath('/yeetalk-calculators', locale)}${hash}`,
    '#glory-input',
  );

/** Types `value` into the field the way `page.fill` does: cleared, then typed. */
const fill = async (value: string): Promise<void> => {
  const input = await phone().driver.findElement('#glory-input');
  await phone().interaction.click(input);
  await phone().interaction.clear(input);
  if (value) await phone().interaction.type(input, value);
};

const submit = async (): Promise<void> =>
  phone().interaction.click(await phone().driver.findElement('#glory-submit'));

/** `expectVisibleText`: the element shows, and reads exactly `text`. */
const expectVisibleText = async (
  selector: string,
  text: string,
): Promise<void> => {
  await waitFor(
    async () =>
      (await visibilityOf(phone().driver, selector))[0] === true
        ? true
        : undefined,
    { timeout: 5_000, describe: `${selector} to show` },
  );
  expect(await textsOf(phone().driver, selector)).toEqual([text]);
};

const expectEmpty = async (selector: string): Promise<void> =>
  expect(await textsOf(phone().driver, selector)).toEqual(['']);

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
    expect((await visibilityOf(phone().driver, link))[0]).toBe(true);
    expect((await attributesOf(phone().driver, link, 'rel'))[0]).toMatch(
      /noopener/,
    );
    expect((await attributesOf(phone().driver, link, 'target'))[0]).toBe(
      '_blank',
    );
    const named = await phone().driver.executeScript<boolean>(
      `const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
       for (let node = walker.nextNode(); node; node = walker.nextNode())
         if (/YeeTalk/i.test(node.textContent ?? '') && node.parentElement.checkVisibility()) return true;
       return false;`,
    );
    expect(named, 'some visible text names YeeTalk').toBe(true);
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
      await fill(input);
      await submit();
      await expectVisibleText('#glory-error', message);
      await expectEmpty('#glory-result');
    });
});

describe('iOS mirror: glory points — explains what it does and how to use it', () => {
  test('iOS mirror: the lead names both jobs: reach a glory points target, or value a received gift', async () => {
    announceMode(phone(), 'glory lead');
    await open('en');
    const [lead] = await textsOf(phone().driver, '.lead');
    expect(lead).toMatch(
      /what it takes to reach a glory points target.+what a gift is worth once it's received/i,
    );
  });

  test('iOS mirror: gives numbered, in-order steps: enter → calculate → read the result', async () => {
    announceMode(phone(), 'glory how-to');
    await open('en');
    const named = await phone().driver.executeScript<{
      heading: boolean;
      list: boolean;
    }>(
      `const shown = (el) => !!el && el.checkVisibility();
       const heading = [...document.querySelectorAll('h1,h2,h3,h4')].find((h) => /how to use it/i.test(h.textContent));
       const list = [...document.querySelectorAll('ol,ul')].find((l) => {
         const by = l.getAttribute('aria-labelledby');
         const label = l.getAttribute('aria-label') ?? (by ? document.getElementById(by)?.textContent : '');
         return /how to use it/i.test(label ?? '');
       });
       return { heading: shown(heading), list: shown(list) };`,
    );
    expect(named).toEqual({ heading: true, list: true });
    const steps = await textsOf(phone().driver, '.how-to ol > li');
    expect(steps).toHaveLength(3);
    expect(steps[0]).toMatch(/glory points/i);
    expect(steps[0]).toMatch(/enter|type/i);
    expect(steps[1]).toMatch(/calculate/i);
    expect(steps[2]).toMatch(/beans/i);
    expect(steps[2]).toMatch(/total gift value/i);
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
    });

    test(`iOS mirror: ${locale}: numbers use ${locale} conventions`, async () => {
      announceMode(phone(), `glory numbers (${locale})`);
      await open(locale);
      await fill('1112');
      await submit();
      await waitFor(
        async () =>
          (await visibilityOf(phone().driver, '#glory-result'))[0] === true
            ? true
            : undefined,
        { timeout: 5_000, describe: `#glory-result to show (${locale})` },
      );
      const [shown] = await textsOf(phone().driver, '#glory-result');
      expect(shown, 'the result is not empty').not.toBe('');
      const expected = (1112).toLocaleString(
        LOCALE_METADATA[locale].numberLocale,
      );
      expect(
        shown.includes(expected),
        `${locale}: expected ${expected} in "${shown.slice(0, 80)}"`,
      ).toBe(true);
    });

    test(`iOS mirror: ${locale}: #glory-points is the Glory Points section, and the jump link reaches it`, async () => {
      announceMode(phone(), `glory section (${locale})`);
      await open(locale);
      expect(await countOf(phone().driver, 'section#glory-points')).toBe(1);
      expect(await countOf(phone().driver, '[id="glory-points"]')).toBe(1);
      expect(await textsOf(phone().driver, 'section#glory-points h2')).toEqual([
        t.glory.heading,
      ]);
      expect(
        await countOf(phone().driver, 'section#glory-points #glory-input'),
      ).toBe(1);
      const jump = 'a[href="#glory-points"]';
      expect(await countOf(phone().driver, jump)).toBe(1);
      expect(await visibilityOf(phone().driver, jump)).toEqual([true]);
      expect(await textsOf(phone().driver, jump)).toEqual([t.glory.heading]);
    });

    test(`iOS mirror: ${locale}: arriving on #glory-points shows the calculator`, async () => {
      announceMode(phone(), `glory arrival (${locale})`);
      await open(locale, '#glory-points');
      const inView = await phone().driver.executeScript<boolean>(
        `const r = document.querySelector('#glory-input').getBoundingClientRect();
         return r.bottom > 0 && r.right > 0 && r.top < innerHeight && r.left < innerWidth;`,
      );
      expect(inView, '#glory-input is in the viewport').toBe(true);
    });
  }
});

import { test, expect } from './fixtures';
import { recorded } from './evidence';
import { atLeast44, expectNoHorizontalScroll } from '../viewport';
import { getSiteStrings } from '../../src/lib/i18n/index';
import { expectVisibleText } from './helpers';
import { localePaths } from './locale-sampling';

const en = getSiteStrings('en').calculators;
const id = getSiteStrings('id').calculators;

test.use(recorded);
test.describe('glory points calculator', () => {
  test('computes the exact breakdown for 1000', async ({ page }) => {
    await page.goto('/yeetalk-calculators');
    await page.fill('#glory-input', '1000');
    await page.click('#glory-submit');
    // The whole line, so each amount sits in its own place: three
    // order-free substring checks passed with coins and beans swapped (#390
    // F124). The amounts are literals, the sentence is the catalogue's.
    await expectVisibleText(
      page.locator('#glory-result'),
      en.glory.resultLine('1,000', '1,112', '2,780'),
    );
    await expect(page.locator('#glory-error')).toBeEmpty(); // result & error are mutually exclusive
  });
  test('the Indonesian calculator prints Indonesian numbers', async ({
    page,
  }) => {
    // "." groups thousands and "," is the decimal mark in Indonesian, so the
    // English rendering "1.112" would read as one-point-one-one-two. The
    // static copy on this very page already says "0,9 koin per bean".
    //
    // The Indonesian calculator had never been exercised at all — which is
    // how this survived, along with t.errors.* and the English fallback in
    // yeetalk-calculators.ts.
    await page.goto('/id/yeetalk-calculators');
    await page.fill('#glory-input', '1000');
    await page.click('#glory-submit');
    await expectVisibleText(
      page.locator('#glory-result'),
      id.glory.resultLine('1.000', '1.112', '2.780'),
    );
  });

  test('the Indonesian calculator refuses in Indonesian', async ({ page }) => {
    await page.goto('/id/yeetalk-calculators');
    await page.fill('#glory-input', 'abc');
    await page.click('#glory-submit');
    // The English fallback at yeetalk-calculators.ts would render the raw English
    // message here; the map must actually cover this code. Named, not merely
    // "not English": any other Indonesian sentence passed that (#390 F124).
    await expectVisibleText(page.locator('#glory-error'), id.errors.notWhole);
    await expect(page.locator('#glory-result')).toBeEmpty();
  });

  test('Enter key submits', async ({ page }) => {
    await page.goto('/yeetalk-calculators');
    await page.fill('#glory-input', '9');
    await page.press('#glory-input', 'Enter');
    await expectVisibleText(
      page.locator('#glory-result'),
      en.glory.resultLine('9', '10', '25'),
    );
    await expect(page.locator('#glory-error')).toBeEmpty();
  });
  test('shows YeeTalk attribution linking to the official site', async ({
    page,
  }) => {
    await page.goto('/yeetalk-calculators');
    const link = page.locator('a[href="https://yeetalkapp.com/"]');
    await expect(link).toBeVisible();
    await expect(link).toHaveAttribute('rel', /noopener/);
    await expect(link).toHaveAttribute('target', '_blank');
    await expect(page.getByText(/YeeTalk/i).first()).toBeVisible();
  });
  // Playwright's `test` has no `.each` (verified: typeof test.each === 'undefined'
  // on @playwright/test@1.61.1) — expanded into one test() per case via a for...of
  // loop, per this repo's existing convention (see homepage.spec.ts). Same four
  // cases, same assertions as the brief's test.each table.
  for (const [input, message] of [
    ['', 'Please enter a number.'],
    ['abc', 'Please enter a whole number.'],
    ['3.5', 'Please enter a whole number.'],
    ['0', 'Enter a number greater than zero.'],
  ] as const) {
    test(`input ${JSON.stringify(input)} shows error ${JSON.stringify(message)}`, async ({
      page,
    }) => {
      await page.goto('/yeetalk-calculators');
      if (input) await page.fill('#glory-input', input);
      await page.click('#glory-submit');
      await expectVisibleText(page.locator('#glory-error'), message);
      await expect(page.locator('#glory-result')).toBeEmpty();
    });
  }
});

test.describe('glory points — explains what it does and how to use it', () => {
  test('the lead names both jobs: reach a glory points target, or value a received gift', async ({
    page,
  }) => {
    // Pin the order and the direction, not just the vocabulary: the page says
    // what it takes to REACH a glory points target, then what a gift is WORTH
    // once received. Order-independent substring checks would pass a lead that
    // swapped the two jobs (#390 F124).
    await page.goto('/yeetalk-calculators');
    const lead = page.locator('.lead');
    await expect(lead).toContainText(
      /what it takes to reach a glory points target.+what a gift is worth once it's received/i,
    );
  });

  test('gives numbered, in-order steps: enter → calculate → read the result', async ({
    page,
  }) => {
    await page.goto('/yeetalk-calculators');
    await expect(
      page.getByRole('heading', { name: /how to use it/i }),
    ).toBeVisible();
    // The steps are a real list in the accessibility tree, named by the "How to
    // use it" heading (via aria-labelledby) — so a screen reader announces
    // "How to use it, list, 3 items". Asserting the ROLE (not just the CSS
    // selector) guards the native list semantics against a styling regression.
    await expect(
      page.getByRole('list', { name: /how to use it/i }),
    ).toBeVisible();
    const steps = page.locator('.how-to ol > li');
    await expect(steps).toHaveCount(3);
    // 1) Enter the glory-point target.
    await expect(steps.nth(0)).toContainText(/glory points/i);
    await expect(steps.nth(0)).toContainText(/enter|type/i);
    // 2) Trigger the calculation (the button is labelled "Calculate").
    await expect(steps.nth(1)).toContainText(/calculate/i);
    // 3) Read off the beans and gift value needed — the amounts the user asked about.
    await expect(steps.nth(2)).toContainText(/beans/i);
    await expect(steps.nth(2)).toContainText(/total gift value/i);
  });
});

test.describe('glory points — touch targets ≥ 44×44px (WCAG / mobile-first)', () => {
  // Every locale (#423): the submit button's label is the page's own copy.
  for (const path of localePaths('/yeetalk-calculators'))
    test(
      `mobile: attribution link, input and submit button are ≥44px -- ${path}`,
      { tag: '@emulated-viewport' },
      async ({ page }) => {
        await page.setViewportSize({ width: 375, height: 800 });
        await page.goto(path);
        await atLeast44(page.locator('a[href="https://yeetalkapp.com/"]'));
        await atLeast44(page.locator('#glory-input'));
        await atLeast44(page.locator('#glory-submit'));
      },
    );
});

// Every locale at every width (#423): theme-gallery reads every locale at 320
// and 1280px only, so 375 and 768px were read in English alone.
test.describe('glory points — mobile-first layout', () => {
  for (const width of [320, 375, 768, 1280]) {
    for (const path of localePaths('/yeetalk-calculators'))
      test(
        `no horizontal scroll at ${width}px -- ${path}`,
        { tag: '@emulated-viewport' },
        async ({ page }) => {
          await page.setViewportSize({ width, height: 900 });
          await page.goto(path);
          await expectNoHorizontalScroll(page);
        },
      );
  }
});

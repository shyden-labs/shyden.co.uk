import { test, expect } from './fixtures';
import { recorded } from './evidence';
import { atLeast44, expectNoHorizontalScroll } from '../viewport';
import { getSiteStrings } from '../../src/lib/i18n/index';
import { expectVisibleText } from './helpers';
import { localePaths } from './locale-sampling';

const en = getSiteStrings('en').calculators;
const id = getSiteStrings('id').calculators;

test.use(recorded);

test.describe('gift value calculator', () => {
  // Each case its own test. 999 shows the floor, 1 shows the honest zero, 5
  // the first whole coin, and the cap shows the largest line the page prints.
  for (const [gift, beans, coins, path, shown] of [
    ['999', '399', '359', '/yeetalk-calculators', ['999', '399', '359']],
    ['1', '0', '0', '/yeetalk-calculators', ['1', '0', '0']],
    ['5', '2', '1', '/yeetalk-calculators', ['5', '2', '1']],
    [
      '1000000000',
      '400000000',
      '360000000',
      '/yeetalk-calculators',
      ['1,000,000,000', '400,000,000', '360,000,000'],
    ],
    [
      '1000000000',
      '400000000',
      '360000000',
      '/id/yeetalk-calculators',
      ['1.000.000.000', '400.000.000', '360.000.000'],
    ],
  ] as const) {
    test(`gift ${gift} gives ${beans} beans and ${coins} coins -- ${path}`, async ({
      page,
    }) => {
      await page.goto(path);
      await page.fill('#gift-input', gift);
      await page.click('#gift-submit');
      const t = path.startsWith('/id') ? id : en;
      await expectVisibleText(
        page.locator('#gift-result'),
        t.gift.resultLine(shown[0], shown[1], shown[2]),
      );
    });
  }

  test('the two calculators do not share a result', async ({ page }) => {
    await page.goto('/yeetalk-calculators');
    await page.fill('#gift-input', '1000');
    await page.click('#gift-submit');
    await expect(page.locator('#glory-result')).toBeEmpty();
    await expect(page.locator('#glory-error')).toBeEmpty();
  });

  test('a result clears the earlier error', async ({ page }) => {
    await page.goto('/yeetalk-calculators');
    await page.fill('#gift-input', 'abc');
    await page.click('#gift-submit');
    await expect(page.locator('#gift-error')).not.toBeEmpty();
    await page.fill('#gift-input', '1000');
    await page.click('#gift-submit');
    await expect(page.locator('#gift-result')).not.toBeEmpty();
    await expect(page.locator('#gift-error')).toBeEmpty();
  });

  test('an error clears the earlier result', async ({ page }) => {
    await page.goto('/yeetalk-calculators');
    await page.fill('#gift-input', '1000');
    await page.click('#gift-submit');
    await expect(page.locator('#gift-result')).not.toBeEmpty();
    await page.fill('#gift-input', 'abc');
    await page.click('#gift-submit');
    await expect(page.locator('#gift-result')).toBeEmpty();
  });
});

test.describe('gift value — explains what it does and how to use it', () => {
  test('gives numbered, in-order steps: enter → calculate → read the result', async ({
    page,
  }) => {
    await page.goto('/yeetalk-calculators');
    const section = page.locator('section#gift-value');
    await expect(
      section.getByRole('list', { name: en.gift.howToHeading }),
    ).toBeVisible();
    const steps = section.locator('.how-to ol > li');
    await expect(steps).toHaveCount(3);
    await expect(steps.nth(0)).toContainText(/value of the gift/i);
    await expect(steps.nth(1)).toContainText(/calculate/i);
    await expect(steps.nth(2)).toContainText(/beans/i);
    await expect(steps.nth(2)).toContainText(/coins/i);
  });

  test('the rate note states the rates and the rounding', async ({ page }) => {
    await page.goto('/yeetalk-calculators');
    await expectVisibleText(
      page.locator('section#gift-value .assumptions'),
      en.gift.assumptions,
    );
  });
});

test.describe('gift value — jump link', () => {
  test('the jump link reaches the Gift Value section', async ({ page }) => {
    await page.goto('/yeetalk-calculators');
    const jump = page.locator('a[href="#gift-value"]');
    await expect(jump).toHaveCount(1);
    await expect(jump).toBeVisible();
    await expect(jump).toHaveText(en.gift.heading);
    await jump.click();
    await expect(page.locator('#gift-input')).toBeInViewport();
  });

  test('the section is one h2 named by its heading', async ({ page }) => {
    await page.goto('/yeetalk-calculators');
    const section = page.locator('section#gift-value');
    await expect(section).toHaveCount(1);
    await expect(section.getByRole('heading', { level: 2 })).toHaveText(
      en.gift.heading,
    );
  });
});

test.describe('gift value — touch targets ≥ 44×44px', () => {
  for (const path of localePaths('/yeetalk-calculators'))
    test(
      `mobile: input, submit button and jump link are ≥44px -- ${path}`,
      { tag: '@emulated-viewport' },
      async ({ page }) => {
        await page.setViewportSize({ width: 375, height: 800 });
        await page.goto(path);
        await atLeast44(page.locator('#gift-input'));
        await atLeast44(page.locator('#gift-submit'));
        await atLeast44(page.locator('a[href="#gift-value"]'));
      },
    );
});

// Page-level scrollWidth is not containment (CLAUDE.md): a card's content can
// overflow its border with no document scroll, so each result and error is
// measured against its own card, with the longest result the page can print.
test.describe('gift value — mobile-first layout', () => {
  for (const width of [320, 375, 768, 1280]) {
    for (const path of localePaths('/yeetalk-calculators'))
      test(
        `no horizontal scroll, and nothing escapes the card, at ${width}px with the longest result -- ${path}`,
        { tag: '@emulated-viewport' },
        async ({ page }) => {
          await page.setViewportSize({ width, height: 900 });
          await page.goto(path);
          await page.fill('#gift-input', '1000000000');
          await page.click('#gift-submit');
          await expect(page.locator('#gift-result')).not.toBeEmpty();
          await expectNoHorizontalScroll(page);
          // The worst overshoot past the card's edge, and how many boxes were
          // measured: a card that held nothing would report an overshoot of 0
          // for free, so the count is asserted alive beside it.
          const worst = await page.evaluate(() => {
            const card = document
              .querySelector('#gift-input')
              ?.closest('.card');
            if (!card) return { over: 0, who: 'no card', measured: 0 };
            const box = card.getBoundingClientRect();
            const rendered = [...card.querySelectorAll('*')].filter(
              (el) => el.getClientRects().length > 0,
            );
            let over = 0;
            let who = '';
            for (const el of rendered) {
              const r = el.getBoundingClientRect();
              const past = Math.max(box.left - r.left, r.right - box.right);
              if (past > over) {
                over = past;
                who = el.id || el.tagName;
              }
            }
            return { over, who, measured: rendered.length };
          });
          expect(
            worst.measured,
            'the card held boxes to measure',
          ).toBeGreaterThan(0);
          expect(
            worst.over,
            `${worst.who} escapes the card`,
          ).toBeLessThanOrEqual(0.5);
        },
      );
  }
});

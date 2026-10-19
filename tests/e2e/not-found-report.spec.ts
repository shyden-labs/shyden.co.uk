import type { Page } from '@playwright/test';
import { test, expect } from './fixtures';
import { recorded, shoot } from './evidence';
import { atLeast44, expectNoHorizontalScroll } from '../viewport';
import { contrastRatio, formTextsUnderAA } from './helpers';
import { THEMES } from '../palette';
import { searched } from '../source-files';
import {
  DEFAULT_LOCALE,
  LOCALES,
  getSiteStrings,
  isBetaLocale,
} from '../../src/lib/i18n';
import {
  matchingKeys,
  pagePath,
  reportIdStem,
  reportOptions,
} from '../../src/lib/report';

/**
 * The 404's report route (#350, spec 14). One form per translated block,
 * each posting its own locale; read from the built page, so a block added
 * with a new locale is judged the day it is built.
 */
test.use(recorded);

const NOT_FOUND = pagePath('not-found', DEFAULT_LOCALE);
const BETA = LOCALES.filter(isBetaLocale);
const block = (page: Page, locale: string) =>
  page.locator(`details[data-report][lang="${locale}"]`);

test('every beta block carries one form posting its own locale, and English none', async ({
  page,
}) => {
  await page.goto(NOT_FOUND);
  expect(BETA.length).toBeGreaterThan(0);
  await expect(page.locator('details[data-report]')).toHaveCount(BETA.length);
  await expect(
    page.locator(`details[data-report][lang="${DEFAULT_LOCALE}"]`),
  ).toHaveCount(0);
  for (const locale of BETA) {
    const form = block(page, locale).locator('form');
    await expect(form.locator('input[name="locale"]')).toHaveValue(locale);
    await expect(form.locator('input[name="page"]')).toHaveValue('not-found');
    const offered = await form
      .locator('datalist option')
      .evaluateAll((options) =>
        options.map((option) => (option as HTMLOptionElement).value),
      );
    expect(offered, locale).toEqual([...reportOptions('not-found', locale)]);
  }
  await shoot(
    page,
    'a report form under every beta language',
    page.locator('details[data-report]').first(),
  );
});

test('each block offers what it shows: its heading, sentence and link match its own keys', async ({
  page,
}) => {
  await page.goto(NOT_FOUND);
  for (const locale of BETA) {
    const heading = page.locator(`h2[lang="${locale}"]`);
    await expect(heading).toBeVisible();
    const link = page.locator(`p[lang="${locale}"] a[hreflang="${locale}"]`);
    // The sentence as the page shows it: the paragraph's text up to its
    // link. Taken from the catalogue instead, a block showing another
    // language's sentence passed, since the catalogue always matches itself.
    const body = await page
      .locator(`p[lang="${locale}"]`)
      .filter({ has: page.locator(`a[hreflang="${locale}"]`) })
      .evaluate((paragraph) => {
        const before: string[] = [];
        for (const node of paragraph.childNodes) {
          if (node.nodeName === 'A') break;
          before.push(node.textContent ?? '');
        }
        return before.join('').trim();
      });
    expect(body, `${locale}: the sentence before the link`).not.toBe('');
    const shown = [
      [await heading.innerText(), 'site.notFound.heading'],
      [await link.innerText(), 'site.notFound.backHome'],
      [body, 'site.notFound.body'],
    ] as const;
    for (const [text, key] of shown)
      expect(
        matchingKeys(text, 'not-found', locale),
        `${locale} ${key}`,
      ).toContain(key);
  }
});

test('a block walks its own fields from the keyboard, each labelled and described in its language', async ({
  page,
  browserName,
}) => {
  await page.goto(NOT_FOUND);
  // The last block: were the ids shared, each label would name the FIRST
  // element with its id, so the first block would pass by accident and the
  // last cannot.
  const locale = BETA[BETA.length - 1];
  const t = getSiteStrings(locale).report;
  const details = block(page, locale);
  await details.locator('summary').focus();
  await page.keyboard.press('Enter');
  await expect(details).toHaveAttribute('open', '');
  for (const label of [t.quoteLabel, t.suggestionLabel, t.noteLabel]) {
    await page.keyboard.press('Tab');
    await expect(details.getByLabel(label, { exact: true })).toBeFocused();
  }
  const send = details.getByRole('button', { name: t.send });
  // Safari keeps buttons out of the Tab order by preference (report-form.spec.ts).
  if (browserName === 'webkit') await send.focus();
  else await page.keyboard.press('Tab');
  await expect(send).toBeFocused();
  await expect(
    details.getByLabel(t.quoteLabel, { exact: true }),
  ).toHaveAccessibleDescription(t.quoteHint);
  await expect(
    details.getByLabel(t.noteLabel, { exact: true }),
  ).toHaveAccessibleDescription(t.noteHint);
  await shoot(page, 'the open block, walked to its send button', details);
});

for (const locale of BETA)
  test(`${locale}: its sent status shows in its language, takes focus, and hides every other`, async ({
    page,
  }) => {
    const stem = reportIdStem('not-found', locale);
    await page.goto(`${NOT_FOUND}#${stem}-sent`);
    const shown = page.locator(`#${stem}-sent`);
    await expect(shown).toBeVisible();
    await expect(shown).toHaveText(getSiteStrings(locale).report.sent);
    await expect(shown).toHaveAttribute('lang', locale);
    await expect(shown).toBeFocused();
    expect(await contrastRatio(shown)).toBeGreaterThanOrEqual(4.5);
    const statuses = page.locator('[data-report-status]');
    // Six statuses per form: sent, not-found, rejected, failed, and the two
    // daily limits (#872).
    await expect(statuses).toHaveCount(BETA.length * 6);
    await expect(page.locator('[data-report-status]:visible')).toHaveCount(1);
    await shoot(page, `${locale}: the sent status in its own language`, shown);
  });

for (const theme of THEMES)
  test.describe(`${theme} theme`, () => {
    test.use({ colorScheme: theme });

    for (const locale of BETA)
      test(`${locale}: every control is at least 44px and every text meets AA`, async ({
        page,
      }) => {
        await page.goto(NOT_FOUND);
        const t = getSiteStrings(locale).report;
        const details = block(page, locale);
        await details.locator('summary').click();
        await expect(details).toHaveAttribute('open', '');
        for (const target of [
          details.locator('summary'),
          details.getByLabel(t.quoteLabel, { exact: true }),
          details.getByLabel(t.suggestionLabel, { exact: true }),
          details.getByLabel(t.noteLabel, { exact: true }),
          details.getByRole('button', { name: t.send }),
        ])
          await atLeast44(target);
        // On the 404 the form sits on the page's ground, not the footer's,
        // so its words are measured here too (#97 measured them in the
        // footer).
        const { failing, read } = await formTextsUnderAA(
          details,
          details.getByRole('button', { name: t.send }),
        );
        expect(
          searched(failing, { of: read, what: `${locale} form texts` }),
        ).toEqual([]);
      });
  });

test(
  'no sideways scroll at 320px with every form open',
  { tag: '@emulated-viewport' },
  async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 800 });
    await page.goto(NOT_FOUND);
    for (const locale of BETA)
      await block(page, locale).locator('summary').click();
    await expectNoHorizontalScroll(page);
  },
);

test('no form reaches paper', async ({ page }) => {
  await page.goto(NOT_FOUND);
  await expect(page.locator('details[data-report]')).toHaveCount(BETA.length);
  await page.emulateMedia({ media: 'print' });
  for (const locale of BETA) await expect(block(page, locale)).toBeHidden();
});

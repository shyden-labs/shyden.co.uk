import { randomUUID } from 'node:crypto';
import { test, expect, type Page } from '@playwright/test';
import {
  LOCALES,
  getSiteStrings,
  getStrings,
  isBetaLocale,
} from '../../src/lib/i18n';
import { pagePath } from '../../src/lib/report';
import { expectReportsBound } from '../report-health';
import { floorBreach } from '../floors';
import { searched } from '../source-files';
import { plantReport, reportsStartingWith, reportsWithNote } from './local.mjs';

const vi = getSiteStrings('vi').report;
const tool = getStrings('vi');
const noteFor = (what: string) => `functions test ${what} ${randomUUID()}`;

async function fillReport(page: Page, quote: string, note: string) {
  await page.locator('[data-report] summary').click();
  await page.getByLabel(vi.quoteLabel, { exact: true }).fill(quote);
  await page.getByLabel(vi.noteLabel, { exact: true }).fill(note);
}

test('the health check sees the binding and the migrated table', async ({
  request,
}) => {
  await expectReportsBound(request);
});

test.describe('with JavaScript disabled', () => {
  test.use({ javaScriptEnabled: false });

  // The tag is `isolated-context-tagging`'s rule for every spec directory:
  // javaScriptEnabled is inert on the real-device harness. This suite never
  // runs there, and the tag says so rather than leaving it to be noticed.
  test(
    'the homepage posts, lands on #report-sent, and the row is stored',
    { tag: '@requires-isolated-context' },
    async ({ page }) => {
      const note = noteFor('homepage');
      await page.goto(pagePath('home', 'vi'));
      await fillReport(page, vi.open, note);
      await page.getByRole('button', { name: vi.send }).click();
      await expect(page).toHaveURL(/\/vi\/#report-sent$/);
      await expect(page.locator('#report-sent')).toBeVisible();
      const rows = reportsWithNote(note);
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({
        locale: 'vi',
        page: 'home',
        quote: vi.open,
        suggestion: '',
        note,
      });
      expect(JSON.parse(rows[0].keys)).toContain('site.report.open');
    },
  );

  test(
    'a quote on no page lands on #report-not-found and stores nothing',
    { tag: '@requires-isolated-context' },
    async ({ page }) => {
      const stem = noteFor('not-found');
      const note = `${stem} refused`;
      plantReport(`${stem} control`);
      await page.goto(pagePath('home', 'vi'));
      await fillReport(page, 'on no page at all, anywhere', note);
      await page.getByRole('button', { name: vi.send }).click();
      await expect(page).toHaveURL(/#report-not-found$/);
      await expect(page.locator('#report-not-found')).toBeVisible();
      // Drawn from the table's own rows under this test's stem: the planted
      // control, which the endpoint did not write. One row, on every engine.
      const stored = reportsStartingWith(stem);
      expect(
        searched(reportsWithNote(note), {
          of: stored,
          what: 'reports stored under this test',
        }),
      ).toEqual([]);
      expect(
        floorBreach('report/not-found-stored-rows', stored.length),
      ).toBeUndefined();
    },
  );

  for (const locale of LOCALES.filter(isBetaLocale))
    test(
      `the 404's ${locale} block stores its own locale and notFound key`,
      { tag: '@requires-isolated-context' },
      async ({ page }) => {
        const t = getSiteStrings(locale);
        const note = noteFor(`404 ${locale}`);
        const block = page.locator(`details[data-report][lang="${locale}"]`);
        await page.goto('/404');
        await block.locator('summary').click();
        await block
          .getByLabel(t.report.quoteLabel, { exact: true })
          .fill(t.notFound.heading);
        await block.getByLabel(t.report.noteLabel, { exact: true }).fill(note);
        await block.getByRole('button', { name: t.report.send }).click();
        await expect(page).toHaveURL(new RegExp(`/404#report-${locale}-sent$`));
        await expect(page.locator(`#report-${locale}-sent`)).toBeVisible();
        const rows = reportsWithNote(note);
        expect(rows).toHaveLength(1);
        expect(rows[0]).toMatchObject({
          locale,
          page: 'not-found',
          quote: t.notFound.heading,
          note,
        });
        expect(JSON.parse(rows[0].keys)).toEqual(['site.notFound.heading']);
      },
    );

  test(
    "another block's words are not found in this one, and nothing is stored",
    { tag: '@requires-isolated-context' },
    async ({ page }) => {
      const stem = noteFor('404 cross-block');
      const note = `${stem} refused`;
      plantReport(`${stem} control`);
      const block = page.locator('details[data-report][lang="vi"]');
      await page.goto('/404');
      await block.locator('summary').click();
      await block
        .getByLabel(vi.quoteLabel, { exact: true })
        .fill(getSiteStrings('zh').notFound.heading);
      await block.getByLabel(vi.noteLabel, { exact: true }).fill(note);
      await block.getByRole('button', { name: vi.send }).click();
      await expect(page).toHaveURL(/\/404#report-vi-not-found$/);
      await expect(page.locator('#report-vi-not-found')).toBeVisible();
      // The planted control is the only row under this test's stem.
      const stored = reportsStartingWith(stem);
      expect(
        searched(reportsWithNote(note), {
          of: stored,
          what: 'reports stored under this test',
        }),
      ).toEqual([]);
      expect(
        floorBreach('report/cross-block-stored-rows', stored.length),
      ).toBeUndefined();
    },
  );
});

test('a cross-origin POST is refused and stores nothing', async ({
  request,
}) => {
  const stem = noteFor('cross-origin');
  const note = `${stem} refused`;
  plantReport(`${stem} control`);
  const response = await request.post('/api/report', {
    headers: {
      Origin: 'https://evil.example',
      'Content-Type': 'application/x-www-form-urlencoded',
      Accept: 'application/json',
    },
    data: new URLSearchParams({
      locale: 'vi',
      page: 'home',
      quote: vi.open,
      note,
    }).toString(),
  });
  expect(response.status()).toBe(403);
  // The planted control is the only row under this test's stem.
  const stored = reportsStartingWith(stem);
  expect(
    searched(reportsWithNote(note), {
      of: stored,
      what: 'reports stored under this test',
    }),
  ).toEqual([]);
  expect(
    floorBreach('report/cross-origin-stored-rows', stored.length),
  ).toBeUndefined();
});

test.describe('on a tool page', () => {
  async function typeARoster(page: Page) {
    await page.goto(pagePath('classroom-groups', 'vi'));
    await page.locator('#cg-students-toggle').click();
    await page.getByRole('button', { name: tool.rosterAddStudent }).click();
    await page
      .locator('.cg-student')
      .first()
      .getByLabel(tool.rosterColName)
      .fill('Lan');
  }

  test('/vi/classroom-groups sends in place and the roster is still there', async ({
    page,
  }) => {
    const note = noteFor('roster');
    await typeARoster(page);
    await fillReport(page, vi.open, note);
    await page.getByRole('button', { name: vi.send }).click();
    const sent = page.locator('#report-sent');
    await expect(sent).toBeVisible();
    await expect(sent).toBeFocused();
    await expect(
      page.locator('.cg-student').first().getByLabel(tool.rosterColName),
    ).toHaveValue('Lan');
    await expect(page.getByLabel(vi.quoteLabel, { exact: true })).toHaveValue(
      '',
    );
    expect(reportsWithNote(note)).toHaveLength(1);
  });

  test('a double click stores one report', async ({ page }) => {
    const note = noteFor('double-click');
    await typeARoster(page);
    await fillReport(page, vi.open, note);
    await page.getByRole('button', { name: vi.send }).dblclick();
    await expect(page.locator('#report-sent')).toBeVisible();
    expect(reportsWithNote(note)).toHaveLength(1);
  });

  test('a later outcome replaces the earlier one', async ({ page }) => {
    const note = noteFor('replace');
    await typeARoster(page);
    await fillReport(page, 'on no page at all, anywhere', note);
    await page.getByRole('button', { name: vi.send }).click();
    await expect(page.locator('#report-not-found')).toBeVisible();
    await page.getByLabel(vi.quoteLabel, { exact: true }).fill(vi.open);
    await page.getByRole('button', { name: vi.send }).click();
    await expect(page.locator('#report-sent')).toBeVisible();
    await expect(page.locator('#report-not-found')).toBeHidden();
    await expect(page.locator('.report-status:visible')).toHaveCount(1);
  });

  test('an outcome in place supersedes the one a fragment shows', async ({
    page,
  }) => {
    // A click before the script loads posts the plain form and lands here
    // with a fragment; the next report is sent in place.
    const note = noteFor('fragment');
    await page.goto(`${pagePath('classroom-groups', 'vi')}#report-not-found`);
    await expect(page.locator('#report-not-found')).toBeVisible();
    await fillReport(page, vi.open, note);
    await page.getByRole('button', { name: vi.send }).click();
    await expect(page.locator('#report-sent')).toBeVisible();
    await expect(page.locator('#report-not-found')).toBeHidden();
    await expect(page.locator('.report-status:visible')).toHaveCount(1);
    expect(reportsWithNote(note)).toHaveLength(1);
  });
});

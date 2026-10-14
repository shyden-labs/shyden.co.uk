import type { BrowserContext, Page } from '@playwright/test';
import { test, expect } from './fixtures';
import { recorded, shoot } from './evidence';
import {
  getSiteStrings,
  getStrings,
  localisePath,
  type Locale,
} from '../../src/lib/i18n/index';
import { LOCALE_METADATA } from '../../src/lib/i18n/metadata';
import { CSV_LOCALES } from '../../src/lib/csv-locale';
import {
  downloadText,
  expectVisibleText,
  giveEveryoneASex,
  handoverTo,
  refuseFullscreen,
  rosterWithAnAbsence,
  upload,
} from './helpers';

test.use(recorded);

/**
 * The copy the operator approved on #161's sheet, read where a teacher meets
 * it.
 *
 * `verified-labels.test.ts` pins every value he read to its catalogue. That
 * proves what the catalogue says and nothing about the page: a component can
 * render a different key, or render the right one where nobody sees it. So
 * each correction is asserted here on the page itself, in the three
 * machine-seeded languages the corrections were made in, and photographed for
 * the evidence page.
 *
 * Every expectation is built from the catalogue, with the same compiled
 * messages the page calls, so the pin stays the one place the approved words
 * are written down. The roster is built with the English helpers and handed
 * over to each language, the way a teacher moves a class list between them.
 *
 * Not reached here: `errors.KEEP_APART_SEARCH_GAVE_UP`, which appears only
 * when the keep-apart search runs out of budget. Its words are pinned, and it
 * renders through the same `renderError` as every other refusal.
 */
const LANGUAGES: readonly Locale[] = ['zh', 'vi', 'th'];

/**
 * The roster every tool test below starts from, handed over to `locale`'s
 * tool: six students, five named, one absent, two together, one apart. Each
 * test starts here rather than where the one before left off, so each reads
 * one group of sentences inside its own budget: walked as one journey, the
 * tool ran past 30 s on WebKit whenever captures ran under load (#380).
 */
const openTool = async (
  page: Page,
  context: BrowserContext,
  locale: Locale,
) => {
  // The board's words are this spec's subject, not fullscreen, which
  // classroom-groups-projector.spec.ts owns. On the CONTEXT, so the
  // handover popup gets it (#344).
  await refuseFullscreen(context);
  await rosterWithAnAbsence(page);
  await giveEveryoneASex(page);
  await page.locator('#cg-io-toggle').click();
  const [, tool] = await Promise.all([
    page.waitForEvent('download'),
    context.waitForEvent('page'),
    handoverTo(page, LOCALE_METADATA[locale].nativeName),
  ]);
  await tool.waitForLoadState();
  // The refusal reached the popup. Without it this spec does not fail, it
  // flakes, which is how #344 went unexplained.
  expect(
    await tool.evaluate(() => String(Element.prototype.requestFullscreen)),
  ).toContain('refused');
  return tool;
};

test.describe('the copy the operator approved on #161', () => {
  for (const locale of LANGUAGES) {
    test(`${locale}: the form reads as approved`, async ({ page, context }) => {
      const t = getStrings(locale);
      const tool = await openTool(page, context, locale);

      const go = tool.locator('#cg-go');
      await expectVisibleText(go, t.again);
      await shoot(tool, `${locale}: the button reads “${t.makeGroups}”`, go);

      const howTo = tool.locator('#cg-howto-toggle');
      await expect(howTo).toHaveAttribute('aria-expanded', 'false');
      await howTo.click();
      const step = tool.locator('#cg-howto-body ol li').nth(2);
      await expectVisibleText(step, t.howToSteps[2]);
      await shoot(
        tool,
        `${locale}: the third step reads “${t.howToSteps[2]}”`,
        step,
      );

      const students = tool.locator('#cg-students-toggle');
      await expect(students).toContainText(t.sectionStudentsHeading);
      await expectVisibleText(
        students.locator('.state'),
        [
          t.stateNamed({ n: 5 }),
          t.stateAbsent({ n: 1 }),
          t.stateTogether({ n: 2 }),
          t.stateApart({ n: 1 }),
        ].join(' · '),
      );
      await shoot(
        tool,
        `${locale}: the students section is headed “${t.sectionStudentsHeading}” and counts the roster`,
        students,
      );

      await students.click();
      const together = tool.getByRole('columnheader', {
        name: t.rosterColTogether,
        exact: true,
      });
      await expect(together).toBeVisible();
      await shoot(
        tool,
        `${locale}: the roster's column is headed “${t.rosterColTogether}”`,
        tool.locator('#cg-roster thead'),
      );
    });

    test(`${locale}: the groups and the board read as approved`, async ({
      page,
      context,
    }) => {
      const t = getStrings(locale);
      const tool = await openTool(page, context, locale);

      const go = tool.locator('#cg-go');
      await go.click();
      const heading = tool.locator('#cg-results-h');
      await expectVisibleText(heading, t.makeGroups);
      await expectVisibleText(go, t.again);
      const board = tool.locator('#cg-board-open');
      await expectVisibleText(board, t.boardOpen);
      await shoot(
        tool,
        `${locale}: the groups are headed “${t.resultsHeading}”, with “${t.again}” and “${t.boardOpen}”`,
        tool.locator('#cg-results'),
      );

      await tool.getByLabel(t.classLabel, { exact: true }).fill('6A');
      await go.click();
      await expectVisibleText(
        heading,
        t.resultsHeadingNamed({ className: '6A' }),
      );
      await shoot(
        tool,
        `${locale}: named for the class, the groups are headed “${t.resultsHeadingNamed({ className: '6A' })}”`,
        heading,
      );

      await board.click();
      // Inside the board's own bar: in zh the page's button reads the same
      // `重新洗牌`, and a page-wide match would find that one too.
      const bar = tool.locator('#cg-board-bar');
      const shuffle = bar.getByRole('button', {
        name: t.boardShuffle,
        exact: true,
      });
      // The bar fades to 6% after a pause, and never while it holds focus
      // (projector.ts, `canFade`) -- so it is read the way a keyboard user
      // reaches it. A capture taken after the fade would show a ghost.
      await shuffle.focus();
      await expect(bar).not.toHaveClass(/\bfaded\b/);
      await expectVisibleText(shuffle, t.boardShuffle);
      await shoot(
        tool,
        `${locale}: the board offers “${t.boardShuffle}”`,
        shuffle,
      );
      await bar.getByRole('button', { name: t.boardExit, exact: true }).click();
    });

    test(`${locale}: the class list file reads as approved`, async ({
      page,
      context,
    }) => {
      const t = getStrings(locale);
      const tool = await openTool(page, context, locale);

      // Named for a class, as a teacher's list is: the file then opens with
      // the class comment, and the header is its second line.
      await tool.getByLabel(t.classLabel, { exact: true }).fill('6A');
      await tool.locator('#cg-io-toggle').click();
      const file = await downloadText(tool, t.ioExportClassList);
      // The header CELLS, compared exactly: a header word is a parsing token,
      // and a substring test would pass `性` inside `性别`.
      expect((file.split('\n')[1] ?? '').split(',')).toEqual(
        Object.values(CSV_LOCALES[locale].columns).slice(1),
      );
      await shoot(
        tool,
        `${locale}: the downloaded class list is headed ${Object.values(CSV_LOCALES[locale].columns).join(', ')}`,
        tool.getByRole('button', { name: t.ioExportClassList }),
      );

      // Written in the page's own language: a file headed in another one is
      // refused before any warning, with an offer to open that language.
      await upload(
        tool,
        'other.csv',
        `${CSV_LOCALES[locale].columns.number}\n1\n`,
      );
      const warning = tool.getByText(
        t.ioReplaceWarning({ total: 6, named: 5 }),
      );
      await expect(warning).toBeVisible();
      await shoot(
        tool,
        `${locale}: importing over the roster warns “${t.ioReplaceWarning({ total: 6, named: 5 })}”`,
        warning,
      );
    });

    test(`${locale}: the Glory Points page reads as approved`, async ({
      page,
    }) => {
      const glory = getSiteStrings(locale).glory;
      await page.goto(localisePath('/glory-points', locale));

      const heading = page.getByRole('heading', { level: 1 });
      await expectVisibleText(heading, glory.heading);
      await expect(page).toHaveTitle(glory.title);
      await shoot(
        page,
        `${locale}: the page is headed “${glory.heading}”, titled “${glory.title}”`,
        heading,
      );
    });
  }
});

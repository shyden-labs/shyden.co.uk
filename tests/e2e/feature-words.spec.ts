import { test, expect } from './fixtures';
import { recorded, shoot } from './evidence';
import { floorBreach } from '../floors';
import { getStrings, renderError, type Locale } from '../../src/lib/i18n/index';
import { LOCALE_METADATA } from '../../src/lib/i18n/metadata';
import { CSV_LOCALES } from '../../src/lib/csv-locale';
import { importFile } from '../../src/lib/csv';
import { ERROR_CODES } from '../../src/lib/grouping';
import {
  buildRoster,
  buildRosterAtPath,
  expectVisibleText,
  handoverTo,
  listedByThisBrowser,
  upload,
} from './helpers';

test.use(recorded);

/**
 * The sentences corrected on #319's sheet, read where a teacher meets them.
 * So are the grouping options' summary and the stale-leftovers notice, which
 * #390 corrected: zh, vi and th said "sorted by sex" for mixing, and leftover
 * FOOD for the leftover students.
 *
 * `feature-terms.test.ts` holds every piece of copy that names a feature to
 * the words its language approved, and `verified-labels.test.ts` pins what the
 * operator read. Neither says anything about the page: a component can render
 * a different key, or render the right one where nobody sees it. So each
 * correction a teacher can reach is asserted here, on the page, in the
 * language it was corrected in, and photographed for the evidence page.
 *
 * Every expectation is built from the catalogue with the functions the page
 * itself calls -- `renderError` for a refusal, `importFile` for a faulty
 * CSV's row problems -- so the pins stay the one place the approved words are
 * written. A refusal of the whole file is the one key it must be, never
 * whatever `importFile` returns first.
 *
 * Not reached here, and held by the unit guard and the pins instead: the
 * seven pin messages (the page has no pin control yet), the three
 * `*_SEARCH_GAVE_UP` messages (they need the search to run out of budget),
 * `TOGETHER_APART_CLASH` (the roster refuses the clash before the engine
 * runs, with `rosterClashMessage`, which IS read here), and the
 * `*_NO_ARRANGEMENT` messages, which no roster in this spec builds.
 */
const LANGUAGES: readonly Locale[] = ['zh', 'vi', 'th'];

/** Four students; the first two are a together pair of mixed sex. */
const NAMES = ['Ana', 'Budi', 'Citra', 'Dedi'];
const byNumber = (n: number) => NAMES[n - 1] ?? String(n);

test.describe('the sentences corrected on #319', () => {
  for (const locale of LANGUAGES) {
    test(`${locale}: every reachable correction reads as approved`, async ({
      page,
      context,
    }) => {
      const t = getStrings(locale);
      const columns = CSV_LOCALES[locale].columns;

      await buildRoster(page, [
        ['F', NAMES[0]],
        ['M', NAMES[1]],
        ['F', NAMES[2]],
        ['M', NAMES[3]],
      ]);
      for (const row of [0, 1])
        await page
          .locator('.cg-student')
          .nth(row)
          .getByLabel('Together')
          .selectOption('A');
      await page.locator('#cg-io-toggle').click();
      const [, tool] = await Promise.all([
        page.waitForEvent('download'),
        context.waitForEvent('page'),
        handoverTo(page, LOCALE_METADATA[locale].nativeName),
      ]);
      await tool.waitForLoadState();
      const rows = tool.locator('.cg-student');
      await expect(rows).toHaveCount(NAMES.length);
      const go = tool.locator('#cg-go');
      const error = tool.locator('#cg-error');

      // The how-to's second step names who is being split.
      await tool.locator('#cg-howto-toggle').click();
      const step = tool.locator('#cg-howto-body ol li').nth(1);
      await expectVisibleText(step, t.howToSteps[1]);
      await shoot(
        tool,
        `${locale}: the second step reads “${t.howToSteps[1]}”`,
        step,
      );

      // The leftover-student choices, under the grouping options.
      await tool.locator('#cg-grouping-toggle').click();
      for (const [value, text] of [
        ['spread', t.leftoversSpread],
        ['bunch', t.leftoversBunch],
      ] as const) {
        const choice = tool.locator('label').filter({
          has: tool.locator(`input[name="leftovers"][value="${value}"]`),
        });
        await expectVisibleText(choice, text);
      }
      await shoot(
        tool,
        `${locale}: leftover students can be “${t.leftoversSpread}” or “${t.leftoversBunch}”`,
        tool
          .locator('input[name="leftovers"]')
          .first()
          .locator('xpath=ancestor::div[@class="field"]'),
      );

      // The section's own summary names each option chosen (#390).
      const summary = tool.locator('#cg-grouping-toggle .state');
      await tool.locator('#cg-sex-mix').check();
      await expectVisibleText(summary, t.stateMixed);
      await shoot(
        tool,
        `${locale}: mixing boys and girls reads “${t.stateMixed}”`,
        summary,
      );
      await tool.locator('#cg-sex-mix').uncheck();
      await tool.locator('input[name="leftovers"][value="bunch"]').check();
      await expectVisibleText(summary, t.stateBunched);
      await shoot(
        tool,
        `${locale}: leftover students in one group reads “${t.stateBunched}”`,
        summary,
      );
      await tool.locator('input[name="leftovers"][value="spread"]').check();

      // A mixed-sex together pair cannot make a single-sex group.
      await tool.locator('#cg-sex-separate').check();
      await go.click();
      await expectVisibleText(
        error,
        await listedByThisBrowser(
          tool,
          locale,
          [1, 2].map(byNumber),
          renderError(
            { code: ERROR_CODES.sexSeparateSplitsUnit, students: [1, 2] },
            t,
            byNumber,
          ),
        ),
      );
      await shoot(
        tool,
        `${locale}: a mixed-sex together pair is refused in separate mode`,
        error,
      );
      await tool.locator('#cg-sex-separate').uncheck();

      // The roster arrives folded; its rows are edited from here on.
      await tool.locator('#cg-students-toggle').click();
      await expect(rows.first()).toBeVisible();

      // Four students on one together letter cannot fit a group of two.
      for (const row of [2, 3])
        await rows
          .nth(row)
          .getByLabel(t.rosterColTogether, { exact: true })
          .selectOption('A');
      await tool.locator('#cg-size').fill('2');
      await go.click();
      await expectVisibleText(
        error,
        renderError(
          {
            code: ERROR_CODES.togetherUnitTooLarge,
            letter: 'A',
            unit: 4,
            groupSize: 2,
          },
          t,
          byNumber,
        ),
      );
      await shoot(
        tool,
        `${locale}: a together letter larger than any group is refused`,
        error,
      );

      // Everyone absent is the same refusal as nobody at all.
      for (let row = 0; row < NAMES.length; row++)
        await rows
          .nth(row)
          .getByLabel(t.rosterColAbsent, { exact: true })
          .check();
      await go.click();
      await expectVisibleText(
        error,
        renderError({ code: ERROR_CODES.noStudents }, t),
      );
      await shoot(
        tool,
        `${locale}: a roster with everyone absent is refused`,
        error,
      );
      for (let row = 0; row < NAMES.length; row++) {
        await rows
          .nth(row)
          .getByLabel(t.rosterColAbsent, { exact: true })
          .uncheck();
        await rows
          .nth(row)
          .getByLabel(t.rosterColTogether, { exact: true })
          .selectOption({ value: '' });
      }

      // Groups made, the print panel offers the group results and the letters.
      await go.click();
      await expect(error).toBeHidden();
      await tool.locator('#cg-print-open').click();
      const panel = tool.locator('#cg-print-panel');
      await expect(panel).toBeVisible();
      await expectVisibleText(
        panel
          .locator('label')
          .filter({ has: tool.locator('input[value="groups"]') }),
        t.printWhatGroups,
      );
      await expectVisibleText(
        panel
          .locator('label')
          .filter({ has: tool.locator('#cg-print-letters') }),
        t.printShowLetters,
      );
      await shoot(
        tool,
        `${locale}: the print panel offers “${t.printWhatGroups}” and “${t.printShowLetters}”`,
        panel,
      );
      await tool.keyboard.press('Escape');
      await expect(panel).toBeHidden();

      // Changing the leftovers choice makes those groups out of date, and the
      // notice names the choice in the words of its own label (#390).
      const stale = tool.locator('#cg-stale');
      await tool.locator('input[name="leftovers"][value="bunch"]').check();
      await expectVisibleText(
        stale.locator('#cg-stale-text'),
        t.staleLeftovers,
      );
      await shoot(
        tool,
        `${locale}: out of date because “${t.staleLeftovers}”`,
        stale,
      );
      await tool.locator('input[name="leftovers"][value="spread"]').check();
      await expect(stale).toHaveCount(1);
      await expect(stale).toBeHidden();

      // A together pair that is also an apart pair is refused as it is typed.
      // A select offers the letters in use and the next free one, so 'A' it is.
      for (const row of [0, 1]) {
        await rows
          .nth(row)
          .getByLabel(t.rosterColTogether, { exact: true })
          .selectOption('A');
        await rows
          .nth(row)
          .getByLabel(t.rosterColApart, { exact: true })
          .selectOption('A');
      }
      const clash = tool.locator('#cg-roster-problem');
      await expectVisibleText(
        clash,
        await listedByThisBrowser(
          tool,
          locale,
          [NAMES[0], NAMES[1]],
          t.rosterClashMessage({ names: [NAMES[0], NAMES[1]] }),
        ),
      );
      await shoot(
        tool,
        `${locale}: a together pair kept apart is refused as it is typed`,
        clash,
      );

      // Every problem the page lists after an import, in order.
      const listed = tool.locator('#cg-io-problems li');

      // A file in the page's own language, with one fault on every row.
      await tool.locator('#cg-io-toggle').click();
      const faulty = [
        [columns.number, columns.name, columns.absent].join(','),
        `1,${NAMES[0]},?`,
        `1.5,${NAMES[1]},`,
        `1,${NAMES[2]},`,
        `,${NAMES[3]},`,
      ].join('\n');
      const parsed = importFile(faulty, locale, t);
      expect(parsed.ok).toBe(false);
      const problems = parsed.ok
        ? []
        : parsed.problems.map(({ message }) => message);
      // One problem for each faulty row: a second reading of the faults this
      // file plants, with no number in it (#469).
      expect(problems).toHaveLength(faulty.split('\n').slice(1).length);
      await upload(tool, 'faulty.csv', faulty);
      await expect(listed).toHaveText(problems);
      for (const problem of problems)
        await expectVisibleText(
          tool.getByText(problem, { exact: true }),
          problem,
        );
      // Recorded in tests/floors.json and checked for equality (#475): one
      // figure for every language and engine, measured on all five.
      expect(
        floorBreach('feature-words/import-problems', problems.length),
      ).toBeUndefined();
      await shoot(
        tool,
        `${locale}: a faulty class list names every problem`,
        tool.getByText(problems[0] ?? '', { exact: true }).locator('xpath=..'),
      );

      // A whole-file refusal is named by its key, not taken from whatever
      // importFile puts first: a file in another language that stopped being
      // recognised would fall through to "no number column", and the page
      // agreeing with that would still pass (#390 F122). Each stands alone,
      // and the replace warning a roster with work in it would get never opens.
      const replaceWarning = tool.locator('#cg-io-confirm');

      // A file with no number column at all.
      const numberless = [
        [columns.name, columns.absent].join(','),
        `${NAMES[0]},`,
      ].join('\n');
      const reason = t.csvProblemNoNumberColumn;
      await upload(tool, 'numberless.csv', numberless);
      await expectVisibleText(tool.getByText(reason, { exact: true }), reason);
      await expect(listed).toHaveText([reason]);
      await expect(replaceWarning).toHaveCount(1);
      await expect(replaceWarning).toBeHidden();
      await shoot(
        tool,
        `${locale}: a class list with no number column is refused`,
        tool.getByText(reason, { exact: true }),
      );

      // A file written in another language is refused before any warning.
      const english = [
        Object.values(CSV_LOCALES.en.columns).join(','),
        `1,${NAMES[0]},F,,,`,
      ].join('\n');
      const why = t.csvWrongLanguage({
        language: t.csvLanguageName.en,
        version: t.csvLanguageVersion.en,
      });
      await upload(tool, 'english.csv', english);
      await expectVisibleText(tool.getByText(why, { exact: true }), why);
      await expect(listed).toHaveText([why]);
      await expect(replaceWarning).toHaveCount(1);
      await expect(replaceWarning).toBeHidden();
      await shoot(
        tool,
        `${locale}: an English class list is refused with “${why}”`,
        tool.getByText(why, { exact: true }),
      );
    });
  }

  test('id: everyone absent is refused in the words of the column', async ({
    page,
  }) => {
    const t = getStrings('id');
    await buildRosterAtPath(page, '/id/classroom-groups', [
      ['F', NAMES[0]],
      ['M', NAMES[1]],
    ]);
    const rows = page.locator('.cg-student');
    for (let row = 0; row < 2; row++)
      await rows
        .nth(row)
        .getByLabel(t.rosterColAbsent, { exact: true })
        .check();
    await page.locator('#cg-go').click();
    const error = page.locator('#cg-error');
    await expectVisibleText(
      error,
      renderError({ code: ERROR_CODES.noStudents }, t),
    );
    await shoot(page, 'id: a roster with everyone absent is refused', error);
  });
});

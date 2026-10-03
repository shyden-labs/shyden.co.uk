import { test, expect } from './fixtures';
import { recorded, shoot } from './evidence';
import { recordErrors } from './recorders';
import { searched } from '../source-files';
import { localePaths } from './locale-sampling';
import { THEMES } from '../palette';
import { emulateTheme } from '../themes';
import { getStrings, localeFromPath } from '../../src/lib/i18n';
import {
  atLeast44,
  expectNoHorizontalScroll,
  rectAtLeast44,
} from '../viewport';
import {
  addSeveral,
  contrastRatio,
  downloadName,
  expectNothingStored,
  expectStudentsBoxReports,
  giveEveryoneASex,
  markAbsent,
  openRoster,
} from './helpers';

test.use(recorded);

/**
 * Stage 3, Task 2: the roster table. Traceability: R-01, R-02, R-09, R-10,
 * R-11, F-02, A-01, L-06 (design spec section 13 /
 * docs/superpowers/plans/2026-08-06-classroom-groups-v2-test-traceability.md).
 *
 * Stage 3, Task 2's own brief asserts the unnamed-row test against
 * `#cg-groups` -- the SAME mistake Stage 2, Task 1's own brief made and
 * classroom-groups.spec.ts already corrected (see that file's own comment,
 * just above its first test): `#cg-groups` is the "number of groups"
 * NUMBER INPUT's id (`ClassroomGroupsPage.astro`'s `.split-by` field), not
 * the results container. Corrected to `#cg-results` here, and in
 * `tests/e2e/helpers.ts`'s own `withGroups` -- the same correction later
 * stages' own briefs (Task 9, Task 10) will need too, since they repeat the
 * identical `#cg-groups` snippet.
 */

test.describe('the roster table', () => {
  // Seven columns, not six, as of Stage 3, Task 6's own fix round: Remove
  // earns a real header, not a silently unlabelled cell. This title used
  // to read "the table has the six columns, in order", asserting exactly
  // six -- that number was pinning the column count as it stood at Task 2,
  // never a requirement anyone actually chose. When Remove's own column
  // landed with no `<th>` of its own (reasoned, at the time, as the way to
  // avoid reddening THIS test), the real defect was a table column with no
  // accessible name at all -- do not "fix" this back down to six; six was
  // the bug's own shape, not the contract. The seventh header's own text
  // ('Remove'/'Hapus') is present in the DOM -- `toHaveText` reads it here
  // exactly as it reads the other six -- but visually hidden via `clip-path`
  // (ClassroomGroupsPage.astro's own `.cg-roster-remove-heading`): a
  // screen reader building this table's column headers finds a real name
  // for every one of the seven, while a sighted teacher never sees a
  // printed "Remove" heading sitting above a column of seven identical
  // "Remove" buttons repeating the same word.
  test('the table has seven columns, in order — the seventh (Remove) has a real header, visually hidden but present', async ({
    page,
  }) => {
    await openRoster(page);
    // Absent leads (operator, 2026-08-13). Every positional rule that depends
    // on this order moves with it — see ClassroomGroupsPage.astro's
    // `.cg-student > td:nth-child(...)` card layout, its `col:nth-child(...)`
    // widths, and the print letters rule.
    const columns = [
      'Absent',
      '#',
      'Name',
      'Sex',
      'Together',
      'Apart',
      'Remove',
    ];
    await expect(page.locator('#cg-roster thead th')).toHaveText(columns);
    // `toHaveText` reads `textContent`, which a heading hidden with
    // `display: none` still carries, so it cannot say whether a screen reader
    // gets a name for each column. The accessibility tree can. Every heading
    // stays in it whatever hides it from sight: the whole row in the card
    // layout, and Remove's own text in the table layout (#200).
    const headers = page.locator('#cg-roster').getByRole('columnheader');
    await expect(headers).toHaveCount(columns.length);
    for (const [index, name] of columns.entries()) {
      await expect(headers.nth(index)).toHaveAccessibleName(name);
    }
    await shoot(
      page,
      'every heading keeps its name; the table draws six, the cards draw none',
      page.locator('#cg-roster'),
    );
  });

  // The general invariant "the table has seven columns" above pins today.
  // This is the one that stops it drifting again: derived from the DOM on
  // BOTH sides (colgroup's own <col> count, thead's own <th> count),
  // never a hard-coded number, so an eighth column added later without
  // its own header -- or a header added without its own column -- fails
  // here regardless of what the actual count turns out to be.
  test('every column has a header — the header count matches the column count', async ({
    page,
  }) => {
    await openRoster(page);
    const columnCount = await page.locator('#cg-roster colgroup col').count();
    const headerCount = await page.locator('#cg-roster thead th').count();
    expect(headerCount).toBe(columnCount);
  });

  test('an unnamed row renders Student N in the results', async ({ page }) => {
    await openRoster(page);
    await giveEveryoneASex(page);
    await page.getByRole('button', { name: 'Make groups' }).click();
    await expect(page.locator('#cg-results')).toContainText('Student 1');
  });

  // Every locale (#423): the table's column widths come from its localised
  // column names.
  for (const path of localePaths('/classroom-groups'))
    test(`an empty name box is exactly as wide as a full one -- ${path}`, async ({
      page,
    }) => {
      await openRoster(page, path);
      const t = getStrings(localeFromPath(path));
      await page
        .getByRole('button', { name: t.rosterAddStudent, exact: true })
        .click();
      const nameBox = (row: number) =>
        page
          .locator('#cg-roster tbody tr')
          .nth(row)
          .getByLabel(t.rosterColName, { exact: true });
      await nameBox(0).fill('Sebastianus');
      const a = (await nameBox(0).boundingBox())!;
      const b = (await nameBox(1).boundingBox())!;
      expect(b.width).toBeCloseTo(a.width, 0);
    });

  test(
    'a long name does not push the letters out of view',
    { tag: '@emulated-viewport' },
    async ({ page }) => {
      await page.setViewportSize({ width: 1280, height: 900 });
      await openRoster(page);
      await page
        .locator('#cg-roster tbody tr')
        .nth(0)
        .getByLabel('Name')
        .fill('Maria Anastasia Wijayanti');
      await expectNoHorizontalScroll(page);
    },
  );

  // Run at each project's own default viewport (desktop for
  // chromium/firefox/webkit, a phone's own default for
  // mobile-chrome/mobile-safari) rather than pinned to one, so the table
  // layout and the phone CARD layout are both covered.
  //
  // #294 widened this from height alone to the full 44x44 claim, and
  // MEASURED which controls can carry it. Every control here does, in both
  // layouts, with ONE exception that is a design decision rather than an
  // omission -- see `#` below.
  //
  // Every locale (#423): the dropdowns show localised placeholders (#249).
  for (const path of localePaths('/classroom-groups'))
    test(`per-row controls meet the 44px touch target -- ${path}`, async ({
      page,
    }) => {
      await openRoster(page, path);
      const t = getStrings(localeFromPath(path));
      const row = page.locator('.cg-student').first();
      // The four column names, read in the page's own language. Not a
      // population: the inner loop names four fixed controls of one row.
      for (const label of [
        t.rosterColName,
        t.rosterColSex,
        t.rosterColTogether,
        t.rosterColApart,
      ]) {
        await atLeast44(row.getByLabel(label, { exact: true }), label);
      }
      // `#` is the one control on this page held to the HEIGHT half alone.
      // The card layout gives it 2 of 12 columns on purpose -- "a class
      // register number is rarely more than 3 digits", and design spec
      // section 3 is explicit that no arrangement of six full-width targets
      // fits a phone at all, which is the whole reason the reflow exists.
      // ClassroomGroupsPage.astro's `td:nth-child(2)` rule says so and names
      // this test; this is the other half of that cross-reference.
      //
      // Measured under #294, which is why the exception is this narrow
      // rather than the whole row: 43.28px wide on mobile-chrome and 42.80px
      // on mobile-safari, against 80.78px on chromium's desktop default. The
      // other four controls clear the floor in BOTH layouts. Kept as an
      // inline exception, spelled out, rather than a height-only export from
      // tests/viewport.ts -- a weaker helper anyone could reach for is the
      // trivial escape hatch #118 was filed about, and an exception a reader
      // meets at the site cannot be reached for by accident.
      //
      // It is ordered AFTER the loop deliberately. As the loop's first entry
      // it failed first and Playwright stopped the test there, so the four
      // controls behind it were never measured on a phone at all.
      const number = (await row
        .getByLabel(t.rosterColNumber, { exact: true })
        .boundingBox())!;
      expect(Math.round(number.height), '# height').toBeGreaterThanOrEqual(44);
      // The checkbox itself is drawn small on purpose, matching this page's
      // existing `.switch input` convention -- its REAL tap target is the
      // <label> wrapping it. Measuring the bare input here would repeat the
      // exact false failure classroom-groups-controls.spec.ts's own "the two
      // sex switches meet the 44px touch target once open" test already
      // documents hitting once, and already works around the same way: via
      // `.closest('label')`, not the input's own rect.
      const absent = await row
        .getByLabel(t.rosterColAbsent, { exact: true })
        .evaluate((el) => {
          const target = el.closest('label') ?? el;
          const { width, height } = target.getBoundingClientRect();
          return { width, height };
        });
      rectAtLeast44(absent, 'Absent (label)');
    });

  test('no console errors while building a roster', async ({ page }) => {
    const reported = recordErrors(page);

    await openRoster(page);
    await addSeveral(page, 3);
    const row = page.locator('.cg-student').first();
    await row.getByLabel('Name').fill('Ana');
    await row.getByLabel('Sex').selectOption('F');
    await row.getByLabel('Absent').check();
    await row.getByLabel('Together').selectOption('A');
    await giveEveryoneASex(page);
    await page.getByRole('button', { name: 'Make groups' }).click();
    // The groups arrived (#425): a silence over a press that made nothing
    // has not run the code that renders them.
    await expect(page.locator('#cg-results .group').first()).toBeVisible();

    await reported.expectNone('building a roster reports nothing');
  });
});

// R-01 (numbers assigned 1…N, the Playwright half -- nextNumber's own unit
// coverage is tests/unit/roster.test.ts) and R-02 (the teacher may override
// a number).
test.describe('numbers', () => {
  test('assigned 1, 2, 3… in the order rows are added', async ({ page }) => {
    await openRoster(page);
    await page.getByRole('button', { name: 'Add student' }).click();
    await page.getByRole('button', { name: 'Add student' }).click();
    // Individually, not `toHaveValue(['1','2','3'])` against the whole
    // multi-element locator -- unlike `toHaveText`, `toHaveValue` is a
    // single-element (strict-mode) matcher and does not accept an array for
    // a locator resolving to more than one node.
    const rows = page.locator('.cg-student');
    await expect(rows.nth(0).getByLabel('#')).toHaveValue('1');
    await expect(rows.nth(1).getByLabel('#')).toHaveValue('2');
    await expect(rows.nth(2).getByLabel('#')).toHaveValue('3');
  });

  test('the teacher may override a number, and a later add still takes one past the highest', async ({
    page,
  }) => {
    await openRoster(page);
    const first = page.locator('.cg-student').first().getByLabel('#');
    await first.fill('50');
    await expect(first).toHaveValue('50');
    // Proves the override reached the actual roster, not just the visible
    // input: the next student added takes one past 50, not one past 1.
    await page.getByRole('button', { name: 'Add student' }).click();
    await expect(
      page.locator('.cg-student').nth(1).getByLabel('#'),
    ).toHaveValue('51');
  });
});

// A-01: the Absent column, and ticking it marking a student out. The tint,
// stripe and pill it also carries (design spec section 4) are a later
// task's own job (traceability A-05…A-09) -- this proves the functional
// consequence the column exists for.
test.describe('absence', () => {
  test('ticking Absent excludes that student from the results', async ({
    page,
  }) => {
    await openRoster(page);
    await page.getByRole('button', { name: 'Add student' }).click();
    await page.locator('.cg-student').first().getByLabel('Absent').check();
    await giveEveryoneASex(page);
    await page.getByRole('button', { name: 'Make groups' }).click();
    await expect(page.locator('#cg-results')).not.toContainText('Student 1');
    await expect(page.locator('#cg-results')).toContainText('Student 2');
  });

  test('nothing in the row is disabled by ticking it', async ({ page }) => {
    await openRoster(page);
    const row = page.locator('.cg-student').first();
    await row.getByLabel('Absent').check();
    for (const label of ['Name', 'Sex', 'Together', 'Apart']) {
      await expect(row.getByLabel(label), label).toBeEnabled();
    }
  });
});

/**
 * Stage 3, Task 4: absence, rendered. Traceability: A-05…A-10, A-19, A-20,
 * and F-05 (the tint/stripe/pill on the CARD, not just the row) -- handed
 * to this task explicitly by Task 3's own carried-forward note, since
 * `.cg-student` is the one element both layouts share and neither task 2
 * nor task 3 could style it. A-01…A-04 are already proven above (Task 2's
 * own 'absence' describe block, immediately before this one) -- not
 * reproduced here.
 *
 * task-4-brief.md's own Step 1 snippet is reproduced below with real
 * differences, not verbatim:
 *  - Its own first test, 'nothing in the row is disabled', duplicates
 *    Task 2's 'nothing in the row is disabled by ticking it' immediately
 *    above -- identical assertions, same four labels. Design spec section
 *    13's own rule ("the existing suites are extended, not duplicated")
 *    is why it is not reproduced a second time under a second title.
 *  - `markAbsent` is defined in tests/e2e/helpers.ts, not locally, per
 *    that file's own header rule -- see its own doc comment there.
 *  - The count-line test replaces the brief's own three inline clicks with
 *    `addSeveral`, the established correction this file's own Task 3
 *    section already made once for the identical reason.
 *  - Every test that resizes the viewport carries `@emulated-viewport`
 *    (global-constraints.md; tests/unit/viewport-tagging.test.ts is a hard
 *    guard on it), which the brief's own snippet does not carry on any of
 *    its tests -- none of the brief's own six actually resize the
 *    viewport, so none needed it; the tag only appears below on the tests
 *    THIS task adds beyond the brief.
 *
 * Three tests below are not in the brief at all, added because the parent
 * task explicitly named the risk they cover:
 *  - the card/table parity loop -- proving F-05 on BOTH layouts, not
 *    assuming the shared `.cg-student` selector makes it automatic;
 *  - the pill's own AA contrast, computed from live styles the same way
 *    classroom-groups.spec.ts's own accent-colour test already does,
 *    rather than trusting the hex pair by eye;
 *  - a no-horizontal-scroll check at 320px WITH the pill actually
 *    rendered -- the existing 100-student check (Task 3, above) never
 *    marks anyone absent, so it never exercises the one extra element this
 *    task adds to the tightest column on the narrowest layout.
 */
test.describe('an absent student', () => {
  test('and every field can still be edited', async ({ page }) => {
    await markAbsent(page);
    const row = page.locator('.cg-student').first();
    // All five of the row's other fields (#426): this edited two, so an
    // absent row that locked its number or its letters still passed.
    // Absent itself is the field that made the row absent. Counted off the
    // row, so a seventh field fails here until it is edited below too.
    await expect(row.locator('input, select')).toHaveCount(6);
    await row.getByLabel('#', { exact: true }).fill('7');
    await row.getByLabel('Name').fill('Dewi');
    await row.getByLabel('Sex').selectOption('F');
    await row.getByLabel('Together').selectOption('A');
    await row.getByLabel('Apart').selectOption('A');
    await expect(row.getByLabel('#', { exact: true })).toHaveValue('7');
    await expect(row.getByLabel('Name')).toHaveValue('Dewi');
    await expect(row.getByLabel('Sex')).toHaveValue('F');
    await expect(row.getByLabel('Together')).toHaveValue('A');
    await expect(row.getByLabel('Apart')).toHaveValue('A');
  });

  // One test per theme (#418).
  for (const theme of THEMES)
    test(`${theme}: is tinted, striped and labelled`, async ({ page }) => {
      await markAbsent(page);
      const row = page.locator('.cg-student').first();
      await emulateTheme(page, theme);
      await expect(row).toHaveCSS('background-color', 'rgb(255, 246, 227)');
      await expect(row.locator('.cg-absent-pill')).toHaveText('absent');
    });

  test('is still readable with colour removed', async ({ page }) => {
    await markAbsent(page);
    await page.addStyleTag({
      content: 'html { filter: grayscale(1) !important }',
    });
    await expect(
      page.locator('.cg-student').first().getByLabel('Absent'),
    ).toBeChecked();
    await expect(
      page.locator('.cg-student').first().locator('.cg-absent-pill'),
    ).toHaveText('absent');
  });

  test('the consequence line is there before anyone is marked', async ({
    page,
  }) => {
    await openRoster(page);
    await expect(
      page.getByText(
        'Students marked absent are not included when groups are made.',
      ),
    ).toBeVisible();
  });

  test('the count line reads students, here and absent', async ({ page }) => {
    await openRoster(page);
    await addSeveral(page, 23);
    await page.locator('.cg-student').first().getByLabel('Absent').check();
    await page.locator('.cg-student').nth(1).getByLabel('Absent').check();
    await expect(page.locator('#cg-roster-count')).toHaveText(
      '24 students · 22 here · 2 absent',
    );
  });

  test('the word is never "away", anywhere', async ({ page }) => {
    await markAbsent(page);
    // Three who are here (#425): with the only student absent the page
    // refused to group, so "anywhere" never included the results.
    await addSeveral(page, 3);
    await giveEveryoneASex(page);
    await page.getByRole('button', { name: 'Make groups' }).click();
    await expect(page.locator('#cg-results .group').first()).toBeVisible();
    await expect(page.locator('body')).not.toContainText(/\baway\b/);
  });

  // F-05: the SAME `.cg-student` (roster-ui.ts's whole "one renderer, two
  // CSS layouts" point) must carry the tint, the stripe and the pill in
  // BOTH shapes, not only the one Task 2 happened to build against first.
  // The stripe assertion is loose on purpose (`not.toBe('none')`, not an
  // exact rgb/inset string): box-shadow's computed-style text format is
  // not identical across the five engines this task was told to check
  // (the same "WebKit lies" caution the brief itself raises about
  // min-height applies just as well to trusting one engine's own
  // serialisation of a shadow), and the two layouts deliberately paint the
  // stripe on two DIFFERENT elements (see ClassroomGroupsPage.astro's own
  // comment on `.cg-student.is-absent` for why box-shadow cannot paint on
  // a `display: table-row` box at all), so a single exact string could
  // never describe both correctly.
  // One test per layout per theme (#418).
  for (const { name, width } of [
    { name: 'cards', width: 320 },
    { name: 'table', width: 1280 },
  ] as const)
    for (const theme of THEMES) {
      test(
        `${name}, ${theme}: absence carries the tint, the stripe and the pill -- same element as the table`,
        { tag: '@emulated-viewport' },
        async ({ page }) => {
          await page.setViewportSize({ width, height: 900 });
          await markAbsent(page);
          const row = page.locator('.cg-student').first();
          await emulateTheme(page, theme);
          await expect(row).toHaveCSS('background-color', 'rgb(255, 246, 227)');
          await expect(row.locator('.cg-absent-pill')).toHaveText('absent');
          const cards = await page
            .locator('#cg-roster')
            .evaluate((el) => getComputedStyle(el).display !== 'table');
          const stripeTarget = cards ? row : row.locator('td').first();
          const boxShadow = await stripeTarget.evaluate(
            (el) => getComputedStyle(el).boxShadow,
          );
          expect(boxShadow, `${name} stripe`).not.toBe('none');
        },
      );
    }

  // L-09-shaped, mirroring classroom-groups.spec.ts's own "the accent
  // colour still meets the WCAG AA contrast floor" test: computes the REAL
  // painted contrast from live computed styles rather than trusting the
  // #8a6a10/#fff hex pair by eye. "Any tint you add must keep text on it
  // at AA" (this task's own constraint) applies to the pill's own
  // background just as much as the row's.
  for (const theme of THEMES)
    test(`${theme}: the pill text meets the WCAG AA contrast floor`, async ({
      page,
    }) => {
      await markAbsent(page);
      await emulateTheme(page, theme);
      const contrast = await contrastRatio(
        page.locator('.cg-absent-pill').first(),
      );
      expect(contrast).toBeGreaterThanOrEqual(4.5);
    });

  // Every locale (#423): the absent state shows the page's own copy.
  for (const path of localePaths('/classroom-groups'))
    test(
      `cards: no horizontal scroll at 320px once a student is marked absent -- ${path}`,
      { tag: '@emulated-viewport' },
      async ({ page }) => {
        await page.setViewportSize({ width: 320, height: 900 });
        await markAbsent(page, path);
        await expectNoHorizontalScroll(page);
      },
    );
});

// T-06 -- claimed by no task's own traceability line (checked: it appears
// only in the plan's stage-level rollup, docs/superpowers/plans/2026-08-06-
// classroom-groups-v2-stage-3-student-details.md line 13), yet Task 2 is
// unambiguously the task that first renders the together/apart columns at
// all. Picked up here rather than left for a task that never claims it.
test.describe('together/apart letters', () => {
  // The first entry of every list is the empty option, which since #249
  // carries the column's own name rather than an em dash -- a teacher could
  // not see what a collapsed dropdown was for. It is asserted as a member of
  // the exact set, not skipped: it is still an option and still leads.

  test('the dropdown grows as needed -- B appears once A is used', async ({
    page,
  }) => {
    await openRoster(page);
    await page.getByRole('button', { name: 'Add student' }).click();
    const row0 = page.locator('.cg-student').nth(0);
    const row1 = page.locator('.cg-student').nth(1);

    await expect(row0.getByLabel('Together').locator('option')).toHaveText([
      'Together',
      'A',
    ]);

    await row0.getByLabel('Together').selectOption('A');

    // Every row's own dropdown grows, not only the one A was just set on.
    await expect(row0.getByLabel('Together').locator('option')).toHaveText([
      'Together',
      'A',
      'B',
    ]);
    await expect(row1.getByLabel('Together').locator('option')).toHaveText([
      'Together',
      'A',
      'B',
    ]);
  });

  test('together and apart grow independently', async ({ page }) => {
    await openRoster(page);
    const row = page.locator('.cg-student').first();
    await row.getByLabel('Together').selectOption('A');
    // Apart has had nothing set on it yet, so it must still offer only A --
    // a shared counter across both fields would leak Together's own use
    // into Apart's own list.
    await expect(row.getByLabel('Apart').locator('option')).toHaveText([
      'Apart',
      'A',
    ]);
  });
});

// Global constraint, this stage (design spec section 11): "The roster
// is never persisted. Not localStorage, not sessionStorage, not the URL."
// A dedicated, exhaustive sweep across every roster operation is Task 10's
// own job (Y-01…Y-04) -- this is a lighter, standing proof that THIS task's
// own new code path (building a roster at all) does not write one, so a
// regression here is caught by the task that introduced the risk, not only
// by the one that audits the whole stage at the end.
test.describe('the roster is never persisted', () => {
  test('a typed name never reaches localStorage or sessionStorage', async ({
    page,
  }) => {
    await openRoster(page);
    await addSeveral(page, 2);
    await page
      .locator('.cg-student')
      .first()
      .getByLabel('Name')
      .fill('PrivacyProbeStudentName');
    await expectNothingStored(
      page,
      'after typing a name',
      'PrivacyProbeStudentName',
    );
  });
});

// L-06's own layout half (no scroll) is proven above; this is the two
// section headers a roster now gives something real to report -- design
// spec section 3's "every collapsed header reports its own state" rule,
// and Task 1's own deferred `dirty` e2e coverage (flagged in Task 1's own
// report as worth a deliberate look once Task 2 lands and setRoster gets
// its first real caller). `openRoster` is exactly that first caller.
test.describe('headers follow the roster, live', () => {
  test('the Student details header reports the roster once one exists', async ({
    page,
  }) => {
    await openRoster(page);
    await expect(page.locator('#cg-students-toggle')).toHaveText(
      'Student details · 1 added',
    );
  });

  test('and counts a named student once one is named', async ({ page }) => {
    await openRoster(page);
    await page.locator('.cg-student').first().getByLabel('Name').fill('Ana');
    await expect(page.locator('#cg-students-toggle')).toHaveText(
      'Student details · 1 named',
    );
  });

  // Task 1's own Step 3b test 2, deferred there because `openRoster` did
  // not exist yet -- picked up here now that it does. Test 1 of that same
  // step ("nothing to save yet" on load) is already covered by Stage 2's
  // classroom-groups-controls.spec.ts.
  test('a new roster is unsaved', async ({ page }) => {
    await openRoster(page);
    await expect(page.locator('#cg-io .state')).toHaveText(
      'unsaved changes — export to keep them',
    );
  });

  // "Any" change, one test per kind (#426). The single test that stood here
  // read one change, the first student added, from a roster that had never
  // been saved, so a comparison that saw only names, or only how many, still
  // passed. Each case starts from a SAVED roster of two (an export), so the
  // one change it makes is the only thing that can make it unsaved again.
  const ROSTER_CHANGES: ReadonlyArray<
    readonly [string, (page: import('@playwright/test').Page) => Promise<void>]
  > = [
    [
      'a name',
      (page) =>
        page.locator('.cg-student').first().getByLabel('Name').fill('Ana'),
    ],
    [
      'a number',
      (page) =>
        page
          .locator('.cg-student')
          .first()
          .getByLabel('#', { exact: true })
          .fill('9'),
    ],
    [
      'a sex',
      async (page) => {
        await page
          .locator('.cg-student')
          .first()
          .getByLabel('Sex')
          .selectOption('F');
      },
    ],
    [
      'an absence',
      (page) =>
        page.locator('.cg-student').first().getByLabel('Absent').check(),
    ],
    [
      'a together letter',
      async (page) => {
        await page
          .locator('.cg-student')
          .first()
          .getByLabel('Together')
          .selectOption('A');
      },
    ],
    [
      'an apart letter',
      async (page) => {
        await page
          .locator('.cg-student')
          .first()
          .getByLabel('Apart')
          .selectOption('A');
      },
    ],
    [
      'a student added',
      (page) => page.getByRole('button', { name: 'Add student' }).click(),
    ],
    [
      'a student removed',
      (page) =>
        page
          .locator('.cg-student')
          .first()
          .getByRole('button', { name: 'Remove' })
          .click(),
    ],
  ];
  for (const [change, make] of ROSTER_CHANGES)
    test(`${change} makes a saved roster unsaved`, async ({ page }) => {
      await openRoster(page);
      await addSeveral(page, 1);
      await page.locator('#cg-io-toggle').click();
      await downloadName(page, 'Export class list');
      const state = page.locator('#cg-io .state');
      await expect(state).toHaveText('nothing to save yet');
      await make(page);
      await expect(state).toHaveText('unsaved changes — export to keep them');
    });

  // Task 1's own Step 3b test 3, carried forward rather than lost: it
  // appeared in NEITHER Task 1's nor Task 2's own test list (both read in
  // full at the time -- see task-1-report.md and progress.md), because
  // "Clear all" did not exist until this task builds it (design spec
  // section 4, "Emptying the list"). It lands here now that it does.
  test('clearing the roster returns it to nothing to save', async ({
    page,
  }) => {
    await openRoster(page);
    await expect(page.locator('#cg-io .state')).toHaveText(
      'unsaved changes — export to keep them',
    );
    await page.getByRole('button', { name: 'Clear all' }).click();
    await expect(page.locator('#cg-io .state')).toHaveText(
      'nothing to save yet',
    );
  });
});

/**
 * Stage 3, Task 5: validation as it is typed. Traceability: R-04, R-05,
 * R-06, T-07 (design spec section 13 / test-traceability.md) -- R-07 and
 * T-08 (the matching engine-side refusals) are already proven by
 * grouping.test.ts; this is the PAGE half, catching the identical fact one
 * keystroke earlier, before the button is ever pressed.
 *
 * the uncommitted #9 task brief's own Step 3 snippet is reproduced below with one real
 * correction, not verbatim: its own "a gap warns but does not block" test
 * fills the FIRST (and, at that point, ONLY) roster row's number to '4' --
 * a one-student roster has no internal range to be missing a number FROM
 * (rosterWarnings measures gaps between the roster's own min and max; see
 * that function's own doc comment in src/lib/roster.ts, and its "does not
 * treat a roster starting above 1 as a gap" / "is quiet on a single-student
 * roster" unit tests), so that exact sequence produces no warning at all
 * under a correct implementation -- confirmed by running it before this fix
 * existed. Corrected here by adding one more student first, so editing the
 * SECOND row's number actually opens a gap (1, then 4 -- missing 2 and 3)
 * rather than merely renumbering the only row that exists.
 */
test.describe('validation as it is typed', () => {
  test('a duplicate number is refused as it is typed', async ({ page }) => {
    await openRoster(page);
    await page.getByRole('button', { name: 'Add student' }).click();
    await page.locator('.cg-student').nth(1).getByLabel('#').fill('1');
    await expect(page.getByText(/Number 1 is already used/)).toBeVisible();
    // and before the button is ever pressed
    await expect(
      page.getByRole('button', { name: 'Make groups' }),
    ).toBeDisabled();
  });

  test('a together-and-apart clash is refused as it is typed', async ({
    page,
  }) => {
    await openRoster(page);
    await page.getByRole('button', { name: 'Add student' }).click();
    const row0 = page.locator('.cg-student').nth(0);
    const row1 = page.locator('.cg-student').nth(1);
    await row0.getByLabel('Together').selectOption('A');
    await row1.getByLabel('Together').selectOption('A');
    await row0.getByLabel('Apart').selectOption('A');
    await row1.getByLabel('Apart').selectOption('A');
    await expect(
      page.getByText(/are kept together, so they cannot also be kept apart/),
    ).toBeVisible();
    await expect(
      page.getByRole('button', { name: 'Make groups' }),
    ).toBeDisabled();
  });

  test('a gap warns but does not block', async ({ page }) => {
    await openRoster(page);
    await page.getByRole('button', { name: 'Add student' }).click();
    await page.locator('.cg-student').nth(1).getByLabel('#').fill('4');
    await expect(page.getByText(/looks incomplete/)).toBeVisible();
    await giveEveryoneASex(page);
    const go = page.getByRole('button', { name: 'Make groups' });
    await expect(go).toBeEnabled();
    // And pressing it makes groups (#425): an enabled button that then
    // refused would still be a block.
    await go.click();
    await expect(page.locator('#cg-results .group').first()).toBeVisible();
  });

  // R-06 -- "…naming who already holds it" -- proven with a REAL typed
  // name, not only the "Student N" fallback the first test above exercises
  // (neither student there is ever named).
  test('a duplicate names the student who already holds the number, by name', async ({
    page,
  }) => {
    await openRoster(page);
    await page.locator('.cg-student').first().getByLabel('Name').fill('Eko');
    await page.getByRole('button', { name: 'Add student' }).click();
    await page.locator('.cg-student').nth(1).getByLabel('#').fill('1');
    await expect(
      page.getByText(
        'Number 1 is already used by Eko. Every student needs their own.',
      ),
    ).toBeVisible();
  });

  // This task's own central risk: a re-render mid-keystroke would steal the
  // focus and the caret out from under whoever is typing (roster-ui.ts's
  // own RosterHandlers doc comment). Every test above reads the message
  // AFTER the triggering edit, which would pass just as well whether or not
  // a re-render happened in between -- this is the one that actually proves
  // it did not: the SAME locator handle used to type is asserted still
  // focused, holding exactly what was typed, once the message is showing.
  test('the duplicate message appears without stealing focus or the caret from the field being typed in', async ({
    page,
  }) => {
    await openRoster(page);
    await page.getByRole('button', { name: 'Add student' }).click();
    const secondNumber = page.locator('.cg-student').nth(1).getByLabel('#');
    await secondNumber.fill('1');
    await expect(page.getByText(/Number 1 is already used/)).toBeVisible();
    await expect(secondNumber).toBeFocused();
    await expect(secondNumber).toHaveValue('1');
  });

  // Errors must be announced accessibly, not just shown -- the same rule
  // classroom-groups-announcements.spec.ts already proves for #cg-error.
  // role="alert" is what makes a screen reader interrupt with this the
  // moment it appears, matching that established pattern rather than a new
  // one for this notice.
  test('the duplicate refusal is announced accessibly, not just shown', async ({
    page,
  }) => {
    await openRoster(page);
    await page.getByRole('button', { name: 'Add student' }).click();
    await page.locator('.cg-student').nth(1).getByLabel('#').fill('1');
    await expect(page.locator('#cg-roster-problem')).toHaveAttribute(
      'role',
      'alert',
    );
    await expect(page.locator('#cg-roster-problem')).toBeVisible();
  });

  // The gap warning is announced too, but politely (role="status") rather
  // than as an interruption -- it is a non-blocking notice, not a refusal,
  // and "Make groups" stays enabled while it shows (proven above).
  test('the gap warning is announced politely, not as an alert', async ({
    page,
  }) => {
    await openRoster(page);
    await page.getByRole('button', { name: 'Add student' }).click();
    await page.locator('.cg-student').nth(1).getByLabel('#').fill('4');
    await expect(page.locator('#cg-roster-warning')).toHaveAttribute(
      'role',
      'status',
    );
  });

  // #332, the stale notice's twin. The warning paints its own cream ground
  // and took --ink, which Aurora made near-white: 1.05:1. Scored the way the
  // browser paints it, with the warning in its real state.
  // One test per theme (#418).
  for (const theme of THEMES)
    test(`${theme}: the gap warning meets the WCAG AA contrast floor`, async ({
      page,
    }) => {
      await openRoster(page);
      await page.getByRole('button', { name: 'Add student' }).click();
      await page.locator('.cg-student').nth(1).getByLabel('#').fill('4');
      const warning = page.locator('#cg-roster-warning');
      await expect(warning).toBeVisible();
      await expect(warning).toContainText('Your class list looks incomplete.');
      await emulateTheme(page, theme);
      expect(await contrastRatio(warning)).toBeGreaterThanOrEqual(4.5);
      await shoot(
        page,
        `${theme}: the gap warning on its cream ground`,
        warning,
      );
    });

  // The block is a COMPARISON, not a one-way latch -- the same "a
  // dirty/stale flag must be able to clear again" philosophy this page
  // already applies to `dirty` (classroom-groups.ts) and `staleReason`
  // (staleness.ts). Fixing the duplicate must re-enable the button, not
  // leave it disabled forever once a problem has ever existed.
  test('fixing the duplicate re-enables Make groups and clears the message', async ({
    page,
  }) => {
    await openRoster(page);
    await page.getByRole('button', { name: 'Add student' }).click();
    const secondNumber = page.locator('.cg-student').nth(1).getByLabel('#');
    await secondNumber.fill('1');
    await expect(
      page.getByRole('button', { name: 'Make groups' }),
    ).toBeDisabled();
    await secondNumber.fill('2');
    await expect(page.getByText(/Number 1 is already used/)).toBeHidden();
    await giveEveryoneASex(page);
    await expect(
      page.getByRole('button', { name: 'Make groups' }),
    ).toBeEnabled();
  });
});

/**
 * Stage 3, Task 6: adding, removing, and the two limits. Traceability:
 * R-08, B-06…B-09, X-02…X-06, X-08 (design spec section 4 /
 * test-traceability.md).
 *
 * task-6-brief.md's own Step 1 snippet is reproduced below with corrections
 * and additions, not verbatim:
 *  - Its own "Student details refuses to open above 100" test uses
 *    `page.getByLabel('How many students?')` -- that label does not exist
 *    on this page. The field's real accessible name is "Number of
 *    students" (`studentsLabel` in en.ts) -- the SAME correction
 *    classroom-groups.spec.ts and classroom-groups-controls.spec.ts each
 *    already made once for the identical brief mistake (see either file's
 *    own comment recording it).
 *  - B-09 ("Removing a row lowers it") is named by this task's own
 *    traceability line but is not exercised by any of the brief's five
 *    given tests at all -- picked up below in its own describe block,
 *    along with the identity question this task's own brief was explicit
 *    is not to be answered by assumption: removing a student must not
 *    renumber the others (design spec section 4's "gaps allowed... a
 *    number belongs to a student, not a position").
 *  - R-08's own traceability line names the design spec's literal example
 *    (1, 2, 3, 5 -> 6, a real GAP), which the brief's own "a new student
 *    takes one past the highest" test does not quite reproduce (it sets
 *    ONE student's number to 5 without first creating the 1/2/3 that make
 *    it a genuine gap rather than merely a highest value) -- reproduced
 *    literally as a second, additional test.
 */
test.describe('adding, removing, and the two limits', () => {
  test('Add several is inline — no dialog', async ({ page }) => {
    await openRoster(page);
    page.on('dialog', () => {
      throw new Error('a dialog was opened');
    });
    await page.getByRole('button', { name: 'Add several' }).click();
    await expect(page.getByLabel('How many to add?')).toBeVisible();
  });

  test('a new student takes one past the highest', async ({ page }) => {
    await openRoster(page);
    await page.locator('.cg-student').first().getByLabel('#').fill('5');
    await page.getByRole('button', { name: 'Add student' }).click();
    await expect(
      page.locator('.cg-student').nth(1).getByLabel('#'),
    ).toHaveValue('6');
  });

  // Not in the brief -- R-08's own literal example (design spec section 4,
  // "Numbers": "With 1, 2, 3 and 5 on the list the next student is 6, not
  // 4"), proving a REAL gap is not filled before a fresh highest.
  test('a new student takes one past the highest even across a real gap — 1, 2, 3, 5 then Add student gives 6', async ({
    page,
  }) => {
    await openRoster(page);
    await addSeveral(page, 3); // rows #1, 2, 3, 4
    await page.locator('.cg-student').nth(3).getByLabel('#').fill('5'); // now 1, 2, 3, 5 -- a real gap at 4
    await page.getByRole('button', { name: 'Add student' }).click();
    await expect(
      page.locator('.cg-student').nth(4).getByLabel('#'),
    ).toHaveValue('6');
  });

  test('both add controls disable at 100, stating the limit', async ({
    page,
  }) => {
    await openRoster(page);
    await addSeveral(page, 99);
    await expect(
      page.getByRole('button', { name: 'Add student' }),
    ).toBeDisabled();
    // Both (#426): this read Add student alone, and Add several could stay
    // live at the limit. Counted off the page, so a third add control fails
    // here until it is read too.
    await expect(page.locator('.cg-add-student, .cg-add-several')).toHaveCount(
      2,
    );
    await expect(
      page.getByRole('button', { name: 'Add several' }),
    ).toBeDisabled();
    await expect(
      page.getByText('Student details holds up to 100 students.'),
    ).toBeVisible();
  });

  // Not in the brief -- the OTHER add control must state the limit too,
  // proven independently rather than assumed from "Add student" above:
  // both are disabled by the SAME `rosterAtLimit` check (roster-ui.ts's
  // buildToolbar), but that is an implementation fact, not something this
  // suite is entitled to take on faith.
  test('Add several also disables at 100', async ({ page }) => {
    await openRoster(page);
    await addSeveral(page, 99);
    await expect(
      page.getByRole('button', { name: 'Add several' }),
    ).toBeDisabled();
  });

  test('Add several refuses a number that would cross the limit, saying how many are free', async ({
    page,
  }) => {
    await openRoster(page);
    await addSeveral(page, 89);
    await page.getByRole('button', { name: 'Add several' }).click();
    await page.getByLabel('How many to add?').fill('20');
    await page.getByRole('button', { name: 'Add', exact: true }).click();
    await expect(
      page.getByText('There is room for 10 more students.'),
    ).toBeVisible();
    await expect(page.locator('.cg-student')).toHaveCount(90);
  });

  // Corrected from the brief's own `getByLabel('How many students?')` --
  // see this describe block's own header comment.
  test('Student details refuses to open above 100, leaving the count alone', async ({
    page,
  }) => {
    await page.goto('/classroom-groups');
    await page.getByLabel('Number of students').fill('300');
    await page.locator('#cg-students-toggle').click();
    await expect(
      page.getByText(
        'Student details holds up to 100 students. Lower the number to list this class individually.',
      ),
    ).toBeVisible();
    await expect(page.locator('#cg-roster')).toHaveCount(0);
    await expect(page.getByLabel('Number of students')).toHaveValue('300');
    await giveEveryoneASex(page);
    await expect(
      page.getByRole('button', { name: 'Make groups' }),
    ).toBeEnabled();
  });

  // Not in the brief -- the refusal is a COMPARISON, not a one-way latch,
  // the same "comparison, not a flag" shape every other guard on this page
  // already keeps (dirty, staleReason, updateRosterValidation). Lowering
  // the count and clicking again must actually open the section, not stay
  // refused over a fact that is no longer true.
  test('lowering the count and reopening actually opens Student details', async ({
    page,
  }) => {
    await page.goto('/classroom-groups');
    await page.getByLabel('Number of students').fill('300');
    await page.locator('#cg-students-toggle').click();
    await expect(
      page.getByText('Student details holds up to 100 students.'),
    ).toBeVisible();
    await page.getByLabel('Number of students').fill('50');
    await page.locator('#cg-students-toggle').click();
    await expect(
      page.getByRole('button', { name: 'Add student' }),
    ).toBeVisible();
    await expect(
      page.getByText('Student details holds up to 100 students.'),
    ).toBeHidden();
  });
});

// B-09 ("Removing a row lowers it") and this task's own carried-forward
// risk: "make sure a pending, uncommitted text edit is not silently
// discarded when a row is added or removed elsewhere" (this task's own
// brief). None of these are in task-6-brief.md's own Step 1 snippet at all.
test.describe('removing a student', () => {
  test('removes the row and lowers the roster', async ({ page }) => {
    await openRoster(page);
    await addSeveral(page, 2); // three rows: 1, 2, 3
    await expect(page.locator('.cg-student')).toHaveCount(3);
    await page
      .locator('.cg-student')
      .nth(1)
      .getByRole('button', { name: 'Remove' })
      .click();
    await expect(page.locator('.cg-student')).toHaveCount(2);
  });

  // Identity is the number (this stage's own global constraint): removing
  // a student must not renumber the others. Removing the MIDDLE student of
  // 1, 2, 3 must leave 1 and 3 — a gap — never silently renumber the
  // survivor down to 2, which would quietly hand student #3's own together/
  // apart letters (or a future pin) to a different child.
  test('does not renumber the remaining students', async ({ page }) => {
    await openRoster(page);
    await addSeveral(page, 2); // three rows: 1, 2, 3
    await page
      .locator('.cg-student')
      .nth(1)
      .getByRole('button', { name: 'Remove' })
      .click();
    const rows = page.locator('.cg-student');
    await expect(rows).toHaveCount(2);
    await expect(rows.nth(0).getByLabel('#')).toHaveValue('1');
    await expect(rows.nth(1).getByLabel('#')).toHaveValue('3');
  });

  // The exact shape of bug this task's own brief named as a real risk: a
  // pending, uncommitted text edit on a DIFFERENT row (never itself
  // re-rendered — RosterHandlers.onTextChange's own doc comment,
  // roster-ui.ts) must survive a removal elsewhere in the table, not be
  // silently discarded by a stale render-time snapshot.
  test('removing one row does not discard an uncommitted text edit on another', async ({
    page,
  }) => {
    await openRoster(page);
    await addSeveral(page, 2); // three rows: 1, 2, 3
    const rows = page.locator('.cg-student');
    await rows.nth(0).getByLabel('Name').fill('Ana');
    await rows.nth(1).getByRole('button', { name: 'Remove' }).click();
    await expect(page.locator('.cg-student')).toHaveCount(2);
    await expect(
      page.locator('.cg-student').first().getByLabel('Name'),
    ).toHaveValue('Ana');
  });

  // Removing a row re-enables the add controls the moment the roster drops
  // back under the limit — the same "comparison, not a one-way latch"
  // shape design spec section 4's own refusals already keep elsewhere.
  test('removing a row at the limit re-enables the add controls', async ({
    page,
  }) => {
    await openRoster(page);
    await addSeveral(page, 99); // 100 rows -- at the limit
    await expect(
      page.getByRole('button', { name: 'Add student' }),
    ).toBeDisabled();
    await page
      .locator('.cg-student')
      .first()
      .getByRole('button', { name: 'Remove' })
      .click();
    await expect(page.locator('.cg-student')).toHaveCount(99);
    await expect(
      page.getByRole('button', { name: 'Add student' }),
    ).toBeEnabled();
    await expect(
      page.getByText('Student details holds up to 100 students.'),
    ).toBeHidden();
  });

  // Every locale (#423): the button's label is the page's own copy.
  for (const path of localePaths('/classroom-groups'))
    test(`the Remove button meets the 44px touch target -- ${path}`, async ({
      page,
    }) => {
      await openRoster(page, path);
      const { rosterRemove } = getStrings(localeFromPath(path));
      await atLeast44(
        page
          .locator('.cg-student')
          .first()
          .getByRole('button', { name: rosterRemove }),
        rosterRemove,
      );
    });
});

// Stage 3, Task 7 (design spec section 4, "The Students box -- an input,
// then a read-out"). Two things could have claimed to know the class size
// -- #cg-count and the roster -- and design spec section 4 resolves the
// mismatch by never letting both be in charge: the box is the input with no
// list, and becomes an untypeable read-out the instant one exists.
// task-7-brief.md's own Step 1 snippet used
// `page.getByLabel('How many students?')` throughout -- the same recurring
// mistake Tasks 1, 2, 5 and 6 already documented and corrected in this
// suite and its siblings; the real label is "Number of students"
// (`studentsLabel` in en.ts). Corrected here the same way, not reproduced
// verbatim.
test.describe('the Students box becomes a read-out', () => {
  test('typeable with no list; a read-out with one', async ({ page }) => {
    await page.goto('/classroom-groups');
    await expect(page.getByLabel('Number of students')).toBeEditable();
    await page.locator('#cg-students-toggle').click();
    await page.getByRole('button', { name: 'Add student' }).click();
    await expect(page.getByLabel('Number of students')).not.toBeEditable();
  });

  // #188, AC14. The list and the three number fields are never both in
  // charge either -- `studentsBoxLocked` is the one fact behind all four
  // controls, which is why the fields lock on exactly the same condition
  // `#cg-count` does, and recover on it too.
  test('the three number fields lock with the box, and recover with it', async ({
    page,
  }) => {
    const fields = ['absent', 'together', 'apart'].map((name) =>
      page.locator(`#cg-numbers-${name}`),
    );

    await page.goto('/classroom-groups');
    // Editable BEFORE a roster exists -- without this the assertions below
    // would hold against a page that had disabled them from the start.
    for (const field of fields) await expect(field).toBeEditable();
    await shoot(
      page,
      'all three fields editable with no list',
      page.locator('.number-fields'),
    );

    await openRoster(page);
    for (const field of fields) await expect(field).not.toBeEditable();
    await expect(
      page.getByText(
        'Set by your list. Mark absences and pairings in Student details to change them.',
      ),
    ).toBeVisible();
    await shoot(
      page,
      'locked by the list, with the reason shown',
      page.locator('.number-fields'),
    );

    await page.getByRole('button', { name: 'Clear all' }).click();
    for (const field of fields) await expect(field).toBeEditable();
    await shoot(
      page,
      'editable again once the list is cleared',
      page.locator('.number-fields'),
    );
  });

  // #390 F68. A locked field cannot be edited, so a refusal of what it holds
  // cannot hold the shuffle either: the list decides who is grouped. Until
  // F68 the button went on reading the locked fields, so a number refused
  // before the list existed kept "Make groups" disabled, described by a
  // paragraph that had just been hidden and emptied -- a button that will
  // not move and says nothing about why. Editing a row then re-showed the
  // refusal, because the form's `input` listener is delegated across the
  // roster table too. And the recovery direction: once the list is cleared,
  // the same text is refused again with its reason on screen, not left as a
  // silently disabled button.
  test('a locked number field neither holds the shuffle nor shows a refusal', async ({
    page,
  }) => {
    const go = page.getByRole('button', { name: 'Make groups' });
    const problem = page.locator('#cg-numbers-problem');
    await page.goto('/classroom-groups');

    // Refused FIRST, so the lock below is a transition away from a standing
    // refusal rather than a state the page started in.
    await page.fill('#cg-count', '25');
    await page.fill('#cg-numbers-absent', '26');
    await expect(problem).toBeVisible();
    await expect(go).toBeDisabled();

    await page.locator('#cg-students-toggle').click();
    await page.getByRole('button', { name: 'Add student' }).click();
    // The list's own rule, so that only the number fields could hold it.
    await giveEveryoneASex(page);
    await expect(page.locator('#cg-numbers-absent')).not.toBeEditable();
    await expect(problem).toHaveCount(1);
    await expect(problem).toBeHidden();
    await expect(go).toBeEnabled();
    await expect(go).not.toHaveAttribute('aria-describedby', /./);
    await shoot(
      page,
      'locked by the list, the earlier refusal no longer holds the shuffle',
      page.locator('.number-fields'),
    );

    // A keystroke in the roster reaches the form's delegated listener.
    await page
      .locator('#cg-roster tbody tr')
      .nth(0)
      .getByLabel('Name')
      .fill('Ana');
    await expect(problem).toBeHidden();
    await expect(go).toBeEnabled();

    await page.getByRole('button', { name: 'Clear all' }).click();
    await expect(page.locator('#cg-numbers-absent')).toBeEditable();
    await expect(problem).toBeVisible();
    await expect(problem).toHaveText(/^There is no number 26\./);
    await expect(go).toBeDisabled();
    await expect(go).toHaveAttribute('aria-describedby', 'cg-numbers-problem');
    await shoot(
      page,
      'unlocked again, the refusal returns with its reason',
      page.locator('.number-fields'),
    );
  });

  test('the reason is rendered, not implied', async ({ page }) => {
    await page.goto('/classroom-groups');
    await page.locator('#cg-students-toggle').click();
    await page.getByRole('button', { name: 'Add student' }).click();
    await expect(
      page.getByText(
        'Set by your list. Add or remove students in Student details to change it.',
      ),
    ).toBeVisible();
  });

  // The count these two build is 29, and it is DERIVED from the rows rather
  // than written down.
  //
  // The comment that stood here reasoned that 30 "shares nothing with" the
  // box's build-time default, which it recorded as `value="24"`. That was
  // true when it was written. The default has since moved to 30 -- the very
  // number both tests expected -- so all three `toHaveValue` checks passed
  // with `updateStudentsBox`'s write removed, and the prose explaining why
  // they were safe is what dated them (#193). A second literal would rot the
  // same way, so `expectStudentsBoxReports` reads the shipped default off the
  // element itself (`.value =` never rewrites the content attribute) and
  // refuses any expectation that cannot tell the two apart.
  test('emptying the list makes it typeable again, keeping the number', async ({
    page,
  }) => {
    await openRoster(page);
    await addSeveral(page, 28);
    const rows = page.locator('.cg-student');
    await expect(rows).toHaveCount(29);
    const built = await rows.count();

    const box = page.getByLabel('Number of students');
    await expectStudentsBoxReports(box, built);
    // The locked state is observed HERE, not borrowed from the test above,
    // because it is what makes the re-enable below a transition rather than a
    // state a script-less page satisfies on its own: `disabled` is only ever
    // set by script, so with no implementation the box is trivially editable
    // and `toBeEditable()` alone asserts nothing.
    await expect(box).not.toBeEditable();

    await page.getByRole('button', { name: 'Clear all' }).click();
    await expect(box).toBeEditable();
    await expectStudentsBoxReports(box, built);
  });

  test('marking a student absent does not move it', async ({ page }) => {
    await openRoster(page);
    await addSeveral(page, 28);
    const rows = page.locator('.cg-student');
    await expect(rows).toHaveCount(29);
    const built = await rows.count();

    const box = page.getByLabel('Number of students');
    // Read before AND after: "does not move it" is a claim about a change,
    // and one reading after the fact cannot tell an unmoved value from one
    // that was never right.
    await expectStudentsBoxReports(box, built);
    await rows.first().getByLabel('Absent').check();
    await expectStudentsBoxReports(box, built);

    await expect(page.locator('#cg-roster-count')).toHaveText(
      `${built} students · ${built - 1} here · 1 absent`,
    );
  });

  test('no sequence of operations makes the box disagree with the list', async ({
    page,
  }) => {
    await openRoster(page);
    for (const n of [5, 3, 11]) await addSeveral(page, n);
    await page
      .locator('.cg-student')
      .nth(2)
      .getByRole('button', { name: 'Remove' })
      .click();
    await page.locator('.cg-student').first().getByLabel('Absent').check();
    const rows = await page.locator('.cg-student').count();
    await expect(page.getByLabel('Number of students')).toHaveValue(
      String(rows),
    );
  });

  // Not in the brief -- X-08 ("there is no way to type the box past
  // MAX_ROSTER with a list present") was only HALF closed by Task 6, which
  // made neither add path able to push the roster past 100; this task's own
  // job is the other half, the box becoming untypeable at all. Proving that
  // holds AT the ceiling, not merely below it, is what actually closes
  // X-08 rather than leaving it true only by the accident of every other
  // test here using a small roster.
  test('even at the roster ceiling, the box is still a read-out, never typeable past it', async ({
    page,
  }) => {
    await openRoster(page);
    await addSeveral(page, 99); // 100 total -- MAX_ROSTER
    await expect(page.getByLabel('Number of students')).not.toBeEditable();
    await expect(page.getByLabel('Number of students')).toHaveValue('100');
  });

  // Not in the brief -- every other interactive control this table adds
  // gets its own measured touch-target test (see 'the Remove button meets
  // the 44px touch target'), so Clear all does too rather than trusting it
  // by inspection because it shares a CSS class with one that is measured.
  // Every locale (#423): the button's label is the page's own copy.
  for (const path of localePaths('/classroom-groups'))
    test(`the Clear all button meets the 44px touch target -- ${path}`, async ({
      page,
    }) => {
      await openRoster(page, path);
      const { rosterClearAll } = getStrings(localeFromPath(path));
      await atLeast44(
        page.getByRole('button', { name: rosterClearAll }),
        rosterClearAll,
      );
    });

  // Not in the brief -- design spec section 4's own example shows exactly
  // ONE explanatory line under a locked box ("Set by your list..."), and
  // `studentsHelp` ("Students are anonymous and numbered") stops being true
  // the moment a roster can hold a real name -- showing both at once would
  // show a teacher a claim this task's own change makes false.
  test('the anonymous-count help text steps aside for the reason, and returns once the list is gone', async ({
    page,
  }) => {
    await page.goto('/classroom-groups');
    await expect(
      page.getByText('Students are anonymous and numbered'),
    ).toBeVisible();
    await page.locator('#cg-students-toggle').click();
    await page.getByRole('button', { name: 'Add student' }).click();
    await expect(
      page.getByText('Students are anonymous and numbered'),
    ).toBeHidden();
    await page.getByRole('button', { name: 'Clear all' }).click();
    await expect(
      page.getByText('Students are anonymous and numbered'),
    ).toBeVisible();
  });
});

test.describe('Indonesian', () => {
  // Mirrors 'the table has seven columns, in order...', above -- the
  // seventh header's own text is 'Hapus' (rosterRemove, id.ts), the exact
  // word every row's own Remove button already carries.
  test('the table has seven columns, translated — the seventh (Remove/Hapus) has a real header too', async ({
    page,
  }) => {
    await openRoster(page, '/id/classroom-groups');
    await expect(page.locator('#cg-roster thead th')).toHaveText([
      'Tidak hadir',
      '#',
      'Nama',
      'Jenis kelamin',
      'Bersama',
      'Terpisah',
      'Hapus',
    ]);
  });

  test('an unnamed row renders Siswa N in the results', async ({ page }) => {
    await openRoster(page, '/id/classroom-groups');
    await giveEveryoneASex(page);
    await page.getByRole('button', { name: 'Buat Kelompok' }).click();
    await expect(page.locator('#cg-results')).toContainText('Siswa 1');
  });

  // Mirrors 'the count line reads students, here and absent', above --
  // task-4-brief.md's own instruction ("Mirror the last two on /id/").
  test('the count line reads siswa, hadir and tidak hadir', async ({
    page,
  }) => {
    await openRoster(page, '/id/classroom-groups');
    await addSeveral(page, 23);
    await page.locator('.cg-student').first().getByLabel('Tidak hadir').check();
    await page.locator('.cg-student').nth(1).getByLabel('Tidak hadir').check();
    await expect(page.locator('#cg-roster-count')).toHaveText(
      '24 siswa · 22 hadir · 2 tidak hadir',
    );
  });

  // Mirrors 'the word is never "away", anywhere', above -- same guard
  // against a stray, untranslated English word, run on the Indonesian page.
  test('the word is never "away", anywhere', async ({ page }) => {
    await openRoster(page, '/id/classroom-groups');
    await page.locator('.cg-student').first().getByLabel('Tidak hadir').check();
    // Three who are here, as in English (#425): with the only student absent
    // the page refused to group, and the results were never read.
    await addSeveral(page, 3);
    await giveEveryoneASex(page);
    await page.getByRole('button', { name: 'Buat Kelompok' }).click();
    await expect(page.locator('#cg-results .group').first()).toBeVisible();
    await expect(page.locator('body')).not.toContainText(/\baway\b/);
  });

  // Mirrors 'a duplicate number is refused as it is typed', above --
  // Stage 3, Task 5's own i18n requirement: the refusal is live in both
  // languages, not only English.
  test('a duplicate number is refused as it is typed, in Indonesian', async ({
    page,
  }) => {
    await openRoster(page, '/id/classroom-groups');
    await page.getByRole('button', { name: 'Tambah siswa' }).click();
    await page.locator('.cg-student').nth(1).getByLabel('#').fill('1');
    await expect(page.getByText(/Nomor 1 sudah dipakai/)).toBeVisible();
    await expect(
      page.getByRole('button', { name: 'Buat Kelompok' }),
    ).toBeDisabled();
  });

  // Mirrors 'a together-and-apart clash is refused as it is typed', above.
  test('a together-and-apart clash is refused as it is typed, in Indonesian', async ({
    page,
  }) => {
    await openRoster(page, '/id/classroom-groups');
    await page.getByRole('button', { name: 'Tambah siswa' }).click();
    const row0 = page.locator('.cg-student').nth(0);
    const row1 = page.locator('.cg-student').nth(1);
    await row0.getByLabel('Bersama').selectOption('A');
    await row1.getByLabel('Bersama').selectOption('A');
    await row0.getByLabel('Terpisah').selectOption('A');
    await row1.getByLabel('Terpisah').selectOption('A');
    await expect(
      page.getByText(/sudah ditandai untuk disatukan/),
    ).toBeVisible();
    await expect(
      page.getByRole('button', { name: 'Buat Kelompok' }),
    ).toBeDisabled();
  });

  // Mirrors 'a gap warns but does not block', above.
  test('a gap warns but does not block, in Indonesian', async ({ page }) => {
    await openRoster(page, '/id/classroom-groups');
    await page.getByRole('button', { name: 'Tambah siswa' }).click();
    await page.locator('.cg-student').nth(1).getByLabel('#').fill('4');
    await expect(page.getByText(/tampak belum lengkap/)).toBeVisible();
    await giveEveryoneASex(page);
    const go = page.getByRole('button', { name: 'Buat Kelompok' });
    await expect(go).toBeEnabled();
    // And pressing it makes groups, as in English (#425).
    await go.click();
    await expect(page.locator('#cg-results .group').first()).toBeVisible();
  });

  // Stage 3, Task 6's own i18n requirement. Mirrors 'Student details
  // refuses to open above 100, leaving the count alone', above.
  test('Student details refuses to open above 100, in Indonesian', async ({
    page,
  }) => {
    await page.goto('/id/classroom-groups');
    await page.getByLabel('Jumlah siswa').fill('300');
    await page.locator('#cg-students-toggle').click();
    await expect(
      page.getByText(
        'Detail siswa menampung hingga 100 siswa. Turunkan angkanya untuk mendaftar kelas ini satu per satu.',
      ),
    ).toBeVisible();
    await expect(page.locator('#cg-roster')).toHaveCount(0);
    await expect(page.getByLabel('Jumlah siswa')).toHaveValue('300');
    await giveEveryoneASex(page);
    await expect(
      page.getByRole('button', { name: 'Buat Kelompok' }),
    ).toBeEnabled();
  });

  // Mirrors 'both add controls disable at 100, stating the limit', above.
  test('both add controls disable at 100, in Indonesian', async ({ page }) => {
    await openRoster(page, '/id/classroom-groups');
    await addSeveral(page, 99);
    await expect(
      page.getByRole('button', { name: 'Tambah siswa' }),
    ).toBeDisabled();
    // Both, as in English (#426).
    await expect(page.locator('.cg-add-student, .cg-add-several')).toHaveCount(
      2,
    );
    await expect(
      page.getByRole('button', { name: 'Tambah beberapa' }),
    ).toBeDisabled();
    await expect(
      page.getByText('Detail siswa menampung hingga 100 siswa.'),
    ).toBeVisible();
  });

  // Mirrors 'Add several refuses a number that would cross the limit...',
  // above.
  test('Add several refuses a number that would cross the limit, in Indonesian', async ({
    page,
  }) => {
    await openRoster(page, '/id/classroom-groups');
    await addSeveral(page, 89);
    await page.getByRole('button', { name: 'Tambah beberapa' }).click();
    await page.getByLabel('Berapa yang ditambahkan?').fill('20');
    await page.getByRole('button', { name: 'Tambah', exact: true }).click();
    await expect(
      page.getByText('Masih ada ruang untuk 10 siswa lagi.'),
    ).toBeVisible();
    await expect(page.locator('.cg-student')).toHaveCount(90);
  });

  // Mirrors 'removes the row and lowers the roster', above.
  test('removing a row lowers the roster, in Indonesian', async ({ page }) => {
    await openRoster(page, '/id/classroom-groups');
    await addSeveral(page, 2);
    await page
      .locator('.cg-student')
      .nth(1)
      .getByRole('button', { name: 'Hapus' })
      .click();
    await expect(page.locator('.cg-student')).toHaveCount(2);
  });

  // Mirrors 'typeable with no list; a read-out with one' / 'the reason is
  // rendered, not implied' / 'emptying the list...' above, in one test --
  // Stage 3, Task 7's own copy (studentsLockedReason, rosterClearAll) in
  // Indonesian. 'Hapus semua' is scoped to nothing here (no `.cg-student`
  // row locator), unlike the per-row 'Hapus' button just above -- Clear all
  // lives in the toolbar, not any one row, so the two never collide even
  // though 'Hapus' is a literal substring of 'Hapus semua'.
  test('the Students box becomes a read-out, and Hapus semua returns it, in Indonesian', async ({
    page,
  }) => {
    await page.goto('/id/classroom-groups');
    await expect(page.getByLabel('Jumlah siswa')).toBeEditable();
    await page.locator('#cg-students-toggle').click();
    await page.getByRole('button', { name: 'Tambah siswa' }).click();
    await expect(page.getByLabel('Jumlah siswa')).not.toBeEditable();
    await expect(
      page.getByText(
        'Ditentukan oleh daftar Anda. Tambah atau hapus siswa di Detail siswa untuk mengubahnya.',
      ),
    ).toBeVisible();
    await page.getByRole('button', { name: 'Hapus semua' }).click();
    await expect(page.getByLabel('Jumlah siswa')).toBeEditable();
    await expect(page.getByLabel('Jumlah siswa')).toHaveValue('1');
  });
});

/**
 * Stage 3, Task 3: the card layout, and proving it is the same thing.
 * Traceability: F-01, F-03, F-04, F-06, F-07, L-06 (design spec section 13 /
 * docs/superpowers/plans/2026-08-06-classroom-groups-v2-test-traceability.md).
 *
 * task-3-brief.md's own Traceability line also names F-05 ("the absent tint,
 * stripe and pill all appear on the card, not only the row"). Not claimed
 * here: the tint/stripe/pill do not exist yet on EITHER shape -- Task 2's own
 * comment at the top of this file already deferred them to "a later task"
 * (traceability A-05…A-09), and the traceability matrix's own F-05 row is
 * still unticked. `.cg-student` being one element in both layouts (this
 * task's whole point) is what will make F-05 fall out for free the moment a
 * later task styles absence on it -- no separate card-specific work will be
 * needed then -- but that is that task's row to tick, not this one's.
 *
 * task-3-brief.md's own Step 1 snippet is reproduced below with two
 * corrections, not verbatim:
 *  - Every test that calls `page.setViewportSize` is tagged
 *    `@emulated-viewport`, per this stage's own global-constraints.md
 *    ("Any test that resizes the viewport must be tagged") -- the brief's
 *    literal code has no tag, which `tests/unit/viewport-tagging.test.ts`
 *    (a hard guard, not a style preference) would fail on: a real phone
 *    cannot resize itself, so an untagged resize test would run, and fail
 *    for a false reason, on `android-chrome`/`ios-safari`.
 *  - The "no horizontal scroll" test calls the existing `addSeveral` helper
 *    (already imported above, already every other test in this file's own
 *    way of driving "+ Add several…") instead of reproducing its three
 *    clicks inline, as the brief's own snippet does.
 */
const LAYOUTS = [
  { name: 'cards', width: 320 },
  { name: 'table', width: 1280 },
] as const;

for (const { name, width } of LAYOUTS) {
  test(
    `${name}: every control is present with the same value`,
    { tag: '@emulated-viewport' },
    async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      await openRoster(page);
      const row = page.locator('.cg-student').first();
      // Read off the row, then compared with the six columns as a set (#390
      // F133): a hand list of five never named the number field, so either
      // layout could lose it and pass.
      const controls = row.locator('input, select');
      await expect(controls).toHaveCount(6);
      const names = await controls.evaluateAll((all) =>
        all.map((c) => c.getAttribute('aria-label')),
      );
      expect(names.sort()).toEqual(
        ['#', 'Name', 'Sex', 'Absent', 'Together', 'Apart'].sort(),
      );
      for (const control of await controls.all())
        await expect(control).toBeVisible();
    },
  );

  test(
    `${name}: editing every field works`,
    { tag: '@emulated-viewport' },
    async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      await openRoster(page);
      const row = page.locator('.cg-student').first();
      // All six (#390 F133): this edited four, never the number or Apart.
      await row.getByLabel('#', { exact: true }).fill('7');
      await row.getByLabel('Name').fill('Ana');
      await row.getByLabel('Sex').selectOption('F');
      await row.getByLabel('Together').selectOption('A');
      await row.getByLabel('Apart').selectOption('A');
      await row.getByLabel('Absent').check();
      await expect(row.getByLabel('#', { exact: true })).toHaveValue('7');
      await expect(row.getByLabel('Name')).toHaveValue('Ana');
      await expect(row.getByLabel('Sex')).toHaveValue('F');
      await expect(row.getByLabel('Together')).toHaveValue('A');
      await expect(row.getByLabel('Apart')).toHaveValue('A');
      await expect(row.getByLabel('Absent')).toBeChecked();
    },
  );
}

// A second, related defect found via the SAME investigation as the loop
// above's "editing every field works" (task-3-brief.md's own Step 1 test,
// unmodified): two DIFFERENT rows' own text edits, NEITHER of which
// re-renders on its own (`RosterHandlers`' own doc comment, roster-ui.ts --
// "avoiding focus/caret theft"), used to stomp each other, because every
// row built in one render shared the identical stale `roster` snapshot --
// the second row's own patch was computed from a base that did not yet
// know about the first row's edit, discarding it the moment the second
// landed. Not part of the brief's own Step 1 (which only ever edits one
// row at a time); added because the fix for the first bug (roster-ui.ts's
// own `liveRoster`) fixes this one for free, and an unpinned fix is one
// that can regress silently.
test('editing two different rows by text, neither of which re-renders on its own, does not lose either', async ({
  page,
}) => {
  await openRoster(page);
  await addSeveral(page, 1);
  const rows = page.locator('.cg-student');
  await rows.nth(0).getByLabel('Name').fill('Ana');
  await rows.nth(1).getByLabel('Name').fill('Budi');
  await expect(rows.nth(0).getByLabel('Name')).toHaveValue('Ana');
  await expect(rows.nth(1).getByLabel('Name')).toHaveValue('Budi');
});

// Every locale (#423): the card's other controls carry localised
// placeholders, and they share the row with the name field.
for (const path of localePaths('/classroom-groups'))
  test(
    `cards: the name field takes the full remaining width -- ${path}`,
    { tag: '@emulated-viewport' },
    async ({ page }) => {
      await page.setViewportSize({ width: 320, height: 900 });
      await openRoster(page, path);
      const { rosterColName } = getStrings(localeFromPath(path));
      const card = (await page.locator('.cg-student').first().boundingBox())!;
      const name = (await page
        .locator('.cg-student')
        .first()
        .getByLabel(rosterColName, { exact: true })
        .boundingBox())!;
      expect(name.width).toBeGreaterThan(card.width * 0.6);
    },
  );

// L-06, re-homed from stage 2: that stage could not open Student details
// because it had no body, so the row was untestable there. Every locale
// (#423): each row's controls and the count carry the page's own copy.
for (const path of localePaths('/classroom-groups'))
  test(
    `cards: no horizontal scroll at 320px with 100 students -- ${path}`,
    { tag: '@emulated-viewport' },
    async ({ page }) => {
      await page.setViewportSize({ width: 320, height: 900 });
      await openRoster(page, path);
      await addSeveral(page, 99);
      await expectNoHorizontalScroll(page);
    },
  );

/**
 * #249. The three roster dropdowns each carried a correct `aria-label` and
 * showed a bare em dash until something was chosen. A screen reader was told
 * what every one of them was for; a sighted teacher was not. Reviewing #188's
 * evidence the operator wrote: "the dropdown boxes that have '-' as the
 * default. we should fix this to show what the drop down box is actually for.
 * there's no label or anything."
 *
 * `aria-label` renders no pixels. The guard above asks "does this control
 * have a name?" and the operator asked "can I see what it is for?" -- two
 * different questions, and only one of them had a test. It is the same shape
 * as this repo's `display: flex` defect, where `textContent` was right for a
 * whole release while the rendering was wrong.
 *
 * The empty option now carries the column's OWN header key, so the control
 * and the heading above it cannot drift apart and no catalogue gains a key.
 * Print is deliberately NOT included: a class list on paper keeps the em dash
 * for an empty cell, which `classroom-groups-print.spec.ts` holds up.
 */
test.describe('an unset roster dropdown says which column it is for', () => {
  const PLACEHOLDER_COLUMNS = ['Sex', 'Together', 'Apart'];

  test('every unset dropdown shows its own column name', async ({ page }) => {
    await openRoster(page);
    const row = page.locator('.cg-student').first();

    // Derived from the row, never listed: a fourth dropdown added next year
    // is covered the day it appears. Written as an EQUALITY rather than a
    // findings-and-control pair, so an emptied roster cannot pass it either
    // -- there is no population here that can quietly become zero.
    const shown = await row.evaluate((el) =>
      [...el.querySelectorAll('select')].map((select) => [
        select.getAttribute('aria-label') ?? '(no aria-label)',
        select.selectedOptions[0]?.textContent ?? '(nothing selected)',
      ]),
    );

    expect(shown).toEqual([
      ['Sex', 'Sex'],
      ['Together', 'Together'],
      ['Apart', 'Apart'],
    ]);

    // The control is what a teacher can see; an <option> is never itself
    // visible while the list is shut, so visibility is asserted on the select
    // and the painted text on the option it is showing. `toHaveText` alone
    // passes on a control the page forgot to show (#188).
    for (const column of PLACEHOLDER_COLUMNS) {
      const select = row.getByLabel(column);
      await expect(select).toBeVisible();
      await expect(select).toHaveValue('');
      await expect(select.locator('option:checked')).toHaveText(column);
    }

    await shoot(page, 'Every unset roster dropdown names its own column', row);
  });

  test('choosing a value replaces the placeholder with the value', async ({
    page,
  }) => {
    await openRoster(page);
    const row = page.locator('.cg-student').first();

    await row.getByLabel('Sex').selectOption('F');
    await row.getByLabel('Together').selectOption('A');

    await expect(row.getByLabel('Sex').locator('option:checked')).toHaveText(
      'F',
    );
    await expect(
      row.getByLabel('Together').locator('option:checked'),
    ).toHaveText('A');

    // Apart was left alone, so it still names its column -- which also shows
    // the placeholder is per-control and not a property of the whole row.
    await expect(row.getByLabel('Apart').locator('option:checked')).toHaveText(
      'Apart',
    );
  });

  /**
   * The visible text is the entire point of this ticket, and `textContent` is
   * blind to whether the box can paint it. At 390px `Together` rendered as
   * `Toge` with every assertion above still green -- the same shape as this
   * repo's `display: flex` defect, where the text was right for a whole
   * release and the rendering was wrong. So measure the label against the box
   * that has to draw it, at every width the page is used at.
   *
   * `#cg-roster select` sets `appearance: none` and reserves the drawn
   * arrow's room with `padding-right: 1.6rem`, so the computed padding read
   * here already accounts for it -- there is no native chrome left to guess.
   */
  // Every locale (#390 F113): a column name is the very text whose width
  // varies by language, and this measured English alone. One test per locale
  // per width (#418), so each has its own budget and a park names exactly the
  // cases that do not fit. 768px is where the card layout gives way to the
  // table, so both layouts are measured, and 600px and 430px sit inside the
  // card band that used to be the table's.
  const TRUNCATION_WIDTHS = [320, 375, 390, 430, 600, 768, 1024, 1280];
  /**
   * Where a column name does not fit today (#409), measured on CI's platform
   * (the pinned Linux image, all five engines) when this split was made.
   * Expected to FAIL there, not skipped: the day the layout is fixed the case
   * goes red and its entry has to go, so the park cannot outlive its fix.
   * CI run 36965820730 failed exactly these five cases on every engine,
   * so an entry names the case and holds for all five.
   */
  const DOES_NOT_FIT_YET: ReadonlySet<string> = new Set([
    '/id/classroom-groups 320',
    '/id/classroom-groups 768',
    '/id/classroom-groups 1024',
    '/id/classroom-groups 1280',
    '/vi/classroom-groups 768',
  ]);
  for (const path of localePaths('/classroom-groups'))
    for (const width of TRUNCATION_WIDTHS)
      test(
        `no dropdown ever truncates its own column name -- ${path} at ${width}px`,
        { tag: '@emulated-viewport' },
        async ({ page }) => {
          test.fail(
            DOES_NOT_FIT_YET.has(`${path} ${width}`),
            'a column name does not fit here yet (#409)',
          );
          await page.setViewportSize({ width, height: 900 });
          await openRoster(page, path);
          const row = page.locator('.cg-student').first();
          const boxes = await row.evaluate((el) =>
            [...el.querySelectorAll('select')].map((select) => {
              const style = getComputedStyle(select);
              const probe = document.createElement('span');
              probe.style.cssText =
                'position:absolute;visibility:hidden;white-space:pre';
              probe.style.font = style.font;
              probe.textContent = select.selectedOptions[0]?.textContent ?? '';
              document.body.appendChild(probe);
              const textWidth = probe.getBoundingClientRect().width;
              probe.remove();
              const chrome =
                parseFloat(style.paddingLeft) +
                parseFloat(style.paddingRight) +
                parseFloat(style.borderLeftWidth) +
                parseFloat(style.borderRightWidth);
              return {
                label: select.getAttribute('aria-label') ?? '(unlabelled)',
                shows: select.selectedOptions[0]?.textContent ?? '',
                box: Math.round(select.getBoundingClientRect().width),
                needs: Math.round(textWidth + chrome),
              };
            }),
          );

          const findings = boxes
            .filter((box) => box.needs > box.box)
            .map(
              (box) =>
                `${box.label}: shows "${box.shows}" in ${box.box}px, needs ${box.needs}px`,
            );
          expect(
            searched(findings, {
              of: boxes.map((box) => box.label),
              what: 'roster dropdowns measured',
            }),
          ).toEqual([]);
        },
      );

  test("the empty option keeps each column's own behaviour", async ({
    page,
  }) => {
    await openRoster(page);
    const row = page.locator('.cg-student').first();
    const placeholder = (column: string) =>
      row.getByLabel(column).locator('option[value=""]');

    // While nothing is chosen every placeholder can be selected.
    for (const column of PLACEHOLDER_COLUMNS) {
      await expect(placeholder(column)).toBeEnabled();
    }

    await row.getByLabel('Sex').selectOption('F');
    await row.getByLabel('Together').selectOption('A');

    // Sex is one-way by design (operator, 2026-08-13): the placeholder says
    // "not answered yet" and is not itself an answer, so it stops being
    // selectable once answered. Together and Apart are not one-way -- a
    // teacher must be able to clear a pairing letter.
    await expect(placeholder('Sex')).toBeDisabled();
    await expect(placeholder('Together')).toBeEnabled();
    await expect(placeholder('Apart')).toBeEnabled();
  });
});

test.describe('the roster dropdowns are still reachable by thumb (#249)', () => {
  // Every locale (#423): the placeholders ARE the localised copy, and each
  // language's column names differ in width.
  for (const path of localePaths('/classroom-groups'))
    test(
      `every roster control meets the 44px touch target with a placeholder showing -- ${path}`,
      { tag: '@emulated-viewport' },
      async ({ page }) => {
        // #249 put a WORD where a dash used to be, and a `<select>` sizes
        // itself to its widest option. The existing 44px sweep
        // ('every control meets the 44px touch target',
        // classroom-groups-controls.spec.ts) measures `#cg-form` only, and runs
        // before any roster exists -- so nothing had ever measured these three.
        //
        // Measured with the placeholder SHOWING, which is the state this ticket
        // created: a chosen value is one or two characters, the placeholder is
        // a whole column name, and only the wider one can push a row.
        await page.setViewportSize({ width: 375, height: 900 });
        await openRoster(page, path);
        await addSeveral(page, 3);

        const controls = page.locator(
          '#cg-roster tbody tr select, #cg-roster tbody tr input',
        );
        // Liveness is the controls MEASURED, which is the rendered ones. A
        // `controls.count()` beside it counted every match, hidden ones too,
        // so a roster whose controls all stopped rendering measured nothing
        // and passed (#446). Three rows carry controls, so an empty set here
        // is a broken selector or a page that hides them.
        const measured = await controls.evaluateAll((els) =>
          els
            // `getClientRects()`, never the element's own computed display: a
            // `display: none` ANCESTOR leaves a descendant's computed display
            // untouched, so a per-element check reports hidden content as
            // rendered.
            .filter((el) => el.getClientRects().length > 0)
            .map((el) => {
              // A checkbox is deliberately small: the LABEL around it is the
              // tap target, the same convention as `.switch` and every radio
              // on this page ('the two sex switches meet the 44px touch
              // target once open', classroom-groups-controls.spec.ts).
              // Measuring the raw input reports a defect the page does not
              // have -- it read 20.8px here before this was written.
              const target =
                el instanceof HTMLInputElement && el.type === 'checkbox'
                  ? (el.closest('label') ?? el)
                  : el;
              return {
                what: `${el.tagName.toLowerCase()}[${
                  el.getAttribute('aria-label') ?? el.id ?? '?'
                }]`,
                height:
                  Math.round(target.getBoundingClientRect().height * 10) / 10,
              };
            }),
        );
        const small = measured.filter((c) => c.height < 44);

        expect(
          searched(small, {
            of: measured,
            what: 'rendered roster controls',
          }),
          small.map((c) => `${c.what} is ${c.height}px`).join('\n'),
        ).toEqual([]);
      },
    );
});

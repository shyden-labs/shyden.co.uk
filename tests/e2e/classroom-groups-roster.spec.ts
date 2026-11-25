import { chooseOption } from '../real-select';
import { setCheckedOn, tapOn } from '../real-touch';
import { typeInto } from '../real-typing';
import { test, expect } from './fixtures';
import { eachWidth } from '../each-width';
import { recorded, shoot } from './evidence';
import { recordErrors } from './recorders';
import { searched } from '../source-files';
import { localePaths } from './locale-sampling';
import { THEMES } from '../palette';
import { emulateTheme } from '../themes';
import { contrast, parseColour } from '../wcag';
import { getStrings, localeFromPath } from '../../src/lib/i18n';
import {
  atLeast44Soft,
  expectNoHorizontalScroll,
  expectNoScrollSoft,
  rectAtLeast44Soft,
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
import { atViewport } from '../viewport-at';

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
  // (`.visually-hidden`, tokens.css): a
  // screen reader building this table's column headers finds a real name
  // for every one of the seven, while a sighted teacher never sees a
  // printed "Remove" heading sitting above a column of seven identical
  // "Remove" buttons repeating the same word.
  // The headers, the header/column parity and the unnamed row are one visit
  // to the page: the header reads come first, before anything is pressed, and
  // the unnamed row is read last, after Make groups is pressed.
  test('the table has seven columns, in order — the seventh (Remove) has a real header, visually hidden but present; every column has a header; an unnamed row renders Student N in the results', async ({
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
    await expect.soft(page.locator('#cg-roster thead th')).toHaveText(columns);
    // `toHaveText` reads `textContent`, which a heading hidden with
    // `display: none` still carries, so it cannot say whether a screen reader
    // gets a name for each column. The accessibility tree can. Every heading
    // stays in it whatever hides it from sight: the whole row in the card
    // layout, and Remove's own text in the table layout (#200).
    const headers = page.locator('#cg-roster').getByRole('columnheader');
    await expect.soft(headers).toHaveCount(columns.length);
    for (const [index, name] of columns.entries()) {
      await expect.soft(headers.nth(index)).toHaveAccessibleName(name);
    }
    await shoot(
      page,
      'every heading keeps its name; the table draws six, the cards draw none',
      page.locator('#cg-roster'),
    );

    // The general invariant "the table has seven columns" above pins today.
    // This is the one that stops it drifting again: derived from the DOM on
    // BOTH sides (colgroup's own <col> count, thead's own <th> count),
    // never a hard-coded number, so an eighth column added later without
    // its own header -- or a header added without its own column -- fails
    // here regardless of what the actual count turns out to be.
    const columnCount = await page.locator('#cg-roster colgroup col').count();
    const headerCount = await page.locator('#cg-roster thead th').count();
    expect.soft(headerCount).toBe(columnCount);

    await giveEveryoneASex(page);
    await tapOn(page.getByRole('button', { name: 'Make groups' }));
    await expect.soft(page.locator('#cg-results')).toContainText('Student 1');
  });

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
  // Every locale (#423): the dropdowns show localised placeholders (#249),
  // the Remove and Clear all buttons carry the page's own copy, and the
  // table's column widths come from its localised column names. The three
  // measure the same page at the same width, so each locale walks it once;
  // the widths are measured first, before a second student and a typed name
  // change the row.
  for (const path of localePaths('/classroom-groups'))
    test(`per-row controls meet the 44px touch target, and so do Remove and Clear all; an empty name box is exactly as wide as a full one -- ${path}`, async ({
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
        await atLeast44Soft(row.getByLabel(label, { exact: true }), label);
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
      expect
        .soft(Math.round(number.height), '# height')
        .toBeGreaterThanOrEqual(44);
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
      rectAtLeast44Soft(absent, 'Absent (label)');
      // The buttons are labelled by the page's own copy.
      await atLeast44Soft(
        row.getByRole('button', { name: t.rosterRemove }),
        t.rosterRemove,
      );
      await atLeast44Soft(
        page.getByRole('button', { name: t.rosterClearAll }),
        t.rosterClearAll,
      );

      // Last, because it adds a second student and types into the first.
      await tapOn(
        page.getByRole('button', { name: t.rosterAddStudent, exact: true }),
      );
      const nameBox = (index: number) =>
        page
          .locator('#cg-roster tbody tr')
          .nth(index)
          .getByLabel(t.rosterColName, { exact: true });
      await typeInto(nameBox(0), 'Sebastianus');
      const a = (await nameBox(0).boundingBox())!;
      const b = (await nameBox(1).boundingBox())!;
      expect.soft(b.width).toBeCloseTo(a.width, 0);
    });

  test('a long name does not push the letters out of view', async ({
    page,
  }) => {
    await atViewport(page, { width: 1280, height: 900 });
    await openRoster(page);
    await typeInto(
      page.locator('#cg-roster tbody tr').nth(0).getByLabel('Name'),
      'Maria Anastasia Wijayanti',
    );
    await expectNoHorizontalScroll(page);
  });

  test('no console errors while building a roster', async ({ page }) => {
    const reported = recordErrors(page);

    await openRoster(page);
    await addSeveral(page, 3);
    const row = page.locator('.cg-student').first();
    await typeInto(row.getByLabel('Name'), 'Ana');
    await chooseOption(row.getByLabel('Sex'), 'F');
    await setCheckedOn(row.getByLabel('Absent'));
    await chooseOption(row.getByLabel('Together'), 'A');
    await giveEveryoneASex(page);
    await tapOn(page.getByRole('button', { name: 'Make groups' }));
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
  test('assigned 1, 2, 3… in the order rows are added; a new student takes one past the highest; the teacher may override a number, and a later add still takes one past the highest', async ({
    page,
  }) => {
    await openRoster(page);
    await tapOn(page.getByRole('button', { name: 'Add student' }));
    await tapOn(page.getByRole('button', { name: 'Add student' }));
    // Individually, not `toHaveValue(['1','2','3'])` against the whole
    // multi-element locator -- unlike `toHaveText`, `toHaveValue` is a
    // single-element (strict-mode) matcher and does not accept an array for
    // a locator resolving to more than one node.
    const rows = page.locator('.cg-student');
    await expect.soft(rows.nth(0).getByLabel('#')).toHaveValue('1');
    await expect.soft(rows.nth(1).getByLabel('#')).toHaveValue('2');
    await expect.soft(rows.nth(2).getByLabel('#')).toHaveValue('3');

    // A student takes one past the highest: with the first row at 5, the
    // next add is 6.
    const first = rows.first().getByLabel('#');
    await typeInto(first, '5');
    await tapOn(page.getByRole('button', { name: 'Add student' }));
    await expect.soft(rows.nth(3).getByLabel('#')).toHaveValue('6');

    // The teacher may override a number (R-02).
    await typeInto(first, '50');
    await expect.soft(first).toHaveValue('50');
    // Proves the override reached the actual roster, not just the visible
    // input: the next student added takes one past 50, not one past 6.
    await tapOn(page.getByRole('button', { name: 'Add student' }));
    await expect.soft(rows.nth(4).getByLabel('#')).toHaveValue('51');
  });
});

// A-01: the Absent column, and ticking it marking a student out. The tint,
// stripe and pill it also carries (design spec section 4) are a later
// task's own job (traceability A-05…A-09) -- this proves the functional
// consequence the column exists for.
test.describe('absence', () => {
  test('ticking Absent excludes that student from the results; nothing in the row is disabled by ticking it', async ({
    page,
  }) => {
    await openRoster(page);
    await tapOn(page.getByRole('button', { name: 'Add student' }));
    const row = page.locator('.cg-student').first();
    await setCheckedOn(row.getByLabel('Absent'));
    for (const label of ['Name', 'Sex', 'Together', 'Apart']) {
      await expect.soft(row.getByLabel(label), label).toBeEnabled();
    }
    await giveEveryoneASex(page);
    await tapOn(page.getByRole('button', { name: 'Make groups' }));
    await expect
      .soft(page.locator('#cg-results'))
      .not.toContainText('Student 1');
    await expect.soft(page.locator('#cg-results')).toContainText('Student 2');
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
 *  - Every test that resizes the viewport goes through `atViewport` (#1046),
 *    which the brief's own snippet does not; none of the brief's own six
 *    actually resize the viewport.
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
  test('and every field can still be edited; is still readable with colour removed', async ({
    page,
  }) => {
    await markAbsent(page);
    const row = page.locator('.cg-student').first();
    // All five of the row's other fields (#426): this edited two, so an
    // absent row that locked its number or its letters still passed.
    // Absent itself is the field that made the row absent. Counted off the
    // row, so a seventh field fails here until it is edited below too.
    await expect.soft(row.locator('input, select')).toHaveCount(6);
    await typeInto(row.getByLabel('#', { exact: true }), '7');
    await typeInto(row.getByLabel('Name'), 'Dewi');
    await chooseOption(row.getByLabel('Sex'), 'F');
    await chooseOption(row.getByLabel('Together'), 'A');
    await chooseOption(row.getByLabel('Apart'), 'A');
    await expect.soft(row.getByLabel('#', { exact: true })).toHaveValue('7');
    await expect.soft(row.getByLabel('Name')).toHaveValue('Dewi');
    await expect.soft(row.getByLabel('Sex')).toHaveValue('F');
    await expect.soft(row.getByLabel('Together')).toHaveValue('A');
    await expect.soft(row.getByLabel('Apart')).toHaveValue('A');

    // Colour removed last, so the edits above are made on the page as it is
    // drawn.
    await page.addStyleTag({
      content: 'html { filter: grayscale(1) !important }',
    });
    await expect.soft(row.getByLabel('Absent')).toBeChecked();
    await expect.soft(row.locator('.cg-absent-pill')).toHaveText('absent');
  });

  // One test per theme (#418). The tint and the pill's contrast are two reads
  // of the same absent row in the same theme.
  //
  // L-09-shaped, mirroring classroom-groups.spec.ts's own "the accent
  // colour still meets the WCAG AA contrast floor" test: the contrast is the
  // REAL painted contrast from live computed styles rather than the
  // #8a6a10/#fff hex pair trusted by eye. "Any tint you add must keep text on
  // it at AA" (this task's own constraint) applies to the pill's own
  // background just as much as the row's.
  for (const theme of THEMES)
    test(`${theme}: is tinted, striped and labelled; the pill text meets the WCAG AA contrast floor; every select's arrow meets 3:1`, async ({
      page,
    }) => {
      await markAbsent(page);
      const row = page.locator('.cg-student').first();
      await emulateTheme(page, theme);
      await expect
        .soft(row)
        .toHaveCSS('background-color', 'rgb(255, 246, 227)');
      await expect.soft(row.locator('.cg-absent-pill')).toHaveText('absent');
      const pillContrast = await contrastRatio(
        page.locator('.cg-absent-pill').first(),
      );
      expect.soft(pillContrast).toBeGreaterThanOrEqual(4.5);

      // #390 F21: the arrow drawn on each select (the native one is reset for
      // WebKit's touch target) is a non-text control part, so WCAG 1.4.11's
      // 3:1 applies, in this theme. A colour baked into a data-URI cannot
      // follow the theme and reads as no colour at all here.
      for (const select of [
        row.locator('select').first(),
        page.locator('#cg-speed'),
      ]) {
        const { image, ground } = await select.evaluate((el) => {
          const style = getComputedStyle(el);
          return {
            image: style.backgroundImage,
            ground: style.backgroundColor,
          };
        });
        const paint = (image.match(/rgba?\([^)]*\)/g) ?? [])
          .map(parseColour)
          .filter((c): c is NonNullable<typeof c> => !!c && c.alpha > 0);
        const behind = parseColour(ground);
        expect
          .soft(paint.length, `a colour the arrow is drawn in: ${image}`)
          .toBeGreaterThan(0);
        expect.soft(behind?.alpha, `an opaque ground: ${ground}`).toBe(1);
        for (const ink of paint)
          if (behind)
            expect
              .soft(contrast(ink.rgb, behind.rgb), `${image} on ${ground}`)
              .toBeGreaterThanOrEqual(3);
      }
    });

  test('the consequence line is there before anyone is marked; the count line reads students, here and absent', async ({
    page,
  }) => {
    await openRoster(page);
    // Before anyone is marked.
    await expect
      .soft(
        page.getByText(
          'Students marked absent are not included when groups are made.',
        ),
      )
      .toBeVisible();
    await addSeveral(page, 23);
    await setCheckedOn(
      page.locator('.cg-student').first().getByLabel('Absent'),
    );
    await setCheckedOn(page.locator('.cg-student').nth(1).getByLabel('Absent'));
    await expect
      .soft(page.locator('#cg-roster-count'))
      .toHaveText('24 students · 22 here · 2 absent');
  });

  test('the word is never "away", anywhere', async ({ page }) => {
    await markAbsent(page);
    // Three who are here (#425): with the only student absent the page
    // refused to group, so "anywhere" never included the results.
    await addSeveral(page, 3);
    await giveEveryoneASex(page);
    await tapOn(page.getByRole('button', { name: 'Make groups' }));
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
      test(`${name}, ${theme}: absence carries the tint, the stripe and the pill -- same element as the table`, async ({
        page,
      }) => {
        await atViewport(page, { width, height: 900 });
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
      });
    }
});

// Global constraint, this stage (design spec section 11): "The roster
// is never persisted. Not localStorage, not sessionStorage, not the URL."
// A dedicated, exhaustive sweep across every roster operation is Task 10's
// own job (Y-01…Y-04) -- this is a lighter, standing proof that THIS task's
// own new code path (building a roster at all) does not write one, so a
// regression here is caught by the task that introduced the risk, not only
// by the one that audits the whole stage at the end.
test.describe('the roster is never persisted', () => {
  test('a typed name never reaches localStorage or sessionStorage; editing two different rows by text, neither of which re-renders on its own, does not lose either', async ({
    page,
  }) => {
    await openRoster(page);
    await addSeveral(page, 2);
    const rows = page.locator('.cg-student');
    // A second, related defect found via the SAME investigation as the
    // layouts loop's "editing every field works" (task-3-brief.md's own
    // Step 1 test, unmodified): two DIFFERENT rows' own text edits, NEITHER
    // of which re-renders on its own (`RosterHandlers`' own doc comment,
    // roster-ui.ts -- "avoiding focus/caret theft"), used to stomp each
    // other, because every row built in one render shared the identical
    // stale `roster` snapshot -- the second row's own patch was computed from
    // a base that did not yet know about the first row's edit, discarding it
    // the moment the second landed. Not part of the brief's own Step 1
    // (which only ever edits one row at a time); added because the fix for
    // the first bug (roster-ui.ts's own `liveRoster`) fixes this one for
    // free, and an unpinned fix is one that can regress silently.
    await typeInto(rows.nth(0).getByLabel('Name'), 'Ana');
    await typeInto(rows.nth(1).getByLabel('Name'), 'Budi');
    await expect.soft(rows.nth(0).getByLabel('Name')).toHaveValue('Ana');
    await expect.soft(rows.nth(1).getByLabel('Name')).toHaveValue('Budi');
    // The probe goes into the third row, so the two edits above are not
    // typed over.
    await typeInto(rows.nth(2).getByLabel('Name'), 'PrivacyProbeStudentName');
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
  // One visit, read in the order the roster changes. Task 1's own Step 3b
  // tests 2 and 3, deferred there because `openRoster` did not exist yet and
  // because "Clear all" did not exist until Task 7 built it (design spec
  // section 4, "Emptying the list"), are picked up here. Test 1 of that same
  // step ("nothing to save yet" on load) is already covered by Stage 2's
  // classroom-groups-controls.spec.ts.
  test('the Student details header reports the roster once one exists; and counts a named student once one is named; a new roster is unsaved; clearing the roster returns it to nothing to save', async ({
    page,
  }) => {
    await openRoster(page);
    const toggle = page.locator('#cg-students-toggle');
    const state = page.locator('#cg-io .state');
    await expect.soft(toggle).toHaveText('Student details · 1 added');
    // A new roster is unsaved.
    await expect
      .soft(state)
      .toHaveText('unsaved changes — export to keep them');
    await typeInto(
      page.locator('.cg-student').first().getByLabel('Name'),
      'Ana',
    );
    await expect.soft(toggle).toHaveText('Student details · 1 named');
    // Still unsaved, with a name in it, until the list is cleared.
    await expect
      .soft(state)
      .toHaveText('unsaved changes — export to keep them');
    await tapOn(page.getByRole('button', { name: 'Clear all' }));
    await expect.soft(state).toHaveText('nothing to save yet');
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
        typeInto(page.locator('.cg-student').first().getByLabel('Name'), 'Ana'),
    ],
    [
      'a number',
      (page) =>
        typeInto(
          page.locator('.cg-student').first().getByLabel('#', { exact: true }),
          '9',
        ),
    ],
    [
      'a sex',
      async (page) => {
        await chooseOption(
          page.locator('.cg-student').first().getByLabel('Sex'),
          'F',
        );
      },
    ],
    [
      'an absence',
      (page) =>
        setCheckedOn(page.locator('.cg-student').first().getByLabel('Absent')),
    ],
    [
      'a together letter',
      async (page) => {
        await chooseOption(
          page.locator('.cg-student').first().getByLabel('Together'),
          'A',
        );
      },
    ],
    [
      'an apart letter',
      async (page) => {
        await chooseOption(
          page.locator('.cg-student').first().getByLabel('Apart'),
          'A',
        );
      },
    ],
    [
      'a student added',
      (page) => tapOn(page.getByRole('button', { name: 'Add student' })),
    ],
    [
      'a student removed',
      (page) =>
        tapOn(
          page
            .locator('.cg-student')
            .first()
            .getByRole('button', { name: 'Remove' }),
        ),
    ],
  ];
  for (const [change, make] of ROSTER_CHANGES)
    test(`${change} makes a saved roster unsaved`, async ({ page }) => {
      await openRoster(page);
      await addSeveral(page, 1);
      await tapOn(page.locator('#cg-io-toggle'));
      await downloadName(page, 'Export class list');
      const state = page.locator('#cg-io .state');
      await expect(state).toHaveText('nothing to save yet');
      await make(page);
      await expect(state).toHaveText('unsaved changes — export to keep them');
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
  // One duplicate, read every way it is read. Its message comes first and the
  // focus is read straight after it, with nothing pressed in between.
  //
  // R-06 -- "…naming who already holds it" -- is proven with a REAL typed
  // name, not only the "Student N" fallback.
  //
  // This task's own central risk: a re-render mid-keystroke would steal the
  // focus and the caret out from under whoever is typing (roster-ui.ts's
  // own RosterHandlers doc comment). Reading the message AFTER the triggering
  // edit would pass just as well whether or not a re-render happened in
  // between -- the focus check is the one that actually proves it did not:
  // the SAME locator handle used to type is asserted still focused, holding
  // exactly what was typed, once the message is showing.
  //
  // Errors must be announced accessibly, not just shown -- the same rule
  // classroom-groups-announcements.spec.ts already proves for #cg-error.
  // role="alert" is what makes a screen reader interrupt with this the
  // moment it appears.
  //
  // The block is a COMPARISON, not a one-way latch -- the same "a
  // dirty/stale flag must be able to clear again" philosophy this page
  // already applies to `dirty` (classroom-groups.ts) and `staleReason`
  // (staleness.ts). Fixing the duplicate must re-enable the button, not
  // leave it disabled forever once a problem has ever existed.
  test('a duplicate number is refused as it is typed -- by name, without stealing focus or the caret, announced as an alert, and fixing it re-enables Make groups and clears the message', async ({
    page,
  }) => {
    await openRoster(page);
    await typeInto(
      page.locator('.cg-student').first().getByLabel('Name'),
      'Eko',
    );
    await tapOn(page.getByRole('button', { name: 'Add student' }));
    const secondNumber = page.locator('.cg-student').nth(1).getByLabel('#');
    await typeInto(secondNumber, '1');
    await expect.soft(page.getByText(/Number 1 is already used/)).toBeVisible();
    await expect
      .soft(
        page.getByText(
          'Number 1 is already used by Eko. Every student needs their own.',
        ),
      )
      .toBeVisible();
    // and before the button is ever pressed
    await expect
      .soft(page.getByRole('button', { name: 'Make groups' }))
      .toBeDisabled();
    await expect
      .soft(page.locator('#cg-roster-problem'))
      .toHaveAttribute('role', 'alert');
    await expect.soft(page.locator('#cg-roster-problem')).toBeVisible();
    // The message is showing, and the field typed in still has the focus and
    // exactly what was typed.
    await expect.soft(page.getByText(/Number 1 is already used/)).toBeVisible();
    await expect.soft(secondNumber).toBeFocused();
    await expect.soft(secondNumber).toHaveValue('1');
    // Still refused, now that the message and the focus have been read.
    await expect
      .soft(page.getByRole('button', { name: 'Make groups' }))
      .toBeDisabled();
    await typeInto(secondNumber, '2');
    await expect.soft(page.getByText(/Number 1 is already used/)).toBeHidden();
    await giveEveryoneASex(page);
    await expect
      .soft(page.getByRole('button', { name: 'Make groups' }))
      .toBeEnabled();
  });

  // The gap warning is announced too, but politely (role="status") rather
  // than as an interruption -- it is a non-blocking notice, not a refusal,
  // and "Make groups" stays enabled while it shows. The clash is read on the
  // same two rows once the groups are made: every student has a sex by then,
  // so it is the clash alone that keeps "Make groups" disabled.
  test('a gap warns but does not block, announced politely, not as an alert; a together-and-apart clash is refused as it is typed', async ({
    page,
  }) => {
    await openRoster(page);
    await tapOn(page.getByRole('button', { name: 'Add student' }));
    await typeInto(page.locator('.cg-student').nth(1).getByLabel('#'), '4');
    await expect.soft(page.getByText(/looks incomplete/)).toBeVisible();
    await expect
      .soft(page.locator('#cg-roster-warning'))
      .toHaveAttribute('role', 'status');
    await giveEveryoneASex(page);
    const go = page.getByRole('button', { name: 'Make groups' });
    await expect.soft(go).toBeEnabled();
    // And pressing it makes groups (#425): an enabled button that then
    // refused would still be a block.
    await tapOn(go);
    await expect.soft(page.locator('#cg-results .group').first()).toBeVisible();

    const row0 = page.locator('.cg-student').nth(0);
    const row1 = page.locator('.cg-student').nth(1);
    await chooseOption(row0.getByLabel('Together'), 'A');
    await chooseOption(row1.getByLabel('Together'), 'A');
    await chooseOption(row0.getByLabel('Apart'), 'A');
    await chooseOption(row1.getByLabel('Apart'), 'A');
    await expect
      .soft(
        page.getByText(/are kept together, so they cannot also be kept apart/),
      )
      .toBeVisible();
    // The press above renamed the button, so it is read by its id here.
    await expect.soft(page.locator('#cg-go')).toBeDisabled();
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
      await tapOn(page.getByRole('button', { name: 'Add student' }));
      await typeInto(page.locator('.cg-student').nth(1).getByLabel('#'), '4');
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
  // Add several, inline, builds the four rows of "1, 2, 3, 5": no dialog is
  // opened along the way.
  //
  // Not in the brief -- R-08's own literal example (design spec section 4,
  // "Numbers": "With 1, 2, 3 and 5 on the list the next student is 6, not
  // 4"), proving a REAL gap is not filled before a fresh highest.
  test('Add several is inline — no dialog; a new student takes one past the highest even across a real gap — 1, 2, 3, 5 then Add student gives 6', async ({
    page,
  }) => {
    await openRoster(page);
    page.on('dialog', () => {
      throw new Error('a dialog was opened');
    });
    await tapOn(page.getByRole('button', { name: 'Add several' }));
    await expect.soft(page.getByLabel('How many to add?')).toBeVisible();
    await typeInto(page.getByLabel('How many to add?'), '3');
    await tapOn(page.getByRole('button', { name: 'Add', exact: true }));
    // rows #1, 2, 3, 4
    await typeInto(page.locator('.cg-student').nth(3).getByLabel('#'), '5'); // now 1, 2, 3, 5 -- a real gap at 4
    await tapOn(page.getByRole('button', { name: 'Add student' }));
    await expect
      .soft(page.locator('.cg-student').nth(4).getByLabel('#'))
      .toHaveValue('6');
  });

  // Both add controls disable at 100 and state the limit. Not in the brief --
  // the OTHER add control must state the limit too, proven independently
  // rather than assumed from "Add student": both are disabled by the SAME
  // `rosterAtLimit` check (roster-ui.ts's buildToolbar), but that is an
  // implementation fact, not something this suite is entitled to take on
  // faith.
  //
  // Not in the brief -- X-08 ("there is no way to type the box past
  // MAX_ROSTER with a list present") was only HALF closed by Task 6, which
  // made neither add path able to push the roster past 100; Task 7's own job
  // is the other half, the box becoming untypeable at all. Proving that
  // holds AT the ceiling, not merely below it, is what actually closes
  // X-08 rather than leaving it true only by the accident of every other
  // test here using a small roster.
  //
  // Removing a row re-enables the add controls the moment the roster drops
  // back under the limit -- the same "comparison, not a one-way latch"
  // shape design spec section 4's own refusals already keep elsewhere.
  test('both add controls disable at 100, stating the limit; the Students box is still a read-out at the roster ceiling, never typeable past it; removing a row at the limit re-enables the add controls', async ({
    page,
  }) => {
    await openRoster(page);
    await addSeveral(page, 99); // 100 rows -- at the limit
    await expect
      .soft(page.getByRole('button', { name: 'Add student' }))
      .toBeDisabled();
    // Both (#426): this read Add student alone, and Add several could stay
    // live at the limit. Counted off the page, so a third add control fails
    // here until it is read too.
    await expect
      .soft(page.locator('.cg-add-student, .cg-add-several'))
      .toHaveCount(2);
    await expect
      .soft(page.getByRole('button', { name: 'Add several' }))
      .toBeDisabled();
    await expect
      .soft(page.getByText('Student details holds up to 100 students.'))
      .toBeVisible();
    await expect.soft(page.getByLabel('Number of students')).not.toBeEditable();
    await expect.soft(page.getByLabel('Number of students')).toHaveValue('100');
    // Read again at the end of the stay at the limit, before the row goes.
    await expect
      .soft(page.getByRole('button', { name: 'Add student' }))
      .toBeDisabled();
    await expect
      .soft(page.getByRole('button', { name: 'Add several' }))
      .toBeDisabled();
    await tapOn(
      page
        .locator('.cg-student')
        .first()
        .getByRole('button', { name: 'Remove' }),
    );
    await expect.soft(page.locator('.cg-student')).toHaveCount(99);
    await expect
      .soft(page.getByRole('button', { name: 'Add student' }))
      .toBeEnabled();
    await expect
      .soft(page.getByText('Student details holds up to 100 students.'))
      .toBeHidden();
  });

  test('Add several refuses a number that would cross the limit, saying how many are free', async ({
    page,
  }) => {
    await openRoster(page);
    await addSeveral(page, 89);
    await tapOn(page.getByRole('button', { name: 'Add several' }));
    await typeInto(page.getByLabel('How many to add?'), '20');
    await tapOn(page.getByRole('button', { name: 'Add', exact: true }));
    await expect(
      page.getByText('There is room for 10 more students.'),
    ).toBeVisible();
    await expect(page.locator('.cg-student')).toHaveCount(90);
  });

  // Corrected from the brief's own `getByLabel('How many students?')` --
  // see this describe block's own header comment.
  //
  // The refusal is a COMPARISON, not a one-way latch, the same "comparison,
  // not a flag" shape every other guard on this page already keeps (dirty,
  // staleReason, updateRosterValidation). Lowering the count and clicking
  // again must actually open the section, not stay refused over a fact that
  // is no longer true.
  test('Student details refuses to open above 100, leaving the count alone; lowering the count and reopening actually opens Student details', async ({
    page,
  }) => {
    await page.goto('/classroom-groups');
    await typeInto(page.getByLabel('Number of students'), '300');
    await tapOn(page.locator('#cg-students-toggle'));
    await expect
      .soft(
        page.getByText(
          'Student details holds up to 100 students. Lower the number to list this class individually.',
        ),
      )
      .toBeVisible();
    await expect
      .soft(page.getByText('Student details holds up to 100 students.'))
      .toBeVisible();
    await expect.soft(page.locator('#cg-roster')).toHaveCount(0);
    await expect.soft(page.getByLabel('Number of students')).toHaveValue('300');
    await giveEveryoneASex(page);
    await expect
      .soft(page.getByRole('button', { name: 'Make groups' }))
      .toBeEnabled();
    await typeInto(page.getByLabel('Number of students'), '50');
    await tapOn(page.locator('#cg-students-toggle'));
    await expect
      .soft(page.getByRole('button', { name: 'Add student' }))
      .toBeVisible();
    await expect
      .soft(page.getByText('Student details holds up to 100 students.'))
      .toBeHidden();
  });
});

// B-09 ("Removing a row lowers it") and this task's own carried-forward
// risk: "make sure a pending, uncommitted text edit is not silently
// discarded when a row is added or removed elsewhere" (this task's own
// brief). None of these are in task-6-brief.md's own Step 1 snippet at all.
test.describe('removing a student', () => {
  // Identity is the number (this stage's own global constraint): removing
  // a student must not renumber the others. Removing the MIDDLE student of
  // 1, 2, 3 must leave 1 and 3 — a gap — never silently renumber the
  // survivor down to 2, which would quietly hand student #3's own together/
  // apart letters (or a future pin) to a different child.
  //
  // And the exact shape of bug this task's own brief named as a real risk: a
  // pending, uncommitted text edit on a DIFFERENT row (never itself
  // re-rendered — RosterHandlers.onTextChange's own doc comment,
  // roster-ui.ts) must survive a removal elsewhere in the table, not be
  // silently discarded by a stale render-time snapshot. The edit is typed
  // before the removal, so the one removal is read all three ways.
  test('removes the row and lowers the roster; does not renumber the remaining students; does not discard an uncommitted text edit on another', async ({
    page,
  }) => {
    await openRoster(page);
    await addSeveral(page, 2); // three rows: 1, 2, 3
    await expect.soft(page.locator('.cg-student')).toHaveCount(3);
    const rows = page.locator('.cg-student');
    await typeInto(rows.nth(0).getByLabel('Name'), 'Ana');
    await tapOn(rows.nth(1).getByRole('button', { name: 'Remove' }));
    await expect.soft(page.locator('.cg-student')).toHaveCount(2);
    await expect.soft(rows).toHaveCount(2);
    await expect.soft(rows.nth(0).getByLabel('#')).toHaveValue('1');
    await expect.soft(rows.nth(1).getByLabel('#')).toHaveValue('3');
    await expect.soft(page.locator('.cg-student')).toHaveCount(2);
    await expect
      .soft(page.locator('.cg-student').first().getByLabel('Name'))
      .toHaveValue('Ana');
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
  // One visit, read around one list: how the page looks before it, with it
  // and once it is cleared. #188, AC14: the list and the three number fields
  // are never both in charge either -- `studentsBoxLocked` is the one fact
  // behind all four controls, which is why the fields lock on exactly the
  // same condition `#cg-count` does, and recover on it too.
  //
  // Not in the brief -- design spec section 4's own example shows exactly
  // ONE explanatory line under a locked box ("Set by your list..."), and
  // `studentsHelp` ("Students are anonymous and numbered") stops being true
  // the moment a roster can hold a real name -- showing both at once would
  // show a teacher a claim this task's own change makes false.
  test('typeable with no list; a read-out with one; the three number fields lock with the box, and recover with it; the reason is rendered, not implied; the anonymous-count help text steps aside for the reason, and returns once the list is gone', async ({
    page,
  }) => {
    const box = page.getByLabel('Number of students');
    const help = page.getByText('Students are anonymous and numbered');
    const fields = ['absent', 'together', 'apart'].map((name) =>
      page.locator(`#cg-numbers-${name}`),
    );

    await page.goto('/classroom-groups');
    await expect.soft(box).toBeEditable();
    await expect.soft(help).toBeVisible();
    // Editable BEFORE a roster exists -- without this the assertions below
    // would hold against a page that had disabled them from the start.
    for (const field of fields) await expect.soft(field).toBeEditable();
    await shoot(
      page,
      'all three fields editable with no list',
      page.locator('.number-fields'),
    );

    await tapOn(page.locator('#cg-students-toggle'));
    await tapOn(page.getByRole('button', { name: 'Add student' }));
    await expect.soft(box).not.toBeEditable();
    for (const field of fields) await expect.soft(field).not.toBeEditable();
    await expect
      .soft(
        page.getByText(
          'Set by your list. Mark absences and pairings in Student details to change them.',
        ),
      )
      .toBeVisible();
    await expect
      .soft(
        page.getByText(
          'Set by your list. Add or remove students in Student details to change it.',
        ),
      )
      .toBeVisible();
    await expect.soft(help).toBeHidden();
    await shoot(
      page,
      'locked by the list, with the reason shown',
      page.locator('.number-fields'),
    );

    await tapOn(page.getByRole('button', { name: 'Clear all' }));
    for (const field of fields) await expect.soft(field).toBeEditable();
    await expect.soft(help).toBeVisible();
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
    await typeInto(page.locator('#cg-count'), '25');
    await typeInto(page.locator('#cg-numbers-absent'), '26');
    await expect(problem).toBeVisible();
    await expect(go).toBeDisabled();

    await tapOn(page.locator('#cg-students-toggle'));
    await tapOn(page.getByRole('button', { name: 'Add student' }));
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
    await typeInto(
      page.locator('#cg-roster tbody tr').nth(0).getByLabel('Name'),
      'Ana',
    );
    await expect(problem).toBeHidden();
    await expect(go).toBeEnabled();

    await tapOn(page.getByRole('button', { name: 'Clear all' }));
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

  // One list of 29, read three ways. The count it builds is 29, and it is
  // DERIVED from the rows rather than written down.
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
  test('emptying the list makes it typeable again, keeping the number; marking a student absent does not move it', async ({
    page,
  }) => {
    await openRoster(page);
    await addSeveral(page, 28);
    const rows = page.locator('.cg-student');
    await expect.soft(rows).toHaveCount(29);
    const built = await rows.count();

    const box = page.getByLabel('Number of students');
    await expectStudentsBoxReports(box, built);
    // The locked state is observed HERE, not borrowed from another test,
    // because it is what makes the re-enable below a transition rather than a
    // state a script-less page satisfies on its own: `disabled` is only ever
    // set by script, so with no implementation the box is trivially editable
    // and `toBeEditable()` alone asserts nothing.
    await expect.soft(box).not.toBeEditable();

    // Marking a student absent does not move the number. Read before AND
    // after: "does not move it" is a claim about a change, and one reading
    // after the fact cannot tell an unmoved value from one that was never
    // right.
    await expect.soft(rows).toHaveCount(29);
    await expectStudentsBoxReports(box, built);
    await setCheckedOn(rows.first().getByLabel('Absent'));
    await expectStudentsBoxReports(box, built);
    await expect
      .soft(page.locator('#cg-roster-count'))
      .toHaveText(`${built} students · ${built - 1} here · 1 absent`);

    await tapOn(page.getByRole('button', { name: 'Clear all' }));
    await expect.soft(box).toBeEditable();
    await expectStudentsBoxReports(box, built);
  });

  test('no sequence of operations makes the box disagree with the list', async ({
    page,
  }) => {
    await openRoster(page);
    for (const n of [5, 3, 11]) await addSeveral(page, n);
    await tapOn(
      page
        .locator('.cg-student')
        .nth(2)
        .getByRole('button', { name: 'Remove' }),
    );
    await setCheckedOn(
      page.locator('.cg-student').first().getByLabel('Absent'),
    );
    const rows = await page.locator('.cg-student').count();
    await expect(page.getByLabel('Number of students')).toHaveValue(
      String(rows),
    );
  });
});

test.describe('Indonesian', () => {
  // Mirrors 'the table has seven columns, in order...', above -- the
  // seventh header's own text is 'Hapus' (rosterRemove, id.ts), the exact
  // word every row's own Remove button already carries. The unnamed row is
  // read last, after Make groups is pressed, as in English.
  test('the table has seven columns, translated — the seventh (Remove/Hapus) has a real header too; an unnamed row renders Siswa N in the results', async ({
    page,
  }) => {
    await openRoster(page, '/id/classroom-groups');
    await expect
      .soft(page.locator('#cg-roster thead th'))
      .toHaveText([
        'Tidak hadir',
        '#',
        'Nama',
        'Jenis kelamin',
        'Bersama',
        'Terpisah',
        'Hapus',
      ]);
    await giveEveryoneASex(page);
    await tapOn(page.getByRole('button', { name: 'Buat Kelompok' }));
    await expect.soft(page.locator('#cg-results')).toContainText('Siswa 1');
  });

  // Mirrors 'the count line reads students, here and absent', above --
  // task-4-brief.md's own instruction ("Mirror the last two on /id/").
  test('the count line reads siswa, hadir and tidak hadir', async ({
    page,
  }) => {
    await openRoster(page, '/id/classroom-groups');
    await addSeveral(page, 23);
    await setCheckedOn(
      page.locator('.cg-student').first().getByLabel('Tidak hadir'),
    );
    await setCheckedOn(
      page.locator('.cg-student').nth(1).getByLabel('Tidak hadir'),
    );
    await expect(page.locator('#cg-roster-count')).toHaveText(
      '24 siswa · 22 hadir · 2 tidak hadir',
    );
  });

  // Mirrors 'the word is never "away", anywhere', above -- same guard
  // against a stray, untranslated English word, run on the Indonesian page.
  test('the word is never "away", anywhere', async ({ page }) => {
    await openRoster(page, '/id/classroom-groups');
    await setCheckedOn(
      page.locator('.cg-student').first().getByLabel('Tidak hadir'),
    );
    // Three who are here, as in English (#425): with the only student absent
    // the page refused to group, and the results were never read.
    await addSeveral(page, 3);
    await giveEveryoneASex(page);
    await tapOn(page.getByRole('button', { name: 'Buat Kelompok' }));
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
    await tapOn(page.getByRole('button', { name: 'Tambah siswa' }));
    await typeInto(page.locator('.cg-student').nth(1).getByLabel('#'), '1');
    await expect(page.getByText(/Nomor 1 sudah dipakai/)).toBeVisible();
    await expect(
      page.getByRole('button', { name: 'Buat Kelompok' }),
    ).toBeDisabled();
  });

  // Mirrors 'a gap warns but does not block' and 'a together-and-apart clash
  // is refused as it is typed', above, in one visit as there.
  test('a gap warns but does not block, in Indonesian; a together-and-apart clash is refused as it is typed, in Indonesian', async ({
    page,
  }) => {
    await openRoster(page, '/id/classroom-groups');
    await tapOn(page.getByRole('button', { name: 'Tambah siswa' }));
    await typeInto(page.locator('.cg-student').nth(1).getByLabel('#'), '4');
    await expect.soft(page.getByText(/tampak belum lengkap/)).toBeVisible();
    await giveEveryoneASex(page);
    const go = page.getByRole('button', { name: 'Buat Kelompok' });
    await expect.soft(go).toBeEnabled();
    // And pressing it makes groups, as in English (#425).
    await tapOn(go);
    await expect.soft(page.locator('#cg-results .group').first()).toBeVisible();

    const row0 = page.locator('.cg-student').nth(0);
    const row1 = page.locator('.cg-student').nth(1);
    await chooseOption(row0.getByLabel('Bersama'), 'A');
    await chooseOption(row1.getByLabel('Bersama'), 'A');
    await chooseOption(row0.getByLabel('Terpisah'), 'A');
    await chooseOption(row1.getByLabel('Terpisah'), 'A');
    await expect
      .soft(page.getByText(/sudah ditandai untuk disatukan/))
      .toBeVisible();
    // The press above renamed the button, so it is read by its id here.
    await expect.soft(page.locator('#cg-go')).toBeDisabled();
  });

  // Stage 3, Task 6's own i18n requirement. Mirrors 'Student details
  // refuses to open above 100, leaving the count alone', above.
  test('Student details refuses to open above 100, in Indonesian', async ({
    page,
  }) => {
    await page.goto('/id/classroom-groups');
    await typeInto(page.getByLabel('Jumlah siswa'), '300');
    await tapOn(page.locator('#cg-students-toggle'));
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
    await tapOn(page.getByRole('button', { name: 'Tambah beberapa' }));
    await typeInto(page.getByLabel('Berapa yang ditambahkan?'), '20');
    await tapOn(page.getByRole('button', { name: 'Tambah', exact: true }));
    await expect(
      page.getByText('Masih ada ruang untuk 10 siswa lagi.'),
    ).toBeVisible();
    await expect(page.locator('.cg-student')).toHaveCount(90);
  });

  // Mirrors 'removes the row and lowers the roster', above.
  test('removing a row lowers the roster, in Indonesian', async ({ page }) => {
    await openRoster(page, '/id/classroom-groups');
    await addSeveral(page, 2);
    await tapOn(
      page.locator('.cg-student').nth(1).getByRole('button', { name: 'Hapus' }),
    );
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
    await tapOn(page.locator('#cg-students-toggle'));
    await tapOn(page.getByRole('button', { name: 'Tambah siswa' }));
    await expect(page.getByLabel('Jumlah siswa')).not.toBeEditable();
    await expect(
      page.getByText(
        'Ditentukan oleh daftar Anda. Tambah atau hapus siswa di Detail siswa untuk mengubahnya.',
      ),
    ).toBeVisible();
    await tapOn(page.getByRole('button', { name: 'Hapus semua' }));
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
 *  - Every test that wants a width asks for it through `atViewport`, which a
 *    real phone (it cannot resize itself) leaves alone, so the test is
 *    measured at the width the phone really has (#1046).
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
  // Read first, edited second: the six controls are counted, named and seen
  // before anything is typed into them.
  test(`${name}: every control is present with the same value; editing every field works`, async ({
    page,
  }) => {
    await atViewport(page, { width, height: 900 });
    await openRoster(page);
    const row = page.locator('.cg-student').first();
    // Read off the row, then compared with the six columns as a set (#390
    // F133): a hand list of five never named the number field, so either
    // layout could lose it and pass.
    const controls = row.locator('input, select');
    await expect.soft(controls).toHaveCount(6);
    const names = await controls.evaluateAll((all) =>
      all.map((c) => c.getAttribute('aria-label')),
    );
    expect
      .soft(names.sort())
      .toEqual(['#', 'Name', 'Sex', 'Absent', 'Together', 'Apart'].sort());
    for (const control of await controls.all())
      await expect.soft(control).toBeVisible();

    // All six (#390 F133): this edited four, never the number or Apart.
    await typeInto(row.getByLabel('#', { exact: true }), '7');
    await typeInto(row.getByLabel('Name'), 'Ana');
    await chooseOption(row.getByLabel('Sex'), 'F');
    await chooseOption(row.getByLabel('Together'), 'A');
    await chooseOption(row.getByLabel('Apart'), 'A');
    await setCheckedOn(row.getByLabel('Absent'));
    await expect.soft(row.getByLabel('#', { exact: true })).toHaveValue('7');
    await expect.soft(row.getByLabel('Name')).toHaveValue('Ana');
    await expect.soft(row.getByLabel('Sex')).toHaveValue('F');
    await expect.soft(row.getByLabel('Together')).toHaveValue('A');
    await expect.soft(row.getByLabel('Apart')).toHaveValue('A');
    await expect.soft(row.getByLabel('Absent')).toBeChecked();
  });
}

// Every locale (#423): the card's other controls carry localised
// placeholders, and they share the row with the name field; each row's
// controls and the count carry the page's own copy. L-06, re-homed from
// stage 2: that stage could not open Student details because it had no body,
// so the row was untestable there. The name field is measured on the one
// student, then that student is marked absent (the pill is the one extra
// element in the tightest column on the narrowest layout), then the roster
// grows to 100.
for (const path of localePaths('/classroom-groups'))
  test(`cards: the name field takes the full remaining width; no horizontal scroll at 320px once a student is marked absent, and with 100 students -- ${path}`, async ({
    page,
  }) => {
    await atViewport(page, { width: 320, height: 900 });
    await openRoster(page, path);
    const { rosterColName, rosterColAbsent } = getStrings(localeFromPath(path));
    const card = (await page.locator('.cg-student').first().boundingBox())!;
    const name = (await page
      .locator('.cg-student')
      .first()
      .getByLabel(rosterColName, { exact: true })
      .boundingBox())!;
    expect.soft(name.width).toBeGreaterThan(card.width * 0.6);
    await setCheckedOn(
      page.locator('.cg-student').first().getByLabel(rosterColAbsent),
    );
    await expectNoScrollSoft(page, 'a student marked absent');
    await addSeveral(page, 99);
    await expectNoScrollSoft(page, '100 students');
  });

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

  // T-06 -- claimed by no task's own traceability line (checked: it appears
  // only in the plan's stage-level rollup, docs/superpowers/plans/2026-08-06-
  // classroom-groups-v2-stage-3-student-details.md line 13), yet Task 2 is
  // unambiguously the task that first renders the together/apart columns at
  // all. Picked up here rather than left for a task that never claims it.
  //
  // One visit: what the dropdowns show while nothing is chosen comes first,
  // before anything is pressed; then Sex and Together are chosen once, and
  // what they show, how the lists grow and what the empty option does are
  // all read from that.
  test("every unset dropdown shows its own column name; choosing a value replaces the placeholder with the value; the empty option keeps each column's own behaviour; the Together and Apart lists grow", async ({
    page,
  }) => {
    await openRoster(page);
    await tapOn(page.getByRole('button', { name: 'Add student' }));
    const row = page.locator('.cg-student').first();
    const row1 = page.locator('.cg-student').nth(1);
    const placeholder = (column: string) =>
      row.getByLabel(column).locator('option[value=""]');

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

    expect.soft(shown).toEqual([
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
      await expect.soft(select).toBeVisible();
      await expect.soft(select).toHaveValue('');
      await expect.soft(select.locator('option:checked')).toHaveText(column);
    }

    // While nothing is chosen every placeholder can be selected.
    for (const column of PLACEHOLDER_COLUMNS) {
      await expect.soft(placeholder(column)).toBeEnabled();
    }

    // The first entry of every list is the empty option, which since #249
    // carries the column's own name rather than an em dash -- a teacher could
    // not see what a collapsed dropdown was for. It is asserted as a member of
    // the exact set, not skipped: it is still an option and still leads.
    await expect
      .soft(row.getByLabel('Together').locator('option'))
      .toHaveText(['Together', 'A']);

    await shoot(page, 'Every unset roster dropdown names its own column', row);

    await chooseOption(row.getByLabel('Sex'), 'F');
    await chooseOption(row.getByLabel('Together'), 'A');

    await expect
      .soft(row.getByLabel('Sex').locator('option:checked'))
      .toHaveText('F');
    await expect
      .soft(row.getByLabel('Together').locator('option:checked'))
      .toHaveText('A');

    // Apart was left alone, so it still names its column -- which also shows
    // the placeholder is per-control and not a property of the whole row.
    await expect
      .soft(row.getByLabel('Apart').locator('option:checked'))
      .toHaveText('Apart');

    // Sex is one-way by design (operator, 2026-08-13): the placeholder says
    // "not answered yet" and is not itself an answer, so it stops being
    // selectable once answered. Together and Apart are not one-way -- a
    // teacher must be able to clear a pairing letter.
    await expect.soft(placeholder('Sex')).toBeDisabled();
    await expect.soft(placeholder('Together')).toBeEnabled();
    await expect.soft(placeholder('Apart')).toBeEnabled();

    // The dropdown grows as needed -- B appears once A is used. Every row's
    // own dropdown grows, not only the one A was just set on.
    await expect
      .soft(row.getByLabel('Together').locator('option'))
      .toHaveText(['Together', 'A', 'B']);
    await expect
      .soft(row1.getByLabel('Together').locator('option'))
      .toHaveText(['Together', 'A', 'B']);
    // Together and apart grow independently. Apart has had nothing set on it
    // yet, so it must still offer only A -- a shared counter across both
    // fields would leak Together's own use into Apart's own list.
    await expect
      .soft(row.getByLabel('Apart').locator('option'))
      .toHaveText(['Apart', 'A']);
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
  // Its widths inside one test since #1086 (Shyden 2026-11-13): a real phone
  // keeps its own width (#1046), so it walks this once.
  for (const path of localePaths('/classroom-groups'))
    test(`no dropdown ever truncates its own column name -- ${path} at every width`, async ({
      page,
    }) => {
      await eachWidth(
        page,
        TRUNCATION_WIDTHS.map((width) => ({ width, height: 900 })),
        async () => {
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
    });
});

test.describe('the roster dropdowns are still reachable by thumb (#249)', () => {
  // Every locale (#423): the placeholders ARE the localised copy, and each
  // language's column names differ in width.
  for (const path of localePaths('/classroom-groups'))
    test(`every roster control meets the 44px touch target with a placeholder showing -- ${path}`, async ({
      page,
    }) => {
      // #249 put a WORD where a dash used to be, and a `<select>` sizes
      // itself to its widest option. The existing 44px sweep
      // ('every control meets the 44px touch target',
      // classroom-groups-controls.spec.ts) measures `#cg-form` only, and runs
      // before any roster exists -- so nothing had ever measured these three.
      //
      // Measured with the placeholder SHOWING, which is the state this ticket
      // created: a chosen value is one or two characters, the placeholder is
      // a whole column name, and only the wider one can push a row.
      await atViewport(page, { width: 375, height: 900 });
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
    });
});

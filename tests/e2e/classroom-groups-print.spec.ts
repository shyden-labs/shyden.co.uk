import { test, expect } from './fixtures';
import {
  withGroups,
  openPrintPanel,
  rosterWithAnAbsence,
  buildRoster,
  buildRosterAtPath,
  giveEveryoneASex,
  openRoster,
} from './helpers';
import { todayISO } from '../../src/lib/csv';
import { floorBreach } from '../floors';
import { searched } from '../source-files';
import { recorded, shoot } from './evidence';

test.use(recorded);

/**
 * Every control assertion is scoped to the PANEL, never to the page.
 *
 * `getByLabel` matches by SUBSTRING, and the import field's own label --
 * "Import a class list" -- contains "Class list", so a page-scoped
 * `getByLabel('Class list')` resolves to two elements and Playwright's
 * strict mode refuses it. Found by running, and worth keeping scoped rather
 * than switching to `{ exact: true }`: these tests are about the panel, and
 * scoping also survives any future copy on the page that happens to share a
 * word with one of these six labels.
 */
const panel = (page: import('@playwright/test').Page) =>
  page.locator('#cg-print-panel');

/**
 * The four remembered choices, in each language the panel is tested in. Each
 * moves off its default one way: the class-list radio is chosen (Both is the
 * default), and each tick box, ticked by default, is cleared.
 */
const REMEMBERED = {
  en: {
    path: '/classroom-groups',
    cancel: 'Cancel',
    choices: [
      { label: 'Class list', radio: true },
      { label: 'Include avatars', radio: false },
      { label: 'Show students who are absent', radio: false },
      { label: 'Show sex and the together/apart letters', radio: false },
    ],
  },
  id: {
    path: '/id/classroom-groups',
    cancel: 'Batal',
    choices: [
      { label: 'Daftar kelas', radio: true },
      { label: 'Sertakan avatar', radio: false },
      { label: 'Tampilkan siswa yang tidak hadir', radio: false },
      {
        label: 'Tampilkan jenis kelamin dan huruf bersama/terpisah',
        radio: false,
      },
    ],
  },
} as const;

/**
 * Moves ONE remembered choice off its default, reloads, and reads all four
 * back: the changed one survives and the three left alone keep their
 * defaults (#426). The test it replaced changed three of the four, so the
 * letters choice could go unstored and still pass, and its Indonesian twin
 * changed two. One test per choice calls this, and "remembers nothing" and
 * "stores every box as cleared" both fail it too.
 *
 * TWO students, not the default twelve: the roster only has to be big
 * enough for the Print button to exist, and building twelve twice crashed
 * WebKit on CI ("WebKit encountered an internal error" inside `page.goto`,
 * before any assertion ran) while passing on the other four projects.
 */
const changeOneAndReload = async (
  page: import('@playwright/test').Page,
  language: (typeof REMEMBERED)[keyof typeof REMEMBERED],
  changed: string,
) => {
  await withGroups(page, 2, language.path);
  await openPrintPanel(page);
  const choice = (label: string) => panel(page).getByLabel(label);
  if (language.choices.find((c) => c.label === changed)!.radio)
    await choice(changed).check();
  else await choice(changed).uncheck();
  await panel(page).getByRole('button', { name: language.cancel }).click();

  await page.reload();
  await withGroups(page, 2, language.path);
  await openPrintPanel(page);
  // Not a population: the four fixed choices of one panel, read back.
  for (const { label, radio } of language.choices) {
    const moved = label === changed;
    await expect(choice(label), label).toBeChecked({
      checked: radio ? moved : !moved,
    });
  }
};

/**
 * Stage 5, Task 1. The print panel and its four remembered choices.
 * Q-01…Q-04, Q-21, Y-06, Y-07.
 *
 * `window.print()` is never called from a test: Playwright cannot dismiss a
 * print dialog and the run hangs. The panel's Print button sets the `data-`
 * attributes and THEN prints, so the tests assert the attributes, and
 * appearance is checked with `page.emulateMedia({ media: 'print' })`.
 */

test.describe('the print panel', () => {
  test('the panel offers what to print, with Both as the default', async ({
    page,
  }) => {
    await withGroups(page);
    await openPrintPanel(page);
    await expect(panel(page).getByLabel('Both')).toBeChecked();
    await expect(panel(page).getByLabel('Class list')).not.toBeChecked();
    await expect(panel(page).getByLabel('Group results')).not.toBeChecked();
  });

  test('all three tick boxes start ticked', async ({ page }) => {
    await withGroups(page);
    await openPrintPanel(page);
    for (const label of [
      'Show students who are absent',
      'Show sex and the together/apart letters',
      'Include avatars',
    ]) {
      await expect(panel(page).getByLabel(label), label).toBeChecked();
    }
  });

  for (const { label } of REMEMBERED.en.choices)
    test(`${label}: the choice survives a reload, and only it moves`, async ({
      page,
    }) => {
      await changeOneAndReload(page, REMEMBERED.en, label);
    });

  test('only preferences are stored — no class data', async ({ page }) => {
    await withGroups(page);
    await page.getByLabel('Class (optional)').fill('7B');
    await openPrintPanel(page);
    await panel(page).getByLabel('Class list').check();
    const stored = await page.evaluate(() =>
      JSON.stringify({ ...localStorage }),
    );
    expect(stored).not.toContain('7B');
    // The exact list is asserted HERE and nowhere earlier. Stage 2
    // deliberately asserts only the `cg-` prefix, so adding these four does
    // not break a test that has nothing to do with printing.
    //
    // `cg-howto-collapsed` is NOT in this list, and the plan's own snippet
    // was wrong to include it: that key is written only when the How to use
    // header is CLICKED (classroom-groups.ts's own `howToToggle` listener),
    // never on load, and nothing in this test clicks it. Verified by
    // reading the write site, then by running.
    expect(Object.keys(JSON.parse(stored)).sort()).toEqual([
      'cg-print-absent',
      'cg-print-avatars',
      'cg-print-letters',
      'cg-print-what',
    ]);
  });

  // Q-21. The panel is a dialog: Escape closes it, and it does not print on
  // the way out. A panel a teacher cannot back out of is worse than a bare
  // button.
  test('Escape closes the panel without printing', async ({ page }) => {
    // Counts CALLS to window.print. This used to assert that `<html>`
    // carried no `data-print-what`, which was a proxy -- and stopped being
    // a true one when the remembered choices began reaching the document at
    // load (so that a teacher printing from the browser's own menu gets the
    // sheet their stored preference says). The proxy would now fail while
    // the behaviour it stood for is correct; this asserts the behaviour.
    await page.addInitScript(() => {
      (window as unknown as { __prints: number }).__prints = 0;
      window.print = () => {
        (window as unknown as { __prints: number }).__prints += 1;
      };
    });
    await withGroups(page);
    await openPrintPanel(page);
    await page.keyboard.press('Escape');
    await expect(page.locator('#cg-print-panel')).toBeHidden();
    expect(
      await page.evaluate(
        () => (window as unknown as { __prints: number }).__prints,
      ),
    ).toBe(0);
  });

  // …and the choices DO reach the document at load, from what was
  // remembered, so the browser's own print menu produces the sheet the
  // panel is showing rather than the build-time default.
  test('a remembered choice is on the document before the panel is opened', async ({
    page,
  }) => {
    await page.addInitScript(() => {
      window.print = () => {};
    });
    await withGroups(page);
    await openPrintPanel(page);
    await panel(page).getByLabel('Group results').check();
    await panel(page).getByRole('button', { name: 'Cancel' }).click();

    await page.reload();
    // No panel opened on this load at all.
    await expect(page.locator('html')).toHaveAttribute(
      'data-print-what',
      'groups',
    );
  });

  test('Cancel closes it and keeps the choices made', async ({ page }) => {
    await withGroups(page);
    await openPrintPanel(page);
    await panel(page).getByLabel('Group results').check();
    await panel(page).getByRole('button', { name: 'Cancel' }).click();
    await expect(page.locator('#cg-print-panel')).toBeHidden();
    await openPrintPanel(page);
    await expect(panel(page).getByLabel('Group results')).toBeChecked();
  });

  // The panel writes what it was told onto the document, which is the whole
  // mechanism the printed sheet is styled from -- asserted directly rather
  // than through an appearance check, so a styling change cannot make this
  // pass while the choice stops being carried.
  test('the choices reach the document as data attributes', async ({
    page,
  }) => {
    // The panel's Print button calls `window.print()` last, after setting
    // the attributes. Playwright cannot dismiss a real print dialog and the
    // run hangs -- this happens to be a no-op in headless Chromium, which
    // is exactly the kind of accident not to build a five-browser suite on.
    // Neutralised explicitly, before the page loads, so the assertion below
    // is about the attributes and nothing else.
    await page.addInitScript(() => {
      window.print = () => {};
    });
    await withGroups(page);
    await openPrintPanel(page);
    await panel(page).getByLabel('Class list').check();
    await panel(page).getByLabel('Include avatars').uncheck();
    await panel(page).getByRole('button', { name: 'Print' }).click();
    const html = page.locator('html');
    await expect(html).toHaveAttribute('data-print-what', 'class-list');
    await expect(html).toHaveAttribute('data-print-avatars', 'off');
    await expect(html).toHaveAttribute('data-print-absent', 'on');
    await expect(html).toHaveAttribute('data-print-letters', 'on');
  });
});

test.describe('the print panel — Indonesian', () => {
  test('the panel offers what to print, with Keduanya as the default', async ({
    page,
  }) => {
    await withGroups(page, 2, '/id/classroom-groups');
    await openPrintPanel(page);
    await expect(panel(page).getByLabel('Keduanya')).toBeChecked();
    await expect(panel(page).getByLabel('Daftar kelas')).not.toBeChecked();
    await expect(panel(page).getByLabel('Hasil kelompok')).not.toBeChecked();
  });

  test('all three tick boxes start ticked', async ({ page }) => {
    await withGroups(page, 2, '/id/classroom-groups');
    await openPrintPanel(page);
    for (const label of [
      'Tampilkan siswa yang tidak hadir',
      'Tampilkan jenis kelamin dan huruf bersama/terpisah',
      'Sertakan avatar',
    ]) {
      await expect(panel(page).getByLabel(label), label).toBeChecked();
    }
  });

  for (const { label } of REMEMBERED.id.choices)
    test(`${label}: the choice survives a reload, and only it moves`, async ({
      page,
    }) => {
      await changeOneAndReload(page, REMEMBERED.id, label);
    });
});

/**
 * Stage 5, Task 2. The printed class list, in all four combinations.
 * Q-05…Q-13, Q-16, Q-17, Q-20, A-08.
 *
 * All four are tested because the two tick boxes being INDEPENDENT is the
 * whole reason they are tick boxes and not three named sheets.
 */
const sheet = async (
  page: import('@playwright/test').Page,
  opts: {
    what: string;
    absent: boolean;
    letters: boolean;
    avatars: boolean;
  },
) => {
  await openPrintPanel(page);
  await panel(page).getByLabel(opts.what).check();
  await panel(page)
    .getByLabel('Show students who are absent')
    .setChecked(opts.absent);
  await panel(page)
    .getByLabel('Show sex and the together/apart letters')
    .setChecked(opts.letters);
  await panel(page).getByLabel('Include avatars').setChecked(opts.avatars);
  // The Print button's last act is `window.print()`. Chromium headless makes
  // that a no-op, so a describe block that forgets the stub passes here and
  // hangs for 30s on Firefox, which opens a dialog Playwright cannot dismiss
  // -- and the failure names the CLICK, not the missing stub. Asked once, in
  // the one place that clicks, rather than trusted to a convention each new
  // block has to remember.
  const unstubbed = await page.evaluate(() =>
    window.print.toString().includes('[native code]'),
  );
  expect(
    unstubbed,
    "window.print is not stubbed: add `await page.addInitScript(() => { window.print = () => {}; })` to this block's beforeEach",
  ).toBe(false);
  await panel(page).getByRole('button', { name: 'Print' }).click();
  await page.emulateMedia({ media: 'print' });
};

test.describe('the printed class list', () => {
  test.beforeEach(async ({ page }) => {
    // `window.print()` is the last thing the panel's Print button does.
    // Stubbed before load on every test in this block -- see the note on
    // the attributes test above for why not relying on it being a no-op.
    await page.addInitScript(() => {
      window.print = () => {};
    });
    await rosterWithAnAbsence(page); // 6 students, #4 absent, letters on #1/#2/#3
  });

  test('absent ✓ letters ✓ — the full register', async ({ page }) => {
    await sheet(page, {
      what: 'Class list',
      absent: true,
      letters: true,
      avatars: false,
    });
    // Absent leads the row now (operator, 2026-08-13) — it is the column a
    // teacher fills in first, so it is the column they read first.
    await expect(page.locator('.print-list thead th:visible')).toHaveText([
      'Absent',
      '#',
      'Name',
      'Sex',
      'Together',
      'Apart',
    ]);
    await expect(page.locator('.print-list tbody tr:visible')).toHaveCount(6);
    // The ROW too, not only the header: a Remove cell that lost its name
    // printed a column of buttons under a hidden heading (#390 PL5).
    await expect(
      page
        .locator('.print-list tbody tr:visible')
        .first()
        .locator('td:visible'),
    ).toHaveCount(6);
    await expect(page.locator('.print-foot')).toHaveText(
      '6 students · 5 here · 1 absent',
    );
  });

  test('absent ✓ letters ✗ — the Absent column STAYS', async ({ page }) => {
    // The combination that would otherwise print an absent child
    // indistinguishable from a present one.
    await sheet(page, {
      what: 'Class list',
      absent: true,
      letters: false,
      avatars: false,
    });
    await expect(page.locator('.print-list thead th:visible')).toHaveText([
      'Absent',
      '#',
      'Name',
    ]);
    await expect(page.locator('.print-list tbody tr:visible')).toHaveCount(6);
    await expect(page.locator('.print-list tbody tr').nth(3)).toContainText(
      '☑',
    );
  });

  test('absent ✗ letters ✓ — dropped, and the numbers jump', async ({
    page,
  }) => {
    await sheet(page, {
      what: 'Class list',
      absent: false,
      letters: true,
      avatars: false,
    });
    await expect(page.locator('.print-list tbody tr:visible')).toHaveCount(5);
    // `nth-child(2)`, not `first-child`: Absent took column 1. `first-child`
    // still MATCHES when that column is hidden — it would have read a run of
    // empty strings and compared them against the numbers, which is a test
    // passing for the wrong reason rather than failing.
    const numbers = await page
      .locator('.print-list tbody tr:visible td:nth-child(2)')
      .allTextContents();
    expect(numbers).toEqual(['1', '2', '3', '5', '6']);
    await expect(page.locator('.print-foot-here')).toHaveText(
      '5 students here today · 1 absent',
    );
    // …and the line it replaces is gone, so the sheet does not carry two
    // different totals.
    await expect(page.locator('.print-foot')).toBeHidden();
  });

  test('absent ✗ letters ✗ — numbers and names only', async ({ page }) => {
    await sheet(page, {
      what: 'Class list',
      absent: false,
      letters: false,
      avatars: false,
    });
    await expect(page.locator('.print-list thead th:visible')).toHaveText([
      '#',
      'Name',
    ]);
    await expect(page.locator('.print-list tbody tr:visible')).toHaveCount(5);
  });

  test('no form and no site chrome on the sheet', async ({ page }) => {
    await sheet(page, {
      what: 'Both',
      absent: true,
      letters: true,
      avatars: true,
    });
    // The plan's own snippet asserted `#cg-form` itself was hidden. It
    // cannot be: the four tool sections live INSIDE the form, so the class
    // list would go with it. The requirement (design spec section 10) is
    // about what a teacher SEES -- "no form, no collapsed sections, no site
    // chrome" -- so this asserts the CONTROLS are gone, which is the honest
    // form of the same claim and does not depend on where the <form>
    // element happens to start.
    for (const sel of [
      'header nav',
      'footer',
      '.top-row',
      '#cg-go',
      '#cg-grouping',
      '#cg-io',
      '#cg-sound',
      '#cg-howto',
      '.cg-roster-toolbar',
    ]) {
      await expect(page.locator(sel), sel).toBeHidden();
    }
    // Nothing a teacher could press or type into is left anywhere on the
    // sheet -- a stronger claim than naming sections one at a time, and the
    // one that actually fails if a future control is added and forgotten.
    // `[form="cg-form"]` is the form's own controls that live OUTSIDE it:
    // #cg-go has since #384, and `#cg-form button` alone went blind to it.
    const interactive = page.locator(
      '#cg-form input:visible, #cg-form select:visible, #cg-form button:visible, #cg-form textarea:visible, [form="cg-form"]:visible',
    );
    await expect(interactive).toHaveCount(0);
    // …and the class list is still there, which is the whole point of not
    // hiding the form.
    await expect(page.locator('#cg-roster')).toBeVisible();
  });

  test('the sheet carries the class name and a date', async ({ page }) => {
    await page.getByLabel('Class (optional)').fill('7B');
    await sheet(page, {
      what: 'Class list',
      absent: true,
      letters: true,
      avatars: false,
    });
    await expect(page.locator('.print-head')).toContainText('7B');
    await expect(page.locator('.print-head')).toContainText(todayISO());
  });

  test('paper carries neither the tint nor the pill', async ({ page }) => {
    await sheet(page, {
      what: 'Class list',
      absent: true,
      letters: true,
      avatars: false,
    });
    await expect(page.locator('.print-list .cg-absent-pill')).toBeHidden();
    await expect(page.locator('.print-list tbody tr').nth(3)).toHaveCSS(
      'background-color',
      'rgba(0, 0, 0, 0)',
    );
  });

  // Q-16/Q-17: the two What-to-print choices actually exclude each other's
  // section. Without this a sheet asked for one could quietly carry both.
  test('Class list prints the roster and not the groups', async ({ page }) => {
    await giveEveryoneASex(page);
    await page.getByRole('button', { name: 'Make Groups' }).click();
    await sheet(page, {
      what: 'Class list',
      absent: true,
      letters: true,
      avatars: false,
    });
    await expect(page.locator('#cg-students')).toBeVisible();
    await expect(page.locator('#cg-results')).toBeHidden();
  });

  test('Group results prints the groups and not the roster', async ({
    page,
  }) => {
    await giveEveryoneASex(page);
    await page.getByRole('button', { name: 'Make Groups' }).click();
    await sheet(page, {
      what: 'Group results',
      absent: true,
      letters: true,
      avatars: false,
    });
    await expect(page.locator('#cg-results')).toBeVisible();
    await expect(page.locator('#cg-students')).toBeHidden();
  });

  test('Both prints both', async ({ page }) => {
    await giveEveryoneASex(page);
    await page.getByRole('button', { name: 'Make Groups' }).click();
    await sheet(page, {
      what: 'Both',
      absent: true,
      letters: true,
      avatars: false,
    });
    await expect(page.locator('#cg-students')).toBeVisible();
    await expect(page.locator('#cg-results')).toBeVisible();
  });

  // A rename after the panel was last opened must reach the paper. The
  // mirrors are the only text on the sheet, and a text edit deliberately
  // never re-renders its row -- so this is the case that would go stale.
  test('a name typed after the last print still reaches the sheet', async ({
    page,
  }) => {
    await sheet(page, {
      what: 'Class list',
      absent: true,
      letters: true,
      avatars: false,
    });
    await expect(page.locator('.print-list tbody tr').first()).toContainText(
      'Ana',
    );
    await page.emulateMedia({ media: 'screen' });
    await page.locator('.cg-student').first().getByLabel('Name').fill('Annika');
    await page.emulateMedia({ media: 'print' });
    await expect(page.locator('.print-list tbody tr').first()).toContainText(
      'Annika',
    );
    await expect(
      page.locator('.print-list tbody tr').first(),
    ).not.toContainText('Ana ');
  });
});

/**
 * Stage 5, Task 3. The printed groups, and the greyscale proof.
 * Q-14, Q-15, Q-18, Q-19.
 *
 * The greyscale case does not merely check the page still renders: it
 * asserts the boy and girl avatars remain DISTINGUISHABLE with colour
 * removed, which is what the hair-length decision was for.
 */
test.describe('the printed groups', () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => {
      window.print = () => {};
    });
  });

  test('avatars on: faces print; off: names only', async ({ page }) => {
    await rosterWithAnAbsence(page);
    await giveEveryoneASex(page);
    await page.getByRole('button', { name: 'Make Groups' }).click();
    await sheet(page, {
      what: 'Group results',
      absent: true,
      letters: true,
      avatars: true,
    });
    await expect(page.locator('.print-groups svg').first()).toBeVisible();
    await page.emulateMedia({ media: 'screen' });
    await sheet(page, {
      what: 'Group results',
      absent: true,
      letters: true,
      avatars: false,
    });
    await expect(page.locator('.print-groups svg:visible')).toHaveCount(0);
  });

  test('group results print minus absent students', async ({ page }) => {
    await rosterWithAnAbsence(page);
    await giveEveryoneASex(page);
    await page.getByRole('button', { name: 'Make Groups' }).click();
    await sheet(page, {
      what: 'Group results',
      absent: true,
      letters: true,
      avatars: false,
    });
    // Dewi is #4 and absent, so she was never in the results at all --
    // design spec section 4. The absent tick box governs the class list
    // only, which is why this holds with it ON.
    await expect(page.locator('.print-groups')).not.toContainText('Dewi');
  });

  test('legible with no colour at all', async ({ page }) => {
    await buildRoster(page, [
      ['F', 'Ana'],
      ['M', 'Budi'],
      ['F', 'Citra'],
      ['M', 'Dedi'],
    ]);
    await giveEveryoneASex(page);
    await page.getByRole('button', { name: 'Make Groups' }).click();
    // The groups arrived before anything is judged legible (#424). The class
    // list prints these names too, so with the roster refused this read the
    // class list alone and passed with no groups on the sheet at all.
    await expect(page.locator('#cg-results .group').first()).toBeVisible();
    await sheet(page, {
      what: 'Both',
      absent: true,
      letters: true,
      avatars: true,
    });
    await page.addStyleTag({
      content: 'html { filter: grayscale(1) !important }',
    });

    // every printed name is still there and still readable
    for (const name of ['Ana', 'Budi', 'Citra']) {
      await expect(page.getByText(name, { exact: true }).first()).toBeVisible();
    }
    // …and boy/girl is still distinguishable, by HAIR rather than by
    // colour. Found through `data-hair` rather than through the hair's own
    // fill, because the fill is the very signal this case removes -- a
    // query that depended on it would be proving nothing.
    const hairs = await page
      .locator('.cg-avatar-defs [data-hair]')
      .evaluateAll((els) => [...new Set(els.map((e) => e.getAttribute('d')))]);
    expect(hairs.length).toBeGreaterThan(1);
    // Exactly three, one per face, and all different: two faces sharing a
    // path would leave them apart only by colour, which is the defect.
    expect(hairs).toHaveLength(3);
  });
});

// ── What the operator found by pressing Print ──────────────────────────────
test.describe('the printed sheet', () => {
  test('carries no controls', async ({ page }) => {
    await withGroups(page, 6);
    await page.emulateMedia({ media: 'print' });
    // Every button and link on the page, and which of them print: the
    // population the verdict is drawn from (#610).
    const { candidates, controls } = await page.evaluate(() => {
      const found = [...document.querySelectorAll('button, a[href]')];
      const printed = found.filter((el) => {
        const cs = getComputedStyle(el);
        const r = el.getBoundingClientRect();
        return (
          cs.display !== 'none' && cs.visibility !== 'hidden' && r.width > 0
        );
      });
      const label = (el: Element) => (el.textContent || '').trim().slice(0, 24);
      return { candidates: found.map(label), controls: printed.map(label) };
    });
    // "Full screen" printed on every sheet: the print CSS named controls one
    // at a time and that button was never added to the list.
    expect(
      searched(controls, {
        of: candidates,
        what: 'buttons and links on the page',
      }),
      `printed controls: ${controls.join(' | ')}`,
    ).toEqual([]);
    expect(
      floorBreach(
        'classroom-groups-print/buttons-and-links',
        candidates.length,
      ),
    ).toBeUndefined();
  });

  test('carries the class name and the date however it was printed', async ({
    page,
  }) => {
    await withGroups(page, 6);
    await page.locator('#cg-class').fill('Year 9 — Set 2');
    // Ctrl/Cmd+P, not the in-page Print button. `writePrintHead` used to run
    // only from the print panel's apply, so printing the way people actually
    // print produced a sheet with no class name and no date.
    await page.emulateMedia({ media: 'print' });
    await page.evaluate(() => window.dispatchEvent(new Event('beforeprint')));
    const head = page.locator('#cg-print-head');
    await expect(head).toContainText('Year 9 — Set 2');
    await expect(head).toContainText(/\d{4}-\d{2}-\d{2}/);
  });

  test('draws no rule under a class list whose toolbar is hidden', async ({
    page,
  }) => {
    await withGroups(page, 6);
    await page.emulateMedia({ media: 'print' });
    // The toolbar lives in `<tfoot><td colspan="7">`. Hiding only the div
    // inside left the cell in the table and its 1px top border drew a
    // full-width rule across the bottom of every printed class list.
    const foot = await page.evaluate(() => {
      const tf = document.querySelector('#cg-roster tfoot');
      if (!tf) return 'no tfoot';
      return getComputedStyle(tf).display;
    });
    expect(foot).toBe('none');
  });
});

/** The text edit both register blocks below make: it never re-renders. */
const typeAName = async (row: import('@playwright/test').Locator) => {
  await row.getByLabel('Name').fill('Ana');
};

/**
 * #253. `refreshPrintMirrors` wrote every roster row's print-only twin by
 * DOCUMENT ORDER, against a `texts` array that still began at `number`. The
 * row is built `tr.append(absentTd, numberTd, nameTd, ...)` -- Absent leads
 * (operator, 2026-08-13) -- so every value landed one cell early: the pupil's
 * number printed in the Absent column, their name in `#`, their sex in Name,
 * and the absence box in Sex.
 *
 * It only showed after a TEXT edit. A select or a checkbox re-renders the row
 * and `roster-ui.ts` rebuilds each mirror correctly from its own call site,
 * which repaired the damage a keystroke away from where anyone would look. A
 * text edit deliberately does not re-render -- that would steal focus and the
 * caret mid-typing, which is the whole reason this function exists -- so the
 * wrong write survived exactly in the case the function was written to serve.
 *
 * Nothing could see it. `.print-list` (the print PANEL's own table) is a
 * different surface, and the roster's mirrors are `aria-hidden` and
 * `display: none` on screen, so no screen assertion can reach them.
 */
test.describe('the printed register after an edit', () => {
  const TICKED = '☑';
  const UNTICKED = '☐';
  const DASH = '—';

  /** Absent, #, Name, Sex, Together, Apart, then Remove which has no twin. */
  const untouchedSecondRow = [UNTICKED, '2', '', DASH, DASH, DASH, null];

  const printedCells = (row: import('@playwright/test').Locator) =>
    row.evaluate((el) =>
      [...el.children].map(
        (td) => td.querySelector('.cg-print-value')?.textContent ?? null,
      ),
    );

  const useTheSelects = async (row: import('@playwright/test').Locator) => {
    await row.getByLabel('Sex').selectOption('F');
    await row.getByLabel('Absent').check();
  };

  const CASES = [
    {
      what: 'a text edit alone',
      edits: [typeAName],
      expected: [UNTICKED, '1', 'Ana', DASH, DASH, DASH, null],
    },
    {
      what: 'a select edit alone',
      edits: [useTheSelects],
      expected: [TICKED, '1', '', 'F', DASH, DASH, null],
    },
    {
      what: 'a select edit then a text edit',
      edits: [useTheSelects, typeAName],
      expected: [TICKED, '1', 'Ana', 'F', DASH, DASH, null],
    },
    {
      what: 'a text edit then a select edit',
      edits: [typeAName, useTheSelects],
      expected: [TICKED, '1', 'Ana', 'F', DASH, DASH, null],
    },
  ];

  for (const { what, edits, expected } of CASES) {
    test(`every cell prints its own column after ${what}`, async ({ page }) => {
      await openRoster(page);
      // A second row, because `refreshPrintMirrors` walks rows by index
      // against the live roster and an off-by-one there would look identical
      // to a correct single row.
      await page.getByRole('button', { name: 'Add student' }).click();
      const row = page.locator('.cg-student').nth(0);
      const second = page.locator('.cg-student').nth(1);

      for (const edit of edits) await edit(row);
      await page.emulateMedia({ media: 'print' });

      expect(await printedCells(row)).toEqual(expected);
      expect(await printedCells(second)).toEqual(untouchedSecondRow);
    });
  }
});

/**
 * #249 gave the three roster dropdowns their column name as a placeholder, and
 * this is the regression surface that change could have taken with it.
 *
 * `t.rosterUnset` (the em dash) had SIX consumers and only three of them were
 * the selects. The other three are print mirrors -- `.cg-print-value` spans
 * the roster row carries beside each control, built in `roster-ui.ts` and kept
 * current by `refreshPrintMirrors` in `classroom-groups.ts`. A blanket edit to
 * `rosterUnset` would have printed the word "Sex" in an empty cell on a
 * teacher's class list, which nobody would have seen: print is a medium no
 * guard renders by default, and this repo has already shipped a blank sheet
 * once for exactly that reason.
 *
 * So: on screen the control names its column, and on paper the cell keeps its
 * dash. The em dash is written here as a literal rather than read from the
 * catalogue on purpose -- a value asserted against the constant it is computed
 * from moves when that constant moves and pins nothing (#117).
 */
test.describe('an unset roster cell on paper', () => {
  const PRINTED = ['Sex', 'Together', 'Apart'] as const;

  test('keeps the em dash — the column name belongs on screen only', async ({
    page,
  }) => {
    await openRoster(page);
    const row = page.locator('.cg-student').first();

    // On screen, the placeholder #249 added.
    for (const column of PRINTED) {
      await expect(row.getByLabel(column).locator('option:checked')).toHaveText(
        column,
      );
    }

    await page.emulateMedia({ media: 'print' });

    for (const column of PRINTED) {
      // Absence is a count AND a hidden state: `toBeHidden` alone passes for
      // a control that does not exist at all (#188).
      await expect(row.getByLabel(column)).toHaveCount(1);
      await expect(row.getByLabel(column)).toBeHidden();

      const mirror = row
        .locator('td')
        .filter({ has: page.locator(`select[aria-label="${column}"]`) })
        .locator('.cg-print-value');
      await expect(mirror).toBeVisible();
      await expect(mirror).toHaveText('—');
    }
  });
});

/**
 * #253 AC5 and AC2, the two halves the first fix left unasserted.
 *
 * AC5 is a REGRESSION guard over code that is already correct: `refreshPrintMirrors`
 * writes `row.dataset.absent` on the same pass that writes the mirrors, and the
 * column fix rewrote that pass. Nothing in `tests/` asserted the attribute --
 * confirmed with a known-positive control, so the empty grep was a real absence
 * and not a blind pattern (#183).
 *
 * It matters because `data-absent` is not bookkeeping: it is half of
 * `[data-print-absent='off'] .cg-student[data-absent='true']`, the rule that
 * takes absent pupils off a printed register. The other half, the toggle's own
 * `data-print-absent`, WAS asserted. A rule is not proven by one of its operands.
 */
test.describe('the absent bookkeeping the printed register is built on', () => {
  /** `data-absent` per row, in row order. */
  const absentFlags = (page: import('@playwright/test').Page) =>
    page
      .locator('.cg-student')
      .evaluateAll((rows) => rows.map((r) => r.getAttribute('data-absent')));

  const tickAbsent = async (row: import('@playwright/test').Locator) => {
    await row.getByLabel('Absent').check();
  };

  /**
   * `roster-ui.ts` ALSO writes `data-absent`, on every re-render, so a select
   * edit alone would read correct even with `refreshPrintMirrors`' own write
   * deleted. Only ticking and THEN typing isolates it: a text edit deliberately
   * never re-renders (it would steal the caret), which leaves
   * `refreshPrintMirrors` the sole writer on that pass -- exactly the case
   * that hid #253's column shift for as long as it did.
   */
  const CASES = [
    {
      what: 'a text edit alone',
      edits: [typeAName],
      expected: ['false', 'false'],
    },
    { what: 'a tick alone', edits: [tickAbsent], expected: ['true', 'false'] },
    {
      what: 'a tick then a text edit (no re-render follows)',
      edits: [tickAbsent, typeAName],
      expected: ['true', 'false'],
    },
    {
      what: 'a text edit then a tick',
      edits: [typeAName, tickAbsent],
      expected: ['true', 'false'],
    },
  ];

  for (const { what, edits, expected } of CASES) {
    test(`every row still declares its own absence after ${what}`, async ({
      page,
    }) => {
      await openRoster(page);
      // A second row for the same reason the column guard above keeps one:
      // `refreshPrintMirrors` walks rows by index against the live roster, and
      // an off-by-one there is invisible with a single row.
      await page.getByRole('button', { name: 'Add student' }).click();
      const row = page.locator('.cg-student').nth(0);

      for (const edit of edits) await edit(row);

      const flags = await absentFlags(page);
      expect(
        searched(flags, { of: flags, what: `roster rows after ${what}` }),
      ).toEqual(expected);

      // The register as it reaches paper, for the edit path that hid #253 for
      // as long as it did. Whole page, not the table: what prints is the page.
      await page.emulateMedia({ media: 'print' });
      await shoot(page, `the printed register after ${what}`);
      await page.emulateMedia({ media: 'screen' });
    });
  }
});

/**
 * #253 AC2, the half the first fix did not reach.
 *
 * The mirrors are keyed by column now, but the rule that takes the Absent
 * COLUMN off the sheet still names it by ordinal, and its own comment records
 * that the ordinal was already wrong once: left at 4 it hid Sex and printed
 * Absent, "a sheet that silently answered a different question than the tick
 * box asked". AC2 asks that reordering the columns cannot reintroduce that.
 *
 * So this asks which NAMED columns reach paper, never which positions -- a
 * guard written positionally would carry the very defect it is testing for.
 * Visibility is `getClientRects().length`, not the element's own computed
 * display: `display: none` on an ANCESTOR leaves a descendant's computed
 * display untouched, so a per-element check reports hidden content as
 * rendered (#17).
 */
test.describe('which columns reach paper is decided by name, not by position', () => {
  const ALL_SIX = ['absent', 'number', 'name', 'sex', 'together', 'apart'];

  // Same stub the printed-class-list block installs, for the same reason: the
  // panel's Print button ends in `window.print()`.
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => {
      window.print = () => {};
    });
  });

  /** The columns a PRESENT row actually paints, by name, in DOM order. */
  const printedColumns = async (
    page: import('@playwright/test').Page,
    row: number,
  ) =>
    page
      .locator('.cg-student')
      .nth(row)
      .locator('.cg-print-value')
      .evaluateAll((els) =>
        els
          .filter((el) => el.getClientRects().length > 0)
          .map((el) => (el as HTMLElement).dataset.col ?? '(unkeyed)'),
      );

  test('showing absent pupils prints every column, including Absent', async ({
    page,
  }) => {
    await buildRoster(page, [
      ['M', 'Ana'],
      ['F', 'Budi'],
    ]);
    await page.locator('.cg-student').nth(0).getByLabel('Absent').check();
    await sheet(page, {
      what: 'Class list',
      absent: true,
      letters: true,
      avatars: true,
    });

    const columns = await printedColumns(page, 1);
    expect(
      [...searched(columns, { of: columns, what: 'printed columns' })].sort(),
    ).toEqual([...ALL_SIX].sort());

    await shoot(
      page,
      'absent pupils shown: the register prints all six columns, Absent first',
    );
  });

  test('hiding absent pupils removes the Absent column and only that column', async ({
    page,
  }) => {
    await buildRoster(page, [
      ['M', 'Ana'],
      ['F', 'Budi'],
    ]);
    await page.locator('.cg-student').nth(0).getByLabel('Absent').check();
    await sheet(page, {
      what: 'Class list',
      absent: false,
      letters: true,
      avatars: true,
    });

    // Budi is present, so Budi's row stays -- minus the Absent column. If the
    // rule ever names the wrong column, THIS is the assertion that says which
    // one went instead, by name, rather than reporting a count that moved.
    const columns = await printedColumns(page, 1);
    expect(
      [...searched(columns, { of: columns, what: 'printed columns' })].sort(),
    ).toEqual(ALL_SIX.filter((c) => c !== 'absent').sort());

    await shoot(
      page,
      'absent pupils hidden: the Absent column is gone and Ana’s row with it',
    );
  });

  // #390 F73, the letters box's half of #253 AC2. Its rule hid columns 4, 5
  // and 6 by position, so reordering the row would have hidden whichever
  // columns landed there and printed Sex. Compared as a SET of names, so a
  // reorder that keeps the rule honest stays green and one that re-points
  // it says which column went instead.
  test('hiding the letters removes Sex, Together and Apart, and only those', async ({
    page,
  }) => {
    await buildRoster(page, [
      ['M', 'Ana'],
      ['F', 'Budi'],
    ]);
    await sheet(page, {
      what: 'Class list',
      absent: true,
      letters: false,
      avatars: true,
    });

    const columns = await printedColumns(page, 1);
    expect(
      [...searched(columns, { of: columns, what: 'printed columns' })].sort(),
    ).toEqual(
      ALL_SIX.filter((c) => !['sex', 'together', 'apart'].includes(c)).sort(),
    );

    await shoot(
      page,
      'letters hidden: Sex, Together and Apart are gone, Absent stays',
    );
  });

  test('an absent pupil leaves the sheet entirely, a present one stays', async ({
    page,
  }) => {
    await buildRoster(page, [
      ['M', 'Ana'],
      ['F', 'Budi'],
    ]);
    await page.locator('.cg-student').nth(0).getByLabel('Absent').check();
    await sheet(page, {
      what: 'Class list',
      absent: false,
      letters: true,
      avatars: true,
    });

    const rows = page.locator('.cg-student');
    await expect(rows.nth(0)).toBeHidden();
    await expect(rows.nth(1)).toBeVisible();
  });
});

/**
 * #261 AC5. The printed register in a language that is not English.
 *
 * The register was asserted in English only, and its headings are translated.
 * A heading of one or two words is the class that once put `Tình dục` --
 * *sexual intercourse* -- beside pupils' names on a roster (#114), while every
 * surrounding SENTENCE translated correctly. No automated guard can see a
 * string that is translated and wrong: identical-to-English guards catch
 * untranslated, empty-copy guards catch blank, and this is neither. A picture
 * an operator reads is the only instrument there is, which is why this test
 * exists to be LOOKED at as much as to pass.
 *
 * No panel flow: `print-ui.ts` applies the remembered choices to `<html>` on
 * load, so the defaults are already in place and `emulateMedia` is enough.
 */
test.describe('the printed register — Indonesian', () => {
  test('every column heading reaches paper in Indonesian', async ({ page }) => {
    await buildRosterAtPath(page, '/id/classroom-groups', [
      ['M', 'Ana'],
      ['F', 'Budi'],
    ]);
    await page.emulateMedia({ media: 'print' });

    const headings = page.locator('#cg-roster thead th:visible');
    // Visible AND worded: `toHaveText` alone reads `textContent`, which a
    // heading the page forgot to show still carries (#188).
    await expect(headings.first()).toBeVisible();
    await expect(headings).toHaveText([
      'Tidak hadir',
      '#',
      'Nama',
      'Jenis kelamin',
      'Bersama',
      'Terpisah',
    ]);

    await shoot(
      page,
      'the Indonesian register on paper, every heading translated',
    );
  });
});

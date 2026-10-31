import { typeInto } from '../real-typing';
import { test, expect } from './fixtures';
import { recordErrors } from './recorders';
import { atLeast44 } from '../viewport';
import { otherLocales, toolPath } from '../../src/lib/i18n/index';
import { LOCALE_METADATA } from '../../src/lib/i18n/metadata';
import {
  buildRoster,
  buildRosterAtPath,
  downloadName,
  downloadText,
  expectNothingStored,
  giveEveryoneASex,
  handoverTo,
  rosterOf,
  todayISO,
  upload,
} from './helpers';
import { recorded } from './evidence';

test.use(recorded);

/**
 * Stage 4, Task 5. The Import/export section, driven through the page.
 * C-14, C-17…C-20, C-26, C-28…C-31, S-06…S-08.
 *
 * The pure format is proven exhaustively at unit level (tests/unit/csv.test.ts,
 * 84 tests). What only a page can prove is here: that a bad file leaves the
 * screen exactly as it was, that a download carries the bytes and the name a
 * teacher receives, and that the two `dirty` transitions stage 3 built
 * actually fire.
 *
 * Every button is found by its RENDERED name, and the plan's snippets for
 * this task were checked against the real page first -- `Make groups` is
 * `Make Groups` on it, and stage 3's ledger records ten other occasions
 * where a plan literal did not exist in the product.
 */

const openIo = async (page: import('@playwright/test').Page) => {
  await page.locator('#cg-io-toggle').click();
};

test.describe('Import / export', () => {
  test('a bad file changes nothing on screen, and lists every problem', async ({
    page,
  }) => {
    await rosterOf(page, 3);
    await openIo(page);
    await upload(
      page,
      'bad.csv',
      'number,name,sex\n1,Ana,F\n2,Budi,Male\n1,Citra,F\n',
    );
    await expect(
      page.getByText(
        "Row 2 — sex 'Male' not understood. Use M, F, or leave blank.",
      ),
    ).toBeVisible();
    await expect(
      page.getByText('Row 3 — number 1 is already used by row 1.'),
    ).toBeVisible();
    await expect(page.locator('.cg-student')).toHaveCount(3); // untouched
  });

  // The refusal must not outlive the file that caused it. A teacher who
  // fixes their spreadsheet and re-imports should not be reading last
  // attempt's problems under this attempt's result.
  test('a later good file clears the problems from a bad one', async ({
    page,
  }) => {
    await page.goto('/classroom-groups');
    await openIo(page);
    await upload(page, 'bad.csv', 'number\nabc\n');
    await expect(
      page.getByText("Row 1 — number 'abc' is not a whole number."),
    ).toBeVisible();
    await upload(page, 'ok.csv', 'number,name\n1,Ana\n');
    await expect(page.getByText(/is not a whole number/)).toHaveCount(0);
    await expect(page.locator('.cg-student')).toHaveCount(1);
  });

  test('importing over a roster always warns, even when the counts match', async ({
    page,
  }) => {
    await rosterOf(page, 3);
    await openIo(page);
    await upload(page, 'three.csv', 'number\n1\n2\n3\n');
    await expect(
      page.getByText(
        'This will replace your current class list — 3 students, 0 named.',
      ),
    ).toBeVisible();
    await expect(page.locator('.cg-student')).toHaveCount(3); // not yet replaced
  });

  // The warning names how much was typed BY HAND, which is the part a
  // teacher actually mourns -- design spec section 9 is explicit about it.
  test('the warning counts how many were named by hand', async ({ page }) => {
    await buildRoster(page, [['F', 'Ana'], ['M', 'Budi'], [null]]);
    await openIo(page);
    await upload(page, 'other.csv', 'number\n1\n');
    await expect(
      page.getByText(
        'This will replace your current class list — 3 students, 2 named.',
      ),
    ).toBeVisible();
  });

  test('confirming the warning replaces the roster', async ({ page }) => {
    await buildRoster(page, [
      ['F', 'Ana'],
      ['M', 'Budi'],
    ]);
    await openIo(page);
    await upload(page, 'new.csv', 'number,name\n7,Gita\n');
    await page.getByRole('button', { name: 'Replace it' }).click();
    await expect(page.locator('.cg-student')).toHaveCount(1);
    await expect(
      page.locator('.cg-student').first().getByLabel('Name'),
    ).toHaveValue('Gita');
  });

  test('cancelling the warning keeps what was there', async ({ page }) => {
    await buildRoster(page, [
      ['F', 'Ana'],
      ['M', 'Budi'],
    ]);
    await openIo(page);
    await upload(page, 'new.csv', 'number,name\n7,Gita\n');
    await page.getByRole('button', { name: 'Keep what I have' }).click();
    await expect(page.locator('.cg-student')).toHaveCount(2);
    await expect(
      page.locator('.cg-student').first().getByLabel('Name'),
    ).toHaveValue('Ana');
    await expect(page.getByText(/This will replace/)).toHaveCount(0);
  });

  // No roster on screen means nothing to lose, so no warning -- the warning
  // exists to protect work, not to add a step.
  test('importing onto an empty page needs no confirmation', async ({
    page,
  }) => {
    await page.goto('/classroom-groups');
    await openIo(page);
    await upload(page, 'ok.csv', 'number,name\n1,Ana\n2,Budi\n');
    await expect(page.locator('.cg-student')).toHaveCount(2);
    await expect(page.getByText(/This will replace/)).toHaveCount(0);
  });

  // A successful import must SAY so -- everything else about it is
  // inference (the roster lands in a section that is still collapsed, and
  // the header quietly changes). A teacher who picked the wrong file needs
  // to be told a file landed at all.
  test('a successful import says how many students landed', async ({
    page,
  }) => {
    await page.goto('/classroom-groups');
    await openIo(page);
    await upload(page, 'ok.csv', 'number,name\n1,Ana\n2,Budi\n');
    await expect(page.getByText('Imported 2 students.')).toBeVisible();
  });

  test('and says it in the singular for one', async ({ page }) => {
    await page.goto('/classroom-groups');
    await openIo(page);
    await upload(page, 'one.csv', 'number,name\n1,Ana\n');
    await expect(page.getByText('Imported 1 student.')).toBeVisible();
  });

  // The confirmation belongs to ONE file. A later refusal must not sit
  // underneath a message saying the last one worked.
  test('a later bad file clears the success message', async ({ page }) => {
    await page.goto('/classroom-groups');
    await openIo(page);
    await upload(page, 'ok.csv', 'number,name\n1,Ana\n');
    await expect(page.getByText('Imported 1 student.')).toBeVisible();
    await upload(page, 'bad.csv', 'number\nabc\n');
    await expect(page.getByText(/^Imported /)).toHaveCount(0);
    await expect(
      page.getByText("Row 1 — number 'abc' is not a whole number."),
    ).toBeVisible();
  });

  test('the export button for groups appears only once groups exist', async ({
    page,
  }) => {
    await rosterOf(page, 6);
    await openIo(page);
    await expect(
      page.getByRole('button', { name: 'Export groups' }),
    ).toHaveCount(0);
    await giveEveryoneASex(page);
    await page.getByRole('button', { name: 'Make Groups' }).click();
    await expect(
      page.getByRole('button', { name: 'Export groups' }),
    ).toBeVisible();
  });

  test('the template is the roster once there is one', async ({ page }) => {
    await buildRoster(page, [
      ['F', 'Ana'],
      ['M', 'Budi'],
    ]);
    await openIo(page);
    const text = await downloadText(page, 'Download template');
    expect(text).toContain('1,Ana,F,,,');
    expect(text).toContain('2,Budi,M,,,');
    // and it is a real roster, not the example rows
    expect(text).not.toContain('# 1,Ana');
  });

  test('the template with no roster is example COMMENT rows only', async ({
    page,
  }) => {
    await page.goto('/classroom-groups');
    await openIo(page);
    const text = await downloadText(page, 'Download template');
    expect(text).toContain('# 1,Ana,F,,A,');
    // Every line that is not the header is a comment, so importing it
    // unedited adds nobody. The header is found by its own content rather
    // than by position, because the `# Class:` prompt line comes first.
    const body = text
      .split('\n')
      .filter((l) => l.trim() !== '')
      .filter((l) => l !== 'number,name,sex,absent,together,apart');
    expect(body.every((l) => l.startsWith('#'))).toBe(true);
  });

  test('the exported class list is the roster on screen', async ({ page }) => {
    await buildRoster(page, [
      ['F', 'Ana'],
      ['M', 'Budi'],
    ]);
    await openIo(page);
    const text = await downloadText(page, 'Export class list');
    expect(text).toBe(
      'number,name,sex,absent,together,apart\n1,Ana,F,,,\n2,Budi,M,,,\n',
    );
  });

  test('the filename carries the class and the date', async ({ page }) => {
    await rosterOf(page, 2);
    await typeInto(page.getByLabel('Class (optional)'), '7B');
    await openIo(page);
    const name = await downloadName(page, 'Export class list');
    expect(name).toMatch(/^7B-class-list-\d{4}-\d{2}-\d{2}\.csv$/);
  });

  test('a class name with a slash still produces a usable filename', async ({
    page,
  }) => {
    await rosterOf(page, 2);
    await typeInto(page.getByLabel('Class (optional)'), 'Year 7 / Set B');
    await openIo(page);
    const name = await downloadName(page, 'Export class list');
    expect(name).toBe(`Year-7-Set-B-class-list-${todayISO()}.csv`);
    // and the class name itself is untouched
    await expect(page.getByLabel('Class (optional)')).toHaveValue(
      'Year 7 / Set B',
    );
  });

  // C-30's last surface: the results heading. The filename was sanitised
  // from this same value, and the heading must not have been.
  test('the sanitised filename does not leak into the results heading', async ({
    page,
  }) => {
    await rosterOf(page, 4);
    await typeInto(page.getByLabel('Class (optional)'), 'Year 7 / Set B');
    await giveEveryoneASex(page);
    await page.getByRole('button', { name: 'Make Groups' }).click();
    await expect(page.locator('#cg-results-h')).toContainText('Year 7 / Set B');
    await expect(page.locator('#cg-results-h')).not.toContainText(
      'Year-7-Set-B',
    );
    await openIo(page);
    expect(await downloadName(page, 'Export class list')).toContain(
      'Year-7-Set-B',
    );
  });

  // S-08. The warning is a HEADER, not a toast: it is still there after the
  // page has had every chance to settle. Condition-based -- this waits for
  // the page to go quiet, never for a fixed number of milliseconds.
  test('the unsaved-changes warning is permanent, not a toast that fades', async ({
    page,
  }) => {
    await rosterOf(page, 2);
    await expect(page.locator('#cg-io .state')).toHaveText(
      'unsaved changes — export to keep them',
    );
    await page.waitForLoadState('networkidle');
    // A full animation frame plus the tool's own longest deal step: if
    // anything on this page were going to clear the header on a timer, it
    // would have by now.
    await page.evaluate(
      () =>
        new Promise((resolve) => requestAnimationFrame(() => resolve(null))),
    );
    await expect(page.locator('#cg-io .state')).toHaveText(
      'unsaved changes — export to keep them',
    );
  });

  test('the exported groups file is one row per student', async ({ page }) => {
    await rosterOf(page, 4);
    await typeInto(page.getByLabel('Students in each group'), '2');
    await giveEveryoneASex(page);
    await page.getByRole('button', { name: 'Make Groups' }).click();
    await openIo(page);
    const text = await downloadText(page, 'Export groups');
    const lines = text.split('\n').filter(Boolean);
    expect(lines[0]).toBe(`# Groups made ${todayISO()}`);
    expect(lines[1]).toBe('group,number,name');
    expect(lines).toHaveLength(6); // comment + header + 4 students
  });

  test('exporting clears the unsaved-changes warning', async ({ page }) => {
    // The other half of stage 3's `dirty` rule: setRoster(next, { saved: true }).
    await rosterOf(page, 3);
    await openIo(page);
    await expect(page.locator('#cg-io .state')).toHaveText(
      'unsaved changes — export to keep them',
    );
    await downloadName(page, 'Export class list');
    await expect(page.locator('#cg-io .state')).toHaveText(
      'nothing to save yet',
    );
  });

  test('a successful import clears it too', async ({ page }) => {
    await page.goto('/classroom-groups');
    await openIo(page);
    await upload(page, 'ok.csv', 'number,name\n1,Ana\n2,Budi\n');
    await expect(page.locator('.cg-student')).toHaveCount(2);
    await expect(page.locator('#cg-io .state')).toHaveText(
      'nothing to save yet',
    );
  });

  // …and editing after an import makes it dirty again, which is what proves
  // the flag was CLEARED rather than switched off for good.
  test('editing after an import marks it unsaved again', async ({ page }) => {
    await page.goto('/classroom-groups');
    await openIo(page);
    await upload(page, 'ok.csv', 'number,name\n1,Ana\n');
    await expect(page.locator('#cg-io .state')).toHaveText(
      'nothing to save yet',
    );
    // Student details is still COLLAPSED -- an import fills it but does not
    // open it, and a hidden input cannot be typed into. Opening it is the
    // same thing a teacher does, not a workaround.
    await page.locator('#cg-students-toggle').click();
    await typeInto(
      page.locator('.cg-student').first().getByLabel('Name'),
      'Anna',
    );
    await expect(page.locator('#cg-io .state')).toHaveText(
      'unsaved changes — export to keep them',
    );
  });

  // A round trip through the real controls: export, then import the exact
  // bytes back, and get the same roster. The unit suite proves
  // serialise/parse agree; this proves the PAGE hands them the same roster
  // it is showing.
  test('a roster survives a round trip through export and import', async ({
    page,
  }) => {
    await buildRoster(page, [
      ['F', 'Ana'],
      ['M', 'Budi'],
      [null, 'Wong, Mei'],
    ]);
    await openIo(page);
    const text = await downloadText(page, 'Export class list');
    await page.reload();
    await openIo(page);
    await upload(page, 'again.csv', text);
    await expect(page.locator('.cg-student')).toHaveCount(3);
    await expect(
      page.locator('.cg-student').nth(2).getByLabel('Name'),
    ).toHaveValue('Wong, Mei');
  });

  test('no console errors while importing and exporting', async ({ page }) => {
    const reported = recordErrors(page);
    await page.goto('/classroom-groups');
    await openIo(page);
    await upload(page, 'ok.csv', 'number,name\n1,Ana\n');
    await downloadName(page, 'Export class list');
    await reported.expectNone('importing and exporting report nothing');
  });
});

test.describe('Import / export — Indonesian', () => {
  test('the section carries its own controls, translated', async ({ page }) => {
    await page.goto('/id/classroom-groups');
    await page.locator('#cg-io-toggle').click();
    await expect(
      page.getByRole('button', { name: 'Ekspor daftar kelas' }),
    ).toBeVisible();
    await expect(
      page.getByRole('button', { name: 'Unduh templat' }),
    ).toBeVisible();
    await expect(page.getByText('Impor daftar kelas')).toBeVisible();
  });

  test('an Indonesian page exports an Indonesian file', async ({ page }) => {
    await buildRoster(
      page,
      [
        ['F', 'Ana'],
        ['M', 'Budi'],
      ],
      '/id/classroom-groups',
    );
    await page.locator('#cg-io-toggle').click();
    const text = await downloadText(page, 'Ekspor daftar kelas');
    expect(text).toBe(
      'nomor,nama,jenis kelamin,tidak hadir,bersama,terpisah\n' +
        '1,Ana,P,,,\n' +
        '2,Budi,L,,,\n',
    );
  });

  test('a successful Indonesian import says so in Indonesian', async ({
    page,
  }) => {
    await page.goto('/id/classroom-groups');
    await page.locator('#cg-io-toggle').click();
    await upload(page, 'ok.csv', 'nomor,nama\n1,Ana\n2,Budi\n');
    await expect(page.getByText('2 siswa diimpor.')).toBeVisible();
  });

  test('an English file dropped on the Indonesian page is refused in Indonesian', async ({
    page,
  }) => {
    await page.goto('/id/classroom-groups');
    await page.locator('#cg-io-toggle').click();
    await upload(page, 'english.csv', 'number,name\n1,Ana\n');
    await expect(page.getByText(/bahasa Inggris/)).toBeVisible();
    await expect(page.locator('.cg-student')).toHaveCount(0);
  });

  test('and the refusal names the Indonesian filename on export', async ({
    page,
  }) => {
    await rosterOf(page, 2);
    await page.goto('/id/classroom-groups');
    await buildRoster(page, [['F', 'Ana']], '/id/classroom-groups');
    await typeInto(page.getByLabel('Kelas (opsional)'), '7B');
    await page.locator('#cg-io-toggle').click();
    const name = await downloadName(page, 'Ekspor daftar kelas');
    expect(name).toBe(`7B-daftar-kelas-${todayISO()}.csv`);
  });
});

/**
 * Stage 4, Task 6. W-01…W-13, Y-02…Y-04.
 *
 * Both directions are driven by the SAME parameterised case, because
 * "bidirectional" is precisely the kind of claim that gets made about code
 * that only works one way.
 */
test.describe('exporting in both languages', () => {
  for (const [from, to, firstFile, secondFile, secondButton, destination] of [
    [
      '/classroom-groups',
      '/id/classroom-groups',
      'class-list',
      'daftar-kelas',
      'Ekspor daftar kelas',
      'Bahasa Indonesia',
    ],
    [
      '/id/classroom-groups',
      '/classroom-groups',
      'daftar-kelas',
      'class-list',
      'Export class list',
      'English',
    ],
  ] as const) {
    test(`works starting from ${from}`, async ({ page, context }) => {
      await buildRosterAtPath(page, from, [
        ['F', 'Ana'],
        ['M', 'Budi'],
      ]);
      await page.locator('#cg-io-toggle').click();

      const [download, newPage] = await Promise.all([
        page.waitForEvent('download'),
        context.waitForEvent('page'),
        handoverTo(page, destination),
      ]);

      expect(download.suggestedFilename()).toContain(firstFile);
      await newPage.waitForLoadState();
      expect(new URL(newPage.url()).pathname).toBe(to);

      await newPage.locator('#cg-students-toggle').click();
      await expect(newPage.locator('.cg-student')).toHaveCount(2);
      await expect(
        newPage
          .locator('.cg-student')
          .first()
          .getByLabel(/Name|Nama/),
      ).toHaveValue('Ana');

      await newPage.locator('#cg-io-toggle').click();
      const [second] = await Promise.all([
        newPage.waitForEvent('download'),
        newPage.getByRole('button', { name: secondButton }).click(),
      ]);
      expect(second.suggestedFilename()).toContain(secondFile);
    });
  }

  // The sex value must cross as the ENGINE's own 'M'/'F', not as the page's
  // rendered letter -- otherwise an Indonesian 'P' arrives on the English
  // page as a sex it does not recognise. The letters differ between the two
  // pages, which is exactly why this is worth pinning.
  test('a sex survives the crossing, in the receiving page own letters', async ({
    page,
    context,
  }) => {
    await buildRosterAtPath(page, '/classroom-groups', [['F', 'Ana']]);
    await page.locator('#cg-io-toggle').click();
    const [, newPage] = await Promise.all([
      page.waitForEvent('download'),
      context.waitForEvent('page'),
      handoverTo(page, 'Bahasa Indonesia'),
    ]);
    await newPage.waitForLoadState();
    await newPage.locator('#cg-students-toggle').click();
    await expect(
      newPage.locator('.cg-student').first().getByLabel('Jenis kelamin'),
    ).toHaveValue('F');
    // …and the Indonesian page shows it as P, its own letter for the same fact.
    await expect(
      newPage
        .locator('.cg-student')
        .first()
        .getByLabel('Jenis kelamin')
        .locator('option:checked'),
    ).toHaveText('P');
  });

  test('nothing is written to storage and nothing is in a URL', async ({
    page,
    context,
  }) => {
    await buildRosterAtPath(page, '/classroom-groups', [['F', 'Ana']]);
    await page.locator('#cg-io-toggle').click();
    const [, newPage] = await Promise.all([
      page.waitForEvent('download'),
      context.waitForEvent('page'),
      handoverTo(page, 'Bahasa Indonesia'),
    ]);
    await newPage.waitForLoadState();
    await newPage.locator('#cg-students-toggle').click();
    await expect(newPage.locator('.cg-student')).toHaveCount(1);
    for (const p of [page, newPage])
      await expectNothingStored(p, 'after the handover', 'Ana');
  });

  test('the source keeps the roster until the new tab acknowledges', async ({
    page,
    context,
  }) => {
    await buildRosterAtPath(page, '/classroom-groups', [['F', 'Ana']]);
    await page.locator('#cg-io-toggle').click();
    const [, newPage] = await Promise.all([
      page.waitForEvent('download'),
      context.waitForEvent('page'),
      handoverTo(page, 'Bahasa Indonesia'),
    ]);
    await newPage.waitForLoadState();
    await newPage.locator('#cg-students-toggle').click();
    await expect(newPage.locator('.cg-student')).toHaveCount(1);
    await expect(page.locator('.cg-student')).toHaveCount(1); // still there
    await expect(
      page.getByText('Your class list is now open in Bahasa Indonesia.'),
    ).toBeVisible();
  });

  test('a blocked tab is reported and the roster is kept', async ({
    page,
    context,
  }) => {
    await context.addInitScript(() => {
      window.open = () => null;
    });
    await buildRosterAtPath(page, '/classroom-groups', [['F', 'Ana']]);
    await page.locator('#cg-io-toggle').click();
    // The file still saves -- a blocked pop-up must not cost a teacher the
    // export they actually asked for.
    const [download] = await Promise.all([
      page.waitForEvent('download'),
      handoverTo(page, 'Bahasa Indonesia'),
    ]);
    expect(download.suggestedFilename()).toContain('class-list');
    await expect(
      page.getByText(
        'The second tab could not be opened. Your class list is still here — ' +
          'allow pop-ups and try again.',
      ),
    ).toBeVisible();
    await expect(page.locator('.cg-student')).toHaveCount(1);
    // "Try again" is a second press, so the list stays open with the button
    // that sentence is about. Closing it here passed until #390 IO5.
    await expect(
      page.getByRole('button', { name: 'Bahasa Indonesia' }),
    ).toBeVisible();
  });

  // A tab that opens but never asks -- the other half of "the handover must
  // never lose data by failing silently". Condition-based: this waits for
  // the sentence to appear, never for a fixed number of milliseconds.
  test('a tab that never asks is reported, and the roster is kept', async ({
    page,
    context,
  }) => {
    await context.addInitScript(() => {
      // A window that opens and does nothing -- the shape of a tab that
      // loads but whose script never runs (a school filter, a failed
      // deploy). Truthy, so it is not the blocked case.
      window.open = () => ({ closed: false }) as unknown as Window;
    });
    await buildRosterAtPath(page, '/classroom-groups', [['F', 'Ana']]);
    await page.locator('#cg-io-toggle').click();
    await Promise.all([
      page.waitForEvent('download'),
      handoverTo(page, 'Bahasa Indonesia'),
    ]);
    await expect(
      page.getByText(
        'The second tab never asked for the class list. Your class list is ' +
          'still here — close that tab and try again.',
      ),
    ).toBeVisible({ timeout: 15000 });
    await expect(page.locator('.cg-student')).toHaveCount(1);
  });

  // The sender answers ONE window, the tab it opened. Any other document on
  // this origin can post a `cg-ack` -- here the page itself does -- and
  // believing it would report a handover as done while the tab that was
  // opened never even asked. Nothing staged a stranger until #390 IO1, so
  // the `event.source` check could be deleted with the whole spec green.
  // The timeout sentence arriving is what proves the forged ack was refused:
  // a believed ack settles the handover and the timeout never speaks.
  test('an acknowledgement from any window but the opened tab is ignored', async ({
    page,
    context,
  }) => {
    await context.addInitScript(() => {
      window.open = () => ({ closed: false }) as unknown as Window;
    });
    await buildRosterAtPath(page, '/classroom-groups', [['F', 'Ana']]);
    await page.locator('#cg-io-toggle').click();
    await Promise.all([
      page.waitForEvent('download'),
      handoverTo(page, 'Bahasa Indonesia'),
    ]);
    await page.evaluate(() =>
      window.postMessage({ kind: 'cg-ack' }, window.location.origin),
    );
    await expect(
      page.getByText(
        'The second tab never asked for the class list. Your class list is ' +
          'still here — close that tab and try again.',
      ),
    ).toBeVisible({ timeout: 15000 });
    await expect(
      page.getByText('Your class list is now open in Bahasa Indonesia.'),
    ).toHaveCount(0);
  });

  // A page opened NORMALLY must not shout into the channel -- otherwise a
  // teacher with two tabs open has one silently overwrite the other.
  // W-13. The whole flow's copy follows the STARTING page, not the file or
  // the destination -- asserted from the Indonesian side, which the
  // parameterised case above exercises for behaviour but not for wording.
  test('the flow speaks the starting page own language, from Indonesian', async ({
    page,
    context,
  }) => {
    await context.addInitScript(() => {
      window.open = () => null;
    });
    await buildRosterAtPath(page, '/id/classroom-groups', [['F', 'Ana']]);
    await page.locator('#cg-io-toggle').click();
    await expect(
      page.getByText(
        'Berkas Anda tersimpan sekarang, dalam bahasa ini. Tab kedua akan ' +
          'terbuka dalam bahasa yang Anda pilih, dengan daftar kelas yang ' +
          'sama, untuk ' +
          'Anda periksa dan simpan di sana. Tidak ada yang disimpan dan ' +
          'tidak ada yang dikirim ke mana pun.',
      ),
    ).toBeVisible();
    await Promise.all([
      page.waitForEvent('download'),
      handoverTo(page, 'English'),
    ]);
    await expect(
      page.getByText(
        'Tab kedua tidak dapat dibuka. Daftar kelas Anda masih ada di ' +
          'sini — izinkan pop-up lalu coba lagi.',
      ),
    ).toBeVisible();
  });

  test('a page opened normally does not ask for anybody roster', async ({
    page,
    context,
  }) => {
    await buildRosterAtPath(page, '/classroom-groups', [['F', 'Ana']]);
    await page.locator('#cg-io-toggle').click();
    const other = await context.newPage();
    // An ABSOLUTE url, built from the page under test. `context.newPage()`
    // carries no `baseURL` over a CDP connection to a real phone, so a
    // relative path there is "Cannot navigate to invalid URL" -- found on
    // real Android, where every other page in this suite comes from the
    // `page` fixture and never hits it.
    await other.goto(new URL('/id/classroom-groups', page.url()).href);
    await other.locator('#cg-students-toggle').click();
    await expect(other.locator('.cg-student')).toHaveCount(0);
    await expect(page.locator('.cg-student')).toHaveCount(1);
  });
});

/**
 * #21 Stage 3. The destination is the teacher's to choose.
 *
 * It used to be `otherLocales(locale)[0]` — the FIRST alternative, taken
 * without asking, which is only ever the right one while there is exactly
 * one of them. `tests/unit/locale-switcher.test.ts` failed on purpose to stop
 * a third locale shipping that silent choice; these are what retire it.
 *
 * A DISCLOSURE OF BUTTONS, not choose-then-send. `window.open` has to run
 * inside the click that asked for it or the browser blocks the tab — which is
 * why `ioHandoverBlocked` exists at all. Pressing the language IS the gesture,
 * so there is no stored choice to read back outside one.
 */
test.describe('the handover destination is chosen, not assumed', () => {
  test('keeps the list shut until it is asked for', async ({ page }) => {
    await buildRosterAtPath(page, '/classroom-groups', [['F', 'Ana']]);
    await openIo(page);
    // `.first()`, because there is one button per other language now (four,
    // since #22) and a bare locator would be a strict-mode violation rather
    // than an assertion. The list is one `<details>`, so shut is shut for all.
    await expect(page.locator('.cg-io-both-target').first()).toBeHidden();
    await page.locator('#cg-io-both-toggle').click();
    await expect(page.locator('.cg-io-both-target').first()).toBeVisible();
  });

  test('offers one button per other language, named in that language', async ({
    page,
  }) => {
    await buildRosterAtPath(page, '/classroom-groups', [['F', 'Ana']]);
    await openIo(page);
    await page.locator('#cg-io-both-toggle').click();

    // Derived from LOCALES: this asserted a count of 1 and the single name
    // 'Bahasa Indonesia', which was a fact about there being two languages
    // rather than about the picker. Every other language, each checked.
    const others = otherLocales('en');
    const choices = page.locator('.cg-io-both-target');
    await expect(choices).toHaveCount(others.length);
    for (const locale of others) {
      // Its OWN name, and `lang` so a screen reader says it in that language
      // rather than spelling it out in English -- the same rule the header
      // switcher follows (tests/e2e/language-switcher.spec.ts).
      const choice = choices.filter({
        hasText: LOCALE_METADATA[locale].nativeName,
      });
      await expect(choice, `a button for ${locale}`).toHaveCount(1);
      await expect(choice).toHaveAttribute('lang', locale);
    }
  });

  test('draws the flag from the page own sprite, not a second copy', async ({
    page,
  }) => {
    await buildRosterAtPath(page, '/classroom-groups', [['F', 'Ana']]);
    await openIo(page);
    await page.locator('#cg-io-both-toggle').click();

    // `<use href="#flag-id">` resolving against a symbol the page defines is
    // what proves the picker and the header switcher draw the SAME shapes.
    // A broken reference renders nothing at all and reads as a spacing bug.
    for (const locale of otherLocales('en')) {
      const flag = `#flag-${LOCALE_METADATA[locale].flag}`;
      await expect(
        page
          .locator('.cg-io-both-target')
          .filter({ hasText: LOCALE_METADATA[locale].nativeName })
          .locator('svg.flag use'),
        `${locale} draws ${flag}`,
      ).toHaveAttribute('href', flag);
      await expect(page.locator(`symbol${flag}`)).toHaveCount(1);
    }
  });

  test('gives every language button a real touch target', async ({ page }) => {
    // `.cg-io-both` shipped under the 44px floor once already; the rule that
    // fixed it selects by CONTAINER so a new button cannot be missed. These
    // buttons are new, and inside a `<details>` -- assert, do not assume.
    await buildRosterAtPath(page, '/classroom-groups', [['F', 'Ana']]);
    await openIo(page);
    const summary = page.locator('#cg-io-both-toggle');
    await atLeast44(summary, '#cg-io-both-toggle');
    await summary.click();
    const choices = page.locator('.cg-io-both-target');
    // `.all()` resolves to [] when nothing matches -- it neither waits nor
    // fails -- so without this count the loop below runs zero times and a
    // WCAG touch-target test passes having measured nothing. Proven, not
    // assumed: pointing this locator at a class that does not exist left the
    // test green (#87). Derived from LOCALES rather than hardcoded, because
    // one button is rendered per OTHER locale and that number is going to
    // change.
    await expect(choices).toHaveCount(otherLocales('en').length);
    for (const choice of await choices.all()) {
      await atLeast44(choice);
    }
  });

  test('does not drop the keyboard where the list just closed', async ({
    page,
    context,
  }) => {
    // The list closes once the tab is open, which takes the button that was
    // just pressed out of the document's focus order with it. Left alone the
    // browser drops focus onto `<body>` and a teacher tabbing through the
    // section restarts at the top of the page (WCAG 2.4.3).
    await buildRosterAtPath(page, '/classroom-groups', [['F', 'Ana']]);
    await openIo(page);
    await Promise.all([
      page.waitForEvent('download'),
      context.waitForEvent('page'),
      handoverTo(page, 'Bahasa Indonesia'),
    ]);
    // `document.activeElement`, not `toBeFocused`. The handover has just
    // moved the BROWSER's focus to the new tab, so this page is not the
    // focused one and `toBeFocused` reports `inactive` in Firefox whatever
    // the document says. What matters is where this document's focus sits
    // when the teacher comes back to it.
    expect(await page.evaluate(() => document.activeElement?.id)).toBe(
      'cg-io-both-toggle',
    );
  });

  // Every other language, derived. Pressing only Bahasa Indonesia, the FIRST
  // alternative, could not tell the pressed language from "the first one":
  // routing every handover to `otherLocales(locale)[0]` passed the whole spec
  // (#390 IO2). The last alternative is where that difference shows.
  for (const locale of otherLocales('en')) {
    const { nativeName } = LOCALE_METADATA[locale];
    test(`names the language it opened, not "the other one": ${locale}`, async ({
      page,
      context,
    }) => {
      await buildRosterAtPath(page, '/classroom-groups', [['F', 'Ana']]);
      await openIo(page);
      const [, newPage] = await Promise.all([
        page.waitForEvent('download'),
        context.waitForEvent('page'),
        handoverTo(page, nativeName),
      ]);
      await newPage.waitForLoadState();
      expect(new URL(newPage.url()).pathname).toBe(toolPath(locale));
      await expect(
        page.getByText(`Your class list is now open in ${nativeName}.`),
      ).toBeVisible();
    });
  }
});

/**
 * Review finding C2, fixed and pinned.
 *
 * The handover used to run over a `BroadcastChannel`, which is ORIGIN-WIDE.
 * For the seconds a handover was live, any other document on this origin
 * could have asked for the roster in one line and been handed every child's
 * name -- a hole straight through this page's headline promise, and one the
 * existing privacy tests could not see because they only ever inspect the
 * two tabs they know about.
 *
 * These three are the tests that make the fix real.
 */
test.describe('the handover cannot be overheard', () => {
  test('a third same-origin tab that asks is given nothing', async ({
    page,
    context,
  }) => {
    await buildRosterAtPath(page, '/classroom-groups', [
      ['F', 'Ana'],
      ['M', 'Budi'],
    ]);
    await page.locator('#cg-io-toggle').click();

    // An ordinary third tab on the same origin, listening on BOTH the old
    // channel and its own window, and asking every way the protocol has
    // ever used. It must hear nothing at all.
    const eavesdropper = await context.newPage();
    await eavesdropper.goto(new URL('/classroom-groups', page.url()).href);
    await eavesdropper.evaluate(() => {
      const heard: unknown[] = [];
      (window as unknown as { __heard: unknown[] }).__heard = heard;
      window.addEventListener('message', (e) => heard.push(e.data));
      if (typeof BroadcastChannel === 'function') {
        const channel = new BroadcastChannel('cg-handover');
        channel.addEventListener('message', (e) => heard.push(e.data));
        channel.postMessage({ kind: 'ask', id: 'any' });
        channel.postMessage({ kind: 'cg-ask' });
      }
    });

    const [, receiver] = await Promise.all([
      page.waitForEvent('download'),
      context.waitForEvent('page'),
      handoverTo(page, 'Bahasa Indonesia'),
    ]);
    await receiver.waitForLoadState();
    // The legitimate receiver got it…
    await receiver.locator('#cg-students-toggle').click();
    await expect(receiver.locator('.cg-student')).toHaveCount(2);

    // …and the third tab got nothing, by any route. Asked again mid-flight
    // for good measure.
    await eavesdropper.evaluate(() => {
      if (typeof BroadcastChannel === 'function') {
        new BroadcastChannel('cg-handover').postMessage({
          kind: 'ask',
          id: 'any',
        });
      }
    });
    const heard = await eavesdropper.evaluate(
      () => (window as unknown as { __heard: unknown[] }).__heard,
    );
    expect(JSON.stringify(heard)).not.toContain('Ana');
    expect(JSON.stringify(heard)).not.toContain('Budi');
    await expect(eavesdropper.locator('.cg-student')).toHaveCount(0);
  });

  test('a reloaded receiver does not arm itself again', async ({
    page,
    context,
  }) => {
    await buildRosterAtPath(page, '/classroom-groups', [['F', 'Ana']]);
    await page.locator('#cg-io-toggle').click();
    const [, receiver] = await Promise.all([
      page.waitForEvent('download'),
      context.waitForEvent('page'),
      handoverTo(page, 'Bahasa Indonesia'),
    ]);
    await receiver.waitForLoadState();
    await receiver.locator('#cg-students-toggle').click();
    await expect(receiver.locator('.cg-student')).toHaveCount(1);

    // The hash is spent: it is gone from the URL, so a reload cannot make
    // this tab go looking for somebody's class list a second time.
    expect(new URL(receiver.url()).hash).toBe('');
    await receiver.reload();
    await receiver.locator('#cg-students-toggle').click();
    await expect(receiver.locator('.cg-student')).toHaveCount(0);
  });

  test('a receiver with work of its own is warned before it is replaced', async ({
    page,
    context,
  }) => {
    await buildRosterAtPath(page, '/classroom-groups', [
      ['F', 'Ana'],
      ['M', 'Budi'],
    ]);
    await page.locator('#cg-io-toggle').click();
    const [, receiver] = await Promise.all([
      page.waitForEvent('download'),
      context.waitForEvent('page'),
      handoverTo(page, 'Bahasa Indonesia'),
    ]);
    await receiver.waitForLoadState();
    await expect(receiver.locator('.cg-student')).toHaveCount(2);

    // Now the teacher types a class of their own into the receiving tab and
    // a SECOND handover arrives. Design spec section 9: "Never silent, even
    // when the counts match."
    await buildRoster(
      receiver,
      [
        ['F', 'Gita'],
        ['M', 'Hani'],
        ['F', 'Sari'],
      ],
      new URL('/id/classroom-groups', receiver.url()).href,
    );
    const [, second] = await Promise.all([
      page.waitForEvent('download'),
      context.waitForEvent('page'),
      handoverTo(page, 'Bahasa Indonesia'),
    ]);
    await second.waitForLoadState();
    // The NEW tab takes it, because it is empty…
    await second.locator('#cg-students-toggle').click();
    await expect(second.locator('.cg-student')).toHaveCount(2);
    // …and the tab the teacher was working in is untouched.
    await expect(receiver.locator('.cg-student')).toHaveCount(3);
    await expect(
      receiver.locator('.cg-student').first().getByLabel('Nama'),
    ).toHaveValue('Gita');
  });
});

test.describe('review findings — import', () => {
  // I2. `File.text()` genuinely rejects. Unhandled it skipped everything
  // below it, so the teacher saw nothing at all -- and because the input's
  // value was cleared AFTER the read, picking the same file again fired no
  // change event and the page ignored them a second time.
  test('a file that cannot be read says so, and can be tried again', async ({
    page,
  }) => {
    await page.goto('/classroom-groups');
    await openIo(page);
    // Make the read fail the way a moved or un-materialised cloud file
    // does, once. The second attempt is a real read.
    await page.evaluate(() => {
      const original = File.prototype.text;
      let failed = false;
      File.prototype.text = function () {
        if (failed) return original.call(this);
        failed = true;
        return Promise.reject(new DOMException('nope', 'NotReadableError'));
      };
    });
    await upload(page, 'moved.csv', 'number,name\n1,Ana\n');
    await expect(
      page.getByText('That file could not be read. Try choosing it again.'),
    ).toBeVisible();

    // The SAME file again, which is what a teacher would do -- and it has
    // to fire at all, which it did not while the value was left in place.
    await upload(page, 'moved.csv', 'number,name\n1,Ana\n');
    await expect(page.locator('.cg-student')).toHaveCount(1);
    await expect(page.getByText(/could not be read/)).toHaveCount(0);
  });

  // I5. `if (className !== '')` left the previous class's name in place, so
  // 8C's list printed under 7B and exported as 7B-class-list-….csv.
  test('importing a file with no class name clears the old one', async ({
    page,
  }) => {
    await page.goto('/classroom-groups');
    await typeInto(page.getByLabel('Class (optional)'), '7B');
    await openIo(page);
    await upload(page, 'unnamed.csv', 'number,name\n1,Gita\n2,Hani\n');
    await expect(page.locator('.cg-student')).toHaveCount(2);
    await expect(page.getByLabel('Class (optional)')).toHaveValue('');
    // …and the next export is not filed under the class that is gone.
    const name = await downloadName(page, 'Export class list');
    expect(name).not.toContain('7B');
  });

  test('and an import that HAS a name takes it', async ({ page }) => {
    await page.goto('/classroom-groups');
    await typeInto(page.getByLabel('Class (optional)'), '7B');
    await openIo(page);
    await upload(page, 'named.csv', '# Class: 8C\nnumber,name\n1,Gita\n');
    await expect(page.getByLabel('Class (optional)')).toHaveValue('8C');
  });
});

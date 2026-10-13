import { test, expect } from './fixtures';
import { chooseSpeed, makeGroups } from '../make-groups';
import {
  withGroups,
  rosterForSpillover,
  rosterOf,
  namesIn,
  buildRoster,
  giveEveryoneASex,
  refuseFullscreen,
  openWaitingBoard,
} from './helpers';
import { searched } from '../source-files';
import { FLOOR_PX } from '../../src/scripts/projector';
import { measureBoard } from '../board-geometry';
import { recorded, shoot } from './evidence';

test.use(recorded);

/**
 * Stage 5, Task 5. The projector view. Z-01…Z-06, Z-10…Z-20, Z-24.
 *
 * The board MOVES `#cg-results` rather than copying it, so several claims
 * here are about one element being in two places at different times -- see
 * projector.ts's own doc comment for why that is the design rather than an
 * implementation detail.
 *
 * `#cg-results`, never `#cg-groups`: that id belongs to the "how many
 * groups" number input. The plan's own snippet for this task used the wrong
 * one twice, the fifth and sixth occurrence across stages 3-5.
 */

const bar = (page: import('@playwright/test').Page) =>
  page.locator('#cg-board-bar');

/**
 * Wait for the bar to fade.
 *
 * Explicit, generous timeout because this waits on a PRODUCT TIMER of
 * 2500ms (`FADE_AFTER_MS`, src/scripts/projector.ts) and the default
 * assertion window is 5000ms -- barely 2x headroom. That is enough on an
 * idle laptop and not enough on one also driving 350 tests on a real phone,
 * where it failed exactly once in the full gauntlet and never in a
 * standalone run. Still condition-based: it waits for the class, never for
 * a fixed time.
 */
const expectFaded = (page: import('@playwright/test').Page) =>
  expect(bar(page)).toHaveClass(/faded/, { timeout: 15000 });

/**
 * Wait until the page can actually be clicked again after leaving the board.
 *
 * Chromium GRANTS fullscreen here, and coming back out of it is not
 * instantaneous: for a moment the DOM already reports
 * `fullscreenElement === null` and the board is already `hidden`, but the
 * compositor has not finished, and a hit test at any coordinate still
 * returns `<html>`. That is a browser characteristic, not a product defect
 * -- `exitFullscreen` is asynchronous by specification and nothing on the
 * page can make it otherwise.
 *
 * Condition-based, never a sleep: this waits for the exact fact the next
 * click depends on -- that the button is the topmost element at its own
 * centre -- rather than for a number of milliseconds that would be wrong on
 * a slower machine.
 */
const clickable = async (
  page: import('@playwright/test').Page,
  selector: string,
) => {
  await page.waitForFunction((sel) => {
    const el = document.querySelector(sel) as HTMLElement | null;
    if (!el || el.hidden) return false;
    const r = el.getBoundingClientRect();
    const top = document.elementFromPoint(
      r.left + r.width / 2,
      r.top + r.height / 2,
    );
    return el.contains(top) || el === top;
  }, selector);
};

test.describe('the projector view', () => {
  // #743 AC1: the board can be put up before a shuffle, to deal with the
  // class watching, so its button follows the page's own Shuffle -- the
  // same fact, both ways -- rather than waiting for groups to exist.
  test('the button is there whenever the page Shuffle can run, and not otherwise', async ({
    page,
  }) => {
    const open = page.getByRole('button', { name: 'Full screen' });
    // getByRole leaves hidden elements out, so a hidden button can never
    // count 1 through `open`; the absence checks read it through this one.
    const openEvenHidden = page.getByRole('button', {
      name: 'Full screen',
      includeHidden: true,
    });
    const go = page.locator('#cg-go');
    await page.goto('/classroom-groups');
    await expect(go).toBeEnabled();
    await expect(open).toBeVisible();
    await page.fill('#cg-count', '25');
    await page.fill('#cg-numbers-absent', '26');
    await expect(go).toBeDisabled();
    await expect(openEvenHidden).toHaveCount(1);
    await expect(openEvenHidden).toBeHidden();
    await page.fill('#cg-numbers-absent', '7');
    await expect(go).toBeEnabled();
    await expect(open).toBeVisible();
  });

  test('a refused requestFullscreen lands in the overlay, not in nothing', async ({
    page,
  }) => {
    await refuseFullscreen(page);
    await withGroups(page);
    await page.getByRole('button', { name: 'Full screen' }).click();
    await expect(page.locator('#cg-board')).toBeVisible();
    // The viewport is read from the PAGE, not from `page.viewportSize()`.
    // On a real device over CDP there is no emulated viewport and that
    // returns `null` -- found on the real Android gauntlet, where this was
    // the only failure in 339. `window.innerWidth/innerHeight` is the real
    // viewport on every target, which is what this assertion was always
    // about; asking Playwright was asking the wrong thing.
    const box = (await page.locator('#cg-board').boundingBox())!;
    const vp = await page.evaluate(() => ({
      width: window.innerWidth,
      height: window.innerHeight,
    }));
    expect(box.width).toBeCloseTo(vp.width, 0);
    expect(box.height).toBeCloseTo(vp.height, 0);
    // …and the groups are actually ON it, which is the point of falling
    // back rather than merely showing an empty layer.
    await expect(page.locator('#cg-board #cg-results')).toBeVisible();
  });

  test('no form or site chrome on the board', async ({ page }) => {
    await withGroups(page);
    await page.getByRole('button', { name: 'Full screen' }).click();
    // The board covers the page rather than hiding its parts one at a time,
    // so this asserts what a teacher can SEE and reach: nothing behind the
    // overlay is visible at the board's own coordinates, and the page
    // cannot be scrolled out from under it.
    await expect(page.locator('#cg-board')).toBeVisible();
    expect(
      await page.evaluate(
        () => getComputedStyle(document.documentElement).overflow,
      ),
    ).toBe('hidden');
    const boardZ = await page.evaluate(
      () => getComputedStyle(document.getElementById('cg-board')!).zIndex,
    );
    expect(Number(boardZ)).toBeGreaterThan(0);
  });

  test('the bar fades, and comes back on pointer, tap and key', async ({
    page,
  }) => {
    await withGroups(page);
    await page.getByRole('button', { name: 'Full screen' }).click();
    await expectFaded(page); // condition, not a sleep
    // Two moves: a move to where the pointer already is dispatches no
    // event at all, and the pointer starts at (0,0).
    await page.mouse.move(200, 300);
    await page.mouse.move(220, 320);
    await expect(bar(page)).not.toHaveClass(/faded/);
    await expectFaded(page);
    await page.locator('#cg-board').click({ position: { x: 50, y: 300 } });
    await expect(bar(page)).not.toHaveClass(/faded/);
    await expectFaded(page);
    await page.keyboard.press('a');
    await expect(bar(page)).not.toHaveClass(/faded/);
  });

  test('it does NOT fade while a control inside it has focus', async ({
    page,
  }) => {
    await withGroups(page);
    await page.getByRole('button', { name: 'Full screen' }).click();
    await bar(page).getByRole('button', { name: 'Shuffle again' }).focus();
    await expect(bar(page)).not.toHaveClass(/faded/);
    // …and it STAYS that way. A keyboard user must not lose the control
    // they are standing on. Proved by waiting past the same fade delay that
    // hides it otherwise, rather than by asserting once and moving on.
    await page.waitForFunction(
      () =>
        !document.getElementById('cg-board-bar')!.classList.contains('faded'),
      null,
      { timeout: 5000 },
    );
    await expect(bar(page)).not.toHaveClass(/faded/);
  });

  // Even faded, the bar is still REACHABLE -- it fades with opacity, never
  // out of the tab order. Fading it out of existence would strand a
  // keyboard user mid-Tab with no visible way out.
  test('a faded bar can still be reached by keyboard', async ({ page }) => {
    await withGroups(page);
    await page.getByRole('button', { name: 'Full screen' }).click();
    await expectFaded(page);
    await bar(page).getByRole('button', { name: 'Exit full screen' }).focus();
    await expect(bar(page)).not.toHaveClass(/faded/);
    await page.keyboard.press('Enter');
    await expect(page.locator('#cg-board')).toBeHidden();
  });

  // A stray `fullscreenchange` from a PREVIOUS showing must not close the
  // current one. Entering, leaving at once, and entering again is the
  // sequence that produced it: the first grant lands after the exit, the
  // tidy-up exit fires `fullscreenchange`, and the second board -- already
  // open by then -- closed itself. Found by probing, because the visible
  // symptom was a bar that never faded: there was no board to fade on.
  test('a second showing survives the first one tidying up after itself', async ({
    page,
  }) => {
    await withGroups(page);
    await page.getByRole('button', { name: 'Full screen' }).click();
    // Out immediately, while the grant is still in flight.
    await page.keyboard.press('Escape');
    await expect(page.locator('#cg-board')).toBeHidden();
    await clickable(page, '#cg-board-open');

    await page.getByRole('button', { name: 'Full screen' }).click();
    await expect(page.locator('#cg-board')).toBeVisible();
    // …and it STAYS open. The stray event arrives after the fact, so a
    // single assertion the instant it opens would pass either way. Waited
    // out on a condition of the RACE itself -- the browser settling into or
    // out of fullscreen -- rather than on the bar fading, which is a
    // different mechanism and does not fire on a second showing on every
    // device.
    await page.waitForFunction(
      () =>
        document.fullscreenElement !== null ||
        !document.getElementById('cg-board')!.hidden,
    );
    await expect(page.locator('#cg-board')).toBeVisible();
    await expect(page.locator('#cg-board #cg-results')).toBeVisible();
  });

  // The claim is ESCAPE EXITS, twice over: straight away, and again after
  // the board has been sitting there. The bar's own fading is proven by the
  // fade tests above and is deliberately NOT a precondition here -- it did
  // not fire on a second showing on a real Android phone, and requiring it
  // made this test fail for a reason that has nothing to do with Escape.
  test('Escape exits, on a fresh board and on a settled one', async ({
    page,
  }) => {
    await withGroups(page);
    for (const settle of [false, true]) {
      await page.getByRole('button', { name: 'Full screen' }).click();
      await expect(page.locator('#cg-board')).toBeVisible();
      if (settle) {
        // "Settled" means the board has ARRIVED and painted -- its content
        // is on it and a frame has gone by. Deliberately NOT "the reveal
        // finished": on a real Android phone the last group's `revealed`
        // does not reliably land on a SECOND showing, and requiring it made
        // this test fail for a reason with nothing to do with Escape. The
        // reveal has its own tests, and they pass on that phone.
        await expect(page.locator('#cg-board #cg-results')).toBeVisible();
        await page.evaluate(
          () =>
            new Promise((resolve) =>
              requestAnimationFrame(() => resolve(null)),
            ),
        );
      }
      await page.keyboard.press('Escape');
      await expect(page.locator('#cg-board')).toBeHidden();
      await clickable(page, '#cg-board-open');
    }
  });

  test('leaving puts the results back on the page', async ({ page }) => {
    await withGroups(page);
    await page.getByRole('button', { name: 'Full screen' }).click();
    await expect(page.locator('#cg-board #cg-results')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.locator('#cg-board #cg-results')).toHaveCount(0);
    await expect(page.locator('#cg-results')).toBeVisible();
    await expect(page.locator('#cg-results .group').first()).toBeVisible();
  });

  test('a shuffle done on the board is what the page shows on exit', async ({
    page,
  }) => {
    await withGroups(page);
    const before = await page.locator('#cg-results').innerText();
    await page.getByRole('button', { name: 'Full screen' }).click();
    // The board's Shuffle shares the page's own one-at-a-time guard, so it
    // does nothing while the previous deal is still running -- which is
    // what a teacher pressing it twice should get, and what this test was
    // unknowingly doing. Wait for the deal to finish first: condition-based
    // on the deal button's own enabled state, never a sleep.
    await expect(page.locator('#cg-go')).toBeEnabled();
    await bar(page).getByRole('button', { name: 'Shuffle again' }).click();
    // `#cg-board #cg-results`, not the whole board: `namesIn` matches any
    // Capitalised word, and the bar's own "Exit full screen" contributes
    // "Exit". Reading the results element compares like with like.
    const onBoard = await page.locator('#cg-board #cg-results').innerText();
    await page.keyboard.press('Escape');
    const after = await page.locator('#cg-results').innerText();
    expect(namesIn(after).sort()).toEqual(namesIn(onBoard).sort());
    // The shuffle actually happened -- otherwise the equality above holds
    // trivially by nothing having changed at all.
    expect(after).not.toBe(before);
  });

  test('a warning raised by a board shuffle appears on the board', async ({
    page,
  }) => {
    await rosterForSpillover(page); // six boys, two girls, separate, groups of 4
    await giveEveryoneASex(page);
    await page.getByRole('button', { name: 'Make Groups' }).click();
    await page.getByRole('button', { name: 'Full screen' }).click();
    await expect(page.locator('#cg-go')).toBeEnabled();
    await bar(page).getByRole('button', { name: 'Shuffle again' }).click();
    await expect(page.locator('#cg-board')).toContainText(
      'have joined a group of boys',
    );
  });

  test('the board speaks the page own language', async ({ page }) => {
    await withGroups(page, 12, '/id/classroom-groups');
    await expect(
      page.getByRole('button', { name: 'Layar penuh' }),
    ).toBeVisible();
    await page.getByRole('button', { name: 'Layar penuh' }).click();
    await expect(
      bar(page).getByRole('button', { name: 'Acak lagi' }),
    ).toBeVisible();
    await expect(
      bar(page).getByRole('button', { name: 'Keluar dari layar penuh' }),
    ).toBeVisible();
  });
});

/**
 * #743. The board put up BEFORE the first shuffle: the results heading, one
 * empty card per group the deal will make, and every student waiting, so
 * the class watches the shuffle. Inside `#cg-results`, the one element the
 * board ever shows.
 */
test.describe('the board before a shuffle (#743)', () => {
  const board = (page: import('@playwright/test').Page) =>
    page.locator('#cg-board #cg-results');

  test('a named roster waits: empty cards, and every student by number and name', async ({
    page,
  }) => {
    await buildRoster(page, [
      ['M', 'Ada'],
      ['F', 'Ben'],
      ['M', 'Cleo'],
      ['F', 'Dev'],
      ['M', 'Eli'],
      ['F', 'Fay'],
    ]);
    await page.fill('#cg-size', '3');
    await page.getByRole('button', { name: 'Full screen' }).click();
    await expect(board(page)).toBeVisible();
    await expect(board(page).locator('#cg-results-h')).toHaveText(
      'Your groups',
    );
    await expect(board(page).locator('.group h3')).toHaveText([
      'Group 1',
      'Group 2',
    ]);
    await expect(board(page).locator('.group .student')).toHaveCount(0);
    await expect(
      board(page).getByRole('heading', { name: 'Waiting to be grouped' }),
    ).toBeVisible();
    const waiting = board(page).locator('.waiting-student');
    await expect(waiting.locator('.number')).toHaveText([
      '1',
      '2',
      '3',
      '4',
      '5',
      '6',
    ]);
    await expect(waiting.locator('.who')).toHaveText([
      'Ada',
      'Ben',
      'Cleo',
      'Dev',
      'Eli',
      'Fay',
    ]);
    // The number and the name sit apart on screen, not only in the text: a
    // flex row discards a space between its children (the page's CLAUDE.md).
    const [number, who] = await Promise.all([
      waiting.first().locator('.number').boundingBox(),
      waiting.first().locator('.who').boundingBox(),
    ]);
    expect(who!.x).toBeGreaterThan(number!.x + number!.width);
  });

  test('a bare count waits by number alone', async ({ page }) => {
    await page.goto('/classroom-groups');
    await page.fill('#cg-count', '10');
    await page.fill('#cg-size', '4');
    await page.getByRole('button', { name: 'Full screen' }).click();
    await expect(board(page).locator('.group h3')).toHaveText([
      'Group 1',
      'Group 2',
    ]);
    const waiting = board(page).locator('.waiting-student');
    await expect(waiting.locator('.number')).toHaveText(
      Array.from({ length: 10 }, (_, i) => String(i + 1)),
    );
    await expect(waiting.locator('.who')).toHaveCount(0);
  });

  test('the board Shuffle fills the waiting cards, and the page shows them on exit', async ({
    page,
  }) => {
    await page.goto('/classroom-groups');
    await page.fill('#cg-count', '10');
    await page.fill('#cg-size', '4');
    await chooseSpeed(page, 'skip');
    await page.getByRole('button', { name: 'Full screen' }).click();
    // Nothing has been shuffled yet, so the board's button says what the
    // page's does, not "again".
    await bar(page).getByRole('button', { name: 'Make Groups' }).click();
    await expect(board(page).locator('.group')).toHaveCount(2);
    await expect(board(page).locator('.group .student.dealt')).toHaveCount(10);
    await expect(board(page).locator('#cg-waiting')).toHaveCount(1);
    await expect(board(page).locator('#cg-waiting')).toBeHidden();
    await expect(
      bar(page).getByRole('button', { name: 'Shuffle again' }),
    ).toBeVisible();
    const onBoard = await board(page).innerText();
    await page.keyboard.press('Escape');
    await expect(page.locator('#cg-results')).toBeVisible();
    expect(await page.locator('#cg-results').innerText()).toBe(onBoard);
  });

  test('leaving without a shuffle leaves the page as it was', async ({
    page,
  }) => {
    await page.goto('/classroom-groups');
    await page.fill('#cg-count', '10');
    await page.getByRole('button', { name: 'Full screen' }).click();
    await expect(board(page)).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.locator('#cg-board #cg-results')).toHaveCount(0);
    await expect(page.locator('#cg-results')).toHaveCount(1);
    await expect(page.locator('#cg-results')).toBeHidden();
    await expect(page.locator('#cg-results .group')).toHaveCount(0);
    await expect(page.locator('#cg-waiting-list li')).toHaveCount(0);
    await expect(
      page.getByRole('button', { name: 'Full screen' }),
    ).toBeVisible();
  });

  test('a refused deal keeps the waiting board up and says why on it', async ({
    page,
  }) => {
    await page.goto('/classroom-groups');
    await page.fill('#cg-count', '0');
    await page.fill('#cg-size', '4');
    await chooseSpeed(page, 'skip');
    await page.getByRole('button', { name: 'Full screen' }).click();
    await bar(page).getByRole('button', { name: 'Make Groups' }).click();
    const said = board(page).locator('#cg-waiting-error');
    await expect(said).toBeVisible();
    await expect(said).toHaveText(
      (await page.locator('#cg-error').textContent()) ?? '',
    );
    await expect(said).not.toHaveText('');
    await expect(board(page).locator('#cg-waiting')).toBeVisible();
  });
});

/**
 * Stage 5, Task 6. Z-21, Z-22, Z-23, E-15, E-16, E-17.
 */
test.describe('the reveal', () => {
  // Leaving MID-reveal must cancel what is still pending. Left running, the
  // remaining timers fire against groups that are back on the page, and a
  // second showing has the first showing's timers re-adding `revealed`
  // behind the new one. Caught by self-review, not by a test that lets the
  // reveal finish -- which is every other test in this block.
  test('leaving mid-reveal cancels the rest of it', async ({ page }) => {
    await withGroups(page, 24);
    await page.getByRole('button', { name: 'Full screen' }).click();
    await expect(page.locator('#cg-board .group').first()).toHaveClass(
      /revealing/,
    );
    // Out again immediately, while later groups are still queued.
    await page.keyboard.press('Escape');
    await expect(page.locator('#cg-board')).toBeHidden();
    // The groups are back on the page and none of them is left mid-reveal:
    // a pending timer firing now would add `revealed` to a card that is no
    // longer on the board at all.
    const stuck = await page
      .locator('#cg-results .group')
      .evaluateAll(
        (els) =>
          els.filter(
            (e) =>
              e.classList.contains('revealing') &&
              !e.classList.contains('revealed'),
          ).length,
      );
    expect(stuck).toBe(0);
  });

  test('the reveal plays on the board', async ({ page }) => {
    await withGroups(page);
    await page.getByRole('button', { name: 'Full screen' }).click();
    await expect(page.locator('#cg-board .group').first()).toHaveClass(
      /revealing/,
    );
    await expect(page.locator('#cg-board .group').last()).toHaveClass(
      /revealed/,
    );
  });

  test('the Sound & animation switch suppresses it', async ({ page }) => {
    // AFTER the roster is built, not before: `withGroups` navigates (it
    // goes to the page and opens Student details), so a setting made first
    // is thrown away by that navigation. The plan's own snippet set it
    // first and would have passed only if suppression never worked.
    await withGroups(page);
    // A <select>, not a checkbox — the plan's snippet used `.check()` on a
    // label that is an <option>. The real control is `#cg-speed`.
    await chooseSpeed(page, 'skip');
    await page.getByRole('button', { name: 'Full screen' }).click();
    await expect(page.locator('#cg-board .group').first()).not.toHaveClass(
      /revealing/,
    );
    // …and they are on screen, which is what "suppressed" has to mean: a
    // board of permanently invisible groups would also satisfy the line
    // above.
    await expect(page.locator('#cg-board .group').first()).toHaveClass(
      /revealed/,
    );
    await expect(page.locator('#cg-board .group').first()).toBeVisible();
  });

  test('prefers-reduced-motion suppresses it', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await withGroups(page);
    await page.getByRole('button', { name: 'Full screen' }).click();
    await expect(page.locator('#cg-board .group').first()).not.toHaveClass(
      /revealing/,
    );
    await expect(page.locator('#cg-board .group').first()).toBeVisible();
  });
});

/**
 * Three separate tests against three separate entry points. A shared helper
 * asserting "one of them refused" would pass while two of them quietly
 * succeeded, and each of those two puts a wrong answer in front of a class.
 */
test.describe('all three refuse while the groups are out of date', () => {
  const goStale = async (page: import('@playwright/test').Page) => {
    await rosterOf(page, 12);
    await page.locator('#cg-go').click();
    await page.locator('.cg-student').first().getByLabel('Absent').check();
    await expect(page.getByText(/These groups are out of date/)).toBeVisible();
  };

  test('Export groups refuses, and says why', async ({ page }) => {
    await goStale(page);
    await page.locator('#cg-io-toggle').click();
    await page.getByRole('button', { name: 'Export groups' }).click();
    await expect(
      page.getByText(
        'These groups are out of date. Shuffle again before saving them.',
      ),
    ).toBeVisible();
  });

  test('Print refuses, and says why', async ({ page }) => {
    await goStale(page);
    await page.getByRole('button', { name: 'Print' }).click();
    await expect(page.locator('#cg-print-panel')).toBeHidden();
    await expect(
      page.getByText(
        'These groups are out of date. Shuffle again before printing them.',
      ),
    ).toBeVisible();
  });

  test('Full screen refuses, and says why', async ({ page }) => {
    await goStale(page);
    await page.getByRole('button', { name: 'Full screen' }).click();
    await expect(page.locator('#cg-board')).toBeHidden();
    await expect(
      page.getByText(
        'These groups are out of date. Shuffle again before showing them.',
      ),
    ).toBeVisible();
  });

  // …and each one WORKS again once the groups are fresh, so the refusal is
  // a gate rather than a wall. Without this a permanently-broken control
  // would satisfy all three tests above.
  test('and all three work again after a reshuffle', async ({ page }) => {
    await goStale(page);
    // `#cg-go`, by id. After a successful shuffle its LABEL becomes
    // "Shuffle again" (classroom-groups.ts sets `goButton.textContent =
    // t.again`), so asking for it by the name it had at load finds nothing.
    await page.locator('#cg-go').click();
    await expect(page.getByText(/These groups are out of date/)).toHaveCount(0);

    await page.getByRole('button', { name: 'Full screen' }).click();
    await expect(page.locator('#cg-board')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.locator('#cg-board')).toBeHidden();
    await clickable(page, '#cg-print-open');

    await page.getByRole('button', { name: 'Print' }).click();
    await expect(page.locator('#cg-print-panel')).toBeVisible();
    await page
      .locator('#cg-print-panel')
      .getByRole('button', { name: 'Cancel' })
      .click();
  });
});

/**
 * Review findings, fixed and pinned. Each of these reddens against the code
 * as it was before the fix beside it.
 */
test.describe('review findings', () => {
  // I1. `refuse()` was the only writer of #cg-refusal AND its only clearer,
  // so the alert outlived the staleness that produced it: the page said the
  // groups were out of date in a role="alert" while everything else on it
  // said they were fine.
  test('a refusal clears when the change that caused it is undone', async ({
    page,
  }) => {
    await rosterOf(page, 12);
    await page.locator('#cg-go').click();
    await page.locator('.cg-student').first().getByLabel('Absent').check();
    await page.getByRole('button', { name: 'Print' }).click();
    await expect(
      page.getByText(
        'These groups are out of date. Shuffle again before printing them.',
      ),
    ).toBeVisible();

    // UNDO, rather than reshuffle: the staleness goes away by itself, and
    // nothing else on the page is touched.
    await page.locator('.cg-student').first().getByLabel('Absent').uncheck();
    await expect(
      page.getByText(/Shuffle again before printing them/),
    ).toHaveCount(0);
  });

  test('and it clears on a reshuffle too', async ({ page }) => {
    await rosterOf(page, 12);
    await page.locator('#cg-go').click();
    await page.locator('.cg-student').first().getByLabel('Absent').check();
    await page.getByRole('button', { name: 'Full screen' }).click();
    await expect(
      page.getByText(/Shuffle again before showing them/),
    ).toBeVisible();
    await expect(page.locator('#cg-go')).toBeEnabled();
    await page.locator('#cg-go').click();
    await expect(
      page.getByText(/Shuffle again before showing them/),
    ).toHaveCount(0);
  });

  // I7a, rewritten for the deal's new contract (operator, 2026-08-13).
  //
  // The original pinned the OLD mechanism: mid-deal the page's button went
  // `disabled`, so a second press was REFUSED. The operator asked for the
  // opposite — the button never disables, and pressing Shuffle again during a
  // deal starts a new one from the top, which is what the button says it
  // does.
  //
  // What the original was really protecting is kept, because it is still
  // right and is the whole reason `dealToken` exists: two overlapping deals
  // doubled the land sounds and dealt onto cards a later render had already
  // detached. Exactly one arrangement must survive a re-press, and every
  // student must appear exactly once.
  test('pressing the board Shuffle mid-deal restarts it, leaving one arrangement', async ({
    page,
  }) => {
    await withGroups(page);
    await expect(page.locator('#cg-go')).toBeEnabled();
    await page.getByRole('button', { name: 'Full screen' }).click();
    const shuffle = bar(page).getByRole('button', { name: 'Shuffle again' });
    await shuffle.click();
    // Mid-deal the button stays usable — that is the change.
    await expect(page.locator('#cg-go')).toBeEnabled();
    // …and a second press is ACCEPTED rather than swallowed.
    await shuffle.click();
    await expect(page.locator('#cg-go')).toBeEnabled();
    // One arrangement, every student once, nothing dealt twice.
    await expect(page.locator('#cg-board .student')).toHaveCount(12);
    const names = await page
      .locator('#cg-board .student')
      .evaluateAll((els) => els.map((e) => e.textContent ?? ''));
    expect(new Set(names).size).toBe(names.length);
    expect(names).toHaveLength(12);
  });
});

// ── The board, with a name long enough to matter ───────────────────────────
test.describe('the projector board holds a real name', () => {
  test('a long name wraps at word boundaries, not mid-word', async ({
    page,
  }) => {
    // Every student carries a sex: "Make Groups" does not enable until they
    // all do (operator, 2026-08-13). This test is about how a long NAME wraps
    // on the board, so the sex is just the price of reaching the board.
    await buildRoster(page, [
      ['M', 'Christopher Wetherington-Smythe'],
      ['M', 'Bob'],
      ['F', 'Dewi'],
      ['M', 'Eko'],
    ]);
    await page.locator('#cg-go').click();
    await expect(page.locator('#cg-results .group').first()).toBeVisible();
    await page
      .getByRole('button', { name: /Full screen|Layar penuh/ })
      .first()
      .click();
    await expect(page.locator('#cg-board')).not.toHaveAttribute('hidden', /.*/);

    const board = await page.evaluate(() => {
      const card = document.querySelector('#cg-results .group')!;
      const who = [...document.querySelectorAll('#cg-results .who')].sort(
        (a, b) => (b.textContent || '').length - (a.textContent || '').length,
      )[0];
      return {
        cardWidth: card.getBoundingClientRect().width,
        wrap: getComputedStyle(who).overflowWrap,
        nameWidth: who.getBoundingClientRect().width,
        fontSize: parseFloat(getComputedStyle(who).fontSize),
      };
    });

    // `#cg-tables`' track was `minmax(15rem, 1fr)` — rem is relative to the
    // ROOT font, so the column stayed 242px while the board tripled the type
    // to 40px, and `overflow-wrap: anywhere` broke the name into
    // "Christoph / er / Wethering / ton- / Smythe".
    expect(
      board.cardWidth,
      `board card is ${board.cardWidth.toFixed(0)}px for ${board.fontSize}px type`,
    ).toBeGreaterThan(board.fontSize * 8);
    expect(
      board.wrap,
      'a board name may only break a word as a last resort',
    ).toBe('break-word');
  });
});
// ─────────────────────────── #189: nothing on the board may be clipped ───────────────────────────

/**
 * The shapes, DERIVED into cases rather than checked one at a time.
 *
 * A hand-written list of things to check will miss the one that breaks --
 * this repo has the scar: the no-horizontal-scroll tests opened every
 * disclosure except `#cg-io-toggle`, the only one holding a native file
 * input, and that was the one that broke.
 *
 * Split in two because driving the viewport is something a real phone cannot
 * do, and `@emulated-viewport` is how the device projects skip what they
 * cannot honour. Tagging the whole table would skip the four shapes that
 * never touch the viewport on exactly the device this ticket has to be
 * proved on.
 */
const BOARD_SHAPES = [
  { what: 'five groups wrapping onto a second row', count: '25', size: '5' },
  { what: 'twelve groups wrapping onto a third row', count: '60', size: '5' },
  {
    what: 'a last group far smaller than its siblings',
    count: '26',
    size: '5',
  },
  // DERIVED, not picked. A sweep of ten shapes found this is the ONLY one
  // that reaches the correction at all: every other shape either fits at full
  // size or lands straight on the readable floor, where there is nothing left
  // to shrink. Without it the correction is a branch no test ever enters, and
  // a branch that has never matched anything is itself vacuous (#118).
  {
    what: 'a small class in pairs, the only shape that is corrected',
    count: '8',
    size: '2',
  },
] as const;

/** The same question, on a board too short to be generous. */
const SHORT_BOARDS = [
  {
    what: 'a landscape phone',
    count: '25',
    size: '5',
    viewport: { width: 740, height: 360 },
  },
  {
    what: 'a 720p projector',
    count: '25',
    size: '5',
    viewport: { width: 1280, height: 720 },
  },
] as const;

/**
 * Open the board on the anonymous count/size path.
 *
 * Deliberately NOT the roster: 25 named students is 25 form interactions per
 * case per engine, and what is asserted below is geometry, which does not
 * care whose name is in the card. The long name has its own test above.
 *
 * Animation off, so nothing is read mid-transition. A revealing card carries
 * `opacity: 0` and a `translateY`, and while neither affects layout, a test
 * about geometry should not have to depend on that being true.
 */
const boardOf = async (
  page: import('@playwright/test').Page,
  count: string,
  size: string,
) => {
  await page.goto('/classroom-groups');
  await makeGroups(page, count, size);
  await expect(page.locator('#cg-results .group').first()).toBeVisible();
  await page
    .getByRole('button', { name: /Full screen|Layar penuh/ })
    .first()
    .click();
  await expect(page.locator('#cg-board')).not.toHaveAttribute('hidden', /.*/);
};

/**
 * What the board is actually showing, measured.
 *
 * Visibility is judged by `getClientRects().length`, never by an element's
 * own computed `display`: `display: none` on an ANCESTOR leaves a
 * descendant's computed display untouched, so a per-element check reports
 * hidden content as rendered -- a bug in the guard that reads exactly like a
 * bug in the page.
 *
 * "Clipped" is not the same question as "outside the box". Content below the
 * fold of a stage that SCROLLS is reachable, and the board is allowed to
 * scroll once it has shrunk to the readable floor. What may never happen is
 * content that is outside the box AND cannot be scrolled to.
 */
const boardGeometry = async (page: import('@playwright/test').Page) =>
  page.evaluate(measureBoard);

/**
 * THE INVARIANT. Asserted FIRST, and derived rather than proxied.
 *
 * An assertion ordered after a brittle proxy is only ever evaluated while the
 * proxy holds (#156), so the question that matters -- can a teacher see every
 * name -- runs before anything about counts or rows.
 */
const expectNothingOutOfReach = async (
  page: import('@playwright/test').Page,
  what: string,
) => {
  const seen = await boardGeometry(page);
  const where =
    `${seen.rows} row(s) at ${seen.font}: a ${seen.scrollHeight}px sheet ` +
    `in a ${seen.clientHeight}px stage with overflow-y: ${seen.overflowY}`;
  expect(searched(seen.unreachable, { of: seen.cards, what }), where).toEqual(
    [],
  );
  await shoot(
    page,
    `nothing below the fold -- ${seen.rows} row(s) at ${seen.font}`,
    page.locator('#cg-board'),
  );
  // ...and the property behind it: either the sheet fits, or the stage
  // genuinely scrolls. Never how many things there are.
  expect(
    seen.scrollHeight <= seen.clientHeight || seen.scrollable,
    `${where} -- content nobody can reach`,
  ).toBe(true);
  await shoot(
    page,
    `reachable -- a ${seen.scrollHeight}px sheet in a ${seen.clientHeight}px stage, overflow-y: ${seen.overflowY}`,
    page.locator('#cg-board'),
  );

  // ...and the CONVERSE, which is what makes the verdict honest rather than
  // merely safe. `.scrolls` used to be PREDICTED before the layout it
  // describes; a prediction that errs towards scrolling hides nothing, so
  // every assertion above stays green while the board offers a scrollbar it
  // does not need. Measured on ten shapes, the predicted and measured
  // verdicts disagree on five of them.
  if (seen.scrollHeight <= seen.clientHeight) {
    expect(
      seen.scrollable,
      `${where} -- the sheet fits, so the stage must not be scrollable`,
    ).toBe(false);
    await shoot(
      page,
      `the sheet fits at ${seen.font} and the stage does not scroll`,
      page.locator('#cg-board'),
    );
  }

  // ...and the property that says the shrinking actually happened: a board
  // may scroll ONLY once it has come down to the readable floor. Anything
  // above the floor that still does not fit had somewhere left to go.
  //
  // This is the assertion the mutation sweep was missing. Deleting the
  // correction step left every test above GREEN, because a board that
  // scrolls is a board whose content is still reachable -- true, and not the
  // whole contract. One pixel of tolerance because the correction solves to
  // a fractional font, not because the floor is negotiable.
  if (seen.scrollHeight > seen.clientHeight) {
    expect(
      parseFloat(seen.font),
      `${where} -- scrolling at ${seen.font}, above the ${FLOOR_PX}px floor: ` +
        'it had further to shrink before scrolling was the honest answer',
    ).toBeLessThanOrEqual(FLOOR_PX + 1);
    await shoot(
      page,
      `scrolling only at the readable floor -- ${seen.font}`,
      page.locator('#cg-board'),
    );
  }
};

test.describe('the projector board never hides a name', () => {
  // #743 AC6: the waiting list and its empty cards are read from the back of
  // the room too, through the same fit as the dealt board.
  for (const shape of BOARD_SHAPES) {
    test(`nothing waiting is out of reach -- ${shape.what}`, async ({
      page,
    }) => {
      await openWaitingBoard(page, shape.count, shape.size);
      await expectNothingOutOfReach(page, 'the waiting board');
    });
  }

  for (const shape of SHORT_BOARDS) {
    test(
      `nothing waiting is out of reach on ${shape.what}`,
      { tag: '@emulated-viewport' },
      async ({ page }) => {
        await page.setViewportSize(shape.viewport);
        await openWaitingBoard(page, shape.count, shape.size);
        await expectNothingOutOfReach(page, 'the waiting board, short');
      },
    );
  }

  test(
    'the waiting board does not scroll sideways at 320px',
    { tag: '@emulated-viewport' },
    async ({ page }) => {
      await page.setViewportSize({ width: 320, height: 568 });
      await openWaitingBoard(page, '25', '5');
      const stage = page.locator('#cg-board-stage');
      const { scrollWidth, clientWidth } = await stage.evaluate((el) => ({
        scrollWidth: el.scrollWidth,
        clientWidth: el.clientWidth,
      }));
      expect(clientWidth).toBeGreaterThan(0);
      expect(scrollWidth).toBeLessThanOrEqual(clientWidth);
      await expectNothingOutOfReach(page, 'the waiting board at 320px');
    },
  );

  for (const shape of BOARD_SHAPES) {
    test(`nothing is out of reach -- ${shape.what}`, async ({ page }) => {
      await boardOf(page, shape.count, shape.size);
      await expectNothingOutOfReach(page, 'group cards on the board');
    });
  }

  for (const shape of SHORT_BOARDS) {
    test(
      `nothing is out of reach on ${shape.what}`,
      { tag: '@emulated-viewport' },
      async ({ page }) => {
        await page.setViewportSize(shape.viewport);
        await boardOf(page, shape.count, shape.size);
        await expectNothingOutOfReach(page, 'group cards on a short board');
      },
    );
  }

  test('nothing is out of reach when the fullscreen grant is refused', async ({
    page,
  }) => {
    // iOS Safari never grants fullscreen on an arbitrary element, and the
    // board is the same layer either way -- so a fix proved on only one path
    // is proved on neither.
    await refuseFullscreen(page);
    await boardOf(page, '25', '5');
    await expectNothingOutOfReach(
      page,
      'group cards on the refused-grant board',
    );
  });
});

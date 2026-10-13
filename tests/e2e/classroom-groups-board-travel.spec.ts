import type { Page } from '@playwright/test';
import { test, expect } from './fixtures';
import { openWaitingBoard } from './helpers';
import { recorded } from './evidence';
import { searched } from '../source-files';
import { floorBreach } from '../floors';
import {
  measureBoard,
  measureBoardScript,
  type BoardGeometry,
} from '../board-geometry';
import { FLOOR_PX } from '../../src/scripts/projector';
import {
  FLIGHT_NORMAL_MS,
  FOLD_MS,
  travelSchedule,
} from '../../src/lib/travel';

/**
 * The board deals by moving each student from the waiting list into their
 * seat (spec 2026-10-14-board-students-travel-design.md). Twelve students in
 * groups of four: three cards, a deal of 11 x 110 + 500 + 350 = 2,060 ms at
 * Normal. What a viewer sees is read frame by frame by an in-page sampler,
 * because a moving state has no single moment a locator could wait for.
 */
test.use(recorded);

const COUNT = 12;

const bar = (page: Page) => page.locator('#cg-board-bar');
const board = (page: Page) => page.locator('#cg-board');
const press = (page: Page, name: 'Make Groups' | 'Shuffle again') =>
  bar(page).getByRole('button', { name }).click();

type Tally = { chip: number; row: number; none: number; both: number };
/** One frame with a student travelling: who, and what the board looked like. */
type Flight = {
  flying: number[];
  listHeight: number;
  cards: string;
  overflow: number;
};
type Samples = {
  students: [number, Tally][];
  flights: Flight[];
};

/**
 * Every animation frame until stopped: for each student, whether their chip
 * (laid out and not `visibility: hidden`) and their row (laid out, computed
 * opacity above 0) can be seen; while any row travels, which rows do, the
 * list's height, every card's box and the stage's sideways overflow. The overflow is read by
 * `measureBoard`, shipped in as the script the iOS leg sends, so the stage is
 * measured in its one home (`tests/guards/board-geometry.test.ts`).
 */
const startSampler = (page: Page) =>
  page.evaluate((measureScript) => {
    const measure = new Function(measureScript) as () => BoardGeometry;
    const tally = new Map<number, Tally>();
    const flights: Flight[] = [];
    let on = true;
    const shown = (
      el: Element | null,
      test: (s: CSSStyleDeclaration) => boolean,
    ) => !!el && el.getClientRects().length > 0 && test(getComputedStyle(el));
    const tick = () => {
      if (!on) return;
      const numbers = new Set(
        Array.from(
          document.querySelectorAll<HTMLElement>('#cg-board [data-number]'),
          (e) => Number(e.dataset.number),
        ),
      );
      for (const n of numbers) {
        const chip = shown(
          document.querySelector(
            `#cg-board .waiting-student[data-number="${n}"]`,
          ),
          (s) => s.visibility !== 'hidden',
        );
        const row = shown(
          document.querySelector(`#cg-board .student[data-number="${n}"]`),
          (s) => Number(s.opacity) > 0,
        );
        const t = tally.get(n) ?? { chip: 0, row: 0, none: 0, both: 0 };
        if (chip && row) t.both++;
        else if (chip) t.chip++;
        else if (row) t.row++;
        else t.none++;
        tally.set(n, t);
      }
      const flying = Array.from(
        document.querySelectorAll<HTMLElement>('#cg-board .student.travelling'),
        (e) => Number(e.dataset.number),
      );
      if (flying.length)
        flights.push({
          flying,
          listHeight: document.getElementById('cg-waiting')!.offsetHeight,
          cards: Array.from(
            document.querySelectorAll('#cg-board .group'),
            (g) => {
              const r = g.getBoundingClientRect();
              return `${r.left},${r.top},${r.width},${r.height}`;
            },
          ).join(';'),
          overflow: measure().overflowX,
        });
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
    (window as unknown as { stopSampler: () => Samples }).stopSampler = () => {
      on = false;
      return { students: [...tally], flights };
    };
  }, measureBoardScript());

/**
 * The students seen travelling, and those during whose flight `moved` held in
 * some frame. Judged per student, not per frame: how many frames a flight
 * spans is the engine's frame rate and the runner's load (103, 102, 73 and 80
 * frames in one record run, #744 pass 5), while every student travels on
 * every engine, so the students are the population a floor can hold. A
 * flight no frame caught leaves its student out, and the floor names that.
 */
const judgedPerStudent = (
  flights: Flight[],
  moved: (flight: Flight) => boolean,
): { travelled: number[]; during: number[] } => {
  const travelled = [...new Set(flights.flatMap((f) => f.flying))].sort(
    (a, b) => a - b,
  );
  const during = travelled.filter((n) =>
    flights.some((f) => f.flying.includes(n) && moved(f)),
  );
  return { travelled, during };
};

const stopSampler = (page: Page): Promise<Samples> =>
  page.evaluate(() =>
    (window as unknown as { stopSampler: () => Samples }).stopSampler(),
  );

/** The deal has ended: the list gone, every row seated, nothing moving. */
const expectDealt = async (page: Page) => {
  await expect(board(page).locator('#cg-waiting')).toHaveCount(1);
  await expect(board(page).locator('#cg-waiting')).toBeHidden();
  await expect(board(page).locator('.student.dealt')).toHaveCount(COUNT);
  await page.waitForFunction(() => document.getAnimations().length === 0);
};

/** The third row to land, which a test waits on before acting mid-travel. */
const expectThirdLanding = (page: Page) =>
  expect(board(page).locator('.student.landed').nth(2)).toBeAttached();

type Made = {
  on: 'row' | 'chip' | 'card' | 'other';
  delay: number;
  duration: number;
};

/**
 * Wraps `Element.animate` in the page, so a test reads exactly the flights
 * and folds this code made. `document.getAnimations()` cannot: it also holds
 * CSS transitions (`.dealt`'s fade, the bar's), and a travelling deal makes
 * its flights one frame AFTER the press, so a count read straight after the
 * click is 0 whether or not anything will move.
 */
const recordAnimations = (page: Page) =>
  page.evaluate(() => {
    const made: Made[] = [];
    const original = Element.prototype.animate;
    Element.prototype.animate = function (
      this: Element,
      keyframes: Keyframe[] | PropertyIndexedKeyframes | null,
      options?: number | KeyframeAnimationOptions,
    ) {
      const timing =
        typeof options === 'number' ? { duration: options } : (options ?? {});
      const c = this.classList;
      made.push({
        on: c.contains('group')
          ? 'card'
          : c.contains('student')
            ? 'row'
            : c.contains('waiting-student')
              ? 'chip'
              : 'other',
        delay: Number(timing.delay ?? 0),
        duration: Number(timing.duration ?? 0),
      });
      return original.call(this, keyframes, options);
    };
    (window as unknown as { animationsMade: () => Made[] }).animationsMade =
      () => made;
  });

const animationsMade = (page: Page): Promise<Made[]> =>
  page.evaluate(() =>
    (window as unknown as { animationsMade: () => Made[] }).animationsMade(),
  );

test.describe('the board deals by moving students into their cards', () => {
  test('every student is seen exactly once at every frame, chip then row', async ({
    page,
  }) => {
    await openWaitingBoard(page, String(COUNT), '4');
    await startSampler(page);
    await press(page, 'Make Groups');
    await expectDealt(page);
    const { students } = await stopSampler(page);
    expect(
      searched(
        students.filter(([, t]) => t.both > 0),
        { of: students, what: 'students sampled' },
      ),
      'students seen twice in one frame',
    ).toEqual([]);
    expect(
      searched(
        students.filter(([, t]) => t.none > 0),
        { of: students, what: 'students sampled' },
      ),
      'students seen nowhere in one frame',
    ).toEqual([]);
    // The sampler's own liveness: it saw every student in both places.
    expect(
      searched(
        students.filter(([, t]) => t.chip === 0 || t.row === 0),
        { of: students, what: 'students sampled' },
      ),
      'students the sampler never saw as a chip and as a row',
    ).toEqual([]);
    expect(
      floorBreach('board-travel/students-sampled', students.length),
    ).toBeUndefined();
  });

  test('the list keeps its size while students travel, then folds away', async ({
    page,
  }) => {
    await openWaitingBoard(page, String(COUNT), '4');
    await startSampler(page);
    await press(page, 'Make Groups');
    await expectDealt(page);
    const { flights } = await stopSampler(page);
    const first = flights[0]?.listHeight;
    const { travelled, during } = judgedPerStudent(
      flights,
      (f) => f.listHeight !== first,
    );
    expect(
      searched(during, { of: travelled, what: 'students seen travelling' }),
      'students during whose flight the list changed height',
    ).toEqual([]);
    expect(
      floorBreach('board-travel/list-students', travelled.length),
    ).toBeUndefined();
  });

  test('the cards hold still while students travel', async ({ page }) => {
    await openWaitingBoard(page, String(COUNT), '4');
    await startSampler(page);
    await press(page, 'Make Groups');
    await expectDealt(page);
    const { flights } = await stopSampler(page);
    const first = flights[0]?.cards;
    const { travelled, during } = judgedPerStudent(
      flights,
      (f) => f.cards !== first,
    );
    expect(
      searched(during, { of: travelled, what: 'students seen travelling' }),
      'students during whose flight a card moved or changed size',
    ).toEqual([]);
    expect(
      floorBreach('board-travel/card-students', travelled.length),
    ).toBeUndefined();
  });

  test('the schedule is the one travelSchedule states', async ({ page }) => {
    const schedule = travelSchedule(COUNT, 'normal')!;
    await openWaitingBoard(page, String(COUNT), '4');
    await recordAnimations(page);
    const started = Date.now();
    await press(page, 'Make Groups');
    await expectDealt(page);
    const wall = Date.now() - started;
    const made = await animationsMade(page);
    const rows = made.filter((m) => m.on === 'row');
    expect(rows.map((m) => m.delay)).toEqual(schedule.starts);
    expect(
      Math.max(...rows.map((m) => m.delay + m.duration)),
      'the last landing',
    ).toBe(schedule.starts[COUNT - 1] + FLIGHT_NORMAL_MS);
    expect(made.filter((m) => m.on === 'chip')).toHaveLength(COUNT);
    expect(
      made.filter((m) => m.on === 'card').map((m) => m.duration),
      'the fold: one move per card',
    ).toEqual([FOLD_MS, FOLD_MS, FOLD_MS]);
    expect(
      searched(
        made.filter((m) => m.on === 'other'),
        { of: made, what: 'animations made' },
      ),
      'animations made on anything but a row, a chip or a card',
    ).toEqual([]);
    expect(
      floorBreach('board-travel/animations-made', made.length),
    ).toBeUndefined();
    test.info().annotations.push({
      type: 'travel-wall-ms',
      description: `${wall} ms against ${schedule.totalMs} ms scheduled`,
    });
    expect(wall).toBeGreaterThanOrEqual(schedule.totalMs);
  });

  test('a second Shuffle returns everyone to the list, then deals again', async ({
    page,
  }) => {
    await openWaitingBoard(page, String(COUNT), '4');
    await press(page, 'Make Groups');
    await expectDealt(page);
    await startSampler(page);
    await press(page, 'Shuffle again');
    await expect(board(page).locator('#cg-waiting')).toBeVisible();
    await expect(board(page).locator('.waiting-student')).toHaveCount(COUNT);
    await expectDealt(page);
    const { students } = await stopSampler(page);
    expect(
      searched(
        students.filter(([, t]) => t.both > 0 || t.none > 0),
        { of: students, what: 'students sampled' },
      ),
      'students seen twice, or nowhere, in one frame',
    ).toEqual([]);
    expect(
      floorBreach('board-travel/students-sampled-again', students.length),
    ).toBeUndefined();
  });

  test('a Shuffle pressed while students travel starts again, and nobody is seen twice', async ({
    page,
  }) => {
    await openWaitingBoard(page, String(COUNT), '4');
    await startSampler(page);
    await press(page, 'Make Groups');
    await expectThirdLanding(page);
    await press(page, 'Shuffle again');
    await expectDealt(page);
    const { students } = await stopSampler(page);
    expect(
      searched(
        students.filter(([, t]) => t.both > 0),
        { of: students, what: 'students sampled' },
      ),
      'students seen twice in one frame',
    ).toEqual([]);
    expect(
      floorBreach('board-travel/students-sampled-restart', students.length),
    ).toBeUndefined();
    const numbers = await board(page)
      .locator('.student')
      .evaluateAll((rows) =>
        rows.map((r) => (r as HTMLElement).dataset.number),
      );
    expect(new Set(numbers).size).toBe(COUNT);
  });

  test('leaving the board while students travel puts the groups on the page at once', async ({
    page,
  }) => {
    await openWaitingBoard(page, String(COUNT), '4');
    await press(page, 'Make Groups');
    await expectThirdLanding(page);
    await page.keyboard.press('Escape');
    const rows = page.locator('#cg-results .student.dealt');
    await expect(rows).toHaveCount(COUNT);
    await expect(rows.first()).toBeVisible();
    await expect(rows.last()).toBeVisible();
    await expect(page.locator('#cg-waiting')).toHaveCount(1);
    await expect(page.locator('#cg-waiting')).toBeHidden();
    await page.waitForFunction(() => document.getAnimations().length === 0);
  });

  test('with Skip nothing moves: everyone is in their card at once', async ({
    page,
  }) => {
    await openWaitingBoard(page, String(COUNT), '4', 'skip');
    await recordAnimations(page);
    await press(page, 'Make Groups');
    await expect(board(page).locator('.student.dealt')).toHaveCount(COUNT);
    await expect(board(page).locator('#cg-waiting')).toBeHidden();
    // Two frames on, past the one a travelling deal waits before it flies.
    await page.evaluate(
      () =>
        new Promise((r) =>
          requestAnimationFrame(() => requestAnimationFrame(r)),
        ),
    );
    const seated = await board(page)
      .locator('.student.dealt')
      .evaluateAll((rows) =>
        rows.map((r) => (r as HTMLElement).dataset.number),
      );
    expect(
      searched(await animationsMade(page), {
        of: seated,
        what: 'students seated',
      }),
      'animations made for a deal that must not move',
    ).toEqual([]);
    expect(
      floorBreach('board-travel/seated-skip', seated.length),
    ).toBeUndefined();
  });

  test('with reduced motion nothing moves: everyone is in their card at once', async ({
    page,
  }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await openWaitingBoard(page, String(COUNT), '4');
    await recordAnimations(page);
    await press(page, 'Make Groups');
    await expect(board(page).locator('.student.dealt')).toHaveCount(COUNT);
    await expect(board(page).locator('#cg-waiting')).toBeHidden();
    // Two frames on, past the one a travelling deal waits before it flies.
    await page.evaluate(
      () =>
        new Promise((r) =>
          requestAnimationFrame(() => requestAnimationFrame(r)),
        ),
    );
    const seated = await board(page)
      .locator('.student.dealt')
      .evaluateAll((rows) =>
        rows.map((r) => (r as HTMLElement).dataset.number),
      );
    expect(
      searched(await animationsMade(page), {
        of: seated,
        what: 'students seated',
      }),
      'animations made for a deal that must not move',
    ).toEqual([]);
    expect(
      floorBreach('board-travel/seated-reduced-motion', seated.length),
    ).toBeUndefined();
  });

  test(
    'at 320px nothing scrolls sideways while students travel',
    { tag: '@emulated-viewport' },
    async ({ page }) => {
      await page.setViewportSize({ width: 320, height: 640 });
      await openWaitingBoard(page, String(COUNT), '4');
      await startSampler(page);
      await press(page, 'Make Groups');
      await expectDealt(page);
      const { flights } = await stopSampler(page);
      const { travelled, during } = judgedPerStudent(
        flights,
        (f) => f.overflow > 0,
      );
      expect(
        searched(during, { of: travelled, what: 'students seen travelling' }),
        'students during whose flight the board scrolled sideways',
      ).toEqual([]);
      expect(
        floorBreach('board-travel/overflow-students-320', travelled.length),
      ).toBeUndefined();
    },
  );

  test('the fit after the fold is the fit a fresh board gets', async ({
    page,
  }) => {
    await openWaitingBoard(page, String(COUNT), '4');
    await press(page, 'Make Groups');
    await expectDealt(page);
    const font = async () =>
      parseFloat((await page.evaluate(measureBoard)).font);
    const afterFold = await font();
    await page.keyboard.press('Escape');
    // Exact: while the board closes, its own "Exit full screen" matches too.
    await page
      .getByRole('button', { name: 'Full screen', exact: true })
      .click();
    await expect(board(page).locator('.student.dealt')).toHaveCount(COUNT);
    expect(await font()).toBe(afterFold);
    expect(afterFold).toBeGreaterThanOrEqual(FLOOR_PX);
  });
});

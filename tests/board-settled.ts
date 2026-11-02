import { expect, type Locator, type Page } from '@playwright/test';
import { tapOn } from './real-touch';

/**
 * Opening the projector board and waiting until it has finished opening, as
 * a person would before acting on it (#1007).
 *
 * The board asks for fullscreen as it appears, and the answer arrives later.
 * On the real Android phone, an exit asked within about 100 ms of entering
 * never resolves, and the board stays on screen. No finger is that fast;
 * only a test is (its Escape landed about 10 ms after entry). Shyden ruled on
 * 2026-11-02 that the page stays as it is and the tests wait for the board to
 * settle. So every test that opens the board opens it here.
 *
 * Settled means: the request has been answered, whether by the entering
 * `fullscreenchange` or by a `fullscreenerror` (the overlay path), or there
 * was nothing to ask (no fullscreen API); and then the board's box and the
 * visual viewport have held still for three frames. No fixed delay: every
 * wait is on a condition, with a ceiling that fails naming what never came.
 */

/** How long the fullscreen answer, and then the stillness, may take. */
export const BOARD_SETTLE_CEILING_MS = 5_000;

/** Frames the board and the view must hold still for. */
export const STILL_FRAMES = 3;

interface BoardEntry {
  state: 'pending' | 'entered' | 'refused' | 'no-api';
  armedAt: number;
  answeredAt: number | null;
}

/**
 * Listens for the answer to the coming fullscreen request. Armed BEFORE the
 * tap, because a refusal is only an event: afterwards, a board that was
 * refused and one still waiting look the same.
 */
export async function armBoardEntry(page: Page): Promise<void> {
  await page.evaluate(() => {
    const entry: BoardEntry = {
      state:
        document.fullscreenEnabled &&
        typeof HTMLElement.prototype.requestFullscreen === 'function'
          ? 'pending'
          : 'no-api',
      armedAt: performance.now(),
      answeredAt: null,
    };
    (window as unknown as { __boardEntry: BoardEntry }).__boardEntry = entry;
    if (entry.state === 'no-api') return;
    const answer = (state: BoardEntry['state']) => {
      if (entry.state !== 'pending') return;
      entry.state = state;
      entry.answeredAt = performance.now();
    };
    document.addEventListener('fullscreenchange', () => {
      if (document.fullscreenElement?.id === 'cg-board') answer('entered');
    });
    document.addEventListener('fullscreenerror', () => answer('refused'));
  });
}

/**
 * Waits until the board armed by `armBoardEntry` has finished opening, and
 * returns how long that took from the arming, in ms (the settle time #1007's
 * AC3 asks to be measured).
 */
export async function boardSettled(page: Page): Promise<number> {
  await expect(page.locator('#cg-board')).toBeVisible();
  const answered = await page
    .waitForFunction(
      () => {
        const e = (window as unknown as { __boardEntry?: BoardEntry })
          .__boardEntry;
        return e !== undefined && e.state !== 'pending';
      },
      undefined,
      { timeout: BOARD_SETTLE_CEILING_MS },
    )
    .then(() => true)
    .catch(() => false);
  if (!answered) {
    const state = await page.evaluate(
      () =>
        (window as unknown as { __boardEntry?: BoardEntry }).__boardEntry
          ?.state ?? 'never armed',
    );
    throw new Error(
      `the board's fullscreen request was not answered within ${BOARD_SETTLE_CEILING_MS} ms (state: ${state}); armBoardEntry must run before the tap that opens it`,
    );
  }
  const still = await page.evaluate(
    ({ frames, ceiling }) =>
      new Promise<{ ok: boolean; at: number }>((resolve) => {
        const board = document.getElementById('cg-board')!;
        const shape = () => {
          const b = board.getBoundingClientRect();
          const v = window.visualViewport;
          return [
            b.x,
            b.y,
            b.width,
            b.height,
            v?.offsetTop ?? 0,
            v?.offsetLeft ?? 0,
            v?.width ?? window.innerWidth,
            v?.height ?? window.innerHeight,
          ].join(',');
        };
        let last = shape();
        let held = 0;
        const started = performance.now();
        const look = () => {
          const now = shape();
          held = now === last ? held + 1 : 0;
          last = now;
          if (held >= frames) resolve({ ok: true, at: performance.now() });
          else if (performance.now() - started > ceiling)
            resolve({ ok: false, at: performance.now() });
          else requestAnimationFrame(look);
        };
        requestAnimationFrame(look);
      }),
    { frames: STILL_FRAMES, ceiling: BOARD_SETTLE_CEILING_MS },
  );
  if (!still.ok)
    throw new Error(
      `the board and the view did not hold still for ${STILL_FRAMES} frames within ${BOARD_SETTLE_CEILING_MS} ms`,
    );
  const armedAt = await page.evaluate(
    () =>
      (window as unknown as { __boardEntry: BoardEntry }).__boardEntry.armedAt,
  );
  return still.at - armedAt;
}

/**
 * Opens the board with a real tap on `opener` (the page's Full screen button
 * unless another is named) and waits until it has settled. Returns the
 * settle time in ms.
 */
export async function openBoard(page: Page, opener?: Locator): Promise<number> {
  await armBoardEntry(page);
  await tapOn(
    opener ?? page.getByRole('button', { name: 'Full screen', exact: true }),
  );
  return boardSettled(page);
}

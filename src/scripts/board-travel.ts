/**
 * The board's travelling deal (#744; spec 2026-10-14). Every chip and every
 * seat is measured once, after the board's own refit, because the travelling
 * layout holds still: the list keeps its gaps and the cards their seats. Each
 * row is drawn over its chip and animated to its seat (FLIP); the chip goes
 * in the same frame. After the last landing the emptied list is hidden, the
 * board re-fits, and the cards move from their old boxes to their new ones
 * in one move.
 */
import {
  flightStartX,
  landingsToSound,
  type Span,
  type TravelSchedule,
} from '../lib/travel';

export interface TravelOptions {
  list: HTMLElement;
  tables: HTMLElement;
  order: readonly number[];
  schedule: TravelSchedule;
  signal: AbortSignal;
  hideList: () => void;
  refit: () => void;
  onLand: (i: number) => void;
}

const EASE = 'cubic-bezier(0.22, 1, 0.36, 1)';

const nextFrame = () =>
  new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));

type Stop = 'finish' | 'superseded';

/** An element's content box, sideways, in viewport pixels. */
const contentSpan = (el: HTMLElement): Span => {
  const box = el.getBoundingClientRect();
  const style = getComputedStyle(el);
  const inner = box.left + el.clientLeft;
  return {
    left: inner + parseFloat(style.paddingLeft),
    right: inner + el.clientWidth - parseFloat(style.paddingRight),
  };
};

/** Resolves when the signal fires, with which way out it asked for. */
const stopped = (signal: AbortSignal): Promise<Stop> =>
  new Promise((resolve) => {
    const read = () =>
      resolve(signal.reason === 'superseded' ? 'superseded' : 'finish');
    if (signal.aborted) read();
    else signal.addEventListener('abort', read, { once: true });
  });

export async function travel(
  o: TravelOptions,
): Promise<'dealt' | 'superseded'> {
  const stop = stopped(o.signal);
  // Behind the board's own synchronous refit, which runs after the submit
  // that called this returns: measured before it, every seat could move.
  await nextFrame();
  if (o.signal.aborted && o.signal.reason === 'superseded') return 'superseded';

  const rows = o.order.map((n) =>
    o.tables.querySelector<HTMLElement>(`.student[data-number="${n}"]`),
  );
  const chips = o.order.map((n) =>
    o.list.querySelector<HTMLElement>(`.waiting-student[data-number="${n}"]`),
  );
  // Clear every resting transform first, then read every box: one layout.
  for (const row of rows) row?.classList.add('travelling');
  const boxes = rows.map((row, i) => ({
    from: chips[i]?.getBoundingClientRect(),
    to: row?.getBoundingClientRect(),
  }));
  // The one sideways bound a flight keeps inside (F10): off the board, none.
  const stage = o.tables.closest<HTMLElement>('#cg-board-stage');
  const bound = stage
    ? contentSpan(stage)
    : { left: -Infinity, right: Infinity };

  let finishedEarly = false;
  const flights: Animation[] = [];
  const landings = rows.map((row, i) => {
    const chip = chips[i];
    const { from, to } = boxes[i];
    if (!row) return Promise.resolve();
    if (!chip || !from || !to) {
      // No chip to leave from: seated at once, like a pinned student.
      row.classList.remove('travelling');
      row.classList.add('dealt', 'landed');
      return Promise.resolve();
    }
    const timing = {
      delay: o.schedule.starts[i],
      duration: o.schedule.flightMs,
      fill: 'forwards' as const,
    };
    // `forwards`, never `backwards`: during its delay the row keeps its own
    // opacity 0, so it is never seen over a chip that is still showing.
    const fly = row.animate(
      [
        {
          opacity: 1,
          transform: `translate(${flightStartX(from, to, bound)}px, ${from.top - to.top}px)`,
        },
        { opacity: 1, transform: 'none' },
      ],
      { ...timing, easing: EASE },
    );
    const hide = chip.animate(
      [{ visibility: 'hidden' }, { visibility: 'hidden' }],
      timing,
    );
    flights.push(fly, hide);
    return fly.finished.then(
      () => {
        chip.classList.add('left');
        row.classList.add('dealt', 'landed');
        row.classList.remove('travelling');
        fly.cancel();
        hide.cancel();
        if (landingsToSound(i, finishedEarly)) o.onLand(i);
        if (i === 0) {
          o.tables.style.visibility = 'hidden';
          requestAnimationFrame(() =>
            requestAnimationFrame(() => {
              o.tables.style.visibility = '';
            }),
          ); /* MUTANT 856 AC4 hide */
        }
      },
      () => undefined, // cancelled by a newer deal: nothing to tidy
    );
  });

  const first = await Promise.race([
    Promise.all(landings).then(() => 'landed' as const),
    stop,
  ]);
  if (first === 'superseded') {
    for (const a of flights) a.cancel();
    return 'superseded';
  }
  if (first === 'finish') {
    finishedEarly = true;
    // Not the flights a landed row already cancelled: `finish()` on an idle
    // animation seeks it to its end, and with `fill: forwards` it would then
    // hold its style for good, its `finished` long settled (F9).
    for (const a of flights) if (a.playState !== 'idle') a.finish();
    await Promise.all(landings);
    fold(o, false);
    return 'dealt';
  }
  const moves = fold(o, true);
  const during = await Promise.race([
    Promise.all(moves.map((m) => m.finished)).then(() => 'folded' as const),
    stop,
  ]);
  if (during === 'superseded') for (const m of moves) m.cancel();
  if (during === 'finish') for (const m of moves) m.finish();
  return during === 'superseded' ? 'superseded' : 'dealt';
}

/**
 * The emptied list goes and the board re-fits; each card then moves from its
 * old box to its new one (translate, plus the font ratio as a uniform scale),
 * in one move. Without animation the cards are simply where the refit put
 * them.
 */
function fold(o: TravelOptions, animated: boolean): Animation[] {
  const cards = Array.from(o.tables.querySelectorAll<HTMLElement>('.group'));
  const before = cards.map((c) => c.getBoundingClientRect());
  const fontBefore = parseFloat(getComputedStyle(o.tables).fontSize);
  o.hideList();
  o.refit();
  if (!animated) return [];
  const ratio = fontBefore / parseFloat(getComputedStyle(o.tables).fontSize);
  return cards.map((card, i) => {
    const after = card.getBoundingClientRect();
    return card.animate(
      [
        {
          transformOrigin: 'top left',
          transform: `translate(${before[i].left - after.left}px, ${before[i].top - after.top}px) scale(${ratio})`,
        },
        { transformOrigin: 'top left', transform: 'none' },
      ],
      { duration: o.schedule.foldMs, easing: EASE },
    );
  });
}

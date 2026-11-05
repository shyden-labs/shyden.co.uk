# The board deals by moving students from the list into their cards: implementation plan (#744)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** On the full-screen board, a Shuffle with animation on carries each student from the "Waiting to be grouped" list into their seat in their group's card, then folds the emptied list away in one move.

**Architecture:** Pure order and timings in `src/lib/travel.ts` (unit-tested first). One DOM module, `src/scripts/board-travel.ts`, measures every chip and seat at the press and schedules every flight with `Element.animate` (FLIP), then folds. `classroom-groups.ts` keeps its one submit path and chooses `travel()` instead of `animate()` when the board is open and the speed is not `skip`; `projector.ts` stops its group fade for a travelling deal.

**Tech Stack:** TypeScript, Astro 7, Vitest (unit), Playwright (e2e, five engines plus `content`), Web Animations API.

**Spec:** `docs/superpowers/specs/2026-10-14-board-students-travel-design.md`

## Global Constraints

- Operator rulings 2026-10-14 (#744 comment 6155861694): the list folds away at the end; a second board Shuffle returns everyone to the list and deals again; a press mid-deal starts again.
- Steps are today's: `NORMAL_STEP_S` 0.11 s, `FAST_STEP_S` 0.045 s (`src/lib/sfx.ts`). Flights `FLIGHT_NORMAL_MS` 500, `FLIGHT_FAST_MS` 250; fold `FOLD_MS` 350.
- Totals pinned as literals: Normal 30 = 4,040 ms; Normal 100 = 11,740 ms; Fast 30 = 1,905 ms.
- One visible element per student at every frame; nothing left behind, nothing ahead.
- `skip` (and `prefers-reduced-motion`, which forces it) creates no animation at all.
- Script-built elements are styled only in `<style is:global>` (CLAUDE.md, "Scoped `<style>` cannot reach anything JavaScript creates").
- No new npm package; no new copy (no catalogue change).
- Unit tests: one test per case, under 1 s wall and 0.07 s own CPU; no process, no socket.
- The laptop runs unit, format, `lint:tests` and `astro check` only; e2e, guards and the recorder are CI's.
- E2E meta-guards (memory `a-new-e2e-spec-meets-three-meta-guards`): `test.use(recorded)` because the spec acts; `setViewportSize` only inside a test tagged `@emulated-viewport`; assertion helpers named `expect…`; no `#NNN` inside a code string; every absence search is `searched(...)` plus `floorBreach(<id>, <of>.length)` in the same test; no literal floor (`toBeGreaterThan(n)` on a count).
- Commits say `Refs #744`, never a closing keyword.

## Review Focus

1. **Leaving the board (Escape) while students travel**: the page must show the dealt groups, every row visible, no animation left running, the list gone. Pinned by Task 4, *leaving mid-travel*.
2. **A chip and a row switching on different frames** (engines start two animations created together at different ready times): a student would be seen twice or not at all for a frame. Pinned by Task 4's sampler, which counts `both` and `none` per student in every engine.
3. **The board's own refit after the press moving the seats** after they were measured: every flight would land off its seat. `travel()` measures after one animation frame, behind the board's synchronous refit; pinned by Task 4, *the cards hold still*.
4. **A row whose seat transform was measured** (`.student` rests at `translateY(-0.5rem) scale(0.96)`): every flight would end 0.5 rem off and jump. `.travelling` clears the resting transform before measuring; pinned by Task 4's landing check (no row moves once landed).
5. **A skip mid-travel playing every remaining land sound at once.** `travel()` asks `landingsToSound` for every landing and a finish-now passes `finishedEarly`; pinned by Task 1's two `landingsToSound` cases, and the DOM's use of it by mutation (Task 5 adds none: it is one call).

---

### Task 1: Order and timings, pure

**Files:**
- Create: `src/lib/travel.ts`
- Test: `tests/unit/travel.test.ts`

**Interfaces:**
- Produces:
  - `FLIGHT_NORMAL_MS = 500`, `FLIGHT_FAST_MS = 250`, `FOLD_MS = 350`
  - `type TravelSpeed = 'normal' | 'fast' | 'skip'`
  - `interface TravelSchedule { starts: number[]; flightMs: number; foldMs: number; totalMs: number }`
  - `travelOrder(groups: readonly (readonly { number: number }[])[], pinned: ReadonlySet<number>): number[]`
  - `travelSchedule(count: number, speed: TravelSpeed): TravelSchedule | null`
  - `landingsToSound(landed: number, finishedEarly: boolean): boolean` (true when a landing plays its sound)
  - `interface Span { left: number; right: number }`
  - `flightStartX(chip: Span, seat: Span, stage: Span): number` (a flight's sideways start, held inside the stage; review pass 2, F10)

- [ ] **Step 1: Write the failing tests**

```ts
import { describe, expect, it } from 'vitest';
import { buildGroups } from '../../src/lib/grouping';
import {
  FLIGHT_FAST_MS,
  FLIGHT_NORMAL_MS,
  FOLD_MS,
  flightStartX,
  landingsToSound,
  travelOrder,
  travelSchedule,
} from '../../src/lib/travel';
import { seeded } from './factories';
import { searched } from '../source-files';
import { floorBreach } from '../floors';

/**
 * The board's deal (spec 2026-10-14): who travels in what order, and when.
 * Every figure is a literal, so a change to a step or a flight shows here as
 * a changed number, never as a value compared with the constant it came from.
 */
const seats = (...groups: number[][]) =>
  groups.map((g) => g.map((number) => ({ number })));
const none = new Set<number>();

describe('travelOrder', () => {
  it('deals round-robin: the first seat of every group, then the second', () => {
    expect(travelOrder(seats([1, 2, 3], [4, 5, 6]), none)).toEqual([
      1, 4, 2, 5, 3, 6,
    ]);
  });
  it('passes over a group that is already full', () => {
    expect(travelOrder(seats([1, 2, 3], [4]), none)).toEqual([1, 4, 2, 3]);
  });
  it('deals a group of one', () => {
    expect(travelOrder(seats([7]), none)).toEqual([7]);
  });
  it('never moves a pinned student: they are already seated', () => {
    expect(travelOrder(seats([1, 2], [3, 4]), new Set([3]))).toEqual([1, 2, 4]);
  });
  it('has nobody to move when everyone is pinned', () => {
    // Empty by design, so the inputs are the population (operator ruling
    // 2026-10-09, "Count the inputs").
    const cases = [
      {
        case: 'two groups of one, both pinned',
        groups: seats([1], [2]),
        pinned: new Set([1, 2]),
      },
    ];
    expect(
      searched(
        cases.flatMap(({ groups, pinned }) => travelOrder(groups, pinned)),
        { of: cases, what: 'deals where everyone is pinned' },
      ),
    ).toEqual([]);
    expect(
      floorBreach('travel/everyone-pinned-cases', cases.length),
    ).toBeUndefined();
  });

  const dealt = (seed: number) => {
    const outcome = buildGroups({
      students: 30,
      mode: { kind: 'perGroup', size: 4 },
      leftovers: 'spread',
      sexMode: 'off',
      pinned: [],
      random: seeded(seed),
    });
    if (!outcome.ok) throw new Error('the 30-student deal was refused');
    return outcome.result.groups;
  };
  it('moves every student of a real deal exactly once', () => {
    const order = travelOrder(dealt(7), none);
    expect([...order].sort((a, b) => a - b)).toEqual(
      Array.from({ length: 30 }, (_, i) => i + 1),
    );
  });
  it('gives the same order for the same seeded deal', () => {
    expect(travelOrder(dealt(7), none)).toEqual(travelOrder(dealt(7), none));
  });
});

describe('travelSchedule', () => {
  it('takes 4,040 ms for 30 students at Normal', () => {
    expect(travelSchedule(30, 'normal')?.totalMs).toBe(4040);
  });
  it('takes 11,740 ms for the 100-student maximum at Normal', () => {
    expect(travelSchedule(100, 'normal')?.totalMs).toBe(11740);
  });
  it('takes 1,905 ms for 30 students at Fast', () => {
    expect(travelSchedule(30, 'fast')?.totalMs).toBe(1905);
  });
  it('starts each student one Normal step after the last', () => {
    expect(travelSchedule(3, 'normal')?.starts).toEqual([0, 110, 220]);
  });
  it('starts each student one Fast step after the last', () => {
    expect(travelSchedule(3, 'fast')?.starts).toEqual([0, 45, 90]);
  });
  it('flies for 500 ms at Normal and folds for 350 ms', () => {
    const s = travelSchedule(1, 'normal');
    expect([s?.flightMs, s?.foldMs]).toEqual([500, 350]);
  });
  it('flies for 250 ms at Fast', () => {
    expect(travelSchedule(1, 'fast')?.flightMs).toBe(250);
  });
  it('makes no schedule for Skip: nothing moves', () => {
    expect(travelSchedule(30, 'skip')).toBeNull();
  });
  it('makes no schedule when nobody travels', () => {
    expect(travelSchedule(0, 'normal')).toBeNull();
  });
  it('keeps the exported durations the figures above were computed with', () => {
    expect([FLIGHT_NORMAL_MS, FLIGHT_FAST_MS, FOLD_MS]).toEqual([
      500, 250, 350,
    ]);
  });
});

describe('landingsToSound', () => {
  it('sounds a landing the flight made', () => {
    expect(landingsToSound(3, false)).toBe(true);
  });
  it('silences a landing a finish-now made, so a skip is not a burst', () => {
    expect(landingsToSound(3, true)).toBe(false);
  });
});

/**
 * Where a row starts its flight, sideways (#744 F10): over its chip, held
 * inside the stage, so no frame of a flight makes the board scroll sideways.
 * A row is seat-wide and a chip is often narrower, so a chip near the right
 * edge would otherwise start its row past the stage.
 */
describe('flightStartX', () => {
  const stage = { left: 0, right: 320 };
  it('starts the row over its chip when the chip is clear of both edges', () => {
    expect(
      flightStartX({ left: 40, right: 100 }, { left: 10, right: 130 }, stage),
    ).toBe(30);
  });
  it('moves the start in so the row ends at the stage edge, not past it', () => {
    expect(
      flightStartX({ left: 250, right: 310 }, { left: 10, right: 130 }, stage),
    ).toBe(190);
  });
  it('still covers the whole chip when the start is moved in', () => {
    const seat = { left: 10, right: 130 };
    const left =
      seat.left + flightStartX({ left: 250, right: 310 }, seat, stage);
    // The row spans 200..320, so it covers the chip's 250..310 whole.
    expect([left, left + 120]).toEqual([200, 320]);
  });
  it('holds the start at the stage left edge for a chip past it', () => {
    expect(
      flightStartX({ left: -20, right: 40 }, { left: 50, right: 170 }, stage),
    ).toBe(-50);
  });
  it('ends a row wider than the stage at its right edge', () => {
    expect(
      flightStartX({ left: 10, right: 50 }, { left: 0, right: 400 }, stage),
    ).toBe(-80);
  });
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `PATH=/opt/homebrew/opt/node/bin:$PATH npx vitest run tests/unit/travel.test.ts`
Expected: FAIL, `Cannot find module '../../src/lib/travel'` (measured, review pass 1).

- [ ] **Step 3: Implement**

```ts
/**
 * The board's deal (#744): who travels from the waiting list in what order,
 * and when. Pure, so the order is decided once and a seeded `random` gives
 * the same run every time; `src/scripts/board-travel.ts` does the moving.
 */
import { FAST_STEP_S, NORMAL_STEP_S } from './sfx';

export const FLIGHT_NORMAL_MS = 500;
export const FLIGHT_FAST_MS = 250;
export const FOLD_MS = 350;

export type TravelSpeed = 'normal' | 'fast' | 'skip';

export interface TravelSchedule {
  /** Milliseconds from the press to each take-off, in travel order. */
  starts: number[];
  flightMs: number;
  foldMs: number;
  /** The press to the end of the fold. */
  totalMs: number;
}

/**
 * Dealt like cards: the first seat of every group, then the second, and so
 * on. A full group is passed over; a pinned student is already seated.
 */
export function travelOrder(
  groups: readonly (readonly { number: number }[])[],
  pinned: ReadonlySet<number>,
): number[] {
  const order: number[] = [];
  const longest = Math.max(0, ...groups.map((g) => g.length));
  for (let seat = 0; seat < longest; seat++)
    for (const group of groups) {
      const student = group[seat];
      if (student && !pinned.has(student.number)) order.push(student.number);
    }
  return order;
}

/** `null` when nothing moves: Skip, or nobody to move. */
export function travelSchedule(
  count: number,
  speed: TravelSpeed,
): TravelSchedule | null {
  if (speed === 'skip' || count <= 0) return null;
  // Rounded: 0.11 * 1000 is 110.00000000000001 in binary floating point.
  const stepMs = Math.round(
    (speed === 'fast' ? FAST_STEP_S : NORMAL_STEP_S) * 1000,
  );
  const flightMs = speed === 'fast' ? FLIGHT_FAST_MS : FLIGHT_NORMAL_MS;
  const starts = Array.from({ length: count }, (_, i) => i * stepMs);
  return {
    starts,
    flightMs,
    foldMs: FOLD_MS,
    totalMs: starts[count - 1] + flightMs + FOLD_MS,
  };
}

/**
 * Whether a landing plays its sound. A finish-now lands every remaining
 * student in one frame; sounding each would be a burst, not a deal.
 */
export function landingsToSound(_landed: number, finishedEarly: boolean) {
  return !finishedEarly;
}

/** A box's horizontal extent, in viewport pixels. */
export interface Span {
  left: number;
  right: number;
}

/**
 * How far sideways a row starts from its seat (#744 F10): over its chip,
 * but held inside the stage's content box, so no frame of a flight makes the
 * board overflow sideways. A row is seat-wide and its chip often narrower,
 * so where the start is moved in, the row still covers the whole chip. A row
 * wider than the stage ends at its right edge, the side a scroll reaches.
 */
export function flightStartX(chip: Span, seat: Span, stage: Span): number {
  const width = seat.right - seat.left;
  const left = Math.min(Math.max(chip.left, stage.left), stage.right - width);
  return left - seat.left;
}
```

- [ ] **Step 4: Run them to see them pass**

Run: `PATH=/opt/homebrew/opt/node/bin:$PATH npx vitest run tests/unit/travel.test.ts`
Expected: 23 PASS and 1 FAIL: `travel/everyone-pinned-cases is not recorded`, a new floor the CI recorder writes (Task 4, Step 3). 24 tests (measured, review pass 3).

- [ ] **Step 5: Stage** (`git add src/lib/travel.ts tests/unit/travel.test.ts`). No commit yet: every new file grows a recorded floor (`source-files/walked-test-paths`, `tree-reading/*`) that only the CI recorder raises, so the story is ONE commit at the end of Task 4 and the recorder amends it (every commit green; review pass 1, F6).

### Task 2: The flights and the fold, in the DOM

**Files:**
- Create: `src/scripts/board-travel.ts`
- Modify: `src/components/pages/ClassroomGroupsPage.astro` (the `<style is:global>` block, directly after `#cg-results .student.dealt { … }`)
- Modify: `docs/superpowers/specs/2026-10-14-board-students-travel-design.md` (Step 2b)

**Interfaces:**
- Consumes: `TravelSchedule`, `landingsToSound`, `flightStartX`, `Span` (Task 1).
- Produces: `travel(options: TravelOptions): Promise<'dealt' | 'superseded'>` with

```ts
export interface TravelOptions {
  list: HTMLElement; // #cg-waiting-list
  tables: HTMLElement; // #cg-tables
  order: readonly number[];
  schedule: TravelSchedule;
  signal: AbortSignal; // reason 'finish' or 'superseded'
  hideList: () => void; // the page's hideWaiting
  refit: () => void; // the board's refit
  onLand: (i: number) => void; // sfx.land
}
```

- [ ] **Step 1: The CSS** (global block, after `.student.dealt`):

```css
  /* #744: a row flying from the waiting list to its seat. The flight's
     transform is Element.animate's own, so the resting transform above is
     cleared BEFORE the seat is measured; above its neighbours while it flies
     (no card makes a stacking context). */
  #cg-results .student.travelling {
    position: relative;
    z-index: 1;
    transform: none;
  }
  /* Landed by a flight: already at full opacity, so no fade on top of it. */
  #cg-results .student.landed {
    transition: none;
  }
  /* A chip whose student has left: its box stays, which is the gap the list
     keeps until the fold (operator ruling 2026-10-14). */
  #cg-results .waiting-student.left {
    visibility: hidden;
  }
```

- [ ] **Step 2: The module**

```ts
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
```

- [ ] **Step 2b: The spec says where a flight starts** (review pass 2, F10: its "the stage is the only clipping box, so a flight stays on the board" was false once `refit` sets `.scrolls`). In the design doc, replace the sentence `The stage is the only clipping box, so a flight stays on the board.` (it closes the paragraph that begins `On each row's `) with:

```markdown
A row is seat-wide
and its chip often narrower, so a row drawn from a chip near the right edge
would start past the stage, which overflows it sideways even under `overflow:
hidden` and scrolls it once `refit` sets `.scrolls` (review pass 2, F10). The
start is therefore held inside the stage's content box (`flightStartX`, pure,
in `src/lib/travel.ts`): moved in only as far as the edge demands, where the
row still covers the whole chip.
```

- [ ] **Step 3: Check it compiles and is formatted**

Run: `PATH=/opt/homebrew/opt/node/bin:$PATH npx prettier --write src/scripts/board-travel.ts src/components/pages/ClassroomGroupsPage.astro && npm run -s typecheck`
Expected: `0 errors`, `0 warnings`, `0 hints`.

- [ ] **Step 4: Stage** (`git add src/scripts/board-travel.ts src/components/pages/ClassroomGroupsPage.astro docs/superpowers/specs/2026-10-14-board-students-travel-design.md`).

### Task 3: Wire the deal and the board

**Files:**
- Modify: `src/scripts/classroom-groups.ts` (`showWaiting`, `finishDealNow`, the submit handler, the projector's `onLeave`)
- Modify: `src/scripts/projector.ts` (`Projector.isOpen`, the Shuffle click handler)
- Modify: `tests/e2e/helpers.ts` (`openWaitingBoard` takes an optional speed)

**Interfaces:**
- Consumes: `travel` (Task 2), `travelOrder`, `travelSchedule` (Task 1).
- Produces: `Projector.isOpen(): boolean`; `openWaitingBoard(page, count, size, speed?)`.

- [ ] **Step 1: `projector.ts`.** Add to `interface Projector`:

```ts
  /** Whether the board is up, so a deal knows it may travel (#744). */
  isOpen: () => boolean;
```

return `isOpen: () => open,` from `renderProjector`, and in the Shuffle click handler replace the bare `reveal();` (and its comment) with:

```ts
    // With animation on, the deal travels from the waiting list into cards
    // that are already up (#744), so the groups are not faded in on top of
    // it; with animation off, `reveal` shows them at once, as before.
    if (handlers.animates?.() === false) reveal();
    else stopReveal();
```

- [ ] **Step 2: `classroom-groups.ts`, the list on its own.** Split `showWaiting` so the pool and the chips have their own homes, written ABOVE `showWaiting`'s docblock, which stays on `showWaiting` (review pass 4, F15: two functions put between a docblock and its function leave it sitting directly on another, which `stranded-docblocks` refuses):

```ts
  /** Everyone the deal will place who is not already seated (#743). */
  const waitingPool = (input: ReturnType<typeof dealInput>): Student[] => {
    const pinned = new Set(input.pinned.flat().map((s) => s.number));
    return (
      typeof input.students === 'number'
        ? Array.from({ length: input.students }, (_, i) =>
            anonymousStudent(i + 1),
          )
        : input.students.filter((s) => !s.absent)
    ).filter((s) => !pinned.has(s.number));
  };

  /** The waiting list, shown: every student in `pool`, numbered (#743). */
  const showList = (pool: readonly Student[]) => {
    waitingList.textContent = '';
    for (const student of pool) {
      const li = document.createElement('li');
      li.className = 'waiting-student';
      li.dataset.number = String(student.number);
      const number = document.createElement('span');
      number.className = 'number';
      number.textContent = String(student.number);
      li.appendChild(number);
      const name = rosterNames.get(student.number);
      if (name) {
        const who = document.createElement('span');
        who.className = 'who';
        who.textContent = name; // the untrusted value, set as TEXT
        li.appendChild(who);
      }
      waitingList.appendChild(li);
    }
    waitingError.hidden = true;
    waitingError.textContent = '';
    waiting.hidden = false;
  };
```

`showWaiting` becomes (measured in review pass 1: `ReturnType<typeof dealInput>` before `dealInput`'s declaration is a type position and compiles):

```ts
  /**
   * A board opened before the first deal: the heading, one card per group
   * the deal will make (`plannedGroups`, the deal's own code, so the count
   * cannot disagree), and every student the deal will place, numbered, with
   * the name beside the number where the roster has one. Rendered into
   * `#cg-results` through the same `render` a deal uses: one element, one
   * render path (AC2).
   */
  const showWaiting = () => {
    const input = dealInput();
    resultsHeadingEl.textContent = resultsHeadingText(classInput.value, t);
    render(plannedGroups(input) ?? []);
    // A pinned member is already in place: nothing deals it in.
    tables
      .querySelectorAll('.student')
      .forEach((c) => c.classList.add('dealt'));
    showList(waitingPool(input));
    results.hidden = false;
    projector?.setShuffleLabel(t.makeGroups);
  };
```

- [ ] **Step 3: one controller for a travelling deal.** Next to `dealToken`:

```ts
  // #744: the travelling deal's way out. `finish` lands everyone now (a
  // detail changed, or the board closed); `superseded` is a newer deal.
  let travelling: AbortController | null = null;
  const finishDealNow = () => {
    dealSkip = true;
    travelling?.abort('finish');
  };
```

- [ ] **Step 4: the submit handler.** Replace `hideWaiting();` after `const { groups, warnings } = outcome.result;` with:

```ts
    // #744: on the board with animation on, the deal travels from the list,
    // so the list is (re)shown for it; ruling 2 brings everyone back to it
    // on a second Shuffle too. Anywhere else the list goes, as before.
    const travels =
      (projector?.isOpen() ?? false) && speedSelect.value !== 'skip';
    travelling?.abort('superseded');
    travelling = null;
    if (travels) showList(waitingPool(input));
    else hideWaiting();
```

and replace `await animate(speedSelect.value);` inside the `try` with:

```ts
      if (travels) await travelDeal(groups, input);
      else await animate(speedSelect.value);
```

with, above the submit handler:

```ts
  /** The board's travelling deal (#744): order, schedule, then the flights. */
  const travelDeal = async (
    groups: Student[][],
    input: ReturnType<typeof dealInput>,
  ) => {
    ++dealToken; // a page deal still running stops, as a newer deal says
    const pinned = new Set(input.pinned.flat().map((s) => s.number));
    for (const row of tables.querySelectorAll<HTMLElement>('.student'))
      if (pinned.has(Number(row.dataset.number))) row.classList.add('dealt');
    const order = travelOrder(groups, pinned);
    const schedule = travelSchedule(
      order.length,
      speedSelect.value === 'fast' ? 'fast' : 'normal',
    );
    if (!schedule) {
      tables
        .querySelectorAll('.student')
        .forEach((c) => c.classList.add('dealt'));
      hideWaiting();
      projector?.refit();
      return;
    }
    const controller = new AbortController();
    travelling = controller;
    sfx.shuffle();
    const outcome = await travel({
      list: waitingList,
      tables,
      order,
      schedule,
      signal: controller.signal,
      hideList: hideWaiting,
      refit: () => projector?.refit(),
      onLand: (i) => sfx.land(i),
    });
    if (travelling === controller) travelling = null;
    if (outcome === 'dealt') sfx.done();
  };
```

and import `travel` from `./board-travel` and `travelOrder`, `travelSchedule` from `../lib/travel`.

- [ ] **Step 5: leaving mid-travel.** First line of the projector's `onLeave`:

```ts
      finishDealNow(); // #744: a deal still travelling lands at once
```

- [ ] **Step 6: the helper.** In `tests/e2e/helpers.ts`, add `import { chooseSpeed } from '../make-groups';` after the `LOCALE_METADATA` import (`make-groups.ts` imports only Playwright's `Page` type, so nothing is circular), and make `openWaitingBoard`'s head:

```ts
export const openWaitingBoard = async (
  page: Page,
  count: string,
  size: string,
  speed?: 'normal' | 'fast' | 'skip',
) => {
  await page.goto('/classroom-groups');
  await page.fill('#cg-count', count);
  await page.fill('#cg-size', size);
  // #744: a board Shuffle travels unless the speed is Skip, so a test that
  // presses it says which it means; left out, the page's default stands.
  if (speed) await chooseSpeed(page, speed);
```

- [ ] **Step 7: run what the laptop runs.**

Run: `PATH=/opt/homebrew/opt/node/bin:$PATH npx prettier --write <changed files> && npm run -s typecheck && npm run -s lint:tests && npm run -s test:unit`
Expected: typecheck `0 errors`, lint `0 findings`, unit all green with the same total plus Task 1's 21.

- [ ] **Step 8: Stage** (`git add -u`). Expected from Step 7's unit run: green except the recorded-floor growth named in Task 1 Step 4 (measured in review pass 1: `source-files/walked-test-paths` 400 -> 401, `tree-reading/blank-paths` and `tree-reading/tracked` 606 -> 607).

### Task 4: E2E in every engine

**Files:**
- Create: `tests/e2e/classroom-groups-board-travel.spec.ts`
- Modify: `tests/e2e/classroom-groups-projector.spec.ts` (Step 1b)
- Modify: `tests/board-geometry.ts` (Step 0)

**Interfaces:**
- Consumes: `openWaitingBoard(..., speed?)` (Task 3), `travelSchedule`, `FOLD_MS` (Task 1), `FLOOR_PX` (projector.ts), `searched` (`../source-files`), `floorBreach` (`../floors`), `recorded` (`./evidence`).

- [ ] **Step 0: the stage's sideways overflow joins its one home.** `tests/guards/board-geometry.test.ts` allows one file under `tests/` that names `cg-board-stage` and `getClientRects` (the board is measured in one place, shared with the iOS leg). The spec's sampler needs the stage's overflow on every frame, so `measureBoard` gains it, and the spec ships `measureBoardScript()` into the page (review pass 4, F13). In `measureBoard`'s returned object, after `overflowY`:

```ts
    // How far the stage's content reaches past its width: the sideways
    // scroll a student in flight could open at 320px (#744).
    overflowX: stage.scrollWidth - stage.clientWidth,
```

- [ ] **Step 1: the spec, exactly this content.** Twelve students in groups of four, Normal speed unless a test says otherwise. Read before running it: the sampler counts what a viewer can see per student per frame; `recordAnimations` wraps `Element.animate` because `document.getAnimations()` also holds CSS transitions and a travelling deal schedules its flights one frame after the press, so a count read straight after a click is 0 either way (review pass 1, F5); every absence carries its population and a floor (F7).

```ts
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
```

- [ ] **Step 1b: the projector test a board Shuffle now travels under** (review pass 2, F12). `a shuffle done on the board is what the page shows on exit` read the board straight after `Shuffle again`; the deal now shows the waiting list again and travels from it, so `Waiting` was among the names it read. In `tests/e2e/classroom-groups-projector.spec.ts`, directly after that test's `Shuffle again` click (anchor: the click followed by the `` `#cg-board #cg-results`, not the whole board: `` comment), insert:

```ts
    // #744: a board Shuffle deals by travelling from the waiting list, which
    // it shows again first; read the board once that list has folded away,
    // or its heading is among the names.
    const listOnBoard = page.locator('#cg-board #cg-waiting');
    await expect(listOnBoard).toBeVisible();
    await expect(listOnBoard).toHaveCount(1);
    await expect(listOnBoard).toBeHidden();
```

Twelve students at Normal travel for 11 x 110 + 500 + 350 = 2,060 ms, inside the default expect timeout. The file's other `Shuffle again` (the warning test) reads no names and stays.

- [ ] **Step 2: run what the laptop runs** (`git add -N` the new files first, or `lint:tests` cannot see them; then `prettier --write`, `typecheck`, `lint:tests`). Expected: `0 errors`, `0 warnings`, `0 hints`; `0 findings in 4 changed test files (read 14 searches, 14 absences …)`. The spec runs in CI.
- [ ] **Step 3: One story commit** (`A board Shuffle with animation on carries each student from the list into their card (Refs #744)`, body: the rulings, the three totals, what each test pins), push, record floors (`gh workflow run record-floors.yml --ref develop -f branch=744-board-deal -f mode=full`), `git reset --keep` onto the bot's amend, read every moved floor, then open the PR.

### Task 5: Mutations, predicted before any run

Applied to the story head on probe branches, CI dispatched, each RED read from a message no other mutation in its run produces:

| # | Mutation | Predicted RED |
|---|---|---|
| T1 | `travelOrder` deals group by group (swap the two loops) | unit: the round-robin case, the pinned case |
| T2 | delete the chip's `animate` (the chip never hides during the flight) | e2e 1 `twice` x engines |
| T3 | row `fill: 'both'` | e2e 1 `twice` (the row shows over its chip during its delay) |
| T4 | `fold` leaves the list up (drop `o.hideList()`) | e2e 2 (the list is still visible) |
| T5 | the submit's `if (travels) showList(...)` becomes `hideWaiting()` | e2e 5 (12 chips after the second press) |
| T6 | `travelDeal` ignores Skip (`travels` without the speed check) and `travelSchedule` treats `skip` as `normal` | e2e 8 (animations after the press) |
| T7 | the finish path finishes every flight (drop `if (a.playState !== 'idle')`, review pass 2 F9) | e2e 7 (`leaving the board while students travel`: the 30 s wait for no animations) |
| T8 | the flight starts at `from.left - to.left` again (no `flightStartX`, F10) | e2e 10 (`frames where the board scrolled sideways` at 320 px) |
| T9 | `flightStartX` drops its right-edge hold (`Math.min(..., stage.right - width)` becomes its first argument) | unit: `moves the start in`, `still covers the whole chip`, `ends a row wider than the stage` |

Log each run's verdict in `.superpowers/sdd/744/mutations.md` with the run id.

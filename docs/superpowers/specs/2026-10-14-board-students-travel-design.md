# The board deals by moving students from the list into their cards (#744)

Status: design, self-reviewed (global rule 2026-09-24). Operator rulings
2026-10-14 are recorded on #744 (comment 6155861694) and quoted here where
they decide something.

## What the operator asked for

> "when we click the shuffle button, the students move from the list into the
> group cards" (2026-10-12 23:41Z)

On the full-screen board, opened before a shuffle (#743), every student waits
in the "Waiting to be grouped" list above empty group cards. Pressing Shuffle
should let the class watch each student leave the list and arrive in their
group.

## What the code does today (develop `c599b64a`, read 2026-10-14)

- The board's Shuffle calls the page's own submit (`form.requestSubmit`), so
  both buttons share one deal path (`classroom-groups.ts`, `renderProjector`
  handlers).
- `render(groups)` rebuilds every card with its final rows already in place;
  `#cg-results .student` is `opacity: 0` until `.dealt`, so the rows already
  hold their space. `animate()` adds `.dealt` one row at a time every
  `NORMAL_STEP_S` (0.11 s) or `FAST_STEP_S` (0.045 s), playing `sfx.land(i)`.
- On the board, `reveal()` (projector.ts) also fades whole groups in, one per
  `REVEAL_STEP_MS` (220 ms).
- `#cg-waiting` sits ABOVE `#cg-tables` in normal flow; `hideWaiting()` hides
  it the moment a deal starts.
- A press during a deal supersedes it (`dealToken`); a detail changed
  mid-deal finishes it at once (`dealSkip`). There is no one-at-a-time guard:
  `busy` reads `goButton.disabled`, which only says the roster cannot be dealt
  (filed as #768).
- The board fits by font size (`refit`: `fitScale`, then `settleFont`), with a
  24 px floor; the stage is `overflow: hidden` unless it has to scroll. Cards
  do not clip.

## Rulings that shape the design (operator, 2026-10-14)

1. **The list folds away at the end.** While students travel, each leaves an
   empty gap, so the list keeps its size; every card is already its final size
   with an empty seat per student. After the last student lands, the empty list
   folds away in one animated move and the board re-fits once.
2. **A second Shuffle on the board returns everyone to the list, then deals
   again** with the same movement.
3. **A Shuffle pressed while students are moving starts again**: the deal in
   flight stops, everyone returns to the list, the new deal runs. This is
   today's supersede, kept.

## Design

### Three board states

| State | List | Cards | Fit measured for |
| --- | --- | --- | --- |
| Waiting (#743, unchanged) | every student as a chip | the planned cards, empty | list + empty cards |
| Travelling (new) | full size; a student who has left leaves a gap | the dealt cards, every row in place but unseen | list + dealt cards |
| Dealt (today's end state) | gone | the dealt cards, every row seen | dealt cards |

Pressing Shuffle moves Waiting → Travelling in one step: `render(groups)`
draws the dealt cards (one render path, as today) and the board re-fits for
list + dealt cards. That step happens before any student moves, so AC6's "no
layout shift while students move" holds: the cards grow to their seated size
once, at the press, and then hold still. Travelling → Dealt is the folding
move from ruling 1.

### What travels

Each student is two elements today, and stays two: the list's chip (number,
then name, #743's design) and the card's row (avatar, then name or "Student
n", today's results). What the class sees travel is **one visible element per
student at every moment**: in the frame a student's turn comes, the chip goes
`visibility: hidden` (its box stays, which is the ruled gap) and the row,
already in its seat, is shown and drawn over the chip's box by a transform,
then animated to its seat. Nothing is left behind and nothing appears ahead.

The literal reading of AC1, one DOM element carried from list to card, would
need the chip and the row to be the same element, so the list would have to
change from #743's number-and-name to the card's avatar-and-name, and its four
waiting baselines with it. The visible requirement is the one AC1 states in
its parenthesis, so this design keeps #743's list and meets that. It is said
in the PR for the operator's review.

The flight is FLIP with the Web Animations API. Because the Travelling
layout holds still (the list keeps its gaps, the cards their seats), every
chip box and every seat box can be measured once, at the press, and every
flight scheduled then:

- the row: `row.animate([{ opacity: 1, transform: translate(dx, dy) }, {
  opacity: 1, transform: 'none' }], { delay: start, duration: flightMs,
  easing, fill: 'forwards' })`. `forwards`, never `backwards` or `both`:
  during its delay the row keeps its own `opacity: 0`, so it cannot be seen
  over a chip that is still showing;
- the chip: `chip.animate([{ visibility: 'hidden' }, { visibility: 'hidden'
  }], { delay: start, duration: flightMs, fill: 'forwards' })`, so the chip
  goes in the same frame the row appears over it.

On each row's `finished`, the row takes `.dealt` (with no transition, so the
class and the fill agree and nothing flashes), the chip takes a class that
keeps it hidden, and both fills are cancelled, so no animation is left
holding a style. While it flies the row sits above other content
(`position: relative`, a `z-index`, removed on landing). The stage is the only
clipping box, so a flight stays on the board.

### Order and timings: pure, in `src/lib/travel.ts`

- `travelOrder(groups, pinned)`: student numbers in the order they travel,
  dealt round-robin like cards: the first seat of every group, then the
  second, and so on. A group that is full is passed over; a pinned student is
  already seated and never travels. Decided once, from the dealt groups, so a
  seeded `random` gives the same run every time.
- `travelSchedule(count, speed)`: each student's start (`i × step`, where step
  is `NORMAL_STEP_S` or `FAST_STEP_S`, the steps the land sounds are already
  pinned against in `sfx.test.ts`), the flight (`FLIGHT_NORMAL_MS` 500,
  `FLIGHT_FAST_MS` 250), the fold (`FOLD_MS` 350) and the total
  `(count − 1) × step + flight + fold`.
  - Normal, 30 students: 29 × 110 + 500 + 350 = **4,040 ms**.
  - Normal, 100 students (the maximum): 99 × 110 + 500 + 350 = **11,740 ms**,
    the ceiling AC2 states.
  - Fast, 30: 29 × 45 + 250 + 350 = **1,905 ms**.
  - `skip` returns no schedule: nothing moves.

### The DOM side: `src/scripts/board-travel.ts`

`travel({ list, tables, order, schedule, signal })` resolves when the fold has
finished. It uses only the elements the page already renders:

1. At the press, measure every chip and seat and schedule every flight as
   above; play `sfx.land(i)` as each row lands (its `finished`).
2. After the last landing: the fold. By then every chip is hidden and the
   list shows only its heading. Read every card's box, hide `#cg-waiting`,
   re-fit, read the boxes again, and animate each card from its old box to its
   new one (translate plus the font ratio as a uniform scale) over `FOLD_MS`.
   The cards rise over the space the heading left in that same move: one
   move, as ruled, and nothing fades separately.
3. `signal` (an `AbortSignal`) covers both ways out the page already has:
   - **finish now** (`dealSkip`, a detail changed): every running and pending
     flight `.finish()`es with its landing sound suppressed (a skip must not
     play every remaining sound in one frame), the fold runs without
     animation, and the board is Dealt.
   - **superseded** (`dealToken`, a newer press): every animation is
     `.cancel()`led and the function returns without touching anything; the
     new deal owns the board and starts from the list (ruling 3).

### Wiring in `classroom-groups.ts`

The submit handler keeps one path. After `render(groups)`, it asks whether
the deal travels: the board is open, its list is up (or groups exist, for
ruling 2), and `speedSelect.value !== 'skip'`. If so, it re-shows the list
(ruling 2: `showWaiting` from the dealt pool, chips in number order), re-fits
for Travelling, and awaits `travel(...)` instead of `animate(...)`. The
board's own group `reveal()` does not run for a travelling deal (the cards are
already on the board, empty). The page outside the board, and the board with
animation off, keep exactly today's behaviour.

For ruling 2 only the list is rebuilt, not the empty planned cards: the chip
builder inside `showWaiting` moves into its own function
(`renderWaitingList(pool)`, chips in the order #743 lists them), which
`showWaiting` and the reshuffle both call. `render(groups)` then draws the
dealt cards as on every deal.

### Reduced motion and Skip

`#cg-speed` is already the one fact (`reduceMotion` forces it to `skip`). With
`skip` no schedule is made: the list hides, every row is `.dealt`, the board
re-fits once. Nothing moves (AC3).

### Screen readers

Unchanged. The rows are in the cards from the start of the deal, as today;
the results summary is still written after `results.hidden = false`. The chip
list is hidden once the fold ends.

### Known limit

With 100 students the Travelling fit can reach the 24 px floor and the stage
scrolls; a seat below the visible part of the stage is reached out of view.
The Dealt state fits as today. Not worth more machinery for the largest class
the page accepts; it is said in the PR.

### Assumed, to be measured by the plan's first review pass

- That `visibility` is animated by `Element.animate()` as a discrete property
  in Chromium, Firefox and WebKit alike (the chip's hide depends on it). If
  any engine does not, the chip is hidden by a class added at its start
  instead, and the never-twice sampling must still pass.
- That 500 ms flights 110 ms apart read as watchable on a projector. The
  figures are stated in the PR for the operator's manual test; nothing here
  measures watchability.

## Testing

- **Unit, written first** (`tests/unit/travel.test.ts`, one test per case):
  round-robin order for equal and unequal groups, a group of one, pinned
  students never travelling, a seeded deal giving the same order twice, every
  number exactly once; schedule starts, totals (the three figures above
  pinned as literals), the 100-student ceiling, and `skip` producing none.
- **E2E in every engine** (`tests/e2e/classroom-groups-board-travel.spec.ts`):
  - each student ends in the card the deal put them in (read off the dealt
    DOM, compared with the order the page exposes);
  - **never twice, never missing**: at each step, for every student, exactly
    one of chip or row is visible, sampled by an in-page recorder that counts
    its own samples (liveness: at least one sample per student);
  - the list keeps its size while students travel and is gone after the fold;
  - no horizontal scroll at any board shape and at 320 px; the Dealt fit holds
    the 24 px floor;
  - a second Shuffle returns everyone to the list, then deals again;
  - a press mid-travel starts again (no student shown twice across the
    switch);
  - a detail changed mid-travel finishes at once;
  - reduced motion and Skip: nothing animates (`document.getAnimations()`
    empty), every student in their card at once.
- **Timing in a real browser**: the scheduled total read from the running
  animations' own timings (`delay + duration`, so CI load cannot move it)
  equals `travelSchedule`'s total; the wall time from press to the fold's end
  is measured and printed, and asserted only from below (never faster than
  scheduled), never as a ceiling under load.
- **Visual**: the waiting and dealt baselines must not change; a moving state
  gets no baseline.

## Out of scope

- The page's own Shuffle outside the board (no list there).
- #768 (the stale `busy` comment), except where this change rewrites the same
  handler; if it does, #768 is checked against that code.

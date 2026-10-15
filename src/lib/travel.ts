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

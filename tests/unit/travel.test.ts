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

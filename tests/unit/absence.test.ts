import { describe, it, expect } from 'vitest';
import { absentNumbers, waitingRoll } from '../../src/lib/absence';
import { anonymousStudent, type Student } from '../../src/lib/grouping';

/**
 * Issue 999. The full-screen board lists every student before the shuffle,
 * absent ones included, and names the absent ones before and after it.
 */
const student = (number: number, absent = false): Student => ({
  ...anonymousStudent(number),
  absent,
});

describe('waitingRoll (#999)', () => {
  it('lists a bare count as 1..n, nobody absent', () => {
    expect(waitingRoll(3, new Set()).map((s) => s.number)).toEqual([1, 2, 3]);
  });

  it('keeps absent students, in roster order', () => {
    const roll = waitingRoll(
      [student(4), student(2, true), student(9)],
      new Set(),
    );
    expect(roll.map((s) => [s.number, s.absent])).toEqual([
      [4, false],
      [2, true],
      [9, false],
    ]);
  });

  it('leaves out a student already seated by a pin', () => {
    const roll = waitingRoll(
      [student(1), student(2), student(3)],
      new Set([2]),
    );
    expect(roll.map((s) => s.number)).toEqual([1, 3]);
  });

  it('lists nobody for an empty roster', () => {
    expect(waitingRoll([], new Set())).toEqual([]);
  });
});

describe('absentNumbers (#999)', () => {
  it('is empty for a bare count', () => {
    expect(absentNumbers(12)).toEqual([]);
  });

  it('is empty when nobody is absent', () => {
    expect(absentNumbers([student(1), student(2)])).toEqual([]);
  });

  it('lists every absent number in roster order, not sorted', () => {
    expect(
      absentNumbers([student(7, true), student(1), student(3, true)]),
    ).toEqual([7, 3]);
  });
});

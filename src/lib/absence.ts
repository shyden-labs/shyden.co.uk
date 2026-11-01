import { anonymousStudent, type Student } from './grouping';

/**
 * Issue 999. Who the full-screen board lists while it waits for the first
 * shuffle: every student in roster order, absent ones INCLUDED (the page
 * marks them), less anyone a pin has already seated. A bare count is 1..n,
 * nobody absent, which is what the deal itself reads it as.
 */
export const waitingRoll = (
  students: number | readonly Student[],
  pinned: ReadonlySet<number>,
): Student[] =>
  (typeof students === 'number'
    ? Array.from({ length: students }, (_, i) => anonymousStudent(i + 1))
    : [...students]
  ).filter((s) => !pinned.has(s.number));

/**
 * Issue 999. The absent students' numbers, in roster order. Both sources
 * the page has arrive here as `absent: true`: the roster's Absent tick, and
 * the absent student-numbers field through `studentsForInput`. A bare count
 * means nobody was marked.
 */
export const absentNumbers = (
  students: number | readonly Student[],
): number[] =>
  typeof students === 'number'
    ? []
    : students.filter((s) => s.absent).map((s) => s.number);

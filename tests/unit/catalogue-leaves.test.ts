import { describe, expect, it } from 'vitest';
import { catalogueLeaves, stringLeaves } from '../../src/lib/catalogue-leaves';

/**
 * The walk every catalogue guard reads through (`one-home.test.ts` keeps it
 * the only one), pinned by content: a walk that stopped entering arrays, or
 * spelled a path differently, would leave every guard green over less copy
 * than it claims to read.
 */
const render = (): string => 'rendered at runtime';
const TABLE = {
  title: 'Classroom groups',
  errors: { NO_STUDENTS: 'Add at least one student.' },
  howToSteps: ['Add students', { note: 'Pick a size' }],
  maxGroups: 12,
  render,
  empty: {},
  none: [],
};

describe('catalogueLeaves', () => {
  it('addresses every leaf by the path the guards report, arrays included', () => {
    expect(catalogueLeaves(TABLE)).toEqual([
      ['title', 'Classroom groups'],
      ['errors.NO_STUDENTS', 'Add at least one student.'],
      ['howToSteps[0]', 'Add students'],
      ['howToSteps[1].note', 'Pick a size'],
      ['maxGroups', 12],
      ['render', render],
    ]);
  });

  it('reads copy as the strings alone', () => {
    expect(stringLeaves(TABLE)).toEqual([
      ['title', 'Classroom groups'],
      ['errors.NO_STUDENTS', 'Add at least one student.'],
      ['howToSteps[0]', 'Add students'],
      ['howToSteps[1].note', 'Pick a size'],
    ]);
  });
});

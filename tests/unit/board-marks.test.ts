import { describe, expect, it } from 'vitest';
import { BOARD_SHAPES, groupMark, numbersOnly } from '../../src/lib/boardMarks';

/**
 * #1338: on the projected board each group carries a shape, a tone and its
 * number, so a student finds their group from their seat by more than colour
 * alone. Six of each, repeating from group 7; the number never repeats.
 */
describe('groupMark: the shape, tone and number a group shows on the board', () => {
  it('uses the six shapes in their order', () => {
    expect(BOARD_SHAPES).toEqual(['●', '▲', '■', '◆', '★', '✚']);
  });

  it('gives the first group the first shape and tone', () => {
    expect(groupMark(0)).toEqual({ shape: '●', tone: 1, number: 1 });
  });

  it('gives the sixth group the last shape and tone', () => {
    expect(groupMark(5)).toEqual({ shape: '✚', tone: 6, number: 6 });
  });

  it('starts the shapes and tones again at group 7, with its own number', () => {
    expect(groupMark(6)).toEqual({ shape: '●', tone: 1, number: 7 });
    expect(groupMark(9)).toEqual({ shape: '◆', tone: 4, number: 10 });
  });
});

describe('numbersOnly: the board shows numbers first when no student in the deal has a name', () => {
  it('is true when the roster has no names at all', () => {
    expect(numbersOnly([1, 2, 3], new Map())).toBe(true);
  });

  it('is false when any dealt student has a name', () => {
    expect(numbersOnly([1, 2, 3], new Map([[2, 'Ayu']]))).toBe(false);
  });

  it('does not count a blank name', () => {
    expect(numbersOnly([1, 2], new Map([[2, '  ']]))).toBe(true);
  });

  it('does not count a name for a student who is not in the deal', () => {
    expect(numbersOnly([1], new Map([[9, 'Ayu']]))).toBe(true);
  });
});

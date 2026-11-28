/**
 * What each group shows on the projected board (#1338): a shape, a tone and
 * its number, so a student finds their group from their seat by more than
 * colour alone. Six shapes and six tones, repeating from group 7; the number
 * never repeats.
 */

export const BOARD_SHAPES = ['●', '▲', '■', '◆', '★', '✚'] as const;

export type BoardTone = 1 | 2 | 3 | 4 | 5 | 6;

export interface GroupMark {
  shape: (typeof BOARD_SHAPES)[number];
  tone: BoardTone;
  number: number;
}

/** The mark of the group at 0-based `index`. */
export function groupMark(index: number): GroupMark {
  const slot = index % BOARD_SHAPES.length;
  return {
    shape: BOARD_SHAPES[slot],
    tone: (slot + 1) as BoardTone,
    number: index + 1,
  };
}

/**
 * Whether the board shows students' numbers first: true when no dealt
 * student has a name that is more than whitespace.
 */
export function numbersOnly(
  numbers: readonly number[],
  names: ReadonlyMap<number, string>,
): boolean {
  return numbers.every((n) => (names.get(n) ?? '').trim() === '');
}

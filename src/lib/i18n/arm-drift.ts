import type { BackTranslationUnit } from './back-translate.ts';

/**
 * How far each arm of a message drifted from the arm it was made from. #754.
 *
 * No speaker of zh, vi or th is available (operator 2026-09-20), so a new arm
 * is the reviewed arm plus the smallest change, and a character diff is what
 * proves it (#505, #751). Every message has an `other` arm, so every other arm
 * is measured against that one.
 */

/** One arm of a message beside the arm it was made from. */
export interface ArmDrift {
  readonly message: string;
  readonly arm: string;
  readonly distance: number;
}

/**
 * Levenshtein distance by code point: a Thai tone mark is one change, and an
 * astral character one, not the two UTF-16 units it is stored as.
 */
export function editDistance(a: string, b: string): number {
  const from = [...a];
  const to = [...b];
  let previous = Array.from({ length: to.length + 1 }, (_, at) => at);
  for (let row = 1; row <= from.length; row += 1) {
    const current = [row];
    for (let column = 1; column <= to.length; column += 1)
      current[column] = Math.min(
        previous[column] + 1,
        current[column - 1] + 1,
        previous[column - 1] + (from[row - 1] === to[column - 1] ? 0 : 1),
      );
    previous = current;
  }
  return previous[to.length];
}

/** A message arm's key as `backTranslationUnits` spells it. */
const ARM_KEY = /^(.*) \[[^=\]]+=([^\]]+)\]$/;

/**
 * Every arm of every message in `units`, but `other`, with its distance from
 * its message's `other` arm. A message with no `other` arm is refused: there
 * is nothing to measure it against, and silence would read as no drift.
 */
export function armDrift(units: readonly BackTranslationUnit[]): ArmDrift[] {
  const messages = new Map<string, Map<string, string>>();
  for (const { key, translation } of units) {
    const match = ARM_KEY.exec(key);
    if (!match) continue;
    const [, message, arm] = match;
    const arms = messages.get(message) ?? new Map<string, string>();
    arms.set(arm, translation);
    messages.set(message, arms);
  }
  return [...messages].flatMap(([message, arms]) => {
    const other = arms.get('other');
    if (other === undefined)
      throw new Error(
        `${message} has no other arm to measure its arms against`,
      );
    return [...arms]
      .filter(([arm]) => arm !== 'other')
      .map(([arm, translation]) => ({
        message,
        arm,
        distance: editDistance(other, translation),
      }));
  });
}

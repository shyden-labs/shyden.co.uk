/**
 * A burn-down list's disagreement with today's reading, one home for the two
 * meta-guards that keep one (`floorless-searches`, `absence-liveness`) and for
 * the pre-push lint that applies them to a branch's changed files (#662).
 */

/** One scope, `file › test or function`, whose reading is not its listing. */
export interface BurnDownBreach {
  readonly key: string;
  readonly read: number;
  readonly listed: number;
}

/**
 * Every scope where `now` and `listed` disagree. Equality both ways (#515,
 * #609): more than listed is new debt, named; fewer is a conversion whose
 * entry was not lowered, named too, because the list only shrinks.
 */
export function burnDownBreaches(
  now: ReadonlyMap<string, number>,
  listed: Readonly<Record<string, number>>,
): BurnDownBreach[] {
  const keys = new Set([...now.keys(), ...Object.keys(listed)]);
  return [...keys]
    .map((key) => ({ key, read: now.get(key) ?? 0, listed: listed[key] ?? 0 }))
    .filter(({ read, listed: count }) => read !== count);
}

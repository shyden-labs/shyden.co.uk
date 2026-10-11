import {
  buildGroups,
  type GroupingInput,
  type Mode,
} from '../src/lib/grouping';
import { seeded, student } from './unit/factories';

/**
 * The apart-letters sweep (#650), once: the engine's guarantee that no group
 * holds two students who share an apart letter, tried on rosters from 4 to 30
 * students under three modes and a run of seeds.
 *
 * It has two homes and this is the logic of both. `tests/simulation/` runs it
 * in full (eight seeds a mode, every size); `tests/unit/grouping.test.ts` runs
 * a stand-in that meets the unit suite's limits (fewer seeds for the sizes
 * whose search is dear). Neither re-derives the roster, the modes or the check,
 * so the two cannot drift apart.
 */
export const APART_LETTERS = ['X', 'Y', 'Z'] as const;

export type ApartSweep = {
  /** Builds attempted. */
  attempts: number;
  /** Builds that succeeded, the ones the invariant was checked on. */
  successes: number;
  /** One line per group that held two students sharing an apart letter. */
  breaches: string[];
};

/**
 * Build a class of `n` students, apart letters dealt X, Y, Z round, in three
 * modes, `seeds` times each, the seeds `seeded(seed * 97 + n)`.
 */
export function apartSweep(n: number, seeds: number): ApartSweep {
  const students = Array.from({ length: n }, (_, i) =>
    student({ number: i + 1, apart: APART_LETTERS[i % APART_LETTERS.length] }),
  );
  // Cyclic assignment balances each letter's membership to ceil(n/3) at most,
  // the largest clique the search can ever meet for this roster -- used to
  // keep every mode comfortably feasible (a few groups of slack) rather than
  // accidentally constructing a SECOND pathological-search fixture here; that
  // is the search-budget test's job, in its own dedicated test.
  const largestLetterGroup = Math.ceil(n / APART_LETTERS.length);
  const modes: Mode[] = [
    { kind: 'groupCount', count: largestLetterGroup + 2 },
    { kind: 'groupCount', count: largestLetterGroup + 4 },
    {
      kind: 'perGroup',
      size: Math.max(2, Math.floor(n / (largestLetterGroup + 3))),
    },
  ];
  const sweep: ApartSweep = { attempts: 0, successes: 0, breaches: [] };
  for (const mode of modes) {
    if (mode.kind === 'groupCount' && mode.count > n) continue;
    for (let seed = 1; seed <= seeds; seed++) {
      sweep.attempts++;
      const input: GroupingInput = {
        students,
        mode,
        leftovers: 'spread',
        sexMode: 'off',
        pinned: [],
        random: seeded(seed * 97 + n),
      };
      const out = buildGroups(input);
      if (!out.ok) continue;
      sweep.successes++;
      // The invariant, re-derived from `apart` directly rather than trusting
      // any engine internal.
      for (const g of out.result.groups)
        for (const letter of APART_LETTERS) {
          const sharing = g.filter((s) => s.apart === letter).length;
          if (sharing > 1)
            sweep.breaches.push(
              `${JSON.stringify(mode)} seed ${seed}: ${sharing} students share ${letter}`,
            );
        }
    }
  }
  return sweep;
}

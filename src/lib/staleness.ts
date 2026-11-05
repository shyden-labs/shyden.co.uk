import type { Leftovers, SexMode } from './grouping';
import type { Strings } from './i18n';

/**
 * What the groups on screen were made from.
 *
 * Staleness is a COMPARISON, not a flag. A flag has to be cleared by every
 * code path that could undo the change, and the one that forgets is the
 * bug -- "the teacher put the size back to 4" would leave a badge saying
 * the groups are wrong when they are not (see classroom-groups.spec.ts's
 * own "undoing the change clears it" test, which exists to prove exactly
 * that). A comparison against a snapshot taken at shuffle time needs no
 * clearing at all: it is simply re-evaluated, every time, against whatever
 * the form says right now.
 *
 * One field per control that can invalidate a shuffle. `mode` folds the
 * mode radio (per-group / group count) AND its own number together into
 * one JSON string rather than two separate fields -- see `staleReason`'s
 * own doc comment for why that has to be a single comparison, not two.
 * `roster` is what the class list currently IS: stage 2 has no per-student
 * data yet, so #cg-count -- the page's only population control -- is the
 * whole of it (see classroom-groups.ts's own `readRoster`), the same way a
 * roster of named students would BE the class list once stage 3 gives the
 * page one. Stage 3 extends `readRoster` to fold real per-student fields
 * into the same object; it does not need a second field here or a second
 * machine alongside this one.
 *
 * Every field is a STRING on purpose, not because the underlying data
 * naturally is one -- `mode` and `roster` both carry JSON.stringify'd
 * shapes, not the bare number or object read off the form, because `!==`
 * below compares anything that is not a primitive by REFERENCE. Two
 * freshly-built arrays or objects with identical content are still two
 * different references, so an un-stringified field could never compare
 * equal to itself across two calls -- the notice would stick permanently,
 * and no revert could ever clear it, since no revert can make two
 * different objects the same object. `staleReason` enforces this at
 * runtime (`assertComparable`, below) as well as in the type: `astro check`
 * (CI, since #115) holds typed callers to `roster: string`, but a snapshot
 * assembled from the DOM or through a cast reaches it unchecked, and the
 * failure is silent -- a notice no revert can clear.
 */
export interface Snapshot {
  mode: string;
  leftovers: Leftovers;
  sexMode: SexMode;
  roster: string;
}

/**
 * Every field a `Snapshot` carries must be a primitive `!==` can compare by
 * VALUE -- see that interface's own doc comment for why an un-stringified
 * array or object would silently break the comparison instead of loudly
 * failing a test. Thrown, not coerced: a coercion like bare `String(x)`
 * would "fix" the crash but not the bug -- `String({})` is the same
 * `'[object Object]'` for every object regardless of content, which would
 * make two DIFFERENT rosters compare equal instead of two identical ones
 * compare unequal, the opposite failure. Failing loudly here, at the one
 * place every comparison already flows through, surfaces the mistake at
 * whichever call site made it, rather than as a badge that silently never
 * clears.
 */
const assertComparable = (snapshot: Snapshot): void => {
  for (const [key, value] of Object.entries(snapshot)) {
    if (typeof value !== 'string') {
      throw new TypeError(
        `Snapshot.${key} must be a string, normalised at the call site ` +
          `(e.g. JSON.stringify) so staleReason compares it by value -- ` +
          `got ${typeof value}.`,
      );
    }
  }
};

/**
 * Why the groups on screen no longer match what the form says now -- or
 * `null` if nothing that matters has changed.
 *
 * Checked in a fixed order and returns the FIRST mismatch, not every one:
 * design spec section 8 asks for a notice naming what changed, and one
 * clear sentence serves a teacher better than a list they have to read in
 * full before acting. That is not a one-shot decision, because the caller
 * recomputes this on every input -- so undoing the highest-priority
 * mismatch does not clear the notice by itself, it just means the very
 * next recompute reports whichever mismatch is still live (or `null`, if
 * none is). See classroom-groups.spec.ts's own "when two things change,
 * undoing one still names the other" test, which a one-shot "first cause
 * wins forever" implementation would fail.
 */
export function staleReason(
  then: Snapshot,
  now: Snapshot,
  t: Strings,
): string | null {
  assertComparable(then);
  assertComparable(now);
  if (then.mode !== now.mode) return t.staleMode;
  if (then.leftovers !== now.leftovers) return t.staleLeftovers;
  if (then.sexMode !== now.sexMode) return t.staleSexMode;
  if (then.roster !== now.roster) return t.staleRoster;
  return null;
}

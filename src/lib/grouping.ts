/**
 * The Classroom Group Creator engine.
 *
 * Pure: no DOM, no timers, and no randomness of its own — the caller supplies
 * the random source. That is what makes "put the leftovers in a random group"
 * testable rather than either flaky or asserted so weakly it proves nothing.
 *
 * Errors are returned as a CODE plus data, never as a rendered sentence. The
 * sibling gloryPoints.ts keeps English copy in the module because it only ever
 * serves one language; this tool ships in English and Bahasa Indonesia, so the
 * message has to be composed by the locale layer. Returning
 * `{ code, students, groupsNeeded }` also lets the Indonesian page name the
 * conflicting children, which string concatenation in English could not.
 *
 * A successful outcome can still carry something worth telling the teacher --
 * `result.warnings`, same CODE-plus-data shape as errors, rendered the same
 * way (see `renderWarning` in src/lib/i18n/index.ts). "Here are your groups,
 * and two students ended up with the other sex" is a success, not a refusal,
 * so it does not belong in GroupingError.
 */

export interface Student {
  /** The identity. Unique, whole, and the teacher's to choose — gaps allowed. */
  number: number;
  name: string | null;
  sex: 'M' | 'F' | null;
  absent: boolean;
  /** Letter. Everyone sharing it is placed as one unit. */
  together: string | null;
  /** Letter. Everyone sharing it is mutually separated. */
  apart: string | null;
}

export type Mode =
  { kind: 'perGroup'; size: number } | { kind: 'groupCount'; count: number };

export type Leftovers = 'spread' | 'bunch';

export type SexMode = 'off' | 'mix' | 'separate';

export interface GroupingInput {
  /** A bare count (anonymous students) or the roster. */
  students: number | Student[];
  mode: Mode;
  leftovers: Leftovers;
  sexMode: SexMode;
  /** Groups the teacher pinned; left exactly as they are. */
  pinned: Student[][];
  /** Injected so results are reproducible in tests. */
  random: () => number;
  /**
   * The search's node budget per pass, injected like `random` so a unit test
   * reaches the "gave up" path without spending the real budget (#714). The
   * page never sets it: the default is `SEARCH_NODE_CAP`, and the real-budget
   * runs live in `tests/simulation/`.
   */
  searchNodeCap?: number;
}

export const ERROR_CODES = {
  noStudents: 'NO_STUDENTS',
  tooManyStudents: 'TOO_MANY_STUDENTS',
  /** Two records claimed the same number — the roster is ambiguous. */
  duplicateNumber: 'DUPLICATE_NUMBER',
  invalidGroupSize: 'INVALID_GROUP_SIZE',
  invalidGroupCount: 'INVALID_GROUP_COUNT',
  tooManyGroups: 'TOO_MANY_GROUPS',
  /**
   * Two students in the same together-block also hold the same apart-letter
   * as each other -- kept together and kept apart from each other at once.
   * Caught as a contradiction before the placer ever runs; see the comment
   * at its call site in buildGroups for why that beats letting the search
   * fail on it.
   */
  togetherApartClash: 'TOGETHER_APART_CLASH',
  /** A together-letter unit is bigger than even the largest group. */
  togetherUnitTooLarge: 'TOGETHER_UNIT_TOO_LARGE',
  /** PROVEN by exhaustive search: no arrangement of together-blocks fits at this group count. */
  togetherNoArrangement: 'TOGETHER_NO_ARRANGEMENT',
  /** Proves NOTHING: the together-block search hit its budget. Says so rather than guessing. */
  togetherSearchGaveUp: 'TOGETHER_SEARCH_GAVE_UP',
  /** PROVEN by a clique: these students all conflict, so they need N groups. */
  keepApartImpossible: 'KEEP_APART_IMPOSSIBLE',
  /** PROVEN by exhaustive search: no arrangement exists at this group count. */
  keepApartNoArrangement: 'KEEP_APART_NO_ARRANGEMENT',
  /** Proves NOTHING: the search hit its budget. Says so rather than guessing. */
  keepApartSearchGaveUp: 'KEEP_APART_SEARCH_GAVE_UP',
  /**
   * PROVEN by exhaustive search, but with BOTH a together- and an apart-letter
   * live, so unlike the two codes above this cannot be pinned on one rule.
   * See the comment at its call site in buildGroups for why guessing is worse
   * than saying so.
   */
  bothRulesNoArrangement: 'BOTH_RULES_NO_ARRANGEMENT',
  /** Proves NOTHING: the search hit its budget with both kinds of rule live. */
  bothRulesSearchGaveUp: 'BOTH_RULES_SEARCH_GAVE_UP',
  /**
   * A guard, not a feature. Stage 2 disables the mix and separate switches
   * until every student being grouped already has a sex, so this should be
   * unreachable from the real page -- it exists because this module is the
   * pure logic and must not trust its caller. Scoped to `sexMode !== 'off'`
   * (`mix` and `separate` alike) as of Task 8a, widened from `mix` only:
   * Task 7 scoped it narrower because at the time `separate` did not read
   * `sex` anywhere in this file, and refusing a roster over a field a mode
   * never consulted would have been a real regression (an executable
   * tripwire test existed for exactly this in grouping.test.ts; Task 8a
   * updates it rather than deleting it -- see "sex mode: mix"'s
   * now-refuses test for the history). Task 8a widens the predicate
   * deliberately, ahead of Task 8b's separate-mode PLACEMENT landing: an
   * unset sex is equally unusable input for `separate` as for `mix`, so
   * refusing it now means Task 8b does not also have to remember to add
   * this guard once it wires `sex` into `separate`'s placement. `off`
   * alone stays unguarded -- it is the one mode that genuinely never reads
   * `sex`, at any point in this file, today or after Task 8b. See the call
   * site in buildGroups for why it is checked where it is.
   */
  sexNeedsAllSet: 'SEX_NEEDS_ALL_SET',
  /**
   * Task 8b. A together-letter unit whose members are not all the same
   * sex is a contradiction under `separate`: single-sex groups and "these
   * students are one unit, wherever it lands" cannot both be honoured, so
   * it is refused before placement runs rather than resolved by silently
   * placing the whole unit on one side. See the call site in buildGroups
   * for exactly where, and `sexOf`'s note in weaveBySex for why picking a
   * side is fine under `mix` (which never claims single-sex groups) but
   * not here.
   */
  sexSeparateSplitsUnit: 'SEX_SEPARATE_SPLITS_UNIT',
  /**
   * Fix round 1, F-2. `allocationCandidates` (see its doc comment, next to
   * `allocateSexGroups`) tries every way of dividing the requested
   * `groupCount` between the two sexes that could not possibly leave
   * either side with an empty group, starting with the fairest
   * (proportional-by-headcount) and working outward -- and every one
   * failed, EACH ONE EXHAUSTED TO COMPLETION rather than cut short by its
   * own search budget (see `sexSeparateSearchGaveUp`, directly below, for
   * the sibling that fires when that is not true of every candidate). The
   * rules genuinely cannot be honoured at this group count, no matter how
   * it is split between boys and girls -- a PROOF, not a practical
   * near-certainty.
   *
   * Reported on its own rather than through whichever single-sex code the
   * LAST candidate happened to fail with (`togetherUnitTooLarge`,
   * `keepApartImpossible`, and so on): that code would carry a
   * SIDE-scoped number ("you need at least 3 groups") that flatly
   * contradicts the number the teacher actually typed once several
   * different splits have all been tried and rejected -- see the call
   * site in `buildSeparateGroups` for the concrete input this replaces,
   * and blame a specific rule the search has, collectively, not actually
   * isolated: a DIFFERENT candidate might have failed on a different rule
   * entirely. Same honesty pattern as `bothRulesNoArrangement`: names no
   * rule and no side, because after exhausting every split the engine
   * genuinely does not know which one is the problem.
   */
  sexSeparateImpossible: 'SEX_SEPARATE_IMPOSSIBLE',
  /**
   * Fix round 2. A finding raised during Fix round 1's own review and
   * deliberately left open there rather than decided unilaterally (see
   * that report's own closing paragraph): `sexSeparateImpossible` was
   * firing whenever every candidate `allocationCandidates` offered had
   * FAILED, without checking whether every one of those failures was
   * actually PROVEN. A candidate's own failure, from `attemptSplit` /
   * `placeSexSide`, is itself one of `togetherNoArrangement` /
   * `togetherSearchGaveUp`, `keepApartNoArrangement` /
   * `keepApartSearchGaveUp`, or `bothRulesNoArrangement` /
   * `bothRulesSearchGaveUp` (or the non-search proofs
   * `togetherUnitTooLarge` / `keepApartImpossible`, which are never a
   * "gave up" outcome -- see their own doc comments) -- so a candidate
   * whose search hit `SEARCH_NODE_CAP` proves nothing about THAT split, only
   * that the search stopped looking there. Measured on the reviewer's own
   * 1121-input sweep (see task-8b-report.md, "Fix round 2"): every one of
   * the 37 inputs that reported `sexSeparateImpossible` had at least one
   * candidate whose search gave up, never a case where every candidate was
   * genuinely exhausted.
   *
   * Fired whenever ANY candidate's failure was a gave-up one, even if every
   * OTHER candidate in the same search WAS proven impossible outright:
   * `buildSeparateGroups` tracks this across the whole candidate loop, not
   * just the last candidate tried, and the gave-up verdict wins over the
   * proof the instant it appears even once. This is the same weaker-claim
   * preference `assign`'s own "Not 'no arrangement exists' -- 'I stopped
   * looking'" comment states for a single search -- extended here across a
   * search OF searches: one unexplored split is enough to make "cannot be
   * done" a claim this run has not earned, and reporting the proof anyway
   * on the strength of the other candidates would be exactly the false
   * confidence the NoArrangement/SearchGaveUp split exists to prevent
   * everywhere else in this file (see the module doc). See the call site
   * in `buildSeparateGroups` for exactly how the two are told apart.
   *
   * Carries no data, matching `togetherSearchGaveUp` / `keepApartSearchGaveUp`
   * / `bothRulesSearchGaveUp` above: unlike `groupsRequested` on
   * `sexSeparateImpossible` (which is simply `mode.count`, known upfront and
   * independent of what the search proved), there is nothing this code has
   * actually established that a number could honestly report.
   */
  sexSeparateSearchGaveUp: 'SEX_SEPARATE_SEARCH_GAVE_UP',
  /**
   * Task 9. A together-letter unit that straddles a pinned boundary: some
   * of its members are locked inside a pinned group, and at least one is
   * not. The pinned group is not being added to -- pins are left exactly as
   * they are -- so the member(s) outside it have nowhere the rule can put
   * them. Refused rather than silently unpinning (which would undo
   * something the teacher explicitly asked to keep) or silently dropping
   * the together-letter (which would undo something else the teacher
   * explicitly asked for). See the call site in `buildGroups` for exactly
   * which boundaries this checks -- pinned-group-vs-pool, and (Fix round 1,
   * F-3) pinned-group-vs-pinned-group: a unit split between two DIFFERENT
   * pinned groups is the identical contradiction with neither member in
   * the pool -- each pinned group was being honoured independently, so two
   * together-lettered students who each ended up pinned into a different
   * group stayed apart with no error or warning. Reported but not built at
   * Task 9 (judged a preference unmet, not unsafe); built here by reusing
   * this same code rather than inventing a second, once the reviewer set
   * out why that reasoning does not hold -- `together` is a hard
   * constraint everywhere else in this engine (`togetherUnitTooLarge`,
   * `sexSeparateSplitsUnit`, and this code's own original pool-vs-pinned
   * case), and the brief's own rule text was never scoped to the pool: "a
   * together-unit split across a pinned boundary is refused" -- two pinned
   * groups is a pinned boundary too. See the Fix round 1 report.
   */
  pinnedSplitsUnit: 'PINNED_SPLITS_UNIT',
  /**
   * Task 9. Two students who share an apart-letter (mutually separated)
   * pinned into the SAME group -- the teacher has asked for two
   * contradictory things about the same pair. Refused, not warned: unlike
   * `pinnedMixedSex` below (a placement PREFERENCE a pin can knowingly
   * override), an apart-letter is a student-safety/behaviour-management
   * signal, and every other apart-letter violation in this engine
   * (`togetherApartClash`, `keepApartImpossible`) is a hard refusal with no
   * warning-level precedent anywhere in this file. See the Task 9 report
   * for the full reasoning distinguishing the two decisions.
   */
  pinnedApartClash: 'PINNED_APART_CLASH',
  /**
   * Task 9. The same student number claimed by more than one pinned group
   * (or twice within one group's own list) -- resolved independently
   * against the current roster each time it appears, so without this guard
   * the same student is placed into the final output MORE THAN ONCE,
   * breaking the one invariant `Student.number` promises ("identity is the
   * number, unique"). The same class of defect `duplicateNumber` already
   * refuses for the raw roster; this is that same defect reached through
   * the pins instead. Unlike `duplicateNumber` (which fires before the
   * roster can be trusted at all, so it cannot resolve a name),
   * `pinnedInTwoGroups` fires after matching against the current roster, so
   * the number is a real, current student -- `renderError`'s resolver
   * names them.
   */
  pinnedInTwoGroups: 'PINNED_IN_TWO_GROUPS',
  /**
   * Fix round 1, F-1 and F-2 -- the same situation from two directions (see
   * the Fix round 1 report). Once the pinned groups are set aside,
   * `mode.count - pinnedGroups.length` groups remain for the POOL to fill.
   * REPLACES the single check that used to stand at this call site, which
   * only caught one of the two ways that number can be unusable:
   *
   *   - F-2: the pins alone already claim every group `groupCount` mode
   *     asked for, or more (`pinnedGroups.length >= mode.count`) -- this
   *     used to report `tooManyGroups` with `maxGroups: sizes.length`, and
   *     `targetSizes` always returns exactly `mode.count` entries under
   *     `groupCount` mode, so that "maximum" was ALWAYS the exact number
   *     the teacher had just typed. "The most you can have is the number
   *     you asked for" is a tautology, not a fix.
   *   - F-1: MORE pool groups were asked for than pool students remain to
   *     fill them (`mode.count - pinnedGroups.length > pool.length`) --
   *     entirely unguarded before this fix. `targetSizes` does not refuse
   *     this either: under `groupCount` mode it always returns exactly
   *     `poolMode.count` entries regardless of `total`, so a `total`
   *     smaller than that count comes back with one or more ZERO-size
   *     entries instead of an error (`base` floors to 0, and the leftovers
   *     pass has nothing left to top them up with) -- `assign` then happily
   *     seats zero blocks in a zero-capacity group, and the teacher was
   *     shown a real, empty group on screen. Confirmed reachable, not
   *     hypothetical: 10 students / groupCount 4 / one pin of 8 leaves a
   *     pool of 2 for 3 pool groups and returned `ok: true` with one of
   *     them empty -- see the Fix round 1 report for this and two more
   *     reachable shapes.
   *
   * Both are the SAME situation from the pool's point of view -- "the pins
   * do not leave room for the groups you asked for" -- so ONE code covers
   * both directions rather than inventing a second. See the call site in
   * `buildGroups` for the exact inequality (one check, both directions) and
   * `tooManyGroups`'s own doc comment for the non-pinned version of this
   * same idea, which this code does not touch: `tooManyGroups` still fires,
   * unchanged, for a `groupCount` request that exceeds the WHOLE roster
   * before any pin is ever considered (checked far earlier in
   * `buildGroups`, against `present.length`).
   */
  pinnedTooManyGroups: 'PINNED_TOO_MANY_GROUPS',
} as const;

export type ErrorCode = (typeof ERROR_CODES)[keyof typeof ERROR_CODES];

/**
 * An error and exactly the data its message needs — never a bag of optionals.
 *
 * With every field optional, `renderError({ code: KEEP_APART_IMPOSSIBLE })`
 * type-checks and renders " all need to be kept apart from each other, so
 * you would need at least 0 groups. Either make more groups or remove one
 * of the rules.", and the renderer needs `?? []` and `?? 0` fallbacks whose
 * only job is to turn missing data into a plausible-looking sentence. A
 * union removes both: the data cannot be absent, so there is nothing to
 * fall back to.
 */
export type GroupingError =
  | { code: typeof ERROR_CODES.noStudents }
  | { code: typeof ERROR_CODES.tooManyStudents; maxStudents: number }
  | { code: typeof ERROR_CODES.duplicateNumber; number: number }
  | { code: typeof ERROR_CODES.invalidGroupSize }
  | { code: typeof ERROR_CODES.invalidGroupCount }
  | { code: typeof ERROR_CODES.tooManyGroups; maxGroups: number }
  | {
      code: typeof ERROR_CODES.togetherApartClash;
      // Numbers, not names -- same reasoning as keepApartImpossible below:
      // identity is the number (Student.number), and the engine has no
      // roster to format a display string from. renderError's resolver
      // parameter is what turns these into words; see its doc comment in
      // src/lib/i18n/index.ts.
      students: number[];
    }
  | {
      code: typeof ERROR_CODES.togetherUnitTooLarge;
      letter: string;
      unit: number;
      groupSize: number;
    }
  | { code: typeof ERROR_CODES.togetherNoArrangement; groupsTried: number }
  | { code: typeof ERROR_CODES.togetherSearchGaveUp }
  | {
      code: typeof ERROR_CODES.keepApartImpossible;
      // Numbers, not names: identity is the number (see Student.number), and
      // the engine has no business formatting a display string -- the page
      // resolves a number to `name ?? "Student N"`, this union just carries
      // the fact. renderError's resolver parameter is what turns this into
      // words; see its doc comment in src/lib/i18n/index.ts.
      students: number[];
      groupsNeeded: number;
    }
  | { code: typeof ERROR_CODES.keepApartNoArrangement; groupsTried: number }
  | { code: typeof ERROR_CODES.keepApartSearchGaveUp }
  | { code: typeof ERROR_CODES.bothRulesNoArrangement; groupsTried: number }
  | { code: typeof ERROR_CODES.bothRulesSearchGaveUp }
  | {
      code: typeof ERROR_CODES.sexNeedsAllSet;
      // Numbers, not names -- same reasoning as togetherApartClash and
      // keepApartImpossible above: identity is the number (Student.number),
      // and the engine has no roster to format a display string from.
      // renderError's resolver parameter is what turns these into words.
      students: number[];
    }
  | {
      code: typeof ERROR_CODES.sexSeparateSplitsUnit;
      // Numbers, not names -- same reasoning as every other students-
      // carrying code above. Always >= 2 by construction: a together-unit
      // needs at least one member of each sex to trip this.
      students: number[];
    }
  | {
      code: typeof ERROR_CODES.sexSeparateImpossible;
      // The number the teacher actually typed (`mode.count`), never a
      // side's own smaller allocation -- that substitution is the exact
      // defect this code exists to fix (see its ERROR_CODES doc comment).
      // Constructed from `poolMode.count` (POOL-scoped: `mode.count` as
      // `buildSeparateGroups` itself sees it) at the one call site in
      // `buildSeparateGroups`, which only runs once `mode.kind ===
      // 'groupCount'` is already known (control flow narrows it there --
      // no cast needed, unlike a `students` list this module cannot prove
      // non-empty by construction) -- then restored to the WHOLE-CLASS
      // figure this comment promises by `restoreWholeClassCount`, once pins
      // are added back in, at the call site in `buildGroups` (whole-branch
      // review, C-1; see that function's own doc comment).
      groupsRequested: number;
    }
  | { code: typeof ERROR_CODES.sexSeparateSearchGaveUp }
  | {
      code: typeof ERROR_CODES.pinnedSplitsUnit;
      // Numbers, not names -- same reasoning as every other students-
      // carrying code above. Always >= 2 by construction: the unit spans
      // at least two of the pool/pinned-group REGIONS the pins carve the
      // roster into (Fix round 1, F-3 added the pinned-vs-pinned shape
      // alongside Task 9's original pinned-vs-pool one), so it has at
      // least one member in each of two of them. Every member of the unit
      // is named, in every region it touches (Fix round 1, F-4) -- not
      // just one representative pair from the first boundary found, which
      // used to leave a third (or later) member of the same letter
      // unnamed.
      students: number[];
    }
  | {
      code: typeof ERROR_CODES.pinnedApartClash;
      // Numbers, not names -- same reasoning as togetherApartClash above.
      // Always exactly the members of ONE pinned group who share an
      // apart-letter, so >= 2 by construction.
      students: number[];
    }
  | {
      code: typeof ERROR_CODES.pinnedInTwoGroups;
      // A single number, like duplicateNumber -- one offending student is
      // enough to act on, and (unlike a togetherApartClash-style pair)
      // there is no second party to this contradiction to name.
      number: number;
    }
  | {
      code: typeof ERROR_CODES.pinnedTooManyGroups;
      // All three always present, never optional -- the rendered sentence
      // (Fix round 1 report) needs every one of them: how many groups were
      // asked for, how many the pins already claim, and how many students
      // are left to place into whatever is left. The number of groups the
      // pool itself still needs (`requestedGroups - pinnedGroupCount`) is
      // NOT its own field -- it is fully determined by the other two, so
      // storing it too would be exactly the "bag of optionals" this type's
      // own doc comment warns against, just with a redundant field instead
      // of an absent one.
      requestedGroups: number;
      pinnedGroupCount: number;
      remainingStudents: number;
    };

/**
 * A successful outcome can still carry something worth telling the teacher
 * -- see the module doc comment. Same CODE-plus-data shape as ERROR_CODES,
 * for the same reason: a plain code, never rendered prose, so the locale
 * layer (`renderWarning` in src/lib/i18n/index.ts) is the one place a
 * sentence gets composed.
 *
 * `sexSpillover` is the only code this defines. Task 8a built the channel
 * -- this type, the outcome shape below, the renderer, the copy in both
 * locales -- ahead of the placement logic that would push a warning
 * through it, so that Task 8b's separate-mode placement (`buildSeparateGroups`,
 * `allocateSexGroups`, the spill, and the `warnings.push(...)` call that
 * actually fires this code) landed against a channel that was already
 * tested, translated and wired through renderWarning, rather than
 * inventing one from scratch alongside the harder placement work. `off`
 * and `mix` never populate this list -- only `separate`'s spill does (see
 * `buildSeparateGroups`).
 */
export const WARNING_CODES = {
  sexSpillover: 'SEX_SPILLOVER',
  /**
   * Task 9. A pinned group under `separate` whose members are not all the
   * same sex. DECISION (see the Task 9 report): a pin is the teacher's own
   * current, direct instruction about this exact group, overriding the
   * single-sex PREFERENCE `separate` otherwise expresses -- not the same
   * kind of contradiction `sexSeparateSplitsUnit` refuses (a together-
   * LETTER is a general rule that only incidentally spans two sexes, and
   * single-sex groups and "this letter is one unit" genuinely cannot both
   * be honoured). The engine's own spill mechanic already produces a
   * mixed-sex group under `separate` today, warned rather than refused
   * (`sexSpillover`), so refusing a teacher's own re-pin of exactly that
   * group would make the one arrangement `separate` itself can produce
   * unrepinnable. Warned, never silent: a teacher must not be handed a
   * mixed group after asking for single-sex ones with nothing said.
   */
  pinnedMixedSex: 'PINNED_MIXED_SEX',
  /**
   * Whole-branch review, I-2. Fires from the ONE place in
   * `buildSeparateGroups` where NEITHER sex has enough of its own kind for
   * even one group (`boysGroups === 0 && girlsGroups === 0`, both sexes
   * present) -- everyone is placed as a single combined group, because
   * there is no "other side's groups" for anyone to have joined. That call
   * site used to push TWO `sexSpillover` warnings there, one per sex, each
   * saying its side "joined a group of" the other -- about the SAME one
   * group, so both were true about the seating and both false about the
   * history: neither side had a pre-existing group to join, and the two
   * sentences contradict each other read side by side ("boys joined a
   * group of girls" / "girls joined a group of boys" cannot both describe
   * one merger). `sexSpillover`'s own `sex` field cannot express this
   * shape honestly no matter which value it is given -- it is built around
   * a HOST side that already has a group and a side that spills into it,
   * and this case has no host, so a distinct code says what actually
   * happened instead of forcing a two-sided event into a one-sided
   * vocabulary. See the call site in `buildSeparateGroups` for exactly
   * where this replaces the old pair.
   */
  sexBothTooSmall: 'SEX_BOTH_TOO_SMALL',
} as const;

/**
 * A warning and exactly the data its message needs -- same reasoning as
 * GroupingError above.
 */
export type GroupingWarning =
  | {
      code: typeof WARNING_CODES.sexSpillover;
      // `sex` is the sex of the NAMED students, not of the group they
      // landed in: the message needs to say both "you joined a group of
      // the other sex" and "there were not enough of your own", and the
      // spilled side's sex alone is enough data to derive both halves.
      students: number[];
      sex: 'M' | 'F';
    }
  | {
      code: typeof WARNING_CODES.pinnedMixedSex;
      // Every member of the one pinned group that is mixed-sex -- no `sex`
      // field, unlike sexSpillover above: there is no single "spilled"
      // side here, the group is simply mixed because the teacher pinned it
      // that way, and the copy does not need to say which sex is which to
      // make that point.
      students: number[];
    }
  | {
      code: typeof WARNING_CODES.sexBothTooSmall;
      // Every student in the one combined group -- both sexes together, not
      // one side. No `sex` field, unlike sexSpillover: there is no spilled
      // side and no host side, so no single sex is the "right" one to name;
      // see WARNING_CODES.sexBothTooSmall's doc comment. Always >= 2 by
      // construction (this only fires when both `boysCount > 0` and
      // `girlsCount > 0` -- see the call site), so, like
      // sexSeparateSplitsUnit, this never branches for singular/plural.
      students: number[];
    };

export type GroupingOutcome =
  | { ok: true; result: { groups: Student[][]; warnings: GroupingWarning[] } }
  | { ok: false; error: GroupingError };

/**
 * Backtracking node cap. A class is at most a few dozen students with a
 * handful of constraints, so a real solution is found in far fewer steps than
 * this. The cap exists so a pathological input degrades into an honest
 * "cannot be done" rather than hanging the teacher's browser.
 *
 * Measured uncapped, on a keep-apart list shaped like "these three wind each
 * other up, and those three, and those three" -- the worst case for both the
 * clique search below and the assignment search in `assign`, AS THOSE
 * FUNCTIONS EXISTED AT THE TIME: 24 students took 27ms, 36 took 471ms, 42
 * took 7.3s, and 48 took 121.7s. (Formerly reproduced by a `moonMoser` test
 * helper, retired in Task 2 along with the free-text `keepApart` field that
 * fed it.) SUPERSEDED, not just old -- see the Task 5 paragraphs below: this
 * exact shape (many disjoint SAME-size cliques) no longer reproduces on the
 * current engine at all, at any size up to the MAX_STUDENTS ceiling. Kept
 * here as a record of why the cap exists and roughly what scale of danger it
 * was guarding against, not as a claim about current behaviour -- Task 5
 * needed an equivalently pathological letter-based input to re-prove that,
 * not to trust these numbers, and found this shape does not transfer.
 *
 * This cap now also bounds `assign`'s block-placement search (Fix round 1,
 * F-2/F-3), a second and different consumer -- pure bin-packing among
 * same-cost groups, no conflicts, since `pairs` is still always empty this
 * stage. The measurements above were never taken against that shape of
 * input, so they justify the cap for keep-apart only; they are not evidence
 * for the together-block case, and should not be read as if they were.
 * tests/unit/grouping.test.ts pins one concrete together-block input that
 * exhausts the cap (Fix round 1, F-3), but that is one data point, not a
 * growth curve -- nobody has yet measured where together-block search time
 * blows up the way the keep-apart numbers above do.
 *
 * Fix round 2: block placement can now call `assign` up to twice, once per
 * pass (see `placeBlocks`). This cap is spent PER CALL, not once for the
 * whole placement -- each pass opens its own node counter at zero -- so the
 * true worst case for block placement is 2x this many nodes, not this many,
 * on the rare input that defeats both the shuffled order and
 * first-fit-decreasing.
 *
 * Task 5 re-measured against the CURRENT engine (block-based, two-pass) with
 * real letter-fed conflicts, rather than trusting the paragraph above -- and
 * the old shape turned out not to transfer. Many disjoint cliques, all the
 * SAME size (the literal old shape: "these three, and those three"),
 * measured trivially fast here regardless of scale or how tightly capacity
 * is drawn: 8 to 20 triangles (24-60 students) into 3 groups, several
 * tightness variants including capacity matching the clique size exactly,
 * and a "Latin square" shape (K disjoint K-cliques into K groups of exactly
 * K, zero slack anywhere) up to K=22 (484 students, just under
 * MAX_STUDENTS) -- every one resolved in low single-digit milliseconds. The
 * reason: this engine's placer tries groups in a FIXED ascending order for
 * every block, so a perfectly regular shape (every clique the same size,
 * every group the same capacity) lets first-fit self-balance into a valid
 * arrangement without ever needing to backtrack, however large it is scaled.
 *
 * UNEVEN clique sizes is what actually defeats it. Six disjoint cliques
 * sized 20, 19, 18, 17, 16 and 15 (105 students) into exactly 20 groups
 * (tests/unit/grouping.test.ts, "apart letters" debt (b) test) reliably
 * exhausts the cap: 334 of 400 seeds measured gave up outright and the other
 * 66 succeeded, confirming this is a common outcome for the shape rather
 * than one unlucky seed -- seed 1 (this engine's default in tests) is among
 * the 334, reproducibly, at ~51-57ms. Every block in that input is a
 * singleton (no `together`), so pass 2's first-fit-decreasing sort is a
 * no-op there (a stable sort over equal-size keys preserves order) and
 * replays pass 1's exhausted search node for node -- confirmed by temporary
 * instrumentation on that exact input, not assumed from the stable-sort
 * argument alone: pass 1 gaveUp=true/found=false, pass 2
 * gaveUp=true/found=false, and pass 2's order verified byte-identical to
 * pass 1's. Both passes are genuinely defeated on that input, matching the
 * two-pass docstring's own "rare input that defeats both" case above.
 *
 * Fix round 1, F-1: this budget is now spent once per CANDIDATE allocation
 * `buildSeparateGroups`'s search tries under `separate`/`groupCount`, not
 * once per side/pass only -- see the accounting and acceptability judgment
 * in `placeBlocks`'s own doc comment, and the candidate-bounding reasoning
 * in `allocationCandidates`'s.
 */
const SEARCH_NODE_CAP = 200_000;

/**
 * The largest class this engine will attempt, and the single source of truth
 * for the number the page puts in its `max` attribute.
 *
 * A roster is materialised as objects before anything else can guard it, so
 * `Array.from({ length: 100000000 })` from a mis-keyed paste allocates until
 * the tab is killed — on a phone, until the browser is. This is what stops
 * that.
 *
 * 100, lowered from 500 (operator, 2026-08-13). The design's "two size
 * limits, not one" reasoning still holds — a bare count costs the page one
 * number, a named row costs six form controls — but the two ceilings now
 * meet at the same value, because no real class is larger than 100 either
 * way. `MAX_ROSTER` (roster.ts) stays the limit that governs named rows;
 * this one governs the anonymous count. They agree by value now, not by
 * accident, and each still has its own name so a future change to one does
 * not silently move the other.
 */
export const MAX_STUDENTS = 100;

const fail = (error: GroupingError): GroupingOutcome => ({ ok: false, error });

const succeed = (
  groups: Student[][],
  warnings: GroupingWarning[],
): GroupingOutcome => ({ ok: true, result: { groups, warnings } });

/**
 * How many students were asked for, WITHOUT building them.
 *
 * Deliberately returns the raw number, Infinity and NaN included: the caller
 * distinguishes them, because "more than the tool will do" and "not a number
 * at all" are different mistakes and deserve different sentences.
 */
function requestedSize(input: number | Student[]): number {
  return typeof input === 'number' ? input : input.length;
}

/**
 * A name as it is DISPLAYED: trimmed, and in one Unicode form.
 *
 * This used to also be how two students were MATCHED against each other for
 * a keep-apart rule: "José" pasted as NFC and typed as NFD needed to reach
 * the same key, or the rule would silently fail to fire, and folding case
 * was refused for the same reason — "ana" and "Ana" had to stay distinguishable
 * or two different children could be merged into one conflict. Identity is
 * the number now, so nothing is matched on the name at all; this function is
 * kept purely so the roster renders consistently regardless of which Unicode
 * form or stray whitespace a name arrived in.
 *
 * Case is still deliberately NOT folded: a teacher who typed "Ana" must see
 * "Ana" on their own roster, not "ana".
 */
const nameKey = (name: string): string => name.trim().normalize('NFC');

/** Fisher-Yates against the injected source. */
function shuffled<T>(items: readonly T[], random: () => number): T[] {
  const out = items.slice();
  for (let i = out.length - 1; i > 0; i--) {
    // Clamped because `random` is a PARAMETER. The contract is [0, 1), and
    // Math.random honours it, but nothing stops a caller passing a source
    // that returns exactly 1 — and then j is i + 1, the swap reads past the
    // end, and `undefined` is seated in a group with a real child.
    const j = Math.min(i, Math.floor(random() * (i + 1)));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/**
 * A new, unnamed, unlettered, present student — one home for what an empty
 * field means.
 *
 * Takes the number rather than computing it, so the caller decides numbering:
 * `classroom-groups.ts` already holds `nextNumber` for the first row of a
 * batch, and a constructor that numbered itself would be a second opinion
 * about identity in a tool where the number IS the identity.
 *
 * It was a private `anonymous` here and a character-identical, exported
 * `anonymousStudent` in `src/scripts/roster-ui.ts` until #277, with a third
 * copy inline in `numberSets.ts` and a fourth in the test factory. Four
 * places to decide what a seventh field defaults to, and the typechecker
 * cannot say they disagree — each one is valid on its own.
 */
export const anonymousStudent = (number: number): Student => ({
  number,
  name: null,
  sex: null,
  absent: false,
  together: null,
  apart: null,
});

function normaliseStudents(input: number | Student[]): Student[] {
  if (typeof input === 'number') {
    if (!Number.isFinite(input) || input < 1) return [];
    return Array.from({ length: Math.floor(input) }, (_, i) =>
      anonymousStudent(i + 1),
    );
  }
  // A record list is taken as given. Renumbering it would throw away the one
  // thing that makes a constraint unambiguous, which is the whole point of
  // this rewrite: two children called Ana are two numbers, not one name.
  return input.map((s) => ({
    ...s,
    // A blank is not a name. Without the `|| null`, nameKey('   ') returns
    // '' -- a third state the contract does not describe (it is name, or
    // null meaning "no name"). '' is not nullish, so `name ?? 'Student N'`
    // would render a blank label instead of falling back to it.
    name: s.name === null ? null : nameKey(s.name) || null,
    // Same field shape, same defect, same fix (Fix round 1, F-4). Left
    // untrimmed, '' and '   ' are two DIFFERENT Map keys in buildBlocks, so
    // two students with blank cells merge into one block or not depending on
    // invisible whitespace -- and a blank collapsed the wrong way still
    // reads as a real, shared letter rather than as "no letter".
    together: s.together === null ? null : nameKey(s.together) || null,
    apart: s.apart === null ? null : nameKey(s.apart) || null,
  }));
}

/**
 * How many students each group should end up with.
 *
 * perGroup is the mode carrying the operator's rule: never fewer than the
 * stated size. So the group COUNT is floor(n / size) — taking one more group
 * would strand a short one — and the remainder is then placed according to the
 * leftovers preference. 7 students in groups of 4 therefore gives a single
 * group of 7, not 4 and 3.
 */
function targetSizes(
  total: number,
  mode: Mode,
  leftovers: Leftovers,
): number[] {
  const groupCount =
    mode.kind === 'perGroup'
      ? Math.max(1, Math.floor(total / mode.size))
      : mode.count;

  const base = Math.floor(total / groupCount);
  const sizes = Array.from({ length: groupCount }, () => base);
  let remainder = total - base * groupCount;

  if (leftovers === 'bunch') {
    sizes[0] += remainder;
    return sizes;
  }
  // Spread: one at a time, round-robin. Round-robin (rather than "give the
  // first `remainder` groups one each") is what keeps the largest and smallest
  // group within one of each other even when the remainder exceeds the number
  // of groups — e.g. 11 students in groups of 4 is 6 and 5, never 7 and 4.
  let i = 0;
  while (remainder > 0) {
    sizes[i % groupCount] += 1;
    i += 1;
    remainder -= 1;
  }
  return sizes;
}

/** Indices into the present roster that must end up in one group. */
type Block = number[];

/**
 * Collapse together-letters into blocks.
 *
 * A student with no letter is a block of one, so the placer below has exactly
 * one kind of thing to move. That is what keeps the backtracking search — and
 * its node budget, and its honest "I stopped looking" — identical to the one
 * that already works.
 */
function buildBlocks(present: Student[]): Block[] {
  const byLetter = new Map<string, Block>();
  const blocks: Block[] = [];
  present.forEach((s, i) => {
    if (s.together === null) {
      blocks.push([i]);
      return;
    }
    const existing = byLetter.get(s.together);
    if (existing) {
      existing.push(i);
      return;
    }
    const block: Block = [i];
    byLetter.set(s.together, block);
    blocks.push(block);
  });
  return blocks;
}

/**
 * Conflict adjacency BETWEEN BLOCKS, from apart-letters.
 *
 * Everyone sharing a letter is mutually separated, so a letter is a set and
 * not a pair. The conflict is recorded between blocks rather than students
 * because a block moves as one: separating Ana from Citra separates everyone
 * kept together with Ana from Citra too.
 *
 * Identity here is entirely the block index and the letter string — nothing
 * is matched on a student's name. `nameKey` (used only for display
 * normalisation in `normaliseStudents`) is never called from this function.
 */
function buildConflicts(present: Student[], blocks: Block[]): Set<number>[] {
  const adj: Set<number>[] = blocks.map(() => new Set<number>());
  const byLetter = new Map<string, number[]>();

  blocks.forEach((block, b) => {
    for (const i of block) {
      const letter = present[i].apart;
      if (letter === null) continue;
      const list = byLetter.get(letter) ?? [];
      if (!list.includes(b)) list.push(b);
      byLetter.set(letter, list);
    }
  });

  for (const members of byLetter.values()) {
    for (let x = 0; x < members.length; x++) {
      for (let y = x + 1; y < members.length; y++) {
        adj[members[x]].add(members[y]);
        adj[members[y]].add(members[x]);
      }
    }
  }
  return adj;
}

/**
 * Largest set of students who ALL conflict with each other (max clique).
 *
 * This is the honest explanation of impossibility: if five students must all
 * be kept apart from one another, they need five groups, and no shuffling of
 * four will ever work. Reporting that set — by number; identity is the
 * number, see Student.number — gives the teacher something to act on. It
 * operates on an adjacency array indexed however the caller likes (student
 * index or block index) and does not care which; only the caller's reading
 * of its output does.
 *
 * Budgeted like `assign`, and for the same reason. "Exact search is fine at
 * classroom scale" was measured and is not true: a keep-apart list shaped like
 * "these three wind each other up, and those three, and those three" is the
 * worst case for clique search, and 48 students of it took 121 SECONDS in a
 * tab that had no way to say what it was doing.
 *
 * A clique found under the budget is still a valid certificate — it is a set
 * that genuinely all conflict, whether or not a bigger one exists. Only the
 * opposite conclusion, "no large clique exists", would need a complete search,
 * and this function is never used to draw it. So exhaustion costs precision,
 * never correctness: the caller simply falls through to the real search.
 */
function largestMutualConflict(adj: Set<number>[], nodeCap: number): number[] {
  let best: number[] = [];
  let nodes = 0;
  const n = adj.length;

  const extend = (clique: number[], candidates: number[]): void => {
    if (++nodes > nodeCap) return;
    if (clique.length > best.length) best = clique.slice();
    // Bound: even taking every remaining candidate cannot beat the best found.
    if (clique.length + candidates.length <= best.length) return;
    for (let k = 0; k < candidates.length; k++) {
      const v = candidates[k];
      extend(
        [...clique, v],
        candidates.slice(k + 1).filter((u) => adj[v].has(u)),
      );
    }
  };

  extend(
    [],
    Array.from({ length: n }, (_, i) => i).filter((i) => adj[i].size > 0),
  );
  return best;
}

/**
 * Place blocks into fixed-capacity groups without seating two conflicting
 * blocks together, and without ever splitting a block across groups.
 *
 * `assign` places in whatever `order` it is handed — it does not choose that
 * order itself. That choice, and the trade-off it carries, lives one level
 * up in `placeBlocks`: a shuffled order costs more search depth but supplies
 * the arrangement variety that makes "shuffle again" mean something; sorting
 * largest-block-first (first-fit-decreasing) keeps the search shallow at the
 * cost of that variety. Fix round 1 (F-2) put that sort directly in the only
 * order `assign` ever saw, which cleared its "gave up" cases but collapsed
 * variety on together-rosters to a single arrangement. Fix round 2 moved the
 * sort out of `assign` entirely, into a second, later pass in `placeBlocks`
 * — `assign` itself is unchanged from before either fix round.
 *
 * A student with no together-letter is a block of one (see `buildBlocks`),
 * so this is the only placement function — there is no separate
 * single-student path that could drift out of sync with this one.
 */
function assign(
  order: number[], // block indices, in the order the caller wants them tried
  blocks: Block[],
  sizes: number[],
  adj: Set<number>[], // conflicts BETWEEN BLOCKS
  nodeCap: number,
): { groups: number[][] | null; gaveUp: boolean } {
  const groups: number[][] = sizes.map(() => []); // holds block indices
  let nodes = 0;
  let gaveUp = false;
  const filled = sizes.map(() => 0);

  const place = (idx: number): boolean => {
    if (idx === order.length) return true;
    if (++nodes > nodeCap) {
      // Not "no arrangement exists" — "I stopped looking". Collapsing the two
      // is how a tool ends up telling a teacher a falsehood with confidence.
      gaveUp = true;
      return false;
    }
    const b = order[idx];
    const size = blocks[b].length;

    for (let g = 0; g < groups.length; g++) {
      if (filled[g] + size > sizes[g]) continue;
      if (groups[g].some((other) => adj[b].has(other))) continue;
      groups[g].push(b);
      filled[g] += size;
      if (place(idx + 1)) return true;
      groups[g].pop();
      filled[g] -= size;
    }
    return false;
  };

  const placed = place(0);
  return { groups: placed ? groups : null, gaveUp };
}

/**
 * Pass 1's block order under `mix`: shuffled, then woven by a ratio merge —
 * emitting from whichever side (boys or girls) has fallen furthest behind
 * its share of the blocks emitted so far.
 *
 * WHAT THE CODE DOES, first: `sexOf` reads the block's FIRST member and
 * classifies the WHOLE block by that one member's sex — it does not check
 * that every member agrees. A together-block spanning both sexes (one boy,
 * one girl) is therefore silently classified into `boys` or `girls` by
 * whichever sex its first member happens to be; it does NOT fall into
 * `rest`. (Task 7's own comment here previously said the opposite — "it
 * falls into `rest`, which is the only honest thing to do with it" — that
 * was never what this code did; Fix round 1 corrects the comment, not the
 * classification, which is unchanged and still pinned by the "places a
 * together-block spanning both sexes" test in grouping.test.ts.) `rest`
 * holds only a block whose first member's sex is neither `'M'` nor `'F'` —
 * `null`, `undefined`, or any other off-domain value a non-TypeScript
 * caller might hand this pure module (Fix round 1, F-2: `sexOf` normalises
 * anything that is not exactly `'M'` or `'F'` to `null` before classifying,
 * so `boys`, `girls` and `rest` are provably exhaustive and mutually
 * exclusive over EVERY index in `indices` — a permutation by construction,
 * not by the assumption the pre-fix code rested on). In practice `rest` is
 * unreachable from `mix`'s own call site specifically: `weaveBySex` only
 * ever runs after buildGroups's unset-sex guard has confirmed every
 * PRESENT student's `sex` is exactly `'M'` or `'F'`. That guard covers
 * `separate` too as of Task 8a (see `ERROR_CODES.sexNeedsAllSet`'s doc
 * comment) — but `weaveBySex` itself is not what makes that safe: it is
 * written to survive a caller that carries no such guarantee at all, guard
 * widened, guard narrow, or no caller-side guard whatsoever, as when a test
 * calls it directly. See the "never drops a block, whatever `sex` holds"
 * test in grouping.test.ts, which does exactly that.
 *
 * WHY A RATIO MERGE, not straight alternation. `indices` must already be
 * shuffled — this only sorts them into the boy, girl and rest lists,
 * preserving whatever order they arrive in within each list; that is what
 * supplies the variety in WHICH boy and WHICH girl lands in each slot, same
 * as before — pinned by the "varies which boy pairs with which girl across
 * seeds, not just the 1-and-1 split" and "varies pairings on the uneven
 * roster too, not just the evenly-divided one" tests in grouping.test.ts,
 * not by a narrative measurement alone. What changed is HOW the two lists
 * are merged. The original alternation (`woven[i] = boys[i], girls[i]`,
 * i = 0..max(nb,ng)) exhausts the shorter list partway through and then
 * appends the remainder of the longer one as ONE CONTIGUOUS RUN — and
 * `assign` fills groups in ascending order via first-fit, so that run lands
 * as a single-sex group every time.
 * Fix round 1, F-1: measured on the shipped alternation, 2 boys and 4 girls
 * into 2 groups landed the ideal {1M2F, 1M2F} split ZERO times in 200
 * seeds, while `off` (no weave at all) landed it 107 times — the feature
 * made its own goal less likely than not having it. See
 * docs/superpowers/notes/2026-08-06-classroom-groups-v2-engine-measurements.md,
 * "The five-shape table" for the full reproduction across five roster
 * shapes: `mix` now lands the ideal split 200/200 on every one of them,
 * `off` never better than 58%.
 *
 * The merge below counts BLOCKS, not students: `bi`/`gi` are how many boy-
 * and girl-blocks have been emitted so far, and a boy-block is emitted next
 * when `bi * ng <= gi * nb` (the boy side's share-so-far is still at or
 * below its true share of the two block counts) — a girl-block otherwise —
 * and whichever side is exhausted yields unconditionally to the other. This
 * spreads the minority side proportionally across every position instead of
 * front-loading it, so the excess of the majority side is spread out too,
 * rather than landing as one trailing block.
 *
 * NOT weighted by block SIZE, deliberately, and only after building and
 * measuring the weighted version. A together-block's size is invisible to
 * this count: a 4-student together-block counts as one "boy" the same as a
 * lone boy, so it can still clump — measured on a 4-boy together-block plus
 * 4 lone boys and 8 lone girls into 4 groups, block-COUNT `mix` lands
 * {2M2F, 1M3F, 1M3F, 4M0F} (the best any ordering can do, since a block the
 * exact size of a group cannot share it with anyone) on 100/100 seeds,
 * beating `off`'s 58/100. A student-WEIGHTED variant of this same merge
 * (emit by cumulative student count against each side's true total, so a
 * size-4 block counts as 4) was built and measured on the identical roster:
 * it reached that same best split only 36/100 seeds, WORSE than `off`. The
 * mechanism: weighting makes a block's size a forward-looking "debt" against
 * the OTHER side that persists after the block is placed — the big block
 * pushes `bTotal` to 4 in one step, and the merge then owes girls four turns
 * in a row to let `gTotal` catch up, clumping the very thing it was meant to
 * spread, even though the big block has already claimed its own group and
 * has no further claim on the remaining ones. Block-count weighting has no
 * memory of a block's size once its single turn is taken, which is exactly
 * why it does not make this mistake. Rejected on measurement, not
 * intuition; see
 * docs/superpowers/notes/2026-08-06-classroom-groups-v2-engine-measurements.md,
 * "The block-size-weighted merge: tried, measured, and rejected" for the
 * full comparison, including a second together-block shape where
 * block-count `mix` beats
 * `off` by roughly 2x without reaching the ideal every time (30.7% vs
 * 15.3%), and a third where a pair of exactly-group-sized blocks of the
 * same sex forces the identical worst split on `mix` and `off` alike — a
 * hard limit no ordering can move, not a regression.
 *
 * EXPORTED, unlike every other helper in this module, for exactly one
 * reason (Fix round 1, F-2): its total-partition guarantee -- every index in
 * `indices` lands in exactly one of `boys`, `girls`, `rest` -- has to hold
 * for ANY caller, not just the ones reachable through `buildGroups` today.
 * `mix` is the only caller `buildGroups` actually has (`placeBlocks` weaves
 * only when `sexMode === 'mix'`; `separate` still takes the plain shuffled
 * order -- true when this was written for Task 8a's placeholder placement,
 * and still true after Task 8b's real separate-mode placement landed:
 * `buildSeparateGroups` calls `placeBlocks` with `sexMode: 'separate'`, per
 * side, which takes the exact same unwoven branch it always did; see
 * `ERROR_CODES.sexNeedsAllSet`'s doc comment for the guard history), and
 * that guard refuses
 * every off-domain `sex` before `mix` can reach this function, so there is
 * no path through `buildGroups` left to exercise the guarantee with bad
 * data -- proving it as a property of THIS function, not of `buildGroups`'s
 * current callers, needs a direct call. See the "never drops a block,
 * whatever `sex` holds" test in grouping.test.ts.
 */
export function weaveBySex(
  blocks: Block[],
  present: Student[],
  indices: number[],
): number[] {
  const sexOf = (b: number): 'M' | 'F' | null => {
    const sex = present[blocks[b][0]].sex;
    return sex === 'M' || sex === 'F' ? sex : null;
  };
  const boys = indices.filter((b) => sexOf(b) === 'M');
  const girls = indices.filter((b) => sexOf(b) === 'F');
  const rest = indices.filter((b) => sexOf(b) === null);
  const nb = boys.length;
  const ng = girls.length;

  const woven: number[] = [];
  let bi = 0;
  let gi = 0;
  while (bi < nb || gi < ng) {
    const takeBoy = gi >= ng || (bi < nb && bi * ng <= gi * nb);
    if (takeBoy) {
      woven.push(boys[bi]);
      bi += 1;
    } else {
      woven.push(girls[gi]);
      gi += 1;
    }
  }
  return [...woven, ...rest];
}

/**
 * Two-pass placement (Fix round 2).
 *
 * Pass 1 tries the blocks in the shuffled order, unsorted — exactly what
 * this placer did before Fix round 1. This is what supplies arrangement
 * variety: the search meets blocks in an unpredictable order, and the
 * backtracking fill lands differently seed to seed. If it succeeds, that
 * arrangement is used and pass 2 never runs, so the common path — nearly
 * every real class — costs exactly the one search it always needed.
 *
 * Task 7 adds one more shape to pass 1's order, under `mix` only: the
 * shuffled order is woven boy-girl-boy-girl before `assign` ever sees it
 * (see `weaveBySex`). This is still "pass 1, unsorted" in the sense that
 * matters — no comparison of block SIZE or conflict COUNT is applied, which
 * is what Fix round 1 got wrong — it is a fixed interleave over an order
 * that is still shuffled underneath, so variety survives (proven in
 * docs/superpowers/notes/2026-08-06-classroom-groups-v2-engine-measurements.md,
 * "Singleton-block shapes") exactly as it did before this task. `sexMode`
 * values other than `mix` take this same shuffled order unchanged in THIS
 * function -- true for `off` at every call this function has ever had, and
 * true for `separate` too, though what "a call" means for `separate`
 * changed under Task 8b: this function itself is untouched (still exactly
 * one `sexMode === 'mix'` branch), but `buildSeparateGroups` now calls it
 * once PER SIDE rather than `buildGroups` calling it once for the whole
 * roster (see `buildSeparateGroups`, and the SEARCH_NODE_CAP paragraph
 * below for what that costs). None of that touches what `off` computes --
 * confirmed byte-identical, see the report for Task 8b and
 * docs/superpowers/notes/2026-08-06-classroom-groups-v2-engine-measurements.md,
 * "mix: byte-identical under off and separate" for Task 7's own original
 * measurement of this function in isolation.
 *
 * If pass 1 runs to completion WITHOUT giving up, that is already a complete
 * proof that no arrangement exists at this group count: `assign` is an
 * exhaustive backtracking search over every valid group choice for every
 * block, so the order it meets blocks in changes how many nodes it visits
 * before deciding, never what it is capable of deciding. A second pass in a
 * different order cannot find an arrangement the first pass already proved
 * does not exist, so none is run — see the call site in `buildGroups` for
 * where that proof is reported.
 *
 * Only when pass 1 hits SEARCH_NODE_CAP — proving nothing, "I stopped
 * looking" — does pass 2 run, with blocks sorted largest-first
 * (first-fit-decreasing, the standard bin-packing heuristic). That sort is
 * what cleared Fix round 1's "gave up" cases (13 of 1540 measured
 * together-rosters, down to 0): it trades away the variety pass 1 exists to
 * protect, but only once pass 1 has already shown the varied order cannot
 * decide this particular case within budget. Pass 2 sorts a COPY of pass 1's
 * own shuffled order, rather than shuffling again, so both passes draw from
 * the same sequence of `random` calls — there is no second, independent
 * source of randomness here, only a second look at the first one's output.
 * Under `mix` that copy is of the WOVEN order, and the size sort discards
 * the weave along with everything else about pass 1's order — deliberately:
 * pass 2 exists purely as the robustness fallback once pass 1's order,
 * whatever shape it had, has already failed to find a fit within budget, and
 * mixing is a preference that has already lost to finding ANY valid
 * arrangement by the time pass 2 runs at all.
 *
 * SEARCH_NODE_CAP is a PER-PASS budget, not a shared one: each call to
 * `assign` opens its own `nodes` counter at zero (see `assign`'s closure),
 * so the worst case — pass 1 gives up, then pass 2 also gives up — visits up
 * to 2 * SEARCH_NODE_CAP nodes and costs roughly twice one pass's time. That
 * only happens on an input that defeats first-fit-decreasing outright (see
 * the "gave up" test in grouping.test.ts, where every block is the same
 * size so pass 2's sort cannot help); every other input pays for one pass.
 *
 * Task 8b: under `separate`, THIS function is called up to twice more —
 * once per side that gets its own placement attempt, from
 * `buildSeparateGroups` via `placeSexSide` — and each of those calls is
 * everything above, independently: its own shuffled order, its own
 * possible pass 2, its own SEARCH_NODE_CAP budget per pass. The cap is PER
 * SIDE, exactly like it is per pass — a side that gives up spends only its
 * own budget; it neither borrows from nor lends to the other side's. So
 * the true worst case under `separate` is up to 2 (sides) * 2 (passes) = 4
 * * SEARCH_NODE_CAP nodes on a single `buildGroups` call, twice the 2 *
 * SEARCH_NODE_CAP worst case above for one `placeBlocks` call, and reached
 * only if BOTH sides independently hit the rare shape that defeats
 * first-fit-decreasing outright, in the same call. `off` and `mix` are
 * unaffected: they still call this function exactly once, so their worst
 * case is still 2 * SEARCH_NODE_CAP, unchanged by any of this.
 *
 * Fix round 1, F-1: under `separate` with `mode.kind === 'groupCount'`,
 * `buildSeparateGroups` can now try several CANDIDATE splits of the
 * requested group count between the two sexes (see `allocationCandidates`),
 * not just the one proportional guess — and each candidate it tries pays
 * the full "up to 4 * SEARCH_NODE_CAP" cost above independently, exactly as
 * if it were the only one. With up to `count - 1` candidates possible (see
 * `allocationCandidates`'s doc comment for why it is usually far fewer —
 * bounded by each side's own headcount too, not just `count - 1`), the true
 * worst case for one `buildGroups` call under `separate` grows to
 * `(candidates tried) * 4 * SEARCH_NODE_CAP` — at the 500-student ceiling,
 * as much as roughly 499 * 800,000 ≈ 4*10^8 nodes. Judged acceptable, not
 * papered over: see `allocationCandidates`'s doc comment for the full
 * reasoning (the common path — including the input that motivated this fix
 * — resolves in one or two candidates; only an input BOTH large enough to
 * offer that many candidates AND adversarially shaped to defeat
 * first-fit-decreasing at every one of them approaches the theoretical
 * ceiling, and even then the search always terminates, bounded, rather than
 * hanging). `perGroup` is untouched by this — see `allocateSexGroups`'s own
 * doc comment for why no search applies there — so its worst case is still
 * exactly the 4 * SEARCH_NODE_CAP figure above, unchanged.
 */
function placeBlocks(
  blocks: Block[],
  sizes: number[],
  adj: Set<number>[], // conflicts BETWEEN BLOCKS
  random: () => number,
  present: Student[],
  sexMode: SexMode,
  nodeCap: number,
): { groups: number[][] | null; gaveUp: boolean } {
  const shuffledOrder = shuffled(
    blocks.map((_, i) => i),
    random,
  );
  const order =
    sexMode === 'mix'
      ? weaveBySex(blocks, present, shuffledOrder)
      : shuffledOrder;

  const pass1 = assign(order, blocks, sizes, adj, nodeCap);
  if (pass1.groups !== null || !pass1.gaveUp) return pass1;

  const ffdOrder = order
    .slice()
    .sort((a, b) => blocks[b].length - blocks[a].length);
  return assign(ffdOrder, blocks, sizes, adj, nodeCap);
}

/**
 * Task 8b: how many groups each sex gets under `separate`.
 *
 * `perGroup`: independent per side -- floor(own headcount / size), the same
 * arithmetic `targetSizes` uses for the group count, WITHOUT its
 * `Math.max(1, ...)` floor. That clamp exists so the whole roster always
 * gets at least one group; a SIDE that cannot fill even one group of the
 * requested size must be allowed to compute to zero, because zero is
 * exactly the spill signal (see the call site in `buildSeparateGroups`).
 *
 * `groupCount`: the number the teacher typed is fixed. It is allocated
 * between the two sides proportionally by headcount, using the largest-
 * remainder method, so the parts sum to EXACTLY that number rather than
 * independently rounding each side and risking a total that over- or
 * undershoots it (the problem the task brief's own worked example names:
 * 12 boys and 8 girls asked for 4 groups must split as 4, not as whatever
 * sizing each side's own together-block arithmetic would separately want).
 *
 * With only two sides there is at most ONE whole group left over after
 * both floors are taken: the two fractional remainders are each in [0, 1)
 * and sum to a whole number (the two raw shares already sum to exactly
 * `mode.count`, an integer, and floor(x) + frac(x) = x for each), and a
 * sum of two numbers each < 1 that is itself a whole number can only be 0
 * or 1. So a single comparison decides where it goes -- not a general
 * largest-remainder loop over N buckets, because N is always 2 here. A tie
 * goes to boys, arbitrarily but deterministically.
 *
 * Fix round 1, F-1: this is a single guess, not a search -- it is the
 * FAIREST split, not the only one that can work, and `buildSeparateGroups`
 * no longer stops here on failure. See `allocationCandidates`, directly
 * below, for what tries next and why this one still goes first.
 */
function allocateSexGroups(
  boysCount: number,
  girlsCount: number,
  mode: Mode,
): { boys: number; girls: number } {
  if (mode.kind === 'perGroup') {
    return {
      boys: Math.floor(boysCount / mode.size),
      girls: Math.floor(girlsCount / mode.size),
    };
  }
  const total = mode.count;
  const sum = boysCount + girlsCount; // present.length, always > 0 here
  const rawBoys = (boysCount / sum) * total;
  const rawGirls = (girlsCount / sum) * total;
  const boysFloor = Math.floor(rawBoys);
  const girlsFloor = Math.floor(rawGirls);
  const remainder = total - boysFloor - girlsFloor; // always 0 or 1, see above
  const girlsWinsRemainder =
    remainder > 0 && rawGirls - girlsFloor > rawBoys - boysFloor;
  return {
    boys: boysFloor + (remainder > 0 && !girlsWinsRemainder ? 1 : 0),
    girls: girlsFloor + (girlsWinsRemainder ? 1 : 0),
  };
}

/**
 * Fix round 1, F-1. `allocateSexGroups` makes exactly one guess under
 * `groupCount` -- the fairest one, by headcount share -- with no fallback:
 * a request that guess cannot satisfy was refused even when some OTHER way
 * of splitting the same total between the two sexes would have worked. The
 * reviewer's concrete case: 12 boys and 8 girls asked for 4 groups, 5 girls
 * bound together. Proportional gives 2-and-2; the 5-strong unit does not
 * fit a group of 4 (8 girls / 2 groups), so the old code refused. 3-and-1
 * (boys claim 3 groups; girls get ONE group of all 8, which holds the unit
 * easily) satisfies every rule the teacher stated -- the engine just never
 * looked for it.
 *
 * This turns that single guess into an ORDERED LIST of candidates for
 * `buildSeparateGroups` to try in turn, stopping at the first that
 * actually places. Only called once `mode.kind === 'groupCount'` is
 * already established (see the call site) -- under `perGroup` each side's
 * group count is independently and uniquely determined by its own
 * headcount and the fixed group SIZE (see `allocateSexGroups`'s own doc
 * comment: "no total to reconcile"), so there is no allocation CHOICE to
 * search over, and this function is not involved at all.
 *
 * WHY PROPORTIONAL FIRST, not simply searching for any feasible split: it
 * is the fairest arrangement by headcount whenever it works, and it is
 * also, right now, THE answer for every `separate`/`groupCount` input that
 * already succeeds -- this fix must not change any of those (see the
 * report's before/after verification). Trying it first and returning the
 * instant it succeeds is what GUARANTEES that: an input that succeeds on
 * the first candidate reaches `placeSexSide` with the exact same
 * arguments, in the exact same order, consuming the exact same sequence of
 * `random()` calls, as it did before this function existed -- nothing
 * about `buildSeparateGroups`'s own placement code changes, only how many
 * times it might now be invited to try again after a failure.
 *
 * `proportional` is always safe to try -- meaning it can never itself
 * request more groups for a side than that side has students, the exact
 * failure mode the headcount bound below exists to keep every OTHER
 * candidate from causing (see next paragraph): given the upstream
 * `mode.count <= boysCount + girlsCount` guarantee (`buildGroups`'s
 * `tooManyGroups` check), `rawBoys = boysCount * mode.count / (boysCount +
 * girlsCount) <= boysCount` always, so `boysFloor <= boysCount`, and the
 * one way that could still be pushed over by the largest-remainder's +1 --
 * `rawBoys` landing exactly ON the integer `boysCount` while STILL
 * claiming the remainder -- cannot happen either: `rawBoys == boysCount`
 * (with `girlsCount > 0`) forces `mode.count == boysCount + girlsCount`
 * exactly, which forces `rawGirls == girlsCount` too, which leaves no
 * remainder to award at all. Girls symmetrically.
 *
 * WHY BOUNDED BY EACH SIDE'S OWN HEADCOUNT for every OTHER candidate, not
 * the full `[1, count - 1]` range "count - 1 ways to divide" describes in
 * the abstract: a candidate that hands a side more groups than it has
 * students would size some of that side's groups to zero
 * (`targetSizes`'s `base` floors to 0 once `groupCount` exceeds `total`)
 * -- not a refusal, an EMPTY group silently appearing in the teacher's
 * results, a worse defect than the one this fix exists to close. So the
 * candidate range is `[max(1, count - girlsCount), min(count - 1,
 * boysCount)]` -- `girlsCount` is what floors it from below (a boys count
 * any lower would over-allocate girls), `boysCount` is what caps it from
 * above -- a SUBSET of "count - 1 ways", never more, so "at most count -
 * 1" still holds. In a lopsided roster (say 3 boys, 97 girls, 50 groups)
 * this collapses the real search space to just a handful of candidates,
 * not 49 -- most of the theoretical range would over-allocate the smaller
 * side, and is never even generated. See `placeBlocks`'s doc comment for
 * what this bound means for SEARCH_NODE_CAP's worst case, and why the
 * worst case is judged acceptable despite growing.
 *
 * Ties at equal distance (`proportional.boys - d` and `proportional.boys +
 * d` both in range) are tried fewer-boys-first -- an arbitrary but
 * deterministic and stated order, exactly as arbitrary as
 * `allocateSexGroups`'s own "a tie goes to boys". Correctness does not
 * depend on the direction (both are tried before anything at distance `d +
 * 1` either way), only reproducibility does.
 */
function allocationCandidates(
  boysCount: number,
  girlsCount: number,
  mode: Mode & { kind: 'groupCount' },
): Array<{ boys: number; girls: number }> {
  const proportional = allocateSexGroups(boysCount, girlsCount, mode);
  // No second side to divide WITH: a side with zero members has nothing an
  // alternate split could give it, and the proportional result already
  // reduces to "everything to the other side" on its own (see
  // `allocateSexGroups`) -- not a search question.
  if (boysCount === 0 || girlsCount === 0) return [proportional];

  const total = mode.count;
  const minBoys = Math.max(1, total - girlsCount);
  const maxBoys = Math.min(total - 1, boysCount);
  const candidates = [proportional];
  for (let d = 1; d < total; d++) {
    for (const boys of [proportional.boys - d, proportional.boys + d]) {
      if (boys < minBoys || boys > maxBoys) continue;
      candidates.push({ boys, girls: total - boys });
    }
  }
  return candidates;
}

/**
 * Task 8b: sizes for a FIXED group count, spread by the ordinary
 * `leftovers` rule (thin wrapper over `targetSizes` with a synthesised
 * `groupCount` mode).
 *
 * Reused for two different totals in `buildSeparateGroups`: a side's OWN
 * headcount at its OWN allocated group count (see `ownSizes`'s
 * `groupCount` branch), and a side's headcount PLUS whatever spilled onto
 * it, STILL at that side's own allocated group count -- the spill is
 * spread across the host's groups the exact same way an ordinary remainder
 * already is, rather than by any new rule invented for this. Never called
 * with `groupCount` of zero -- that is the spill case itself, handled
 * separately, and `targetSizes` does not do anything meaningful with a
 * zero group count (empty `sizes`, silently).
 */
function sizesForCount(
  total: number,
  groupCount: number,
  leftovers: Leftovers,
): number[] {
  return targetSizes(
    total,
    { kind: 'groupCount', count: groupCount },
    leftovers,
  );
}

/**
 * Task 8b: a non-spilling side's own sizes.
 *
 * Under `perGroup`, the SAME size applied to just this side's headcount --
 * there is no total to reconcile against, unlike `groupCount`, so each
 * side computes its own group count independently, exactly as the task
 * brief describes. Under `groupCount`, this side's OWN allocated count
 * (see `allocateSexGroups`) via `sizesForCount`. Never called with an
 * allocation of zero; see `sizesForCount`'s doc comment for why.
 */
function ownSizes(
  sideCount: number,
  allocated: number,
  mode: Mode,
  leftovers: Leftovers,
): number[] {
  return mode.kind === 'perGroup'
    ? targetSizes(sideCount, mode, leftovers)
    : sizesForCount(sideCount, allocated, leftovers);
}

/**
 * Task 8b: restrict a block-indexed conflict adjacency to a subset of
 * blocks, and reindex it to the subset's own local numbering.
 *
 * `assign` reads `adj[b]` for whatever block indices appear in `order`, so
 * placing only a SUBSET of the roster's blocks (one sex's own blocks, plus
 * whichever blocks spilled onto this side) needs an adjacency array
 * indexed the same way its own local `blocks` array is, not the global
 * one. This is also where a cross-sex apart-conflict at the spill boundary
 * gets carried across correctly: a spilled block's conflicts with the
 * host's own blocks are real entries in `globalAdj`, and they survive
 * reindexing here exactly like any other conflict does, because nothing
 * about this function singles sex out -- it only ever asks "is the OTHER
 * end of this conflict also in the subset being placed together." A
 * conflict to a block OUTSIDE the subset is dropped, not lost: that block
 * is never placed in this call, so it can never be seated next to anyone
 * here either way.
 */
function localAdjacency(
  globalAdj: Set<number>[],
  subset: number[], // global block indices; subset[i] becomes local index i
): Set<number>[] {
  const localOf = new Map(subset.map((g, i) => [g, i]));
  return subset.map((g) => {
    const local = new Set<number>();
    for (const other of globalAdj[g]) {
      const i = localOf.get(other);
      if (i !== undefined) local.add(i);
    }
    return local;
  });
}

/**
 * Task 8b: run the SAME placement machinery `buildGroups` runs once,
 * globally, for `off` and `mix` -- the together-unit-too-large check, the
 * keep-apart clique fast path, the two-pass search, and its failure
 * attribution -- against ONE subset of blocks and its own local sizes and
 * adjacency.
 *
 * This is a DELIBERATE duplication of that logic, not an extraction of it
 * into a function both paths share. `off` and `mix` must stay byte-
 * identical to how they behaved before this task (see the report for the
 * verification), and the safest way to guarantee that is to leave every
 * line of their existing path untouched rather than route it through a
 * newly-shared function that a future change to `separate`'s own needs
 * could perturb. The duplication is a few dozen lines of validation and
 * attribution, not the search itself -- `placeBlocks`, `assign` and
 * `largestMutualConflict` are all called exactly as they already exist,
 * unmodified.
 *
 * Called once per side when neither sex spills, once for a host side plus
 * whatever spilled onto it, or once for the whole roster in the fallback
 * where NEITHER side has enough for a group of its own -- see the call
 * site in `buildSeparateGroups` for all three shapes.
 */
function placeSexSide(
  localBlocks: Block[],
  localSizes: number[],
  localAdj: Set<number>[],
  present: Student[],
  random: () => number,
  nodeCap: number,
): { ok: true; groups: number[][] } | { ok: false; error: GroupingError } {
  const largestGroup = Math.max(...localSizes);
  for (const block of localBlocks) {
    if (block.length > largestGroup) {
      return {
        ok: false,
        error: {
          code: ERROR_CODES.togetherUnitTooLarge,
          letter: present[block[0]].together as string,
          unit: block.length,
          groupSize: largestGroup,
        },
      };
    }
  }

  const apartInPlay = localAdj.some((conflicts) => conflicts.size > 0);
  if (apartInPlay) {
    const clique = largestMutualConflict(localAdj, nodeCap);
    if (clique.length > localSizes.length) {
      return {
        ok: false,
        error: {
          code: ERROR_CODES.keepApartImpossible,
          students: clique.map((b) => {
            const holder = localBlocks[b].find(
              (i) => present[i].apart !== null,
            );
            return present[holder ?? localBlocks[b][0]].number;
          }),
          groupsNeeded: clique.length,
        },
      };
    }
  }

  const { groups: placed, gaveUp } = placeBlocks(
    localBlocks,
    localSizes,
    localAdj,
    random,
    present,
    'separate',
    nodeCap,
  );

  if (placed === null) {
    const togetherInPlay = localBlocks.some((block) => block.length > 1);
    if (togetherInPlay && apartInPlay) {
      return {
        ok: false,
        error: gaveUp
          ? { code: ERROR_CODES.bothRulesSearchGaveUp }
          : {
              code: ERROR_CODES.bothRulesNoArrangement,
              groupsTried: localSizes.length,
            },
      };
    }
    if (togetherInPlay) {
      return {
        ok: false,
        error: gaveUp
          ? { code: ERROR_CODES.togetherSearchGaveUp }
          : {
              code: ERROR_CODES.togetherNoArrangement,
              groupsTried: localSizes.length,
            },
      };
    }
    return {
      ok: false,
      error: gaveUp
        ? { code: ERROR_CODES.keepApartSearchGaveUp }
        : {
            code: ERROR_CODES.keepApartNoArrangement,
            groupsTried: localSizes.length,
          },
    };
  }

  return { ok: true, groups: placed };
}

/**
 * Task 8b: separate-mode placement.
 *
 * Each sex runs the existing machinery on its own blocks (`placeSexSide`),
 * sized either independently (`perGroup`) or by a share of the requested
 * total (`groupCount`), and concatenates. A sex with an allocation of zero
 * groups spills into the other's -- merged into ONE placement attempt
 * together, so the apart-rule adjacency between a spilled block and the
 * host's own blocks is checked by the SAME constrained search that already
 * checks it for the host's own blocks, not bolted on afterwards (see
 * `localAdjacency`, and the report for the full reasoning on why this
 * matters).
 *
 * `sizes`, computed by the caller from the WHOLE roster, is used here only
 * as the fallback for the rare case where NEITHER sex can have a group of
 * its own (only reachable under `perGroup` -- see `allocateSexGroups`'s
 * doc comment for the proof that `groupCount`'s largest-remainder always
 * gives the one leftover group to some side when both have members).
 * Every other branch computes its own, per-attempt sizes.
 *
 * Fix round 1, F-1/F-2. `attemptSplit`, below, is everything this function
 * used to do unconditionally for the ONE split `allocateSexGroups`
 * computed: build whichever shape of `attempts` that (boysGroups,
 * girlsGroups) pair calls for (spill, or one attempt per side), place each
 * through `placeSexSide`, and report success or the first failure. It is
 * now parameterised so it can be asked about more than one split.
 *
 * `perGroup` still asks it about exactly one -- there is no allocation
 * CHOICE to search over there (see `allocateSexGroups`), so a failure is
 * reported directly, unchanged from before this fix. `groupCount` asks
 * `allocationCandidates` for an ordered list and tries each in turn,
 * stopping at the first success; if every candidate fails, `perGroup`-style
 * direct reporting is still correct when only one candidate existed to try
 * (no ambiguity, so no reason to withhold which side/rule failed) --
 * `candidates.length === 1` is what distinguishes that from a genuine
 * multi-candidate exhaustion, which reports `sexSeparateImpossible` or
 * `sexSeparateSearchGaveUp` instead -- see their own doc comments, the
 * former for why naming a side or a rule would be dishonest once several
 * different splits have all been tried, the latter (Fix round 2) for why
 * even a multi-candidate exhaustion is not always a proof.
 */
function buildSeparateGroups(
  present: Student[],
  blocks: Block[],
  adj: Set<number>[],
  sizes: number[],
  mode: Mode,
  leftovers: Leftovers,
  random: () => number,
  nodeCap: number,
): GroupingOutcome {
  const sexOfBlock = (b: number): 'M' | 'F' =>
    present[blocks[b][0]].sex as 'M' | 'F';
  const boysIdx = blocks.map((_, i) => i).filter((i) => sexOfBlock(i) === 'M');
  const girlsIdx = blocks.map((_, i) => i).filter((i) => sexOfBlock(i) === 'F');
  const headcount = (idx: number[]) =>
    idx.reduce((n, b) => n + blocks[b].length, 0);
  const boysCount = headcount(boysIdx);
  const girlsCount = headcount(girlsIdx);

  const spillWarning = (idx: number[], sex: 'M' | 'F'): GroupingWarning => ({
    code: WARNING_CODES.sexSpillover,
    students: idx.flatMap((b) => blocks[b].map((i) => present[i].number)),
    sex,
  });

  // Fix round 1: the branching below is UNCHANGED from before this fix --
  // same four cases, same warnings, same `sizesForCount`/`ownSizes` calls
  // -- only now reusable per candidate rather than run once. Returns the
  // RAW result groups, pre-shuffle: the display-order shuffle happens once,
  // outside this function, only for whichever candidate actually wins (see
  // the loop below) -- doing it in here instead would spend a `random()`
  // call on every FAILED candidate too, and the first candidate this is
  // ever asked about is the proportional one, so that would change what
  // today's already-succeeding inputs consume before this fix existed.
  const attemptSplit = (
    boysGroups: number,
    girlsGroups: number,
  ):
    | { ok: true; groups: Student[][]; warnings: GroupingWarning[] }
    | { ok: false; error: GroupingError } => {
    const attempts: Array<{ idx: number[]; sizes: number[] }> = [];
    const warnings: GroupingWarning[] = [];

    if (boysGroups === 0 && girlsGroups === 0) {
      // Neither sex has enough of its own kind for even one group at this
      // size. There is no "other side's groups" for anyone to join, so
      // this falls back to exactly what `off` would do with this roster:
      // one placement, sized from the WHOLE roster. Warn about this only
      // when the OTHER sex actually has members too -- if one sex is
      // entirely absent, this is not a merge at all, just an ordinary
      // undersized single-sex group (same shape `off` would produce with
      // the same roster; see the "lone sex too small" test in
      // grouping.test.ts).
      //
      // Whole-branch review, I-2: ONE `sexBothTooSmall` warning naming
      // everyone, not two `sexSpillover` warnings (one per sex, each
      // claiming its side "joined a group of" the other) -- both of those
      // described the SAME single merged group, and read together they
      // contradict each other (boys "joined" girls' group; girls "joined"
      // boys' group; neither side actually had a pre-existing group here
      // to join). See WARNING_CODES.sexBothTooSmall's doc comment.
      attempts.push({ idx: blocks.map((_, i) => i), sizes });
      if (boysCount > 0 && girlsCount > 0) {
        warnings.push({
          code: WARNING_CODES.sexBothTooSmall,
          students: [...boysIdx, ...girlsIdx].flatMap((b) =>
            blocks[b].map((i) => present[i].number),
          ),
        });
      }
    } else if (girlsCount > 0 && girlsGroups === 0) {
      // Girls spill into boys' groups. Sized from boys' OWN headcount,
      // then re-sized to fit the spill on top, spread across boys' groups
      // the same way an ordinary leftover student already is -- see
      // `sizesForCount`'s doc comment for why this is not simply
      // `boysCount + girlsCount` at boys' own size/count.
      const combined = sizesForCount(
        boysCount + girlsCount,
        boysGroups,
        leftovers,
      );
      attempts.push({ idx: [...boysIdx, ...girlsIdx], sizes: combined });
      warnings.push(spillWarning(girlsIdx, 'F'));
    } else if (boysCount > 0 && boysGroups === 0) {
      const combined = sizesForCount(
        boysCount + girlsCount,
        girlsGroups,
        leftovers,
      );
      attempts.push({ idx: [...girlsIdx, ...boysIdx], sizes: combined });
      warnings.push(spillWarning(boysIdx, 'M'));
    } else {
      // Neither sex spills: each gets its own, fully independent attempt.
      if (boysCount > 0) {
        attempts.push({
          idx: boysIdx,
          sizes: ownSizes(boysCount, boysGroups, mode, leftovers),
        });
      }
      if (girlsCount > 0) {
        attempts.push({
          idx: girlsIdx,
          sizes: ownSizes(girlsCount, girlsGroups, mode, leftovers),
        });
      }
    }

    const resultGroups: Student[][] = [];
    for (const attempt of attempts) {
      const localBlocks = attempt.idx.map((b) => blocks[b]);
      const localAdj = localAdjacency(adj, attempt.idx);
      const outcome = placeSexSide(
        localBlocks,
        attempt.sizes,
        localAdj,
        present,
        random,
        nodeCap,
      );
      if (!outcome.ok) return { ok: false, error: outcome.error };
      for (const g of outcome.groups) {
        resultGroups.push(
          g.flatMap((b) => localBlocks[b].map((i) => present[i])),
        );
      }
    }
    return { ok: true, groups: resultGroups, warnings };
  };

  // Runs the winning candidate's raw groups through the same randomised
  // display-order shuffle `off`/`mix` apply to their own result (see the
  // comment at buildGroups's own call to `shuffled`) and succeeds. The one
  // and only place this function calls `shuffled`.
  const finish = (attempt: {
    groups: Student[][];
    warnings: GroupingWarning[];
  }): GroupingOutcome => {
    const slots = shuffled(
      attempt.groups.map((_, i) => i),
      random,
    );
    return succeed(
      slots.map((i) => attempt.groups[i]),
      attempt.warnings,
    );
  };

  if (mode.kind === 'perGroup') {
    const { boys, girls } = allocateSexGroups(boysCount, girlsCount, mode);
    const attempt = attemptSplit(boys, girls);
    return attempt.ok ? finish(attempt) : fail(attempt.error);
  }

  // mode.kind === 'groupCount': the search (Fix round 1, F-1). Proportional
  // first (`allocationCandidates`'s own first entry), then progressively
  // less-fair splits, stopping at the first that places.
  const candidates = allocationCandidates(boysCount, girlsCount, mode);
  let lastError: GroupingError | undefined;
  // Fix round 2. Whether ANY candidate's own failure was a gave-up one
  // rather than a proof -- tracked across the WHOLE loop, not just the
  // last candidate, because the final verdict below must report the
  // weaker, honest claim the instant even one candidate never got
  // exhausted, even when every OTHER candidate WAS proven impossible
  // outright. Only three of `attemptSplit`'s possible errors are
  // themselves a "gave up": `togetherUnitTooLarge` and `keepApartImpossible`
  // are direct proofs with no search involved at all (see their own doc
  // comments), and the `*NoArrangement` codes are what a search reports once
  // it DOES run to completion -- so this checks for exactly the three
  // `*SearchGaveUp` codes, nothing else.
  let anyGaveUp = false;
  for (const { boys, girls } of candidates) {
    const attempt = attemptSplit(boys, girls);
    if (attempt.ok) return finish(attempt);
    lastError = attempt.error;
    if (
      attempt.error.code === ERROR_CODES.togetherSearchGaveUp ||
      attempt.error.code === ERROR_CODES.keepApartSearchGaveUp ||
      attempt.error.code === ERROR_CODES.bothRulesSearchGaveUp
    ) {
      anyGaveUp = true;
    }
  }

  // Every candidate failed. Exactly one candidate tried (one side absent,
  // or fewer than 2 groups requested -- see `allocationCandidates`) means
  // there was no ambiguity to search: report that one attempt's own
  // honest error directly, exactly as this function always has -- including
  // when that one attempt's own error is itself a `*SearchGaveUp` code;
  // there is no OTHER candidate to have proven anything either way, so
  // there is nothing for `sexSeparateImpossible`/`sexSeparateSearchGaveUp`
  // to add. More than one means several different ways of splitting the
  // SAME requested total between the two sexes were all tried and all
  // rejected -- naming any one of their individual errors would carry a
  // side-scoped number that contradicts what the teacher actually typed,
  // and blame a rule the search has, collectively, not isolated (see
  // ERROR_CODES.sexSeparateImpossible's doc comment).
  // `as GroupingError`, not `?? ...`: `candidates` always has >= 1 entry
  // (`allocationCandidates` always includes `proportional`), and the loop
  // above only reaches this line after every candidate's iteration set
  // `lastError` without returning -- so it is never actually `undefined`
  // here. `| undefined` is only in `lastError`'s own type because nothing
  // in this module's types can express "set at least once by the time a
  // loop over a non-empty array finishes" (see the module doc: no type
  // checker enforces this repo's guarantees, a runtime one has to).
  if (candidates.length === 1) return fail(lastError as GroupingError);
  // Fix round 2. PREFER THE HONEST WEAKER CLAIM: `sexSeparateImpossible` is
  // a proof (every candidate exhausted to completion, none work);
  // `sexSeparateSearchGaveUp` is reported instead the moment ANY candidate
  // gave up, even when every OTHER candidate above WAS proven impossible --
  // the space this search covers was never actually fully explored, so
  // "cannot be done" is not a claim this run has earned. Do NOT "optimise"
  // this into reporting the proof whenever AT LEAST ONE candidate proved
  // impossibility, and do NOT require ALL candidates to have given up
  // before admitting defeat -- either change quietly reintroduces the
  // overclaim this split exists to close (see sexSeparateImpossible's
  // ERROR_CODES doc comment for the concrete teacher-facing lie that would
  // be: "cannot be done" said with confidence when the search simply never
  // looked far enough to know).
  return fail(
    anyGaveUp
      ? { code: ERROR_CODES.sexSeparateSearchGaveUp }
      : {
          code: ERROR_CODES.sexSeparateImpossible,
          groupsRequested: mode.count,
        },
  );
}

/**
 * Whole-branch review, C-1. `buildSeparateGroups` (and `placeSexSide`, which
 * it calls) operates entirely in POOL terms -- it is handed `poolMode` and
 * `poolSizes`, already reduced by however many groups the pins claimed, and
 * never sees `pinnedGroups.length` at all (see the call site below). Every
 * count a failure from it carries -- `groupsRequested` (sexSeparateImpossible),
 * `groupsTried` (togetherNoArrangement / keepApartNoArrangement /
 * bothRulesNoArrangement, reached here when only one allocation candidate
 * ever existed to try -- see buildSeparateGroups's own closing comment), or
 * `groupsNeeded` (keepApartImpossible, from placeSexSide's fast clique gate)
 * -- is therefore a POOL figure. But every one of those codes is rendered by
 * copy that speaks in WHOLE-CLASS terms: "fit your class into N groups",
 * "you would need at least N groups". A pinned group already claims one of
 * those groups, so the pool's own count always undercounts the truthful
 * whole-class figure by exactly `pinnedGroups.length` -- confirmed
 * reachable, not hypothetical: a pinned pair plus a 4-strong apart-clique in
 * the pool, groupCount 4, reported `groupsNeeded: 4` (implying the teacher's
 * own typed 4 is already too few -- self-contradicting) when the true
 * figure is 5 (4 for the clique, which cannot use the pinned group, plus
 * the 1 already pinned).
 *
 * Restoring it here, once, at the single seam where a `separate`-mode
 * failure crosses back from pool-scoped `buildSeparateGroups` into this
 * whole-class-facing function, is what makes every one of those sentences
 * describe a number the teacher actually typed -- see the matching fix a
 * little further down for `off`/`mix`'s own keepApartImpossible/
 * *NoArrangement sites, which reach the identical failure shape a different
 * way (the one `placeBlocks` call this function makes directly, never
 * through `buildSeparateGroups`). `pinnedTooManyGroups` never needed this
 * fix: it captures `mode.count` -- the ORIGINAL, unreduced number -- before
 * `poolMode` is ever computed (see its own ERROR_CODES doc comment).
 *
 * Every OTHER code `buildSeparateGroups`/`placeSexSide` can return is passed
 * through unchanged: `togetherUnitTooLarge` carries a group SIZE, not a
 * group COUNT (the largest available pool group really is the right number
 * to compare against -- a together-unit can only ever land in the pool),
 * `sexSeparateSplitsUnit` carries a student list, and every `*SearchGaveUp`
 * code carries no data at all -- there is nothing on any of them for this
 * function to adjust.
 */
function restoreWholeClassCount(
  error: GroupingError,
  pinnedGroupCount: number,
): GroupingError {
  switch (error.code) {
    case ERROR_CODES.keepApartImpossible:
      return { ...error, groupsNeeded: error.groupsNeeded + pinnedGroupCount };
    case ERROR_CODES.togetherNoArrangement:
    case ERROR_CODES.keepApartNoArrangement:
    case ERROR_CODES.bothRulesNoArrangement:
      return { ...error, groupsTried: error.groupsTried + pinnedGroupCount };
    case ERROR_CODES.sexSeparateImpossible:
      return {
        ...error,
        groupsRequested: error.groupsRequested + pinnedGroupCount,
      };
    default:
      return error;
  }
}

export function buildGroups(input: GroupingInput): GroupingOutcome {
  // Counted before it is built. Past this line the roster exists in memory,
  // so this is the only place the size can still be refused cheaply.
  if (requestedSize(input.students) > MAX_STUDENTS) {
    return fail({
      code: ERROR_CODES.tooManyStudents,
      maxStudents: MAX_STUDENTS,
    });
  }

  const students = normaliseStudents(input.students);

  // The PAGE also refuses duplicates, live, in stage 3. Both must say the same
  // sentence, so the engine reports the code and the number and the renderer
  // owns the words -- exactly one place builds that string.
  const seen = new Set<number>();
  for (const s of students) {
    if (seen.has(s.number)) {
      return fail({ code: ERROR_CODES.duplicateNumber, number: s.number });
    }
    seen.add(s.number);
  }

  // Whole-branch review, I-4: this and the `present.length === 0` guard just
  // below are TWO different triggers sharing one code with no data to tell
  // them apart -- deliberate (see that guard's own comment) -- but the
  // COPY must therefore be true of both, which it was not before this fix
  // (see NO_STUDENTS's own comment in en.ts).
  if (students.length === 0) return fail({ code: ERROR_CODES.noStudents });

  // Absence is applied here, after the roster is counted and validated, so a
  // duplicate number is still caught in a row that is out today -- the teacher
  // is going to untick it tomorrow. A NON-empty roster where every student is
  // marked absent reaches the exact same `noStudents` code as the empty-roster
  // guard above, deliberately -- see that guard's comment and NO_STUDENTS's
  // own comment in en.ts for why the collapse is safe: the copy makes no
  // claim only one of the two triggers can be true of.
  const present = students.filter((s) => !s.absent);
  if (present.length === 0) return fail({ code: ERROR_CODES.noStudents });

  // A precondition on the ROSTER'S data, not on the requested shape or the
  // rules the teacher wrote -- the same tier as duplicateNumber and
  // noStudents above, both of which also ask "is this data usable" before
  // anything downstream (mode validation, block-building, the search) is
  // asked to make sense of it. So it is checked here, before mode
  // validation and before togetherApartClash below, rather than closer to
  // where `sex` is actually consumed (`placeBlocks`'s weave).
  //
  // That ordering is deliberate, not just "as early as it can be". This
  // guard is a caller-contract violation -- stage 2 disables the mix and
  // separate switches until every student being grouped already has a sex,
  // so a real teacher cannot reach it -- while an invalid group count, too
  // many groups, and a together/apart clash are things a teacher genuinely
  // types. Even so, it fires FIRST: duplicateNumber and noStudents do not
  // spend effort validating a request's SHAPE when the roster's DATA is not
  // even usable yet, and this guard is the same kind of check -- "can I
  // trust what I was handed" -- just conditioned on `sexMode` the way
  // invalidGroupSize is conditioned on `mode.kind`. A non-page caller (a
  // test, a future integration) that violates the contract gets told about
  // ITS mistake first, on the same footing its other data mistakes already
  // are, rather than being sent on a detour through mode/rule errors that
  // are moot the moment this module cannot honour the setting it was asked
  // to run under.
  //
  // Scoped to `sexMode !== 'off'` as of Task 8a -- `mix` AND `separate`,
  // widened from `mix` only. Task 7 scoped it narrower because at the time
  // `separate` did not read `sex` anywhere in this file, so refusing a
  // `separate` roster over a field that mode never consulted would have
  // been a pure regression; see
  // docs/superpowers/notes/2026-08-06-classroom-groups-v2-engine-measurements.md,
  // "mix: byte-identical under off and separate" for the measurement that
  // pinned `separate`'s output as unaffected by `mix`'s existence at the
  // time (Task 7). That measurement is about PLACEMENT, not this guard --
  // this guard's own widening (Task 8a) changed only which rosters get
  // past it, still true today. What is NOT true today: `separate`'s
  // PLACEMENT itself. Task 8a widened this predicate deliberately AHEAD OF
  // Task 8b's separate-mode placement landing, precisely so Task 8b would
  // not also have to remember to add this guard once `sex` was wired into
  // `separate`'s own logic -- see `ERROR_CODES.sexNeedsAllSet`'s doc
  // comment for the full reasoning and the tripwire test that flips. Task
  // 8b has since landed: `separate` no longer places like `off` for a
  // roster that spills (see `buildSeparateGroups`), so a roster this guard
  // lets through today can end up placed very differently under the two
  // modes -- this guard only ever decided whether `sex` was usable data at
  // all, never what would be done with it.
  //
  // Fix round 1, F-2: reads `!== 'M' && !== 'F'`, not `=== null`. The old
  // check closed exactly one hole -- a `sex` of literally `null` -- and left
  // every other off-domain value (`undefined`, `''`, `'m'`, `'male'`, `0`,
  // anything a non-TypeScript caller might send; this repo has no runtime
  // type checker, see the module doc) to slip straight through, because
  // `undefined === null` is false. A slipped-through value then vanished
  // silently in `weaveBySex`'s old two-list split (neither `=== 'M'` nor
  // `=== 'F'` nor `=== null` matched it, so it landed in NONE of `boys`,
  // `girls`, `rest` and never reached `order` at all) -- `ok: true` with one
  // fewer student than the roster held, no error, nothing to tell a teacher
  // who would have printed that group list. Measured: `sex: undefined` on
  // one student in a 6-student roster returned five. See
  // docs/superpowers/notes/2026-08-06-classroom-groups-v2-engine-measurements.md,
  // "What slipped through before the fix" for the reproduction. This check
  // is the door, not one hole in it: anything that is not exactly `'M'` or
  // `'F'` is refused here, by name, before it can reach the weave (or, as
  // of Task 8a, `separate`'s own future placement) at all.
  if (input.sexMode === 'mix' || input.sexMode === 'separate') {
    const unset = present
      .filter((s) => s.sex !== 'M' && s.sex !== 'F')
      .map((s) => s.number);
    if (unset.length > 0) {
      return fail({ code: ERROR_CODES.sexNeedsAllSet, students: unset });
    }
  }

  const { mode, leftovers, random } = input;
  const nodeCap = input.searchNodeCap ?? SEARCH_NODE_CAP;
  if (
    mode.kind === 'perGroup' &&
    (!Number.isInteger(mode.size) || mode.size < 1)
  ) {
    return fail({ code: ERROR_CODES.invalidGroupSize });
  }
  if (mode.kind === 'groupCount') {
    if (!Number.isInteger(mode.count) || mode.count < 1) {
      return fail({ code: ERROR_CODES.invalidGroupCount });
    }
    if (mode.count > present.length) {
      return fail({
        code: ERROR_CODES.tooManyGroups,
        maxGroups: present.length,
      });
    }
  }

  // Task 9. Pinned groups are matched by NUMBER against the CURRENT roster,
  // never taken as given: a pin is a snapshot from a previous shuffle, and a
  // student in it may since have been marked absent, renamed, reassigned a
  // sex, or removed from the roster altogether. `presentByNumber` is built
  // from `present` (post-absence), so a pinned number that is absent today
  // or was never on this roster at all simply is not found there -- dropped
  // the same way, for the same reason, as any other unresolvable number: no
  // CURRENT student to place (see the Task 9 report for why that is judged
  // safe rather than refused). Every OTHER field (name, sex, ...) comes from
  // this lookup too, never from the pinned record itself -- the pin fixes
  // WHO is together, not what was true about them last time (Correction 1;
  // see the "stale name and sex" test in grouping.test.ts).
  const presentByNumber = new Map(present.map((s) => [s.number, s]));
  const pinnedGroups = input.pinned
    .map((g) =>
      g
        .map((s) => presentByNumber.get(s.number))
        .filter((s): s is Student => s !== undefined),
    )
    .filter((g) => g.length > 0);

  // Task 9, Correction 3: a caller error, not a teacher mistake -- see the
  // report. The SAME student number resolved into more than one pinned
  // group (or twice within one group's own list) would otherwise be placed
  // into the final output more than once: each occurrence is looked up
  // against the current roster independently, so nothing else here would
  // ever notice the collision. That breaks the one invariant `Student.number`
  // promises -- identity is the number, and it is unique -- so, like
  // `duplicateNumber` for the raw roster, this is refused rather than
  // silently tolerated. Checked before anything else here trusts
  // `pinnedGroups`'s membership.
  const seenPinned = new Set<number>();
  for (const group of pinnedGroups) {
    for (const s of group) {
      if (seenPinned.has(s.number)) {
        return fail({ code: ERROR_CODES.pinnedInTwoGroups, number: s.number });
      }
      seenPinned.add(s.number);
    }
  }

  // Task 9, Correction 3, interaction 2 (decision -- see the report). Two
  // students who share an apart-letter, mutually separated, pinned into the
  // SAME group: the teacher has asked for two contradictory things about the
  // same pair. Refused, not warned -- the opposite call from the mixed-sex
  // pin below, and deliberately so; see ERROR_CODES.pinnedApartClash's doc
  // comment for why.
  for (const group of pinnedGroups) {
    const seenLetters = new Map<string, number[]>();
    for (const s of group) {
      if (s.apart === null) continue;
      const list = seenLetters.get(s.apart) ?? [];
      list.push(s.number);
      seenLetters.set(s.apart, list);
    }
    for (const numbers of seenLetters.values()) {
      if (numbers.length > 1) {
        return fail({
          code: ERROR_CODES.pinnedApartClash,
          students: numbers.slice().sort((a, b) => a - b),
        });
      }
    }
  }

  const pinnedNumbers = new Set(pinnedGroups.flat().map((s) => s.number));
  const pool = present.filter((s) => !pinnedNumbers.has(s.number));

  // Task 9, Correction 3, interaction 1 (decision -- see the report). A
  // pinned group under `separate` whose members are not all the same sex:
  // warned, not refused. A pin is the teacher's own current, direct
  // instruction about this exact group, overriding the single-sex
  // PREFERENCE `separate` otherwise expresses -- unlike a together-LETTER
  // (sexSeparateSplitsUnit below), which is a general rule that only
  // incidentally spans two sexes. See WARNING_CODES.pinnedMixedSex's doc
  // comment for the full reasoning, including why silence was not an option.
  const warnings: GroupingWarning[] = [];
  if (input.sexMode === 'separate') {
    for (const group of pinnedGroups) {
      const sexes = new Set(group.map((s) => s.sex));
      if (sexes.size > 1) {
        warnings.push({
          code: WARNING_CODES.pinnedMixedSex,
          students: group.map((s) => s.number).sort((a, b) => a - b),
        });
      }
    }
  }

  // A together-unit that straddles a pinned BOUNDARY cannot be honoured: no
  // pinned group is being added to -- pins are left exactly as they are --
  // so whichever member(s) end up on the other side of the boundary have
  // nowhere the rule can put them back together. Silently unpinning would
  // undo something the teacher explicitly asked to keep, so this is
  // refused with every student the unit involves named.
  //
  // Fix round 1, F-3/F-4. A "boundary" is between any two of the REGIONS
  // the pins carve the present roster into: the pool, and each pinned
  // group. The original check here only ever compared the pool against the
  // pinned groups COMBINED, so it caught a unit split pool-vs-pinned but
  // was blind to the identical contradiction between two DIFFERENT pinned
  // groups (each honoured independently, so two together-lettered students
  // who each ended up pinned into a different group stayed apart with
  // nothing said -- reported, not built, at Task 9; see
  // ERROR_CODES.pinnedSplitsUnit's doc comment for why that reasoning does
  // not hold and the Fix round 1 report for the reachable case). Tracking
  // regions explicitly (not just "pool or not") is what closes that gap
  // with the SAME code, in the SAME pass: a letter used by members of two
  // or more distinct regions -- pool+pinned, or pinned+pinned -- is exactly
  // the contradiction this code exists to refuse.
  //
  // Collecting every member before failing (F-4) is what fixes the
  // original's other defect: it returned as soon as ONE pool member's
  // letter matched, naming that member and every PINNED member sharing the
  // letter, but not a SECOND pool member sharing the same letter -- a unit
  // of {1 pinned, 7 pool, 8 pool} reported `students: [1, 7]` and left 8
  // unnamed, while the copy claims "only SOME of them are in a pinned
  // group", implying the rest -- all of them -- are named.
  const regionsByLetter = new Map<string, Set<string>>();
  const membersByLetter = new Map<string, Student[]>();
  const noteLetter = (s: Student, region: string): void => {
    if (s.together === null) return;
    const regions = regionsByLetter.get(s.together) ?? new Set<string>();
    regions.add(region);
    regionsByLetter.set(s.together, regions);
    const members = membersByLetter.get(s.together) ?? [];
    members.push(s);
    membersByLetter.set(s.together, members);
  };
  for (const s of pool) noteLetter(s, 'pool');
  pinnedGroups.forEach((group, i) => {
    for (const s of group) noteLetter(s, `pinned:${i}`);
  });
  for (const [letter, regions] of regionsByLetter) {
    if (regions.size > 1) {
      const members = membersByLetter.get(letter) ?? [];
      return fail({
        code: ERROR_CODES.pinnedSplitsUnit,
        students: members.map((p) => p.number).sort((a, b) => a - b),
      });
    }
  }

  // Degenerate case: nothing left to deal. Checked directly on `pool.length`
  // rather than by comparing `pinnedGroups.length` against a group count --
  // pins can cover the whole roster using FEWER groups than were requested
  // (two big pinned groups against a groupCount of 5), and that must also
  // succeed with just the pinned groups, not hand an empty pool to
  // `targetSizes`, which turns a zero total into PHANTOM EMPTY GROUPS under
  // `groupCount` mode (`base` floors to 0, but `groupCount` itself is
  // unchanged, so `sizes` comes back as N zeros, not an empty array). See
  // the Task 9 report for the concrete case this closes.
  //
  // Checked UNCONDITIONALLY, ahead of the pinnedTooManyGroups guard directly
  // below -- Fix round 1, F-6: pins can also claim MORE groups than were
  // requested (`pinnedGroups.length > mode.count`) while still covering the
  // whole roster, which is brief-sanctioned and must still succeed with no
  // error or warning. Proven by mutation, not just read: swapping the order
  // of these two checks turns that case into a wrongful refusal (see the
  // Fix round 1 report).
  if (pool.length === 0) {
    return succeed(pinnedGroups, warnings);
  }

  // Fix round 1, F-1/F-2 (the same situation from two directions -- see
  // ERROR_CODES.pinnedTooManyGroups's doc comment for the full reasoning
  // this replaces, and the Fix round 1 report for the reachable shapes).
  // `poolGroupsNeeded` is how many groups the POOL itself must fill once
  // the pinned ones are set aside; valid only when there is at least one
  // such group AND enough pool students to give every one of them at least
  // one member. `perGroup` cannot reach this branch: its group count is
  // always re-derived from `pool.length` below, and `targetSizes`'s
  // `Math.max(1, ...)` floor guarantees at least one group for any nonempty
  // pool with every entry `>= 1`, so no analogous contradiction exists for
  // it to report.
  if (mode.kind === 'groupCount') {
    const poolGroupsNeeded = mode.count - pinnedGroups.length;
    if (poolGroupsNeeded < 1 || poolGroupsNeeded > pool.length) {
      return fail({
        code: ERROR_CODES.pinnedTooManyGroups,
        requestedGroups: mode.count,
        pinnedGroupCount: pinnedGroups.length,
        remainingStudents: pool.length,
      });
    }
  }

  // Everything downstream operates on the POOL, not `present` -- the pinned
  // students are already placed and excluded above -- with the group count
  // reduced by however many groups are already pinned (`groupCount` mode
  // only; `perGroup`'s count has no explicit total to reduce, it simply
  // re-derives from the smaller `pool.length` the same way it always
  // derives from a total) and every size computed from `pool.length` rather
  // than `present.length`. When `pinned` is empty this recomputes
  // byte-identical values from the same effective inputs -- `pool` has the
  // same members in the same order as `present` (filtering out of an empty
  // Set changes nothing), and `poolMode` has the same value as `mode` (`count
  // - 0`) -- so `off`, `mix` and `separate` are unaffected BY CONSTRUCTION,
  // not merely by testing; see the Task 9 report for the sweep that verifies
  // it empirically too.
  const poolMode: Mode =
    mode.kind === 'groupCount'
      ? { kind: 'groupCount', count: mode.count - pinnedGroups.length }
      : mode;
  const poolSizes = targetSizes(pool.length, poolMode, leftovers);
  const blocks = buildBlocks(pool);

  // Task 8b. A together-unit spanning both sexes is a contradiction under
  // `separate`: single-sex groups and "these students are one unit,
  // wherever it lands" cannot both be honoured, so it is refused here,
  // before placement runs, rather than resolved by silently placing the
  // whole unit on one side (see ERROR_CODES.sexSeparateSplitsUnit's doc
  // comment). Checked as soon as `blocks` exists -- the earliest point it
  // can be, and ahead of togetherApartClash below: a unit whose very
  // premise is broken under this sexMode is a more fundamental problem
  // than one that also happens to self-conflict on apart-letters. Every
  // present student's sex is already guaranteed to be exactly 'M' or 'F'
  // by the guard above (`sexMode !== 'off'` includes `separate`), so
  // `sexes` can only ever be size 1 or 2, never contain `null`. (Task 9:
  // `blocks` is built from `pool` now, so a pinned student's sex is never
  // consulted here -- a mixed-sex PIN is handled entirely by
  // `pinnedMixedSex` above, which runs unconditionally, before this.)
  if (input.sexMode === 'separate') {
    for (const block of blocks) {
      const sexes = new Set(block.map((i) => pool[i].sex));
      if (sexes.size > 1) {
        return fail({
          code: ERROR_CODES.sexSeparateSplitsUnit,
          students: block.map((i) => pool[i].number),
        });
      }
    }
  }

  // Caught here rather than left to the placer. The search would fail on a
  // self-conflicting block and report "no arrangement exists" -- true, and
  // the wrong sentence: the teacher asked for something impossible, not for
  // something merely unreachable, and only one of those tells them what to
  // fix.
  for (const block of blocks) {
    const seenLetters = new Map<string, number[]>();
    for (const i of block) {
      const letter = pool[i].apart;
      if (letter === null) continue;
      const list = seenLetters.get(letter) ?? [];
      list.push(pool[i].number);
      seenLetters.set(letter, list);
    }
    for (const numbers of seenLetters.values()) {
      if (numbers.length > 1) {
        return fail({
          code: ERROR_CODES.togetherApartClash,
          students: numbers,
        });
      }
    }
  }

  // Checked against the LARGEST group, because that is the only one a big unit
  // could fit in. Comparing against the smallest would refuse arrangements
  // that are perfectly possible.
  //
  // Scoped to `sexMode !== 'separate'` (Task 8b): once each sex is placed
  // against its OWN sizes rather than these whole-roster ones, `sizes` is
  // the wrong basis for this check under `separate` -- a side's own
  // largest group can be smaller OR larger than the whole roster's, once
  // the requested group count is allocated between the sexes unevenly
  // (see `allocateSexGroups`). `separate` runs this identical check
  // itself, per placement attempt, against that attempt's own sizes --
  // see `placeSexSide`. (Task 9: `poolSizes`, not the whole-roster `sizes`
  // -- the pinned groups already occupy their own share of the total.)
  if (input.sexMode !== 'separate') {
    const largestGroup = Math.max(...poolSizes);
    for (const block of blocks) {
      if (block.length > largestGroup) {
        return fail({
          code: ERROR_CODES.togetherUnitTooLarge,
          letter: pool[block[0]].together as string,
          unit: block.length,
          groupSize: largestGroup,
        });
      }
    }
  }

  // Block-indexed conflict adjacency from apart-letters (see buildConflicts).
  // This IS what `assign` places against below -- there is no separate
  // student-indexed adjacency and no later substitution step, so the bug the
  // Task 4 addendum used to warn about here (handing `assign` a
  // student-indexed set and reading it as if it were block-indexed) has no
  // seam left for it to reappear at: one adjacency, built at block width,
  // used everywhere a conflict is asked about.
  const adj = buildConflicts(pool, blocks);

  // "Is an apart-rule actually live" has two possible readings, and they
  // disagree. `present.some((s) => s.apart !== null)` is true the moment ONE
  // student carries a letter, even though a letter only one person holds
  // constrains nobody -- buildConflicts never gives a lone holder an edge.
  // Deriving it from the adjacency instead -- some block has a real conflict
  // -- is the truthful reading: it can only be true when the search's own
  // input actually contains a constraint. It is computed once, here, and
  // both the clique gate immediately below and the failure attribution
  // further down read this SAME flag, so the two can never disagree with
  // each other about what "in play" means.
  const apartInPlay = adj.some((conflicts) => conflicts.size > 0);

  // Scoped to `sexMode !== 'separate'` (Task 8b), same reasoning as the
  // togetherUnitTooLarge guard above: `sizes.length` here is the WHOLE
  // roster's group count, the wrong basis once each sex is placed against
  // its own, separately-sized attempt. A clique entirely within one sex's
  // blocks needs comparing against THAT side's own group count, not the
  // whole roster's -- and a clique spanning both sexes does not need
  // `clique.length` groups under `separate` at all, since two blocks of
  // different sexes are never seated together unless one of them spills
  // (see the report for the full reasoning). `separate` runs this
  // identical clique check itself, per placement attempt, against that
  // attempt's own local adjacency and sizes -- see `placeSexSide`. (Task 9:
  // `poolSizes`, same reasoning as togetherUnitTooLarge above.)
  if (input.sexMode !== 'separate' && apartInPlay) {
    const clique = largestMutualConflict(adj, nodeCap);
    if (clique.length > poolSizes.length) {
      return fail({
        code: ERROR_CODES.keepApartImpossible,
        // ONE representative per block, not every member of every block
        // (Fix round 1, F-1). Every member would name students who are not
        // mutually apart at all -- a block can hold students with no
        // apart-letter of their own (they are there only because a
        // together-letter binds them to a real letter-holder), and naming
        // them alongside their blockmate asserts that two students who must
        // be kept TOGETHER also need to be kept apart from each other. It
        // also makes `students.length` bigger than `groupsNeeded`,
        // self-contradicting the sentence it feeds: N mutually-apart
        // students need N groups, not fewer.
        //
        // Every block reported here is guaranteed to have at least one
        // apart-letter holder: `buildConflicts` only ever gives a block an
        // edge because one of its members shares a letter with a member of
        // another block, and a clique this gate reports always has at least
        // two blocks (`clique.length > poolSizes.length >= 1`). So `.find`
        // below always succeeds; the `?? blocks[b][0]` fallback is
        // unreachable defensive code, not a real path. Numbers, because
        // identity is the number (Student.number); renderError's resolver
        // turns these into names for a page that has a roster to resolve
        // them against.
        students: clique.map((b) => {
          const holder = blocks[b].find((i) => pool[i].apart !== null);
          return pool[holder ?? blocks[b][0]].number;
        }),
        // Whole-branch review, C-1. `clique.length` alone is a POOL figure --
        // how many of the pins-excluded students conflict -- but the copy
        // ("...so you would need at least N groups") states a WHOLE-CLASS
        // fact. Every pinned group is already a group the clique's own
        // members cannot use (they are, by definition, not pinned), so the
        // truthful total is the clique's own need PLUS however many groups
        // the pins already claim -- see `restoreWholeClassCount`'s doc
        // comment (the identical fix for `separate`'s own equivalent gate)
        // for the concrete reachable case this closes.
        groupsNeeded: clique.length + pinnedGroups.length,
      });
    }
  }

  // Task 8b. `separate` branches away here, before the single whole-roster
  // placement below: it places each sex's own blocks separately and
  // concatenates, which is a different shape of work entirely (see
  // `buildSeparateGroups`) -- everything from here to the end of this
  // function is `off` and `mix` only, unchanged by this task. (Task 9: pool
  // and poolSizes/poolMode, not the whole-roster present/sizes/mode -- and
  // the pinned groups plus their own warnings are stitched onto whichever
  // outcome comes back, success only; a failure to place the POOL is still
  // an overall failure, pins do not rescue it.)
  if (input.sexMode === 'separate') {
    const outcome = buildSeparateGroups(
      pool,
      blocks,
      adj,
      poolSizes,
      poolMode,
      leftovers,
      random,
      nodeCap,
    );
    if (!outcome.ok) {
      // Whole-branch review, C-1. See `restoreWholeClassCount`'s own doc
      // comment for why this crossing is where a pool-scoped count from
      // `separate`'s own search becomes the whole-class figure the copy
      // actually renders.
      return fail(restoreWholeClassCount(outcome.error, pinnedGroups.length));
    }
    return succeed(
      [...pinnedGroups, ...outcome.result.groups],
      [...warnings, ...outcome.result.warnings],
    );
  }

  // Two-pass placement -- see `placeBlocks`. Pass 1 is the shuffled order,
  // unsorted apart from Task 7's boy-girl weave under `mix`, which is what
  // supplies arrangement variety; pass 2 (first-fit-decreasing) runs only if
  // pass 1 gives up (Fix round 2, closing the arrangement-variety regression
  // Fix round 1's sort caused). `adj` is real now: a block-vs-block conflict
  // can and does turn away a placement that capacity alone would have
  // allowed, in both passes. (Task 9: pool and poolSizes, not present/sizes.)
  const { groups: placed, gaveUp } = placeBlocks(
    blocks,
    poolSizes,
    adj,
    random,
    pool,
    input.sexMode,
    nodeCap,
  );
  if (placed === null) {
    // Two different failures, and the difference is everything. The search
    // either ran to completion — in which case no arrangement exists at this
    // group count, and saying so is a proof — or it hit its budget, in which
    // case nothing whatsoever has been established.
    //
    // What is NOT said here is who conflicts with whom. The old code handed
    // back every name appearing in any pair and let the copy call them
    // mutually inseparable; for a five-student ring that named two children
    // who have no rule between them at all. A clique is the only thing that
    // licenses that sentence, and by this line the clique gate has already
    // declined to fire.
    //
    // Which RULE failed matters too (Fix round 1, F-1): a together clash and
    // a keep-apart clash have opposite remedies -- the together copy says
    // make groups BIGGER or use fewer/lighter letters, the keep-apart copy
    // says make MORE groups or drop a rule -- so attributing a together
    // failure to keep-apart hands the teacher a fix that makes the real
    // problem worse. Decided from what is actually in play: a block bigger
    // than one student means a together-letter is live; `apartInPlay`
    // (computed once, above, and reused here rather than from a second,
    // different definition) means an apart-letter conflict is live.
    //
    // Task 5 resolves the third case Task 4 left as a stated placeholder:
    // BOTH kinds of rule live at once. Neither single-rule code is safe to
    // guess here -- their remedies are opposites (bigger groups make a
    // together clash better and a keep-apart clash worse; more groups is the
    // reverse), and the search genuinely cannot say which rule is the one
    // actually blocking a fit, only that it could not find one. Guessing
    // sends the teacher the wrong way exactly as often as the right one.
    // BOTH_RULES_NO_ARRANGEMENT / BOTH_RULES_SEARCH_GAVE_UP say what is
    // actually known: both rules are named, both remedies are offered, and
    // neither is claimed to be the cause.
    const togetherInPlay = blocks.some((block) => block.length > 1);

    if (togetherInPlay && apartInPlay) {
      return fail(
        gaveUp
          ? { code: ERROR_CODES.bothRulesSearchGaveUp }
          : {
              code: ERROR_CODES.bothRulesNoArrangement,
              // Whole-branch review, C-1. `poolSizes.length` is how many
              // groups the POOL was searched over; the copy states a
              // WHOLE-CLASS fact ("fit your class into N groups"), so the
              // pins' own groups are added back -- see
              // `restoreWholeClassCount`'s doc comment.
              groupsTried: poolSizes.length + pinnedGroups.length,
            },
      );
    }

    if (togetherInPlay) {
      return fail(
        gaveUp
          ? { code: ERROR_CODES.togetherSearchGaveUp }
          : {
              code: ERROR_CODES.togetherNoArrangement,
              // Whole-branch review, C-1. Same fix as bothRulesNoArrangement
              // just above -- see `restoreWholeClassCount`'s doc comment.
              groupsTried: poolSizes.length + pinnedGroups.length,
            },
      );
    }

    // apartInPlay must be true here: `placed === null` only happens when
    // `assign` actually turned a placement away, and with togetherInPlay
    // false every block is a singleton, which cannot fail on capacity alone
    // (poolSizes always sums to pool.length -- see targetSizes) -- only a
    // live conflict can. Written as the fallback rather than
    // `else if (apartInPlay)` so a future change to either flag's
    // definition fails safe into the strongest claim's OPPOSITE (a refusal
    // rather than a silent wrong success), not into silence.
    return fail(
      gaveUp
        ? { code: ERROR_CODES.keepApartSearchGaveUp }
        : {
            code: ERROR_CODES.keepApartNoArrangement,
            // Whole-branch review, C-1. Same fix as bothRulesNoArrangement
            // above -- see `restoreWholeClassCount`'s doc comment.
            groupsTried: poolSizes.length + pinnedGroups.length,
          },
    );
  }

  // Randomise which group is "oversized" so bunched leftovers do not always
  // land in group 1, and spread leftovers do not always favour the first
  // groups. Sizes were computed in a fixed order; the mapping is what varies.
  const slots = shuffled(
    placed.map((_, i) => i),
    random,
  );
  // This is `off`/`mix`'s own success path -- `separate` returned via
  // `buildSeparateGroups` above and never reaches here. Neither `off` nor
  // `mix` ever populates WARNING_CODES.sexSpillover (see its doc comment),
  // so the only warnings on THIS path are whatever pin-related ones were
  // collected above (`pinnedMixedSex` needs `separate`, which returned
  // already, so in practice this is always `[]` here too -- carried through
  // rather than hardcoded so a future pin-related warning that DOES apply to
  // `off`/`mix` is not silently dropped). Task 9: the pinned groups are
  // prepended -- they were excluded from `blocks`/`placed` entirely, so
  // `pool[j]`, not `present[j]`, resolves each dealt student.
  return succeed(
    [
      ...pinnedGroups,
      ...slots.map((i) =>
        placed[i].flatMap((b) => blocks[b].map((j) => pool[j])),
      ),
    ],
    warnings,
  );
}

/**
 * Every absence assertion the guard cannot prove had a population behind it,
 * by `file › test title as written` (or function name), with how many such
 * assertions that scope holds (#609). Generated from the scan in
 * `tests/guards/absence-liveness.test.ts` when the self-contained shape stopped
 * being out of scope, and pasted: never typed.
 *
 * It may only shrink. A converted site (routed through `searched` with a
 * floor, #610-#617) makes its count too high and the guard is red until the
 * count is lowered or the entry removed; a new unjudged absence is red
 * because it is not listed. There is no label, reason or shape that exempts
 * a site: this list is debt, not an allowance.
 */
export const ABSENCE_BURN_DOWN: Readonly<Record<string, number>> = {
  'tests/device/ios/journeys.journey.ts › Journey 5 -- 0 students: the real localised error, no groups': 1,
  'tests/device/ios/journeys.journey.ts › Journey 6 -- more groups than students: the real localised message, no groups rendered': 1,
  'tests/device/ios/journeys.journey.ts › Journey 8b -- MAX_STUDENTS + 1 refused: the real localised message': 1,
};

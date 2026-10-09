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
  'tests/unit/upload-assets.test.ts › reads an empty store as empty, because that is what a first run sees': 1,
  'tests/guards/viewport-tagging.test.ts › accepts a page.viewportSize() read in a tagged test that resizes': 1,
  'tests/guards/viewport-tagging.test.ts › accepts the identical test once the tag is added': 1,
  'tests/guards/viewport-tagging.test.ts › attributes test.use({ viewport }) to its enclosing describe, both directions': 1,
  'tests/guards/viewport-tagging.test.ts › does not mistake a runtime test.skip(condition, reason) call for a new declaration': 1,
  'tests/guards/viewport-tagging.test.ts › ignores setViewportSize and a declaration-shaped call when they appear only in a comment': 1,
  'tests/guards/viewport-tagging.test.ts › is not fooled by a declaration spelled inside a string': 1,
  'tests/guards/viewport-tagging.test.ts › tolerates a wrapped title (test( on one line, the quoted title on the next)': 1,
  'tests/unit/workflow-jobs.test.ts › excuses the aggregate from asking for success in its condition': 1,
  'tests/unit/workflow-jobs.test.ts › lists GITHUB_TOKEN like any other secret, and none for a job reading none': 1,
  'tests/unit/workflow-jobs.test.ts › lists no scripts for a job with no steps': 1,
  'tests/unit/workflow-jobs.test.ts › reads a job-level uses: as the workflow the job calls': 1,
};

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
  'tests/unit/report.test.ts › %s: glory-points carries every leaf of site.glory and none of site.home': 1,
  'tests/unit/report.test.ts › a nonsense quote matches nothing on any page in any locale': 1,
  'tests/unit/report.test.ts › matches nothing for text that is not on the page': 2,
  'tests/unit/report.test.ts › no footer page offers the 404 copy': 1,
  'tests/unit/report.test.ts › offers only its own page: a home string is not found on glory-points': 1,
  'tests/unit/report.test.ts › refuses a fragment that spans a slot without being the whole message': 1,
  'tests/unit/report.test.ts › rule 2 counts Thai graphemes, not code points': 1,
  'tests/unit/report.test.ts › rule 2 refuses one character and accepts two': 1,
  'tests/unit/roster.test.ts › an absent student holding one side of a clash does not trigger it': 1,
  'tests/unit/roster.test.ts › an absent student still counts as holding their number, closing the gap': 1,
  'tests/unit/roster.test.ts › does not treat a roster starting above 1 as a gap': 1,
  'tests/unit/roster.test.ts › is quiet on a single-student roster, however it is numbered': 1,
  'tests/unit/roster.test.ts › is quiet on an empty roster': 2,
  'tests/unit/roster.test.ts › is quiet when a duplicate, not a gap, is what is wrong': 1,
  'tests/unit/roster.test.ts › is quiet when the numbers run without gaps': 1,
  'tests/unit/roster.test.ts › is quiet when the same apart letter is on students not kept together': 1,
  'tests/unit/roster.test.ts › returns nothing, promptly, for a range wider than MAX_ROSTER': 1,
  'tests/unit/roster.test.ts › warns up to the limit and stops beyond it': 1,
  'tests/unit/route-coverage.test.ts › does not read a route that only starts with the same letters': 1,
  'tests/unit/scoped-classes.test.ts › checks only what Astro scopes: not is:global, not is:inline, not :global()': 1,
  'tests/unit/scoped-classes.test.ts › recognises a class a script adds to an element the page built: %s': 1,
  'tests/unit/source-files.test.ts › names nothing when the two agree, in any order': 1,
  'tests/unit/source-text.test.ts › finds no CSS in a file with no style': 1,
  'tests/unit/source-text.test.ts › finds no code in a file with no frontmatter and no script': 1,
  'tests/unit/source-text.test.ts › finds none where comment syntax is quoted': 1,
  'tests/unit/translate-messages.test.ts › sends copy as it is, a message as its sentences, and a symbol not at all': 1,
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

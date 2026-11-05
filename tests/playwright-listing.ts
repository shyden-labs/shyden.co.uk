/**
 * A `playwright test --list` print, in the list-mode reporter's own shape:
 * each line is `[project] › file:line:col › titles`, then the `Total:` footer
 * `unitsOfListing` checks its count against. One home for the e2e shard plan's
 * tests and the floor record's shard tests (#608).
 *
 * @param lines the test lines, without their two-space indent
 * @param footer the total the footer reports, the line count unless given
 */
export function listing(lines: readonly string[], footer = lines.length) {
  const files = new Set(lines.map((l) => l.split(' › ')[1]!.split(':')[0]));
  return [
    'Listing tests:',
    ...lines.map((l) => `  ${l}`),
    `Total: ${footer} tests in ${files.size} files`,
    '',
  ].join('\n');
}

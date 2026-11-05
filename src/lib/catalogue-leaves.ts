/**
 * Every leaf in a copy table with its value, addressed by the dotted path the
 * i18n guards report: `errors.NO_STUDENTS`, `themes.animals[3]`,
 * `howToSteps[1]`.
 *
 * The one walk over a catalogue's shape. Seven private copies had grown across
 * the suites by #136, and they disagreed: one never entered arrays, another
 * spelled a position `a.0`. Which copy a guard reached for decided what it
 * could see -- #80's failure with directory walks, in a second medium -- so
 * `one-home.test.ts` keeps the walk here, and `catalogue-leaves.test.ts` pins
 * what it reads.
 *
 * An empty object or array contributes nothing. A caller that asserts absence
 * over the result proves it non-empty first (`nonEmpty`), because a walk that
 * returns `[]` satisfies every such assertion while reading nothing (#84).
 */
export function catalogueLeaves(
  table: unknown,
  path = '',
): Array<[string, unknown]> {
  if (Array.isArray(table))
    return table.flatMap((value, index) =>
      catalogueLeaves(value, `${path}[${index}]`),
    );
  if (table && typeof table === 'object')
    return Object.entries(table).flatMap(([key, value]) =>
      catalogueLeaves(value, path ? `${path}.${key}` : key),
    );
  return [[path, table]];
}

/**
 * The copy in a table: its string leaves. A message a page receives from
 * `getStrings` is a function, and neither a function nor a number is copy.
 */
export const stringLeaves = (table: unknown): Array<[string, string]> =>
  catalogueLeaves(table).filter(
    (leaf): leaf is [string, string] => typeof leaf[1] === 'string',
  );

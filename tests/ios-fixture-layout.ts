/**
 * The two layouts a JSON file under `tests/unit/fixtures/ios-inspector/` may
 * have, so the secrets guard (`tests/guards/ios-inspector-fixtures.test.ts`)
 * reads each one fully (#859). A capture of the wire holds `frames`, base64
 * the guard decodes. Recorded answers (the page driver's) are plain JSON with
 * exactly `source`, `note` and `answers`, read as text. Anything else is
 * refused rather than read as text, since an unknown layout could hide
 * encoded data the text scan cannot see.
 */
export type FixtureLayout = 'frames' | 'answers';

const ANSWER_KEYS = ['answers', 'note', 'source'];

export function fixtureLayout(file: string, parsed: unknown): FixtureLayout {
  if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) {
    if ('frames' in parsed) return 'frames';
    if (
      JSON.stringify(Object.keys(parsed).sort()) === JSON.stringify(ANSWER_KEYS)
    )
      return 'answers';
  }
  throw new Error(
    `${file} is neither a capture (frames) nor recorded answers (source, note, answers): the secrets check cannot read it`,
  );
}

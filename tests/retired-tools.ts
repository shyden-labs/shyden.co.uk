/**
 * The iPhone run no longer uses Safari's WebDriver server (#859): it held the
 * phone in Guided Access, which kills or refuses WebDriverAgent (Shyden's
 * ruling on #838, 2026-10-18). This finds any file whose code names it again.
 * Comments may still tell the history; JSON has no comments, so it is read
 * whole. The name is assembled, so this file and its tests do not spell it.
 */
import { withoutTsComments } from './unit/source-text';

export const RETIRED_TOOL = ['safari', 'driver'].join('');

/** The paths among `files` whose code (comments aside) names the retired tool. */
export function retiredToolHits(
  files: readonly { path: string; text: string }[],
): string[] {
  return files
    .filter(({ path, text }) =>
      (path.endsWith('.json') ? text : withoutTsComments(text))
        .toLowerCase()
        .includes(RETIRED_TOOL),
    )
    .map(({ path }) => path);
}

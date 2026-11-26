/**
 * A path a script takes on its command line, accepted only inside this
 * checkout (#1275).
 *
 * SonarCloud's S8707 flags every CLI path that reaches the filesystem
 * unchecked: a caller (a person, an agent, a workflow) could hand a script a
 * path that climbs out of the repository and have it read or overwrite a file
 * it was never meant to touch. Shyden ruled (2026-11-25) that a script accepts
 * a CLI path only inside the checkout, its git-ignored `.superpowers/`
 * included, and refuses any other with a message naming the path. Temp folders
 * elsewhere are not accepted, so tests that hand a script a scratch folder make
 * it inside the checkout.
 *
 * The check is the one SonarCloud's rule describes: resolve the path, then
 * require it to start with the checkout's folder followed by a separator, so a
 * sibling such as `shyden.co.uk-1275` is not read as inside `shyden.co.uk`.
 */

import path from 'node:path';
import { fileURLToPath } from 'node:url';

/** This checkout's folder: the one holding `scripts/`. */
export const CHECKOUT = path.dirname(
  path.dirname(fileURLToPath(import.meta.url)),
);

/**
 * The absolute form of `input`, read against the working directory, when it
 * lies inside `root`; otherwise a thrown refusal naming it.
 *
 * @param {string} input
 * @param {string} [root]
 * @returns {string}
 */
export const checkoutPath = (input, root = CHECKOUT) => {
  const resolved = path.resolve(input);
  if (!resolved.startsWith(root + path.sep)) {
    throw new Error(
      `${input} is outside this checkout (${root}), so it is refused: pass a path inside it, such as one under .superpowers/`,
    );
  }
  return resolved;
};

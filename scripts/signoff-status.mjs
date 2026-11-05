/**
 * Whether an evidence page's stored sign-off lets its ticket merge (#197).
 *
 * #188's approval was given on 12 journeys and kept reading "approved" after
 * the page was republished with a 13th. Reading the stored `verdict` by eye
 * before a merge cannot see that, and neither can `updatedAt`, which a write
 * that changed nothing moves too. This runs the page's own comparison
 * (`evidence-signoff.mjs`) over the page AS PUBLISHED and its stored sign-off:
 *
 *   Artifact      read, url=<page>, path=index.html   -> the page, saved locally
 *   ArtifactData  get, collection=signoff, doc_id=<ticket>, out_dir=<dir>
 *   node scripts/signoff-status.mjs <page.html> <dir>/signoff/<ticket>.json
 *
 * It prints one line and exits 0 only for an approval that covers exactly the
 * journeys the published page shows; any other verdict exits 1. A check that
 * cannot read its inputs gives no verdict at all: it exits 2.
 */
import { readFileSync } from 'node:fs';
import { journeysOfPage } from './build-evidence-page.mjs';
import { signOffOf, standingOf } from './evidence-signoff.mjs';
import { messageOf } from './errors.mjs';

/**
 * @typedef {object} Status
 * @property {boolean} merge the ticket may merge on this sign-off
 * @property {string} says one line naming the verdict, and why
 */

/**
 * @param {string} html the page as published
 * @param {unknown} stored the sign-off document as the store holds it
 * @returns {Status}
 */
export const signOffStatus = (html, stored) => {
  const journeys = journeysOfPage(html);
  const signOff = signOffOf(stored);
  const standing = standingOf(signOff, journeys);
  if (standing.verdict === null)
    return {
      merge: false,
      says: 'NO VERDICT: nothing has been decided on the page',
    };
  const given =
    standing.verdict === 'approved' ? 'approved' : 'more tests were asked for';
  if (standing.unrecorded)
    return {
      merge: false,
      says:
        `OUT OF DATE: ${given} without recording the journeys it covers, so ` +
        `it cannot be matched to the ${journeys.length} journeys on the ` +
        'published page',
    };
  if (standing.stale) {
    const changes = [
      ...(standing.added.length > 0
        ? [`added since: ${standing.added.map(shown).join(', ')}`]
        : []),
      ...(standing.removed.length > 0
        ? [`no longer on the page: ${standing.removed.map(shown).join(', ')}`]
        : []),
    ];
    return {
      merge: false,
      says: `OUT OF DATE: ${given} before the page changed; ${changes.join('; ')}`,
    };
  }
  if (standing.verdict === 'more')
    return {
      merge: false,
      says: signOff.note
        ? `MORE TESTS NEEDED: ${JSON.stringify(signOff.note)}`
        : 'MORE TESTS NEEDED, with no note',
    };
  return {
    merge: true,
    says: `SIGNED OFF: the approval covers all ${journeys.length} journeys on the published page`,
  };
};

/**
 * A journey id as printed. Every viewer writes the store, so an id that is not
 * a slug the builder could have made is printed quoted, escapes and all:
 * nothing stored reaches the terminal raw.
 *
 * @param {string} id
 */
const shown = (id) => (/^[a-z0-9-]+$/.test(id) ? id : JSON.stringify(id));

const USAGE =
  'usage: signoff-status.mjs <published page.html> <sign-off document.json>';

const main = () => {
  const [pagePath, docPath, ...extra] = process.argv.slice(2);
  /** @type {Status} */
  let status;
  try {
    if (!pagePath || !docPath || extra.length > 0) throw new Error(USAGE);
    status = signOffStatus(
      readFileSync(pagePath, 'utf8'),
      JSON.parse(readFileSync(docPath, 'utf8')),
    );
  } catch (error) {
    // No verdict from a check that could not read its inputs: 2 is neither
    // a sign-off nor an out-of-date one.
    console.error(`signoff-status: ${messageOf(error)}`);
    process.exit(2);
  }
  console.log(status.says);
  process.exitCode = status.merge ? 0 : 1;
};

if (import.meta.main) main();

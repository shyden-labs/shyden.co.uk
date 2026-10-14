/**
 * The release's judgement, checked against the release itself (#362).
 *
 * The inventory says WHICH commits change what a visitor receives; only a
 * person can say WHAT each one changes. That judgement lives in
 * `docs/releases/<base7>.json`. This module refuses it unless it covers every
 * visitor-facing commit, names no commit outside them, and cites only
 * journeys this run actually shows, so the page cannot describe a tree it was
 * not built for.
 */

import { esc, slugOf } from './build-evidence-page.mjs';

/**
 * @typedef {import('./release-inventory.mjs').Entry} Entry
 * @typedef {{ kind: 'visible', journeys: string[] } | { kind: 'gap', check: string } | { kind: 'none', reason: string }} Classification
 * @typedef {{ id: string, group: string, label: string }} Check
 * @typedef {object} Release
 * @property {string} base
 * @property {string} headline
 * @property {string} lede
 * @property {{ lede?: string, approve?: string }} signoff
 * @property {string} gapGroup
 * @property {Check[]} checks
 * @property {Record<string, unknown>} entries each commit's classification as
 *   the file gives it, untrusted until `changeMapOf` has checked it
 * @typedef {{ entry: Entry, classification: Classification, flagged: boolean | null }} Row
 * @typedef {object} ChangeMap
 * @property {Row[]} rows
 * @property {{ entries: number, visible: number, gap: number, none: number, flagged: number }} totals
 * @property {number} otherCommits
 * @property {[string, number][]} otherAreas
 */

/**
 * A release file as JSON gives it, checked field by field before anything
 * reads it. Every field here reaches the page the operator signs: a missing
 * headline would title it "undefined". `changeMapOf` checks the entries
 * themselves, against the release they describe.
 *
 * @param {unknown} value
 * @returns {Release}
 */
export const releaseOf = (value) => {
  /** @param {unknown} field */
  const isWords = (field) => typeof field === 'string' && field.trim() !== '';
  /** @param {unknown} field */
  const isObject = (field) =>
    typeof field === 'object' && field !== null && !Array.isArray(field);
  if (!isObject(value)) refuseRelease('is not an object');
  const file = /** @type {Record<string, unknown>} */ (value);
  for (const key of ['base', 'headline', 'lede', 'gapGroup'])
    if (!isWords(file[key])) refuseRelease(`${key} is not words`);
  const { checks, signoff, entries } = file;
  if (!Array.isArray(checks)) refuseRelease('checks is not a list');
  checks.forEach((check, i) => {
    for (const key of ['id', 'group', 'label'])
      if (!isWords(/** @type {Record<string, unknown>} */ (Object(check))[key]))
        refuseRelease(`checks[${i}].${key} is not words`);
  });
  if (!isObject(signoff)) refuseRelease('signoff is not an object');
  const said = /** @type {Record<string, unknown>} */ (signoff);
  for (const key of ['lede', 'approve'])
    if (key in said && !isWords(said[key]))
      refuseRelease(`signoff.${key} is not words`);
  if (!isObject(entries)) refuseRelease('entries is not an object');
  return /** @type {Release} */ (value);
};

/**
 * @param {string} what
 * @returns {never}
 */
function refuseRelease(what) {
  throw new Error(`release file: ${what}`);
}

/** @param {Entry} entry */
const named = (entry) => `${entry.sha} (${entry.subject})`;

/**
 * @param {object} input
 * @param {{ base: string, entries: Entry[] }} input.inventory
 * @param {Release} input.release
 * @param {ReadonlySet<string>} input.journeys the titles a row may cite
 * @param {ReadonlyMap<string, readonly string[]> | null} input.statuses every
 *   result's status per journey title, or null when checking a listing
 * @returns {ChangeMap}
 */
export const changeMapOf = ({ inventory, release, journeys, statuses }) => {
  if (release.base !== inventory.base)
    throw new Error(
      `release-map: the release file is for ${release.base}, the inventory starts at ${inventory.base}`,
    );
  const visitor = inventory.entries.filter((e) => e.visitorFacing);
  const known = new Set(visitor.map((e) => e.sha));
  for (const sha of Object.keys(release.entries))
    if (!known.has(sha))
      throw new Error(
        `release-map: ${sha} is classified but is not a visitor-facing commit of this release (stale)`,
      );

  // Every cited title this run does not hold, gathered across every entry and
  // refused together below: one refusal at a time took a capture per title
  // (#765, where 64 of them waited behind each other).
  /** @type {string[]} */
  const unknown = [];
  /** @type {Row[]} */
  const rows = visitor.map((entry) => {
    const given = release.entries[entry.sha];
    if (!given) throw new Error(`release-map: ${named(entry)} is unclassified`);
    // The file is untrusted, so each field is checked for its type as well as
    // its content: a reason of `{}` is not words, whatever String() makes of it.
    const {
      kind,
      reason,
      check,
      journeys: cited,
    } = typeof given === 'object'
      ? /** @type {Record<string, unknown>} */ (given)
      : {};
    if (kind === 'none') {
      if (typeof reason !== 'string' || !reason.trim())
        throw new Error(`release-map: ${named(entry)} gives no reason`);
      return { entry, classification: { kind, reason }, flagged: null };
    }
    if (kind === 'gap') {
      if (typeof check !== 'string' || !check.trim())
        throw new Error(`release-map: ${named(entry)} says nothing to check`);
      return { entry, classification: { kind, check }, flagged: null };
    }
    if (kind !== 'visible')
      throw new Error(
        `release-map: ${named(entry)} has kind ${JSON.stringify(kind)}, which is none of visible, gap and none`,
      );
    if (!Array.isArray(cited) || cited.length === 0)
      throw new Error(
        `release-map: ${entry.sha} is visible but cites no journey`,
      );
    /** @type {string[]} */
    const titles = [];
    for (const title of cited) {
      if (typeof title !== 'string' || !journeys.has(title))
        unknown.push(
          `  ${JSON.stringify(title)}, cited by ${entry.sha}, is not a journey of this run`,
        );
      else titles.push(title);
    }
    const flagged =
      statuses === null
        ? null
        : titles.some((title) => {
            const seen = statuses.get(title) ?? [];
            return (
              seen.some((s) => s !== 'passed' && s !== 'skipped') ||
              !seen.includes('passed')
            );
          });
    return { entry, classification: { kind, journeys: titles }, flagged };
  });
  if (unknown.length)
    throw new Error(
      `release-map: ${unknown.length} cited titles are not journeys of this run:\n${unknown.join('\n')}`,
    );

  /** @type {Map<string, number>} */
  const areas = new Map();
  for (const e of inventory.entries)
    if (!e.visitorFacing)
      for (const area of e.areas) areas.set(area, (areas.get(area) ?? 0) + 1);

  /** @param {Classification['kind']} kind */
  const count = (kind) =>
    rows.filter((r) => r.classification.kind === kind).length;
  return {
    rows,
    totals: {
      entries: rows.length,
      visible: count('visible'),
      gap: count('gap'),
      none: count('none'),
      flagged: rows.filter((r) => r.flagged === true).length,
    },
    otherCommits: inventory.entries.length - visitor.length,
    otherAreas: [...areas].sort(([a], [b]) => a.localeCompare(b)),
  };
};

/**
 * @param {ChangeMap} map
 * @returns {{ changeMap: string, others: string }}
 */
export const renderChangeMap = ({ rows, totals, otherCommits, otherAreas }) => {
  const body = rows
    .map(({ entry, classification, flagged }) => {
      const refs = [
        entry.pr === null ? '' : `PR #${entry.pr}`,
        entry.ticket === null ? '' : `#${entry.ticket}`,
      ]
        .filter(Boolean)
        .join(' · ');
      const what =
        classification.kind === 'visible'
          ? classification.journeys
              .map((t) => `<a href="#j-${esc(slugOf(t))}">${esc(t)}</a>`)
              .join('<br>')
          : classification.kind === 'gap'
            ? `<strong style="color:var(--alert)">Shown by no journey.</strong> ${esc(classification.check)}`
            : `No intended visible change: ${esc(classification.reason)}`;
      return (
        `<tr><td class="mono">${esc(entry.sha.slice(0, 7))}</td><td>${esc(refs)}</td>` +
        `<td>${esc(entry.subject)}</td><td>${flagged ? '<strong style="color:var(--alert)">Flagged: a journey below did not pass.</strong><br>' : ''}${what}</td></tr>`
      );
    })
    .join('');
  return {
    changeMap:
      `<p class="sub"><span class="mono">${totals.entries}</span> commits change what a visitor receives: ` +
      `<span class="mono">${totals.visible}</span> shown by journeys, <span class="mono">${totals.gap}</span> shown by none, ` +
      `<span class="mono">${totals.none}</span> with no intended visible change, <span class="mono">${totals.flagged}</span> flagged.</p>\n` +
      `<div class="mtx"><table><thead><tr><th>Commit</th><th>Refs</th><th>Subject</th><th>What shows it</th></tr></thead><tbody>${body}</tbody></table></div>`,
    others:
      `<p class="sub"><span class="mono">${otherCommits}</span> more commits change nothing a visitor receives. By area: ` +
      `${otherAreas.map(([area, n]) => `${esc(area)} <span class="mono">${n}</span>`).join(' · ')}</p>`,
  };
};

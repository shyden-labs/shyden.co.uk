/**
 * The content file for a release's evidence page (#362), written for the
 * builder that renders every ticket's page. It holds no release prose: every
 * word specific to a release comes from `docs/releases/<base7>.json`.
 *
 * Two modes. Building reads a capture's report and manifest, and refuses a
 * head whose `dev-verified` is not success, because the page describes the
 * tree on dev. `--check` validates the release file and writes nothing, so a
 * wrong citation surfaces before the content merges.
 *
 * `--check --manifest` reads the release's one capture (operator 2026-10-14,
 * #765: the code merges, the laptop captures once, then the content is
 * checked against that capture and merged). It refuses every cited title no
 * row of this run carries, all of them in one refusal, each with its entry.
 * A listing cannot say which tests capture: a looped test's case that
 * returns before its `shoot` runs, passes, and is listed, which let 64 such
 * citations through in v4 (#765; #362's `palette-controls` case before it).
 * So a check against a listing alone says so, and is refused unless
 * `--listing-only` asks for it by name.
 */

import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { parseArgs } from 'node:util';
import { capturesOfThisRun, flattenReport } from './build-evidence-page.mjs';
import { EVIDENCE_MANIFEST, EVIDENCE_REPORT } from './evidence-files.mjs';
import { inventoryFor } from './release-inventory.mjs';
import { changeMapOf, releaseOf, renderChangeMap } from './release-map.mjs';
import { messageOf } from './errors.mjs';

/**
 * Every test title a listing holds, as the builder writes a journey's title
 * (describes and test, the file dropped). A listing carries no results, so
 * `flattenReport`, which yields one row per result, cannot read it.
 *
 * @param {any} listing
 * @returns {Set<string>}
 */
export const listedTitles = (listing) => {
  /** @type {Set<string>} */
  const titles = new Set();
  /**
   * @param {any} suite
   * @param {string[]} path
   */
  const walk = (suite, path) => {
    for (const child of suite.suites ?? [])
      walk(child, child.title ? [...path, child.title] : path);
    for (const spec of suite.specs ?? [])
      titles.add([...path, spec.title].join(' > '));
  };
  for (const file of listing.suites ?? []) walk(file, []);
  return titles;
};

/**
 * What a listing-only check proves, said wherever one runs (#765).
 */
export const LISTING_CAVEAT =
  'a listing proves each cited title RUNS, not that it CAPTURES: check against the capture with --manifest <dir>/manifest.jsonl';

/**
 * @param {object} input
 * @param {import('./release-map.mjs').Release} input.release
 * @param {{ base: string, head: string, entries: import('./release-inventory.mjs').Entry[] }} input.inventory
 * @param {any} input.report the capture's report, or a listing when there is no manifest
 * @param {any[] | null} input.manifest the capture's manifest rows, or null for a listing-only check
 * @param {string | null} input.devVerified the head's dev-verified state
 * @param {boolean} [input.check] validate the release file and write nothing
 */
export const releaseContentOf = ({
  release,
  inventory,
  report,
  manifest,
  devVerified,
  check = false,
}) => {
  if (!check && manifest === null)
    throw new Error(
      "build-release-content: building reads a capture's manifest, and none was given",
    );
  if (!check && devVerified !== 'success')
    throw new Error(
      `build-release-content: ${inventory.head} reads dev-verified=${devVerified ?? 'absent'}; a release page describes a tree dev has verified`,
    );
  /** @type {Map<string, string[]>} */
  const statuses = new Map();
  if (!check)
    for (const row of flattenReport(report))
      statuses.set(row.title, [...(statuses.get(row.title) ?? []), row.status]);
  const map = changeMapOf({
    inventory,
    release,
    // A manifest is what a capture recorded, so it answers which titles
    // CAPTURE; a listing answers only which run (#765).
    journeys:
      manifest === null
        ? listedTitles(report)
        : new Set(
            capturesOfThisRun(manifest, report).current.map(
              (/** @type {{ title: string }} */ r) => r.title,
            ),
          ),
    statuses: check ? null : statuses,
  });
  if (check) return null;
  const { changeMap, others } = renderChangeMap(map);
  const head7 = inventory.head.slice(0, 7);
  return {
    title: release.headline,
    eyebrow: `Release ${inventory.base.slice(0, 7)} → ${head7}`,
    headline: release.headline,
    lede: release.lede,
    ids: [
      { label: 'Production', value: inventory.base },
      { label: 'Release head', value: inventory.head },
      { label: 'dev-verified', value: devVerified },
    ],
    sections: [
      { heading: 'What changes for a visitor', html: changeMap },
      { heading: 'Everything else in the release', html: others },
    ],
    checks: [
      ...release.checks,
      ...map.rows.flatMap(({ entry, classification }) =>
        classification.kind === 'gap'
          ? [
              {
                id: `gap-${entry.sha.slice(0, 7)}`,
                group: release.gapGroup,
                label: `${entry.subject}: ${classification.check}`,
              },
            ]
          : [],
      ),
    ],
    signoff: release.signoff,
    signoffKey: `release-${head7}`,
  };
};

const USAGE =
  'usage: build-release-content.mjs --release <file.json> --head <sha> (--evidence <dir> --out <content.json> | --check --manifest <dir>/manifest.jsonl | --check --listing <listing.json> --listing-only)';

/**
 * @typedef {{ release?: string, head?: string, evidence?: string, out?: string, check?: boolean, listing?: string, listingOnly?: boolean, manifest?: string }} Options
 */

/**
 * What the command line asks for (#765). A check reads a capture's manifest;
 * a check against a listing alone proves only that each title runs, so it is
 * refused unless `--listing-only` asks for exactly that.
 *
 * @param {Options} values
 * @returns {'build' | 'manifest' | 'listing' | 'listing-refused' | 'usage'}
 */
export const modeOf = (values) => {
  if (!values.release || !values.head) return 'usage';
  if (!values.check)
    return values.evidence &&
      values.out &&
      !values.listing &&
      !values.listingOnly &&
      !values.manifest
      ? 'build'
      : 'usage';
  if (values.evidence || values.out) return 'usage';
  if (values.manifest)
    return values.listing || values.listingOnly ? 'usage' : 'manifest';
  if (!values.listing) return 'usage';
  return values.listingOnly ? 'listing' : 'listing-refused';
};

/**
 * A capture's manifest, one JSON row per line.
 *
 * @param {string} file
 * @returns {any[]}
 */
const manifestRows = (file) =>
  readFileSync(file, 'utf8')
    .trim()
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line));

/** @param {string} sha */
const devVerifiedOf = (sha) => {
  const state = execFileSync(
    'gh',
    [
      'api',
      `repos/{owner}/{repo}/commits/${sha}/statuses`,
      '--jq',
      '[.[] | select(.context == "dev-verified")][0].state // ""',
    ],
    { encoding: 'utf8' },
  ).trim();
  return state === '' ? null : state;
};

const main = () => {
  /** @type {Options} */
  let values;
  try {
    const { values: given } = parseArgs({
      options: {
        release: { type: 'string' },
        head: { type: 'string' },
        evidence: { type: 'string' },
        out: { type: 'string' },
        check: { type: 'boolean' },
        listing: { type: 'string' },
        'listing-only': { type: 'boolean' },
        manifest: { type: 'string' },
      },
    });
    values = { ...given, listingOnly: given['listing-only'] };
  } catch (error) {
    console.error(`build-release-content: ${messageOf(error)}`);
    console.error(USAGE);
    process.exit(2);
  }
  const mode = modeOf(values);
  const { release: releaseFile, head } = values;
  // `modeOf` refuses both missing; read here too, so the checker sees it.
  if (mode === 'usage' || !releaseFile || !head) {
    console.error(USAGE);
    process.exit(2);
  }
  if (mode === 'listing-refused') {
    console.error(`build-release-content: ${LISTING_CAVEAT}`);
    console.error(
      'build-release-content: pass --listing-only to run the weaker check by name',
    );
    process.exit(2);
  }
  try {
    const release = releaseOf(JSON.parse(readFileSync(releaseFile, 'utf8')));
    const inventory = inventoryFor({
      base: release.base,
      head,
      git: (args) =>
        execFileSync('git', args, {
          encoding: 'utf8',
          maxBuffer: 256 * 1024 * 1024,
        }),
    });
    if (mode === 'listing') {
      releaseContentOf({
        release,
        inventory,
        report: JSON.parse(readFileSync(values.listing ?? '', 'utf8')),
        manifest: null,
        devVerified: null,
        check: true,
      });
      console.log(
        `build-release-content: ${values.release} holds for ${inventory.head}, as a listing: ${LISTING_CAVEAT}`,
      );
      return;
    }
    if (mode === 'manifest') {
      // The report beside the manifest tells this run's rows from an earlier
      // run's, as building does: a capture directory gains rows run by run.
      const dir = dirname(values.manifest ?? '');
      releaseContentOf({
        release,
        inventory,
        report: JSON.parse(readFileSync(join(dir, EVIDENCE_REPORT), 'utf8')),
        manifest: manifestRows(values.manifest ?? ''),
        devVerified: null,
        check: true,
      });
      console.log(
        `build-release-content: ${values.release} holds for ${inventory.head}: every cited journey captured in ${values.manifest}`,
      );
      return;
    }
    const dir = values.evidence ?? '';
    const content = releaseContentOf({
      release,
      inventory,
      report: JSON.parse(readFileSync(join(dir, EVIDENCE_REPORT), 'utf8')),
      manifest: manifestRows(join(dir, EVIDENCE_MANIFEST)),
      devVerified: devVerifiedOf(inventory.head),
    });
    writeFileSync(values.out ?? '', `${JSON.stringify(content, null, 2)}\n`);
    console.log(`build-release-content: wrote ${values.out}`);
  } catch (error) {
    console.error(messageOf(error));
    process.exit(1);
  }
};

if (import.meta.main) main();

#!/usr/bin/env node
/**
 * Turn one evidence run into the interactive page an operator signs off.
 *
 * The standing rule (operator, 2026-08-22) is a screenshot per ASSERTION and a
 * video per JOURNEY, presented as a page he ticks through before anything
 * merges -- because green CI has meant nothing three times. `tests/e2e/
 * evidence.ts` captures that material during the run; this renders it.
 *
 * TWO PROPERTIES THIS FILE EXISTS TO KEEP
 *
 * 1. NO TICKET PROSE LIVES HERE. Every word specific to a ticket -- headline,
 *    lede, sections, the mutation ledger -- arrives in a content file. The
 *    first of these pages was built by hand for #96 with its wording inline;
 *    reused as-is, it would have described the wrong feature with total
 *    confidence. `tests/guards/evidence-page.test.ts` asserts this file contains
 *    none of the prose it renders, derived from the example content rather
 *    than a blocklist somebody has to remember to extend.
 *
 * 2. NOTHING IS SILENTLY DROPPED. A page missing captures the operator was
 *    told it contains is worse than no page: it looks like proof of assertions
 *    nobody can see. A manifest entry with no image is a THROW, not a gap.
 *
 * Everything structural -- engines, journeys, assertion order -- is derived
 * from Playwright's JSON report and the capture manifest rows that report's run
 * wrote, never an earlier run's (#171). A sixth engine, or a spec that runs on
 * fewer, is reflected without touching this code.
 */

import { readFileSync, writeFileSync, existsSync, statSync } from 'node:fs';
import { isAbsolute, join } from 'node:path';
import { parseArgs } from 'node:util';
import { die, messageOf } from './errors.mjs';
import { EVIDENCE_MANIFEST, EVIDENCE_REPORT } from './evidence-files.mjs';
import { signOffOf, standingOf } from './evidence-signoff.mjs';

/**
 * @param {unknown} s
 */
export const esc = (s) =>
  String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

/**
 * Every spec result in the report, flattened, each carrying its FULL title
 * path -- the describes and the test, exactly as `tests/e2e/evidence.ts`'s
 * `shoot` writes one (`info.titlePath.slice(1).join(' > ')`, the file dropped).
 *
 * This used to emit `spec.title`, the leaf alone, and discard the describe
 * titles sitting right there in the suite nesting. Everything downstream then
 * keyed a journey by that leaf, so **two tests sharing a leaf title in
 * different describes were one journey**: their captures pooled into a single
 * strip and the per-engine results took whichever spec matched first. Measured
 * on a 7-spec run -- 275 distinct leaf titles, 5 used twice, every pair an
 * English block and its Indonesian counterpart -- a page would have shown one
 * journey wearing two languages' evidence, and nothing about it would have
 * looked wrong (#263). The published-path map was the only thing that noticed,
 * because it alone demanded a unique path, and it refused the whole build. That
 * map is gone since #268 -- an asset is keyed by the raw key, which is unique by
 * construction -- so this rule is the only thing standing between a page and
 * that collision now.
 *
 * The file-level suite's own title is NOT included: `shoot` drops it, and the
 * two formats have to agree by construction rather than by a heuristic that
 * repairs one into the other.
 *
 * @param {any} report
 */
export const flattenReport = (report) => {
  /** @type {{ title: string, block: string, project: string, status: string, duration: number, file: string, video: string | undefined }[]} */
  const out = [];
  /**
   * @param {any} suite
   * @param {string[]} ancestors
   * @param {string} file The spec file this suite came from. Only the top-level
   *   (file) suite carries one, so it is threaded down to the describes.
   */
  const walk = (suite, ancestors, file) => {
    for (const child of suite.suites || [])
      walk(child, child.title ? [...ancestors, child.title] : ancestors, file);
    for (const spec of suite.specs || [])
      for (const t of spec.tests)
        for (const r of t.results)
          out.push({
            title: [...ancestors, spec.title].filter(Boolean).join(' > '),
            // The describes this journey sits in, joined the same way the
            // title is. Taken from the ancestors ARRAY rather than by
            // splitting the joined title, because a test whose own title
            // contains ` > ` would otherwise be read as a block boundary
            // that does not exist.
            block: ancestors.filter(Boolean).join(' > '),
            project: t.projectName,
            status: r.status,
            duration: r.duration,
            // The spec FILE a journey came from. Since #214 a recording is
            // opt-in per spec, so "no recording" means one of two different
            // things and the page must not spell them the same way.
            file: spec.file ?? file,
            video: (r.attachments || []).find(
              (/** @type {{ name: string }} */ a) => a.name === 'video',
            )?.path,
          });
  };
  // Each top-level entry is a FILE; its children are the describes.
  for (const suite of report.suites || []) walk(suite, [], suite.file);
  return out;
};

/** An instant exactly as `Date.prototype.toISOString` writes one. */
const ISO_INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

/**
 * Milliseconds since the epoch, or NaN for anything that is not an ISO instant.
 *
 * Never `Date.parse` alone: it reads "0" as midnight on 1 January 2000 and
 * "2026" as that year's first instant, so a mangled start time would date an
 * earlier run's rows as this run's.
 *
 * @param {unknown} value
 */
const instantOf = (value) =>
  typeof value === 'string' && ISO_INSTANT.test(value)
    ? Date.parse(value)
    : Number.NaN;

/**
 *  `webkit 15, firefox 2`: rows counted by engine, in first-seen order.
 *
 * @param {any[]} rows
 */
const byEngine = (rows) => {
  const counts = new Map();
  for (const row of rows)
    counts.set(row.project, (counts.get(row.project) ?? 0) + 1);
  return [...counts].map(([engine, n]) => `${engine} ${n}`).join(', ');
};

/**
 * The manifest rows the reported run wrote, and the ones an earlier run left.
 *
 * `tests/e2e/evidence.ts` APPENDS to the manifest and nothing clears it, so a
 * second run into one evidence directory kept the first run's rows: webkit,
 * then chromium, built a page embedding 15 webkit captures under a report that
 * ran chromium alone (#171). Each row is stamped as it is written, and a run's
 * rows are those stamped at or after its report's `stats.startTime`, which
 * Playwright takes as the run is configured -- before the web server starts,
 * so before any capture.
 *
 * Set aside, never deleted: an earlier run's files stay where they are, and
 * the caller names what was left out. A row with no stamp predates stamping,
 * so it is an earlier run's by definition. What cannot be dated is refused
 * rather than guessed at: a report with no readable start, a stamp that is not
 * an instant, and a manifest in which nothing is the run's own.
 *
 * @param {any[]} manifest
 * @param {any} report
 */
export const capturesOfThisRun = (manifest, report) => {
  const startTime = report.stats?.startTime;
  const start = instantOf(startTime);
  if (Number.isNaN(start))
    throw new Error(
      `build-evidence-page: ${EVIDENCE_REPORT} has no readable stats.startTime ` +
        `(${JSON.stringify(startTime)}), so no capture can be told apart from ` +
        "an earlier run's. Refusing to guess.",
    );

  /** @type {any[]} */
  const current = [];
  const earlier = [];
  for (const row of manifest) {
    if (row.at === undefined) {
      earlier.push(row);
      continue;
    }
    const at = instantOf(row.at);
    if (Number.isNaN(at))
      throw new Error(
        `build-evidence-page: ${EVIDENCE_MANIFEST} stamps ${row.file} with ` +
          `${JSON.stringify(row.at)}, which is not an instant. Refusing to ` +
          'guess which run captured it.',
      );
    (at >= start ? current : earlier).push(row);
  }

  if (!current.length)
    throw new Error(
      `build-evidence-page: nothing in ${EVIDENCE_MANIFEST} was captured by ` +
        `the run ${EVIDENCE_REPORT} describes, which started ${startTime}` +
        (earlier.length
          ? `; its ${earlier.length} row(s) are an earlier run's: ${byEngine(earlier)}`
          : '') +
        '. Refusing to emit a page with no evidence of this run. Capture ' +
        'again, into this directory or a fresh one.',
    );
  return { current, earlier };
};

/**
 * What the build line adds about an earlier run: how many rows were set aside,
 * and from which engines. Without it, a page built from part of a directory
 * reads exactly like one built from all of it.
 *
 * @param {any} earlier
 */
export const earlierLine = (earlier) =>
  earlier.length
    ? ` EARLIER=${earlier.length} (captured before this run started): ` +
      byEngine(earlier)
    : '';

/**
 * @param {string} s
 */
export const slugOf = (s) =>
  String(s)
    .replace(/[^a-z0-9]+/gi, '-')
    .replace(/^-+|-+$/g, '')
    .toLowerCase();

/**
 * Every recording the report names, resolved -- or a refusal naming each one
 * the disk does not have.
 *
 * A dangling path is lost evidence, not a smaller page. Playwright wrote the
 * videos into `test-results/`, the next ordinary run cleared that directory as
 * it started, and this skipped all 25 missing files and built anyway: every
 * journey read "0 of 5 engines embedded", indistinguishable from a budget
 * decision (#165). A result with NO recording attached is not a loss -- an
 * ordinary run records nothing.
 *
 * @param {any} report
 */
export const videoCandidates = (report) => {
  const candidates = [];
  const missing = [];
  for (const s of flattenReport(report)) {
    if (!s.video) continue;
    const abs = isAbsolute(s.video) ? s.video : join(process.cwd(), s.video);
    if (!existsSync(abs)) {
      missing.push(`"${s.title}" on ${s.project}: ${abs}`);
      continue;
    }
    // No size is carried: a recording is published, not inlined, so there is no
    // base64 inflation to charge, and `assertPublishLimits` reads each file's
    // size off the disk it publishes from. A second number here is one that can
    // drift from the file it describes.
    candidates.push({
      key: `${slugOf(s.title)}|${s.project}`,
      abs,
    });
  }
  if (missing.length)
    throw new Error(
      `build-evidence-page: ${EVIDENCE_REPORT} names ${missing.length} ` +
        `recording(s) that are not on disk:\n  ${missing.join('\n  ')}\n` +
        'Refusing to emit a page without the recordings its report claims. ' +
        'Capture again: Playwright clears its output directory when a run ' +
        'starts, so a recording kept outside the evidence directory does not ' +
        'survive the next run.',
    );
  return candidates;
};

/**
 * The one spelling of the directory recordings are published into.
 *
 * `reconcileFiles` clears this namespace and nothing else, so the prefix that
 * BUILDS a published path is the same prefix that AUTHORISES its removal. Two
 * spellings would be two namespaces the day one of them moved -- and the failure
 * is a removal rule that stops matching, which looks exactly like a capture with
 * nothing to remove.
 */
export /**
 * Where an EARLIER capture published its recordings as supporting files.
 *
 * Nothing writes this prefix any more -- recordings went to the asset store in
 * #268 -- but `reconcileFiles` still has to REMOVE what earlier captures left
 * under it. A path left out of a redeploy's map is kept, not removed, so
 * dropping this constant with the route that wrote it would strand every
 * recording ever published this way against the 255-entry ceiling.
 */
const PUBLISHED_PREFIX = 'evidence/';

/** Where the artifact serves a stored asset, in every view (#268). */
const BLOB_PREFIX = '/_blob/';

/**
 * A byte count in megabytes, as every ceiling in this file reports one. One
 * home: it was declared inside `assertPublishLimits`, and the asset ceilings
 * below report the same way (#80).
 *
 * @param {number} n
 * @returns {string}
 */
const mb = (n) => `${(n / 1048576).toFixed(2)}MB`;

/**
 * What one artifact's ASSET STORE holds, measured against the real runtime on
 * 2026-09-22 with the prediction recorded first (#268).
 *
 * The store reports its own limits: `25 files, 2350 of 1073741824 bytes used
 * (limit 5000 files)`. Set against a publish's 255 entries and 64 MB, this is
 * not a tighter budget to economise against -- it is a different one, with
 * roughly nineteen times the entries. Six specs produce 199 recordings and
 * seven produce 280, so #263's AC6 could not be met on published files at all.
 *
 * Literals, deliberately. A value derived from the code it guards moves with
 * the code and asserts nothing about the platform (#117); these are pinned
 * against the measurement and `tests/guards/evidence-page.test.ts` pins them
 * again, so a platform change is a red test rather than a refused publish.
 */
export const ASSET_MAX_FILES = 5000;
export const ASSET_MAX_BYTES = 1073741824;
export const ASSET_MAX_FILE_BYTES = 20 * 1024 * 1024;

/**
 * Every recording to upload: the journey it belongs to -> the file on disk.
 *
 * ONE COLLISION CLASS IS RETIRED AND ONE IS NOT, and the difference is worth
 * stating because the first draft of this function got it wrong.
 *
 * Retired: the published path slugged the key into a FILENAME and joined
 * journey and engine on the separator the key itself uses, so `a-b|c` and
 * `a|b-c` both became `a-b-c.webm`. Nothing is slugged here, so two distinct
 * keys cannot meet.
 *
 * NOT retired: the key is `slugOf(title)|project` and `videoCandidates`
 * returns an ARRAY, so two journeys whose titles slug the same way -- `a
 * journey` and `a-journey` -- arrive as two candidates under ONE key. A Map
 * would keep the last in silence, filing one journey's recording under
 * another's claim, which is the hazard this whole file exists to remove. It is
 * more likely since #263 made a key the full title path, describes included.
 * So the refusal moved here rather than being deleted with the path that used
 * to carry it.
 *
 * Accumulated in a Map, not an object literal: `'constructor' in {}` is true,
 * so a journey slugged to a prototype member would report a collision that is
 * not there.
 *
 * @param {{ key: string, abs: string }[]} candidates
 * @returns {Record<string, string>}
 */
export const assetUploads = (candidates) => {
  const uploads = new Map();
  const collisions = [];
  for (const { key, abs } of candidates) {
    const taken = uploads.get(key);
    if (taken === undefined) uploads.set(key, abs);
    else collisions.push(`${key}: ${taken} and ${abs}`);
  }
  if (collisions.length)
    throw new Error(
      `build-evidence-page: ${collisions.length} journey key(s) claimed by ` +
        `more than one recording:\n  ${collisions.join('\n  ')}\n` +
        'Two journeys whose titles slug the same way share a key, and keeping ' +
        "the last would pair one journey's assertion with another journey's " +
        'recording. Nothing about that page would look wrong.',
    );
  return Object.fromEntries(uploads);
};

/**
 * The `src` the page points at for each planned asset, from the map the upload
 * answered with. `what` names the kind in every refusal: recordings and
 * screenshots (#368) are checked the same way and told apart in what it says.
 *
 * Checked in BOTH directions, because each failure is silent in its own way. A
 * planned recording missing from the map renders a journey with no source,
 * which reads exactly like one that was never recorded. An entry in the map
 * that no recording asked for is a stale map from an earlier run, and pairing
 * a current journey with an older recording is the hazard this file exists to
 * prevent -- nothing about the page would look wrong.
 *
 * @param {{ uploaded: Record<string, string>, candidates: { key: string, abs: string }[], what: string }} input
 * @returns {Map<string, string>}
 */
export const assetSrcs = ({ uploaded, candidates, what }) => {
  const wanted = new Set(candidates.map(({ key }) => key));
  const missing = candidates.filter(({ key }) => !Object.hasOwn(uploaded, key));
  if (missing.length)
    throw new Error(
      `build-evidence-page: ${missing.length} ${what}(s) were planned but ` +
        `never uploaded:\n  ${missing.map(({ key }) => key).join('\n  ')}\n` +
        `A journey with no source reads as one whose ${what} was never taken. ` +
        'Run the upload again, or rebuild the plan.',
    );
  const extra = Object.keys(uploaded).filter((key) => !wanted.has(key));
  if (extra.length)
    throw new Error(
      `build-evidence-page: ${extra.length} uploaded asset(s) belong to no ` +
        `${what} in this run:\n  ${extra.join('\n  ')}\n` +
        "That is a map from an earlier run. Pairing this run's journeys " +
        `with an earlier run's ${what}s would look entirely normal.`,
    );
  for (const [key, path] of Object.entries(uploaded))
    if (!path.startsWith(BLOB_PREFIX))
      throw new Error(
        `build-evidence-page: ${key} resolves to ${path}, which is not a ` +
          `${BLOB_PREFIX} path. An asset is served at ${BLOB_PREFIX}<id> in ` +
          'every view; anything else is a link off the artifact.',
      );
  return new Map(candidates.map(({ key }) => [key, uploaded[key]]));
};

/**
 * The recordings' `src`s, as #268 built them: `assetSrcs` naming its kind.
 *
 * @param {{ uploaded: Record<string, string>, candidates: { key: string, abs: string }[] }} input
 * @returns {Map<string, string>}
 */
export const assetVideoPaths = ({ uploaded, candidates }) =>
  assetSrcs({ uploaded, candidates, what: 'recording' });

/** The key prefix a screenshot is planned, uploaded and looked up under. */
export const SHOT_PREFIX = 'shot:';

/**
 * This run's screenshots as asset-store candidates (#368), one per captured
 * file, keyed `shot:<manifest file>`. Inlined as base64 they made the #362
 * release page 104.74 MB against the 16 MB a document carries; beside the
 * recordings in the store, the page holds a path per shot. Their keys cannot
 * meet a recording's, which is a journey slug and an engine joined by `|`.
 *
 * @param {{ file: string }[]} manifest this run's rows only
 * @param {string} dir the evidence directory the files are relative to
 * @returns {{ key: string, abs: string }[]}
 */
export const shotCandidates = (manifest, dir) =>
  [...new Set(manifest.map(({ file }) => file))].map((file) => ({
    key: `${SHOT_PREFIX}${file}`,
    abs: join(dir, file),
  }));

/**
 * A run whose recordings the asset store could not hold is refused before
 * anything is uploaded, rather than part-way through the eleventh call.
 *
 * @param {{ uploads: Record<string, string>, sizeOf: (source: string) => number }} input
 * @returns {void}
 */
export const assertAssetLimits = ({ uploads, sizeOf }) => {
  const sources = Object.values(uploads);
  const over = [];
  if (sources.length > ASSET_MAX_FILES)
    over.push(
      `${sources.length} assets, over the ${ASSET_MAX_FILES} one artifact holds`,
    );
  const sized = sources.map(
    (/** @type {string} */ source) =>
      /** @type {[string, number]} */ ([source, sizeOf(source)]),
  );
  for (const [source, bytes] of sized)
    if (bytes > ASSET_MAX_FILE_BYTES)
      over.push(
        `${source} at ${mb(bytes)}, over the ${mb(ASSET_MAX_FILE_BYTES)} one asset allows`,
      );
  const total = sized.reduce((n, [, bytes]) => n + bytes, 0);
  if (total > ASSET_MAX_BYTES)
    over.push(
      `${mb(total)} in total, over the ${mb(ASSET_MAX_BYTES)} one artifact holds`,
    );
  if (over.length)
    throw new Error(
      `build-evidence-page: the upload would carry ${over.join('; and ')}. ` +
        'Refusing to start an upload the store would reject part-way.',
    );
};

/**
 * The files a publish carries, with the previous capture's leftovers removed.
 *
 * A path left OUT of a redeploy's `files` map is kept, not removed -- the
 * opposite of what "publish" suggests. So a second capture leaves the first
 * capture's recordings in place, and two things follow: orphans accumulate
 * against the 64 MB and 255-entry ceilings until a publish is refused, and a
 * journey whose id survives a re-capture while its recording does not ends up
 * showing YESTERDAY'S video beside TODAY'S assertion. Nothing about that page
 * looks wrong, which makes it worse than one that drops a recording honestly.
 *
 * The removals are therefore explicit: `null` against every published path this
 * capture did not produce -- but ONLY inside `PUBLISHED_PREFIX`. The published
 * listing is everything the artifact serves, the page itself included, so
 * "remove whatever this capture did not produce" reads as correct and deletes
 * `index.html` with it. `preflight.js` at the artifact root is reserved, and a
 * publish that nulls it is refused outright. The recordings are the only thing
 * this builder owns.
 *
 * @param {{ desired: Record<string, string>, published: string[] }} args
 * @returns {Record<string, string | null>}
 */
export const reconcileFiles = ({ desired, published }) => {
  const files = { ...desired };
  for (const path of published)
    if (path.startsWith(PUBLISHED_PREFIX) && !Object.hasOwn(desired, path))
      /** @type {Record<string, string | null>} */ (files)[path] = null;
  return files;
};

/** Entries one publish may carry. A removal occupies one of these. */
export const PUBLISH_MAX_FILES = 255;

/** Bytes one publish may carry, across every file with content in it. */
export const PUBLISH_MAX_BYTES = 64 * 1024 * 1024;

/**
 * Refuse a file map the publish could not carry, naming what is over.
 *
 * A REMOVAL IS STILL AN ENTRY. `{path: null}` carries no bytes and occupies one
 * of the 255 slots, so a capture that clears a previous one spends two slots for
 * every journey whose recording changed. A guard counting only the entries with
 * content passes here and the publish is refused anyway -- reassuring and wrong,
 * and the failure arrives after the build reported success.
 *
 * Loudly, because silence is the defect this ticket exists to remove: #146 was
 * filed for a page that quietly held less than the operator was told it did, and
 * a ceiling discovered at publish time is that same failure moved one step
 * later.
 *
 * BOTH ceilings are reported in ONE refusal. Thrown in sequence, the first stops
 * the second, so a publish over both would name only its entry count -- and
 * whoever trimmed files to satisfy it would be refused again on bytes, by a
 * message that never mentioned them. A guard can be red for a true reason and
 * still send the diagnosis the wrong way (PR #156).
 *
 * @param {{
 *   files: Record<string, string | null>,
 *   sizeOf: (source: string) => number,
 * }} args
 */
export const assertPublishLimits = ({ files, sizeOf }) => {
  const entries = Object.keys(files);
  let bytes = 0;
  let removals = 0;
  for (const path of entries) {
    const source = files[path];
    if (source === null) removals += 1;
    else bytes += sizeOf(source);
  }
  const carried = entries.length - removals;
  /** @param {number} n */

  const over = [];
  if (entries.length > PUBLISH_MAX_FILES)
    over.push(
      `${entries.length} entries (${carried} with content, ${removals} ` +
        `removals), over the ${PUBLISH_MAX_FILES} one publish allows`,
    );
  if (bytes > PUBLISH_MAX_BYTES)
    over.push(
      `${mb(bytes)} across ${carried} file(s), over the ` +
        `${mb(PUBLISH_MAX_BYTES)} one publish allows`,
    );
  if (over.length)
    throw new Error(
      `build-evidence-page: the publish would carry ${over.join('; and ')}. ` +
        'Refusing to build a page whose publish would be refused.',
    );
};

/** Bytes one published document may carry, its inline media included. */
export const PAGE_MAX_BYTES = 16 * 1024 * 1024;

/**
 * Refuse a page too large to publish, naming both sizes.
 *
 * NEVER a smaller page. The old build met a tight budget by emitting less and
 * reporting it on a line nobody reads, so the operator was handed a page that
 * looked complete and held less than he was told (#146, and again at a
 * different capture scope in #189). With the recordings published beside it the
 * page holds shots alone, and there is no honest reason to drop an assertion
 * shot -- so not fitting is a build failure. `DROPPED=` cannot appear on a
 * successful build any more because the concept is gone, not guarded.
 *
 * @param {number} bytes
 */
export const assertPageFits = (bytes) => {
  if (bytes > PAGE_MAX_BYTES)
    throw new Error(
      `build-evidence-page: the page is ${(bytes / 1048576).toFixed(2)}MB, ` +
        `over the ${(PAGE_MAX_BYTES / 1048576).toFixed(2)}MB one published ` +
        'document may carry. Refusing to write a page that cannot be ' +
        'published: narrow the capture scope, or lower EVIDENCE_JPEG_QUALITY.',
    );
};

/**
 * The release checks a page carries beside its journeys (#362). Each is a tick
 * in the same sign-off, so it is marked up exactly as the page script finds a
 * journey: a `j-` row holding an `h3` (read by `linkTo`, toggled `done`) and a
 * `chk-` box carrying `data-journey` (bound, and looked up before counting).
 * Its id joins `JOURNEYS`, so a verdict covers it and `journeysOfPage` reads
 * it back. A ticket's page carries none, and renders exactly as before.
 *
 * @param {unknown} checks `content.checks`
 * @param {ReadonlySet<string>} journeyIds the journeys on this page
 * @returns {{ ids: string[], html: string }}
 */
export const checksOf = (checks, journeyIds) => {
  if (checks === undefined) return { ids: [], html: '' };
  if (!Array.isArray(checks))
    throw new Error('build-evidence-page: content.checks must be a list');
  /** @type {string[]} */
  const ids = [];
  /** @type {Map<string, string[]>} */
  const groups = new Map();
  for (const check of checks) {
    const { id, group, label } = check ?? {};
    if (
      typeof id !== 'string' ||
      !/^[a-z0-9-]+$/.test(id) ||
      typeof group !== 'string' ||
      group === '' ||
      typeof label !== 'string' ||
      label === ''
    )
      throw new Error(
        'build-evidence-page: a check needs an id of lowercase letters, ' +
          `digits and hyphens, a group and a label; got ${JSON.stringify(check)}`,
      );
    const key = `check-${id}`;
    if (ids.includes(key))
      throw new Error(`build-evidence-page: the check "${id}" appears twice`);
    if (journeyIds.has(key))
      throw new Error(
        `build-evidence-page: the check "${id}" has the id of a journey on this page, "${key}"`,
      );
    ids.push(key);
    const row =
      `<li class="check" id="j-${esc(key)}"><label class="tick">` +
      `<input type="checkbox" id="chk-${esc(key)}" data-journey="${esc(key)}">` +
      '<span class="tickbox" aria-hidden="true"></span>' +
      `<span class="sr">Checked: ${esc(label)}</span></label>` +
      `<h3>${esc(label)}</h3></li>`;
    groups.set(group, [...(groups.get(group) ?? []), row]);
  }
  return {
    ids,
    html: [...groups]
      .map(
        ([group, rows]) =>
          `<h2>${esc(group)}</h2>\n<ul class="checks">${rows.join('')}</ul>`,
      )
      .join('\n'),
  };
};

/**
 * The page, as a string. Pure: every input is passed in, nothing is read here.
 *
 * @param {{ manifest: any[], report: any, content: any, shots: Map<string, any>, dims?: Map<string, any>, videos?: Map<string, string> }} input
 */
export const renderEvidencePage = ({
  manifest,
  report,
  content,
  shots,
  dims = new Map(),
  videos = new Map(),
}) => {
  const specs = flattenReport(report);

  // A journey with no recording is either a spec that never ASKED for one --
  // the default since #214 -- or a recording that went astray (#165). Those
  // are different facts: the first is the policy working, the second is
  // evidence missing, and a page that spells both "not embedded" tells the
  // operator nothing about which he is looking at.
  //
  // Derived from the report itself rather than from the spec sources or a
  // list: a BLOCK RECORDS when any result of its own carries a video. There
  // is no second statement of the policy that could drift from the first.
  //
  // The BLOCK, not the file (#292). A spec opts in as a whole -- one
  // `test.use(recorded)` at the top -- so a file-keyed policy answers for
  // every journey in it, and a block that renders nothing (reading bytes out
  // of `dist/`, never navigating) came back as a recording that went astray:
  // #165's wording on #214's fact, which is the very confusion #214 exists to
  // stop. Operator decision 2026-09-22: derive the finer key from the report,
  // rather than state the policy a second time in an annotation.
  //
  // Keyed by file AND block, because two files may name a block alike.
  const blockKey = (/** @type {{ file: string, block: string }} */ s) =>
    `${s.file}\u0000${s.block}`;
  const recordingBlocks = new Set(
    specs.filter((s) => s.video).map((s) => blockKey(s)),
  );
  const specEntryOf = new Map(specs.map((s) => [s.title, s]));
  /** @param {string} title */
  const noRecordingNote = (title) => {
    // `order` is built from the manifest AND the report, so a title the report
    // never mentioned carries no spec file and there is no recording policy to
    // read. Answering "not recorded by policy" there asserts a policy this page
    // never saw: the defect #214 exists to stop, one level further in, a third
    // fact wearing the second's words.
    //
    // `has`, not `get() === undefined`: a journey the report DOES carry whose
    // entry has no file is still a spec that did not ask to be recorded, and
    // the two cases are only distinguishable through the key.
    if (!specEntryOf.has(title)) return 'no test result';
    const entry = specEntryOf.get(title);
    return entry !== undefined &&
      entry.file !== undefined &&
      recordingBlocks.has(blockKey(entry))
      ? 'recording missing'
      : 'not recorded by policy';
  };

  // Derived, in first-seen order, so the page reflects the run rather than a
  // list somebody kept in step by hand.
  /** @type {string[]} */
  const engines = [];
  for (const s of specs)
    if (!engines.includes(s.project)) engines.push(s.project);
  for (const m of manifest)
    if (!engines.includes(m.project)) engines.push(m.project);

  // Captures first, so a page keeps the order its assertions were taken in,
  // then every journey the report names that captured nothing.
  //
  // Derived from the manifest ALONE, this list omitted any test that asserted
  // without calling `shoot()` -- while `video` is `on` for the whole run
  // whenever `EVIDENCE_DIR` is set, so that test IS recorded and the upload
  // stores its recording regardless. Full scope measured 120 recordings
  // published and 100 referenced: 20 files served to a page that named their
  // journeys nowhere, and four journeys that ran on five engines -- `no console
  // errors on load` among them -- absent from the coverage an operator signs
  // off. The dead entries are the smaller half; a page quietly narrower than
  // its run is the failure.
  // Both sides now spell a journey the same way, so neither is repaired into
  // the other. The `slice(1)` that used to strip a describe off the manifest
  // title, and the `endsWith(' > ' + short)` that matched it back, were what
  // made a duplicate leaf ambiguous -- a suffix match cannot tell two
  // describes apart (#263).
  /** @type {string[]} */
  const order = [];
  for (const m of manifest) if (!order.includes(m.title)) order.push(m.title);
  for (const s of specs) if (!order.includes(s.title)) order.push(s.title);

  const missing = manifest.filter(
    (/** @type {{ file: string }} */ m) => !shots.has(m.file),
  );
  if (missing.length)
    throw new Error(
      `build-evidence-page: missing image data for ${missing.length} captured ` +
        `assertion(s), first ${missing[0].file}. Refusing to emit a page that ` +
        'claims evidence it does not carry.',
    );

  const journeys = order.map((title) => {
    const rows = manifest.filter(
      (/** @type {{ title: string }} */ m) => m.title === title,
    );
    const orders = [
      ...new Set(rows.map((/** @type {{ order: number }} */ r) => r.order)),
    ].sort((/** @type {number} */ a, /** @type {number} */ b) => a - b);
    return {
      id: slugOf(title),
      title,
      assertions: orders.map((n) => ({
        order: n,
        label:
          rows.find((/** @type {{ order: number }} */ r) => r.order === n)
            ?.label ?? '',
        shots: engines.map((e) =>
          rows.find(
            (/** @type {{ project: string, order: number }} */ r) =>
              r.project === e && r.order === n,
          ),
        ),
      })),
      results: engines.map((e) =>
        specs.find((s) => s.project === e && s.title === title),
      ),
    };
  });
  const checks = checksOf(content.checks, new Set(journeys.map((j) => j.id)));
  const signoff = content.signoff ?? {};

  const stats = report.stats || {};
  /** @param {{ status?: string } | undefined} r */
  const dot = (r) =>
    `<span class="dot ${r?.status === 'passed' ? 'ok' : 'bad'}" title="${esc(r?.status ?? 'not run')}"></span>`;

  const journeyHtml = journeys
    .map(
      (j) => `
<section class="journey" id="j-${esc(j.id)}">
  <header class="j-head">
    <label class="tick">
      <input type="checkbox" id="chk-${esc(j.id)}" data-journey="${esc(j.id)}">
      <span class="tickbox" aria-hidden="true"></span>
      <span class="sr">Reviewed: ${esc(j.title)}</span>
    </label>
    <div class="j-title">
      <h3>${esc(j.title)}</h3>
      <p class="j-meta"><span class="mono">${j.assertions.length}</span> assertions &times;
        <span class="mono">${engines.length}</span> engines &middot;
        ${j.results.map((r, k) => `<span class="eng">${dot(r)}<span class="mono">${esc(engines[k])}</span> <span class="mono dim">${r ? r.duration + 'ms' : '&mdash;'}</span></span>`).join('')}
      </p>
    </div>
  </header>
  ${j.assertions
    .map(
      (a) => `
  <div class="assertion">
    <p class="a-label"><span class="mono num">${String(a.order).padStart(2, '0')}</span> ${esc(a.label)}</p>
    <div class="strip">
      ${a.shots
        .map((s, k) =>
          s
            ? `<figure class="shot"><img loading="lazy"${dims.get(s.file) ? ` width="${dims.get(s.file).w}" height="${dims.get(s.file).h}"` : ''} src="${shots.get(s.file)}" alt="${esc(s.label)} &mdash; ${esc(s.project)}"><figcaption class="mono">${esc(s.project)}</figcaption></figure>`
            : `<figure class="shot absent"><div class="novid mono">not captured</div><figcaption class="mono">${esc(engines[k])}</figcaption></figure>`,
        )
        .join('')}
    </div>
  </div>`,
    )
    .join('')}
  <details class="videos">
    <summary>Journey recordings (${engines.filter((e) => videos.has(`${j.id}|${e}`)).length} of ${engines.length} engines embedded)</summary>
    <div class="vgrid">
      ${engines
        .map((e) =>
          videos.has(`${j.id}|${e}`)
            ? `<figure><video controls preload="none" src="${videos.get(`${j.id}|${e}`)}"></video><figcaption class="mono">${esc(e)}</figcaption></figure>`
            : `<figure class="absent"><div class="novid mono">${esc(noRecordingNote(j.title))}</div><figcaption class="mono">${esc(e)}</figcaption></figure>`,
        )
        .join('')}
    </div>
  </details>
</section>`,
    )
    .join('');

  const idsHtml = (content.ids || [])
    .map(
      (/** @type {{ label: string, value: string }} */ i) =>
        `<span><b>${esc(i.label)}</b> ${esc(i.value)}</span>`,
    )
    .join('');
  const sectionsHtml = (content.sections || [])
    .map(
      (/** @type {{ heading: string, body?: string, html?: string }} */ s) =>
        s.html !== undefined
          ? `<h2>${esc(s.heading)}</h2>\n${s.html}`
          : `<h2>${esc(s.heading)}</h2>\n<p class="sub">${s.body}</p>`,
    )
    .join('\n');
  const mutationsHtml = (content.mutations || [])
    .map(
      (/** @type {Record<string, string>} */ m) =>
        `<tr><td>${esc(m.id)}</td><td>${m.what}</td><td class="pred">${esc(m.predicted)}</td><td class="act">${esc(m.actual)}</td></tr>`,
    )
    .join('');

  return `<title>${esc(content.title)}</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@500;700&family=Inter:wght@400;500;600&family=JetBrains+Mono:wght@400;600&display=swap">
<style>
:root{
  --ground:#f7f6f2; --surface:#ffffff; --raise:#fbfaf7;
  --ink:#16171c; --ink-soft:#565a66; --rule:#e7e4dc;
  --accent:#0a7d66; --accent-ink:#096452; --alert:#c0392b; --on-accent:#ffffff;
  --shadow:0 1px 2px rgba(22,23,28,.05);
  --head:'Space Grotesk',system-ui,sans-serif;
  --body:'Inter',system-ui,sans-serif;
  --mono:'JetBrains Mono',ui-monospace,SFMono-Regular,monospace;
}
@media (prefers-color-scheme:dark){:root:not([data-theme="light"]){
  --ground:#131519; --surface:#1a1e23; --raise:#20252b;
  --ink:#ecebe6; --ink-soft:#9ba1a9; --rule:#2b3138;
  --accent:#54cfb0; --accent-ink:#7fdcc3; --alert:#f0857a; --on-accent:#0d1114;
  --shadow:0 1px 2px rgba(0,0,0,.4);
}}
:root[data-theme="dark"]{
  --ground:#131519; --surface:#1a1e23; --raise:#20252b;
  --ink:#ecebe6; --ink-soft:#9ba1a9; --rule:#2b3138;
  --accent:#54cfb0; --accent-ink:#7fdcc3; --alert:#f0857a; --on-accent:#0d1114;
  --shadow:0 1px 2px rgba(0,0,0,.4);
}
*{box-sizing:border-box}
body{margin:0;background:var(--ground);color:var(--ink);font-family:var(--body);line-height:1.55;-webkit-text-size-adjust:100%}
.wrap{max-width:1080px;margin:0 auto;padding-inline:20px;padding-block:0 72px}
.mono{font-family:var(--mono);font-variant-numeric:tabular-nums}
.dim{color:var(--ink-soft)}
.sr{position:absolute;width:1px;height:1px;margin:-1px;overflow:hidden;clip-path:inset(50%)}
h1,h2,h3{font-family:var(--head);text-wrap:balance;margin:0}
a{color:var(--accent-ink)}

/* masthead */
.mast{padding-block:44px 28px;border-bottom:2px solid var(--ink)}
.eyebrow{font-family:var(--mono);font-size:.72rem;letter-spacing:.14em;text-transform:uppercase;color:var(--accent-ink);margin:0 0 10px}
h1{font-size:clamp(1.8rem,1.2rem+2.6vw,2.7rem);font-weight:700;letter-spacing:-.02em}
.lede{max-width:62ch;color:var(--ink-soft);margin:12px 0 0;font-size:1.02rem}
.ids{display:flex;flex-wrap:wrap;gap:8px 18px;margin-top:18px;font-family:var(--mono);font-size:.78rem;color:var(--ink-soft)}
.ids b{color:var(--ink);font-weight:600}

/* verdict */
.verdict{display:grid;grid-template-columns:repeat(auto-fit,minmax(132px,1fr));gap:1px;background:var(--rule);border:1px solid var(--rule);margin-top:26px}
.vc{background:var(--surface);padding:14px 16px}
.vc .n{font-family:var(--head);font-size:1.7rem;font-weight:700;letter-spacing:-.02em;display:block;font-variant-numeric:tabular-nums}
.vc .k{font-family:var(--mono);font-size:.68rem;letter-spacing:.1em;text-transform:uppercase;color:var(--ink-soft)}
.vc.good .n{color:var(--accent-ink)}

h2{font-size:1.22rem;font-weight:500;letter-spacing:-.01em;margin:44px 0 4px}
.sub{color:var(--ink-soft);font-size:.92rem;margin:0 0 16px;max-width:64ch}

/* matrix */
.mtx{overflow-x:auto;border:1px solid var(--rule);background:var(--surface)}
table{border-collapse:collapse;width:100%;min-width:600px}
th,td{text-align:left;padding:9px 12px;border-bottom:1px solid var(--rule);font-size:.85rem}
th{font-family:var(--mono);font-size:.68rem;letter-spacing:.08em;text-transform:uppercase;color:var(--ink-soft);font-weight:600;white-space:nowrap}
tbody tr:last-child td{border-bottom:0}
td.j{font-size:.84rem}
.dot{display:inline-block;width:9px;height:9px;border-radius:50%;background:var(--accent);vertical-align:middle}
.dot.bad{background:var(--alert)}

/* mutation ledger */
.led td:first-child{font-family:var(--mono);font-weight:600;color:var(--accent-ink);white-space:nowrap}
.led .pred{color:var(--ink-soft)}
.led .act{font-family:var(--mono);font-weight:600}
.led code{font-family:var(--mono);font-size:.86em;background:var(--raise);padding:1px 4px;border-radius:3px}

/* journeys */
.journey{border:1px solid var(--rule);background:var(--surface);margin-top:14px}
.j-head{display:flex;gap:14px;align-items:flex-start;padding:16px 18px;border-bottom:1px solid var(--rule);background:var(--raise)}
.j-title h3{font-size:1rem;font-weight:500}
.j-meta{margin:6px 0 0;font-size:.76rem;color:var(--ink-soft);display:flex;flex-wrap:wrap;gap:4px 12px;align-items:center}
.eng{display:inline-flex;align-items:center;gap:5px}
.tick{position:relative;flex:none;cursor:pointer;display:block;padding-top:2px}
.tick input{position:absolute;opacity:0;width:26px;height:26px;margin:0;cursor:pointer}
.tickbox{display:block;width:26px;height:26px;border:1.5px solid var(--ink-soft);border-radius:5px;background:var(--surface);transition:background .12s,border-color .12s}
.tick input:checked+.tickbox{background:var(--accent);border-color:var(--accent)}
.tick input:checked+.tickbox::after{content:'';position:absolute;left:9px;top:7px;width:6px;height:12px;border:solid var(--on-accent);border-width:0 2.5px 2.5px 0;transform:rotate(42deg)}
.tick input:focus-visible+.tickbox{outline:2px solid var(--accent-ink);outline-offset:2px}
.journey.done{border-color:var(--accent)}
.checks{list-style:none;margin:0 0 28px;padding:0;border:1px solid var(--rule);border-radius:10px;background:var(--surface)}
.check{display:flex;gap:14px;align-items:flex-start;padding:14px 18px;border-top:1px solid var(--rule)}
.check:first-child{border-top:0}
.check h3{font-family:var(--body);font-size:1rem;font-weight:500;line-height:1.45}
.check.done h3{color:var(--ink-soft)}

.assertion{padding:14px 18px;border-bottom:1px solid var(--rule)}
.a-label{margin:0 0 10px;font-size:.88rem}
.num{color:var(--accent-ink);font-weight:600;font-size:.78rem;margin-right:6px}
.strip{display:flex;gap:10px;overflow-x:auto;padding-bottom:4px}
.shot{margin:0;flex:none;width:190px}
.shot img{display:block;width:100%;max-width:100%;height:auto;border:1px solid var(--rule);border-radius:4px;background:var(--ground);cursor:zoom-in}
.shot figcaption{font-size:.66rem;color:var(--ink-soft);margin-top:4px}

.videos{padding:12px 18px}
.videos summary{cursor:pointer;font-size:.82rem;color:var(--ink-soft);font-family:var(--mono)}
.vgrid{display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:12px;margin-top:12px}
.vgrid video{width:100%;max-width:100%;border:1px solid var(--rule);border-radius:4px;background:#000}
.vgrid figure{margin:0}
.vgrid figcaption{font-size:.68rem;color:var(--ink-soft);margin-top:4px}
.novid{display:grid;place-items:center;aspect-ratio:16/10;max-width:100%;border:1px dashed var(--rule);border-radius:4px;color:var(--ink-soft);font-size:.7rem}

/* sign-off */
.signoff{border:2px solid var(--ink);background:var(--surface);padding:22px;margin-top:44px}
.signoff h2{margin-top:0}
.count{font-family:var(--mono);font-size:.82rem;color:var(--ink-soft);margin:0 0 14px}
.choices{display:flex;flex-wrap:wrap;gap:10px;margin:16px 0}
button{font:inherit;font-family:var(--head);font-weight:500;padding:11px 18px;border-radius:6px;border:1.5px solid var(--ink);background:var(--surface);color:var(--ink);cursor:pointer;min-height:44px}
button:focus-visible{outline:2px solid var(--accent-ink);outline-offset:2px}
button[aria-pressed="true"]{background:var(--accent);border-color:var(--accent)}
button[aria-pressed="true"]{color:var(--on-accent)}
textarea{width:100%;max-width:100%;font:inherit;font-size:.92rem;padding:11px;border:1px solid var(--rule);border-radius:6px;background:var(--ground);color:var(--ink);min-height:88px;resize:vertical}
.standing:not(:empty){border:2px solid var(--alert);background:var(--raise);padding:12px 14px;margin:16px 0}
.standing p{margin:0 0 6px}
.standing p:last-child{margin-bottom:0}
.standing strong{color:var(--alert)}
.standing a{color:var(--accent-ink)}
.standing code{font-family:var(--mono);font-size:.9em}
.state{font-family:var(--mono);font-size:.78rem;color:var(--ink-soft);margin-top:12px}
.state.saved{color:var(--accent-ink)}

/* lightbox */
#lb{position:fixed;inset:0;background:rgba(10,12,14,.92);display:none;place-items:center;z-index:50;padding:18px}
#lb.on{display:grid}
#lb img{max-width:100%;max-height:86vh;border-radius:4px}
#lb p{color:#e8e6e0;font-family:var(--mono);font-size:.76rem;margin:12px 0 0;text-align:center;max-width:70ch}
@media (prefers-reduced-motion:reduce){*{transition:none!important;animation:none!important}}
@media (max-width:520px){.j-head{flex-wrap:wrap}.shot{width:150px}}
</style>

<div class="wrap">
<header class="mast">
  <p class="eyebrow">${esc(content.eyebrow ?? '')}</p>
  <h1>${esc(content.headline ?? content.title)}</h1>
  <p class="lede">${content.lede ?? ''}</p>
  <div class="ids">${idsHtml}</div>
  <div class="verdict">
    <div class="vc good"><span class="n">${stats.expected ?? 0}</span><span class="k">passed</span></div>
    <div class="vc"><span class="n">${stats.unexpected ?? 0}</span><span class="k">failed</span></div>
    <div class="vc"><span class="n">${stats.flaky ?? 0}</span><span class="k">flaky</span></div>
    <div class="vc"><span class="n">${stats.skipped ?? 0}</span><span class="k">skipped</span></div>
    <div class="vc"><span class="n">${manifest.length}</span><span class="k">assertion shots</span></div>
    <div class="vc"><span class="n">${((stats.duration ?? 0) / 1000).toFixed(1)}s</span><span class="k">wall clock</span></div>
  </div>
</header>

${sectionsHtml}

${
  mutationsHtml
    ? `<h2>Guards proven by breaking them</h2>
<p class="sub">Each mutation's expected result was written down <em>before</em> the run. A mutation judged after seeing the output confirms nothing.</p>
<div class="mtx"><table class="led">
<thead><tr><th>#</th><th>What was broken</th><th>Predicted</th><th>Actual</th></tr></thead>
<tbody>${mutationsHtml}</tbody>
</table></div>`
    : ''
}

<h2>Engine matrix</h2>
<div class="mtx"><table>
<thead><tr><th>Journey</th>${engines.map((e) => `<th>${esc(e)}</th>`).join('')}</tr></thead>
<tbody>${journeys.map((j) => `<tr><td class="j">${esc(j.title)}</td>${j.results.map((r) => `<td>${dot(r)} <span class="mono dim">${r ? r.duration + 'ms' : '&mdash;'}</span></td>`).join('')}</tr>`).join('')}</tbody>
</table></div>

<h2>Every assertion, as it ran</h2>
<p class="sub">Each image was captured immediately after the assertion above it passed, during the run &mdash; not reconstructed afterwards. Playwright stops a test at its first failed expectation, so a present image <em>is</em> the result. Tap any image to enlarge, and tick a journey once you are satisfied it proves what it claims.</p>
${journeyHtml}

${checks.html}
<section class="signoff" id="signoff">
  <h2 style="margin-top:0">Sign-off</h2>
  <p class="count" id="progress">0 of ${journeys.length + checks.ids.length} ${checks.ids.length ? 'journeys and checks' : 'journeys'} reviewed</p>
  <p class="sub">Nothing merges on green CI alone. ${signoff.lede !== undefined ? esc(signoff.lede) : 'This ticket progresses only on your explicit decision below.'}</p>
  <div class="standing" id="standing" role="status"></div>
  <div class="choices">
    <button type="button" id="btn-approve" aria-pressed="false">${signoff.approve !== undefined ? esc(signoff.approve) : 'Signed off &mdash; may merge to develop'}</button>
    <button type="button" id="btn-more" aria-pressed="false">More tests needed</button>
  </div>
  <label for="note" class="sub" style="display:block;margin-bottom:6px">Notes, or what else you want covered</label>
  <textarea id="note"></textarea>
  <p class="state" id="state" role="status">Loading saved state&hellip;</p>
  ${content.notCovered ? `<p class="sub" style="margin-top:18px"><strong>Not covered by this page:</strong> ${content.notCovered}</p>` : ''}
</section>
</div>

<div id="lb" role="dialog" aria-modal="true" aria-label="Enlarged screenshot"><div><img id="lb-img" alt=""><p id="lb-cap"></p></div></div>

<script>
(function () {
  'use strict';
  // The stored sign-off's shape, and where its verdict stands against this
  // page's journeys, embedded by their own source text: the unit tests and the
  // pre-merge check run these same functions (evidence-signoff.mjs, #197).
  ${signOffOf.toString()}
  ${standingOf.toString()}
  var JOURNEYS = ${JSON.stringify([...journeys.map((j) => j.id), ...checks.ids])};
  var REVIEWED = ${JSON.stringify(checks.ids.length ? ' journeys and checks reviewed' : ' journeys reviewed')};
  var DOC = 'signoff/' + ${JSON.stringify(content.signoffKey ?? 'ticket')};
  var JOURNEY_KEY = 'journey:';
  var READY = 'Ready. Your ticks and decision are saved as you make them.';
  var SAVED = 'Saved. Your decision persists on this page.';
  var LOCAL = 'Ticks are local to this view \u2014 storage is not available here.';
  var NOT_SAVED = 'Not saved \u2014 this view cannot reach storage. Your ticks are visible but will not persist.';
  var NOT_LOADED = 'Not saved yet \u2014 the saved sign-off has not loaded.';
  // The stored sign-off as this view last received it, always as the page's
  // OWN copy: the runtime delivers snapshots frozen, and a page that keeps one
  // as its state drops every later edit without an error (#172).
  var server = signOffOf(undefined);
  // Edits no completed write has carried yet, keyed 'journey:<id>', 'verdict',
  // 'verdictCovers' and 'note'. The page shows the server copy with these laid
  // over it, so no snapshot, early or late, can repaint an edit away.
  var pending = Object.create(null);
  var db = null, storageAbsent = false, loaded = false, saveTimer = null;
  var stateEl = document.getElementById('state');
  var progressEl = document.getElementById('progress');
  var noteEl = document.getElementById('note');
  var approve = document.getElementById('btn-approve');
  var more = document.getElementById('btn-more');
  var standingEl = document.getElementById('standing');
  // What the out-of-date notice last said. It is a live region, so it is
  // rebuilt only when that changes: a rebuild on every tick would be
  // announced again on every tick.
  var shownStanding = '';
  function say(m, ok) { stateEl.textContent = m; stateEl.className = 'state' + (ok ? ' saved' : ''); }
  function codeOf(e) { return e && typeof e.code === 'string' ? e.code : 'unknown'; }
  function hasPending() { return Object.keys(pending).length > 0; }
  function overlay(target, edits) {
    Object.keys(edits).forEach(function (key) {
      if (key.indexOf(JOURNEY_KEY) === 0) target.journeys[key.slice(JOURNEY_KEY.length)] = edits[key];
      else target[key] = edits[key];
    });
    return target;
  }
  function view() { return overlay(signOffOf(server), pending); }
  function paragraph(parts) {
    var p = document.createElement('p');
    parts.forEach(function (part) {
      p.appendChild(typeof part === 'string' ? document.createTextNode(part) : part);
    });
    standingEl.appendChild(p);
  }
  function listed(nodes) {
    var parts = [];
    nodes.forEach(function (node, at) {
      if (at > 0) parts.push(', ');
      parts.push(node);
    });
    return parts;
  }
  function linkTo(id) {
    var link = document.createElement('a');
    var section = document.getElementById('j-' + id);
    var heading = section ? section.querySelector('h3') : null;
    link.href = '#j-' + id;
    link.textContent = heading ? heading.textContent : id;
    return link;
  }
  // A removed journey is named by the id the shared store holds, so it is
  // written as text and never parsed as markup.
  function idOf(id) {
    var code = document.createElement('code');
    code.textContent = id;
    return code;
  }
  function showStanding(standing) {
    var said = JSON.stringify(standing);
    if (said === shownStanding) return;
    shownStanding = said;
    while (standingEl.firstChild) standingEl.removeChild(standingEl.firstChild);
    if (!standing.stale) return;
    var signedOff = standing.verdict === 'approved';
    var lead = document.createElement('strong');
    lead.textContent = signedOff ? 'Your sign-off is out of date.' : 'Your decision is out of date.';
    var onPage = JOURNEYS.length === 1 ? 'the 1 journey' : 'the ' + JOURNEYS.length + ' journeys';
    if (standing.unrecorded) {
      paragraph([lead, ' It was saved before ' + (signedOff ? 'sign-offs' : 'decisions') +
        ' recorded the journeys they cover, so it cannot be matched to ' + onPage + ' on this page.']);
    } else {
      paragraph([lead, signedOff ? ' You signed off before this page changed.' : ' You asked for more tests before this page changed.']);
      if (standing.added.length > 0) paragraph(['Added since: '].concat(listed(standing.added.map(linkTo)), ['.']));
      if (standing.removed.length > 0) paragraph(['No longer on the page: '].concat(listed(standing.removed.map(idOf)), ['.']));
    }
    paragraph([
      (standing.unrecorded ? 'Review them, then ' : 'Review what changed, then ') +
        (signedOff ? 'press “' + approve.textContent + '” again.' : 'decide again.')
    ]);
  }
  function paint() {
    var shown = view(), done = 0;
    var standing = standingOf(shown, JOURNEYS);
    JOURNEYS.forEach(function (id) {
      var box = document.getElementById('chk-' + id);
      if (!box) return;
      var on = shown.journeys[id] === true;
      box.checked = on;
      var sec = document.getElementById('j-' + id);
      if (sec) sec.classList.toggle('done', on);
      if (on) done++;
    });
    progressEl.textContent = done + ' of ' + JOURNEYS.length + REVIEWED;
    // A verdict shows as given only while it covers exactly these journeys.
    approve.setAttribute('aria-pressed', String(standing.verdict === 'approved' && !standing.stale));
    more.setAttribute('aria-pressed', String(standing.verdict === 'more' && !standing.stale));
    showStanding(standing);
    if (document.activeElement !== noteEl) noteEl.value = shown.note;
  }
  function schedule() {
    say('Saving\u2026', false);
    clearTimeout(saveTimer);
    saveTimer = setTimeout(save, 400);
  }
  function change(edits) {
    Object.keys(edits).forEach(function (key) { pending[key] = edits[key]; });
    paint();
    if (storageAbsent) { say(NOT_SAVED, false); return; }
    // set() replaces the whole document, so nothing is written before the
    // stored sign-off has loaded: an early write would erase it.
    if (!loaded) { say(NOT_LOADED, false); return; }
    schedule();
  }
  function save() {
    saveTimer = null;
    var carried = Object.assign(Object.create(null), pending);
    var body = view();
    body.updatedAt = new Date().toISOString();
    db.doc(DOC).set(body).then(function () {
      // The store now holds what this write carried. Once a subscription has
      // ended nothing echoes it back, so the server copy takes it from here.
      overlay(server, carried);
      Object.keys(carried).forEach(function (key) {
        if (pending[key] === carried[key]) delete pending[key];
      });
      paint();
      if (!hasPending() && saveTimer === null) say(SAVED, true);
    }, function (e) {
      say('Could not save: ' + codeOf(e), false);
    });
  }
  function receive(snap) {
    server = signOffOf(snap.data());
    if (!loaded) {
      loaded = true;
      if (hasPending()) schedule();
      else say(READY, true);
    }
    paint();
  }
  function markStorageAbsent() {
    storageAbsent = true;
    say(LOCAL, false);
  }
  // Giving a verdict records the journeys it is given on (#197), and pressing
  // the one already given, while it still covers this page, withdraws it.
  // Nothing else writes that list, so a tick or a note on an out-of-date page
  // cannot renew an approval.
  function decide(verdict) {
    var standing = standingOf(view(), JOURNEYS);
    var withdraw = standing.verdict === verdict && !standing.stale;
    change({ verdict: withdraw ? null : verdict, verdictCovers: withdraw ? null : JOURNEYS.slice() });
  }
  document.querySelectorAll('input[data-journey]').forEach(function (box) {
    box.addEventListener('change', function () {
      var edit = {};
      edit[JOURNEY_KEY + box.dataset.journey] = box.checked;
      change(edit);
    });
  });
  approve.addEventListener('click', function () { decide('approved'); });
  more.addEventListener('click', function () { decide('more'); });
  noteEl.addEventListener('input', function () { change({ note: noteEl.value }); });
  var lb = document.getElementById('lb'), lbImg = document.getElementById('lb-img'), lbCap = document.getElementById('lb-cap');
  document.addEventListener('click', function (e) {
    var img = e.target.closest ? e.target.closest('.shot img') : null;
    if (img) { lbImg.src = img.src; lbImg.alt = img.alt; lbCap.textContent = img.alt; lb.classList.add('on'); return; }
    if (lb.classList.contains('on')) lb.classList.remove('on');
  });
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape') lb.classList.remove('on'); });
  paint();
  if (!window.claude || typeof window.claude.use !== 'function') { markStorageAbsent(); return; }
  window.claude.use('db').then(function (handle) {
    if (!handle) { markStorageAbsent(); return; }
    db = handle;
    var ref = db.doc(DOC);
    ref.get().then(receive, function (e) {
      // A read can fail after live updates have already loaded the sign-off.
      if (!loaded) say('Could not load the saved sign-off (' + codeOf(e) + '). Ticks are not saved until it loads.', false);
    });
    // Pass the error callback: without one, a subscription that ends is an
    // uncaught error. It speaks once the sign-off has loaded; before that, the
    // read's own failure is the one to report.
    ref.onSnapshot(receive, function (e) {
      if (loaded) say('Live updates stopped (' + codeOf(e) + '). Reload to see changes made elsewhere.', false);
    });
  }, markStorageAbsent);
})();
</script>`;
};

/**
 * The journey ids a rendered page declares, in page order, read from the one
 * line of its script that declares them (`var JOURNEYS = [...]`, above). The
 * pre-merge check reads the page as PUBLISHED, so it learns the journeys from
 * the page itself and never from a rebuild that may differ from it (#197).
 *
 * @param {string} html
 * @returns {string[]}
 */
export const journeysOfPage = (html) => {
  const lists = [...html.matchAll(/\bvar JOURNEYS = (\[[^\]\n]*\]);/g)];
  if (lists.length !== 1)
    throw new Error(
      `journeysOfPage: the page declares ${lists.length} journey lists, ` +
        'where an evidence page declares exactly one',
    );
  /** @type {unknown} */
  const ids = JSON.parse(lists[0]?.[1] ?? '');
  if (!Array.isArray(ids) || !ids.every((id) => typeof id === 'string'))
    throw new Error('journeysOfPage: the journey list is not a list of ids');
  // The builder refuses a run that captured nothing, so every evidence page
  // declares a journey. Read as a page, an empty list would let an approval
  // that covers nothing cover all of it and read as signed off.
  if (ids.length === 0)
    throw new Error('journeysOfPage: the page declares no journeys');
  return ids;
};

/**
 * What the publish has to grant, said out loud at build time.
 *
 * The page writes the ticks and the verdict through `claude.use('db')`, which
 * resolves `null` unless the PUBLISH declared the `db` capability. The page
 * then degrades honestly -- "ticks are local to this view" -- which reads as a
 * quirk rather than as "nothing you decide here is recorded". #138's page was
 * published that way first: the operator's sign-off would have been kept
 * nowhere and could not have been read back.
 *
 * The declaration is an argument to the publish, so nothing in this repo can
 * enforce it. Printing it is what stops the next person having to remember.
 */
export const PUBLISH_NOTE =
  'publish with capabilities {"db": {}, "assets": {}} — without db ' +
  "claude.use('db') resolves null, the page says \"ticks are local to this " +
  'view", and the sign-off is recorded NOWHERE; without assets the upload is ' +
  'refused and every journey references a recording nothing stored, which ' +
  'reads as one never recorded. A page declaring assets is ' +
  'organization-internal and can never be made public (operator decision, ' +
  '2026-09-22, #268).';

/** What the upload pass has to do, said out loud by `--plan`. */
export const UPLOAD_NOTE =
  'upload each of these to the artifact with asset: true (25 per call), then ' +
  'write {"<key>": "/_blob/<id>"} and pass it as --assets. The key is the ' +
  'journey and engine, not the filename: matching on filenames is how a ' +
  "current journey gets paired with an earlier run's recording.";

/**
 * What a capture actually is, read from its own first bytes.
 *
 * Never from the extension and never hardcoded: an image whose bytes are not
 * the type it claims paints nothing, and a page of blank frames looks exactly
 * like a page of captures that failed. Every screenshot is checked here before
 * the page is built, though since #368 the asset store serves it rather than
 * a data URI. An unrecognised format is a THROW for
 * the same reason a manifest entry with no image is -- silence here is
 * indistinguishable from evidence.
 *
 * @param {Buffer} bytes a node Buffer: `readUInt16BE` and friends are
 *   Buffer methods, not Uint8Array ones, and this reads image headers.
 */
export const mediaType = (bytes) => {
  if (
    bytes.length >= 8 &&
    bytes.readUInt32BE(0) === 0x89504e47 &&
    bytes.readUInt32BE(4) === 0x0d0a1a0a
  )
    return 'image/png';
  if (
    bytes.length >= 3 &&
    bytes.readUInt16BE(0) === 0xffd8 &&
    bytes[2] === 0xff
  )
    return 'image/jpeg';
  throw new Error(
    `build-evidence-page: unrecognised capture format, first bytes ` +
      `${bytes.subarray(0, 4).toString('hex')}. Refusing to emit a src the ` +
      'browser cannot paint.',
  );
};

/** Markers that stand alone: TEM and the eight restart markers carry NO length. */
const STANDALONE = new Set([
  0x01, 0xd0, 0xd1, 0xd2, 0xd3, 0xd4, 0xd5, 0xd6, 0xd7,
]);

/**
 *  SOFn, excluding DHT (C4), JPG (C8) and DAC (CC), which share the range.
 *
 * @param {number} marker
 */
const isFrameHeader = (marker) =>
  marker >= 0xc0 &&
  marker <= 0xcf &&
  marker !== 0xc4 &&
  marker !== 0xc8 &&
  marker !== 0xcc;

/**
 * A capture's intrinsic size.
 *
 * Without `width`/`height` on the tag the browser reserves NO space for a
 * lazily-loaded image, so every one of them grows the page as it decodes.
 * Measured on #96's page: 110 shots, 0 with dimensions, and the document grew
 * 23642px -> 31760px while they loaded. An operator scrolling to a journey and
 * clicking its tick had the row jump out from under the pointer, so the click
 * landed on nothing -- which reads exactly like "the checkbox does not work",
 * and only for the ones below the fold.
 *
 * PNG keeps its size at a fixed offset: bytes 12-15 are the IHDR type, 16-19
 * the width, 20-23 the height, all big-endian. JPEG does NOT -- it is a stream
 * of marker segments, so the frame header sits behind whatever EXIF, ICC or
 * restart-interval segments the encoder emitted and has to be walked to.
 *
 * @param {Buffer} bytes
 */
export const imageSize = (bytes) => {
  if (bytes.length >= 24 && bytes.readUInt32BE(12) === 0x49484452)
    return { w: bytes.readUInt32BE(16), h: bytes.readUInt32BE(20) };
  if (!(bytes.length >= 4 && bytes.readUInt16BE(0) === 0xffd8)) return null;

  let at = 2;
  while (at + 1 < bytes.length) {
    if (bytes[at] !== 0xff) return null; // out of step with the segment stream
    let marker = bytes[at + 1];
    // 0xFF is legal padding before a marker, so skip a run of it.
    while (marker === 0xff && at + 2 < bytes.length) {
      at += 1;
      marker = bytes[at + 1];
    }
    if (marker === 0xd8 || STANDALONE.has(marker)) {
      at += 2;
      continue;
    }
    if (marker === 0xd9 || marker === 0xda) return null; // EOI, or the scan begins
    if (at + 3 >= bytes.length) return null;
    if (isFrameHeader(marker))
      return { w: bytes.readUInt16BE(at + 7), h: bytes.readUInt16BE(at + 5) };
    at += 2 + bytes.readUInt16BE(at + 2);
  }
  return null;
};

const USAGE =
  'usage: build-evidence-page.mjs --evidence <dir> --content <file.json> --out <file.html> [--published <listing.json>] [--assets <map.json>]\n' +
  '       build-evidence-page.mjs --plan --evidence <dir> --out <file.html>';

/**
 * Text read from `file`, or a refusal naming it and `what` it was meant to be.
 *
 * @param {string} file
 * @param {string} what
 */
const textAt = (file, what) => {
  try {
    return readFileSync(file, 'utf8');
  } catch (error) {
    throw new Error(
      `build-evidence-page: could not read ${what} at ${file}: ${messageOf(error)}`,
    );
  }
};

/**
 * JSON parsed from `text`, or a refusal naming `where` it came from. A bare
 * `JSON.parse` said only "Unexpected end of JSON input", which names no file.
 *
 * @param {string} text
 * @param {string} where
 * @returns {any}
 */
const jsonFrom = (text, where) => {
  try {
    return JSON.parse(text);
  } catch (error) {
    throw new Error(
      `build-evidence-page: ${where} is not JSON: ${messageOf(error)}`,
    );
  }
};

/**
 * @param {string} file
 * @param {string} what
 */
const jsonAt = (file, what) =>
  jsonFrom(textAt(file, what), `${what} at ${file}`);

/**
 * The paths an artifact already serves, from a saved file listing, refused
 * unless it is a list of them: an object in it reached `reconcileFiles` and
 * failed as `path.startsWith is not a function` (#390).
 *
 * @param {string} file
 * @returns {string[]}
 */
const listingAt = (file) => {
  const listing = jsonAt(file, 'the published file listing');
  if (
    !Array.isArray(listing) ||
    !listing.every((path) => typeof path === 'string')
  ) {
    throw new Error(
      `build-evidence-page: the published file listing at ${file} is not a list of paths -- ` +
        `got ${JSON.stringify(listing).slice(0, 200)}`,
    );
  }
  return listing;
};

const main = () => {
  // Parsed strictly (#390). The hand-rolled reader ignored an option it did
  // not know, so a mistyped `--publishd` cost the publish every removal in
  // silence, and took the next word whatever it was, so `--evidence --out p`
  // read a directory called `--out`.
  /** @type {{ evidence?: string, content?: string, out?: string,
   *   published?: string, plan?: boolean, assets?: string }} */
  let values;
  try {
    ({ values } = parseArgs({
      options: {
        evidence: { type: 'string' },
        content: { type: 'string' },
        out: { type: 'string' },
        published: { type: 'string' },
        plan: { type: 'boolean' },
        assets: { type: 'string' },
      },
    }));
  } catch (error) {
    console.error(`build-evidence-page: ${messageOf(error)}`);
    console.error(USAGE);
    process.exit(2);
  }
  const {
    evidence: dir,
    content: contentPath,
    out,
    // The paths the artifact already serves, saved from a file listing. Absent
    // on a first publish; without it nothing can be removed, only added.
    published: publishedPath,
    // Two passes, because an asset id is minted by the upload and cannot be
    // known before it (#268). `--plan` writes what to upload; the upload
    // answers with a `/_blob/<id>` for each; `--assets` builds the page from
    // that map.
    plan: planning = false,
    assets: assetsPath,
  } = values;
  if (!dir || !out || (!planning && !contentPath)) {
    console.error(USAGE);
    process.exit(2);
  }
  if (planning && assetsPath) {
    console.error(
      'build-evidence-page: --plan writes the upload list; --assets reads the ' +
        'answer to it. Passing both asks for one pass to be two.',
    );
    process.exit(2);
  }
  try {
    build({ dir, out, contentPath, publishedPath, planning, assetsPath });
  } catch (error) {
    // Every refusal in here is a decision, not a crash. An unhandled throw
    // prints `at main (...)` under it, which shows the reader an internal
    // error where a one-line answer belongs (#227).
    die(messageOf(error));
  }
};

/**
 * The work, once the arguments are known. `contentPath` is absent only on a
 * plan pass: `main()` refuses a build pass without it.
 *
 * @param {{ dir: string, out: string, contentPath: string | undefined,
 *   publishedPath: string | undefined, planning: boolean,
 *   assetsPath: string | undefined }} command
 */
const build = ({
  dir,
  out,
  contentPath,
  publishedPath,
  planning,
  assetsPath,
}) => {
  const reportFile = join(dir, EVIDENCE_REPORT);
  const report = jsonAt(reportFile, 'the evidence report');
  // Before any capture is read: an earlier run's rows are set aside here, so a
  // capture of theirs that has gone since is never reached for. Blank lines are
  // skipped, never removed first, so a refusal names the line an editor shows.
  const manifestFile = join(dir, EVIDENCE_MANIFEST);
  const { current: manifest, earlier } = capturesOfThisRun(
    textAt(manifestFile, 'the evidence manifest')
      .split('\n')
      .flatMap((line, i) =>
        line.trim()
          ? [
              jsonFrom(
                line,
                `the evidence manifest at ${manifestFile} line ${i + 1}`,
              ),
            ]
          : [],
      ),
    report,
  );
  // Before any capture is read: a missing recording refuses the whole page.
  const candidates = videoCandidates(report);
  const screenshots = shotCandidates(manifest, dir);

  // Recordings AND screenshots (#368) live in the artifact's ASSET STORE, which
  // holds 5000 files and 1 GiB against a publish's 255 entries and 64 MB and a
  // document's 16 MB (#268, measured). The publish itself therefore carries no
  // capture at all -- only the removal of any an earlier capture published as
  // supporting files, which a redeploy would otherwise keep.
  const uploads = assetUploads([...candidates, ...screenshots]);
  if (planning) {
    assertAssetLimits({ uploads, sizeOf: (source) => statSync(source).size });
    const planOut = `${out}.uploads.json`;
    writeFileSync(planOut, `${JSON.stringify(uploads, null, 2)}\n`, 'utf8');
    console.log(
      `planned ${screenshots.length} screenshot(s) and ${candidates.length} ` +
        `recording(s) to upload (${planOut})`,
    );
    console.log(UPLOAD_NOTE);
    return;
  }
  if (!assetsPath && candidates.length + screenshots.length > 0)
    throw new Error(
      `build-evidence-page: ${screenshots.length} screenshot(s) and ` +
        `${candidates.length} recording(s) have to reach ` +
        'the asset store before the page can reference them, and no --assets ' +
        'map was given. Run --plan first, upload what it lists, then pass the ' +
        'map back. Refusing to build a page whose every journey would read as ' +
        'never recorded.',
    );
  // Only now: `--plan` needs no content, and reading it would refuse a plan
  // over an argument the plan does not use.
  const content = jsonAt(
    /** @type {string} */ (contentPath),
    'the page content',
  );

  // Read ONCE: the same buffer answers what the file is and how big it
  // renders. Its bytes travel through the asset store (#368), not the page.
  const bytes = new Map(
    manifest.map((m) => [m.file, readFileSync(join(dir, m.file))]),
  );
  for (const b of bytes.values()) mediaType(b);
  const dims = new Map(
    [...bytes]
      // The pair is spelled out: `.map` otherwise answers `any[]`, and a Map
      // constructor wants `[key, value]` tuples, not arrays that happen to
      // hold two things.
      .map(
        (/** @type {[string, Buffer]} */ [file, b]) =>
          /** @type {[string, ReturnType<typeof imageSize>]} */ ([
            file,
            imageSize(b),
          ]),
      )
      .filter(([, size]) => size),
  );
  // Recordings travel BESIDE the page, so the page holds a relative path and
  // the bytes are charged against the publish rather than the 16 MB document.
  // Nothing is selected and nothing is dropped: every recording the report
  // names is published, or the build has already refused above.
  const files = reconcileFiles({
    desired: {},
    published: publishedPath ? listingAt(publishedPath) : [],
  });
  assertPublishLimits({ files, sizeOf: (source) => statSync(source).size });
  // One map answers both kinds; each is checked both ways against its own
  // plan, so a shot missing from it, or one no capture of this run asked for,
  // refuses exactly as a recording does.
  /** @type {Record<string, string>} */
  const uploaded = assetsPath ? jsonAt(assetsPath, 'the asset map') : {};
  /** @param {(key: string) => boolean} keep */
  const part = (keep) =>
    Object.fromEntries(Object.entries(uploaded).filter(([key]) => keep(key)));
  const isShot = (/** @type {string} */ key) => key.startsWith(SHOT_PREFIX);
  const videos = assetVideoPaths({
    uploaded: part((key) => !isShot(key)),
    candidates,
  });
  const shotSrcs = assetSrcs({
    uploaded: part(isShot),
    candidates: screenshots,
    what: 'screenshot',
  });
  const shots = new Map(
    screenshots.map(({ key }) => [
      key.slice(SHOT_PREFIX.length),
      shotSrcs.get(key),
    ]),
  );

  const html = renderEvidencePage({
    manifest,
    report,
    content,
    shots,
    dims,
    videos,
  });
  // BEFORE anything is written. A refusal that leaves the page on disk invites
  // publishing it anyway, or trimming it by hand; the refusal for a missing
  // recording already leaves no file behind, and this one matches it.
  assertPageFits(Buffer.byteLength(html));
  writeFileSync(out, html, 'utf8');
  // The files map, beside the page, because the publish is a separate step and
  // a map nobody can find is a page whose recordings never travel.
  const filesOut = `${out}.files.json`;
  writeFileSync(filesOut, `${JSON.stringify(files, null, 2)}\n`, 'utf8');
  console.log(
    `written ${out} ${(Buffer.byteLength(html) / 1048576).toFixed(2)}MB ` +
      `shots=${shots.size} videos=${videos.size}/${candidates.length} ` +
      `files=${Object.keys(files).length} (${filesOut})` +
      earlierLine(earlier),
  );
  console.log(PUBLISH_NOTE);
};

// Only when run, never when imported: the tests import the functions above.
// Node answers "was I run directly?" itself. Comparing `import.meta.url` with
// the raw path skipped the build, in silence, from any checkout whose path held
// a space (#221, `tests/unit/script-entry.test.ts`).
if (import.meta.main) main();

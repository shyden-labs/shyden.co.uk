/**
 * Uploads an evidence run's recordings into an artifact's asset store and
 * writes the map the page is built from (#291).
 *
 * The ids cannot be known before the upload, and carrying 281 of them out of
 * tool results by hand is where a silent error lives: a well-formed but
 * MIS-PAIRED id renders one journey's recording against another journey's
 * assertion, and nothing about the page looks wrong. So nothing here is
 * transcribed. Every pairing is derived from the sha256 the asset store
 * reports beside each stored asset.
 */

import { createHash } from 'node:crypto';
import { readFileSync, statSync, writeFileSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { die, messageOf } from './errors.mjs';

/** Where the artifact serves a stored asset, in every view (#268). */
const BLOB_PREFIX = '/_blob/';

/**
 * A file's content digest, in the spelling the asset store reports.
 *
 * @param {string} abs
 * @returns {string}
 */
const sha256Of = (abs) =>
  createHash('sha256').update(readFileSync(abs)).digest('hex');

/**
 * The plan as JSON gives it: every journey key against the recording it
 * uploads. Checked before anything reads it, because an empty plan writes an
 * empty map, and a page built from that reads as a run that recorded nothing.
 *
 * @param {unknown} value
 * @returns {Record<string, string>}
 */
export const planOf = (value) => {
  if (typeof value !== 'object' || value === null || Array.isArray(value))
    throw new Error(
      'upload-evidence-assets: the plan is not an object of journey keys to recording paths',
    );
  const entries = Object.entries(value);
  if (entries.length === 0)
    throw new Error(
      'upload-evidence-assets: the plan names no recording, so there is nothing to upload or pair',
    );
  const pathless = entries
    .filter(([, path]) => typeof path !== 'string' || path === '')
    .map(([key]) => key);
  if (pathless.length)
    throw new Error(
      `upload-evidence-assets: ${pathless.length} plan key(s) with no recording path: ${pathless.join(', ')}`,
    );
  return /** @type {Record<string, string>} */ (value);
};

/** The count the listing states for itself, which every asset line is checked against. */
const DECLARED_FILES = /^Assets of \S+: (\d+) files,/m;

/** An asset line as the listing prints it, and nothing else. */
const ASSET_LINE =
  /^- \/_blob\/([0-9a-f]{32})\s+\S+\s+(\d+) bytes\s+\S+\s+sha256 ([0-9a-f]{64})$/;

/**
 * What the asset store already holds, read from the listing's own text.
 *
 * The listing is parsed here rather than turned into JSON by whoever ran it:
 * a hand-made JSON copy is hand-transcription, which is the failure this
 * script exists to remove.
 *
 * @param {string} text - `Artifact action:"list" scope:"assets"` verbatim.
 * @returns {{ id: string, bytes: number, sha256: string }[]}
 */
export const parseAssetListing = (text) => {
  const assets = [];
  const unreadable = [];
  for (const line of text.split('\n')) {
    const asset = line.trimEnd();
    if (!asset.startsWith('- ')) continue;
    const found = ASSET_LINE.exec(asset);
    if (found)
      assets.push({ id: found[1], bytes: Number(found[2]), sha256: found[3] });
    else unreadable.push(asset);
  }
  if (unreadable.length)
    throw new Error(
      `upload-evidence-assets: ${unreadable.length} asset line(s) the ` +
        `listing format does not explain:\n  ${unreadable.join('\n  ')}\n` +
        'Skipping one would read as an asset the store does not hold, so it ' +
        'would be uploaded a second time -- or leave a recording paired with ' +
        'nothing. The format changed; fix the pattern rather than the data.',
    );
  const header = DECLARED_FILES.exec(text);
  if (!header)
    throw new Error(
      'upload-evidence-assets: that text carries no asset listing header, ' +
        'so there is nothing to check the asset lines against. An empty ' +
        'store and a listing this script could not read look identical -- ' +
        'a short list -- and only one of them is good news.',
    );
  const declared = Number(header[1]);
  if (assets.length !== declared)
    throw new Error(
      `upload-evidence-assets: ${assets.length} asset line(s) against the ` +
        `${declared} its header declares. The listing pages, so a page taken ` +
        'for the whole store would upload every recording beyond it a second ' +
        'time. Continue the listing with `after` until it is whole.',
    );
  return assets;
};

/**
 * The map the page is built from: every journey key against the asset that
 * holds that recording's bytes.
 *
 * Paired by CONTENT, never by the order the uploads happened in. An id read
 * out of one tool result and written beside the wrong key is the failure this
 * whole script exists to remove, and a sha256 cannot be mis-paired by hand.
 *
 * @param {{ plan: Record<string, string>, stored: { id: string, bytes: number, sha256: string }[] }} input
 * @returns {Record<string, string>}
 */
export const assetsMap = ({ plan, stored }) => {
  const byDigest = new Map(stored.map((asset) => [asset.sha256, asset]));
  // Annotated, not inferred: an empty object literal types as `{}`, the
  // narrowest type that value inhabits, which cannot be indexed by a string
  // and is not the `Record` this returns (#157).
  /** @type {Record<string, string>} */
  const map = {};
  const missing = [];
  const wrongSize = [];
  for (const [key, abs] of Object.entries(plan)) {
    const asset = byDigest.get(sha256Of(abs));
    if (!asset) {
      missing.push(`${key}: ${abs}`);
      continue;
    }
    const bytes = statSync(abs).size;
    if (asset.bytes !== bytes)
      wrongSize.push(
        `${key}: the store holds ${asset.bytes} bytes, ${abs} is ${bytes}`,
      );
    map[key] = `${BLOB_PREFIX}${asset.id}`;
  }
  if (missing.length)
    throw new Error(
      `upload-evidence-assets: ${missing.length} recording(s) the store does ` +
        `not hold:\n  ${missing.join('\n  ')}\n` +
        'A journey with no source renders exactly like one that was never ' +
        'recorded. Run the upload the plan asks for before building the map.',
    );
  if (wrongSize.length)
    throw new Error(
      `upload-evidence-assets: ${wrongSize.length} asset(s) are not the size ` +
        `of the file they came from:\n  ${wrongSize.join('\n  ')}\n` +
        'The store is reporting something other than what was uploaded, and ' +
        'the page would put it in front of the operator as evidence.',
    );
  return map;
};

/**
 * How many files one upload call takes, as the tool states it. Pinned to a
 * literal by the suite: every other assertion about batching derives from
 * this, and a value derived from the thing it checks would move with it (#117).
 */
export const UPLOAD_BATCH = 25;

/**
 * The recordings still to upload, in batches a single call can take.
 *
 * An upload of 1,400 files WILL be interrupted, so a recording the store
 * already holds is recognised by its content and left out rather than sent
 * again. Derived from the plan; a hand-written list misses the entry that
 * breaks (#24, #49).
 *
 * @param {{ plan: Record<string, string>, stored: { id: string, bytes: number, sha256: string }[] }} input
 * @returns {string[][]}
 */
export const pendingUploads = ({ plan, stored }) => {
  const held = new Set(stored.map((asset) => asset.sha256));
  // Once each: a path two keys name, or a recording byte-identical to one
  // already pending, has the digest of the first, so it is not sent again.
  /** @type {string[]} */
  const pending = [];
  for (const abs of Object.values(plan)) {
    const digest = sha256Of(abs);
    if (held.has(digest)) continue;
    held.add(digest);
    pending.push(abs);
  }
  const batches = [];
  for (let at = 0; at < pending.length; at += UPLOAD_BATCH)
    batches.push(pending.slice(at, at + UPLOAD_BATCH));
  return batches;
};

const USAGE =
  'usage: upload-evidence-assets.mjs --plan <file.uploads.json> --listing <listing.txt> [--out <assets.json>]\n' +
  '       without --out it prints the batches still to upload; with it, ' +
  'it writes the map the page is built from.';

/**
 * EVERY EFFECT IS IN HERE, reached only under `import.meta.main` (#276), so
 * importing this module for its pure exports runs nothing.
 *
 * Two passes, because an id cannot be known before its upload. Without
 * `--out` it prints what is still to upload, one line per call; with `--out`
 * it derives the map from a fresh listing and writes it, refusing anything it
 * cannot account for.
 *
 * @returns {void}
 */
const main = () => {
  // Parsed strictly: a mistyped `--outt` read by hand was ignored, and the
  // run printed batches instead of writing the map it was asked for.
  /** @type {{ plan?: string, listing?: string, out?: string }} */
  let values;
  try {
    ({ values } = parseArgs({
      options: {
        plan: { type: 'string' },
        listing: { type: 'string' },
        out: { type: 'string' },
      },
    }));
  } catch (error) {
    console.error(`upload-evidence-assets: ${messageOf(error)}`);
    console.error(USAGE);
    process.exit(2);
  }
  const { plan: planPath, listing: listingPath, out } = values;
  if (!planPath || !listingPath) {
    console.error(USAGE);
    process.exit(2);
  }
  try {
    run({ planPath, listingPath, out });
  } catch (error) {
    // Every refusal in here is a decision, not a crash. An unhandled throw
    // prints `at main (...)` at whoever is reading, which shows them an
    // internal error where a one-line answer belongs (#227).
    die(messageOf(error));
  }
};

/**
 * The work, once the arguments are known.
 *
 * @param {{ planPath: string, listingPath: string, out: string | undefined }} input
 * @returns {void}
 */
const run = ({ planPath, listingPath, out }) => {
  const plan = planOf(JSON.parse(readFileSync(planPath, 'utf8')));
  const stored = parseAssetListing(readFileSync(listingPath, 'utf8'));
  if (!out) {
    const batches = pendingUploads({ plan, stored });
    if (!batches.length) {
      console.log(
        'upload-evidence-assets: the store already holds every recording in ' +
          'that plan. Re-run the listing, then pass --out to write the map.',
      );
      return;
    }
    console.log(
      `upload-evidence-assets: ${batches.flat().length} recording(s) still ` +
        `to upload, in ${batches.length} call(s) of at most ${UPLOAD_BATCH}:`,
    );
    for (const batch of batches) console.log(JSON.stringify(batch));
    return;
  }
  const map = assetsMap({ plan, stored });
  writeFileSync(out, `${JSON.stringify(map, null, 2)}\n`, 'utf8');
  console.log(
    `upload-evidence-assets: wrote ${Object.keys(map).length} pairing(s) to ${out}`,
  );
};

if (import.meta.main) main();

/**
 * Converts raw V8 coverage from processes Node ran outside Vitest's workers
 * into the Istanbul shape `scripts/coverage-merge.mjs` joins (#899).
 *
 * `NODE_V8_COVERAGE=<dir>` makes every Node process, and every process it
 * starts, write one `coverage-*.json` there. An entry counts only when Node
 * ran the file's own text: plain JavaScript, or TypeScript Node stripped of
 * its types (the types become spaces, so every offset is the file's own, and
 * Node appends `\n\n//# sourceURL=<url>`). Anything else under the same URL is
 * code a tool transformed first (Vitest's workers inherit the variable), which
 * this text cannot describe, so it is skipped and named. A file Vitest's own
 * report measures still reaches the merge from there.
 *
 *   node scripts/coverage-processes.mjs <raw-dir> <suite>
 *
 * writes `coverage/<suite>/coverage-final.json`. A directory with no measured
 * entry is refused, never written as an empty report that reads as "nothing
 * ran". `tests/unit/coverage-processes.test.ts` holds the conversion;
 * `tests/integration/coverage-processes-script.test.ts` runs it on a real
 * child process.
 */
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { convert } from 'ast-v8-to-istanbul';
import { parse } from 'vite';
import { MEASURED, NOT_MEASURED } from '../tests/coverage-options.ts';
import { die } from './errors.mjs';

/**
 * One V8 function's block counts, and one script's functions, as
 * `NODE_V8_COVERAGE` writes them.
 *
 * @typedef {{ startOffset: number, endOffset: number, count: number }} V8Range
 * @typedef {{ functionName: string, ranges: V8Range[], isBlockCoverage: boolean }} V8Function
 * @typedef {{ url: string, functions: V8Function[] }} V8Script
 * @typedef {import('./coverage-merge.mjs').FileCoverage} FileCoverage
 * @typedef {{ file: string, url: string, reason: string }} Skipped
 */

const TYPESCRIPT = /\.[mc]?tsx?$/;

/**
 * The repository-relative file an entry ran, or null when it is not one the
 * coverage measures (a built-in, a dependency, a test, outside the root).
 *
 * @param {string} url
 * @param {string} root the repository, absolute
 * @returns {string | null}
 */
export const fileOf = (url, root) => {
  if (!url.startsWith('file://')) return null;
  const relative = path.posix.relative(
    root,
    fileURLToPath(url.split('?')[0] ?? url),
  );
  if (relative.startsWith('..') || path.posix.isAbsolute(relative)) return null;
  const measured =
    MEASURED.some((glob) => path.posix.matchesGlob(relative, glob)) &&
    !NOT_MEASURED.some((glob) => path.posix.matchesGlob(relative, glob));
  return measured ? relative : null;
};

/** @param {V8Script} script */
const ranLength = (script) =>
  Math.max(
    0,
    ...script.functions.flatMap((fn) => fn.ranges.map((r) => r.endOffset)),
  );

/**
 * The lengths of code Node runs from this file's own text.
 *
 * @param {string} file
 * @param {string} text
 * @param {string} url
 * @returns {number[]}
 */
const ownLengths = (file, text, url) =>
  TYPESCRIPT.test(file)
    ? [text.length, text.length + `\n\n//# sourceURL=${url}`.length]
    : [text.length];

/**
 * @param {FileCoverage} into
 * @param {FileCoverage} from
 */
const addCounts = (into, from) => {
  for (const [id, count] of Object.entries(from.s))
    into.s[id] = (into.s[id] ?? 0) + count;
  for (const [id, counts] of Object.entries(from.b))
    into.b[id] = counts.map((count, i) => (into.b[id]?.[i] ?? 0) + count);
  for (const [id, count] of Object.entries(from.f))
    into.f[id] = (into.f[id] ?? 0) + count;
};

/**
 * @param {readonly V8Script[]} scripts every process's entries
 * @param {(file: string) => string} read a file's text, by its relative path
 * @param {string} root the repository, absolute
 * @returns {Promise<{ report: Record<string, FileCoverage>, skipped: Skipped[] } | { refusal: string }>}
 */
export const convertScripts = async (scripts, read, root) => {
  /** @type {Record<string, FileCoverage>} */
  const report = {};
  /** @type {Skipped[]} */
  const skipped = [];
  for (const script of scripts) {
    const file = fileOf(script.url, root);
    if (file === null) continue;
    const text = read(file);
    const lengths = ownLengths(file, text, script.url);
    const ran = ranLength(script);
    if (!lengths.includes(ran)) {
      skipped.push({
        file,
        url: script.url,
        reason: `ran code ${ran} characters long, not its own text (${lengths.join(', or ')}${lengths.length > 1 ? ' with the sourceURL Node appends' : ''})`,
      });
      continue;
    }
    const absolute = path.posix.join(root, file);
    // The options Vitest's own (deprecated) parseAstAsync passes, so the tree
    // is the one its report places statements on. `parse` reports a syntax
    // error beside an empty program instead of throwing, so it is refused
    // here, never converted as a file with no statements.
    const parsed = await parse(file, text, {
      lang: TYPESCRIPT.test(file) ? 'ts' : 'js',
      preserveParens: false,
    });
    if (parsed.errors.length > 0)
      return {
        refusal: `coverage-processes: ${file} does not parse (${parsed.errors[0]?.message}), so its counts have nowhere to go`,
      };
    /** @type {Record<string, FileCoverage>} */
    const converted = JSON.parse(
      JSON.stringify(
        await convert({
          ast: parsed.program,
          code: text,
          wrapperLength: 0,
          coverage: { functions: script.functions, url: script.url },
        }),
      ),
    );
    const coverage = Object.values(converted)[0];
    if (coverage === undefined) continue;
    coverage.path = absolute;
    const seen = report[absolute];
    if (seen) addCounts(seen, coverage);
    else report[absolute] = coverage;
  }
  if (Object.keys(report).length === 0)
    return {
      refusal:
        'coverage-processes: no process ran a measured file, so there is nothing to report',
    };
  return { report, skipped };
};

const main = async () => {
  const [dir, suite, ...rest] = process.argv.slice(2);
  if (!dir || !suite || rest.length > 0)
    die('usage: coverage-processes.mjs <raw-dir> <suite>');
  const root = process.cwd();
  /** @type {V8Script[]} */
  const scripts = readdirSync(dir)
    .filter((name) => name.endsWith('.json'))
    .flatMap(
      (name) =>
        /** @type {{ result: V8Script[] }} */ (
          JSON.parse(readFileSync(path.join(dir, name), 'utf8'))
        ).result,
    );
  const result = await convertScripts(
    scripts,
    (file) => readFileSync(path.join(root, file), 'utf8'),
    root,
  );
  if ('refusal' in result) die(`${result.refusal} (read ${dir})`);
  mkdirSync(path.join('coverage', suite), { recursive: true });
  writeFileSync(
    path.join('coverage', suite, 'coverage-final.json'),
    `${JSON.stringify(result.report)}\n`,
  );
  // Vitest's workers inherit the variable, so most skipped entries are their
  // transformed code: listed in a file beside the report, counted here.
  writeFileSync(
    path.join('coverage', suite, 'skipped.txt'),
    result.skipped.map(({ file, reason }) => `${file}: ${reason}\n`).join(''),
  );
  console.log(
    `coverage-processes: ${scripts.length} entries, ${Object.keys(result.report).length} files measured, ${result.skipped.length} skipped (coverage/${suite}/skipped.txt)`,
  );
};

if (import.meta.main) await main();

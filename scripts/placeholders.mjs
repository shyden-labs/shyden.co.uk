// The production deploy's `[[…]]` placeholder guard (#1040): no unfilled
// placeholder may reach shipped text. Run: node scripts/placeholders.mjs dist
//
// Every built page's RENDERED text is already checked on each pull request
// (tests/e2e/rendered-text.spec.ts). This scan is the wider net before
// production: the site's own script, sitemap, data and markup, attributes
// included.
import { readFileSync, readdirSync } from 'node:fs';
import { basename, join } from 'node:path';
import { argv, exit } from 'node:process';
import { nonEmpty } from './errors.mjs';

// The placeholder SHAPE: `[[` … `]]` with no `]` between, so a JavaScript
// array of pairs (`[[k,v],[k,v]]`) never completes it.
const PLACEHOLDER = /\[\[[^\]]{1,60}\]\]/g;

// Vendored code nobody here writes text into. Swagger UI's minified bundle
// (the API docs, #781) holds nested arrays such as `[[e,r]]`, which have the
// placeholder's shape; it stopped the 2026-11-05 release (#1040).
const VENDORED = /^swagger-ui-/;

// Text the site ships. Fonts, images and media are binary: a woff2 holds the
// bytes `[[` and is not text.
const TEXT = /\.(html|js|mjs|css|xml|json|txt|webmanifest|svg)$/;

/**
 * Every placeholder in the given files, as `path: [[…]]`.
 * @param {ReadonlyArray<{ path: string; text: string }>} files
 * @returns {string[]}
 */
export const placeholderFindings = (files) =>
  files
    .filter(({ path }) => !VENDORED.test(basename(path)))
    .flatMap(({ path, text }) =>
      [...text.matchAll(PLACEHOLDER)].map((m) => `${path}: ${m[0]}`),
    );

/**
 * Every text file under `dir`. Node's own recursive read, so no hand-written
 * walk (one-home.test.ts), and `nonEmpty` refuses an empty directory.
 * @param {string} dir @returns {string[]}
 */
const textFilesUnder = (dir) =>
  nonEmpty(
    readdirSync(dir, { recursive: true, withFileTypes: true }),
    `files under ${dir}`,
  )
    .filter((entry) => entry.isFile() && TEXT.test(entry.name))
    .map((entry) => join(entry.parentPath, entry.name));

const main = () => {
  const [dir] = argv.slice(2);
  if (!dir) {
    console.error('usage: node scripts/placeholders.mjs <dist-dir>');
    exit(2);
  }
  const paths = textFilesUnder(dir);
  // A scan of nothing proves nothing: an empty or wrong directory fails.
  if (paths.length === 0) {
    console.error(
      `::error::No text files under ${dir}: the scan read nothing.`,
    );
    exit(1);
  }
  const findings = placeholderFindings(
    paths.map((path) => ({ path, text: readFileSync(path, 'utf8') })),
  );
  if (findings.length > 0) {
    for (const finding of findings) console.error(finding);
    console.error(
      '::error::A [[…]] placeholder reached dist/ — refusing to ship to prod.',
    );
    exit(1);
  }
  console.log(
    `No bracket placeholders in ${paths.length} text files under ${dir}.`,
  );
};

if (import.meta.main) main();

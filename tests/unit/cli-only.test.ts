import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, normalize } from 'node:path';
import { codeWithoutComments } from './source-text';
import { filesUnder, searched } from '../source-files';
import { floorBreach } from '../floors';

/**
 * Modules for the CLI that nothing the site ships may import.
 *
 * `translate.ts` is the DeepL harness's decisions -- its glossary and request
 * building (#21). `back-translate.ts` imports every locale's catalogue at once
 * (#95): reached from a page, it would put all five on every page.
 * `label-check.ts` reads its units from `back-translate.ts` (#161), so it
 * carries the same five, and `feature-terms.ts` builds on `label-check.ts`
 * (#319).
 *
 * The guard this replaces looked for the SUBSTRING `i18n/translate` in each
 * shipped file. A sibling in `src/lib/i18n/` importing `./translate` never
 * contains it, so the spelling most likely to happen was the one it could not
 * see. Every relative specifier is now resolved to the file it names.
 */
const CLI_ONLY = [
  'src/lib/i18n/translate.ts',
  'src/lib/i18n/back-translate.ts',
  'src/lib/i18n/label-check.ts',
  'src/lib/i18n/feature-terms.ts',
  'src/lib/report-review.ts',
];

const CODE = /\.(ts|mts|js|mjs|astro)$/;

/** A path without its script extension: `./en` and `./en.ts` name one file. */
const stem = (path: string) => path.replace(/\.(ts|mts|js|mjs)$/, '');

/**
 * Every relative module a file imports -- statically, as a re-export, or
 * dynamically -- resolved against the file's own directory.
 */
function importsOf(file: string): string[] {
  const code = codeWithoutComments(file, readFileSync(file, 'utf8'));
  const specifiers = [
    ...code.matchAll(
      /\b(?:import|export)\s+(?:[^'";]*?\sfrom\s+)?['"]([^'"]+)['"]/g,
    ),
    ...code.matchAll(/\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g),
  ].map(([, specifier]) => specifier);
  return specifiers
    .filter((specifier) => /^\.{1,2}\//.test(specifier))
    .map((specifier) => normalize(join(dirname(file), specifier)));
}

describe('a CLI-only module stays out of everything the site ships', () => {
  const shipped = () =>
    [
      ...filesUnder('src', (path) => CODE.test(path)),
      ...filesUnder('functions', (path) => CODE.test(path)),
    ].filter((file) => !CLI_ONLY.includes(file));

  it('names modules that exist', () => {
    for (const module of CLI_ONLY)
      expect(existsSync(module), module).toBe(true);
  });

  it('resolves the imports it judges', () => {
    // The control for the absence below: an extractor that found nothing
    // would report no offenders anywhere.
    expect(importsOf('src/lib/i18n/index.ts').map(stem)).toContain(
      'src/lib/i18n/en',
    );
  });

  it('walks the Pages Functions too', () => {
    // #97 put site code behind a Function. functions/ was already in the
    // walk; this proves the new one is reached, not merely listed.
    expect(shipped()).toContain('functions/api/report/index.js');
    expect(importsOf('functions/api/report/index.js').map(stem)).toContain(
      'src/lib/report',
    );
  });

  it('is imported by nothing the site ships', () => {
    const forbidden = new Set(CLI_ONLY.map(stem));
    const files = shipped();
    const offenders = files.flatMap((file) =>
      importsOf(file)
        .filter((target) => forbidden.has(stem(target)))
        .map((target) => `${file} imports ${target}`),
    );
    expect(
      searched(offenders, { of: files, what: 'shipped source files' }),
      'this would put a CLI module in the browser bundle',
    ).toEqual([]);
    expect(floorBreach('cli-only/shipped-files', files.length)).toBeUndefined();
  });
});

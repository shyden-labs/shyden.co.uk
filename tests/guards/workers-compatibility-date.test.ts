import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  withoutCommentLines,
  withoutTsComments,
  withoutYamlComments,
} from '../unit/source-text';
import { searched, trackedFiles } from '../source-files';
import { compatibilityDateOf } from '../../src/lib/pages-runtime';

/**
 * The Workers compatibility date has one home, `tests/functions/wrangler.toml`
 * (#907). The functions suite runs on it, and each deploy sets both Pages
 * projects to it (`scripts/pages-runtime.mjs`). A second spelling is how the
 * tested runtime drifted from the deployed one: `serve.mjs` passed its own
 * copy to `wrangler pages dev`, and nothing read the deployed date at all.
 *
 * A spelling is a date handed to the runtime: a literal after
 * `--compatibility-date`, or a `compatibility_date` in another TOML file. A
 * date that is only a fixture's day (a report's, a test's) is not one.
 */
export const spellsACompatibilityDate = (path: string, code: string) =>
  /--compatibility-date(?:=|['"`]?\s*,?\s*['"`]|\s+)\d{4}-\d{2}-\d{2}/.test(
    code,
  ) ||
  (path.endsWith('.toml') && /^\s*compatibility_date\s*=/m.test(code));

/**
 * The flag, built from parts, so these fixtures do not spell what the guard
 * scans for and the guard does not find itself.
 */
const FLAG = ['--compatibility', 'date'].join('-');

describe('the Workers compatibility date has exactly one home', () => {
  const HOME = 'tests/functions/wrangler.toml';
  const code = (path: string) => {
    const text = readFileSync(path, 'utf8');
    if (/\.ya?ml$/.test(path)) return withoutYamlComments(text);
    if (path.endsWith('.toml')) return withoutCommentLines(text);
    return withoutTsComments(text);
  };
  const scanned = trackedFiles(
    (path) =>
      path !== HOME &&
      /^(tests|scripts|functions|src|\.github)\//.test(path) &&
      /\.(ts|mjs|js|ya?ml|toml)$/.test(path),
  );

  it('is handed to the runtime nowhere but its home', () => {
    expect(
      searched(
        scanned.filter((path) => spellsACompatibilityDate(path, code(path))),
        { of: scanned, what: 'test, script, function and workflow files' },
      ),
    ).toEqual([]);
  });

  it('is read from its home, which holds exactly one date', () => {
    expect(compatibilityDateOf(readFileSync(HOME, 'utf8'))).toMatch(
      /^\d{4}-\d{2}-\d{2}$/,
    );
  });

  it('catches a date passed as the next argument', () => {
    expect(
      spellsACompatibilityDate(
        'serve.mjs',
        `spawn('npx', ['wrangler', '${FLAG}',\n    '2026-10-20'])`,
      ),
    ).toBe(true);
  });

  it('catches a date passed with = or a space', () => {
    expect(
      spellsACompatibilityDate('x.yml', `run: wrangler dev ${FLAG}=2026-10-20`),
    ).toBe(true);
    expect(
      spellsACompatibilityDate('x.yml', `run: wrangler dev ${FLAG} 2026-10-20`),
    ).toBe(true);
  });

  it('catches a second TOML home', () => {
    expect(
      spellsACompatibilityDate(
        'a/wrangler.toml',
        'compatibility_date = "2026-10-20"',
      ),
    ).toBe(true);
  });

  it('is not fired by a fixture day or by a date read from the home', () => {
    expect(
      spellsACompatibilityDate('t.ts', "counterKey(SECRET, '2026-10-20', ip)"),
    ).toBe(false);
    expect(
      spellsACompatibilityDate(
        'serve.mjs',
        `['${FLAG}', testedCompatibilityDate()]`,
      ),
    ).toBe(false);
    expect(
      spellsACompatibilityDate('t.ts', "{ compatibility_date: '2026-10-20' }"),
    ).toBe(false);
  });
});

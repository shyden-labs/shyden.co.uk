import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { translatableSentences } from '../../src/lib/i18n/translate';
import { scratchDir } from '../scratch-dir';

const SCRIPT = fileURLToPath(
  new URL('../../scripts/i18n-scaffold.mjs', import.meta.url),
);
const OUT = join('src', 'lib', 'i18n', 'ja.ts');
const REVIEWED = '// reviewed by hand\n';

/** A working directory holding `cache` as the DeepL cache, and optionally a
 *  catalogue that has already been reviewed. */
const workspace = (cache?: unknown, reviewed = false) => {
  const cwd = scratchDir('scaffold-main-');
  mkdirSync(join(cwd, 'src', 'lib', 'i18n'), { recursive: true });
  if (cache !== undefined)
    writeFileSync(
      join(cwd, 'src', 'lib', 'i18n', '.translations.json'),
      JSON.stringify(cache),
    );
  if (reviewed) writeFileSync(join(cwd, OUT), REVIEWED);
  return cwd;
};

const scaffold = (cwd: string, ...args: string[]) =>
  spawnSync(process.execPath, [SCRIPT, ...args], { cwd, encoding: 'utf8' });

/** A draft for every sentence the English catalogues hold: itself. */
const everyDraft = () =>
  Object.fromEntries([...translatableSentences()].map((s) => [s, s]));

describe('main', () => {
  it('writes the catalogue when every sentence has a draft', () => {
    const cwd = workspace({ ja: everyDraft() });
    const run = scaffold(cwd, 'ja');
    expect(run.stderr).toBe('');
    expect(run.stdout).toBe(`✓ src/lib/i18n/ja.ts\n`);
    expect(run.status).toBe(0);
    expect(readFileSync(join(cwd, OUT), 'utf8')).toMatch(
      /^export const ja: Catalogue = \{$/m,
    );
  });

  it('refuses to overwrite a reviewed catalogue, and leaves it as it was', () => {
    const cwd = workspace({ ja: everyDraft() }, true);
    const run = scaffold(cwd, 'ja');
    expect(run.stderr).toBe(
      '✗ src/lib/i18n/ja.ts already exists. It is a review surface — ' +
        're-rendering would discard any correction made to it. Pass --force ' +
        'only if nothing in it has been reviewed yet.\n',
    );
    expect(run.status).toBe(1);
    expect(readFileSync(join(cwd, OUT), 'utf8')).toBe(REVIEWED);
  });

  it.each([[['ja', '--force']], [['--force', 'ja']]])(
    'overwrites with --force, wherever it stands: %j',
    (args) => {
      const cwd = workspace({ ja: everyDraft() }, true);
      const run = scaffold(cwd, ...args);
      expect(run.stderr).toBe('');
      expect(run.status).toBe(0);
      expect(readFileSync(join(cwd, OUT), 'utf8')).toMatch(
        /^export const ja: Catalogue = \{$/m,
      );
    },
  );

  it('writes nothing when a draft is missing, even with --force', () => {
    const known = everyDraft();
    delete known['Classroom Group Creator'];
    const cwd = workspace({ ja: known }, true);
    const run = scaffold(cwd, 'ja', '--force');
    expect(run.stderr).toBe(
      '✗ no translation cached for title: "Classroom Group Creator" — ' +
        'run "npm run i18n:translate -- ja --send" first\n',
    );
    expect(run.status).toBe(1);
    expect(readFileSync(join(cwd, OUT), 'utf8')).toBe(REVIEWED);
  });

  it("renders with the target language's own plural forms", () => {
    // Russian has four, so the first plural message is refused rather than
    // drafted from "other"; every language drafted so far has "other" alone.
    const cwd = workspace({ ru: everyDraft() });
    const run = scaffold(cwd, 'ru');
    expect(run.stderr).toMatch(
      /^✗ groupedNote: .* the language has the plural forms few, many, one, other, /,
    );
    expect(run.status).toBe(1);
    expect(existsSync(join(cwd, 'src', 'lib', 'i18n'))).toBe(true);
    expect(existsSync(join(cwd, 'src', 'lib', 'i18n', 'ru.ts'))).toBe(false);
  });

  it.each([
    [
      ['ja', '--froce'],
      '✗ unknown option --froce — usage: npm run i18n:scaffold -- <locale> [--force]\n',
    ],
    [
      ['ja', 'th'],
      '✗ name one locale, not 2 (ja, th) — usage: npm run i18n:scaffold -- <locale> [--force]\n',
    ],
  ])('refuses %j before it writes anything', (args, says) => {
    const cwd = workspace({ ja: everyDraft(), th: everyDraft() }, true);
    const run = scaffold(cwd, ...args);
    expect(run.stderr).toBe(says);
    expect(run.status).toBe(1);
    expect(readFileSync(join(cwd, OUT), 'utf8')).toBe(REVIEWED);
  });

  it('refuses when there is no cache at all', () => {
    const cwd = workspace();
    const run = scaffold(cwd, 'ja');
    expect(run.stderr).toBe(
      '✗ src/lib/i18n/.translations.json does not exist — run i18n:translate first\n',
    );
    expect(run.status).toBe(1);
    expect(existsSync(join(cwd, 'src', 'lib', 'i18n'))).toBe(true);
    expect(existsSync(join(cwd, OUT))).toBe(false);
  });

  it.each(['ko', 'constructor'])(
    'refuses a locale the cache has no drafts for: %s',
    (target) => {
      const run = scaffold(workspace({ ja: everyDraft() }), target);
      expect(run.stderr).toBe(
        `✗ no cached translations for "${target}" — run i18n:translate\n`,
      );
      expect(run.status).toBe(1);
    },
  );
});

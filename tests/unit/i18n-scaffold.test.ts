import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { renderCatalogue } from '../../scripts/i18n-scaffold.mjs';
import { messageOf } from '../../scripts/errors.mjs';
import { scratchDir } from '../scratch-dir';

/**
 * `scripts/i18n-scaffold.mjs` renders zh, vi and th from `en.ts` and the
 * DeepL cache. Until #390's review nothing ran it past the argv refusal in
 * `script-entry.test.ts`, so the behaviour its own docblock calls the
 * important one -- refusing to overwrite a reviewed catalogue -- was held up
 * by nothing but that docblock.
 */

const SUMMARY = '{count, plural, one {# pupil} other {# pupils}} in {names}';

/** Every copy shape `render` handles: bare and quoted keys, arrays, a
 *  symbol that stays as it is, a number, and a message. */
const FIXTURE = {
  title: 'Groups',
  mark: '#',
  size: 4,
  card: { heading: 'Your class', steps: ['Add pupils', '—'] },
  'class-list': { empty: 'No pupils yet' },
  summary: SUMMARY,
};

const SENTENCES = [
  'Groups',
  'Your class',
  'Add pupils',
  'No pupils yet',
  '{count} pupils in {names}',
];

/** A draft that shows it came from the cache: `«sentence»`. */
const drafts = (without: string[] = []) =>
  Object.fromEntries(
    SENTENCES.filter((s) => !without.includes(s)).map((s) => [s, `«${s}»`]),
  );

const ja = (
  known: Record<string, string>,
  pluralForms: Intl.LDMLPluralRule[] = ['other'],
) => ({
  target: 'ja',
  known,
  pluralForms,
});

const fail = (catalogue: unknown, locale: ReturnType<typeof ja>) => {
  try {
    renderCatalogue(catalogue, locale);
  } catch (error) {
    return messageOf(error);
  }
  throw new Error('renderCatalogue returned where it should have refused');
};

/** Load a rendered source the way a page would: as a module. */
const load = async (source: string) => {
  const dir = scratchDir('scaffold-');
  const file = join(dir, 'ja.ts');
  writeFileSync(file, source);
  return ((await import(file)) as { ja: unknown }).ja;
};

describe('renderCatalogue', () => {
  it('replaces every string with its cached draft and keeps the shape', async () => {
    expect(await load(renderCatalogue(FIXTURE, ja(drafts())))).toEqual({
      title: '«Groups»',
      mark: '#',
      size: 4,
      card: { heading: '«Your class»', steps: ['«Add pupils»', '—'] },
      'class-list': { empty: '«No pupils yet»' },
      summary: '«{count} pupils in {names}»',
    });
  });

  it('writes the typed header for the target and ends the statement', () => {
    const source = renderCatalogue(FIXTURE, ja(drafts()));
    expect(source.startsWith("import type { Catalogue } from './en';\n")).toBe(
      true,
    );
    expect(source).toMatch(/^export const ja: Catalogue = \{$/m);
    expect(source.endsWith('\n};\n')).toBe(true);
  });

  it('quotes a key that is not an identifier, and only that key', () => {
    const source = renderCatalogue(FIXTURE, ja(drafts()));
    expect(source).toContain('\n  "class-list": {\n');
    expect(source).toContain('\n  title: "«Groups»",\n');
  });

  it.each([
    ['Groups', 'title'],
    ['Your class', 'card.heading'],
    ['Add pupils', 'card.steps[0]'],
    ['No pupils yet', '["class-list"].empty'],
  ])('refuses a missing draft for %j, naming %s', (sentence, path) => {
    expect(fail(FIXTURE, ja(drafts([sentence])))).toBe(
      `no translation cached for ${path}: ${JSON.stringify(sentence)} — ` +
        'run "npm run i18n:translate -- ja --send" first',
    );
  });

  it('refuses a message with a sentence that has no draft', () => {
    expect(fail(FIXTURE, ja(drafts(['{count} pupils in {names}'])))).toBe(
      'summary: no translation for "{count} pupils in {names}" — ' +
        '"npm run i18n:translate -- ja --send" drafts any sentence that is missing',
    );
  });

  it('refuses a message whose language has plural forms beyond "other"', () => {
    expect(fail(FIXTURE, ja(drafts(), ['one', 'other']))).toBe(
      `summary: ${JSON.stringify(SUMMARY)}: the language has the plural forms ` +
        'one, other, and a draft cut from "other" alone would be wrong for the ' +
        'rest — "npm run i18n:translate -- ja --send" drafts any sentence that ' +
        'is missing',
    );
  });

  it('refuses a function, naming where it is', () => {
    expect(fail({ card: { greet: () => 'hi' } }, ja(drafts()))).toBe(
      'card.greet is a function. A catalogue holds copy and templates (#136).',
    );
  });

  it('reads a draft only from the cache itself, never its prototype', () => {
    // `{}.constructor` is `Object`: read as a draft, it rendered as the
    // bare word `undefined`, which is what JSON.stringify makes of a function.
    expect(fail({ word: 'constructor' }, ja({}))).toBe(
      'no translation cached for word: "constructor" — ' +
        'run "npm run i18n:translate -- ja --send" first',
    );
  });
});

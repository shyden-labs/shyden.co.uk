import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { stringLeaves } from '../../src/lib/catalogue-leaves';
import { ERROR_CODES, type GroupingError } from '../../src/lib/grouping';
import { getStrings, renderError } from '../../src/lib/i18n';
import { en } from '../../src/lib/i18n/en';
import {
  isMessageTemplate,
  type MessageParams,
} from '../../src/lib/i18n/message';

/**
 * Every English and Indonesian message renders what it rendered before #136.
 *
 * `fixtures/messages-before-136.json` is a characterisation snapshot: the
 * exact output of every parameterised message while the catalogues were still
 * arrow functions (generated at the commit it names), over a fixed grid of
 * values -- counts of 0, 1 and 2, lists of one to three items, both sexes, and
 * a name that is itself template syntax. The template-era catalogues are held
 * to it, so the refactor is proved against real old behaviour rather than
 * against itself.
 *
 * ONE change is intended, and it is applied to the snapshot here, in the
 * open, never by regenerating the file: every list is now formatted by
 * `Intl.ListFormat` in the page's language (operator decision 1 on #136,
 * 2026-09-13). English error and warning lists gain "and"; Indonesian lists
 * of three gain the comma before "dan". The approved renderings are literals
 * below, so the decision is reviewable and a wrong locale in the
 * implementation cannot agree with itself.
 */

interface SnapshotCase {
  readonly params: MessageParams;
  readonly en: string;
  readonly id: string;
}

const snapshot = JSON.parse(
  readFileSync(
    new URL('./fixtures/messages-before-136.json', import.meta.url),
    'utf8',
  ),
) as {
  readonly generatedFrom: string;
  readonly domains: { readonly string: readonly string[] };
  readonly messages: Readonly<Record<string, readonly SnapshotCase[]>>;
};

/** The snapshot's hostile value: a name that is also template syntax. */
const HOSTILE = "D'Arcy {n} #";

const LISTS_AFTER_DECISION: Record<
  'en' | 'id',
  Readonly<Record<string, string>>
> = {
  en: {
    'Ana|Budi': 'Ana and Budi',
    [`Ana|${HOSTILE}|Citra`]: `Ana, ${HOSTILE} and Citra`,
    '4|6': '4 and 6',
    '4|6|7': '4, 6 and 7',
  },
  id: {
    'Ana|Budi': 'Ana dan Budi',
    [`Ana|${HOSTILE}|Citra`]: `Ana, ${HOSTILE}, dan Citra`,
    '4|6': '4 dan 6',
    '4|6|7': '4, 6, dan 7',
  },
};

/** The function era joined a list with a bare comma, or with joinAnd/joinDan. */
const OLD_CONJUNCTION = { en: 'and', id: 'dan' } as const;

function withListDecision(
  before: string,
  params: MessageParams,
  locale: 'en' | 'id',
): string {
  const list = Object.values(params).find(
    (value): value is readonly string[] | readonly number[] =>
      Array.isArray(value),
  );
  if (!list || list.length < 2) return before;
  const items = list.map(String);
  const after = LISTS_AFTER_DECISION[locale][items.join('|')];
  if (after === undefined)
    throw new Error(
      `no approved rendering of [${items.join(', ')}] in ${locale}`,
    );
  const oldForms = [
    items.join(', '),
    `${items.slice(0, -1).join(', ')} ${OLD_CONJUNCTION[locale]} ${items[items.length - 1]}`,
  ].filter((form) => before.split(form).length === 2);
  if (oldForms.length !== 1)
    throw new Error(
      `expected the list exactly once in ${JSON.stringify(before)}`,
    );
  return before.replace(oldForms[0], () => after);
}

/**
 * A SECOND intended change, applied here in the open (#505, F176): a message
 * about exactly two students says "both" / "the same sex", where the function
 * era said "all" / "all the same sex". Three or more, and one, are unchanged.
 * The approved renderings are literals, keyed by message and language.
 */
const TWO_NAMES_AFTER_DECISION: Record<
  string,
  Readonly<Record<'en' | 'id', readonly [string, string]>>
> = {
  'errors.KEEP_APART_IMPOSSIBLE': {
    en: [' all need to be kept apart', ' both need to be kept apart'],
    id: [' semuanya harus dipisahkan', ' keduanya harus dipisahkan'],
  },
  'errors.SEX_SEPARATE_SPLITS_UNIT': {
    en: ['but are not all the same sex', 'but are not the same sex'],
    id: ['tidak semuanya berjenis', 'tidak berjenis'],
  },
  'warnings.PINNED_MIXED_SEX': {
    en: ['but are not all the same sex', 'but are not the same sex'],
    id: ['tidak semuanya berjenis', 'tidak berjenis'],
  },
};

const namesOf = (params: MessageParams) =>
  Array.isArray(params.names) ? (params.names as readonly string[]) : [];

/** The `howMany` slot the engine fills from the number of names (#505). */
function withHowMany(path: string, params: MessageParams): MessageParams {
  if (!(path in TWO_NAMES_AFTER_DECISION)) return params;
  return { ...params, howMany: namesOf(params).length === 2 ? 'two' : 'more' };
}

function withTwoNamesDecision(
  before: string,
  path: string,
  params: MessageParams,
  locale: 'en' | 'id',
): string {
  const decision = TWO_NAMES_AFTER_DECISION[path]?.[locale];
  if (!decision || namesOf(params).length !== 2) return before;
  const [old, now] = decision;
  if (before.split(old).length !== 2)
    throw new Error(`expected ${JSON.stringify(old)} once in ${before}`);
  return before.replace(old, () => now);
}

const messageAt = (table: unknown, path: string) =>
  path
    .split('.')
    .reduce<unknown>(
      (node, key) => (node as Record<string, unknown>)[key],
      table,
    ) as (params: MessageParams) => string;

describe('messages render what the function-era catalogues rendered (#136)', () => {
  it('reads the snapshot this file was written against', () => {
    expect(snapshot.domains.string).toContain(HOSTILE);
  });

  it('covers exactly the messages English declares as templates', () => {
    const messages = stringLeaves(en)
      .filter(([, value]) => isMessageTemplate(value))
      .map(([path]) => path);
    expect(messages.sort()).toEqual(Object.keys(snapshot.messages).sort());
  });

  for (const locale of ['en', 'id'] as const) {
    for (const [path, cases] of Object.entries(snapshot.messages)) {
      it(`${locale}: ${path}`, () => {
        const strings = getStrings(locale);
        for (const c of cases) {
          const actual =
            path === 'errors.PINNED_TOO_MANY_GROUPS'
              ? // Its choice of sentence moved out of the catalogue and into
                // renderError, so it is proved through renderError.
                renderError(
                  {
                    code: ERROR_CODES.pinnedTooManyGroups,
                    ...c.params,
                  } as GroupingError,
                  strings,
                )
              : messageAt(strings, path)(withHowMany(path, c.params));
          expect(actual, JSON.stringify(c.params)).toBe(
            withTwoNamesDecision(
              withListDecision(c[locale], c.params, locale),
              path,
              c.params,
              locale,
            ),
          );
        }
      });
    }
  }
});

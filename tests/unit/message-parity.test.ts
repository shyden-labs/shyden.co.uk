import ts from 'typescript';
import { describe, expect, it } from 'vitest';
import { nonEmpty, searched } from '../source-files';
import { floorBreach } from '../floors';
import { parseFile } from './ast';
import { stringLeaves } from '../../src/lib/catalogue-leaves';
import { DEFAULT_LOCALE, LOCALES, type Locale } from '../../src/lib/i18n';
import { en, type Catalogue } from '../../src/lib/i18n/en';
import { id } from '../../src/lib/i18n/id';
import { LOCALE_METADATA } from '../../src/lib/i18n/metadata';
import {
  describeMessage,
  isMessageTemplate,
  type MessageDescription,
} from '../../src/lib/i18n/message';
import { th } from '../../src/lib/i18n/th';
import { vi } from '../../src/lib/i18n/vi';
import { zh } from '../../src/lib/i18n/zh';

/**
 * Every language builds each message the way English builds it (#136).
 *
 * English is the reference: it decides which entries are messages and which
 * slots each one fills. A translation that loses a slot still reads as a
 * sentence -- one with a pupil's name missing. One that keeps English's "one"
 * form in a language that has none carries copy no count ever reaches. Neither
 * shows up in a check that compares text, so these compare structure.
 */

const CATALOGUES: Record<Locale, Catalogue> = { en, id, zh, vi, th };

const TRANSLATIONS = LOCALES.filter((locale) => locale !== DEFAULT_LOCALE);

const ENGLISH = nonEmpty(stringLeaves(en), 'English catalogue strings');

const MESSAGES = nonEmpty(
  ENGLISH.filter(([, text]) => isMessageTemplate(text)),
  'English messages',
);

const MESSAGE_PATHS = new Set(MESSAGES.map(([path]) => path));

/** One reading of a string's structure, or why there is none to read. */
function structure(
  text: string | undefined,
  read: (description: MessageDescription) => string,
): string {
  if (text === undefined) return '(missing)';
  try {
    return read(describeMessage(text));
  } catch (error) {
    return `(unparseable: ${(error as Error).message})`;
  }
}

const slotsOf = (text: string | undefined): string =>
  structure(text, ({ slots }) => Object.keys(slots).sort().join(', '));

const choicesOf = (text: string | undefined): string =>
  structure(text, ({ selects }) =>
    selects
      .map(({ name, keys }) => `${name} {${[...keys].sort().join(' ')}}`)
      .sort()
      .join('; '),
  );

/** Whether an import brings in a value, not only a type. */
function bindsAValue({ importClause }: ts.ImportDeclaration): boolean {
  if (!importClause || importClause.phaseModifier === ts.SyntaxKind.TypeKeyword)
    return false;
  if (importClause.name) return true;
  const bindings = importClause.namedBindings;
  return (
    bindings !== undefined &&
    (ts.isNamespaceImport(bindings) ||
      bindings.elements.some((element) => !element.isTypeOnly))
  );
}

/** The paths a catalogue file declares `as Message<...>`, from its syntax. */
function declaredMessages(file: string, name: string): string[] {
  const source = parseFile(file);
  const initializer = source.statements
    .filter(ts.isVariableStatement)
    .flatMap(({ declarationList }) => [...declarationList.declarations])
    .find(
      (declaration) => declaration.name.getText(source) === name,
    )?.initializer;
  if (!initializer) throw new Error(`${file} declares no ${name}`);
  const declared: string[] = [];
  const walk = (node: ts.Expression, path: string): void => {
    if (
      ts.isAsExpression(node) &&
      ts.isTypeReferenceNode(node.type) &&
      node.type.typeName.getText(source) === 'Message'
    ) {
      declared.push(path);
    } else if (ts.isObjectLiteralExpression(node)) {
      for (const property of node.properties) {
        if (!ts.isPropertyAssignment(property))
          throw new Error(
            `${file}: "${property.getText(source).slice(0, 40)}" is not a plain property, so no path addresses it`,
          );
        const key =
          ts.isIdentifier(property.name) || ts.isStringLiteral(property.name)
            ? property.name.text
            : property.name.getText(source);
        walk(property.initializer, path ? `${path}.${key}` : key);
      }
    } else if (ts.isArrayLiteralExpression(node)) {
      node.elements.forEach((element, index) =>
        walk(element, `${path}[${index}]`),
      );
    }
  };
  walk(initializer, '');
  return declared;
}

describe('every language builds each message the way English does (#136)', () => {
  it('holds a catalogue for every locale the site serves', () => {
    expect(Object.keys(CATALOGUES).sort()).toEqual([...LOCALES].sort());
  });

  it('English declares exactly the entries that are messages', () => {
    // `as Message<...>` is what makes an entry a function in the type a page
    // sees; having a slot is what makes it one at runtime. Where the two
    // disagree, a page either calls a string or prints a function.
    expect(declaredMessages('src/lib/i18n/en.ts', 'en').sort()).toEqual(
      [...MESSAGE_PATHS].sort(),
    );
  });

  // One id per locale: each case runs the same line over its own catalogue.
  const ENGLISH_IMPORTS_FLOOR: Readonly<Record<string, string>> = {
    id: 'message-parity/english-imports-id',
    zh: 'message-parity/english-imports-zh',
    vi: 'message-parity/english-imports-vi',
    th: 'message-parity/english-imports-th',
  };
  // One id per locale, for the same reason.
  const SLOT_STRINGS_FLOOR: Readonly<Record<string, string>> = {
    id: 'message-parity/slot-checked-strings-id',
    zh: 'message-parity/slot-checked-strings-zh',
    vi: 'message-parity/slot-checked-strings-vi',
    th: 'message-parity/slot-checked-strings-th',
  };
  // One id per locale, for the same reason.
  const CHOICE_MESSAGES_FLOOR: Readonly<Record<string, string>> = {
    id: 'message-parity/choice-checked-messages-id',
    zh: 'message-parity/choice-checked-messages-zh',
    vi: 'message-parity/choice-checked-messages-vi',
    th: 'message-parity/choice-checked-messages-th',
  };

  it.each(TRANSLATIONS)(
    '%s takes nothing from English but its type',
    (locale) => {
      // A value import of `en` is the only way English copy reaches another
      // catalogue by reference -- which is how zh, vi and th carried 51
      // English messages until #136, plain on the page and to no text check.
      const file = `src/lib/i18n/${locale}.ts`;
      const source = parseFile(file);
      const fromEnglish = source.statements.filter(
        (statement): statement is ts.ImportDeclaration =>
          ts.isImportDeclaration(statement) &&
          /^['"]\.\/en(\.ts)?['"]$/.test(
            statement.moduleSpecifier.getText(source),
          ),
      );
      const imports = fromEnglish.map((declaration) =>
        declaration.getText(source),
      );
      expect(
        searched(
          fromEnglish
            .filter(bindsAValue)
            .map((declaration) => declaration.getText(source)),
          { of: imports, what: `imports from en.ts in ${file}` },
        ),
      ).toEqual([]);
      expect(
        floorBreach(ENGLISH_IMPORTS_FLOOR[locale], imports.length),
      ).toBeUndefined();
    },
  );

  it.each(TRANSLATIONS)(
    '%s fills the slots English fills, in every string',
    (locale) => {
      const table = new Map(stringLeaves(CATALOGUES[locale]));
      const differing = ENGLISH.filter(
        ([path, english]) => slotsOf(table.get(path)) !== slotsOf(english),
      ).map(
        ([path, english]) =>
          `${path}: {${slotsOf(table.get(path))}} where English has {${slotsOf(english)}}`,
      );
      const paths = ENGLISH.map(([path]) => path);
      expect(
        searched(differing, { of: paths, what: 'English catalogue strings' }),
      ).toEqual([]);
      expect(
        floorBreach(SLOT_STRINGS_FLOOR[locale], paths.length),
      ).toBeUndefined();
    },
  );

  it.each(TRANSLATIONS)(
    '%s offers every choice of sentence English offers',
    (locale) => {
      const table = new Map(stringLeaves(CATALOGUES[locale]));
      const choosing = MESSAGES.filter(([, english]) => choicesOf(english));
      const differing = choosing
        .filter(
          ([path, english]) =>
            choicesOf(table.get(path)) !== choicesOf(english),
        )
        .map(
          ([path, english]) =>
            `${path}: "${choicesOf(table.get(path))}" where English has "${choicesOf(english)}"`,
        );
      const choosers = choosing.map(([path]) => path);
      expect(
        searched(differing, {
          of: choosers,
          what: 'English messages that choose a sentence',
        }),
      ).toEqual([]);
      expect(
        floorBreach(CHOICE_MESSAGES_FLOOR[locale], choosers.length),
      ).toBeUndefined();
    },
  );

  it('every plural offers exactly the forms its language has', () => {
    // CLDR decides, through the same Intl.PluralRules a page renders with:
    // English has "one" and "other"; Indonesian, Chinese, Vietnamese and Thai
    // have "other" alone. A form the language lacks is copy no count reaches,
    // and a form it has that the message lacks is the "1 groups" bug.
    const plurals = LOCALES.flatMap((locale) => {
      const forms = [
        ...new Intl.PluralRules(
          LOCALE_METADATA[locale].numberLocale,
        ).resolvedOptions().pluralCategories,
      ]
        .sort()
        .join(' ');
      return stringLeaves(CATALOGUES[locale])
        .filter(([path]) => MESSAGE_PATHS.has(path))
        .flatMap(([path, text]) =>
          describeMessage(text).plurals.map(({ name, keys }) => ({
            where: `${locale} ${path} {${name}}`,
            offers: keys
              .filter((key) => !key.startsWith('='))
              .sort()
              .join(' '),
            forms,
          })),
        );
    });
    const wrong = plurals
      .filter(({ offers, forms }) => offers !== forms)
      .map(
        ({ where, offers, forms }) =>
          `${where} offers "${offers}", the language has "${forms}"`,
      );
    const judged = plurals.map(({ where }) => where);
    expect(
      searched(wrong, { of: judged, what: 'plurals across every catalogue' }),
    ).toEqual([]);
    expect(
      floorBreach('message-parity/plurals', judged.length),
    ).toBeUndefined();
  });
});

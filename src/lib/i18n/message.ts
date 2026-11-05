/**
 * Messages with named slots, in the shape of ICU MessageFormat (#136).
 *
 * A parameterised message used to be an arrow function in each catalogue.
 * That rendered English on every non-English page -- a translator returns a
 * sentence, not a function body, so zh, vi and th referenced `en.<key>` -- and
 * it put logic (a ternary per plural, a hand-written list join) where only
 * copy belongs. A template separates the two: the catalogue holds prose with
 * slots, and this module supplies the grammar for the page's language (plural
 * rules from the platform's CLDR data, list joins from its own table), so no
 * translator writes code and no catalogue hand-writes a join.
 *
 * The supported subset, and nothing else:
 *
 * - `{name}` -- a string or number exactly as given (numbers without grouping
 *   separators, as the function-era copy wrote them). An array is a
 *   conjunction list in the page's language, from `LIST_JOINS` below.
 * - `{name, plural, one {…} other {…}}` -- the CLDR categories (`zero`, `one`,
 *   `two`, `few`, `many`, `other`) plus exact `=N` branches, which win.
 *   `other` is required. Directly inside a branch, `#` is the count. An
 *   array's count is its length, so a sentence about a list agrees with the
 *   list it shows.
 * - `{name, select, key {…} other {…}}` -- `other` is required.
 *
 * One deliberate departure from ICU: an apostrophe is ALWAYS literal. ICU
 * reads `'{` as the start of quoted text, and this copy quotes teacher-typed
 * values exactly that way -- `number '{value}' is not a whole number` -- so
 * ICU's rule would print the slot instead of its value. A literal brace is
 * therefore not expressible in a template, and no copy needs one.
 *
 * Values are substituted after parsing and never parsed themselves, so a name
 * a teacher typed as `D'Arcy {n} #` renders as exactly that.
 */

export type MessageValue =
  string | number | readonly string[] | readonly number[];

export type MessageParams = Readonly<Record<string, MessageValue>>;

declare const messageParams: unique symbol;

/**
 * A template whose slots take `P`, declared in `en.ts` (the reference) as
 * `'Group {n}' as Message<{ n: number }>`.
 *
 * A plain string at runtime. The brand exists only for the compiler, so a call
 * site cannot pass a slot the English template does not declare. It is an
 * assertion rather than a helper function on purpose: `en.ts` is loaded by the
 * i18n scripts under plain Node, which cannot resolve an extensionless VALUE
 * import, and a type-only import is erased before Node reads the file.
 */
export type Message<P extends MessageParams> = string & {
  readonly [messageParams]: P;
};

export class MessageSyntaxError extends Error {
  readonly template: string;
  readonly index: number;

  constructor(reason: string, template: string, index: number) {
    super(`${reason} (at ${index} in ${JSON.stringify(template)})`);
    this.name = 'MessageSyntaxError';
    this.template = template;
    this.index = index;
  }
}

type SlotKind = 'plural' | 'select' | 'value';

/**
 * One piece of a parsed template: literal text, a `#` count, a named value,
 * or a plural or select with its branches. Exported for the translation
 * harness, which cuts a message into the sentences it can say (#136).
 */
export type MessagePart =
  | { readonly kind: 'text'; readonly text: string }
  | { readonly kind: 'count' }
  | { readonly kind: 'value'; readonly name: string }
  | {
      readonly kind: 'plural' | 'select';
      readonly name: string;
      readonly branches: ReadonlyMap<string, readonly MessagePart[]>;
    };

const PLURAL_CATEGORIES: ReadonlySet<string> = new Set([
  'zero',
  'one',
  'two',
  'few',
  'many',
  'other',
]);
const NAME = /[A-Za-z_][A-Za-z0-9_]*/y;
const EXACT_KEY = /=\d+/y;
const SELECT_KEY = /[A-Za-z0-9_-]+/y;

class Parser {
  private index = 0;
  private readonly template: string;

  // Plain fields, not parameter properties, here and in MessageSyntaxError:
  // the DeepL scripts load this module with Node's type stripping, which
  // refuses TypeScript that has to compile to run.
  constructor(template: string) {
    this.template = template;
  }

  parse(): readonly MessagePart[] {
    const parts = this.parts(false);
    if (this.index < this.template.length) this.fail('unmatched "}"');
    return parts;
  }

  /** Parts up to the end of input, or up to a `}` this level does not own. */
  private parts(inPlural: boolean): MessagePart[] {
    const parts: MessagePart[] = [];
    let text = '';
    const flush = () => {
      if (text) parts.push({ kind: 'text', text });
      text = '';
    };
    while (this.index < this.template.length) {
      const char = this.template[this.index];
      if (char === '}') break;
      if (char === '{') {
        flush();
        parts.push(this.slot());
      } else if (char === '#' && inPlural) {
        flush();
        parts.push({ kind: 'count' });
        this.index += 1;
      } else {
        text += char;
        this.index += 1;
      }
    }
    flush();
    return parts;
  }

  private slot(): MessagePart {
    const open = this.index;
    this.index += 1;
    this.skipSpace();
    const name = this.match(NAME) ?? this.fail('expected a slot name');
    this.skipSpace();
    const next = this.template[this.index];
    if (next === '}') {
      this.index += 1;
      return { kind: 'value', name };
    }
    if (next !== ',') this.fail('unterminated slot', open);
    this.index += 1;
    this.skipSpace();
    const kind = this.match(NAME);
    if (kind !== 'plural' && kind !== 'select')
      this.fail(`unsupported format ${JSON.stringify(kind ?? '')}`);
    this.skipSpace();
    if (this.template[this.index] !== ',')
      this.fail(`expected "," after ${kind}`);
    this.index += 1;

    const branches = new Map<string, readonly MessagePart[]>();
    for (;;) {
      this.skipSpace();
      if (this.template[this.index] === '}') break;
      if (this.index >= this.template.length)
        this.fail('unterminated slot', open);
      const keyAt = this.index;
      const key =
        (kind === 'plural'
          ? (this.match(EXACT_KEY) ?? this.match(NAME))
          : this.match(SELECT_KEY)) ?? this.fail('expected a branch key');
      if (
        kind === 'plural' &&
        !key.startsWith('=') &&
        !PLURAL_CATEGORIES.has(key)
      )
        this.fail(`"${key}" is not a CLDR plural category`, keyAt);
      if (branches.has(key)) this.fail(`branch "${key}" is given twice`, keyAt);
      this.skipSpace();
      if (this.template[this.index] !== '{')
        this.fail(`branch "${key}" has no body`, keyAt);
      this.index += 1;
      const body = this.parts(kind === 'plural');
      if (this.template[this.index] !== '}')
        this.fail(`branch "${key}" is unterminated`, keyAt);
      this.index += 1;
      branches.set(key, body);
    }
    this.index += 1;
    if (!branches.has('other'))
      this.fail(`${kind} needs an "other" branch`, open);
    return { kind, name, branches };
  }

  private match(pattern: RegExp): string | undefined {
    pattern.lastIndex = this.index;
    const found = pattern.exec(this.template);
    if (!found) return undefined;
    this.index += found[0].length;
    return found[0];
  }

  private skipSpace(): void {
    while (/\s/.test(this.template[this.index] ?? '')) this.index += 1;
  }

  private fail(reason: string, at = this.index): never {
    throw new MessageSyntaxError(reason, this.template, at);
  }
}

const parsed = new Map<string, readonly MessagePart[]>();

/**
 * A template's parts, parsed once and cached. Throws `MessageSyntaxError`
 * for a template this format does not accept.
 */
export function parseMessage(template: string): readonly MessagePart[] {
  let parts = parsed.get(template);
  if (!parts) {
    parts = new Parser(template).parse();
    parsed.set(template, parts);
  }
  return parts;
}

const perLocale = <T>(make: (locale: string) => T) => {
  const made = new Map<string, T>();
  return (locale: string): T => {
    let value = made.get(locale);
    if (value === undefined) {
      value = make(locale);
      made.set(locale, value);
    }
    return value;
  };
};

const pluralRules = perLocale((locale) => new Intl.PluralRules(locale));

/**
 * How each language joins a list: `between` separates every item but the
 * last, `two` joins a two-item list, `last` puts the final item on a longer
 * one.
 *
 * The site writes these itself rather than asking `Intl.ListFormat` (Shyden,
 * 2026-11-02, #1008), so every browser shows one spelling: macOS WebKit's ICU
 * spaced Thai "และ" where Linux and Android did not. en, id, zh and vi are
 * CLDR 48's conjunction lists for the site's locales (en-GB, so no comma
 * before "and"). Thai is spaced on both sides of "และ" by Shyden's ruling,
 * following Thai usage around numerals and CLDR's own Thai quantity list,
 * where CLDR's word list writes `{0}และ{1}`.
 */
const LIST_JOINS: Readonly<
  Record<
    string,
    { readonly between: string; readonly two: string; readonly last: string }
  >
> = {
  en: { between: ', ', two: ' and ', last: ' and ' },
  id: { between: ', ', two: ' dan ', last: ', dan ' },
  zh: { between: '、', two: '和', last: '和' },
  vi: { between: ', ', two: ' và ', last: ' và ' },
  th: { between: ' ', two: ' และ ', last: ' และ ' },
};

function joinList(items: readonly string[], locale: string): string {
  const join = LIST_JOINS[locale.split('-')[0].toLowerCase()];
  if (join === undefined) throw new Error(`no list join for ${locale}`);
  if (items.length <= 1) return items.join('');
  if (items.length === 2) return items.join(join.two);
  return items.slice(0, -1).join(join.between) + join.last + items.at(-1);
}

const isList = (
  value: MessageValue,
): value is readonly string[] | readonly number[] => Array.isArray(value);

function valueOf(params: MessageParams, name: string): MessageValue {
  if (!Object.prototype.hasOwnProperty.call(params, name))
    throw new Error(`no value was given for {${name}}`);
  return params[name];
}

function countOf(value: MessageValue, name: string): number {
  if (typeof value === 'number') return value;
  if (isList(value)) return value.length;
  throw new Error(
    `{${name}} is a plural, so it takes a number or a list, not ${JSON.stringify(value)}`,
  );
}

function render(
  parts: readonly MessagePart[],
  params: MessageParams,
  locale: string,
  count: number | undefined,
): string {
  let out = '';
  for (const part of parts) {
    switch (part.kind) {
      case 'text':
        out += part.text;
        break;
      case 'count':
        // The parser only emits `#` directly inside a plural branch.
        if (count === undefined) throw new Error('# outside a plural');
        out += String(count);
        break;
      case 'value': {
        const value = valueOf(params, part.name);
        out += isList(value)
          ? joinList(value.map(String), locale)
          : String(value);
        break;
      }
      case 'plural': {
        const n = countOf(valueOf(params, part.name), part.name);
        const branch =
          part.branches.get(`=${n}`) ??
          part.branches.get(pluralRules(locale).select(n)) ??
          part.branches.get('other');
        out += render(branch ?? [], params, locale, n);
        break;
      }
      case 'select': {
        const value = valueOf(params, part.name);
        if (isList(value))
          throw new Error(
            `{${part.name}} is a select, so it takes one value, not a list`,
          );
        const branch =
          part.branches.get(String(value)) ?? part.branches.get('other');
        out += render(branch ?? [], params, locale, undefined);
        break;
      }
    }
  }
  return out;
}

/** Render a template in a BCP-47 locale (`LOCALE_METADATA[locale].numberLocale`). */
export function formatMessage(
  template: string,
  params: MessageParams,
  locale: string,
): string {
  return render(parseMessage(template), params, locale, undefined);
}

/** Whether copy has any slot at all -- the runtime mark of a message. */
export const isMessageTemplate = (text: string): boolean =>
  parseMessage(text).some((part) => part.kind !== 'text');

export interface MessageDescription {
  /** Each slot name, with every way the template uses it, sorted. */
  readonly slots: Readonly<Record<string, readonly SlotKind[]>>;
  readonly plurals: readonly {
    readonly name: string;
    readonly keys: readonly string[];
  }[];
  readonly selects: readonly {
    readonly name: string;
    readonly keys: readonly string[];
  }[];
}

/** The structure of a template, for the guards that compare locales. */
export function describeMessage(template: string): MessageDescription {
  const slots = new Map<string, Set<SlotKind>>();
  const plurals: { name: string; keys: string[] }[] = [];
  const selects: { name: string; keys: string[] }[] = [];
  const walk = (parts: readonly MessagePart[]): void => {
    for (const part of parts) {
      if (part.kind === 'text' || part.kind === 'count') continue;
      const kinds = slots.get(part.name) ?? new Set<SlotKind>();
      slots.set(part.name, kinds);
      kinds.add(part.kind);
      if (part.kind === 'value') continue;
      (part.kind === 'plural' ? plurals : selects).push({
        name: part.name,
        keys: [...part.branches.keys()],
      });
      for (const branch of part.branches.values()) walk(branch);
    }
  };
  walk(parseMessage(template));
  return {
    slots: Object.fromEntries(
      [...slots].map(([name, kinds]) => [name, [...kinds].sort()]),
    ),
    plurals,
    selects,
  };
}

/**
 * What the reference catalogue's type becomes once compiled: every template
 * a function of its named slots, everything else unchanged.
 */
export type Compiled<T> = {
  readonly [K in keyof T]: T[K] extends Message<infer P extends MessageParams>
    ? (params: P) => string
    : T[K] extends readonly unknown[]
      ? T[K]
      : T[K] extends object
        ? Compiled<T[K]>
        : T[K];
};

/**
 * The shape a translation takes: the reference's keys, with every template a
 * plain string -- a translator writes prose, never a type.
 */
export type Translatable<T> = {
  readonly [K in keyof T]: T[K] extends Message<MessageParams>
    ? string
    : T[K] extends readonly unknown[]
      ? T[K]
      : T[K] extends object
        ? Translatable<T[K]>
        : T[K];
};

/**
 * Compile a catalogue against the reference that declares its templates.
 *
 * The REFERENCE decides what is a message (a string with any slot), so a
 * translation cannot promote plain copy into a function, or demote a message
 * into copy, by what it happens to contain; the parity guard in the i18n
 * tests holds both sides to the same slots. Every template is parsed here,
 * eagerly: a malformed translation fails when the page loads its strings,
 * never halfway through a teacher's click.
 */
export function compileCatalogue<T>(
  reference: T,
  table: Translatable<T>,
  locale: string,
): Compiled<T> {
  const compile = (ref: unknown, value: unknown, path: string): unknown => {
    if (typeof ref === 'string') {
      if (!isMessageTemplate(ref)) return value;
      if (typeof value !== 'string')
        throw new Error(
          `${path}: the catalogue has no template for this message`,
        );
      parseMessage(value);
      return (params: MessageParams) => formatMessage(value, params, locale);
    }
    if (!ref || typeof ref !== 'object' || Array.isArray(ref)) return value;
    const values = (value ?? {}) as Record<string, unknown>;
    return Object.fromEntries(
      Object.entries(ref).map(([key, child]) => [
        key,
        compile(child, values[key], path ? `${path}.${key}` : key),
      ]),
    );
  };
  return compile(reference, table, '') as Compiled<T>;
}

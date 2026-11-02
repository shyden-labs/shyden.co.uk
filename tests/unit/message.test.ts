import { describe, expect, it } from 'vitest';
import {
  MessageSyntaxError,
  describeMessage,
  formatMessage,
  isMessageTemplate,
} from '../../src/lib/i18n/message';

/**
 * The message format every catalogue speaks (#136).
 *
 * A parameterised message used to be an arrow function: it rendered English
 * on every page, and it could not be handed to a translator, who returns a
 * sentence rather than a function body. It is now a template -- prose with
 * named slots, in the shape of ICU MessageFormat.
 *
 * Expected values here are LITERALS, measured once from the platform and
 * written down. They are never recomputed with `Intl` inside the test: an
 * implementation that passed `'en'` where it means `'en-GB'` would get
 * "A, B, and C" from both sides and pass.
 */

/** Everything a teacher could type into a name that is ALSO template syntax. */
const HOSTILE = "D'Arcy {n} #";

describe('formatMessage: slots', () => {
  it('returns copy with no slots unchanged', () => {
    expect(formatMessage('Your groups', {}, 'en-GB')).toBe('Your groups');
  });

  it('writes a string or a number into its slot as given', () => {
    expect(
      formatMessage('Group {n} of {total}', { n: 3, total: 'nine' }, 'en-GB'),
    ).toBe('Group 3 of nine');
  });

  it('never reads a value as template syntax: braces, # and quotes come out literally', () => {
    expect(formatMessage('{name} is pinned', { name: HOSTILE }, 'en-GB')).toBe(
      `${HOSTILE} is pinned`,
    );
  });

  it("keeps an apostrophe literal beside a slot, where ICU quoting would swallow '{value}'", () => {
    expect(
      formatMessage(
        "Row 2 — number '{value}' is not a whole number.",
        { value: '4.5' },
        'en-GB',
      ),
    ).toBe("Row 2 — number '4.5' is not a whole number.");
  });

  it('writes numbers without grouping separators, as the function-era copy did', () => {
    expect(formatMessage('The most is {max}.', { max: 12345 }, 'en-GB')).toBe(
      'The most is 12345.',
    );
  });

  it('refuses to render a slot it was given no value for, naming it', () => {
    expect(() => formatMessage('Hello {name}', {}, 'en-GB')).toThrow(
      'no value was given for {name}',
    );
  });
});

describe('formatMessage: lists', () => {
  it.each([
    ['en-GB', 'Ana, Budi and Citra'],
    ['id', 'Ana, Budi, dan Citra'],
    ['zh-Hans', 'Ana、Budi和Citra'],
    ['vi', 'Ana, Budi và Citra'],
    ['th', 'Ana Budi และ Citra'],
  ])(
    '%s: an array slot is a conjunction list in the page language',
    (locale, expected) => {
      expect(
        formatMessage('{names}', { names: ['Ana', 'Budi', 'Citra'] }, locale),
      ).toBe(expected);
    },
  );

  it.each([
    ['en-GB', 'Ana and Budi'],
    ['id-ID', 'Ana dan Budi'],
    ['zh-CN', 'Ana和Budi'],
    ['vi-VN', 'Ana và Budi'],
    ['th-TH', 'Ana และ Budi'],
  ])('%s: a two-item list takes its own join', (locale, expected) => {
    expect(formatMessage('{names}', { names: ['Ana', 'Budi'] }, locale)).toBe(
      expected,
    );
  });

  it.each([
    ['en-GB', 'Ana, Budi, Citra and Dewi'],
    ['id-ID', 'Ana, Budi, Citra, dan Dewi'],
    ['zh-CN', 'Ana、Budi、Citra和Dewi'],
    ['vi-VN', 'Ana, Budi, Citra và Dewi'],
    ['th-TH', 'Ana Budi Citra และ Dewi'],
  ])('%s: a longer list repeats its middle separator', (locale, expected) => {
    expect(
      formatMessage(
        '{names}',
        { names: ['Ana', 'Budi', 'Citra', 'Dewi'] },
        locale,
      ),
    ).toBe(expected);
  });

  // Shyden 2026-11-02 (#1008): the site joins lists itself, so every browser
  // shows one spelling. macOS WebKit's ICU spaced Thai "และ" where Linux and
  // Android did not; an engine that formats lists differently, or not at all,
  // must not change what the page says.
  it('does not depend on the engine formatting lists', () => {
    const engine = Intl.ListFormat;
    Object.defineProperty(Intl, 'ListFormat', {
      configurable: true,
      value: function refused() {
        throw new Error('Intl.ListFormat was called');
      },
    });
    try {
      expect(formatMessage('{n}', { n: [3, 7] }, 'th-TH')).toBe('3 และ 7');
    } finally {
      Object.defineProperty(Intl, 'ListFormat', {
        configurable: true,
        value: engine,
      });
    }
  });

  it('refuses a language it has no join for, naming it', () => {
    expect(() => formatMessage('{n}', { n: [1, 2] }, 'fr-FR')).toThrow(
      'no list join for fr-FR',
    );
  });

  it('a one-item list is just that item', () => {
    expect(formatMessage('{names} left', { names: ['Ana'] }, 'en-GB')).toBe(
      'Ana left',
    );
  });

  it('lists numbers as well as names', () => {
    expect(
      formatMessage('Numbers {missing}', { missing: [4, 6, 7] }, 'en-GB'),
    ).toBe('Numbers 4, 6 and 7');
  });

  it('keeps a hostile name literal inside a list', () => {
    expect(formatMessage('{names}', { names: ['Ana', HOSTILE] }, 'en-GB')).toBe(
      `Ana and ${HOSTILE}`,
    );
  });
});

describe('formatMessage: plurals', () => {
  const students = '{count, plural, one {# student} other {# students}}';

  it.each([
    [0, '0 students'],
    [1, '1 student'],
    [2, '2 students'],
    [21, '21 students'],
  ])(
    'en-GB: %i picks its CLDR category, and # is the count',
    (count, expected) => {
      expect(formatMessage(students, { count }, 'en-GB')).toBe(expected);
    },
  );

  it.each(['id', 'zh-Hans', 'vi', 'th'])(
    '%s: has only `other`, so a count of 1 takes it too',
    (locale) => {
      expect(formatMessage(students, { count: 1 }, locale)).toBe('1 students');
    },
  );

  it('an exact =N branch wins over the category', () => {
    expect(
      formatMessage(
        '{n, plural, =0 {none left} one {# left} other {# left}}',
        { n: 0 },
        'en-GB',
      ),
    ).toBe('none left');
  });

  it('counts an array by its length', () => {
    expect(
      formatMessage(
        '{names} {names, plural, one {has} other {have}} left',
        { names: ['Ana', 'Budi'] },
        'en-GB',
      ),
    ).toBe('Ana and Budi have left');
  });

  it('keeps # literal outside a plural', () => {
    expect(formatMessage('Row #{row}', { row: 3 }, 'en-GB')).toBe('Row #3');
  });

  it('# inside a nested plural is the innermost count', () => {
    expect(
      formatMessage(
        '{a, plural, other {# groups, {b, plural, one {# student} other {# students}}}}',
        { a: 3, b: 1 },
        'en-GB',
      ),
    ).toBe('3 groups, 1 student');
  });

  it('refuses a plural over a value that is not a count', () => {
    expect(() => formatMessage(students, { count: 'many' }, 'en-GB')).toThrow(
      '{count} is a plural, so it takes a number or a list, not "many"',
    );
  });
});

describe('formatMessage: select', () => {
  const joined = '{sex, select, M {joined the girls} other {joined the boys}}';

  it('picks the branch the value names', () => {
    expect(formatMessage(joined, { sex: 'M' }, 'en-GB')).toBe(
      'joined the girls',
    );
  });

  it('falls back to other for any value without its own branch', () => {
    expect(formatMessage(joined, { sex: 'F' }, 'en-GB')).toBe(
      'joined the boys',
    );
  });

  it('a branch can hold slots and a plural of its own', () => {
    expect(
      formatMessage(
        '{s, select, over {{n, plural, one {# pin} other {# pins}} too many} other {fine}}',
        { s: 'over', n: 2 },
        'en-GB',
      ),
    ).toBe('2 pins too many');
  });
});

describe('malformed templates fail loudly, never render half a sentence', () => {
  // Each case pins its REASON and position, not just the error class: every
  // check throws the same class, so a table asserting only the class stayed
  // green when a check was deleted and the case fell through to the next
  // check that happened to refuse it (#390, MS5 MS6 MS8 MS11).
  it.each([
    ['an unterminated slot', 'Hello {name', 'unterminated slot (at 6 '],
    ['a stray closing brace', 'Hello name}', 'unmatched "}" (at 10 '],
    ['an empty slot', 'Hello {}', 'expected a slot name (at 7 '],
    [
      'a slot name that is not an identifier',
      'Hello {1st}',
      'expected a slot name (at 7 ',
    ],
    [
      'a format this subset does not implement',
      'The most is {n, number}',
      'unsupported format "number" (at 22 ',
    ],
    [
      'a plural without other',
      '{n, plural, one {x}}',
      'plural needs an "other" branch (at 0 ',
    ],
    [
      'a select without other',
      '{s, select, M {x}}',
      'select needs an "other" branch (at 0 ',
    ],
    [
      'a plural key that is no CLDR category',
      '{n, plural, single {x} other {y}}',
      '"single" is not a CLDR plural category (at 12 ',
    ],
    [
      'a branch key given twice',
      '{n, plural, one {x} one {y} other {z}}',
      'branch "one" is given twice (at 20 ',
    ],
    [
      'a branch key with no body',
      '{n, plural, one other {y}}',
      'branch "one" has no body (at 12 ',
    ],
    [
      'a plural with no branches at all',
      '{n, plural, }',
      'plural needs an "other" branch (at 0 ',
    ],
    [
      'a plural with no comma before its branches',
      '{n, plural other {x}}',
      'expected "," after plural (at 11 ',
    ],
    [
      'a plural that never closes after its last branch',
      '{n, plural, other {x}',
      'unterminated slot (at 0 ',
    ],
    [
      'a branch that never closes',
      '{n, plural, other {x',
      'branch "other" is unterminated (at 12 ',
    ],
  ])('%s', (_, template, reason) => {
    const run = () =>
      formatMessage(template, { name: 'x', n: 1, s: 'M' }, 'en-GB');
    expect(run).toThrow(MessageSyntaxError);
    expect(run).toThrow(`${reason}in ${JSON.stringify(template)})`);
  });
});

describe('what the parser accepts at its edges', () => {
  it('reads a slot name with spaces inside the braces', () => {
    expect(formatMessage('Group { n }', { n: 3 }, 'en-GB')).toBe('Group 3');
  });

  it('keeps # literal directly inside a select branch, which is not a count', () => {
    expect(
      formatMessage('{s, select, other {Row #}}', { s: 'M' }, 'en-GB'),
    ).toBe('Row #');
  });

  it.each([
    ['7', 'Year 7'],
    ['year-8', 'Year 8'],
    ['9', 'another year'],
  ])('a select key may be a number or hyphenated: %s', (s, expected) => {
    expect(
      formatMessage(
        '{s, select, 7 {Year 7} year-8 {Year 8} other {another year}}',
        { s },
        'en-GB',
      ),
    ).toBe(expected);
  });

  it('refuses a list given to a select, which names one value', () => {
    expect(() =>
      formatMessage('{s, select, other {x}}', { s: ['M', 'F'] }, 'en-GB'),
    ).toThrow('{s} is a select, so it takes one value, not a list');
  });
});

describe('isMessageTemplate', () => {
  it('is false for plain copy', () => {
    expect(isMessageTemplate('Your groups')).toBe(false);
  });

  it('is true once there is any slot, plural or select', () => {
    expect(isMessageTemplate('Group {n}')).toBe(true);
    expect(isMessageTemplate('{n, plural, other {#}}')).toBe(true);
    expect(isMessageTemplate('{s, select, other {x}}')).toBe(true);
  });
});

describe('describeMessage', () => {
  it('names every slot with how it is used, and every block with its branch keys', () => {
    expect(
      describeMessage(
        '{sex, select, M {{names} {names, plural, one {has} other {have}} left} other {{names} stayed}}',
      ),
    ).toEqual({
      slots: { names: ['plural', 'value'], sex: ['select'] },
      plurals: [{ name: 'names', keys: ['one', 'other'] }],
      selects: [{ name: 'sex', keys: ['M', 'other'] }],
    });
  });

  it('reports nothing for plain copy', () => {
    expect(describeMessage('Your groups')).toEqual({
      slots: {},
      plurals: [],
      selects: [],
    });
  });
});

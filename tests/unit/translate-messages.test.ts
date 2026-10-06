import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';
import { filesUnder, nonEmpty, searched } from '../source-files';
import { floorBreach } from '../floors';
import { stringLeaves } from '../../src/lib/catalogue-leaves';
import { blankCommentLines } from './source-text';
import { en } from '../../src/lib/i18n/en';
import {
  MessageSyntaxError,
  describeMessage,
  isMessageTemplate,
} from '../../src/lib/i18n/message';
import {
  assembleMessage,
  betterDraft,
  buildRequestBody,
  messageUnits,
  needsSending,
  slotsKept,
  translationUnits,
} from '../../src/lib/i18n/translate';

/**
 * #136. A message goes to the translator as the sentences it can say, never
 * as its syntax.
 *
 * Sent whole, `{n, plural, one {# group} other {# groups}}` is prose to DeepL:
 * it translates "other", moves the braces, and hands back something no parser
 * accepts. So the harness cuts a template into sentences, the translator takes
 * those, and the template is rebuilt around what comes back -- then checked,
 * because a translation that drops a slot still reads as a sentence.
 *
 * Every language the harness drafts for has one plural form, "other" (CLDR,
 * through Intl.PluralRules), so a plural is sent as its "other" sentence. A
 * language with more forms is refused rather than handed a draft that is wrong
 * for all but one of them.
 */

/** A translator that knows exactly these sentences. */
const translator =
  (table: Readonly<Record<string, string>>) =>
  (unit: string): string | undefined =>
    table[unit];

const OTHER_ONLY = ['other'];

describe('a message is sent as the sentences it can say', () => {
  it('sends a message whose slots are all named, as it is', () => {
    expect(messageUnits('{names} are marked to stay together.')).toEqual([
      '{names} are marked to stay together.',
    ]);
  });

  it('sends a plural as its "other" sentence, with the count as a named slot', () => {
    expect(
      messageUnits('{n, plural, one {# group} other {# groups}} left'),
    ).toEqual(['{n} groups left']);
  });

  it('sends a choice as one whole sentence per branch, in the order written', () => {
    expect(
      messageUnits('{sex, select, M {Boys} other {Girls}} joined {names}.'),
    ).toEqual(['Boys joined {names}.', 'Girls joined {names}.']);
  });

  it('collapses a plural inside each branch of a choice', () => {
    expect(
      messageUnits(
        '{s, select, over {{n, plural, one {# too many} other {# too many}}} other {Fine}}',
      ),
    ).toEqual(['{n} too many', 'Fine']);
  });

  it('refuses a message it could not rebuild, rather than guessing', () => {
    expect(() =>
      messageUnits(
        '{a, select, x {One} other {Two}} {b, select, y {Three} other {Four}}',
      ),
    ).toThrow(
      'makes 2 choices of sentence, and a translation can be drafted for one select only',
    );
    // The reason, not `/=0/`: the error quotes the template, which carries
    // `=0` whatever the reason given.
    expect(() =>
      messageUnits('{n, plural, =0 {No one} other {# left}}'),
    ).toThrow(
      '{n} has the exact-match branch =0, which a sentence drafted from "other" cannot carry',
    );
  });

  it('refuses a choice nested inside another, which is two choices too', () => {
    expect(() =>
      messageUnits(
        '{a, select, x {{b, select, y {One} other {Two}}} other {Three}}',
      ),
    ).toThrow('makes 2 choices of sentence');
  });

  it('keeps the words before a choice in every sentence it sends', () => {
    expect(
      messageUnits('Now {sex, select, M {boys} other {girls}} join.'),
    ).toEqual(['Now boys join.', 'Now girls join.']);
  });

  it('sends every slot bare, and tags them only for a retry', () => {
    // Measured on DeepL (2026-09-13) over all 162 message sentences in zh, vi
    // and th. Inside the tag that protects a name, a slot was glued to the word
    // beside it in 44 ("Nhóm{n}") and once took a letter with it ("ít
    // nhấ{groupsNeeded}"). Bare, 3 were glued but 7 lost a slot, so a sentence
    // whose bare draft changed a slot is retried tagged -- see the block below.
    const sentence = '{names} joined {n} groups at Shyden.';
    const [bare] = buildRequestBody([sentence], 'zh').text;
    expect(bare).toBe('{names} joined {n} groups at <x>Shyden</x>.');
    const [tagged] = buildRequestBody([sentence], 'zh', {
      tagSlots: true,
    }).text;
    expect(tagged).toBe(
      '<x>{names}</x> joined <x>{n}</x> groups at <x>Shyden</x>.',
    );
  });

  it('sends copy as it is, a message as its sentences, and a symbol not at all', () => {
    expect(translationUnits('Add a student')).toEqual(['Add a student']);
    expect(
      translationUnits('{n, plural, one {# group} other {# groups}}'),
    ).toEqual(['{n} groups']);
    expect(translationUnits('#')).toEqual([]);
  });

  it('sends no syntax for any real English message', () => {
    const units = nonEmpty(
      stringLeaves(en)
        .filter(([, text]) => isMessageTemplate(text))
        .flatMap(([, text]) => translationUnits(text)),
      'sentences sent for English messages',
    );
    const withSyntax = units.filter((unit) => {
      const { plurals, selects } = describeMessage(unit);
      return plurals.length + selects.length > 0;
    });
    expect(
      searched(withSyntax, {
        of: units,
        what: 'sentences sent for English messages',
      }),
    ).toEqual([]);
    expect(
      floorBreach('translate-messages/sent-units', units.length),
    ).toBeUndefined();
  });
});

describe('a translated message is rebuilt, and checked', () => {
  it('rebuilds a plural as its one sentence', () => {
    expect(
      assembleMessage(
        '{n, plural, one {# group} other {# groups}} left',
        translator({ '{n} groups left': '剩下 {n} 个小组' }),
        OTHER_ONLY,
      ),
    ).toBe('剩下 {n} 个小组');
  });

  it('rebuilds a choice around its translated sentences', () => {
    expect(
      assembleMessage(
        '{sex, select, M {Boys} other {Girls}} joined {names}.',
        translator({
          'Boys joined {names}.': '男孩加入了 {names}。',
          'Girls joined {names}.': '女孩加入了 {names}。',
        }),
        OTHER_ONLY,
      ),
    ).toBe(
      '{sex, select, M {男孩加入了 {names}。} other {女孩加入了 {names}。}}',
    );
  });

  it('refuses a sentence nobody translated', () => {
    expect(() =>
      assembleMessage('{names} left.', translator({}), OTHER_ONLY),
    ).toThrow(/\{names\} left\./);
  });

  it('refuses a translation that loses a slot, invents one or repeats one', () => {
    const unit = '{names} left after {n} rounds.';
    for (const translation of [
      '{names} 离开了。',
      '{names} 和 {who} 在 {n} 轮后离开了。',
      '{names} 在 {n} 轮后离开了 {names}。',
    ])
      expect(
        () =>
          assembleMessage(
            unit,
            translator({ [unit]: translation }),
            OTHER_ONLY,
          ),
        translation,
      ).toThrow(/slots/);
  });

  it('accepts a translation that puts the same slots in another order', () => {
    // Word order is the translator's to change: Chinese puts the rounds first.
    const unit = '{names} left after {n} rounds.';
    expect(
      assembleMessage(
        unit,
        translator({ [unit]: '{n} 轮后 {names} 离开了。' }),
        OTHER_ONLY,
      ),
    ).toBe('{n} 轮后 {names} 离开了。');
  });

  it.each(['plural', 'select'])(
    'refuses a translation that turns a slot into a %s',
    (kind) => {
      const unit = '{names} left after {n} rounds.';
      expect(() =>
        assembleMessage(
          unit,
          translator({
            [unit]: `{names} 在 {n, ${kind}, other {几}} 轮后离开了。`,
          }),
          OTHER_ONLY,
        ),
      ).toThrow(
        `which fills the slots {(${kind}), names} instead of {n, names}`,
      );
    },
  );

  it('refuses a translation that is not a template', () => {
    expect(() =>
      assembleMessage(
        '{names} left.',
        translator({ '{names} left.': '{names 离开了。' }),
        OTHER_ONLY,
      ),
    ).toThrow(MessageSyntaxError);
  });

  it('refuses a language whose plurals need more than "other"', () => {
    // Russian has one, few, many and other. A draft cut from "other" alone
    // would be wrong for three of them and still read as right.
    const russian = ['few', 'many', 'one', 'other'];
    expect(() =>
      assembleMessage(
        '{n, plural, one {# group} other {# groups}}',
        translator({ '{n} groups': '{n} групп' }),
        russian,
      ),
    ).toThrow(/few, many, one, other/);
    // A message with no plural has nothing to collapse, in any language.
    expect(
      assembleMessage(
        '{names} left.',
        translator({ '{names} left.': '{names} ушли.' }),
        russian,
      ),
    ).toBe('{names} ушли.');
  });

  it('is how the scaffold writes every message', () => {
    const scaffold = blankCommentLines(
      readFileSync(join('scripts', 'i18n-scaffold.mjs'), 'utf8'),
    );
    expect(
      scaffold,
      'the scaffold must rebuild each message from its translated sentences',
    ).toMatch(/assembleMessage\(/);
  });
});

describe('a draft that changed a slot is not trusted', () => {
  const sentence = '{names} left after {n} rounds.';
  const kept = '{names} 在 {n} 轮后离开了。';

  it('knows whether a draft kept its slots', () => {
    expect(slotsKept(sentence, kept)).toBe(true);
    expect(slotsKept('Add a student', '添加学生')).toBe(true);
    for (const draft of [
      '{names} 离开了。',
      '{names} 和 {who} 在 {n} 轮后离开了。',
      '{names} 在 {n} 轮后离开了 {names}。',
      '{names 在 {n} 轮后离开了。',
    ])
      expect(slotsKept(sentence, draft), draft).toBe(false);
  });

  it('sends a sentence again when its cached draft changed a slot', () => {
    expect(needsSending(sentence, undefined)).toBe(true);
    expect(needsSending(sentence, '{names} 离开了。')).toBe(true);
    expect(needsSending(sentence, kept)).toBe(false);
  });

  it('keeps the bare draft unless it lost a slot the tagged one kept', () => {
    const lost = '{names} 离开了。';
    const glued = '{names}在{n}轮后离开了。';
    expect(betterDraft(sentence, kept, glued)).toBe(kept);
    expect(betterDraft(sentence, lost, glued)).toBe(glued);
    expect(betterDraft(sentence, lost, '{names}离开了。')).toBe(lost);
  });

  it('is how the translator decides what to send and which draft to keep', () => {
    const script = blankCommentLines(
      readFileSync(join('scripts', 'i18n-translate.mjs'), 'utf8'),
    );
    for (const [call, why] of [
      ['needsSending(', 'a cached draft that changed a slot is sent again'],
      ['tagSlots: true', 'the retry sends its slots tagged'],
      ['betterDraft(', 'the retry keeps the better draft'],
    ])
      expect(script, why).toContain(call);
  });
});

describe('the harness runs under plain Node', () => {
  it('loads every module a script imports from src/', () => {
    // The scripts run on Node's type stripping, which refuses TypeScript that
    // needs compiling -- a constructor parameter property is enough -- and
    // cannot resolve an import written without its extension. Vitest accepts
    // both, so only loading each module the way a script does proves it runs.
    const modules = nonEmpty(
      [
        ...new Set(
          filesUnder('scripts', (path) => path.endsWith('.mjs')).flatMap(
            (script) =>
              [
                ...blankCommentLines(readFileSync(script, 'utf8')).matchAll(
                  /from '(\.\.\/src\/[^']+)'/g,
                ),
              ].map(([, specifier]) => resolve(dirname(script), specifier)),
          ),
        ),
      ],
      'src modules the scripts import',
    );
    const refused = modules.flatMap((module) => {
      const run = spawnSync(
        process.execPath,
        [
          '--no-warnings',
          '--input-type=module',
          '-e',
          `await import(${JSON.stringify(pathToFileURL(module).href)});`,
        ],
        { encoding: 'utf8' },
      );
      if (run.status === 0) return [];
      const stderr = run.stderr.trim();
      return [
        `${relative('.', module)}: ${stderr.split('\n').find((line) => line.includes('Error')) ?? stderr}`,
      ];
    });
    expect(
      searched(refused, {
        of: modules,
        what: 'src modules the scripts import',
      }),
    ).toEqual([]);
    expect(
      floorBreach('translate-messages/imported-src-modules', modules.length),
    ).toBeUndefined();
  });
});

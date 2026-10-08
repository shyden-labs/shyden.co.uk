import { describe, it, expect } from 'vitest';
import { blankCommentLines, isMarkerCommentLine } from './source-text';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { MVP_LOCALES } from '../../src/lib/i18n/metadata';
import { searched } from '../source-files';
import { floorBreach } from '../floors';
import { messageOf } from '../../scripts/errors.mjs';
import {
  DO_NOT_TRANSLATE,
  buildRequestBody,
  escapeXml,
  deeplDrafts,
  deeplEndpoint,
  deeplLanguage,
  needsTranslation,
  protectTerms,
  pruneDrafts,
  unescapeXml,
  unprotectTerms,
  translatableSentences,
  TRANSLATABLE_LOCALES,
} from '../../src/lib/i18n/translate';
import { collectCatalogue } from '../translate-shared';

describe('the DeepL key decides the host', () => {
  it('routes a free key to the free host', () => {
    // The whole reason this function exists. A Free-plan key ends `:fx` and
    // is REJECTED by api.deepl.com — the request does not fail over, it 403s.
    expect(deeplEndpoint('abc123:fx')).toBe(
      'https://api-free.deepl.com/v2/translate',
    );
  });

  it('routes a pro key to the paid host', () => {
    expect(deeplEndpoint('abc123')).toBe('https://api.deepl.com/v2/translate');
  });

  it('survives the whitespace a real .env file carries', () => {
    // `DEEPL_API_KEY=abc:fx\n` read naively keeps the newline, and
    // `endsWith(':fx')` is then false — a Free key silently sent to the paid
    // host, which is a 403 at the end of a long run.
    expect(deeplEndpoint(' abc123:fx\n')).toBe(
      'https://api-free.deepl.com/v2/translate',
    );
  });

  it('never puts the key in the URL it returns', () => {
    // DeepL authenticates by header. A key in a URL reaches logs, CI output
    // and error messages — this is the one place it could leak by accident.
    const url = deeplEndpoint('super-secret-key:fx');
    expect(url).not.toContain('super-secret-key');
  });

  it('refuses an empty key rather than guessing a host', () => {
    expect(() => deeplEndpoint('')).toThrow('DEEPL_API_KEY is empty');
    expect(() => deeplEndpoint('   ')).toThrow('DEEPL_API_KEY is empty');
  });
});

describe('every MVP language has a DeepL code', () => {
  it('names one for each, with Chinese as Simplified', () => {
    for (const locale of MVP_LOCALES) {
      expect(deeplLanguage(locale), `${locale} has no DeepL code`).toBeTruthy();
    }
    // The ticket is explicit: ZH is Simplified. DeepL's plain `ZH` is
    // Simplified, but naming the variant leaves nothing to a default that
    // could change under us.
    expect(deeplLanguage('zh')).toBe('ZH-HANS');
    expect(deeplLanguage('en')).toBe('EN-GB');
  });

  it('names each language by the code DeepL documents for it', () => {
    // Literals, all five: `IN`, `VN` or `THA` read as plausible codes and are
    // refused by the API, and only zh and en were pinned before #390.
    expect(
      Object.fromEntries(
        MVP_LOCALES.map((locale) => [locale, deeplLanguage(locale)]),
      ),
    ).toEqual({ en: 'EN-GB', id: 'ID', zh: 'ZH-HANS', vi: 'VI', th: 'TH' });
  });

  it('offers exactly the MVP locales as targets, derived not copied', () => {
    // The script runs under plain Node and cannot load `metadata.ts` (its
    // `'./index'` import has no extension), so it takes the list from here.
    // This is what stops that becoming a hand-maintained second copy.
    expect([...TRANSLATABLE_LOCALES].sort()).toEqual([...MVP_LOCALES].sort());
  });

  it('asks for British English, matching the copy the site is written in', () => {
    // `EN` is ambiguous at DeepL and resolves to American English. The site
    // is British throughout (CLAUDE.md, and `en_GB` in LOCALE_METADATA).
    expect(deeplLanguage('en')).not.toBe('EN-US');
  });
});

describe('what must never be sent to a translator', () => {
  // Yawelo Idle since #552: "Idle" is an English word a translator would
  // otherwise turn into the local word for it.
  it.each(['Shyden', 'ShyTalk', 'Glory Points', 'Yawelo Idle'])(
    'holds the name %s',
    (term) => {
      expect(
        DO_NOT_TRANSLATE.some((t) => t === term),
        `${term} is translatable — a name is not copy`,
      ).toBe(true);
    },
  );

  it('holds only terms the site still ships', () => {
    // #370 removed the company's legal facts from every page. A term no
    // sentence carries protects nothing, and reads as a fact the site still
    // states -- 'England and Wales' sat here matching nothing until #22.
    const sentences = [...translatableSentences()];
    for (const term of DO_NOT_TRANSLATE)
      expect(
        sentences.some((s) => s.includes(term)),
        `${term} is in no sentence the site sends to a translator`,
      ).toBe(true);
  });

  it('leaves a function alone, because a function is code', () => {
    // No catalogue holds one since #136 -- every parameterised message is a
    // template, sent as the sentences it can say -- but a function is code,
    // not copy, and a translator returns prose rather than a function body.
    expect(needsTranslation('Add a student')).toBe(true);
    expect(needsTranslation((n: number) => `${n}`)).toBe(false);
    expect(needsTranslation('')).toBe(false);
  });

  it('leaves punctuation and symbols alone', () => {
    // `rosterColNumber` is "#" and carries no language of its own — already
    // an accepted identical string in tests/unit/i18n.test.ts.
    expect(needsTranslation('#')).toBe(false);
    expect(needsTranslation('—')).toBe(false);
  });
});

/**
 * #22. `DO_NOT_TRANSLATE` was a list nothing consulted.
 *
 * The block above asserts the list HOLDS the right terms, and that is all it
 * ever asserted. `scripts/i18n-translate.mjs` imported the list, printed its
 * LENGTH ("do-not-send 6 protected terms") and sent the batch raw; the
 * `ignore_tags: ['x']` on the request protected nothing, because nothing ever
 * emitted an `<x>` tag. The run for zh/vi/th returned "Shyden" intact in all
 * three languages by DeepL's own proper-noun handling -- luck, not a control.
 * Presence is not the assertion, exactly as the supply-chain guard (#23) and
 * the prod-smoke path list (#21 Stage 4) both learned.
 *
 * Only one protected term occurred in the catalogue then, which is why nothing
 * looked wrong. The tests below assert the EFFECT: that the text handed to
 * DeepL carries the tags, and that what comes back is unwrapped again.
 */
describe('protected terms are wrapped before they are sent', () => {
  it('wraps a protected term in the tag the request tells DeepL to ignore', () => {
    expect(protectTerms('Built for teachers, by Shyden.')).toBe(
      'Built for teachers, by <x>Shyden</x>.',
    );
  });

  it('wraps the longest match first, so a name is never split', () => {
    // 'Shyden' is a prefix of 'Shyden Studio'. Shortest-first would produce
    // `<x>Shyden</x> Studio` and hand "Studio" to the translator on its own.
    // The shipped list has no such pair since #370, so the pair is given.
    expect(
      protectTerms(escapeXml('Shyden Studio is by Shyden.'), [
        'Shyden',
        'Shyden Studio',
      ]),
    ).toBe('<x>Shyden Studio</x> is by <x>Shyden</x>.');
  });

  it('never wraps a term that sits at the END of a longer one', () => {
    expect(
      protectTerms('Shyden Studio and Studio', ['Studio', 'Shyden Studio']),
    ).toBe('<x>Shyden Studio</x> and <x>Studio</x>');
  });

  it('never wraps a term that sits in the MIDDLE of a longer one', () => {
    // A per-term loop wrapped `Glory Points` again inside the span the longer
    // term had already wrapped: `<x>The <x>Glory Points</x> Cup</x>`.
    expect(
      protectTerms('The Glory Points Cup, and Glory Points', [
        'Glory Points',
        'The Glory Points Cup',
      ]),
    ).toBe('<x>The Glory Points Cup</x>, and <x>Glory Points</x>');
  });

  it('protects nothing, and changes nothing, given no terms or an empty one', () => {
    const text = 'Built for teachers, by Shyden.';
    expect(protectTerms(text, [])).toBe(text);
    expect(protectTerms(text, [''])).toBe(text);
  });

  it('matches a term literally, never as a pattern', () => {
    // `A.B.` as a pattern would match `AxB.` too.
    expect(protectTerms('AxB. is not A.B.', ['A.B.'])).toBe(
      'AxB. is not <x>A.B.</x>',
    );
  });

  it('leaves a string with no protected term untouched', () => {
    const plain = 'Split a class fairly in one click.';
    expect(protectTerms(plain)).toBe(plain);
  });

  it('round-trips: unprotect undoes protect exactly', () => {
    for (const source of [
      'Built for teachers, by Shyden.',
      'ShyTalk & Glory Points, by Shyden.',
      'Nothing protected here at all.',
    ]) {
      expect(unprotectTerms(protectTerms(source))).toBe(source);
    }
  });

  it('strips the tags DeepL returns around a translated sentence', () => {
    // What actually comes back: the tag survives, the prose around it does not.
    expect(unprotectTerms('由 <x>Shyden</x> 专为教师打造。')).toBe(
      '由 Shyden 专为教师打造。',
    );
  });

  it('builds a request whose every text is protected', () => {
    const body = buildRequestBody(['Built by Shyden.', 'No names here.'], 'zh');
    expect(body.text).toEqual(['Built by <x>Shyden</x>.', 'No names here.']);
    expect(body.target_lang).toBe('ZH-HANS');
    expect(body.source_lang).toBe('EN');
    // The tag name in the payload must be the one protectTerms emits, or the
    // wrapping is decoration and the term is translated anyway.
    expect(body.ignore_tags).toContain('x');
    expect(body.tag_handling).toBe('xml');
  });

  it('is actually wired into the script, not merely available to it', () => {
    // The bug this whole block exists for was a pure function that was never
    // called. A source scan is the only surface available: the script is a
    // top-level-await module that calls the network on import.
    const script = blankCommentLines(
      readFileSync(join('scripts', 'i18n-translate.mjs'), 'utf8'),
    );
    expect(script, 'the request body must come from buildRequestBody').toMatch(
      /buildRequestBody\(/,
    );
    expect(script, 'the response must be checked and unwrapped').toMatch(
      /deeplDrafts\(/,
    );
  });

  it('reads the drafts out of an answer, unwrapped and unescaped', () => {
    expect(
      deeplDrafts(
        {
          translations: [
            { text: '由 <x>Shyden</x> 打造 &amp; 分享。' },
            { text: '添加学生' },
          ],
        },
        2,
      ),
    ).toEqual(['由 Shyden 打造 & 分享。', '添加学生']);
  });

  it.each([
    [1, 2],
    [3, 2],
    [0, 1],
  ])(
    'refuses %i drafts for %i sentences, which would pair each draft with the wrong English',
    (returned, sent) => {
      const response = {
        translations: Array.from({ length: returned }, () => ({ text: 'x' })),
      };
      expect(() => deeplDrafts(response, sent)).toThrow(
        `DeepL returned ${returned} translations for ${sent} texts`,
      );
    },
  );

  it.each([
    ['that is not an object', null],
    ['with no translations', {}],
    ['whose translations are not a list', { translations: 'x' }],
  ])('refuses an answer %s', (_, response) => {
    expect(() => deeplDrafts(response, 1)).toThrow(
      'DeepL answered without a list of translations',
    );
  });

  it.each([
    ['a number', { text: 3 }],
    ['nothing', {}],
    ['a null entry', null],
  ])('refuses a translation whose text is %s', (_, entry) => {
    expect(() =>
      deeplDrafts({ translations: [{ text: 'fine' }, entry] }, 2),
    ).toThrow('translation 1 has no text');
  });

  it('never quotes what came back in its error, as the script never prints a body', () => {
    // The script reports a failed request by its status alone, because a
    // DeepL error can echo the request.
    let message = '';
    try {
      deeplDrafts({ translations: [{ text: 'Pupil copy, echoed' }] }, 2);
    } catch (error) {
      message = messageOf(error);
    }
    expect(message).toBe('DeepL returned 1 translations for 2 texts');
  });

  it('escapes the ampersand that made DeepL answer 400', () => {
    // The footer's "Registered in England & Wales." (#22; the line left with
    // the company in #370). A bare `&` is a malformed entity to an XML
    // parser, and `tag_handling: 'xml'` means DeepL is one.
    expect(escapeXml('England & Wales')).toBe('England &amp; Wales');
    expect(escapeXml('a < b > c')).toBe('a &lt; b &gt; c');
  });

  it('escapes the ampersand FIRST so it does not eat its own output', () => {
    // `<` -> `&lt;` -> `&amp;lt;` if `&` is escaped second. The round trip
    // below is what actually pins this; this names the reason.
    expect(escapeXml('<')).toBe('&lt;');
    expect(unescapeXml(escapeXml('&lt; is how you write <'))).toBe(
      '&lt; is how you write <',
    );
  });

  it('protects a term that carries an ampersand, in its escaped form', () => {
    // `DO_NOT_TRANSLATE` said 'England and Wales' until #22 and therefore
    // matched nothing: the copy has always said '&'. The term left the list
    // with the footer (#370), so the ampersand case is given.
    expect(
      protectTerms(escapeXml('Salt & Pepper, by Shyden.'), [
        'Salt & Pepper',
        'Shyden',
      ]),
    ).toBe('<x>Salt &amp; Pepper</x>, by <x>Shyden</x>.');
  });

  it("collects all three catalogues, not just the tool's", () => {
    // The round-trip guard below walks THIS file's copy of the collection, so
    // it cannot notice the HARNESS collecting less -- mutation-verified:
    // narrowing the walk to `en` alone left every test green, because no
    // string in `en` carries an ampersand and the round trip then holds
    // trivially. Site copy was invisible to the translator for an entire
    // release because nothing asserted it was seen.
    //
    // Until #164 this scanned the script for `collect(en)` by name. The
    // collection now has one home, `translatableSentences`, which the harness
    // sends from and the stale-draft guard reads, so it is pinned here to this
    // file's independent walk: a missing catalogue changes the set. That the
    // script really uses it is proved by running the script -- see `--prune`
    // below.
    expect([...translatableSentences()].sort()).toEqual(
      collectCatalogue().sort(),
    );
  });

  it('round-trips every real catalogue string through the whole pipeline', () => {
    // The assertion that would have predicted the 400, over exactly what the
    // harness sends: escape, protect, then back again must be the identity.
    const catalogue = collectCatalogue();
    const broken = catalogue.filter(
      (source) =>
        unescapeXml(
          unprotectTerms(buildRequestBody([source], 'zh').text[0]),
        ) !== source,
    );
    expect(
      searched(broken, {
        of: catalogue,
        what: 'catalogue strings',
      }),
      'these strings do not survive the request pipeline unchanged',
    ).toEqual([]);
    expect(
      floorBreach('translate/round-tripped-strings', catalogue.length),
    ).toBeUndefined();
  });
});

describe('the harness never runs itself', () => {
  it('is not wired into build, dev or any test command', () => {
    // "Committed output, not a build step" — the ticket. A translate step in
    // `build` would spend quota on every CI run and make a deploy depend on a
    // third-party API being up.
    const pkg = JSON.parse(readFileSync('package.json', 'utf8'));
    for (const [name, cmd] of Object.entries<string>(pkg.scripts)) {
      if (name === 'i18n:translate') continue;
      expect(cmd, `${name} runs the translator`).not.toContain(
        'i18n-translate',
      );
      expect(cmd, `${name} runs the translator`).not.toContain(
        'i18n:translate',
      );
    }
    expect(pkg.scripts['i18n:translate']).toBeTruthy();
  });

  it('documents the key without carrying one', () => {
    // `.env.example` is the committed half of a gitignored pair. It has to
    // name the variable — nobody can guess `DEEPL_API_KEY` — and must never
    // hold a value, which is the failure mode a committed example file has.
    const example = readFileSync('.env.example', 'utf8');
    // ANCHORED, not `toContain`. `.env.example` is a `#`-commented file and
    // its own prose names this variable, so an unanchored match is satisfied
    // by the documentation after the real line is commented out or deleted --
    // the presence variant of the comment-suppression class (#98). A `#`
    // line cannot put the key at the start of a line.
    expect(
      /^DEEPL_API_KEY=/m.test(example),
      '.env.example does not DEFINE the key, it only mentions it',
    ).toBe(true);
    expect(
      /^DEEPL_API_KEY=.+$/m.test(example),
      '.env.example carries a VALUE — that is a leaked key',
    ).toBe(false);
    // The suffix rule is the one thing a newcomer gets wrong, so it is
    // written where they will be looking when they paste the key.
    // Deliberately asserted against the COMMENTS, which is where this rule
    // belongs -- it is guidance for a human pasting a key, not config. Said
    // out loud so nobody later "fixes" it into an anchored config check and
    // reddens CI on a file that was correct.
    //
    // The MATCHER is still anchored, which is a different thing from the
    // config check that warning is about: `:fx` as a bare substring is also
    // satisfied by `:fxyz`, and the suffix is the whole point. #118 surfaced
    // this once the derivation could see two hops back to the file read.
    const documentation = example
      .split('\n')
      .filter((line) => isMarkerCommentLine(line, '#'))
      .join('\n');
    expect(
      documentation,
      '.env.example stopped explaining the :fx suffix',
    ).toMatch(/:fx\b/);

    // Anchored for the same reason as the key above: `# .env.*` would satisfy
    // `toContain` while the rule it names had stopped ignoring anything, and
    // this is the guard standing between a real key and a public repo.
    expect(
      /^\.env\.\*\s*$/m.test(readFileSync('.gitignore', 'utf8')),
      '.gitignore no longer IGNORES .env.* — it only mentions it',
    ).toBe(true);
  });

  // That nothing the site ships imports this module is held by
  // cli-only.test.ts, which resolves each import. The substring check that
  // stood here could not see `./translate` from a sibling in src/lib/i18n/.
});

/**
 * #164. The cache only ever grew.
 *
 * `.translations.json` is keyed by English sentence, and the harness wrote
 * back every draft it had read, so a draft outlived the copy it translated:
 * zh, vi, th and id each carried 18 drafts of retired homepage copy that no
 * page shows and nobody reviews, in the file a reviewer is asked to read.
 */
describe('a draft whose English is retired is dropped', () => {
  it('splits the drafts by whether their English is still sent, keeping their order', () => {
    const drafts = {
      'Get in touch': '联系我们',
      'Add a student': '添加学生',
      'See our work': '查看我们的作品',
      'Split the class': '分班',
    };
    const handed = JSON.stringify(drafts);
    const { kept, stale } = pruneDrafts(
      drafts,
      new Set(['Split the class', 'Add a student', 'Never drafted']),
    );
    // The CACHE's order, not the collection's: a pruned cache is a diff of
    // removed lines, never a reshuffled file.
    expect(Object.entries(kept)).toEqual([
      ['Add a student', '添加学生'],
      ['Split the class', '分班'],
    ]);
    expect(stale).toEqual(['Get in touch', 'See our work']);
    expect(JSON.stringify(drafts), 'it changed the drafts it was handed').toBe(
      handed,
    );
  });

  it('keeps a draft that changed a slot, because its sentence is still sent', () => {
    // Pending is not stale: `needsSending` sends that sentence again, and the
    // run replaces the draft rather than losing it.
    const sentence = '{names} left after {n} rounds.';
    expect(
      pruneDrafts({ [sentence]: '{names} 离开了。' }, new Set([sentence])),
    ).toEqual({ kept: { [sentence]: '{names} 离开了。' }, stale: [] });
  });

  it('drops every draft when nothing is sent', () => {
    // Why an emptied collection makes the stale-draft guard loud, not vacuous.
    expect(pruneDrafts({ 'Get in touch': '联系我们' }, new Set())).toEqual({
      kept: {},
      stale: ['Get in touch'],
    });
  });

  it('holds no draft in the committed cache for English the harness does not send', () => {
    // The guard #164 exists for. It reads the harness's own collection, never
    // a list of its own, so copy retired from any catalogue turns this red the
    // day it goes, naming each draft left behind by locale.
    //
    // The population proved live is the DRAFTS: an empty cache is the one
    // world in which this passes having read nothing. An empty collection is
    // not -- every draft would then be stale, and this goes red.
    const cache: Record<string, Record<string, string>> = JSON.parse(
      readFileSync(join('src', 'lib', 'i18n', '.translations.json'), 'utf8'),
    );
    const sent = translatableSentences();
    const stale = Object.entries(cache).flatMap(([locale, drafts]) =>
      Object.keys(drafts)
        .filter((english) => !sent.has(english))
        .map((english) => `${locale}: ${english}`),
    );
    const cachedDrafts = Object.values(cache).flatMap((drafts) =>
      Object.keys(drafts),
    );
    expect(
      searched(stale, {
        of: cachedDrafts,
        what: 'cached drafts',
      }),
      'drafts for English no catalogue sends -- run `npm run i18n:translate -- <locale> --prune`',
    ).toEqual([]);
    expect(
      floorBreach('translate/cached-drafts', cachedDrafts.length),
    ).toBeUndefined();
  });

  it('has nothing to drop for a locale with no drafts', () => {
    expect(pruneDrafts({}, new Set(['Add a student']))).toEqual({
      kept: {},
      stale: [],
    });
  });
});

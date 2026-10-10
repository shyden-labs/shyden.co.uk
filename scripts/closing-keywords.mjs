/**
 * The one home for a rule that has fired twice: no message may put a closing
 * keyword next to an issue number.
 *
 * GitHub's closing-keyword parser has no model of negation, tense or intent.
 * It found `CLOSE #44` inside `DOES NOT CLOSE #44` (commit 983fb7e) and
 * `close #89` inside `I will close #89 by hand once both are in` (PR #92's
 * body), and closed both issues. The first guard written against this matched
 * only the NEGATED form, so the second accident walked straight past it -- a
 * guard whose coverage did not match its intent.
 *
 * ONE HOME, and that is why this is a module rather than a `grep` inside the
 * hook: the rule has two media to cover. A commit message reaches it through
 * `.githooks/commit-msg`; a pull request body never meets a git hook at all,
 * so `pr-body.yml`'s `closing-keywords` job feeds it the same function. Two copies of a pattern
 * drift, and the copy that drifts is the one nobody watched fail (#227).
 *
 * NO EXCEPTION FOR A DELIBERATE CLOSE (operator decision, 2026-09-21). No
 * closing keyword sits beside an issue number in the last 300 commit bodies
 * or the last 40 pull request bodies, so the exception would preserve a
 * capability this repository has never used, at the price of an allowance
 * branch nothing exercises -- which is the vacuity pattern #118 and #112 were
 * filed about. An issue is retired by hand, with `gh issue close <n>`.
 *
 * DELIBERATELY WIDER THAN GITHUB. `resolving #7` is not a keyword GitHub acts
 * on, and it is refused here anyway, as the first guard already refused it.
 * The rule an author has to remember is then one sentence with no exceptions,
 * and the cost of the over-refusal is rewording a line. The cost of the other
 * direction is an issue closing with an acceptance criterion outstanding.
 */

import { readFileSync } from 'node:fs';
import { argv } from 'node:process';

import { die, messageOf } from './errors.mjs';

/**
 * A closing keyword adjacent to an issue reference.
 *
 * No `g` flag, deliberately: a global regex carries `lastIndex` between
 * `.test()` calls, so every second line would be judged from the wrong
 * offset and silently pass.
 *
 * The leading `\b` is what keeps `prefix#5` and `affixes #9` safe -- there is
 * no word boundary before `fix` inside either -- and the trailing `\d+` is
 * what keeps this file's own `#<n>` placeholders from matching.
 *
 * A full issue or pull request URL counts as a reference too. GitHub does not
 * document that form, so the rule does not rely on GitHub ignoring it.
 * The scheme's slashes are `\/{2}` because `tests/guards/one-home.test.ts`
 * reads an escaped `//` as comment syntax.
 */
const CLOSING_KEYWORD =
  /\b(?:clos|fix|resolv)[a-z]*[ \t]*:?[ \t]*(?:https?:\/{2}github\.com\/[\w.-]+\/[\w.-]+\/(?:issues|pull)\/|(?:[\w.-]+\/[\w.-]+)?(?:#|GH-))\d+/i;

/** @typedef {{ line: number, text: string }} Offence */

/**
 * Every line of `text` that puts a closing keyword beside an issue number.
 *
 * @param {string} text
 * @returns {Offence[]}
 */
export const closingKeywordOffences = (text) =>
  text
    .split('\n')
    .flatMap((line, index) =>
      CLOSING_KEYWORD.test(line)
        ? [{ line: index + 1, text: line.trim() }]
        : [],
    );

/**
 * The refusal an author reads. This is the only place the rule is taught, so
 * it names both accidents, the phrasing to use instead, and the way to close
 * an issue on purpose.
 *
 * @param {string} what  what was checked, e.g. `a commit message`
 * @param {readonly Offence[]} offences
 * @returns {string}
 */
export const closingKeywordRefusal = (what, offences) =>
  [
    `${what} puts a closing keyword next to an issue number:`,
    '',
    ...offences.map(({ line, text }) => `  ${line}: ${text}`),
    '',
    "GitHub's parser has no model of negation, tense or intent. It reads the",
    'keyword, it reads the number, and it closes the issue on merge. Both have',
    'happened here: a sentence in capitals saying the issue must stay open, and',
    'a sentence promising to close it by hand later.',
    '',
    'Write `Refs #<n>` instead, and phrase any caveat without the words close,',
    'fix or resolve anywhere near the number. To retire an issue on purpose,',
    'do it by hand once the work is verified:  gh issue close <n>',
  ].join('\n');

/**
 * Refuse a file whose text breaks the rule. Used by `.githooks/commit-msg`
 * for a commit message and by `pr-body.yml` for a pull request body and the
 * pull request's commit messages.
 *
 * @returns {Promise<void>}
 */
const main = async () => {
  const [file, what = 'this message', ...rest] = argv.slice(2);
  if (!file || rest.length > 0)
    die(
      'usage: node scripts/closing-keywords.mjs <file> [what]\n' +
        '  <file> holds a commit message or a pull request body.\n' +
        '  [what] names that medium in the refusal, e.g. `this commit message`.',
    );

  /** @type {string} */
  let text;
  try {
    text = readFileSync(file, 'utf8');
  } catch (error) {
    die(`cannot read ${file}: ${messageOf(error)}`);
  }

  const offences = closingKeywordOffences(text);
  if (offences.length > 0) die(closingKeywordRefusal(what, offences));
};

// Only when run, never when imported: the unit suite imports the detector.
// Matching the entry file's NAME would run `main()` for any entry file whose
// name ended the same way (#221, `tests/unit/script-entry.test.ts`).
if (import.meta.main) await main();

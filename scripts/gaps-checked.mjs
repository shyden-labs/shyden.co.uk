/**
 * The one home for the rule that every commit message carries its "Gaps
 * checked" section (#897; Shyden 2026-10-21, every repository; the rule's text
 * is `~/.claude/global-rules/no-holes-check-before-and-after.md`):
 *
 *   Gaps checked:
 *   - Before: <how the change could let through what is refused today>
 *   - After: <the attack on the diff, the verdicts, the coverage>
 *   - New passes: <what the change turns into a pass, or none>
 *
 * Before and After each hold at least 20 characters and 3 words (a word is a
 * whitespace-separated token with at least two letters); New passes is not
 * empty. A commit that changes only `.md` files is exempt, judged by its own
 * file list; an empty file list is judged, never read as exempt. Lists are
 * read with `--no-renames`, so a code file renamed to `.md` shows its old path
 * too and is judged.
 *
 * Two media, like `closing-keywords.mjs`: `.githooks/commit-msg` hands it the
 * message with the staged file list (`--staged`), and `pr-body.yml`'s
 * `gaps-checked` job hands it every commit in the pull request (`--range`),
 * each judged by its own files against its first parent. A Claude hook sees
 * only the commands it is shown; these see every commit, however it was made.
 *
 *   node scripts/gaps-checked.mjs <message-file> [what] --staged
 *   node scripts/gaps-checked.mjs --range <base>..<head>
 *
 * `tests/unit/gaps-checked.test.ts` holds the rule;
 * `tests/integration/gaps-checked-script.test.ts` runs both media in a real
 * repository.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { argv } from 'node:process';
import { die, messageOf } from './errors.mjs';

const LINES = ['Before', 'After', 'New passes'];
const MIN_CHARACTERS = 20;
const MIN_WORDS = 3;

/**
 * Each item's text, read from `- <name>:` to the next item, a blank line or
 * a line that is not indented.
 *
 * @param {readonly string[]} lines the lines after the heading
 * @returns {Map<string, string>}
 */
const items = (lines) => {
  /** @type {Map<string, string>} */
  const found = new Map();
  /** @type {string | undefined} */
  let current;
  for (const line of lines) {
    const item = line.match(/^- ([A-Za-z ]+):(.*)$/);
    if (item) {
      current = item[1] ?? '';
      found.set(current, (item[2] ?? '').trim());
    } else if (current !== undefined && /^\s+\S/.test(line)) {
      found.set(current, `${found.get(current) ?? ''} ${line.trim()}`.trim());
    } else current = undefined;
  }
  return found;
};

/** @param {string} text */
const words = (text) =>
  text
    .split(/\s+/)
    .filter((token) => (token.match(/[A-Za-z]/g) ?? []).length >= 2).length;

/**
 * What a message lacks, as the lines a refusal lists; empty when it passes.
 *
 * @param {string} message
 * @returns {string[]}
 */
export const gapsOffences = (message) => {
  const lines = message.split('\n');
  const heading = lines.findIndex((line) => line.trim() === 'Gaps checked:');
  if (heading === -1) return ['no `Gaps checked:` heading'];
  const found = items(lines.slice(heading + 1));
  return LINES.flatMap((name) => {
    const text = found.get(name);
    if (text === undefined) return [`no \`- ${name}:\` line`];
    if (name === 'New passes')
      return text === ''
        ? [
            '`- New passes:` is empty; write `none` if nothing turns into a pass',
          ]
        : [];
    if (text.length < MIN_CHARACTERS)
      return [
        `\`- ${name}:\` holds ${text.length} characters; it needs at least ${MIN_CHARACTERS}`,
      ];
    const count = words(text);
    return count < MIN_WORDS
      ? [`\`- ${name}:\` holds ${count} words; it needs at least ${MIN_WORDS}`]
      : [];
  });
};

/**
 * One commit, by its own message and file list.
 *
 * @param {{ message: string, files: readonly string[] }} commit
 * @returns {string[]}
 */
export const judgeCommit = ({ message, files }) =>
  files.length > 0 && files.every((file) => file.endsWith('.md'))
    ? []
    : gapsOffences(message);

/**
 * The refusal an author reads: the only place the rule is taught.
 *
 * @param {string} what what was checked, e.g. `this commit message`
 * @param {readonly string[]} offences
 * @returns {string}
 */
export const gapsRefusal = (what, offences) =>
  [
    `${what} has no complete Gaps checked section:`,
    '',
    ...offences.map((offence) => `  ${offence}`),
    '',
    'Every commit message carries it (Shyden, 2026-10-21, every repository):',
    '',
    'Gaps checked:',
    '- Before: <every way the change could let through what is refused today, each planted as a failing test first>',
    '- After: <the attack on the diff, the old-vs-new verdicts, coverage of the changed code>',
    '- New passes: <each verdict the change turns into a pass and the ruling that allows it, or none>',
    '',
    'A commit that changes only .md files needs none.',
  ].join('\n');

/** @param {readonly string[]} args */
const git = (args) =>
  execFileSync('git', [...args], { encoding: 'utf8' }).replace(/\n$/, '');

const main = () => {
  const args = argv.slice(2);
  if (args[0] === '--range' && args.length === 2) {
    const range = /** @type {string} */ (args[1]);
    const commits = git(['rev-list', '--reverse', range])
      .split('\n')
      .filter(Boolean);
    if (commits.length === 0)
      die(
        `gaps-checked: no commit in ${range}: the range is wrong, not the pull request clean`,
      );
    const refused = commits.flatMap((sha) => {
      const message = git(['log', '-1', '--format=%B', sha]);
      const files = git([
        'diff',
        '--no-renames',
        '--name-only',
        `${sha}^1`,
        sha,
      ])
        .split('\n')
        .filter(Boolean);
      const offences = judgeCommit({ message, files });
      return offences.length > 0
        ? [
            gapsRefusal(
              `commit ${sha.slice(0, 8)} (${message.split('\n')[0]})`,
              offences,
            ),
          ]
        : [];
    });
    if (refused.length > 0) die(refused.join('\n\n'));
    console.log(
      `gaps-checked: ${commits.length} commits in ${range}, each with its section or only .md files`,
    );
    return;
  }
  const [file, what = 'this commit message', flag, ...rest] = args;
  if (!file || flag !== '--staged' || rest.length > 0)
    die(
      'usage: node scripts/gaps-checked.mjs <message-file> [what] --staged\n' +
        '       node scripts/gaps-checked.mjs --range <base>..<head>',
    );
  /** @type {string} */
  let message;
  try {
    message = readFileSync(file, 'utf8');
  } catch (error) {
    die(`cannot read ${file}: ${messageOf(error)}`);
  }
  const files = git(['diff', '--cached', '--no-renames', '--name-only'])
    .split('\n')
    .filter(Boolean);
  const offences = judgeCommit({ message, files });
  if (offences.length > 0) die(gapsRefusal(what, offences));
};

// Only when run, never when imported: the unit suite imports the rule.
if (import.meta.main) main();

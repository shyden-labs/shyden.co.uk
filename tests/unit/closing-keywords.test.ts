import { describe, expect, it } from 'vitest';
import { SCRIPT, workflowsRunningTheRule } from '../closing-keywords-shared';
import { searched } from '../source-files';
import { floorBreach } from '../floors';
import { closingKeywordOffences } from '../../scripts/closing-keywords.mjs';

/**
 * The rule: no message may put a closing keyword next to an issue number, for
 * any reason at all.
 *
 * It has fired twice in this repository, and the second time in a form the
 * guard written after the first could not see:
 *
 *   1. `DOES NOT CLOSE #44` (commit 983fb7e) closed #44. GitHub's parser has
 *      no model of negation; it found `CLOSE #44` inside the sentence written
 *      to keep the issue open, and the issue sat closed for a day while every
 *      handover recorded it as deliberately open.
 *   2. `I will close #89 by hand once both are in` (PR #92's body) closed #89
 *      on the merge. That is not a negation, so the guard built for the first
 *      incident matched nothing. A parser has no model of TENSE or INTENT
 *      either: `close #N` is `close #N`.
 *
 * NO EXCEPTION, and that is an operator decision (2026-09-21), taken against
 * the measurement rather than a preference: no closing keyword appears beside
 * an issue number in the last 300 commit bodies or the last 40 pull request
 * bodies. The capability the exception would preserve has never once been
 * used, and an allowance branch nothing exercises is the vacuity this repo
 * keeps finding (#118, #112). An issue is retired with `gh issue close`.
 *
 * Over-refusal is deliberate where the two disagree. `closing #5` is not a
 * keyword GitHub acts on, and it is still refused, because the cost of that
 * is rewording one sentence and the cost of the other direction is an issue
 * closing with an acceptance criterion outstanding.
 */

interface Fixture {
  readonly text: string;
  readonly why: string;
}

/** Messages the guard must refuse, each with the form it represents. */
const REFUSED: readonly Fixture[] = [
  {
    text: 'DOES NOT CLOSE #44. This is the measurement the ticket requires first.',
    why: 'incident 1, verbatim from 983fb7e — the negated form',
  },
  {
    text: 'I will close #89 by hand once both are in',
    why: 'incident 2, verbatim from PR #92 — future intent, which no negation guard sees',
  },
  {
    text: 'this would close #12 if it merged first',
    why: 'the conditional form',
  },
  {
    text: 'Closes #65',
    why: 'a genuine closing keyword — refused too, by operator decision',
  },
  { text: 'Fixes #7', why: 'the fix inflection' },
  { text: 'Resolved #3', why: 'the resolve inflection, past tense' },
  { text: 'merged without resolving #7', why: 'the without form' },
  { text: 'never closes #3', why: 'the never form' },
  { text: 'Closes: #65', why: 'the colon form GitHub also reads' },
  {
    text: 'fixes shyden-labs/shyden.co.uk#12',
    why: 'the cross-repository form',
  },
  { text: 'closes GH-12', why: 'the GH- reference form' },
  {
    text: 'fixes https://github.com/shyden-labs/shyden.co.uk/issues/12',
    why: 'the full issue URL — undocumented by GitHub, so refused rather than trusted',
  },
  {
    text: 'Closes: http://github.com/shyden-labs/shyden.co.uk/pull/12',
    why: 'the URL form with a colon, over http, naming a pull request',
  },
  {
    text: 'and never write close #7 while explaining this very rule',
    why: 'explaining the rule is how the standing note says it happens',
  },
];

/** Messages the guard must leave alone, each with the reason it is safe. */
const ACCEPTED: readonly Fixture[] = [
  {
    text: 'Refs #44 — the ticket stays open.',
    why: 'the phrasing the refusal tells the author to use',
  },
  { text: 'Refs #227', why: 'a bare reference trailer' },
  { text: 'docs: tidy a comment', why: 'no issue reference at all' },
  {
    text: 'the fix for #157 landed on develop',
    why: 'a keyword and a number in one sentence, but NOT adjacent',
  },
  {
    text: '#65 was closed by hand, as the rule requires',
    why: 'reversed order — GitHub closes on nothing here',
  },
  {
    text: 'renamed the prefix#5 identifier',
    why: 'fix inside a longer word: there is no word boundary before it',
  },
  {
    text: 'never write `close #<n>` in a message',
    why: 'a placeholder, not a number — how the rule itself is documented',
  },
  {
    text: 'see https://github.com/shyden-labs/shyden.co.uk/issues/12',
    why: 'an issue URL with no keyword before it',
  },
  {
    text: 'the fix is in https://github.com/shyden-labs/shyden.co.uk/pull/5',
    why: 'a keyword and a URL in one sentence, but NOT adjacent',
  },
  {
    text: 'affixes #9 to the header',
    why: 'fix inside affixes — the same trap with the number adjacent',
  },
];

describe('the closing-keyword rule, in its one home', () => {
  it.each(REFUSED)('refuses "$text" — $why', ({ text }) => {
    const offences = closingKeywordOffences(text);
    expect(offences).toHaveLength(1);
    expect(offences[0]).toMatchObject({ line: 1, text });
  });

  it('leaves every safe phrasing alone', () => {
    const wrongly = ACCEPTED.filter(
      ({ text }) => closingKeywordOffences(text).length > 0,
    );
    const phrasings = ACCEPTED.map(({ text }) => text);
    expect(
      searched(wrongly, {
        of: phrasings,
        what: 'safe phrasings',
      }),
    ).toEqual([]);
    expect(
      floorBreach('closing-keywords/safe-phrasings', phrasings.length),
    ).toBeUndefined();
  });

  it('reports the line a multi-line message offends on, not the first', () => {
    const body = ['fix(gauntlet): a folder per group', '', 'Closes #230', ''];
    expect(closingKeywordOffences(body.join('\n'))).toEqual([
      { line: 3, text: 'Closes #230' },
    ]);
  });

  it('reports every offending line, not only the first', () => {
    const body = 'Closes #1\nRefs #2\nFixes #3';
    expect(closingKeywordOffences(body).map(({ line }) => line)).toEqual([
      1, 3,
    ]);
  });

  it('reports two offending lines in a row', () => {
    // Not the same case as the one above, and the difference is the point. A
    // `g` flag on the pattern would carry `lastIndex` from one `.test()` to
    // the next, and the fixture above HIDES that: its clean middle line fails
    // to match, which resets `lastIndex` to 0 before the third is judged.
    // Here line 1's match ends at index 9 and line 2 is 8 characters long, so
    // a carried offset starts the search past the end and the second offence
    // is dropped in silence.
    expect(
      closingKeywordOffences('Closes #1\nFixes #2').map(({ line }) => line),
    ).toEqual([1, 2]);
  });

  it('finds nothing in an empty message', () => {
    // The scanner walks lines: an empty message is one blank line, not none.
    const message = '';
    const lines = message.split('\n');
    expect(
      searched(closingKeywordOffences(message), {
        of: lines.length,
        what: 'lines of the empty message',
      }),
    ).toEqual([]);
    expect(
      floorBreach('closing-keywords/empty-message-lines', lines.length),
    ).toBeUndefined();
  });
});

/**
 * The medium that actually caused the second incident.
 *
 * `gh pr create` runs no git hook, so a pull request body never meets
 * `.githooks/commit-msg` -- and a body is what closed #89. The rule reaches
 * it from CI instead, which is the only place every author passes through.
 *
 * DERIVED, not named. The workflow that carries the check is found by looking
 * for the script, so moving or renaming the file cannot leave this guard
 * quietly passing over a workflow nobody runs (#49, #80).
 */
describe('the rule covers a pull request body, not only a commit message', () => {
  it('is invoked by exactly one workflow', () => {
    expect(workflowsRunningTheRule().map(({ file }) => file)).toEqual([
      'pr-body.yml',
    ]);
  });

  it('re-runs when the body is EDITED, which is the whole point', () => {
    // Declaring `types:` REPLACES the defaults rather than adding to them, so
    // the three that would otherwise be implied are asserted too: dropping
    // `synchronize` would stop checking a body on every later push, and
    // nothing would go red. An exact set, because both directions matter.
    const [only] = workflowsRunningTheRule();
    expect(only?.trigger.on?.pull_request?.types?.slice().sort()).toEqual([
      'edited',
      'opened',
      'reopened',
      'synchronize',
    ]);
  });

  it('covers both media a merge acts on: the body and every commit message', () => {
    // A closing keyword in a COMMIT MESSAGE closes the issue too, the moment
    // the commit lands on the default branch -- that is how the first accident
    // happened. `.githooks/commit-msg` catches those, but `git commit
    // --no-verify` skips it, and `.githooks/pre-push` advertises exactly that
    // escape in its own failure message. CI is the only layer nobody can
    // bypass, so it reads both media, through the same rule.
    const [only] = workflowsRunningTheRule();
    const commands = only?.commands ?? [];
    const invocations = commands.filter((command) =>
      command.startsWith(`node ${SCRIPT}`),
    );
    expect(invocations).toHaveLength(2);
    expect(
      invocations.filter((command) => command.includes('pr-body.txt')),
    ).toHaveLength(1);
    expect(
      invocations.filter((command) => command.includes('commits.txt')),
    ).toHaveLength(1);
    expect(
      commands.filter((command) => command.startsWith('git log')),
    ).toHaveLength(1);

    // An empty commit range is green whatever the rule does, and reads
    // exactly like a clean pull request, so the step refuses one. Anchored at
    // the start of its line: `true || test -s ...` is not this control.
    expect(
      commands.filter((command) => /^test -s .*commits\.txt/.test(command)),
    ).toHaveLength(1);
  });

  it('never expands the body into a shell command', () => {
    // A pull request body is written by whoever opened the PR, including on a
    // fork. `${{ github.event.pull_request.body }}` inside a `run:` script is
    // substituted BEFORE the shell sees it, so a body containing a backtick or
    // `$(...)` executes on the runner. It reaches the script through the
    // environment instead, where it is data.
    const [only] = workflowsRunningTheRule();
    // The general form, not just the body: EVERY value this workflow reads
    // from the event is written by whoever opened the pull request. Naming
    // one field would leave the next one added unguarded.
    const runs = only?.runs ?? [];
    const expanded = runs.filter((run) => run.includes('${{'));
    expect(
      searched(expanded, {
        of: runs,
        what: `run: scripts in ${only?.file ?? 'no workflow'}`,
      }),
    ).toEqual([]);
    expect(
      floorBreach('closing-keywords/rule-workflow-runs', runs.length),
    ).toBeUndefined();
  });
});

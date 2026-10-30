import { describe, expect, it } from 'vitest';
import {
  gapsOffences,
  gapsRefusal,
  judgeCommit,
} from '../../scripts/gaps-checked.mjs';
import { searched } from '../source-files';

/**
 * Every commit message carries its "Gaps checked" section (#897; Shyden
 * 2026-10-21, every repository): `Gaps checked:` then `- Before:`, `- After:`
 * and `- New passes:`. Before and After each hold at least 20 characters and
 * 3 words; New passes is not empty. A commit changing only `.md` files is
 * exempt, judged by its own file list.
 */
const GOOD = [
  'The board deals by order (Refs #1)',
  '',
  'Gaps checked:',
  '- Before: a student dealt twice, planted as a failing test first.',
  '- After: unit 10 of 10, each mutant red on its own test,',
  '  restored green.',
  '- New passes: none.',
  '',
].join('\n');

const without = (line: string) =>
  GOOD.split('\n')
    .filter((l) => !l.startsWith(line))
    .join('\n');

describe('a commit message’s Gaps checked section (#897)', () => {
  it('a message with all three lines passes', () => {
    const lines = GOOD.split('\n');
    expect(
      searched(gapsOffences(GOOD), {
        of: lines.length,
        what: 'lines of the good message',
      }),
    ).toEqual([]);
    expect(
      floorBreach('gaps-checked/good-message-lines', lines.length),
    ).toBeUndefined();
  });

  it('a message with no heading is refused, naming it', () => {
    expect(gapsOffences(without('Gaps checked:'))).toEqual([
      'no `Gaps checked:` heading',
    ]);
  });

  it('a message missing a line is refused, naming that line', () => {
    expect(gapsOffences(without('- New passes:'))).toEqual([
      'no `- New passes:` line',
    ]);
  });

  it('a Before under 20 characters is refused', () => {
    expect(
      gapsOffences(
        GOOD.replace(
          '- Before: a student dealt twice, planted as a failing test first.',
          '- Before: two words ok',
        ),
      ),
    ).toEqual(['`- Before:` holds 12 characters; it needs at least 20']);
  });

  it('an After of two words is refused, however long', () => {
    expect(
      gapsOffences(
        GOOD.replace(
          '- After: unit 10 of 10, each mutant red on its own test,\n  restored green.',
          '- After: unbelievably-thorough checking-everywhere',
        ),
      ),
    ).toEqual(['`- After:` holds 2 words; it needs at least 3']);
  });

  it('an empty New passes is refused', () => {
    expect(
      gapsOffences(GOOD.replace('- New passes: none.', '- New passes:')),
    ).toEqual([
      '`- New passes:` is empty; write `none` if nothing turns into a pass',
    ]);
  });

  it('a section after the trailers still counts, its lines read to the next item', () => {
    const message = `${GOOD}\nCo-Authored-By: Someone <someone@example.invalid>\n`;
    const lines = message.split('\n');
    expect(
      searched(gapsOffences(message), {
        of: lines.length,
        what: 'lines of the message with trailers',
      }),
    ).toEqual([]);
    expect(
      floorBreach('gaps-checked/trailer-message-lines', lines.length),
    ).toBeUndefined();
  });
});

describe('which commits the rule judges (#897)', () => {
  it('a commit changing only .md files is exempt, with no section', () => {
    const files = ['notes.md', 'guide/a.md'];
    expect(
      searched(judgeCommit({ message: 'Docs only', files }), {
        of: files.length,
        what: 'files of the .md-only commit',
      }),
    ).toEqual([]);
    expect(
      floorBreach('gaps-checked/md-only-files', files.length),
    ).toBeUndefined();
  });

  it('a commit changing a .md file and any other file is judged', () => {
    expect(
      judgeCommit({ message: 'Mixed', files: ['notes.md', 'src/a.ts'] }),
    ).toEqual(['no `Gaps checked:` heading']);
  });

  it('a commit whose file list is empty is judged, never read as exempt', () => {
    expect(judgeCommit({ message: 'Empty', files: [] })).toEqual([
      'no `Gaps checked:` heading',
    ]);
  });
});

describe('the refusal an author reads (#897)', () => {
  it('names what was checked, each problem, and the section to write', () => {
    expect(
      gapsRefusal('this commit message', ['no `Gaps checked:` heading']),
    ).toBe(
      [
        'this commit message has no complete Gaps checked section:',
        '',
        '  no `Gaps checked:` heading',
        '',
        'Every commit message carries it (Shyden, 2026-10-21, every repository):',
        '',
        'Gaps checked:',
        '- Before: <every way the change could let through what is refused today, each planted as a failing test first>',
        '- After: <the attack on the diff, the old-vs-new verdicts, coverage of the changed code>',
        '- New passes: <each verdict the change turns into a pass and the ruling that allows it, or none>',
        '',
        'A commit that changes only .md files needs none.',
      ].join('\n'),
    );
  });
});

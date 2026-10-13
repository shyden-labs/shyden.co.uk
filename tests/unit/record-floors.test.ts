import { describe, it, expect } from 'vitest';
import {
  describeMoves,
  recordArguments,
  retireRefusals,
  untrackedRefusal,
  untrackedTreeRefusal,
} from '../../scripts/record-floors.mjs';

/**
 * Retiring a branch-only floor id (#640); the record judging its own ids on
 * the ids it writes is held with `recordUntilSettled`'s other tests in
 * `tests/guards/floors.test.ts`. #631 needed three hand edits of
 * `tests/floors.json` in one story, each refused by the auto-mode classifier:
 * the recorder had no route to retire an id the branch itself created, and it
 * judged the floors that count the record's ids before the new ids were in it,
 * so a retire plus its replacement read as 434 -> 433 and was refused.
 */
describe('retireRefusals: only a branch-only id nothing spells leaves the record', () => {
  const develop = { landed: 3 };
  const spelledIn = (id: string) =>
    id === 'still-used' ? ['tests/unit/still.test.ts'] : [];

  it('retires an id develop never held and no test spells', () => {
    // Judged beside a landed id, so the verdict shows the judge ran: only the
    // landed one is refused.
    expect(
      retireRefusals(['branch-only', 'landed'], {
        recorded: { 'branch-only': 1, landed: 3 },
        develop,
        spelledIn,
      }),
    ).toEqual([
      'landed is on origin/develop: a landed floor leaves the record only by ' +
        "the operator's ruling, as a hand edit of tests/floors.json with the " +
        'reason in the commit',
    ]);
  });

  it('refuses an id that is on develop, naming the operator as the only route', () => {
    expect(
      retireRefusals(['landed'], {
        recorded: { landed: 3 },
        develop,
        spelledIn,
      }),
    ).toEqual([
      'landed is on origin/develop: a landed floor leaves the record only by ' +
        "the operator's ruling, as a hand edit of tests/floors.json with the " +
        'reason in the commit',
    ]);
  });

  it('refuses an id a test still spells, naming the file', () => {
    expect(
      retireRefusals(['still-used'], {
        recorded: { 'still-used': 2 },
        develop,
        spelledIn,
      }),
    ).toEqual([
      'still-used is still spelled in tests/unit/still.test.ts: retire it ' +
        'with the floor that used it',
    ]);
  });

  it('refuses every id when develop could not be read, never reading that as absent', () => {
    expect(
      retireRefusals(['branch-only'], {
        recorded: { 'branch-only': 1 },
        develop: 'git show exited 128',
        spelledIn,
      }),
    ).toEqual([
      'branch-only cannot be retired: whether origin/develop holds it is ' +
        'unknown (git show exited 128)',
    ]);
  });

  it('refuses an id the record does not hold', () => {
    expect(
      retireRefusals(['typo'], {
        recorded: { landed: 3 },
        develop,
        spelledIn,
      }),
    ).toEqual(['typo is not in tests/floors.json: nothing to retire']);
  });
});

describe('describeMoves prints a retired id beside the moved floors', () => {
  it('names the retired id and the figure it held', () => {
    expect(
      describeMoves({ a: 4, old: 7, self: 3 }, { a: 5, fresh: 1, self: 3 }),
    ).toEqual(['a: 4 -> 5 (+1)', 'fresh: new, 1', 'old: retired, was 7']);
  });
});

describe('recordArguments reads the mode and the ids to retire', () => {
  it('reads no argument as a full record retiring nothing', () => {
    expect(recordArguments([])).toEqual({ mode: undefined, retired: [] });
  });

  it('reads a mode with ids to retire, in any order', () => {
    expect(
      recordArguments(['--retire', 'x/one', '--unit', '--retire', 'x/two']),
    ).toEqual({ mode: '--unit', retired: ['x/one', 'x/two'] });
  });

  it('reads --unit-suite as a mode beside ids to retire (#658)', () => {
    expect(recordArguments(['--unit-suite', '--retire', 'x/one'])).toEqual({
      mode: '--unit-suite',
      retired: ['x/one'],
    });
  });

  it('refuses --retire with no id after it', () => {
    expect(recordArguments(['--unit', '--retire'])).toBe(
      'usage: npm run floors:record [-- --unit | --functions | --unit-suite] ' +
        '[--retire <id>]... (got --unit --retire)',
    );
  });

  it('refuses --retire followed by a flag instead of an id', () => {
    expect(recordArguments(['--retire', '--unit'])).toBe(
      'usage: npm run floors:record [-- --unit | --functions | --unit-suite] ' +
        '[--retire <id>]... (got --retire --unit)',
    );
  });

  it('refuses two modes at once', () => {
    expect(recordArguments(['--unit', '--functions'])).toBe(
      'usage: npm run floors:record [-- --unit | --functions | --unit-suite] ' +
        '[--retire <id>]... (got --unit --functions)',
    );
  });

  it('refuses an argument it does not know', () => {
    expect(recordArguments(['--units'])).toBe(
      'usage: npm run floors:record [-- --unit | --functions | --unit-suite] ' +
        '[--retire <id>]... (got --units)',
    );
  });
});

/**
 * A record never counts a tree CI will not see (#547). The guards that read
 * git count tracked files only, so a record taken with a new file untracked
 * writes a figure the committed tree beats: five times, the last in #696,
 * where three floors were each 3 short at the pre-push run. `untrackedRefusal`
 * reads `git ls-files --others --exclude-standard -z`; the run itself is held
 * in `tests/integration/floors.test.ts`.
 */
describe('untrackedRefusal: a record waits until every new file is staged', () => {
  it('passes a tree git reports nothing untracked in', () => {
    expect(untrackedRefusal('')).toBeUndefined();
  });

  it('refuses each untracked file by name, with the command that stages it', () => {
    expect(
      untrackedRefusal('tests/load-reporter.ts\0tests/unit/a b.test.ts\0'),
    ).toBe(
      'nothing recorded: 2 untracked files, which the guards that read git ' +
        'would not count and CI, with them committed, would (#547). ' +
        'Stage each first:\n' +
        "  git add -N -- 'tests/load-reporter.ts'\n" +
        "  git add -N -- 'tests/unit/a b.test.ts'",
    );
  });

  it('says file, not files, for one', () => {
    expect(untrackedRefusal('tests/x.ts\0')).toBe(
      'nothing recorded: 1 untracked file, which the guards that read git ' +
        'would not count and CI, with it committed, would (#547). ' +
        'Stage it first:\n' +
        "  git add -N -- 'tests/x.ts'",
    );
  });
});

describe('untrackedTreeRefusal asks git, with the process stood in (#547)', () => {
  type Answer = { status: number | null; error?: Error; stdout: string };
  /** A `run` that answers `answer` and keeps what it was asked. */
  const asking = (answer: Answer) => {
    const asked: string[][] = [];
    const run = (command: string, args: readonly string[]) => {
      asked.push([command, ...args]);
      return answer;
    };
    return { asked, run };
  };

  it('asks git for untracked files that are not ignored, NUL-separated, once', () => {
    const { asked, run } = asking({ status: 0, stdout: '' });
    expect(untrackedTreeRefusal(run)).toBeUndefined();
    expect(asked).toEqual([
      ['git', 'ls-files', '--others', '--exclude-standard', '-z'],
    ]);
  });

  it('refuses the files git names', () => {
    const { run } = asking({ status: 0, stdout: 'tests/x.ts\0' });
    expect(untrackedTreeRefusal(run)).toBe(untrackedRefusal('tests/x.ts\0'));
    expect(untrackedRefusal('tests/x.ts\0')).toContain("'tests/x.ts'");
  });

  it('refuses a listing that failed, never reading it as none', () => {
    const { run } = asking({ status: 128, stdout: '' });
    expect(untrackedTreeRefusal(run)).toBe(
      'the untracked-file listing failed in record mode (exit 128): nothing recorded',
    );
  });

  it('refuses a listing that never started, naming why', () => {
    const { run } = asking({
      status: null,
      error: new Error('spawnSync git ENOENT'),
      stdout: '',
    });
    expect(untrackedTreeRefusal(run)).toBe(
      'the untracked-file listing did not start: spawnSync git ENOENT',
    );
  });
});

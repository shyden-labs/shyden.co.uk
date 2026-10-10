import { describe, it, expect } from 'vitest';
import {
  accountFileName,
  accountFindings,
  docsOnlyFindings,
  isDocsOnlyRun,
  needsFindings,
  shardAccount,
  shardNotice,
  shardOf,
} from '../../scripts/e2e-shards.mjs';
import {
  RUN_WHEN_DOCS_ONLY,
  SKIPPED_WHEN_DOCS_ONLY,
} from '../../scripts/docs-only.mjs';
import { searched } from '../source-files';
import { floorBreach } from '../floors';
import { SUITE, account, whole, docsOnlyNeeds } from '../e2e-shards-shared';

describe('shardOf: the shard a run was asked for', () => {
  it('reads --shard=i/N', () => {
    expect(shardOf(['--shard=2/4'])).toEqual({ index: 2, total: 4 });
  });

  it('reads --shard i/N, with its value as the next argument', () => {
    expect(shardOf(['--project=chromium', '--shard', '3/4'])).toEqual({
      index: 3,
      total: 4,
    });
  });

  it('is null for a run that asked for no shard', () => {
    expect(shardOf([])).toBeNull();
    expect(
      shardOf(['--project=chromium', 'tests/e2e/chrome.spec.ts']),
    ).toBeNull();
  });

  // Playwright refuses these too, but a shard this module cannot place would
  // write an account nobody can reconcile. Refused by name, so the message
  // points at the argument rather than at arithmetic three steps later.
  it.each([
    ['--shard=0/4'],
    ['--shard=5/4'],
    ['--shard=2/0'],
    ['--shard=2'],
    ['--shard=x/4'],
    ['--shard=2/4/1'],
  ])('refuses %s, naming it', (arg) => {
    expect(() => shardOf([arg])).toThrow(`${arg} is not`);
  });

  it('names a value given as the next argument the same way', () => {
    expect(() => shardOf(['--shard', '5/4'])).toThrow('--shard=5/4 is not');
  });

  it('refuses --shard with no value at all', () => {
    // The whole message: `--shard=undefined is not a shard` names the flag
    // too, and is what the run said before this refusal existed.
    expect(() => shardOf(['--shard'])).toThrow(
      '--shard was given no value: expected <index>/<total>',
    );
  });
});

describe('accountFileName: one file per shard', () => {
  // The aggregating job downloads every shard's artifact into ONE directory.
  // Two shards writing the same file name would overwrite each other, and the
  // survivor would read as a whole suite that ran only once.
  it('names the shard and the total', () => {
    expect(accountFileName({ index: 2, total: 4 })).toBe(
      'e2e-account-2-of-4.json',
    );
  });

  it('never gives two shards of one run the same name', () => {
    const names = [1, 2, 3, 4].map((index) =>
      accountFileName({ index, total: 4 }),
    );
    expect(new Set(names).size).toBe(4);
  });
});

describe('shardAccount: what a shard writes down about its own run', () => {
  const measured = {
    enumerated: 7,
    executed: 7,
    playwrightExitCode: 0,
    listingStatus: 0,
  };

  // The writer and the reader share this module, so the one account a shard
  // can write is one the verdict can read. A round trip, not two fixtures.
  it('is an account the verdict accepts, filed under its own name', () => {
    const recorded = shardAccount({ argv: ['--shard=1/1'], ...measured });
    expect(recorded?.file).toBe('e2e-account-1-of-1.json');
    const accounts = [recorded?.account];
    expect(
      searched(accountFindings(accounts), { of: accounts, what: 'accounts' }),
    ).toEqual([]);
    expect(
      floorBreach('e2e-shards/round-trip-accounts', accounts.length),
    ).toBeUndefined();
  });

  it('carries what the run measured, not what it was meant to', () => {
    const recorded = shardAccount({
      argv: ['--shard=1/1'],
      ...measured,
      executed: 6,
    });
    expect(accountFindings([recorded?.account])).toEqual([
      expect.stringMatching(/6 of the 7/),
    ]);
  });

  // A report nobody could read is still worth an account: the verdict names
  // the shard that measured nothing, instead of a shard that never reported.
  it('records a run whose report could not be read as having measured nothing', () => {
    const recorded = shardAccount({
      argv: ['--shard=2/2'],
      ...measured,
      executed: null,
    });
    expect(recorded?.account.executed).toBeNull();
    expect(accountFindings([recorded?.account]).join('\n')).toMatch(
      /shard 2 of 2 accounted for no tests at all/,
    );
  });

  it('is null for a run that was not a shard', () => {
    expect(
      shardAccount({ argv: ['--project=chromium'], ...measured }),
    ).toBeNull();
  });
});

describe('shardNotice: what a shard says about its own count', () => {
  // `reconcile()` calls any narrowed run PARTIAL and "NOT judged against the
  // full suite". True of `--project=chromium` at a desk; false of a CI shard,
  // whose count build-and-test judges. The log must not tell a reader looking
  // at a red shard that nothing checks it.
  it('names the shard, its count and who holds the sum', () => {
    const notice = shardNotice({
      shard: { index: 2, total: 4 },
      enumerated: SUITE,
      executed: 553,
      playwrightExitCode: 0,
      listingStatus: 0,
    });
    expect(notice).toMatch(/SHARD 2 of 4/);
    expect(notice).toMatch(/553 of the 2210/);
    expect(notice).toMatch(/build-and-test/);
    expect(notice).not.toMatch(/NOT judged/);
  });
});

describe('needsFindings: every job build-and-test stands for succeeded', () => {
  const needs = (e2e: string, checks = 'success') => ({
    checks: { result: checks, outputs: {} },
    e2e: { result: e2e, outputs: {} },
  });

  it('has nothing to say when every job succeeded', () => {
    const jobs = needs('success');
    expect(
      searched(needsFindings(jobs), {
        of: Object.values(jobs),
        what: 'jobs build-and-test stands for',
      }),
    ).toEqual([]);
    expect(
      floorBreach('e2e-shards/succeeded-jobs', Object.values(jobs).length),
    ).toBeUndefined();
  });

  // `skipped` is the dangerous one: a skipped required check is reported to
  // branch protection as passing, so a skipped shard must never reach it as
  // anything but a refusal (#157).
  it.each(['failure', 'cancelled', 'skipped'])(
    'refuses a job that finished %s, naming the job and the result',
    (result) => {
      const findings = needsFindings(needs(result));
      expect(findings).toHaveLength(1);
      expect(findings[0]).toContain('e2e');
      expect(findings[0]).toContain(result);
    },
  );

  it('names every job that did not succeed, not only the first', () => {
    const findings = needsFindings(needs('cancelled', 'failure'));
    expect(findings).toHaveLength(2);
    expect(findings.join('\n')).toMatch(/checks[\s\S]*e2e/);
  });

  // An aggregate standing for nothing agrees with everything. `toJSON(needs)`
  // is `{}` for a job that needs nothing, which is what an edit dropping the
  // `needs:` line would hand it.
  it('refuses to vouch for no jobs at all', () => {
    expect(needsFindings({})).toEqual([
      expect.stringMatching(/stands for no job/),
    ]);
  });

  it.each([[null], ['success'], [[]], [42]])(
    'refuses needs it cannot read: %j',
    (value) => {
      expect(needsFindings(value)).toEqual([
        expect.stringMatching(/could not be read/),
      ]);
    },
  );

  it('refuses a job whose result is missing', () => {
    expect(needsFindings({ e2e: { outputs: {} } })).toEqual([
      expect.stringMatching(/e2e/),
    ]);
  });
});

describe('isDocsOnlyRun: whether the scope job said docs-only', () => {
  it('reads the scope job saying true', () => {
    expect(isDocsOnlyRun(docsOnlyNeeds())).toBe(true);
  });

  it.each([
    ['false', { result: 'success', outputs: { docs_only: 'false' } }],
    ['no output', { result: 'success', outputs: {} }],
    ['TRUE', { result: 'success', outputs: { docs_only: 'TRUE' } }],
    ['a failed scope job', { result: 'failure', outputs: {} }],
  ])('reads %s as a full run', (_, scope) => {
    expect(isDocsOnlyRun(docsOnlyNeeds({ scope }))).toBe(false);
  });

  it.each([
    ['no scope job', docsOnlyNeeds({ scope: undefined })],
    ['needs that are not a record', 'nothing'],
    [
      'a boolean, not the string the runner hands over',
      { scope: { result: 'success', outputs: { docs_only: true } } },
    ],
  ])('reads %s as a full run', (_, needs) => {
    expect(isDocsOnlyRun(needs)).toBe(false);
  });
});

describe('docsOnlyFindings: a docs-only pull request skipped exactly what it may', () => {
  it('has nothing to say when the skipped jobs were skipped and the rest succeeded', () => {
    const jobs = docsOnlyNeeds();
    expect(
      searched(docsOnlyFindings(jobs, []), {
        of: Object.values(jobs),
        what: 'jobs build-and-test stands for',
      }),
    ).toEqual([]);
    expect(
      floorBreach('e2e-shards/docs-only-jobs', Object.values(jobs).length),
    ).toBeUndefined();
  });

  it.each(
    SKIPPED_WHEN_DOCS_ONLY.flatMap((job) =>
      ['success', 'failure', 'cancelled'].map((result) => [job, result]),
    ),
  )(
    'refuses %s finishing %s, since a docs-only verdict skips it',
    (job, result) => {
      const findings = docsOnlyFindings(
        docsOnlyNeeds({ [job]: { result, outputs: {} } }),
        [],
      );
      expect(findings).toEqual([
        `${job} finished \`${result}\` on a docs-only pull request, which skips it`,
      ]);
    },
  );

  it.each(SKIPPED_WHEN_DOCS_ONLY)(
    'refuses %s missing from the jobs it stands for',
    (job) => {
      expect(docsOnlyFindings(docsOnlyNeeds({ [job]: undefined }), [])).toEqual(
        [
          `${job} is not among the jobs build-and-test stands for, so its skip proves nothing`,
        ],
      );
    },
  );

  it.each(
    RUN_WHEN_DOCS_ONLY.flatMap((job) =>
      ['failure', 'skipped', 'cancelled'].map((result) => [job, result]),
    ),
  )(
    'refuses %s finishing %s, since a docs-only verdict still runs it',
    (job, result) => {
      const findings = docsOnlyFindings(
        docsOnlyNeeds({
          [job]: {
            result,
            outputs: job === 'scope' ? { docs_only: 'true' } : {},
          },
        }),
        [],
      );
      expect(findings).toContain(
        `${job} finished \`${result}\`, not \`success\``,
      );
    },
  );

  it('refuses checks missing from the jobs it stands for', () => {
    expect(docsOnlyFindings(docsOnlyNeeds({ checks: undefined }), [])).toEqual([
      'checks is not among the jobs build-and-test stands for, so a docs-only pull request would pass untested',
    ]);
  });

  it('refuses a job it keeps that failed, whatever its name', () => {
    expect(
      docsOnlyFindings(
        docsOnlyNeeds({ image: { result: 'failure', outputs: {} } }),
        [],
      ),
    ).toEqual(['image finished `failure`, not `success`']);
  });

  it('refuses a shard account, since no shard runs on a docs-only pull request', () => {
    expect(
      docsOnlyFindings(docsOnlyNeeds(), ['e2e-accounts/shard-1-of-8.json']),
    ).toEqual([
      'e2e-accounts/shard-1-of-8.json is a shard account, and no shard runs on a docs-only pull request',
    ]);
  });
});

describe('accountFindings: the shards add up to the suite', () => {
  it('has nothing to say when four shards ran exactly the enumerated suite', () => {
    const accounts = whole();
    expect(
      searched(accountFindings(accounts), { of: accounts, what: 'accounts' }),
    ).toEqual([]);
    expect(
      floorBreach('e2e-shards/whole-suite-accounts', accounts.length),
    ).toBeUndefined();
  });

  it('refuses a total one short, and says by how much', () => {
    const accounts = whole();
    accounts[2] = account(3, 551);
    expect(accountFindings(accounts)).toEqual([
      expect.stringMatching(/2209 of the 2210/),
    ]);
  });

  it('refuses more tests than the suite holds as a disagreement too', () => {
    const accounts = whole();
    accounts[0] = account(1, 554);
    expect(accountFindings(accounts)).toEqual([
      expect.stringMatching(/2211 of the 2210/),
    ]);
  });

  it('names a shard that never reported', () => {
    const accounts = whole().filter(({ shard }) => shard.index !== 3);
    const findings = accountFindings(accounts);
    expect(findings.join('\n')).toMatch(/shard 3 of 4/);
  });

  it('names a shard that reported twice', () => {
    const accounts = [...whole(), account(2, 553)];
    expect(accountFindings(accounts).join('\n')).toMatch(
      /shard 2 of 4 .*2 accounts/,
    );
  });

  it('refuses shards that disagree on how many shards there are', () => {
    const accounts = whole();
    accounts[3] = account(4, 552, { shard: { index: 4, total: 5 } });
    expect(accountFindings(accounts).join('\n')).toMatch(/disagree/);
  });

  it('refuses shards that enumerated different suites', () => {
    const accounts = whole();
    accounts[1] = account(2, 553, { enumerated: 2209 });
    expect(accountFindings(accounts).join('\n')).toMatch(
      /2209[\s\S]*2210|2210[\s\S]*2209/,
    );
  });

  // Zero is a broken measurement, not a small shard: `reconcile()` in
  // test-e2e.mjs refuses a run of zero for the same reason (#150).
  it('refuses a shard that ran no tests', () => {
    const accounts = whole();
    accounts[1] = account(2, 0);
    expect(accountFindings(accounts).join('\n')).toMatch(
      /shard 2 of 4 ran no tests/,
    );
  });

  it('refuses a shard that could not say how big the suite is, in those words', () => {
    const accounts = whole();
    accounts[2] = account(3, 552, { enumerated: null });
    const findings = accountFindings(accounts);
    expect(findings).toContain(
      'a shard could not say how many tests the suite holds',
    );
    // Not a disagreement between suites, and no sum against a null size.
    expect(findings.join('\n')).not.toMatch(/null/);
  });

  it('refuses an enumeration of zero', () => {
    const accounts = whole().map((each) => ({ ...each, enumerated: 0 }));
    expect(accountFindings(accounts).join('\n')).toMatch(/enumerated no tests/);
  });

  it('refuses no accounts at all', () => {
    expect(accountFindings([])).toEqual([
      expect.stringMatching(/no shard accounted for itself/),
    ]);
  });

  it('refuses a shard whose listing failed, whatever it counted', () => {
    const accounts = whole();
    accounts[0] = account(1, 553, { listingStatus: 1 });
    expect(accountFindings(accounts).join('\n')).toMatch(
      /shard 1 of 4 .*--list.* exited 1/,
    );
  });

  it('refuses a shard whose Playwright run failed, whatever it counted', () => {
    const accounts = whole();
    accounts[3] = account(4, 552, { playwrightExitCode: 1 });
    expect(accountFindings(accounts).join('\n')).toMatch(
      /shard 4 of 4 .*Playwright exited 1/,
    );
  });

  it.each([
    [null],
    [{}],
    [{ shard: { index: 1, total: 4 }, enumerated: SUITE }],
    [{ ...account(1, 553), executed: '553' }],
    [{ ...account(1, 553), playwrightExitCode: null }],
    [{ ...account(1, 553), playwrightExitCode: '0' }],
  ])('refuses an account it cannot read: %j', (broken) => {
    const accounts: unknown[] = whole().slice(1);
    accounts.unshift(broken);
    expect(accountFindings(accounts).join('\n')).toMatch(/not an account/);
  });
});

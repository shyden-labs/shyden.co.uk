import { describe, it, expect } from 'vitest';
import {
  accountArguments,
  accountFileName,
  accountFindings,
  captureAccountFindings,
  docsOnlyFindings,
  interruptedTests,
  isDocsOnlyRun,
  needsFindings,
  scopedJobFindings,
  shardAccount,
  shardNotice,
  shardDeadlineMs,
  shardOf,
  shardTimes,
} from '../../scripts/e2e-shards.mjs';
import {
  RUN_WHEN_DOCS_ONLY,
  SKIPPED_WHEN_DOCS_ONLY,
} from '../../scripts/docs-only.mjs';
import { searched } from '../source-files';
import { floorBreach } from '../floors';
import {
  SUITE,
  WHOLE_UNITS,
  account,
  whole,
  docsOnlyNeeds,
} from '../e2e-shards-shared';

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
    seconds: 42,
    listedUnits: { '[chromium] › a.spec.ts': 7 },
    ranUnits: { '[chromium] › a.spec.ts': 7 },
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
    const notice = shardNotice(account(2, 553));
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
  // The Playwright run's wall time (#607), printed per shard by shardTimes.
  it('refuses an account whose seconds is negative', () => {
    const accounts = whole();
    accounts[0] = account(1, 553, { seconds: -1 });
    expect(accountFindings(accounts)[0]).toMatch(
      /^account 1 is not an account/,
    );
  });

  it('refuses an account whose seconds is written as a string', () => {
    const accounts: unknown[] = whole();
    accounts[0] = { ...account(1, 553), seconds: '600' };
    expect(accountFindings(accounts)[0]).toMatch(
      /^account 1 is not an account/,
    );
  });

  it('refuses an account with no seconds at all', () => {
    const { seconds: _dropped, ...rest } = account(1, 553);
    const accounts: unknown[] = [rest, ...whole().slice(1)];
    expect(accountFindings(accounts)[0]).toMatch(
      /^account 1 is not an account/,
    );
  });

  // Our own planner splits the suite now, where Playwright's split could
  // never put one test in two shards; so the sum alone is not "exactly once".
  it('refuses a spec file run in two shards, though a missing one keeps the sum right', () => {
    const accounts = whole();
    accounts[3] = account(4, 552, {
      ranUnits: { '[chromium] › 3.spec.ts': 552 },
    });
    expect(accountFindings(accounts)).toEqual([
      '[chromium] › 3.spec.ts: the shards ran 1104 of its 552 tests',
      '[chromium] › 4.spec.ts: the shards ran 0 of its 552 tests',
    ]);
  });

  it('refuses a test the shards ran that no listing holds', () => {
    const accounts = whole();
    accounts[0] = account(1, 553, {
      ranUnits: {
        '[chromium] › 1.spec.ts': 552,
        '[chromium] › new.spec.ts': 1,
      },
    });
    expect(accountFindings(accounts)).toEqual([
      '[chromium] › 1.spec.ts: the shards ran 552 of its 553 tests',
      '[chromium] › new.spec.ts: the shards ran 1 of its 0 tests',
    ]);
  });

  it('refuses shards that listed different spec files', () => {
    const accounts = whole();
    accounts[1] = account(2, 553, {
      listedUnits: { ...WHOLE_UNITS, '[chromium] › 5.spec.ts': 1 },
    });
    expect(accountFindings(accounts)).toContain(
      'the shards listed different spec files',
    );
  });

  it('names a shard that could not say which spec files it ran', () => {
    const accounts = whole();
    accounts[2] = account(3, 552, { ranUnits: null });
    expect(accountFindings(accounts)).toEqual([
      'shard 3 of 4 could not say which spec files it ran',
    ]);
  });

  it('names a shard that could not list the spec files', () => {
    const accounts = whole();
    accounts[2] = account(3, 552, { listedUnits: null });
    expect(accountFindings(accounts)).toEqual([
      'shard 3 of 4 could not say which spec files the suite holds',
    ]);
  });

  it('refuses an account whose spec-file counts are not counts', () => {
    const accounts: unknown[] = whole();
    accounts[0] = {
      ...account(1, 553),
      ranUnits: { '[chromium] › 1.spec.ts': -1 },
    };
    expect(accountFindings(accounts)[0]).toMatch(
      /^account 1 is not an account/,
    );
  });

  it('accepts a shard whose run could not be timed', () => {
    const accounts = whole();
    accounts[0] = account(1, 553, { seconds: null });
    expect(
      searched(accountFindings(accounts), { of: accounts, what: 'accounts' }),
    ).toEqual([]);
    expect(
      floorBreach('e2e-shards/untimed-shard-accounts', accounts.length),
    ).toBeUndefined();
  });

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
      '[chromium] › 3.spec.ts: the shards ran 551 of its 552 tests',
    ]);
  });

  it('refuses more tests than the suite holds as a disagreement too', () => {
    const accounts = whole();
    accounts[0] = account(1, 554);
    expect(accountFindings(accounts)).toEqual([
      expect.stringMatching(/2211 of the 2210/),
      '[chromium] › 1.spec.ts: the shards ran 554 of its 553 tests',
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

// The two jobs scope decides (#774, #822): each runs exactly where scope's
// own verdict says, so its skip is a pass there and a refusal elsewhere. One
// rule, two rows; every message is written out per job, never built from the
// row it is checked against.
describe.each([
  {
    job: 'capture',
    verdict: 'capture',
    absent:
      'capture is not among the jobs build-and-test stands for, so a case with no picture would pass',
  },
  {
    job: 'logs',
    verdict: 'release',
    absent:
      'logs is not among the jobs build-and-test stands for, so a release whose logs and audit trails were never checked would pass',
  },
] as const)(
  'scopedJobFindings: $job ran exactly where scope said ($verdict, #774, #822)',
  ({ job: name, verdict, absent }) => {
    const checks = { result: 'success', outputs: {} };
    const scopeSaid = (said: unknown) => ({
      result: 'success',
      outputs: { docs_only: 'false', [verdict]: said },
    });
    const job = (result: string) => ({ result, outputs: {} });

    it('takes a run where scope said it runs, and hands on the rest', () => {
      expect(
        scopedJobFindings(
          { scope: scopeSaid('true'), checks, [name]: job('success') },
          name,
        ),
      ).toEqual({ findings: [], rest: { scope: scopeSaid('true'), checks } });
    });

    it('takes a skip where scope said it does not run', () => {
      expect(
        scopedJobFindings(
          { scope: scopeSaid('false'), checks, [name]: job('skipped') },
          name,
        ),
      ).toEqual({ findings: [], rest: { scope: scopeSaid('false'), checks } });
    });

    it('refuses a skip where scope said it runs', () => {
      expect(
        scopedJobFindings(
          { scope: scopeSaid('true'), [name]: job('skipped') },
          name,
        ).findings,
      ).toEqual([
        {
          capture:
            'capture finished `skipped` where scope said it runs, not `success`',
          logs: 'logs finished `skipped` where scope said it runs, not `success`',
        }[name],
      ]);
    });

    it('refuses a failure where scope said it runs', () => {
      expect(
        scopedJobFindings(
          { scope: scopeSaid('true'), [name]: job('failure') },
          name,
        ).findings,
      ).toEqual([
        {
          capture:
            'capture finished `failure` where scope said it runs, not `success`',
          logs: 'logs finished `failure` where scope said it runs, not `success`',
        }[name],
      ]);
    });

    it('refuses a run where scope said it does not', () => {
      expect(
        scopedJobFindings(
          { scope: scopeSaid('false'), [name]: job('success') },
          name,
        ).findings,
      ).toEqual([
        {
          capture:
            'capture finished `success` where scope said it does not run, not `skipped`',
          logs: 'logs finished `success` where scope said it does not run, not `skipped`',
        }[name],
      ]);
    });

    it('refuses a scope that handed on no verdict for it', () => {
      expect(
        scopedJobFindings(
          {
            scope: { result: 'success', outputs: { docs_only: 'false' } },
            [name]: job('skipped'),
          },
          name,
        ).findings,
      ).toEqual([
        {
          capture:
            'scope handed on no capture verdict (undefined), so capture finishing `skipped` cannot be judged',
          logs: 'scope handed on no release verdict (undefined), so logs finishing `skipped` cannot be judged',
        }[name],
      ]);
    });

    it('refuses a verdict that is not exactly true or false', () => {
      expect(
        scopedJobFindings(
          { scope: scopeSaid('TRUE'), [name]: job('success') },
          name,
        ).findings,
      ).toEqual([
        {
          capture:
            'scope handed on no capture verdict ("TRUE"), so capture finishing `success` cannot be judged',
          logs: 'scope handed on no release verdict ("TRUE"), so logs finishing `success` cannot be judged',
        }[name],
      ]);
    });

    it('refuses needs that do not include the job', () => {
      expect(
        scopedJobFindings({ scope: scopeSaid('false'), checks }, name),
      ).toEqual({
        findings: [absent],
        rest: { scope: scopeSaid('false'), checks },
      });
    });

    it('hands needs it cannot read to the verdict that refuses them', () => {
      expect(scopedJobFindings('not json', name)).toEqual({
        findings: [],
        rest: 'not json',
      });
    });
  },
);

describe('accountArguments: the e2e accounts, then the capture accounts (#774)', () => {
  it('splits the files at --capture', () => {
    expect(
      accountArguments(['e2e/1.json', 'e2e/2.json', '--capture', 'cap/1.json']),
    ).toEqual({ e2e: ['e2e/1.json', 'e2e/2.json'], capture: ['cap/1.json'] });
  });

  it('keeps an unmatched capture glob as the file it names, for the verdict to refuse', () => {
    expect(accountArguments(['e2e/1.json', '--capture', 'cap/*.json'])).toEqual(
      { e2e: ['e2e/1.json'], capture: ['cap/*.json'] },
    );
  });

  it('says when it was handed no --capture at all', () => {
    expect(accountArguments(['e2e/1.json'])).toEqual({
      e2e: ['e2e/1.json'],
      capture: null,
    });
  });
});

describe('captureAccountFindings: the capture shards ran the whole selection (#774)', () => {
  it('has nothing to say when four capture shards ran exactly the selection', () => {
    const accounts = whole();
    expect(
      searched(captureAccountFindings(true, accounts), {
        of: accounts,
        what: 'capture accounts',
      }),
    ).toEqual([]);
    expect(
      floorBreach('e2e-shards/capture-accounts', accounts.length),
    ).toBeUndefined();
  });

  it('refuses capture shards that ran one case short, naming the capture', () => {
    const accounts = whole();
    accounts[1] = account(2, 552);
    expect(captureAccountFindings(true, accounts)).toEqual([
      'the capture: the shards ran 2209 of the 2210 tests the suite holds',
      'the capture: [chromium] › 2.spec.ts: the shards ran 552 of its 553 tests',
    ]);
  });

  it('refuses a capture that ran where no shard accounted for itself', () => {
    expect(captureAccountFindings(true, [])).toEqual([
      'the capture: no shard accounted for itself, so there is no evidence that any of the suite ran',
    ]);
  });

  it('refuses capture accounts written where scope said the capture does not run', () => {
    expect(captureAccountFindings(false, whole())).toEqual([
      'the capture: 4 shard accounts were written, where scope said the capture does not run',
    ]);
  });

  it('takes no capture account where scope said the capture does not run', () => {
    const cases = [
      {
        case: 'scope said the capture is skipped, and none was written',
        input: [],
      },
    ];
    expect(
      searched(
        cases.flatMap(({ input }) => captureAccountFindings(false, input)),
        { of: cases, what: 'cases' },
      ),
    ).toEqual([]);
    expect(
      floorBreach('e2e-shards/capture-skipped-cases', cases.length),
    ).toBeUndefined();
  });
});

describe('shardTimes: each shard`s run time and how far the slowest is from the mean (#607)', () => {
  it('names every shard`s minutes in shard order, and the ratio', () => {
    const accounts = [
      account(2, 553, { seconds: 660 }),
      account(1, 553, { seconds: 600 }),
      account(4, 552, { seconds: 540 }),
      account(3, 552, { seconds: 600 }),
    ];
    expect(shardTimes(accounts)).toBe(
      [
        '| shard | minutes |',
        '| --- | --- |',
        '| 1 of 4 | 10.0 |',
        '| 2 of 4 | 11.0 |',
        '| 3 of 4 | 10.0 |',
        '| 4 of 4 | 9.0 |',
        '',
        'slowest 11.0 min, mean 10.0 min: slowest/mean 1.10',
      ].join('\n'),
    );
  });

  it('marks a shard that could not be timed and leaves it out of the mean', () => {
    const accounts = [
      account(1, 553, { seconds: 600 }),
      account(2, 553, { seconds: null }),
    ];
    expect(shardTimes(accounts)).toBe(
      [
        '| shard | minutes |',
        '| --- | --- |',
        '| 1 of 4 | 10.0 |',
        '| 2 of 4 | not timed |',
        '',
        'slowest 10.0 min, mean 10.0 min: slowest/mean 1.00',
      ].join('\n'),
    );
  });

  it('says so when no shard could be timed', () => {
    expect(shardTimes([account(1, 553, { seconds: null })])).toBe(
      '| shard | minutes |\n| --- | --- |\n| 1 of 4 | not timed |\n\nno shard was timed',
    );
  });
});

/**
 * Issue 938: a shard that hung ran out its job's 20-minute limit, and GitHub
 * threw the job's log away. Each CI shard now ends itself 17 minutes after
 * its job started (Shyden, 2026-10-22), through Playwright's global timeout,
 * so its report and traces are kept. The job's first step writes the time.
 */
describe('a CI shard ends itself before its job limit (#938)', () => {
  const shard = ['--shard=3/10'];
  const ci = { CI: 'true', E2E_JOB_STARTED: '1000' };

  it('leaves an unsharded run without a deadline', () => {
    expect(shardDeadlineMs([], ci, 1100)).toBeNull();
  });

  it('leaves a sharded run off CI without a deadline', () => {
    expect(shardDeadlineMs(shard, {}, 1100)).toBeNull();
  });

  it('gives a CI shard what is left of 17 minutes from its job start', () => {
    // 1020 s from the job's start, which ran up to 36 s before its first
    // step wrote 1000: the run may last until 1984.
    expect(shardDeadlineMs(shard, ci, 1100)).toBe(884_000);
  });

  it('refuses a CI shard whose job never wrote its start', () => {
    expect(() => shardDeadlineMs(shard, { CI: 'true' }, 1100)).toThrow(
      "a CI shard needs E2E_JOB_STARTED, the epoch second its job's first step ran (#938)",
    );
  });

  it('refuses a start that is not a whole number of seconds', () => {
    expect(() =>
      shardDeadlineMs(shard, { CI: 'true', E2E_JOB_STARTED: '10.5' }, 1100),
    ).toThrow('E2E_JOB_STARTED must be whole epoch seconds, not "10.5" (#938)');
  });

  it('refuses a shard whose 17 minutes ran out before its tests began', () => {
    expect(() => shardDeadlineMs(shard, ci, 1984)).toThrow(
      "the shard's 17 minutes ran out before its tests began: 984 s since its first step (#938)",
    );
  });
});

/**
 * Issue 938 AC2: a shard that ends itself names what it was running. On a
 * global timeout Playwright marks each test still running `interrupted` in
 * its JSON report, inside nested suites.
 */
describe('the tests a timed-out shard was running (#938)', () => {
  const report = {
    suites: [
      {
        title: 'a.spec.ts',
        specs: [
          {
            title: 'finished',
            file: 'a.spec.ts',
            line: 3,
            tests: [
              {
                projectName: 'webkit',
                results: [{ status: 'passed', workerIndex: 0 }],
              },
            ],
          },
        ],
        suites: [
          {
            title: 'a group',
            specs: [
              {
                title: 'still running',
                file: 'a.spec.ts',
                line: 9,
                tests: [
                  {
                    projectName: 'webkit',
                    results: [{ status: 'interrupted', workerIndex: 1 }],
                  },
                ],
              },
            ],
          },
        ],
      },
    ],
  };

  it('names each interrupted test with its project, place and worker', () => {
    expect(interruptedTests(report)).toEqual([
      '[webkit] a.spec.ts:9 › a group › still running (worker 1)',
    ]);
  });

  it('names a test that is not interrupted in no line', () => {
    expect(interruptedTests(report).join('\n')).not.toContain('finished');
  });

  it('refuses a report with no suites to read', () => {
    expect(() => interruptedTests({})).toThrow(
      'the Playwright report holds no suites to read (#938)',
    );
  });
});

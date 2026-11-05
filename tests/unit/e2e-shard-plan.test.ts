import { describe, it, expect } from 'vitest';
import {
  plannedRun,
  planShards,
  readTimings,
  testListText,
  timingsFromLogs,
  unitsOfListing,
  withoutShardArgs,
} from '../../scripts/e2e-shard-plan.mjs';
import { timingsFileText } from '../../scripts/e2e-shard-timings.mjs';
import { listedByUnit, ranByUnit } from '../../scripts/test-e2e.mjs';
import { listing } from '../playwright-listing';

const SUITE = listing([
  '[chromium] › home.spec.ts:5:3 › home › renders',
  '[chromium] › home.spec.ts:9:3 › home › links',
  '[webkit] › home.spec.ts:5:3 › home › renders',
  '[webkit] › home.spec.ts:9:3 › home › links',
  '[webkit] › groups.spec.ts:4:1 › groups',
]);

describe('unitsOfListing: whole spec files per project, from --list', () => {
  it('counts the tests of each project and file, in listing order', () => {
    expect(unitsOfListing(SUITE)).toEqual([
      { key: '[chromium] › home.spec.ts', tests: 2 },
      { key: '[webkit] › home.spec.ts', tests: 2 },
      { key: '[webkit] › groups.spec.ts', tests: 1 },
    ]);
  });

  it('refuses a listing whose lines disagree with its own footer', () => {
    expect(() =>
      unitsOfListing(listing(['[chromium] › a.spec.ts:1:1 › a'], 2)),
    ).toThrow('read 1 test lines but the listing reports 2');
  });

  it('refuses a listing with no footer', () => {
    expect(() =>
      unitsOfListing('Listing tests:\n  [chromium] › a.spec.ts:1:1 › a\n'),
    ).toThrow('no `Total:` footer');
  });

  it('refuses a test line it cannot place', () => {
    expect(() =>
      unitsOfListing(listing(['chromium › a.spec.ts:1:1 › a'])),
    ).toThrow('cannot read listing line "  chromium › a.spec.ts:1:1 › a"');
  });
});

const UNITS = [
  { key: '[chromium] › a.spec.ts', tests: 10 },
  { key: '[chromium] › b.spec.ts', tests: 10 },
  { key: '[webkit] › a.spec.ts', tests: 10 },
  { key: '[webkit] › b.spec.ts', tests: 10 },
];
const TIMES = {
  '[chromium] › a.spec.ts': 10,
  '[chromium] › b.spec.ts': 10,
  '[webkit] › a.spec.ts': 30,
  '[webkit] › b.spec.ts': 30,
};

describe('planShards: longest first, each to the least-loaded shard', () => {
  it('pairs a slow unit with a fast one where a count split would not', () => {
    const plan = planShards(UNITS, TIMES, 2);
    expect(plan.shards.map((s) => s.units)).toEqual([
      ['[webkit] › a.spec.ts', '[chromium] › a.spec.ts'],
      ['[webkit] › b.spec.ts', '[chromium] › b.spec.ts'],
    ]);
    expect(plan.shards.map((s) => s.seconds)).toEqual([40, 40]);
  });

  it('puts every unit in exactly one shard', () => {
    const plan = planShards(UNITS, TIMES, 3);
    expect(plan.shards.flatMap((s) => s.units).sort()).toEqual(
      UNITS.map((u) => u.key).sort(),
    );
  });

  it('is one plan whatever order the units arrive in', () => {
    const reversed = [...UNITS].reverse();
    expect(planShards(reversed, TIMES, 3)).toEqual(planShards(UNITS, TIMES, 3));
  });

  it('weighs a unit the timings do not know at the median of those they do, and names it', () => {
    const plan = planShards(
      [...UNITS, { key: '[webkit] › new.spec.ts', tests: 3 }],
      TIMES,
      2,
    );
    expect(plan.unknown).toEqual(['[webkit] › new.spec.ts']);
    expect(plan.estimate).toBe(20);
    expect(plan.shards.map((s) => s.seconds)).toEqual([50, 50]);
  });

  it('holds everything in one shard of one', () => {
    expect(planShards(UNITS, TIMES, 1).shards.map((s) => s.seconds)).toEqual([
      80,
    ]);
  });

  it('refuses more shards than units, which would leave a shard empty', () => {
    expect(() => planShards(UNITS, TIMES, 5)).toThrow(
      '5 shards for 4 spec files: a shard would run nothing',
    );
  });

  it('refuses timings that know none of the listed units', () => {
    expect(() => planShards(UNITS, { '[firefox] › a.spec.ts': 5 }, 2)).toThrow(
      'the timings know none of the 4 spec files listed',
    );
  });
});

describe('testListText: the shard as a --test-list file', () => {
  it('writes one `[project] › file` line per unit', () => {
    expect(
      testListText(['[webkit] › a.spec.ts', '[chromium] › b.spec.ts']),
    ).toBe('[webkit] › a.spec.ts\n[chromium] › b.spec.ts\n');
  });
});

describe('withoutShardArgs: the run args with Playwright`s own split removed', () => {
  it('drops --shard=i/N and keeps the rest in order', () => {
    expect(
      withoutShardArgs(['--workers=2', '--shard=3/8', 'x.spec.ts']),
    ).toEqual(['--workers=2', 'x.spec.ts']);
  });

  it('drops --shard i/N given as two arguments', () => {
    expect(withoutShardArgs(['--shard', '3/8', '--trace=on'])).toEqual([
      '--trace=on',
    ]);
  });
});

const LOG = [
  'e2e shard 4 of 8\tRun npm run test:e2e\t2026-10-18T12:23:59Z   ✓     1 [webkit] › tests/e2e/a.spec.ts:25:3 › a › one (1.5s)',
  'e2e shard 4 of 8\tRun npm run test:e2e\t2026-10-18T12:24:00Z   ✘     2 [webkit] › tests/e2e/a.spec.ts:39:3 › a › two (500ms)',
  'e2e shard 4 of 8\tRun npm run test:e2e\t2026-10-18T12:24:01Z   ✓     3 [chromium] › tests/e2e/b.spec.ts:5:3 › b (1.2m)',
  'e2e shard 4 of 8\tRun npm run test:e2e\t2026-10-18T12:42:24Z   1104 passed (18.5m)',
].join('\n');

describe('timingsFromLogs: seconds per unit from CI shard logs', () => {
  it('sums each unit`s tests in ms, s and m, keyed as the listing keys them', () => {
    expect(timingsFromLogs([LOG], 'tests/e2e/')).toEqual({
      '[webkit] › a.spec.ts': 2,
      '[chromium] › b.spec.ts': 72,
    });
  });

  it('adds up the same unit across two logs', () => {
    expect(
      timingsFromLogs([LOG, LOG], 'tests/e2e/')['[webkit] › a.spec.ts'],
    ).toBe(4);
  });

  it('refuses a test path outside the test directory', () => {
    expect(() => timingsFromLogs([LOG], 'tests/other/')).toThrow(
      'tests/e2e/a.spec.ts is not under tests/other/',
    );
  });

  it('refuses logs that hold no test lines', () => {
    expect(() => timingsFromLogs(['nothing here'], 'tests/e2e/')).toThrow(
      'no test durations in 1 log',
    );
  });
});

const TIMINGS_TEXT = JSON.stringify({
  source: '39127037665',
  seconds: {
    '[chromium] › home.spec.ts': 20,
    '[webkit] › home.spec.ts': 60,
    '[webkit] › groups.spec.ts': 50,
  },
});

describe('readTimings: the committed timings file, or a refusal', () => {
  it('reads the run it came from and seconds per unit', () => {
    expect(readTimings(TIMINGS_TEXT)).toEqual({
      source: '39127037665',
      seconds: {
        '[chromium] › home.spec.ts': 20,
        '[webkit] › home.spec.ts': 60,
        '[webkit] › groups.spec.ts': 50,
      },
    });
  });

  it('refuses a negative time', () => {
    expect(() =>
      readTimings(JSON.stringify({ source: '1', seconds: { '[a] › b': -1 } })),
    ).toThrow('"[a] › b" is not a number of seconds: -1');
  });

  it('refuses a time written as a string', () => {
    expect(() =>
      readTimings(JSON.stringify({ source: '1', seconds: { '[a] › b': '3' } })),
    ).toThrow('"[a] › b" is not a number of seconds: "3"');
  });

  it('refuses a file with no source run', () => {
    expect(() => readTimings(JSON.stringify({ seconds: {} }))).toThrow(
      'names no source run',
    );
  });
});

describe('plannedRun: what a CI shard hands Playwright', () => {
  const base = {
    planFile: 'tests/e2e-shard-timings.json',
    shard: { index: 2, total: 2 },
    selection: false,
    listing: SUITE,
    timingsText: TIMINGS_TEXT,
    passthrough: ['--shard=2/2', '--workers=2'],
    listPath: '/tmp/shard.list',
  };

  it('is null when no plan was asked for, leaving Playwright`s own split', () => {
    expect(plannedRun({ ...base, planFile: undefined })).toBeNull();
  });

  it('runs the shard`s own spec files through --test-list, in place of --shard', () => {
    const run = plannedRun(base);
    expect(run?.args).toEqual([
      '--workers=2',
      '--test-list',
      '/tmp/shard.list',
    ]);
    expect(run?.testList).toBe(
      '[webkit] › groups.spec.ts\n[chromium] › home.spec.ts\n',
    );
  });

  it('reports the plan it ran: units, estimated minutes, source run', () => {
    expect(plannedRun(base)?.report).toBe(
      'shard 2 of 2 runs 2 of 3 spec files, estimated 1.2 test-minutes, planned from run 39127037665',
    );
  });

  it('names every spec file the timings do not know', () => {
    const run = plannedRun({
      ...base,
      timingsText: JSON.stringify({
        source: '7',
        seconds: {
          '[webkit] › home.spec.ts': 60,
          '[webkit] › groups.spec.ts': 50,
        },
      }),
    });
    expect(run?.report).toContain(
      '1 spec file the timings do not know, weighed at 55 s: [chromium] › home.spec.ts',
    );
  });

  it('refuses a plan for a run that is not a shard', () => {
    expect(() => plannedRun({ ...base, shard: null })).toThrow(
      'E2E_SHARD_PLAN is set on a run that is not a shard',
    );
  });

  it('refuses a plan for a capture shard, which counts its selection', () => {
    expect(() => plannedRun({ ...base, selection: true })).toThrow(
      'E2E_SHARD_PLAN is refused with E2E_ENUMERATE=selection',
    );
  });
});

describe('timingsFileText: the committed timings, diffable', () => {
  it('sorts the units and rounds each to a tenth of a second', () => {
    expect(
      timingsFileText('42', {
        '[webkit] › b.spec.ts': 1.26,
        '[chromium] › a.spec.ts': 3,
      }),
    ).toBe(
      '{\n  "source": "42",\n  "seconds": {\n    "[chromium] › a.spec.ts": 3,\n    "[webkit] › b.spec.ts": 1.3\n  }\n}\n',
    );
  });

  it('is a file readTimings reads back', () => {
    expect(
      readTimings(timingsFileText('42', { '[a] › b.spec.ts': 2 })),
    ).toEqual({
      source: '42',
      seconds: { '[a] › b.spec.ts': 2 },
    });
  });
});

describe('ranByUnit and listedByUnit: what a shard writes down per spec file', () => {
  const report = {
    suites: [
      {
        specs: [
          {
            file: 'home.spec.ts',
            tests: [
              { projectName: 'webkit', status: 'expected' },
              { projectName: 'chromium', status: 'skipped' },
            ],
          },
        ],
        suites: [
          {
            specs: [
              {
                file: 'home.spec.ts',
                tests: [{ projectName: 'webkit', status: 'unexpected' }],
              },
            ],
          },
        ],
      },
    ],
  };

  it('counts every test the report holds, by project and file, describe blocks included', () => {
    expect(ranByUnit(report)).toEqual({
      '[webkit] › home.spec.ts': 2,
      '[chromium] › home.spec.ts': 1,
    });
  });

  it('reads the listing`s own count of each spec file', () => {
    expect(listedByUnit(SUITE)).toEqual({
      '[chromium] › home.spec.ts': 2,
      '[webkit] › home.spec.ts': 2,
      '[webkit] › groups.spec.ts': 1,
    });
  });

  it('is null for a listing it cannot read, which the verdict names', () => {
    expect(listedByUnit('no footer here')).toBeNull();
  });
});

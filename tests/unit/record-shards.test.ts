import { describe, expect, it } from 'vitest';
import {
  joinRefusals,
  readManifest,
  shardManifest,
  shardRecordRun,
} from '../../scripts/record-shards.mjs';
import { listing } from '../playwright-listing';
import { searched } from '../source-files';

/**
 * The floor record's browser stage as time-planned shards (#608): each shard
 * runs the `[project] › file` pieces e2e's planner hands it, reports what it
 * ran in a manifest, and the join refuses anything short of every piece run
 * exactly once, on one tree, by shards that all passed.
 */
const SUITE = listing([
  '[chromium] › home.spec.ts:5:3 › home › renders',
  '[chromium] › home.spec.ts:9:3 › home › links',
  '[webkit] › home.spec.ts:5:3 › home › renders',
  '[webkit] › home.spec.ts:9:3 › home › links',
  '[webkit] › groups.spec.ts:4:1 › groups',
]);

const TIMINGS = JSON.stringify({
  source: '40000000001',
  seconds: {
    '[chromium] › home.spec.ts': 10,
    '[webkit] › home.spec.ts': 30,
    '[webkit] › groups.spec.ts': 20,
  },
});

const SHA = 'a'.repeat(40);
const CHROMIUM_HOME = '[chromium] › home.spec.ts';
const WEBKIT_HOME = '[webkit] › home.spec.ts';
const WEBKIT_GROUPS = '[webkit] › groups.spec.ts';
const EXPECTED = [CHROMIUM_HOME, WEBKIT_HOME, WEBKIT_GROUPS];

const manifest = (
  index: number,
  units: string[],
  over: Partial<{ total: number; sha: string; status: number }> = {},
) => ({ index, total: 2, sha: SHA, status: 0, units, ...over });

/** The two manifests a clean run of SUITE in two shards leaves. */
const CLEAN = [
  manifest(1, [WEBKIT_HOME]),
  manifest(2, [WEBKIT_GROUPS, CHROMIUM_HOME]),
];

describe('a record shard runs the pieces the time plan hands it (#608)', () => {
  it('hands shard 1 the longest piece', () => {
    const run = shardRecordRun({
      listing: SUITE,
      timingsText: TIMINGS,
      shard: { index: 1, total: 2 },
    });
    expect(run.units).toEqual([WEBKIT_HOME]);
    expect(run.testList).toBe(`${WEBKIT_HOME}\n`);
    expect(run.report).toBe(
      'record shard 1 of 2 runs 1 of 3 pieces, estimated 0.5 test-minutes, planned from run 40000000001',
    );
  });

  it('hands shard 2 the rest, so the two together run every piece once', () => {
    const run = shardRecordRun({
      listing: SUITE,
      timingsText: TIMINGS,
      shard: { index: 2, total: 2 },
    });
    expect(run.units).toEqual([WEBKIT_GROUPS, CHROMIUM_HOME]);
    expect(run.testList).toBe(`${WEBKIT_GROUPS}\n${CHROMIUM_HOME}\n`);
  });

  it('names a piece the timings do not know, weighed at their median', () => {
    const run = shardRecordRun({
      listing: listing([
        '[chromium] › home.spec.ts:5:3 › home › renders',
        '[firefox] › new.spec.ts:1:1 › new',
      ]),
      timingsText: TIMINGS,
      shard: { index: 1, total: 2 },
    });
    expect(run.report).toBe(
      [
        'record shard 1 of 2 runs 1 of 2 pieces, estimated 0.2 test-minutes, planned from run 40000000001',
        '1 piece the timings do not know, weighed at 10 s: [firefox] › new.spec.ts',
      ].join('\n'),
    );
  });

  it.each([
    ['shard 0', { index: 0, total: 2 }, 'shard 0 of 2 is not a shard: 1 to 2'],
    [
      'a shard past the last',
      { index: 3, total: 2 },
      'shard 3 of 2 is not a shard: 1 to 2',
    ],
    [
      'a fractional shard',
      { index: 1.5, total: 2 },
      'shard 1.5 of 2 is not a shard: 1 to 2',
    ],
    [
      'no shards at all',
      { index: 1, total: 0 },
      'shard 1 of 0 is not a shard: 0 is not a number of shards',
    ],
  ])('refuses %s', (_, shard, refusal) => {
    expect(() =>
      shardRecordRun({ listing: SUITE, timingsText: TIMINGS, shard }),
    ).toThrow(refusal);
  });
});

describe('a shard reports what it ran in a manifest (#608)', () => {
  it('reads back the manifest it writes', () => {
    const written = manifest(2, [WEBKIT_GROUPS, CHROMIUM_HOME], { status: 1 });
    expect(readManifest(shardManifest(written))).toEqual(written);
  });

  it('refuses a manifest that is not JSON', () => {
    expect(() => readManifest('shard 1 ran')).toThrow(
      'a shard manifest is not JSON',
    );
  });

  it.each([
    [
      'index',
      { index: 0 },
      'a shard manifest’s index is 0, not a shard number',
    ],
    [
      'total',
      { total: '2' },
      'a shard manifest’s total is "2", not a number of shards',
    ],
    ['sha', { sha: 'abc' }, 'a shard manifest’s sha is "abc", not a commit'],
    [
      'status',
      { status: null },
      'a shard manifest’s status is null, not an exit status',
    ],
    [
      'units',
      { units: [1] },
      'a shard manifest’s units is [1], not a list of pieces',
    ],
  ])('refuses a manifest whose %s is wrong', (_, over, refusal) => {
    expect(() =>
      readManifest(JSON.stringify({ ...manifest(1, [WEBKIT_HOME]), ...over })),
    ).toThrow(refusal);
  });
});

describe('the join takes the browser stage only whole (#608)', () => {
  const join = (
    over: Partial<Parameters<typeof joinRefusals>[0]> = {},
  ): string[] =>
    joinRefusals({
      expected: EXPECTED,
      total: 2,
      sha: SHA,
      manifests: CLEAN,
      observed: { 1: 3, 2: 4 },
      browserResult: 'success',
      ...over,
    });

  it('refuses nothing when every shard passed and ran every piece once', () => {
    expect(
      searched(join(), {
        of: EXPECTED,
        what: 'pieces a clean two-shard join judged',
      }),
    ).toEqual([]);
    expect(
      floorBreach('record-shards/clean-join-pieces', EXPECTED.length),
    ).toBeUndefined();
  });

  it('refuses a browser stage that did not succeed', () => {
    expect(join({ browserResult: 'failure' })).toEqual([
      'the browser shards ended failure, not success',
    ]);
  });

  it('refuses a shard that did not report, naming the pieces it held', () => {
    expect(join({ manifests: [CLEAN[0]!] })).toEqual([
      'shard 2 of 2 did not report',
      `${CHROMIUM_HOME} was run by no shard`,
      `${WEBKIT_GROUPS} was run by no shard`,
    ]);
  });

  it('refuses a shard that reported twice', () => {
    expect(join({ manifests: [...CLEAN, CLEAN[1]!] })).toEqual([
      'shard 2 of 2 reported 2 times',
      `${CHROMIUM_HOME} was run by shards 2, 2`,
      `${WEBKIT_GROUPS} was run by shards 2, 2`,
    ]);
  });

  it('refuses a manifest naming a shard outside the run', () => {
    expect(
      join({ manifests: [...CLEAN, manifest(3, [], { total: 2 })] }),
    ).toEqual(['a manifest names shard 3, outside 1 to 2']);
  });

  it('refuses a shard that planned another number of shards', () => {
    expect(
      join({ manifests: [CLEAN[0]!, { ...CLEAN[1]!, total: 3 }] }),
    ).toEqual(['shard 2 planned 3 shards, the join 2']);
  });

  it('refuses a shard that measured another commit', () => {
    const other = 'b'.repeat(40);
    expect(
      join({ manifests: [CLEAN[0]!, { ...CLEAN[1]!, sha: other }] }),
    ).toEqual([`shard 2 measured ${other}, the join ${SHA}`]);
  });

  it('refuses a shard whose Playwright run failed', () => {
    expect(
      join({ manifests: [CLEAN[0]!, { ...CLEAN[1]!, status: 1 }] }),
    ).toEqual(['shard 2’s Playwright run exited 1']);
  });

  it('refuses a shard that passed and recorded no floor', () => {
    expect(join({ observed: { 1: 3, 2: 0 } })).toEqual([
      'shard 2 passed and recorded no floor: its observations are missing or empty',
    ]);
  });

  it('refuses a shard whose observations the join could not find', () => {
    expect(join({ observed: { 1: 3 } })).toEqual([
      'shard 2 passed and recorded no floor: its observations are missing or empty',
    ]);
  });

  it('refuses a piece two shards ran', () => {
    expect(
      join({
        manifests: [manifest(1, [WEBKIT_HOME, CHROMIUM_HOME]), CLEAN[1]!],
      }),
    ).toEqual([`${CHROMIUM_HOME} was run by shards 1, 2`]);
  });

  it('refuses a piece the join’s own listing does not hold', () => {
    expect(
      join({
        manifests: [
          manifest(1, [WEBKIT_HOME, '[firefox] › x.spec.ts']),
          CLEAN[1]!,
        ],
      }),
    ).toEqual([
      '[firefox] › x.spec.ts was run by shard 1 but the join’s listing does not hold it',
    ]);
  });
});

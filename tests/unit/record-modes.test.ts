import { describe, expect, it } from 'vitest';
import { floorBreach } from '../floors';
import { searched } from '../source-files';
import {
  carriedFor,
  carriedLines,
  recordSuites,
} from '../../scripts/record-floors.mjs';

/**
 * What each `npm run floors:record` mode runs, and which recorded ids it
 * carries unmeasured (#658). The laptop runs only the unit suite (operator
 * rule 2026-10-09), so `--unit-suite` runs `vitest run` alone, on every pass,
 * and leaves every other suite's floors for `record-floors.yml` to record.
 * `--unit` (#548) is not that mode: it runs the guards, integration and logs
 * suites too, and skips only Playwright and the functions suite. `--device` (#623)
 * runs the iPhone journeys alone, the one suite no other mode can reach, and
 * every other mode carries their floors unmeasured.
 */
describe('the suites each record mode runs (#658)', () => {
  it.each([
    {
      mode: undefined,
      pass: 1,
      runs: [
        'unit',
        'guards',
        'integration',
        'logs',
        'playwright',
        'functions',
      ],
    },
    {
      mode: '--unit',
      pass: 1,
      runs: ['unit', 'guards', 'integration', 'logs'],
    },
    { mode: '--functions', pass: 1, runs: ['functions'] },
    { mode: '--unit-suite', pass: 1, runs: ['unit'] },
    { mode: '--device', pass: 1, runs: ['device'] },
    {
      mode: undefined,
      pass: 2,
      runs: ['unit', 'guards', 'integration', 'logs'],
    },
    {
      mode: '--unit',
      pass: 2,
      runs: ['unit', 'guards', 'integration', 'logs'],
    },
    {
      mode: '--functions',
      pass: 2,
      runs: ['unit', 'guards', 'integration', 'logs'],
    },
    { mode: '--unit-suite', pass: 2, runs: ['unit'] },
    { mode: '--device', pass: 2, runs: ['unit'] },
  ])('mode $mode, pass $pass, runs exactly $runs', ({ mode, pass, runs }) => {
    const suites = recordSuites(mode, pass);
    expect(
      Object.entries(suites)
        .filter(([, run]) => run)
        .map(([suite]) => suite),
    ).toEqual(runs);
    expect(Object.keys(suites)).toEqual([
      'unit',
      'guards',
      'integration',
      'logs',
      'playwright',
      'functions',
      'device',
    ]);
  });
});

describe('the ids each record mode carries unmeasured (#658)', () => {
  const texts = {
    specTexts: ["expect(floorBreach('e2e/pages', 1)).toBeUndefined();"],
    functionsTexts: [
      "expect(floorBreach('functions/rows', 1)).toBeUndefined();",
    ],
    deviceTexts: ["expect(floorBreach('device/cards', 1)).toBeUndefined();"],
  };
  const ids = [
    'e2e/pages',
    'functions/rows',
    'unit/files',
    'guards/scanned',
    'device/cards',
  ];

  it('a full record carries nothing but the iPhone floors (#623)', () => {
    // Every id offered, none asserted: the most a record could carry.
    const carried = carriedFor(undefined, ids, new Set(), texts);
    expect(
      searched(
        carried.filter((id) => id !== 'device/cards'),
        { of: ids, what: 'recorded ids offered to a full record' },
      ),
    ).toEqual([]);
    expect(
      floorBreach('record-modes/full-record-ids', ids.length),
    ).toBeUndefined();
  });

  it('a full record carries the ids an iPhone journey spells, which CI cannot measure (#623)', () => {
    expect(carriedFor(undefined, ids, new Set(), texts)).toEqual([
      'device/cards',
    ]);
  });

  it('--unit carries the ids a Playwright, functions or iPhone test spells', () => {
    expect(carriedFor('--unit', ids, new Set(), texts)).toEqual([
      'e2e/pages',
      'functions/rows',
      'device/cards',
    ]);
  });

  it('--functions carries every unasserted id no functions spec spells', () => {
    expect(carriedFor('--functions', ids, new Set(), texts)).toEqual([
      'e2e/pages',
      'unit/files',
      'guards/scanned',
      'device/cards',
    ]);
  });

  it('--unit-suite carries every id the unit run did not assert', () => {
    expect(carriedFor('--unit-suite', ids, new Set(), texts)).toEqual(ids);
  });

  it('--unit-suite never carries an id the unit run asserted', () => {
    expect(
      carriedFor('--unit-suite', ids, new Set(['unit/files']), texts),
    ).toEqual([
      'e2e/pages',
      'functions/rows',
      'guards/scanned',
      'device/cards',
    ]);
  });

  it('--device carries every unasserted id no iPhone journey spells (#623)', () => {
    expect(
      carriedFor('--device', ids, new Set(['device/cards']), texts),
    ).toEqual(['e2e/pages', 'functions/rows', 'unit/files', 'guards/scanned']);
  });

  it('--device never carries an iPhone id it did not assert: that floor lost its test', () => {
    // Every id offered, none asserted: the iPhone's own id is not among the
    // carried, so the judge refuses it as a recorded floor nobody asserted.
    expect(carriedFor('--device', ids, new Set(), texts)).toEqual([
      'e2e/pages',
      'functions/rows',
      'unit/files',
      'guards/scanned',
    ]);
  });
});

describe('what a record says of the ids it carried (#623)', () => {
  const deviceTexts = [
    "expect(floorBreach('device/cards', 1)).toBeUndefined();",
  ];

  it('names the iPhone floors apart, with the one command that measures them', () => {
    expect(
      carriedLines('--unit', ['e2e/pages', 'device/cards'], deviceTexts),
    ).toEqual([
      '--unit: not measured, carried unchanged for CI to judge: e2e/pages',
      '--unit: the iPhone floors, carried unchanged: only ' +
        'npm run floors:record -- --device, on the phone, measures them: ' +
        'device/cards',
    ]);
  });

  it('calls a record with no mode a full record', () => {
    expect(carriedLines(undefined, ['device/cards'], deviceTexts)).toEqual([
      'a full record: the iPhone floors, carried unchanged: only ' +
        'npm run floors:record -- --device, on the phone, measures them: ' +
        'device/cards',
    ]);
  });

  it('says only the CI line when no iPhone floor was carried', () => {
    expect(carriedLines('--device', ['unit/files'], deviceTexts)).toEqual([
      '--device: not measured, carried unchanged for CI to judge: unit/files',
    ]);
  });
});

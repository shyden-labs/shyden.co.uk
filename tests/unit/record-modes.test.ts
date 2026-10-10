import { describe, expect, it } from 'vitest';
import { floorBreach } from '../floors';
import { searched } from '../source-files';
import { carriedFor, recordSuites } from '../../scripts/record-floors.mjs';

/**
 * What each `npm run floors:record` mode runs, and which recorded ids it
 * carries unmeasured (#658). The laptop runs only the unit suite (operator
 * rule 2026-10-09), so `--unit-suite` runs `vitest run` alone, on every pass,
 * and leaves every other suite's floors for `record-floors.yml` to record.
 * `--unit` (#548) is not that mode: it runs the guards and integration suites
 * too, and skips only Playwright and the functions suite.
 */
describe('the suites each record mode runs (#658)', () => {
  it.each([
    {
      mode: undefined,
      pass: 1,
      runs: ['unit', 'guards', 'integration', 'playwright', 'functions'],
    },
    { mode: '--unit', pass: 1, runs: ['unit', 'guards', 'integration'] },
    { mode: '--functions', pass: 1, runs: ['functions'] },
    { mode: '--unit-suite', pass: 1, runs: ['unit'] },
    { mode: undefined, pass: 2, runs: ['unit', 'guards', 'integration'] },
    { mode: '--unit', pass: 2, runs: ['unit', 'guards', 'integration'] },
    { mode: '--functions', pass: 2, runs: ['unit', 'guards', 'integration'] },
    { mode: '--unit-suite', pass: 2, runs: ['unit'] },
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
      'playwright',
      'functions',
    ]);
  });
});

describe('the ids each record mode carries unmeasured (#658)', () => {
  const texts = {
    specTexts: ["expect(floorBreach('e2e/pages', 1)).toBeUndefined();"],
    functionsTexts: [
      "expect(floorBreach('functions/rows', 1)).toBeUndefined();",
    ],
  };
  const ids = ['e2e/pages', 'functions/rows', 'unit/files', 'guards/scanned'];

  it('a full record carries nothing', () => {
    // Every id offered, none asserted: the most a record could carry.
    expect(
      searched(carriedFor(undefined, ids, new Set(), texts), {
        of: ids,
        what: 'recorded ids offered to a full record',
      }),
    ).toEqual([]);
    expect(
      floorBreach('record-modes/full-record-ids', ids.length),
    ).toBeUndefined();
  });

  it('--unit carries the ids a Playwright or functions spec spells', () => {
    expect(carriedFor('--unit', ids, new Set(), texts)).toEqual([
      'e2e/pages',
      'functions/rows',
    ]);
  });

  it('--functions carries every unasserted id no functions spec spells', () => {
    expect(carriedFor('--functions', ids, new Set(), texts)).toEqual([
      'e2e/pages',
      'unit/files',
      'guards/scanned',
    ]);
  });

  it('--unit-suite carries every id the unit run did not assert', () => {
    expect(carriedFor('--unit-suite', ids, new Set(), texts)).toEqual(ids);
  });

  it('--unit-suite never carries an id the unit run asserted', () => {
    expect(
      carriedFor('--unit-suite', ids, new Set(['unit/files']), texts),
    ).toEqual(['e2e/pages', 'functions/rows', 'guards/scanned']);
  });
});

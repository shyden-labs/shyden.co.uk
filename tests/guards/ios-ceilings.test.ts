import { describe, expect, it } from 'vitest';
import { floorBreach } from '../floors';
import {
  IOS_DIR,
  ceilingBreaches,
  countChecks,
  countChecksParsed,
  judgeSources,
  readCeilings,
  readIosSources,
} from '../ios-ceilings';
import { committableFiles, searched } from '../source-files';

/**
 * No check is ever added to an iPhone-only test file (#858). Shyden,
 * 2026-10-18, on an assertion added inside the iPhone's own Journey 14:
 * "this is illegal. follow the rules". A phone check is one test that
 * Android and the iPhone both run, from the same files (#839), so every
 * file under `tests/device/ios/` is held to the tests and assertions it
 * wrote when this guard landed (`tests/ios-ceilings.json`), and those
 * figures only fall, through `npm run ceilings:record`.
 */

let read: ReturnType<typeof readIosSources> | undefined;
const sources = () => (read ??= readIosSources());

describe('no check is ever added to an iPhone-only file (#858)', () => {
  it('holds every file under tests/device/ios exactly at its ceiling', () => {
    const files = [...sources().keys()];
    const { counts, refusals } = judgeSources(sources());
    const findings = [...refusals, ...ceilingBreaches(counts, readCeilings())];
    expect(
      searched(findings, { of: files, what: 'files under tests/device/ios' }),
      findings.join('\n'),
    ).toEqual([]);
    expect(floorBreach('ios-ceilings/files', files.length)).toBeUndefined();
  });

  it('reads every file git would commit there, the journeys among them', () => {
    // The population is the walk's, not a list, so a file added later is
    // read the day it appears; git's own list is the check on the walk.
    expect([...sources().keys()]).toEqual(
      committableFiles(
        (path) => path.startsWith(`${IOS_DIR}/`) && path.endsWith('.ts'),
      ),
    );
    const journeys = 'tests/device/ios/journeys.journey.ts';
    expect([...sources().keys()].filter((file) => file === journeys)).toEqual([
      journeys,
    ]);
  });

  it('keeps the recorded ceilings at or under their landing figures', () => {
    // A hand edit is the one way past the recorder: the totals recorded when
    // this landed (2026-10-19: 15 tests, 59 assertions, all in the journeys
    // file) only ever fall, and fall here by hand with the record.
    const ceilings = Object.values(readCeilings());
    const total = (kind: 'tests' | 'assertions'): number =>
      ceilings.reduce((sum, counts) => sum + counts[kind], 0);
    expect(total('tests')).toBeLessThanOrEqual(15);
    expect(total('assertions')).toBeLessThanOrEqual(59);
  });

  it('counts each file the same way through the text and through the parse', () => {
    // Control (c): two readers that share no code past the file's text, per
    // file, with no figure written here. A reader gone blind to one form
    // disagrees with the other on the file that writes it.
    const disagree = [...sources()]
      .filter(([, source]) => {
        const text = countChecks(source);
        const parsed = countChecksParsed(source);
        return (
          text.tests !== parsed.tests || text.assertions !== parsed.assertions
        );
      })
      .map(([file]) => file);
    const files = [...sources().keys()];
    expect(
      searched(disagree, { of: files, what: 'files under tests/device/ios' }),
    ).toEqual([]);
    expect(
      floorBreach('ios-ceilings/cross-checked-files', files.length),
    ).toBeUndefined();
  });
});

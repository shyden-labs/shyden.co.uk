import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { STAND_INS } from '../device/ios/stand-ins';
import { floorBreach } from '../floors';
import { searched, trackedFiles } from '../source-files';
import { standIns } from '../stand-in-markers';

/**
 * Every iPhone mirror that leans on a harness stand-in for a Playwright
 * algorithm says so (#821; mirror rule, Shyden 2026-10-16: a stand-in is
 * kept, marked `NOT YET THE SAME as Android (#811)`, never deleted). Twice a
 * stand-in went unmarked, once reached through a helper, so the whole iPhone
 * harness is read and calls are followed to a fixed point
 * (tests/stand-in-markers.ts).
 */
const reading = () => {
  const paths = trackedFiles(
    (path) => path.startsWith('tests/device/ios/') && path.endsWith('.ts'),
  );
  return {
    paths,
    ...standIns(
      Object.fromEntries(paths.map((path) => [path, readFileSync(path, 'utf8')])),
      STAND_INS,
    ),
  };
};

describe('every iPhone mirror that leans on a stand-in says so (#821)', () => {
  it('marks each test that reaches a stand-in', () => {
    const { judged, findings } = reading();
    expect(
      searched(findings, { of: judged, what: 'mirrors reaching a stand-in' }),
      findings.join('\n'),
    ).toEqual([]);
    expect(
      floorBreach('stand-in-markers/judged', judged.length),
    ).toBeUndefined();
  });

  it('reads every test in every journey file of the harness', () => {
    const { paths, read } = reading();
    expect(
      floorBreach(
        'stand-in-markers/journey-files',
        paths.filter((path) => path.endsWith('.journey.ts')).length,
      ),
    ).toBeUndefined();
    expect(floorBreach('stand-in-markers/read', read.length)).toBeUndefined();
  });
});

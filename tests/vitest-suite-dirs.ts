import guards from '../vitest.guards.config';
import unit from '../vitest.config';

/**
 * The directories whose tests hold planted constructs as fixtures: the unit
 * suite's and the guards suite's (#638), derived from the two configs'
 * `include`, never written out a second time. A guard that must not read a
 * fixture as the thing it forbids skips these, so a suite added or moved in a
 * config is skipped by every such guard on the same edit.
 *
 * (The integration suite is not one: its tests run the real tools on scratch
 * trees and hold no fixtures of this kind.)
 */
export const fixtureTestDirs = (): string[] =>
  [unit, guards].flatMap((config) =>
    (config.test?.include ?? []).map((glob) => glob.replace(/\*\*.*$/, '')),
  );

/** Whether `path` lies in a directory returned by {@link fixtureTestDirs}. */
export const inFixtureTestDir = (path: string): boolean =>
  fixtureTestDirs().some((dir) => path.startsWith(dir));

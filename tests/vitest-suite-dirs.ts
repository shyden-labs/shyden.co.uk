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
  [unitProject('unit'), guards.test ?? {}].flatMap((test) =>
    (test.include ?? []).map((glob) => glob.replace(/\*\*.*$/, '')),
  );

/** Whether `path` lies in a directory returned by {@link fixtureTestDirs}. */
export const inFixtureTestDir = (path: string): boolean =>
  fixtureTestDirs().some((dir) => path.startsWith(dir));

/** The options a test project sets for itself, as `vitest.config.ts` writes them. */
interface ProjectTest {
  readonly name?: string;
  readonly include?: readonly string[];
  readonly exclude?: readonly string[];
  readonly isolate?: boolean;
  readonly setupFiles?: readonly string[];
}

/**
 * One of the unit suite's projects (#688), by name: `unit`, or `unit-parser`
 * for the files that load the TypeScript parser. Throws for a name the config
 * does not define, so a renamed project is a red test, not an empty one.
 */
export function unitProject(name: string): ProjectTest {
  const found = (unit.test?.projects ?? [])
    .map((project) =>
      typeof project === 'object' && project !== null && 'test' in project
        ? (project.test as ProjectTest | undefined)
        : undefined,
    )
    .find((test) => test?.name === name);
  if (found === undefined)
    throw new Error(`vitest.config.ts defines no unit project named ${name}`);
  return found;
}

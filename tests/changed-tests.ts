import { ABSENCE_BURN_DOWN } from './absence-liveness.burn-down';
import { DISCOVERY, scanAbsences } from './absence-liveness';
import { burnDownBreaches } from './burn-down';
import { FLOORLESS } from './floorless-searches.burn-down';
import { searchSitesIn } from './floorless-searches';
import { filesUnder } from './source-files';
import { bindFiles, callGraph, type Bound, type Closure } from './unit/ast';
import {
  presenceClosures,
  scanPresence,
  type PresenceClosures,
} from './unit/presence-detector';

/**
 * The pre-push lint's core (#662): the three meta-guards that judge test code
 * -- `floorless-searches`, `absence-liveness`, `anchored-presence` -- applied
 * to the test files a branch changed, so a new test meets them before CI
 * rather than at the PR's run or the floor record. The guards stay CI's and
 * judge the whole tree; this reads the same finders, from the same homes, and
 * reports only what lands in the changed files. Operator ruling 2026-10-12:
 * a static read of changed files is a lint, which the laptop may run.
 *
 * The tree is still bound whole: whether a name reaches the filesystem is a
 * question about every file it could resolve to, not just the changed one.
 */

/** Everything the finders read: the bound tree and the closures over it. */
export interface TestTree {
  readonly bound: Bound;
  /** Reaches a filesystem read, for absence-liveness (`DISCOVERY`). */
  readonly discoverers: Closure;
  readonly presence: PresenceClosures;
}

/** The two burn-down lists, by `file › scope`, as the guards hold them. */
export interface BurnDownLists {
  readonly floorless: Readonly<Record<string, number>>;
  readonly absence: Readonly<Record<string, number>>;
}

/** The lists the guards hold today. */
export const BURN_DOWN_LISTS: BurnDownLists = {
  floorless: FLOORLESS,
  absence: ABSENCE_BURN_DOWN,
};

/**
 * Every `.ts` under `tests/`, bound and closed over as the guards close it:
 * the same walk (`filesUnder`), the same seeds (`DISCOVERY`,
 * `presenceClosures`). Reads the disk; the unit tests bind fixtures instead.
 */
export function testTree(): TestTree {
  const files = filesUnder('tests', (path) => path.endsWith('.ts'));
  const graph = callGraph(files);
  return {
    bound: bindFiles(files),
    discoverers: graph.close(DISCOVERY),
    presence: presenceClosures(graph),
  };
}

export interface ChangedTestsLint {
  /** How many of each construct the changed files hold: the population read. */
  readonly judged: { searches: number; absences: number; presence: number };
  /** Each as `file:line: guard: what, and what to do`, or a scope's key. */
  readonly findings: string[];
}

const keyInFiles = (files: readonly string[], key: string): boolean =>
  files.some((file) => key.startsWith(`${file} › `));

const atInFiles = (files: readonly string[], at: string): boolean =>
  files.some((file) => at.startsWith(`${file}:`));

const listedFor = (
  list: Readonly<Record<string, number>>,
  files: readonly string[],
): Record<string, number> =>
  Object.fromEntries(
    Object.entries(list).filter(([key]) => keyInFiles(files, key)),
  );

/** A finding written `file:line — text`, relabelled with its guard. */
const labelled = (finding: string, guard: string): string =>
  finding.replace(/^(\S+:\d+) — /, `$1: ${guard}: `);

const lowerTheEntry = (
  { key, read, listed }: { key: string; read: number; listed: number },
  guard: string,
): string =>
  `${key}: ${guard}: ${read} read, ${listed} listed. Lower the entry in tests/${guard}.burn-down.ts: the list only shrinks.`;

/** What the three finders name in `changed`, judged as their guards judge. */
export function lintChangedTests(
  changed: readonly string[],
  tree: TestTree,
  lists: BurnDownLists,
): ChangedTestsLint {
  const findings: string[] = [];
  const judged = { searches: 0, absences: 0, presence: 0 };
  // Fail closed: a changed file the tree does not hold was not read.
  for (const file of changed)
    if (!tree.bound.files.has(file))
      findings.push(`${file}: not among the files the lint bound, so unread`);
  const files = changed.filter((file) => tree.bound.files.has(file));

  // floorless-searches: each search checks a recorded floor, or is listed.
  const unfloored = new Map<string, number>();
  const unflooredAt = new Map<string, string[]>();
  for (const file of files) {
    const reading = searchSitesIn(tree.bound.files.get(file)!);
    judged.searches += reading.sites.length;
    findings.push(
      ...reading.refused.map((refusal) =>
        refusal.replace(/^(\S+:\d+): /, '$1: floorless-searches: '),
      ),
    );
    for (const site of reading.sites.filter(({ floored }) => !floored)) {
      const key = `${file} › ${site.label}`;
      unfloored.set(key, (unfloored.get(key) ?? 0) + 1);
      unflooredAt.set(key, [
        ...(unflooredAt.get(key) ?? []),
        `${file}:${site.line}: floorless-searches: a search with no recorded floor in the same test (${site.label}). Check floorBreach on its population.`,
      ]);
    }
  }
  for (const breach of burnDownBreaches(
    unfloored,
    listedFor(lists.floorless, files),
  ))
    findings.push(
      ...(breach.read > breach.listed
        ? unflooredAt.get(breach.key)!
        : [lowerTheEntry(breach, 'floorless-searches')]),
    );

  // absence-liveness: each absence carries its population, or is listed.
  const absences = scanAbsences(tree.bound, tree.discoverers);
  for (const file of files) judged.absences += absences.perFile.get(file) ?? 0;
  findings.push(
    ...absences.findings
      .filter((finding) => atInFiles(files, finding))
      .map((finding) => labelled(finding, 'absence-liveness')),
  );
  const unjudged = new Map(
    [...absences.unjudged].filter(([key]) => keyInFiles(files, key)),
  );
  for (const breach of burnDownBreaches(
    unjudged,
    listedFor(lists.absence, files),
  ))
    findings.push(
      ...(breach.read > breach.listed
        ? absences.unjudgedSites
            .filter(({ key }) => key === breach.key)
            .map(
              ({ key, at, why }) =>
                `${at}: absence-liveness: ${why} (${key.slice(key.indexOf(' › ') + 3)}). Route it through searched() and check a floor.`,
            )
        : [lowerTheEntry(breach, 'absence-liveness')]),
    );

  // anchored-presence: a presence over raw source is stripped or anchored.
  const presence = scanPresence(tree.bound, tree.presence);
  for (const file of files) judged.presence += presence.perFile.get(file) ?? 0;
  findings.push(
    ...presence.findings
      .filter((finding) => atInFiles(files, finding))
      .map(
        (finding) =>
          `${labelled(finding, 'anchored-presence')}. Strip the comments, or anchor the matcher.`,
      ),
  );

  return { judged, findings };
}

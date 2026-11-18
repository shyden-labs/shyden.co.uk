import { spawnSync } from 'node:child_process';
import type { ListedTest } from './group-tags';

/**
 * The e2e suite as Playwright itself lists it (`--list --reporter=json`):
 * every test once per project that would run it, with its tags and
 * annotations as the runner resolves them (a describe's included). It starts
 * a process, so only the integration suite calls it.
 */
export interface ProjectTest extends ListedTest {
  project: string;
}

interface JsonSuite {
  title: string;
  specs: {
    title: string;
    file: string;
    tags: string[];
    tests: {
      projectName: string;
      annotations: ListedTest['annotations'];
    }[];
  }[];
  suites?: JsonSuite[];
}

function collect(suite: JsonSuite, path: string[], into: ProjectTest[]): void {
  const here = suite.title === '' ? path : [...path, suite.title];
  for (const spec of suite.specs)
    for (const test of spec.tests)
      into.push({
        id: [spec.file, ...here.slice(1), spec.title].join(' › '),
        project: test.projectName,
        tags: spec.tags,
        annotations: test.annotations,
      });
  for (const child of suite.suites ?? []) collect(child, here, into);
}

/** Every test each project of `config` lists, with `extra` CLI arguments. */
export function listSuite(
  config: string,
  extra: readonly string[] = [],
): ProjectTest[] {
  const run = spawnSync(
    'npx',
    ['playwright', 'test', '-c', config, '--list', '--reporter=json', ...extra],
    { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 },
  );
  if (run.status !== 0)
    throw new Error(
      `playwright --list -c ${config} exited ${run.status}:\n${run.stderr}${run.stdout.slice(0, 2000)}`,
    );
  const listing = JSON.parse(run.stdout) as { suites: JsonSuite[] };
  const tests: ProjectTest[] = [];
  for (const suite of listing.suites) collect(suite, [], tests);
  return tests;
}

/**
 * The whole e2e suite, once per test: the desktop config's listing with its
 * `grepInvert` overridden by a pattern that matches nothing, so the @phone
 * tests the desktop run leaves out are listed too.
 */
export function wholeSuite(): ListedTest[] {
  const byId = new Map<string, ListedTest>();
  for (const test of listSuite('playwright.config.ts', ['--grep-invert=(?!)']))
    byId.set(test.id, {
      id: test.id,
      tags: test.tags,
      annotations: test.annotations,
    });
  return [...byId.values()];
}

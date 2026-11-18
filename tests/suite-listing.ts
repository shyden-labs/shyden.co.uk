import { spawnSync } from 'node:child_process';
import type { ListedTest } from './group-tags';
import {
  testsOfListing,
  type JsonListing,
  type ProjectTest,
} from './listing-json';

/**
 * The e2e suite as Playwright itself lists it (`--list --reporter=json`):
 * every test once per project that would run it, with its tags and
 * annotations as the runner resolves them (a describe's included), each id
 * relative to the repository (`tests/listing-json.ts`). It starts a process,
 * so only the integration suite calls it.
 */
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
  return testsOfListing(JSON.parse(run.stdout) as JsonListing, process.cwd());
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

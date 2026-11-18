import { join, relative } from 'node:path';
import type { ListedTest } from './group-tags';

/** A listed test with the project that would run it. */
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

/** What `playwright test --list --reporter=json` prints, the parts read here. */
export interface JsonListing {
  config: { rootDir: string };
  suites: JsonSuite[];
}

/**
 * Every test in a JSON listing, once per project that would run it. The JSON
 * gives each spec file relative to its config's `rootDir`, which differs by
 * config (`tests/e2e` on the desktop, `tests` on the phone), so the id is read
 * relative to `cwd`, the repository: one test, one id, in every listing
 * (#1200).
 */
export function testsOfListing(
  listing: JsonListing,
  cwd: string,
): ProjectTest[] {
  const tests: ProjectTest[] = [];
  const visit = (suite: JsonSuite, titles: string[]): void => {
    for (const spec of suite.specs) {
      const file = relative(cwd, join(listing.config.rootDir, spec.file));
      for (const test of spec.tests)
        tests.push({
          id: [file, ...titles, spec.title].join(' › '),
          project: test.projectName,
          tags: spec.tags,
          annotations: test.annotations,
        });
    }
    for (const child of suite.suites ?? [])
      visit(child, child.title === '' ? titles : [...titles, child.title]);
  };
  // A file's own suite is titled with the file, which the id already holds.
  for (const fileSuite of listing.suites) visit(fileSuite, []);
  return tests;
}

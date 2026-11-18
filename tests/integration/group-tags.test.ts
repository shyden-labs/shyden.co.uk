import { spawnSync } from 'node:child_process';
import { beforeAll, describe, expect, it } from 'vitest';
import {
  DESKTOP_TAG,
  GROUP_ONLY,
  PHONE_TAG,
  groupOnlyFindings,
  type ListedTest,
} from '../group-tags';
import { searched } from '../source-files';

/**
 * Every e2e test as Playwright itself lists it, tags and annotations included
 * (inherited from a describe as well as written on the test), checked against
 * the group rule (#1182). The desktop config's own `grepInvert` would hide the
 * @phone tests, so the listing overrides it with a pattern that matches
 * nothing: this reads the whole suite, not one group's share of it.
 */

/**
 * Every group-only test today, with its tag and reason, read from the suite
 * (AC3). A new group-only test is added here, so a reviewer reads its reason.
 */
const GROUP_ONLY_TESTS: readonly { id: string; tag: string; reason: string }[] =
  [];

interface JsonSuite {
  title: string;
  specs: {
    title: string;
    file: string;
    tags: string[];
    tests: { annotations: ListedTest['annotations'] }[];
  }[];
  suites?: JsonSuite[];
}

function collect(
  suite: JsonSuite,
  path: string[],
  into: Map<string, ListedTest>,
): void {
  const here = suite.title === '' ? path : [...path, suite.title];
  for (const spec of suite.specs)
    for (const test of spec.tests) {
      const id = [spec.file, ...here.slice(1), spec.title].join(' › ');
      // One entry per test, however many browsers list it.
      into.set(id, { id, tags: spec.tags, annotations: test.annotations });
    }
  for (const child of suite.suites ?? []) collect(child, here, into);
}

let tests: ListedTest[];

beforeAll(() => {
  const run = spawnSync(
    'npx',
    [
      'playwright',
      'test',
      '-c',
      'playwright.config.ts',
      '--list',
      '--reporter=json',
      '--grep-invert=(?!)',
    ],
    { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 },
  );
  if (run.status !== 0)
    throw new Error(
      `playwright --list exited ${run.status}:\n${run.stderr}${run.stdout.slice(0, 2000)}`,
    );
  const listing = JSON.parse(run.stdout) as { suites: JsonSuite[] };
  const byId = new Map<string, ListedTest>();
  for (const suite of listing.suites) collect(suite, [], byId);
  tests = [...byId.values()];
});

const tagOf = (test: ListedTest): string | undefined =>
  test.tags
    .map((t) => (t.startsWith('@') ? t : `@${t}`))
    .find((t) => t === PHONE_TAG || t === DESKTOP_TAG);

describe('device groups, read from the listed suite (#1182)', () => {
  it('gives every group-only test a tag and a reason naming the input or feature that differs', () => {
    expect(
      searched(groupOnlyFindings(tests), {
        of: tests,
        what: 'listed e2e tests',
      }),
    ).toEqual([]);
  });

  it('holds exactly the group-only tests listed here, each with its tag and reason', () => {
    const found = tests
      .filter((test) => tagOf(test) !== undefined)
      .map((test) => ({
        id: test.id,
        tag: tagOf(test)!,
        reason:
          test.annotations.find((a) => a.type === GROUP_ONLY)?.description ??
          '',
      }));
    expect(searched(found, { of: tests, what: 'listed e2e tests' })).toEqual(
      GROUP_ONLY_TESTS,
    );
  });
});

import { beforeAll, describe, expect, it } from 'vitest';
import { ENGINES } from '../engines';
import {
  DESKTOP_TAG,
  GROUP_ONLY,
  PHONE_TAG,
  groupOnlyFindings,
  offTargetFindings,
  type ListedTest,
  type Target,
} from '../group-tags';
import { searched } from '../source-files';
import { listSuite, wholeSuite } from '../suite-listing';

/**
 * Every e2e test as Playwright itself lists it, tags and annotations included
 * (inherited from a describe as well as written on the test), checked against
 * the group rule (#1182), and every target's own listing checked against it
 * (#1200).
 */

/**
 * Every group-only test today, with its tag and reason, read from the suite
 * (#1182 AC3). A new group-only test is added here, so a reviewer reads its
 * reason.
 */
const GROUP_ONLY_TESTS: readonly { id: string; tag: string; reason: string }[] =
  [];

/** The phone's projects: one target, split only by whether a test installs a clock. */
const PHONE_PROJECTS = ['android-chrome-clock', 'android-chrome'];

/** The most the three listings below may take before the hook fails, naming itself. */
const LISTING_CEILING_MS = 60_000;

let tests: ListedTest[];
let targets: Target[];

beforeAll(() => {
  const desktop = listSuite('playwright.config.ts');
  const phone = listSuite('playwright.device.config.ts');
  // The universe is every test either config lists, so a spec one config
  // ignores still counts as missing there.
  const byId = new Map(wholeSuite().map((test) => [test.id, test]));
  for (const { project, ...test } of phone)
    if (PHONE_PROJECTS.includes(project) && !byId.has(test.id))
      byId.set(test.id, test);
  tests = [...byId.values()];
  const ran = (listed: typeof desktop, projects: readonly string[]) =>
    new Set(
      listed.filter((t) => projects.includes(t.project)).map((t) => t.id),
    );
  targets = [
    ...ENGINES.map(({ name }) => ({
      name,
      group: 'desktop' as const,
      ran: ran(desktop, [name]),
    })),
    {
      name: 'android',
      group: 'phone' as const,
      ran: ran(phone, PHONE_PROJECTS),
    },
  ];
  // Three `playwright --list` runs, each collecting every spec file. One fit
  // inside Vitest's 10 s default (#1182); three are given a stated ceiling,
  // not yet set from a measurement of the three together (#1200).
}, LISTING_CEILING_MS);

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

describe('nothing but a group tag keeps a test off a target (#1200)', () => {
  it('lists every desktop engine and the phone as a target', () => {
    expect(targets.map((t) => t.name)).toEqual([
      ...ENGINES.map(({ name }) => name),
      'android',
    ]);
  });

  it('runs on each target every test its group runs, and nothing tagged for the other', () => {
    expect(
      searched(offTargetFindings(tests, targets), {
        of: tests,
        what: 'listed e2e tests',
      }),
    ).toEqual([]);
  });
});

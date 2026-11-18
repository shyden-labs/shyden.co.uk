import { describe, expect, it } from 'vitest';
import {
  DESKTOP_RUN_LEAVES_OUT,
  GROUP_ONLY,
  PHONE_RUN_LEAVES_OUT,
  groupOnlyFindings,
  offTargetFindings,
  type ListedTest,
} from '../group-tags';

/**
 * A test runs on one device group only by carrying `@phone` or `@desktop`
 * and a one-line reason naming the input or feature that differs (#1182;
 * Shyden's same-tests rule, 2026-11-17). Untagged means shared.
 */
const listed = (
  tags: string[],
  reason?: string,
  id = 'a.spec.ts › a test',
): ListedTest => ({
  id,
  tags,
  annotations:
    reason === undefined ? [] : [{ type: GROUP_ONLY, description: reason }],
});

describe('groupOnlyFindings', () => {
  it('passes a shared test and a group-only test with a reason naming its input', () => {
    expect(
      groupOnlyFindings([
        listed([]),
        listed(['@phone'], 'the on-screen keyboard covers the page'),
        listed(['desktop'], 'a hardware keyboard shortcut'),
      ]),
    ).toEqual([]);
  });

  it('refuses a group tag with no reason', () => {
    expect(groupOnlyFindings([listed(['@phone'])])).toEqual([
      `a.spec.ts › a test: tagged @phone with no ${GROUP_ONLY} annotation giving the reason`,
    ]);
  });

  it('refuses a blank reason', () => {
    expect(groupOnlyFindings([listed(['@desktop'], '  ')])).toEqual([
      `a.spec.ts › a test: tagged @desktop with no ${GROUP_ONLY} annotation giving the reason`,
    ]);
  });

  it('refuses a reason that names no input or feature', () => {
    expect(
      groupOnlyFindings([listed(['@phone'], 'flaky on the laptop')]),
    ).toEqual([
      'a.spec.ts › a test: tagged @phone, but its reason "flaky on the laptop" names no input or feature that differs by device',
    ]);
  });

  it('refuses a test tagged for both groups, which is a shared test written twice', () => {
    expect(
      groupOnlyFindings([listed(['@phone', '@desktop'], 'touch and a mouse')]),
    ).toEqual([
      'a.spec.ts › a test: tagged both @phone and @desktop; a shared test carries neither',
    ]);
  });

  it('refuses a reason on a test that carries no group tag', () => {
    expect(groupOnlyFindings([listed([], 'touch')])).toEqual([
      `a.spec.ts › a test: carries a ${GROUP_ONLY} reason but no @phone or @desktop tag`,
    ]);
  });
});

describe('what each run leaves out', () => {
  it('the desktop run leaves out @phone tests and keeps every other', () => {
    expect(DESKTOP_RUN_LEAVES_OUT.test('a test @phone')).toBe(true);
    expect(DESKTOP_RUN_LEAVES_OUT.test('a test @desktop')).toBe(false);
    expect(DESKTOP_RUN_LEAVES_OUT.test('a test')).toBe(false);
    expect(DESKTOP_RUN_LEAVES_OUT.test('a test @phones-later')).toBe(false);
  });

  it('the phone run leaves out @desktop tests and keeps every other', () => {
    expect(PHONE_RUN_LEAVES_OUT.test('a test @desktop')).toBe(true);
    expect(PHONE_RUN_LEAVES_OUT.test('a test @phone')).toBe(false);
    expect(PHONE_RUN_LEAVES_OUT.test('a test')).toBe(false);
  });
});

describe('offTargetFindings: nothing but a group tag keeps a test off a target (#1200)', () => {
  const all: ListedTest[] = [
    listed([], undefined, 'a.spec.ts › shared one'),
    listed([], undefined, 'a.spec.ts › shared two'),
    listed(['@phone'], 'the on-screen keyboard', 'b.spec.ts › phone only'),
    listed(['@desktop'], 'a hardware keyboard', 'b.spec.ts › desktop only'),
  ];
  const ids = (...names: string[]) => new Set(names);

  it('passes targets that run every test their group runs', () => {
    expect(
      offTargetFindings(all, [
        {
          name: 'chromium',
          group: 'desktop',
          ran: ids(
            'a.spec.ts › shared one',
            'a.spec.ts › shared two',
            'b.spec.ts › desktop only',
          ),
        },
        {
          name: 'android',
          group: 'phone',
          ran: ids(
            'a.spec.ts › shared one',
            'a.spec.ts › shared two',
            'b.spec.ts › phone only',
          ),
        },
      ]),
    ).toEqual([]);
  });

  it('refuses a shared test a target does not run, naming the target and the test', () => {
    expect(
      offTargetFindings(all, [
        {
          name: 'webkit',
          group: 'desktop',
          ran: ids('a.spec.ts › shared one', 'b.spec.ts › desktop only'),
        },
      ]),
    ).toEqual([
      'webkit does not run a.spec.ts › shared two, and no group tag keeps it off',
    ]);
  });

  it("refuses a target that drops its own group's tests", () => {
    expect(
      offTargetFindings(all, [
        {
          name: 'android',
          group: 'phone',
          ran: ids('a.spec.ts › shared one', 'a.spec.ts › shared two'),
        },
      ]),
    ).toEqual([
      'android does not run b.spec.ts › phone only, and no group tag keeps it off',
    ]);
  });

  it("refuses a target that runs the other group's tests", () => {
    expect(
      offTargetFindings(all, [
        {
          name: 'firefox',
          group: 'desktop',
          ran: ids(
            'a.spec.ts › shared one',
            'a.spec.ts › shared two',
            'b.spec.ts › desktop only',
            'b.spec.ts › phone only',
          ),
        },
      ]),
    ).toEqual(['firefox runs b.spec.ts › phone only, which is tagged @phone']);
  });

  it('refuses a target that runs nothing at all', () => {
    expect(
      offTargetFindings(all, [
        { name: 'chromium', group: 'desktop', ran: ids() },
      ]),
    ).toEqual([
      'chromium does not run a.spec.ts › shared one, and no group tag keeps it off',
      'chromium does not run a.spec.ts › shared two, and no group tag keeps it off',
      'chromium does not run b.spec.ts › desktop only, and no group tag keeps it off',
    ]);
  });
});

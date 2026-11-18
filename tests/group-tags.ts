/**
 * Device groups (#1182; Shyden's same-tests rule, 2026-11-17): every phone runs
 * the same tests as every other phone, and every desktop browser the same as
 * every other. A test belongs to one group only where the behaviour itself
 * differs by device kind, and says so: it carries `@phone` or `@desktop` and
 * a `group-only` annotation whose one-line reason names the input or feature
 * that differs. Untagged means shared: it runs on every target.
 *
 *   test('…', {
 *     tag: '@phone',
 *     annotation: { type: GROUP_ONLY, description: 'the on-screen keyboard' },
 *   }, async ({ page }) => { … });
 */

export const PHONE_TAG = '@phone';
export const DESKTOP_TAG = '@desktop';
/** The annotation type a group-only test gives its reason under. */
export const GROUP_ONLY = 'group-only';

/** What `playwright.config.ts` (the desktop browsers) leaves out. */
export const DESKTOP_RUN_LEAVES_OUT = new RegExp(`${PHONE_TAG}(?![\\w-])`);
/** What `playwright.device.config.ts` (the phones) leaves out. */
export const PHONE_RUN_LEAVES_OUT = new RegExp(`${DESKTOP_TAG}(?![\\w-])`);

/**
 * The inputs and features that differ by device kind, the only reasons the
 * rule allows ("hardware keyboard and other input, screen orientation and the
 * like"). A reason must name one; "flaky here" or "slow there" names none.
 */
const DIFFERENCES =
  /\b(keyboard|key press|shortcut|mouse|wheel|hover|pointer|cursor|touch|tap|swipe|pinch|finger|orientation|rotat\w*|portrait|landscape|fullscreen|full screen|file picker|download|back button|back key|safe area|notch|vibrat\w*|camera|print\w*)\b/i;

export interface ListedTest {
  /** File and title, for the finding. */
  id: string;
  /** As Playwright lists them: with or without the leading `@`. */
  tags: readonly string[];
  annotations: readonly { type: string; description?: string }[];
}

const tagged = (test: ListedTest, tag: string): boolean =>
  test.tags.some((t) => (t.startsWith('@') ? t : `@${t}`) === tag);

/** Every group tag that gives no allowed reason, and every reason with no tag. */
export function groupOnlyFindings(tests: readonly ListedTest[]): string[] {
  const findings: string[] = [];
  for (const test of tests) {
    const phone = tagged(test, PHONE_TAG);
    const desktop = tagged(test, DESKTOP_TAG);
    const reason = test.annotations
      .filter((a) => a.type === GROUP_ONLY)
      .map((a) => (a.description ?? '').trim())
      .find((text) => text !== '');
    if (phone && desktop) {
      findings.push(
        `${test.id}: tagged both ${PHONE_TAG} and ${DESKTOP_TAG}; a shared test carries neither`,
      );
      continue;
    }
    const tag = phone ? PHONE_TAG : desktop ? DESKTOP_TAG : undefined;
    if (tag === undefined) {
      if (test.annotations.some((a) => a.type === GROUP_ONLY))
        findings.push(
          `${test.id}: carries a ${GROUP_ONLY} reason but no ${PHONE_TAG} or ${DESKTOP_TAG} tag`,
        );
      continue;
    }
    if (reason === undefined)
      findings.push(
        `${test.id}: tagged ${tag} with no ${GROUP_ONLY} annotation giving the reason`,
      );
    else if (!DIFFERENCES.test(reason))
      findings.push(
        `${test.id}: tagged ${tag}, but its reason "${reason}" names no input or feature that differs by device`,
      );
  }
  return findings;
}

/** One target of a run: a desktop engine, or the phone (its projects together). */
export interface Target {
  name: string;
  group: 'phone' | 'desktop';
  /** The ids of the tests this target's run lists. */
  ran: ReadonlySet<string>;
}

/**
 * Nothing but a group tag keeps a test off a target (#1200): each target runs
 * every test except those tagged for the other group, and none of those. A
 * project `grep`, `grepInvert`, `testIgnore` or `testMatch` that drops a test,
 * or takes one in, shows up here as a test missing or extra on that target.
 */
export function offTargetFindings(
  all: readonly ListedTest[],
  targets: readonly Target[],
): string[] {
  const findings: string[] = [];
  for (const target of targets) {
    const otherTag = target.group === 'phone' ? DESKTOP_TAG : PHONE_TAG;
    for (const test of all) {
      const otherGroupOnly = tagged(test, otherTag);
      const runs = target.ran.has(test.id);
      if (!otherGroupOnly && !runs)
        findings.push(
          `${target.name} does not run ${test.id}, and no group tag keeps it off`,
        );
      else if (otherGroupOnly && runs)
        findings.push(
          `${target.name} runs ${test.id}, which is tagged ${otherTag}`,
        );
    }
  }
  return findings;
}

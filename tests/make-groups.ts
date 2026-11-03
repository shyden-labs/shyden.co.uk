import { tapOn } from './real-touch';
import { typeInto } from './real-typing';
import type { Page } from '@playwright/test';

/**
 * Deal `count` students into groups of `size`, with the animation skipped.
 *
 * The one journey every suite that touches the Classroom Group Creator
 * performs, and it had four bodies before #277: a file-local helper in
 * `classroom-groups-controls.spec.ts` and three inline copies, in
 * `classroom-groups-privacy.spec.ts`, `dev-sanity.spec.ts` and
 * `prod-sanity.spec.ts`. Two of those are the gates: `dev-verified`, which
 * `main`'s branch protection requires, and `prod-verified`.
 *
 * They were not equivalent. The helper opens `#cg-sound-body` only when it
 * is hidden; the three copies click `#cg-sound-toggle` unconditionally, so
 * any of them running against an already-open section would CLOSE it and
 * then fail on a `selectOption` for a control nobody can see. None does
 * today -- each goes to a fresh page first -- which is exactly the shape of
 * a bug that waits for the test around it to grow one more step.
 *
 * `site-pages.ts` records the same lesson from the other direction: the dev
 * and prod sanity suites once carried byte-identical hand-written path
 * tables, `sitePaths()` grew to four, and both gates went on testing three.
 * Two gates are worth having because they fail independently; they are not
 * worth having in two dialects that drift apart.
 */
export const makeGroups = async (
  page: Page,
  count: string,
  size: string,
): Promise<void> => {
  await typeInto(page.locator('#cg-count'), count);
  await typeInto(page.locator('#cg-size'), size);
  await chooseSpeed(page, 'skip');
  await tapOn(page.locator('#cg-go'));
};

/**
 * Choose how the groups are dealt. `skip`, the default, lands them at once,
 * so a test asserts the result rather than the show.
 *
 * Stage 2, Task 7 folded Sound & animation into the tool's fourth
 * collapsible section -- #cg-speed lives in #cg-sound-body, which starts
 * collapsed, and `selectOption` waits for a visible target. Idempotent: the
 * section is opened only when it is shut, because a second click would close
 * what the first one opened. Seven inline copies clicked the toggle
 * unconditionally after #277 gave `makeGroups` one home, one of them in the
 * dev gate, and the spec-local `fill` carried an eighth (#390 F112).
 */
export const chooseSpeed = async (
  page: Page,
  speed: 'normal' | 'fast' | 'skip' = 'skip',
): Promise<void> => {
  const soundBody = page.locator('#cg-sound-body');
  if (await soundBody.isHidden()) {
    await tapOn(page.locator('#cg-sound-toggle'));
  }
  await page.selectOption('#cg-speed', speed);
};

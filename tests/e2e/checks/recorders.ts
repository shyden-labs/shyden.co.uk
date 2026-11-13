import { expect } from '../fixtures';
import { recordErrors } from '../recorders';
import { DEFAULT_THEME, type PageCheck } from '../page-checks';

/**
 * The error recorder's contract, moved from recorders.spec.ts (#1086), where
 * each of three tests opened '/' again. The recorder is the liveness control
 * behind every "no console errors" test (#390 F129). Each check starts its own
 * recorder, which hears only what is raised after it starts, so the errors one
 * check plants are not heard by the next. They run last on the homepage's
 * walk, since they plant errors and the third silences the console.
 */
const onHome = (name: string, run: PageCheck['run']): PageCheck => ({
  name,
  routes: () => ['/'],
  themes: [DEFAULT_THEME],
  mutates: true,
  run,
});

export const RECORDER_CHECKS: readonly PageCheck[] = [
  onHome(
    'the error recorder reports a console error the page logs',
    async ({ page }) => {
      const reported = recordErrors(page);
      await page.evaluate(() => console.error('planted console error'));
      await expect
        .soft(reported.expectNone('a planted error'))
        .rejects.toThrow('planted console error');
    },
  ),
  onHome(
    'the error recorder reports an exception nothing caught',
    async ({ page }) => {
      const reported = recordErrors(page);
      // Raised BEFORE the verdict is asked (#818): the second timer is queued
      // from inside the first, before it throws, so the evaluate resolves only
      // once the throw has happened, and the sentinel follows it.
      await page.evaluate(
        () =>
          new Promise<void>((thrown) => {
            setTimeout(() => {
              setTimeout(thrown);
              throw new Error('planted uncaught exception');
            });
          }),
      );
      await expect
        .soft(reported.expectNoUncaught('a planted throw'))
        .rejects.toThrow('planted uncaught exception');
    },
  ),
  // A recorder asked twice must wait for a sentinel each time. Silencing the
  // console after the first verdict means the second sentinel can never
  // arrive, so a recorder that waits for it must refuse to answer.
  onHome(
    'the error recorder: a second verdict waits for its own sentinel',
    async ({ page }) => {
      const reported = recordErrors(page);
      await reported.expectNone('the first verdict');
      await page.evaluate(() => {
        console.error = () => {};
      });
      await expect
        .soft(reported.expectNone('the second verdict'))
        .rejects.toThrow("never delivered this helper's own sentinel");
    },
  ),
];

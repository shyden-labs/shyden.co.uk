import { test, expect } from './fixtures';
import { recordErrors } from './recorders';

// The error recorder is the liveness control behind every "no console errors"
// test, and until #390 F129 nothing had ever watched it fail. These hold it to
// both halves of its contract: it reports what the page raises, and it never
// returns a verdict without its own sentinel having arrived first.
test.describe('the error recorder', () => {
  test('reports a console error the page logs', async ({ page }) => {
    const reported = recordErrors(page);
    await page.goto('/');
    await page.evaluate(() => console.error('planted console error'));
    await expect(reported.expectNone('a planted error')).rejects.toThrow(
      'planted console error',
    );
  });

  test('reports an exception nothing caught', async ({ page }) => {
    const reported = recordErrors(page);
    await page.goto('/');
    // Raised BEFORE the verdict is asked (#818). Resolving as soon as the
    // timer was set let the verdict's sentinel run first on WebKit, so the
    // barrier passed before the exception existed. The second timer is queued
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
    await expect(reported.expectNoUncaught('a planted throw')).rejects.toThrow(
      'planted uncaught exception',
    );
  });

  // A recorder asked twice must wait for a sentinel each time. Once the first
  // had arrived, a "seen" flag that never reset let every later verdict return
  // at once, before the events raised since had been delivered: an empty list
  // that vouched for nothing. Silencing the console after the first verdict
  // means the second sentinel can never arrive, so a recorder that waits for
  // it must refuse to answer.
  test('a second verdict waits for its own sentinel', async ({ page }) => {
    const reported = recordErrors(page);
    await page.goto('/');
    await reported.expectNone('the first verdict');
    await page.evaluate(() => {
      console.error = () => {};
    });
    await expect(reported.expectNone('the second verdict')).rejects.toThrow(
      "never delivered this helper's own sentinel",
    );
  });
});

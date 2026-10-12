import type { Page } from '@playwright/test';

/** What Chromium's DevTools protocol answers a capture it cannot take with (#676). */
export const CAPTURE_REFUSED = 'Unable to capture screenshot';

/**
 * Take a capture only once the page has painted a frame since this call
 * (#676), then name Chromium's refusal if it still comes.
 *
 * `text-over-ribbon.spec.ts` captured the instant after it appended a
 * `<style>`, and twice in CI (PR #551, PR #719) Chromium answered
 * `Page.captureScreenshot` with "Unable to capture screenshot", failing an
 * unrelated pull request. A page's style can be computed before any frame is
 * painted with it, so a computed-style wait proves nothing here; two
 * animation frames do: the first callback runs before a paint, the second
 * after it.
 *
 * Never retried (global rule: a retry is not a fix). A refusal that still
 * comes is rethrown with the candidates named, the protocol's own error kept
 * as its cause, so a red shard sends its reader to the ticket, not to the
 * re-run button.
 */
export async function captureAfterPaint(
  page: Pick<Page, 'evaluate'>,
  take: () => Promise<Buffer>,
): Promise<Buffer> {
  await page.evaluate(
    () =>
      new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
      ),
  );
  try {
    return await take();
  } catch (error) {
    if (error instanceof Error && error.message.includes(CAPTURE_REFUSED)) {
      throw new Error(
        'Chromium refused a capture taken after a painted frame (#676). ' +
          'Candidates: the viewport still settling after a resize, or a ' +
          'renderer with no frame to give. Not retried: read #676 and fix the ' +
          `cause. The protocol said: ${error.message}`,
        { cause: error },
      );
    }
    throw error;
  }
}

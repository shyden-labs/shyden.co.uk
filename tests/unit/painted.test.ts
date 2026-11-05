import { describe, expect, it } from 'vitest';
import { CAPTURE_REFUSED, captureAfterPaint } from '../e2e/painted';

/**
 * `captureAfterPaint` (#676) against a page stood in by a recorder: a unit
 * test reaches no browser, so what is proven here is the order (a painted
 * frame is awaited before the capture is taken) and the naming of Chromium's
 * refusal. The real captures run in the e2e suite.
 */
const recorder = () => {
  const order: string[] = [];
  const page = {
    evaluate: async () => {
      order.push('painted');
    },
  };
  return { order, page };
};

describe('captureAfterPaint (#676)', () => {
  it('awaits a painted frame before it takes the capture', async () => {
    const { order, page } = recorder();
    await captureAfterPaint(page, async () => {
      order.push('taken');
      return Buffer.from('png');
    });
    expect(order).toEqual(['painted', 'taken']);
  });

  it('returns the capture it took', async () => {
    const { page } = recorder();
    const shot = await captureAfterPaint(page, async () => Buffer.from('png'));
    expect(shot.toString()).toBe('png');
  });

  it("names Chromium's refusal, keeping the protocol's own error as its cause", async () => {
    const { page } = recorder();
    const refused = new Error(
      `page.screenshot: Protocol error (Page.captureScreenshot): ${CAPTURE_REFUSED}`,
    );
    const failure = await captureAfterPaint(page, async () => {
      throw refused;
    }).catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(Error);
    expect((failure as Error).message).toContain('#676');
    expect((failure as Error).cause).toBe(refused);
  });

  it('passes any other failure through as it came', async () => {
    const { page } = recorder();
    const other = new Error(
      'page.screenshot: Target page, context or browser has been closed',
    );
    const failure = await captureAfterPaint(page, async () => {
      throw other;
    }).catch((error: unknown) => error);
    expect(failure).toBe(other);
  });
});

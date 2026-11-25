import { test, type Page } from '@playwright/test';
import {
  atViewport,
  measuredViewport,
  onRealPhone,
  type ViewportSize,
} from './viewport-at';

type Step = (title: string, body: () => Promise<void>) => Promise<void>;

/**
 * One journey, walked at each width it is checked at, as steps of ONE test
 * (#1086; Shyden 2026-11-13, "One test, widths inside"; global rule "One
 * journey, all its assertions").
 *
 * A test written once per width ran the identical journey 2-4 times on a real
 * phone, which cannot take an emulated width (#1046): the 404's "no sideways
 * scroll" ran four times over, at the phone's own width. Here an emulated
 * target is set to each width in turn and `run` opens its page after, exactly
 * as each per-width test did; a real phone answers every request with the one
 * width it has, so it is walked once, at that width.
 *
 * `run` is told which of the asked widths its walk stands for: one on an
 * emulated target, all of them on a phone. Each step is named with the width
 * it ran at, so a failure still says which.
 */
export async function eachWidth(
  page: Page,
  widths: readonly ViewportSize[],
  run: (took: ViewportSize, asked: readonly number[]) => Promise<void>,
  { step = (title, body) => test.step(title, body) }: { step?: Step } = {},
): Promise<void> {
  if (widths.length === 0) throw new Error('eachWidth was given no widths');
  if (onRealPhone(page)) {
    // A real phone: one walk at the width it has, standing for every width
    // asked, so a journey that checks something different at each width
    // makes all of those checks on it.
    const took = await measuredViewport(page);
    await step(`at ${took.width}px`, () =>
      run(
        took,
        widths.map((want) => want.width),
      ),
    );
    return;
  }
  for (const want of widths) {
    const took = await atViewport(page, want);
    await step(`at ${took.width}px`, () => run(took, [want.width]));
  }
}

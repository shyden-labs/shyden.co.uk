import { describe, expect, it } from 'vitest';
import type { Page } from '@playwright/test';
import { eachWidth } from '../each-width';

/**
 * #1086, Shyden 2026-11-13 ("One test, widths inside"): a journey checked at
 * several widths is ONE test, each width a step. An emulated target is set to
 * each width in turn; a real phone has one screen (#1046), so its walk is
 * measured once, not repeated at a width it never takes.
 */

interface Size {
  width: number;
  height: number;
}

const fakePage = (emulated: Size | null, real: Size) => {
  let current = emulated;
  const page = {
    viewportSize: () => current,
    setViewportSize: async (size: Size) => {
      current = size;
    },
    evaluate: async () => ({
      vvWidth: real.width,
      vvHeight: real.height,
      vvScale: 1,
    }),
  } as unknown as Page;
  return page;
};

/** Runs each step at once and records its title, as test.step would name it. */
const steps = () => {
  const titles: string[] = [];
  const step = async (title: string, body: () => Promise<void>) => {
    titles.push(title);
    await body();
  };
  return { titles, step };
};

const WIDTHS = [
  { width: 320, height: 800 },
  { width: 768, height: 800 },
  { width: 1280, height: 800 },
];

describe('eachWidth', () => {
  it('walks an emulated target at every width asked for, one step each, in order', async () => {
    const page = fakePage(
      { width: 1280, height: 720 },
      { width: 1, height: 1 },
    );
    const { titles, step } = steps();
    const seen: number[] = [];
    await eachWidth(page, WIDTHS, async (took) => void seen.push(took.width), {
      step,
    });
    expect(seen).toEqual([320, 768, 1280]);
    expect(titles).toEqual(['at 320px', 'at 768px', 'at 1280px']);
  });

  it('walks a real phone once, at the width it has', async () => {
    const page = fakePage(null, { width: 411, height: 759 });
    const { titles, step } = steps();
    const seen: number[] = [];
    await eachWidth(page, WIDTHS, async (took) => void seen.push(took.width), {
      step,
    });
    expect(seen).toEqual([411]);
    expect(titles).toEqual(['at 411px']);
  });

  it('tells each walk which of the asked widths it stands for', async () => {
    const emulated = fakePage(
      { width: 1280, height: 720 },
      { width: 1, height: 1 },
    );
    const phone = fakePage(null, { width: 411, height: 759 });
    const stood: number[][] = [];
    const record = async (_: unknown, asked: readonly number[]) =>
      void stood.push([...asked]);
    await eachWidth(emulated, WIDTHS, record, steps());
    // A real phone's one walk stands for every width asked, so a journey that
    // checks something different at each width makes every one of those
    // checks on it.
    await eachWidth(phone, WIDTHS, record, steps());
    expect(stood).toEqual([[320], [768], [1280], [320, 768, 1280]]);
  });

  it('refuses an empty list, which would check nothing', async () => {
    const page = fakePage(
      { width: 1280, height: 720 },
      { width: 1, height: 1 },
    );
    await expect(
      eachWidth(page, [], async () => undefined, steps()),
    ).rejects.toThrow('no widths');
  });
});

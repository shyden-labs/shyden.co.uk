import type { Locator, Page } from '@playwright/test';
import { describe, expect, it } from 'vitest';
import { TAB_CEILING, tabTo } from '../tab-to';

/**
 * A stand-in page whose focus moves one element per press of `key`, reaching
 * the target after `reachAt` presses (never, when null). It records every
 * key pressed, so a test can see the walk was made of real key presses.
 */
const walk = (
  reachAt: number | null,
  key = 'Tab',
  engine: string | null = 'chromium',
) => {
  const pressed: string[] = [];
  let presses = 0;
  const page = {
    keyboard: {
      press: async (k: string) => {
        pressed.push(k);
        if (k === key) presses += 1;
      },
    },
    evaluate: async () => `button#step-${presses}`,
    context: () => ({
      browser: () =>
        engine === null
          ? null
          : { browserType: () => ({ name: () => engine }) },
    }),
  } as unknown as Page;
  const target = {
    page: () => page,
    evaluate: async () => reachAt !== null && presses >= reachAt,
    toString: () => "locator('#target')",
  } as unknown as Locator;
  return { page, target, pressed };
};

describe('tabTo: reaches a control by real Tab presses (#1034)', () => {
  it('presses Tab until the control has focus, and no further', async () => {
    const { target, pressed } = walk(3);
    await tabTo(target);
    expect(pressed).toEqual(['Tab', 'Tab', 'Tab']);
  });

  it('presses Option+Tab on WebKit, which reaches buttons and links too', async () => {
    const { target, pressed } = walk(2, 'Alt+Tab', 'webkit');
    await tabTo(target);
    expect(pressed).toEqual(['Alt+Tab', 'Alt+Tab']);
  });

  it('walks backwards with Shift+Tab', async () => {
    const { target, pressed } = walk(1, 'Shift+Tab', 'firefox');
    await tabTo(target, 'backwards');
    expect(pressed).toEqual(['Shift+Tab']);
  });

  it('presses nothing when the control already has focus', async () => {
    const { target, pressed } = walk(0);
    await tabTo(target);
    expect(pressed).toEqual([]);
  });

  it('fails at its ceiling, naming the control, the key and the last of the walk', async () => {
    const { target, pressed } = walk(null);
    const last = Array.from(
      { length: 12 },
      (_, i) => `button#step-${TAB_CEILING - 11 + i}`,
    );
    await expect(tabTo(target)).rejects.toThrow(
      `${TAB_CEILING} presses of Tab never gave locator('#target') focus; the walk ended ${last.join(' > ')}`,
    );
    expect(pressed).toHaveLength(TAB_CEILING);
  });

  it('folds a walk that never moves into one step, so a stuck focus reads as stuck', async () => {
    const { target, page } = walk(null);
    (page as unknown as { evaluate: () => Promise<string> }).evaluate =
      async () => 'summary';
    await expect(tabTo(target)).rejects.toThrow(
      `${TAB_CEILING} presses of Tab never gave locator('#target') focus; the walk ended summary (x${TAB_CEILING})`,
    );
  });

  it('reaches a control exactly at the ceiling', async () => {
    const { target, pressed } = walk(TAB_CEILING);
    await tabTo(target);
    expect(pressed).toHaveLength(TAB_CEILING);
  });

  it('fails naming why when the page has no browser to read its engine from', async () => {
    const { target, pressed } = walk(1, 'Tab', null);
    await expect(tabTo(target)).rejects.toThrow(
      "tabTo cannot tell which engine runs locator('#target'): its context has no browser",
    );
    expect(pressed).toEqual([]);
  });
});

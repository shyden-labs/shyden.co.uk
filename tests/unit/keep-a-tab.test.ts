import { describe, expect, it } from 'vitest';
import { closeAllBut, keepATab } from '../device/keep-a-tab';

/**
 * #1215: on the real Android phone, closing Chrome's last tab puts the
 * Launcher in front (measured 2026-11-19 on `3b402284`), and the next test's
 * foreground check fails naming it. The device fixtures keep one blank tab
 * open for the whole run, so no close ever leaves Chrome without a tab.
 */

type Tab = {
  name: string;
  closed: boolean;
  isClosed(): boolean;
  close(): Promise<void>;
};

const phone = (names: string[]) => {
  const log: string[] = [];
  const open: Tab[] = [];
  const tab = (name: string): Tab => {
    const t: Tab = {
      name,
      closed: false,
      isClosed: () => t.closed,
      close: async () => {
        t.closed = true;
        open.splice(open.indexOf(t), 1);
        log.push(`close ${name}`);
        // What the phone does: a close that leaves no tab shows the Launcher.
        if (open.length === 0) log.push('LAUNCHER');
      },
    };
    open.push(t);
    return t;
  };
  names.forEach(tab);
  let made = 0;
  const context = {
    pages: () => [...open],
    newPage: async () => {
      log.push('open keeper');
      return tab(`blank${++made}`);
    },
  };
  return { context, log, open };
};

describe('keepATab', () => {
  it('opens a blank tab when there is none yet', async () => {
    const { context, log } = phone(['test']);
    const keeper = await keepATab(context, undefined);
    expect(keeper.name).toBe('blank1');
    expect(log).toEqual(['open keeper']);
  });

  it('keeps the tab it already has', async () => {
    const { context, log } = phone([]);
    const first = await keepATab(context, undefined);
    expect(await keepATab(context, first)).toBe(first);
    expect(log).toEqual(['open keeper']);
  });

  it('replaces a kept tab that something closed', async () => {
    const { context } = phone([]);
    const first = await keepATab(context, undefined);
    await first.close();
    const second = await keepATab(context, first);
    expect(second).not.toBe(first);
    expect(second.isClosed()).toBe(false);
  });
});

describe('closeAllBut', () => {
  it('closes every other tab and never leaves Chrome with none', async () => {
    const { context, log, open } = phone(['test', 'popup']);
    const keeper = await keepATab(context, undefined);
    await closeAllBut(context, keeper);
    expect(open.map((t) => t.name)).toEqual(['blank1']);
    expect(log).not.toContain('LAUNCHER');
  });

  it('a tab that refuses to close does not stop the others closing', async () => {
    const { context, open } = phone(['stuck', 'test']);
    const stuck = open[0]!;
    stuck.close = async () => {
      throw new Error('Target closed');
    };
    const keeper = await keepATab(context, undefined);
    await closeAllBut(context, keeper);
    expect(open.map((t) => t.name)).toEqual(['stuck', 'blank1']);
  });
});

import type { Page } from '@playwright/test';

/**
 * Records every Web Audio source the page starts, and when it is due to
 * stop, so a test can ask whether the sound really stopped (#1339). The
 * browser's own nodes play; this only wraps `start` and `stop` on
 * `AudioScheduledSourceNode` (buffer sources and oscillators alike) to note
 * the times asked for. Installed with `addInitScript`, before the page's
 * script runs.
 */
export const installSourceRecorder = (page: Page) =>
  page.addInitScript(() => {
    interface Entry {
      node: AudioScheduledSourceNode;
      stopAt: number;
      marked: boolean;
    }
    const w = window as Window & { __cgSources?: Entry[] };
    w.__cgSources = [];
    const proto = window.AudioScheduledSourceNode?.prototype;
    if (!proto) return;
    const realStart = proto.start;
    const realStop = proto.stop;
    proto.start = function (this: AudioScheduledSourceNode, ...args) {
      w.__cgSources?.push({ node: this, stopAt: Infinity, marked: false });
      return realStart.apply(this, args as Parameters<typeof realStart>);
    };
    proto.stop = function (this: AudioScheduledSourceNode, when?: number) {
      const entry = w.__cgSources?.find((e) => e.node === this);
      if (entry) entry.stopAt = when ?? this.context.currentTime;
      return realStop.call(this, when);
    };
  });

/** Marks every source started so far, so a later check reads only them. */
export const markSources = (page: Page) =>
  page.evaluate(() => {
    const w = window as Window & {
      __cgSources?: { marked: boolean }[];
    };
    for (const entry of w.__cgSources ?? []) entry.marked = true;
    return w.__cgSources?.length ?? 0;
  });

/**
 * How many of the marked sources are still due to sound more than `fadeS`
 * from now: 0 once a stop has silenced them all.
 */
export const markedStillSounding = (page: Page, fadeS = 0.15) =>
  page.evaluate((fade) => {
    const w = window as Window & {
      __cgSources?: {
        node: AudioScheduledSourceNode;
        stopAt: number;
        marked: boolean;
      }[];
    };
    return (w.__cgSources ?? []).filter(
      (e) => e.marked && e.stopAt > e.node.context.currentTime + fade,
    ).length;
  }, fadeS);

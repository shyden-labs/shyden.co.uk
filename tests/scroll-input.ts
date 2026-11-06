/**
 * The real input that scrolls the page on each target (#1048).
 *
 * A desktop engine has a mouse, so its wheel. A Chromium phone (the emulated
 * Android project and the real Android over CDP) takes real touch drags, so a
 * finger (`swipeOver` in `real-touch.ts`). Mobile WebKit takes neither:
 * Playwright refuses its wheel and has no touch drags on WebKit, so a test
 * that needs a scroll there fails, naming why (Shyden's ruling 2026-11-06),
 * until #1036 settles a route.
 */
export type ScrollInput =
  { kind: 'wheel' } | { kind: 'finger' } | { kind: 'none'; why: string };

export const scrollInput = (
  browserName: string,
  isMobile: boolean,
): ScrollInput => {
  if (!isMobile) return { kind: 'wheel' };
  if (browserName === 'chromium') return { kind: 'finger' };
  return {
    kind: 'none',
    why:
      `no real scroll input on mobile WebKit (${browserName}): Playwright ` +
      'refuses the mouse wheel there and has no touch drags on WebKit ' +
      '(shyden-labs/shyden.co.uk#1036)',
  };
};

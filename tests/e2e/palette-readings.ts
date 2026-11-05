import type { Page } from '@playwright/test';

/**
 * The palette a page serves and the colours its controls paint, read in the
 * page (#185, and #781 for the API docs, which draw their controls only once
 * Try it out is open). One home for palette-controls.spec.ts and
 * api-docs.spec.ts.
 */

/** Controls the page paints itself, as opposed to the ones the UA draws. */
export const PAINTED =
  'input:not([type="checkbox"]):not([type="radio"]):not([type="file"]), select, textarea';

export type Reading = {
  what: string;
  background: string;
  color: string;
};

/** The page's palette, the elements examined, and every painted control's colours. */
export const readPalette = (
  page: Page,
): Promise<{ allowed: string[]; examined: number; readings: Reading[] }> =>
  page.evaluate((selector) => {
    // Resolve a declared value the way the renderer does, so the comparison
    // cannot disagree with what is actually on screen.
    const probe = document.createElement('span');
    probe.style.display = 'none';
    document.body.append(probe);
    const computed = (value: string): string => {
      probe.style.color = '';
      probe.style.color = value;
      return getComputedStyle(probe).color;
    };

    const root = getComputedStyle(document.documentElement);
    const names = Array.from(document.styleSheets)
      .flatMap((sheet) => {
        try {
          return Array.from(sheet.cssRules);
        } catch {
          return []; // a cross-origin sheet; none of ours are
        }
      })
      .flatMap((rule) =>
        rule instanceof CSSStyleRule ? Array.from(rule.style) : [],
      )
      .filter((property) => property.startsWith('--'));

    const palette = new Set<string>(['rgba(0, 0, 0, 0)']);
    for (const name of new Set(names)) {
      const value = root.getPropertyValue(name).trim();
      if (value) palette.add(computed(value));
    }
    probe.remove();

    return {
      allowed: [...palette],
      // Every element the selector ran over (#610).
      examined: document.body.querySelectorAll('*').length,
      readings: [...document.querySelectorAll(selector)].map((el) => {
        const style = getComputedStyle(el);
        return {
          what: `${el.tagName.toLowerCase()}#${el.id || '(no id)'}`,
          background: style.backgroundColor,
          color: style.color,
        };
      }),
    };
  }, PAINTED);

/** Every painted colour of `readings` that is not in `allowed`, named. */
export const offPalette = (
  readings: readonly Reading[],
  allowed: readonly string[],
): string[] =>
  readings
    .flatMap((r) => [
      { ...r, role: 'background', value: r.background },
      { ...r, role: 'color', value: r.color },
    ])
    .filter((r) => !allowed.includes(r.value))
    .map((r) => `${r.what} ${r.role}=${r.value}`);

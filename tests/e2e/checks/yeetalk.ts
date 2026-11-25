import { atLeast44, expectNoHorizontalScroll } from '../../viewport';
import { localePaths } from '../locale-sampling';
import { DEFAULT_THEME, type PageCheck } from '../page-checks';

/**
 * The Glory Points page at each width, moved from yeetalk-calculators.spec.ts
 * (#1086), where it was one test per width and locale: on a real phone, which
 * keeps its own width (#1046), the same load four times over.
 */
export const YEETALK_WIDTH_CHECKS: readonly PageCheck[] = [
  {
    name: 'the Glory Points page adds no horizontal scroll',
    routes: () => localePaths('/yeetalk-calculators'),
    themes: [DEFAULT_THEME],
    widths: [320, 375, 768, 1280],
    run: async ({ page }) => {
      await expectNoHorizontalScroll(page);
    },
  },
  {
    // yeetalk-calculators.spec.ts and gift-value.spec.ts each loaded the page
    // at 375 x 800 to measure their own controls. Every locale (#423): the
    // submit buttons' labels are the page's own copy. The walk reads at
    // 375 x 900, and a target's size does not read the height.
    name: 'the Glory Points and gift-value controls are at least 44px',
    routes: () => localePaths('/yeetalk-calculators'),
    themes: [DEFAULT_THEME],
    widths: [375],
    run: async ({ page }) => {
      await atLeast44(page.locator('a[href="https://yeetalkapp.com/"]'));
      await atLeast44(page.locator('#glory-input'));
      await atLeast44(page.locator('#glory-submit'));
      await atLeast44(page.locator('#gift-input'));
      await atLeast44(page.locator('#gift-submit'));
      await atLeast44(page.locator('a[href="#gift-value"]'));
    },
  },
];

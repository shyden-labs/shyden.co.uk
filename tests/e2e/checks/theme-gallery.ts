import { shoot } from '../evidence';
import { THEMES } from '../../palette';
import { expectNoHorizontalScroll } from '../../viewport';
import { PUBLISHED_ROUTES } from '../published-paths';
import type { PageCheck } from '../page-checks';

/**
 * Every page renders each theme with no sideways scroll, at 320 and 1280px:
 * moved from theme-gallery.spec.ts (#1086), where it was one test per page,
 * width and theme (#421). On a real phone, which keeps its own width (#1046),
 * each page and theme was one journey twice. The walk has already emulated
 * the theme and confirmed the page rendered it (`emulateTheme`), as each old
 * test confirmed with `expectTheme`.
 */
export const THEME_GALLERY_CHECKS: readonly PageCheck[] = [
  {
    name: 'renders the theme, with no sideways scroll',
    routes: () => PUBLISHED_ROUTES,
    themes: THEMES,
    widths: [320, 1280],
    run: async ({ page, route, theme, took }) => {
      await expectNoHorizontalScroll(page);
      await shoot(page, `${route}, ${theme}, ${took.width}px`);
    },
  },
];

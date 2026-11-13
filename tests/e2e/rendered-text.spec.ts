import { test, expect } from './fixtures';
import {
  PUBLISHED_ROUTES,
  publishedPaths,
  withoutTrailingSlash,
} from './published-paths';

/**
 * The scan that found the shipped defects, encoded so it runs every time.
 *
 * Three sentences went to production saying "Company No.17110487",
 * "Registered office:71-75 Shelton Street" and "tidak ada.Kembali ke beranda"
 * — in both languages, for weeks. Nobody edited that copy. In JSX and Astro,
 * whitespace between two nodes survives only while they share a line, so
 * `prettier` re-wrapping a long line silently deletes a space from the
 * rendered text. The formatter changes what the page SAYS.
 *
 * Those three are now pinned as whole sentences by chrome/homepage/site-meta.
 * That protects the three that were found. This protects the ones that have
 * not happened yet: any NEW multi-node sentence, on any page, in any locale.
 *
 * What it cannot see: a seam between two lowercase words with no punctuation
 * at the join ("the endand the beginning"). Reviewing rendered text is still
 * a job. This catches the shape that has actually bitten, twice.
 */

test.describe('rendered text — no sentence may lose a space to the formatter', () => {
  // The pages each test below generates come from the source; this holds
  // them to what the build actually published, both ways (#422).
  test("the published routes are the sitemap's", async ({ page }) => {
    const built = (await publishedPaths(page)).map(withoutTrailingSlash).sort();
    expect(PUBLISHED_ROUTES.map(withoutTrailingSlash).sort()).toEqual(built);
  });

  // Each page's three scans, and the scan's own liveness checks on the
  // homepage, are made on each page's walk: checks/rendered-text.ts (#1086).
  // The readers live in rendered-text.ts.
});

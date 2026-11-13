import { test, expect } from './fixtures';
import { expectNoHorizontalScroll } from '../viewport';
import { atViewport } from '../viewport-at';
// The 404's back-home sentence, read whole in every language, is held by
// 'ends each back-home sentence in its own language' in not-found.spec.ts.
// This file kept an English-and-Indonesian copy titled "in both languages",
// written before the page served five (#390 F132).
test('robots.txt references the sitemap', async ({ request }) => {
  const body = await (await request.get('/robots.txt')).text();
  expect(body).toMatch(
    /Sitemap:\s*https:\/\/shyden\.co\.uk\/sitemap-index\.xml/,
  );
});

// The 404 page is a real, user-reachable page (broken links, typos, shared bad
// URLs — disproportionately on mobile), so it carries the same no-horizontal-
// scroll guarantee as every other page (cf. homepage.spec.ts / yeetalk-calculators.spec.ts).
test.describe('404 page — mobile-first layout', () => {
  for (const width of [320, 375, 768, 1280]) {
    test(`no horizontal scroll at ${width}px`, async ({ page }) => {
      await atViewport(page, { width, height: 900 });
      await page.goto('/no-such-page-xyz');
      await expectNoHorizontalScroll(page);
    });
  }
});

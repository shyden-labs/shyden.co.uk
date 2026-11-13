import { test, expect } from './fixtures';
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

// The 404's no-horizontal-scroll walk, at every width, is in not-found.spec.ts (#1086).

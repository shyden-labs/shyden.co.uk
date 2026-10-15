import { defineConfig } from 'astro/config';
import sitemap from '@astrojs/sitemap';

// Task 3: `site` set for canonical/OG URL resolution.
// Task 7: sitemap integration generates sitemap-index.xml at build time.
// devToolbar disabled: it is dev-only UI whose late async insertion causes
// reflow flakiness in E2E measurements and never ships to production.
export default defineConfig({
  site: 'https://shyden.co.uk',
  // Every locale is a real built page (English unprefixed, the rest under
  // /<locale>/), so each is indexed and can be linked to directly; the site
  // routes them itself (localisePath). Astro's own `i18n` routing option is
  // NOT set: it listed en and id long after five shipped, nothing read it,
  // and the build is byte-identical without it (61 files, #390).
  //
  // @astrojs/sitemap needs its OWN i18n option, so without this the sitemap
  // listed its <loc> entries with zero xhtml:link alternates — declaring no
  // relationship between the language versions of the same page.
  //
  // WRITTEN OUT because this file runs under plain Node and cannot import
  // src/lib/i18n. That duplication is the whole hazard: it said en+id for
  // weeks after #22 shipped five languages, so nine of fifteen URLs declared
  // NO alternates at all while the guard — which also named en and id by hand
  // — passed. Two hand-written lists agreeing with each other is not a check.
  // The values are LOCALE_METADATA's `ogLocale` with `_` as `-`, and
  // tests/unit/sitemap-config.test.ts asserts this map against that table, so
  // the seam is checked even though the import cannot be. See #108.
  integrations: [
    sitemap({
      // The API docs (#781) are developer pages in English only, kept out of
      // search engines with noindex, so they stay out of the sitemap too.
      filter: (page) => !new URL(page).pathname.startsWith('/api/docs/'),
      i18n: {
        defaultLocale: 'en',
        locales: {
          en: 'en-GB',
          id: 'id-ID',
          zh: 'zh-CN',
          vi: 'vi-VN',
          th: 'th-TH',
        },
      },
    }),
  ],
  devToolbar: { enabled: false },
});

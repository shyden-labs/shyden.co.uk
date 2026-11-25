import { expect } from '@playwright/test';
import { PUBLISHED_ROUTES } from '../published-paths';
import {
  emailAddresses,
  outsideThirdPartyNotices,
} from '../../email-addresses';
import type { PageCheck } from '../page-checks';

/**
 * No page shows an email address or a `mailto:` link (#1266; Shyden,
 * 2026-11-23, every project: "we only allow support requests via the support
 * request form so we shouldn't show an email address"). Read off each page's
 * own served HTML, so text, `href` and every other attribute are covered.
 * A third-party licence notice (`<pre data-third-party-notice>`, the API
 * docs' Swagger UI licences) is left out: Shyden ruled the same day that a
 * notice is shown exactly as its authors published it.
 */
export const NO_EMAIL_ADDRESS_CHECKS: readonly PageCheck[] = [
  {
    name: 'shows no email address and no mailto: link',
    routes: () => PUBLISHED_ROUTES,
    themes: ['dark'],
    run: async ({ route, response }) => {
      expect(response, `${route}: the walk's own response`).not.toBeNull();
      const html = (await response?.text()) ?? '';
      expect(html, `${route}: the served HTML`).not.toBe('');
      expect
        .soft(emailAddresses(outsideThirdPartyNotices(html)), route)
        .toEqual([]);
      // The exemption cannot spread: only the API docs carry notices, all
      // three of them, and the notices are still printed in full.
      const apiDocs = route.startsWith('/api/docs/');
      expect
        .soft(
          html.match(/\bdata-third-party-notice\b/g)?.length ?? 0,
          `${route}: third-party notices`,
        )
        .toBe(apiDocs ? 3 : 0);
      if (apiDocs)
        expect
          .soft(html, `${route}: the bundled MIT copyright line`)
          .toContain('Copyright (c) 2013-2018 Viacheslav Lotsmanov');
    },
  },
];

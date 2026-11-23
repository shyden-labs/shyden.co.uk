import { expect } from '@playwright/test';
import { PUBLISHED_ROUTES } from '../published-paths';
import { emailAddresses } from '../../email-addresses';
import type { PageCheck } from '../page-checks';

/**
 * No page shows an email address or a `mailto:` link (#1266; Shyden,
 * 2026-11-23, every project: "we only allow support requests via the support
 * request form so we shouldn't show an email address"). Read off each page's
 * own served HTML, so text, `href` and every other attribute are covered.
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
      expect.soft(emailAddresses(html), route).toEqual([]);
    },
  },
];

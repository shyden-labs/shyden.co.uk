import { expect } from '@playwright/test';
import { PUBLISHED_ROUTES } from '../published-paths';
import { workersDevHosts } from '../../workers-dev';
import type { PageCheck } from '../page-checks';

/**
 * No page or script of the production build names a `workers.dev` address
 * (#1032 AC4, narrowed by Shyden 2026-11-20 to production). The walk measures
 * a production build, so this reads each page's own HTML and every script it
 * loads from this site. ShyDesk's dev host may appear in a dev build only,
 * which this walk never builds; live ShyDesk is `shydesk.dpdns.org`.
 */
export const NO_WORKERS_DEV_CHECKS: readonly PageCheck[] = [
  {
    name: 'names no workers.dev address, in the page or a script it loads',
    routes: () => PUBLISHED_ROUTES,
    themes: ['dark'],
    run: async ({ page, route, response }) => {
      expect(response, `${route}: the walk's own response`).not.toBeNull();
      const texts: [string, string][] = [
        [route, (await response?.text()) ?? ''],
      ];
      const own = new URL(page.url()).origin;
      const scripts = await page
        .locator('script[src]')
        .evaluateAll((els) => els.map((el) => (el as HTMLScriptElement).src));
      for (const src of scripts.filter((s) => new URL(s).origin === own))
        texts.push([src, await (await page.request.get(src)).text()]);
      for (const [where, text] of texts)
        expect.soft(workersDevHosts(text), where).toEqual([]);
    },
  },
];

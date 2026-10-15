import { expect, type APIRequestContext } from '@playwright/test';

/**
 * The report endpoint's health check answers ok (#97, spec 6.2): the REPORTS
 * binding is present and its table has the migration's columns. The one home
 * for the functions-runtime suite and the dev and prod sanity suites.
 * Production keeps the route private (#782), so prod-sanity passes the Access
 * service token's headers; dev and the functions runtime pass none.
 */
export async function expectReportsBound(
  request: APIRequestContext,
  headers: Record<string, string> = {},
): Promise<void> {
  const response = await request.get('/api/report/health', { headers });
  expect(response.status()).toBe(200);
  expect(await response.json()).toEqual({ ok: true });
}

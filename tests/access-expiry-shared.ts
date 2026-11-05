/**
 * Cloudflare's answer to `GET /accounts/{id}/access/service_tokens` (#796),
 * for the unit, logs and integration suites. Each token is spread over a
 * full-looking record, so a reader that picks the wrong field is caught.
 */
export const tokenList = (
  tokens: Record<string, unknown>[],
  totalPages: unknown = 1,
) => ({
  success: true,
  errors: [],
  messages: [],
  result: tokens.map((token) => ({
    id: 'f174e90a-fafe-4643-bbbc-4a0ed4fc8415',
    client_id: '88bf3b6d86161464f6509f7219099e57.access',
    duration: '8760h',
    enabled: true,
    created_at: '2026-10-15T23:55:00Z',
    updated_at: '2026-10-15T23:55:00Z',
    last_seen_at: '2026-10-18T01:00:00Z',
    ...token,
  })),
  result_info: {
    page: 1,
    per_page: 1000,
    count: tokens.length,
    total_pages: totalPages,
  },
});

/** `prod-sanity-2` as Cloudflare lists it: made 2026-10-15, one year long. */
export const PROD_SANITY = {
  name: 'prod-sanity-2',
  expires_at: '2027-10-15T23:55:00Z',
};

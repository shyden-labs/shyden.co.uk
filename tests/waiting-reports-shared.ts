/**
 * A D1 query answer to `COUNT_SQL`, in Cloudflare's envelope: shared by the
 * unit suite and the logs suite (#822), so neither holds a copy of the other's.
 */
export const counted = (count: unknown) => ({
  success: true,
  errors: [],
  messages: [],
  result: [{ success: true, meta: {}, results: [{ 'count(*)': count }] }],
});

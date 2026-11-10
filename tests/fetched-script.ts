/**
 * A `<script>` that fetches a file, as opposed to one carried inline. Read by
 * the production smoke against served HTML (`tests/prod/prod-smoke.spec.ts`),
 * and here, on its own, so `tests/unit/fetched-script.test.ts` can show it
 * catches every way such a script can be written (#390 F51).
 */
export const FETCHED_SCRIPT = /<script\b[^>]*\ssrc\s*=/i;

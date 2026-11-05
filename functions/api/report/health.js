/**
 * GET /api/report/health — proves the REPORTS binding and the migration
 * without writing a row (#97, spec 6.2). 200 {"ok":true} or 503 {"ok":false}.
 *
 * Plumbing only, like `index.js`: the handler answers any other method with
 * 405 itself, where a unit test can see it. Behind the dev Basic Auth gate
 * like every other path; on prod, private (#782): the middleware answers 403
 * unless Cloudflare Access signed the request (`functions/_lib/access.js`).
 */
import { reportHealth } from '../../../src/lib/report';

/** @param {{ request: Request, env: import('../../../src/lib/report').ReportEnv }} context */
export const onRequest = ({ request, env }) => reportHealth(request, env);

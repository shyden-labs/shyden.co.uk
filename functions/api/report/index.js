/**
 * POST /api/report — a translation report from the footer form (#97).
 *
 * Plumbing only, like `_middleware.js`: every check lives in
 * `src/lib/report.ts`, unit-tested with real Request objects. Any method
 * reaches it, so the handler itself answers 405 with `Allow: POST`.
 *
 * ESM is required: wrangler ships ZERO Functions for a file using CommonJS.
 */
import { handleReport } from '../../../src/lib/report';

/** @param {{ request: Request, env: import('../../../src/lib/report').ReportEnv }} context */
export const onRequest = ({ request, env }) => handleReport(request, env);

/**
 * `/go/<project>` (#1192): the one-use dev pass. Every non-prod host reaches
 * this only through the Basic Auth gate in `functions/_middleware.js`; the
 * prod hostname answers 404 here. The logic is `goResponse` in
 * `_lib/dev-pass.js`; this file hands it the real clock and randomness.
 */
import { goResponse } from '../_lib/dev-pass.js';

/** @param {{ request: Request, env: Record<string, string | undefined> }} context */
export const onRequest = ({ request, env }) =>
  goResponse(new URL(request.url), env, {
    nowMs: Date.now(),
    randomBytes: (n) => crypto.getRandomValues(new Uint8Array(n)),
  });

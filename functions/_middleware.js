/**
 * Cloudflare Pages middleware — runs on every request to a shyden.co.uk
 * Pages deployment.
 *
 * On the PROD hostname it is a no-op (`next()`). On every NON-prod
 * hostname (dev.shyden.co.uk, *.pages.dev preview, etc.) it:
 *   1. Serves `/robots.txt` with `Disallow: /` BEFORE the auth gate, so
 *      crawlers (which never send Authorization) see the block rather
 *      than a 401.
 *   2. Gates every other request behind HTTP Basic Auth — the shared
 *      password is `env.DEV_PASSWORD` (Cloudflare Pages → Settings →
 *      Variables and Secrets). Unset ⇒ fails closed (always challenges).
 *   3. Injects `X-Robots-Tag: noindex, nofollow, noarchive` on the
 *      authorised response so the dev deploy never lands in search.
 *
 * Pure logic lives in `_lib/lockdown.js` so it is unit-testable from
 * Vitest without workerd / miniflare. This file is just the plumbing.
 *
 * ESM is required: Cloudflare Pages' wrangler silently ships ZERO
 * Functions for a file using CommonJS `exports.onRequest` (logs
 * "No routes found when building Functions directory - skipping").
 */
import {
  isProdHostname,
  wwwRedirectLocation,
  blockingRobotsBody,
  noIndexHeaderValue,
  basicAuthOk,
  basicAuthChallenge,
} from './_lib/lockdown.js';
import { accessOk, privatePath } from './_lib/access.js';

/**
 * @param {{ request: Request, env: Record<string, string | undefined>, next: () => Promise<Response> }} context
 */
export const onRequest = async ({ request, env, next }) => {
  const url = new URL(request.url);
  const hostname = url.hostname;

  // Canonical host: www.shyden.co.uk → apex, 301, BEFORE the auth gate so the
  // redirect is public (www is not the prod host, so it would otherwise be
  // Basic-auth challenged on the prod project).
  const wwwTarget = wwwRedirectLocation(url);
  if (wwwTarget) {
    return new Response(null, {
      status: 301,
      headers: { Location: wwwTarget },
    });
  }

  // Prod passes through, but for its private paths: those need a Cloudflare
  // Access sign-in, checked here as well as at the edge (#781). Dev keeps its
  // own gate below for every path.
  if (isProdHostname(hostname)) {
    if (privatePath(url.pathname) && !(await accessOk(request, env)))
      return new Response(null, {
        status: 403,
        headers: { 'Cache-Control': 'no-store' },
      });
    return next();
  }

  // /robots.txt intercepted BEFORE the auth gate so a crawler sees the
  // Disallow directive instead of a 401 (which it might read as a
  // transient outage rather than a permanent block).
  if (url.pathname === '/robots.txt') {
    return new Response(blockingRobotsBody(), {
      status: 200,
      headers: {
        'Content-Type': 'text/plain; charset=utf-8',
        'X-Robots-Tag': noIndexHeaderValue(),
        'Cache-Control': 'public, max-age=300',
      },
    });
  }

  // Auth gate — fails closed when DEV_PASSWORD is unset.
  const auth = request.headers.get('Authorization');
  if (!basicAuthOk(auth, env.DEV_PASSWORD)) {
    return basicAuthChallenge();
  }

  // Authorised → fetch the asset, then graft the noindex header on.
  // response.body is a single-consumption stream; clone() defends
  // against any future handler reading it first (.text()/.json()).
  const response = await next();
  const cloned = response.clone();
  const newHeaders = new Headers(cloned.headers);
  newHeaders.set('X-Robots-Tag', noIndexHeaderValue());
  return new Response(cloned.body, {
    status: cloned.status,
    statusText: cloned.statusText,
    headers: newHeaders,
  });
};

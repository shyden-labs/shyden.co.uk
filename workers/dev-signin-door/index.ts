// The `dev-signin.shyden.co.uk` door (#1262 AC1, shyden-labs/repo-template#207). Cloudflare
// Access stands in front of this host; the door only forwards to the sign-in Worker's
// workers.dev address with the door secret, which Indonesia's visitors could not open directly.
import { DOOR_SECRET_HEADER } from '../dev-signin/config.ts';

export interface DoorEnv {
  /** The sign-in Worker's workers.dev origin. */
  readonly SIGNIN_URL: string;
  /** Secret: the same value as the sign-in Worker's `DOOR_SECRET`. */
  readonly DOOR_SECRET: string;
}

export async function forwardToSignin(
  request: Request,
  env: DoorEnv,
  forward: (request: Request) => Promise<Response>,
): Promise<Response> {
  const incoming = new URL(request.url);
  // Built on the fixed origin, never resolved against it: a path such as `//evil.example/x`
  // would resolve to another host and carry the door secret there.
  const target = new URL(env.SIGNIN_URL);
  target.pathname = incoming.pathname;
  target.search = incoming.search;
  const headers = new Headers(request.headers);
  headers.set(DOOR_SECRET_HEADER, env.DOOR_SECRET);
  // `duplex` is how a streamed body is forwarded; the DOM's RequestInit type does not name it yet.
  const init = {
    method: request.method,
    headers,
    body: request.body,
    redirect: 'manual',
    duplex: 'half',
  } as RequestInit;
  return forward(new Request(target, init));
}

export default {
  fetch: (request: Request, env: DoorEnv) =>
    forwardToSignin(request, env, (forwarded) => fetch(forwarded)),
};

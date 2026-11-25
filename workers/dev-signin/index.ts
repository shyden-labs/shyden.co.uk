// The DEV sign-in Worker's entry (#1262 AC1): env wiring, the Access certs cache and the
// clock around shyden-labs/repo-template#207's `handleSignin`. It runs on workers.dev in
// the TEST+DEV account and is reached only through the `dev-signin.shyden.co.uk` door.
import {
  handleSignin,
  type AccessCert,
  type CodeStore,
} from '../../scripts/dev-pass/signin.ts';
import type { SigningKey } from '../../scripts/dev-pass/pass.ts';
import { DOOR_SECRET_HEADER, HOSTS } from './config.ts';

export interface SigninEnv {
  /** Secret: the value the door adds in `DOOR_SECRET_HEADER`. */
  readonly DOOR_SECRET: string;
  /** Secret: the Ed25519 private key as a JWK. It lives here and nowhere else. */
  readonly DEV_PASS_PRIVATE_JWK: string;
  readonly DEV_PASS_KID: string;
  /** `https://<team>.cloudflareaccess.com`. */
  readonly ACCESS_TEAM_DOMAIN: string;
  /** The Access application's AUD tag. */
  readonly ACCESS_AUD: string;
  /** KV: the apps' one-time codes. */
  readonly CODES: CodeStore;
}

export interface SigninDeps {
  readonly fetch: (url: string) => Promise<Response>;
  readonly nowSeconds: () => number;
}

/** How long Access's certs are kept before they are read again. */
export const CERTS_TTL_SECONDS = 600;

export function createSignin(deps: SigninDeps) {
  let certs:
    | { readonly keys: readonly AccessCert[]; readonly readAt: number }
    | undefined;
  let signing:
    | { readonly jwk: string; readonly kid: string; readonly key: SigningKey }
    | undefined;

  async function fetchCerts(env: SigninEnv): Promise<readonly AccessCert[]> {
    const now = deps.nowSeconds();
    if (certs && now - certs.readAt < CERTS_TTL_SECONDS) return certs.keys;
    const answer = await deps.fetch(
      `${env.ACCESS_TEAM_DOMAIN}/cdn-cgi/access/certs`,
    );
    if (!answer.ok) throw new Error(`Access certs answered ${answer.status}`);
    const { keys } = (await answer.json()) as { keys: readonly AccessCert[] };
    certs = { keys, readAt: now };
    return keys;
  }

  async function signingKey(env: SigninEnv): Promise<SigningKey> {
    if (
      signing?.jwk === env.DEV_PASS_PRIVATE_JWK &&
      signing.kid === env.DEV_PASS_KID
    )
      return signing.key;
    const privateKey = await crypto.subtle.importKey(
      'jwk',
      JSON.parse(env.DEV_PASS_PRIVATE_JWK) as JsonWebKey,
      { name: 'Ed25519' },
      false,
      ['sign'],
    );
    const key: SigningKey = {
      kid: env.DEV_PASS_KID,
      privateKey,
    };
    signing = { jwk: env.DEV_PASS_PRIVATE_JWK, kid: env.DEV_PASS_KID, key };
    return key;
  }

  return {
    async fetch(request: Request, env: SigninEnv): Promise<Response> {
      return handleSignin(request, {
        secretHeader: DOOR_SECRET_HEADER,
        secret: env.DOOR_SECRET,
        issuer: env.ACCESS_TEAM_DOMAIN,
        audience: env.ACCESS_AUD,
        fetchCerts: () => fetchCerts(env),
        hosts: HOSTS,
        signing: await signingKey(env),
        codes: env.CODES,
        now: deps.nowSeconds(),
      });
    },
  };
}

export default createSignin({
  fetch: (url) => fetch(url),
  nowSeconds: () => Math.floor(Date.now() / 1000),
});

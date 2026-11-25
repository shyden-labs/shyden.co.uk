/**
 * The one-use dev pass (#1192): `dev.shyden.co.uk/go/<project>` sends the
 * browser to that project's dev site with a 60-second pass, so a link from
 * this dev site opens it without typing its dev password.
 *
 * The token format was agreed with yawelo-idle-63 and shytalk-a2 on
 * 2026-11-17: `base64url(payload) + "." + base64url(HMAC-SHA256(secret,
 * base64url(payload)))`, the payload JSON `{"v":1,"host":<target dev host>,
 * "exp":<unix seconds, mint + 60>,"nonce":<16 random bytes, base64url>}`.
 * Each target verifies it and allows one use; that is the target's work.
 *
 * Pure, with the clock and the random bytes passed in, so it is unit-tested
 * from Vitest without workerd (tests/unit/dev-pass.test.ts).
 */
import { isProdHostname } from './lockdown.js';

/** Seconds a pass lives after it is minted. */
export const DEV_PASS_LIFETIME_S = 60;

/** Bytes of randomness in each pass's nonce. */
const NONCE_BYTES = 16;

/**
 * The projects a pass can be minted for: each one's dev host and the name
 * of the dev Pages project's secret it is signed with. Shyden sets the same
 * value as `DEV_PASS_SECRET` on the target.
 */
export const DEV_PASS_TARGETS = {
  yawelo: { host: 'dev.yaweloidle.com', secret: 'DEV_PASS_SECRET_YAWELO' },
  shytalk: { host: 'dev.shytalk.app', secret: 'DEV_PASS_SECRET_SHYTALK' },
};

/** @param {Uint8Array} bytes */
function base64url(bytes) {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary)
    .replaceAll('+', '-')
    .replaceAll('/', '_')
    .replace(/=+$/, '');
}

/**
 * A signed pass for `host`.
 *
 * @param {{ secret: string, host: string, nowMs: number,
 *   randomBytes: (n: number) => Uint8Array }} options
 * @returns {Promise<string>}
 */
export async function mintDevPass({ secret, host, nowMs, randomBytes }) {
  const encoder = new TextEncoder();
  const payload = base64url(
    encoder.encode(
      JSON.stringify({
        v: 1,
        host,
        exp: Math.floor(nowMs / 1000) + DEV_PASS_LIFETIME_S,
        nonce: base64url(randomBytes(NONCE_BYTES)),
      }),
    ),
  );
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const signature = await crypto.subtle.sign(
    'HMAC',
    key,
    encoder.encode(payload),
  );
  return `${payload}.${base64url(new Uint8Array(signature))}`;
}

const notFound = () =>
  new Response('Not found', {
    status: 404,
    headers: { 'Content-Type': 'text/plain; charset=utf-8' },
  });

/**
 * The answer to a request for `/go/<project>`. Production never mints: the
 * prod hostname answers 404. An unknown project, or any other path, answers
 * 404. A project whose secret is missing or empty fails closed with a 503
 * that names the variable, never its value, and never redirects unsigned.
 *
 * @param {URL} url
 * @param {Record<string, string | undefined>} env
 * @param {{ nowMs: number, randomBytes: (n: number) => Uint8Array }} source
 * @returns {Promise<Response>}
 */
export async function goResponse(url, env, { nowMs, randomBytes }) {
  if (isProdHostname(url.hostname)) return notFound();
  const project = /^\/go\/([a-z]+)\/?$/.exec(url.pathname)?.[1];
  if (project === undefined || !Object.hasOwn(DEV_PASS_TARGETS, project))
    return notFound();
  const target =
    DEV_PASS_TARGETS[/** @type {keyof typeof DEV_PASS_TARGETS} */ (project)];
  const secret = env[target.secret];
  if (!secret)
    return new Response(
      `The dev pass for ${project} is not configured: ${target.secret} is not set on this deployment.`,
      {
        status: 503,
        headers: {
          'Content-Type': 'text/plain; charset=utf-8',
          'Cache-Control': 'no-store',
        },
      },
    );
  const token = await mintDevPass({
    secret,
    host: target.host,
    nowMs,
    randomBytes,
  });
  const location = new URL(`https://${target.host}/`);
  location.searchParams.set('dev_pass', token);
  return new Response(null, {
    status: 302,
    headers: {
      Location: location.href,
      'Cache-Control': 'no-store',
      'Referrer-Policy': 'no-referrer',
    },
  });
}

/**
 * The Pages Function behind `functions/go/yawelo.js` and
 * `functions/go/shytalk.js`: `goResponse` with the real clock and the real
 * randomness. One file per project, because tracked paths are plain names
 * (no `[project].js`); a project with no file answers Pages' own 404.
 *
 * @param {{ request: Request, env: Record<string, string | undefined> }} context
 */
export const onGoRequest = ({ request, env }) =>
  goResponse(new URL(request.url), env, {
    nowMs: Date.now(),
    randomBytes: (n) => crypto.getRandomValues(new Uint8Array(n)),
  });

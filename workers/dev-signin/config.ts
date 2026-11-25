// The DEV sign-in Worker's host map (#1262 AC1, shyden-labs/repo-template#207). A pass is
// minted only for a host listed here, and an app is sent back only to its own links.
// A product joins by adding its `dev.` hosts; the map has no other way in.

/** The header the `dev-signin.shyden.co.uk` door adds, carrying the door secret. */
export const DOOR_SECRET_HEADER = 'X-Dev-Signin-Door';

/** ShyDesk's dev API and staff pages (its dev Worker on workers.dev, no routes). */
const SHYDESK_DEV_HOST = 'shydesk.shydesk-non-prod.workers.dev';

export const HOSTS: Readonly<
  Record<string, { readonly appRedirects: readonly string[] }>
> = {
  'dev.shyden.co.uk': { appRedirects: [] },
  // Yawelo Idle (yawelo-idle#1078): no app links yet.
  'dev.yaweloidle.com': { appRedirects: [] },
  'dev-api.yaweloidle.com': { appRedirects: [] },
  'dev-holding.yaweloidle.com': { appRedirects: [] },
  // ShyDesk's dev staff pages (desk and admin) and its demo page (#1263).
  [SHYDESK_DEV_HOST]: { appRedirects: [] },
};

/**
 * The sign-in's own public keys by `kid`, which check the doors' passes before an
 * embed swap (every door pass is signed here). Public, so committed; read back from
 * the deployed sign-in, 2026-11-25 (docs/dev-signin.md). A new key is added before use.
 */
export const PUBLIC_KEYS: Readonly<Record<string, string>> = {
  '2026-11': 'OBLprb_S4Kn2C--HFVaeA3_s6gEsApDiRAWPLc6WsK8',
};

/**
 * Cross-site embeds (shyden-labs/repo-template#209): each door whose pass may be
 * swapped for a 5-minute embed pass, and the API hosts it may get one for (#1263).
 */
export const EMBED_AUDIENCES: Readonly<Record<string, readonly string[]>> = {
  'dev.yaweloidle.com': [SHYDESK_DEV_HOST],
  'dev.shytalk.app': [SHYDESK_DEV_HOST],
  'dev.shyden.co.uk': [SHYDESK_DEV_HOST],
};

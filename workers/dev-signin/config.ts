// The DEV sign-in Worker's host map (#1262 AC1, shyden-labs/repo-template#207). A pass is
// minted only for a host listed here, and an app is sent back only to its own links.
// A product joins by adding its `dev.` hosts; the map has no other way in.

/** The header the `dev-signin.shyden.co.uk` door adds, carrying the door secret. */
export const DOOR_SECRET_HEADER = 'X-Dev-Signin-Door';

export const HOSTS: Readonly<
  Record<string, { readonly appRedirects: readonly string[] }>
> = {
  'dev.shyden.co.uk': { appRedirects: [] },
  // Yawelo Idle (yawelo-idle#1078): no app links yet.
  'dev.yaweloidle.com': { appRedirects: [] },
  'dev-api.yaweloidle.com': { appRedirects: [] },
  'dev-holding.yaweloidle.com': { appRedirects: [] },
};

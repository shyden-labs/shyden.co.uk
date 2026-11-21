/**
 * Where the support page finds ShyDesk (#1032).
 *
 * The page embeds ShyDesk's shared support piece, which talks to the host it
 * was loaded from (Shyden's ruling, 2026-11-20: embed only, no forward). The
 * host is picked when the site is built, like the ShyTalk and Yawelo Idle
 * links: live ShyDesk unless `PUBLIC_SHYDESK_URL` names another, which the dev
 * build sets to ShyDesk's Non-Prod host.
 */

/** Live ShyDesk, the default for every build that names no other host. */
export const SHYDESK_LIVE = 'https://shydesk.dpdns.org';

/** This site's product in ShyDesk. */
export const SHYDESK_PRODUCT = 'shyden-co-uk';

/**
 * The ShyDesk origin a build loads the embed from.
 *
 * @param configured `PUBLIC_SHYDESK_URL` as the build saw it
 * @throws when the value is not an https address
 */
export function shydeskOrigin(configured: string | undefined): string {
  if (!configured) return SHYDESK_LIVE;
  const url = new URL(configured);
  if (url.protocol !== 'https:')
    throw new Error(
      `PUBLIC_SHYDESK_URL must be an https address, not ${url.protocol}`,
    );
  return url.origin;
}

/** The embed script on that origin. */
export const embedScriptUrl = (origin: string): string => `${origin}/embed.js`;

/**
 * The old Yawelo Idle hosts, moved for good to yaweloidle.com
 * (yawelo-idle#1013; shyden-labs/shyden.co.uk#1191 AC3, approved by Shyden
 * 2026-11-18). Each old host answers 301 to the same path and query on its
 * new host. Deployed by hand: `npx wrangler deploy` from this folder.
 */

/** Old host → its new origin. @type {Readonly<Record<string, string>>} */
export const MOVES = {
  'yawelo-idle.shyden.co.uk': 'https://yaweloidle.com',
  'dev.yawelo-idle.shyden.co.uk': 'https://dev.yaweloidle.com',
};

/**
 * The address `url` moved to, or null when its host is not one this Worker
 * moves.
 * @param {string} url
 * @returns {string | null}
 */
export function redirectFor(url) {
  const { hostname, pathname, search } = new URL(url);
  const origin = Object.hasOwn(MOVES, hostname) ? MOVES[hostname] : undefined;
  return origin === undefined ? null : `${origin}${pathname}${search}`;
}

export default {
  /** @param {Request} request */
  async fetch(request) {
    const location = redirectFor(request.url);
    if (location === null) return new Response('Not found', { status: 404 });
    return new Response(null, { status: 301, headers: { location } });
  },
};

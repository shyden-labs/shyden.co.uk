// dev.shyden.co.uk's door (#1262 AC2, shyden-labs/repo-template#207): every non-prod
// host of this site is served only to a valid DEV pass. The rules are the shared
// `handleDevDoor`; this file holds this door's own values and wires it to Pages.
import { handleDevDoor } from '../../scripts/dev-pass/door.ts';
import type { PublicKeys } from '../../scripts/dev-pass/pass.ts';

/** The door every pass for this site names as `aud`, on the dev host and its preview aliases alike. */
export const DEV_DOOR_HOST = 'dev.shyden.co.uk';

/**
 * The sign-in Worker's public keys by `kid` (read back from the deployed sign-in,
 * 2026-11-25). Public, so committed; a new key is added here before the sign-in uses it.
 */
export const DEV_PASS_KEYS: PublicKeys = {
  '2026-11': 'OBLprb_S4Kn2C--HFVaeA3_s6gEsApDiRAWPLc6WsK8',
};

/**
 * The keys the gate trusts: the live ones, unless the `DEV_PASS_KEYS` setting names
 * others as a JSON object of `kid` to key (Shyden's ruling, 2026-11-25: the local
 * functions suite sets a throwaway test key). A setting that is not such an object
 * trusts nothing, so the gate fails closed.
 */
export function passKeys(setting: string | undefined): PublicKeys {
  if (setting === undefined) return DEV_PASS_KEYS;
  let parsed: unknown;
  try {
    parsed = JSON.parse(setting);
  } catch {
    return {};
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed))
    return {};
  const entries = Object.entries(parsed);
  return entries.every(([, key]) => typeof key === 'string')
    ? (Object.fromEntries(entries) as PublicKeys)
    : {};
}

/**
 * The shared door adds a secret for a separate origin. Here the origin is this same
 * Pages Function's `next()`, which nothing outside can reach, so the header only
 * records that the door ran.
 */
const CHECKED_HEADER = 'X-Dev-Door-Checked';

export function devGate(
  request: Request,
  keys: PublicKeys,
  next: (request: Request) => Promise<Response>,
): Promise<Response> {
  return handleDevDoor(
    request,
    {
      host: DEV_DOOR_HOST,
      keys,
      secretHeader: CHECKED_HEADER,
      secret: '1',
      now: Math.floor(Date.now() / 1000),
    },
    next,
  );
}

/**
 * The report form's daily limits (#872): whether they apply, how big they
 * are, and the counter a report is counted under. Pure and site-safe: no
 * Node API, so workerd and the unit suite run the same code.
 *
 * Shyden ruled 2026-10-19: Cloudflare variables per environment, off on
 * every non-production host unless switched on, always on in production;
 * IPv6 counted by its /64, because one line is usually given a whole /64.
 */
import { isProdHostname } from '../../functions/_lib/lockdown.js';

export const DEFAULT_LIMITS = { total: 50, connection: 5 } as const;
export const SECRET_MIN_LENGTH = 32;
const MAX_LIMIT = 1_000_000;

export interface ReportLimits {
  readonly total: number;
  readonly connection: number;
}

export type LimitsSetting =
  | { readonly kind: 'off' }
  | { readonly kind: 'on'; readonly limits: ReportLimits }
  | { readonly kind: 'invalid' };

export interface LimitsEnv {
  readonly REPORT_LIMITS?: string;
  readonly REPORT_LIMIT_TOTAL?: string;
  readonly REPORT_LIMIT_CONNECTION?: string;
}

/** A whole number from 1 to MAX_LIMIT, the default when unset or empty, or null. */
function limit(value: string | undefined, fallback: number): number | null {
  const text = (value ?? '').trim();
  if (text === '') return fallback;
  if (!/^[1-9]\d*$/.test(text)) return null;
  const parsed = Number(text);
  return parsed <= MAX_LIMIT ? parsed : null;
}

export function limitsSetting(env: LimitsEnv, hostname: string): LimitsSetting {
  const total = limit(env.REPORT_LIMIT_TOTAL, DEFAULT_LIMITS.total);
  const connection = limit(
    env.REPORT_LIMIT_CONNECTION,
    DEFAULT_LIMITS.connection,
  );
  if (total === null || connection === null) return { kind: 'invalid' };
  const on = { kind: 'on', limits: { total, connection } } as const;
  if (isProdHostname(hostname)) return on;
  const switched = (env.REPORT_LIMITS ?? '').trim().toLowerCase();
  if (switched === '' || switched === 'off') return { kind: 'off' };
  return switched === 'on' ? on : { kind: 'invalid' };
}

const IPV4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/;
const MAPPED = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/i;
const GROUP = /^[0-9a-f]{1,4}$/;

/**
 * What one connection holds (AC10): an IPv4 address whole, an IPv6
 * address's /64 block. Null for anything that is not an address, so a
 * garbled header is refused rather than counted under a shared key.
 */
export function connectionOf(address: string | null): string | null {
  if (address === null) return null;
  const four = IPV4.exec(address);
  if (four) {
    const octets = four.slice(1).map(Number);
    return octets.every((octet) => octet <= 255) ? octets.join('.') : null;
  }
  const mapped = MAPPED.exec(address);
  if (mapped) return connectionOf(mapped[1]!);
  const halves = address.toLowerCase().split('::');
  if (halves.length > 2) return null;
  const groups = (text: string) => (text === '' ? [] : text.split(':'));
  const head = groups(halves[0]!);
  const tail = halves.length === 2 ? groups(halves[1]!) : [];
  const missing = 8 - head.length - tail.length;
  if (halves.length === 2 ? missing < 1 : missing !== 0) return null;
  const full = [
    ...head,
    ...Array<string>(halves.length === 2 ? missing : 0).fill('0'),
    ...tail,
  ];
  if (!full.every((group) => GROUP.test(group))) return null;
  return `${full
    .slice(0, 4)
    .map((group) => group.padStart(4, '0'))
    .join(':')}::/64`;
}

const hex = (bytes: ArrayBuffer): string =>
  [...new Uint8Array(bytes)]
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');

/**
 * HMAC-SHA-256(secret, `day connection`) as hex (AC3). The day is inside the
 * message, so one connection's key differs every day and two days cannot be
 * linked; without the secret no key leads back to an address.
 */
export async function counterKey(
  secret: string,
  day: string,
  connection: string,
): Promise<string> {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  return hex(
    await crypto.subtle.sign(
      'HMAC',
      key,
      encoder.encode(`${day} ${connection}`),
    ),
  );
}

export const utcDay = (at: Date): string => at.toISOString().slice(0, 10);

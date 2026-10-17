/**
 * Real requests to the report endpoint and its health check (#302, spec 10),
 * shared by the unit suite and the logs suite (#822), so neither holds a copy
 * of the other's builders.
 */
import { getSiteStrings } from '../src/lib/i18n';

export const ORIGIN = 'https://dev.shyden.co.uk';
export const ENDPOINT = `${ORIGIN}/api/report`;
export const HEALTH = `${ORIGIN}/api/report/health`;
export const FORM = 'application/x-www-form-urlencoded';
export const quote = getSiteStrings('vi').report.open;
export const NO_DB = {};

export type Fields = Record<string, string>;
export const valid = (extra: Fields = {}): Fields => ({
  locale: 'vi',
  page: 'home',
  quote,
  suggestion: '',
  note: '',
  website: '',
  ...extra,
});

export function post(
  fields: Fields | string,
  init: {
    headers?: Record<string, string>;
    json?: boolean;
    method?: string;
  } = {},
) {
  const body =
    typeof fields === 'string'
      ? fields
      : new URLSearchParams(fields).toString();
  return new Request(ENDPOINT, {
    method: init.method ?? 'POST',
    headers: {
      Origin: ORIGIN,
      'Content-Type': FORM,
      ...(init.json ? { Accept: 'application/json' } : {}),
      ...init.headers,
    },
    body: init.method && init.method !== 'POST' ? undefined : body,
  });
}

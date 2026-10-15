import { describe, expect, it } from 'vitest';
import { handleReport, PAGE_IDS } from '../../src/lib/report';
import { LOCALES, isBetaLocale, getSiteStrings } from '../../src/lib/i18n';
import {
  loadSpec,
  checkResponse,
  documentedStatuses,
  formEnum,
} from '../openapi-contract';

/**
 * #781. `openapi/report.yaml` is the report form's contract: every case the
 * handler answers is driven in-process and its status, headers and body are
 * checked against the spec, and the spec's enums against the code's own
 * lists. No network, no database: the cases that need a write run with the
 * REPORTS binding absent, which the handler answers as `failed`.
 */

const SPEC = loadSpec('openapi/report.yaml');
const PATH = '/api/report';
const ORIGIN = 'https://dev.shyden.co.uk';
const FORM = 'application/x-www-form-urlencoded';
const JSON_MODE = { Accept: 'application/json' };
const quote = getSiteStrings('vi').report.open;
const valid = {
  locale: 'vi',
  page: 'home',
  quote,
  suggestion: '',
  note: '',
  website: '',
};

const post = (
  body: string,
  headers: Record<string, string> = {},
  method = 'POST',
) =>
  new Request(`${ORIGIN}${PATH}`, {
    method,
    headers: { Origin: ORIGIN, 'Content-Type': FORM, ...headers },
    body: method === 'POST' ? body : undefined,
  });
const form = (extra: Record<string, string> = {}) =>
  new URLSearchParams({ ...valid, ...extra }).toString();

/** One row per documented case; each row is its own test. */
const CASES: readonly (readonly [string, () => Request, string])[] = [
  ['405 for GET', () => post('', {}, 'GET'), '405'],
  [
    '403 for a foreign Origin',
    () => post(form(), { Origin: 'https://elsewhere.example' }),
    '403',
  ],
  [
    '415 for a JSON body',
    () => post('{}', { 'Content-Type': 'application/json' }),
    '415',
  ],
  [
    '413 for a body over 65536 bytes',
    () => post(form({ note: 'a'.repeat(65536) })),
    '413',
  ],
  [
    '400 with no body for an unknown page (form mode)',
    () => post(form({ page: 'nope' })),
    '400',
  ],
  [
    '400 rejected for an unknown page (JSON mode)',
    () => post(form({ page: 'nope' }), JSON_MODE),
    '400',
  ],
  [
    '303 sent for the honeypot (form mode)',
    () => post(form({ website: 'x' })),
    '303',
  ],
  [
    '200 sent for the honeypot (JSON mode)',
    () => post(form({ website: 'x' }), JSON_MODE),
    '200',
  ],
  [
    '422 not-found for a quote the page does not say (JSON mode)',
    () => post(form({ quote: 'zzz nowhere on the page' }), JSON_MODE),
    '422',
  ],
  [
    '503 failed with no database (JSON mode)',
    () => post(form(), JSON_MODE),
    '503',
  ],
];

describe('POST /api/report answers as openapi/report.yaml says', () => {
  it.each(CASES)('%s', async (_, request, status) => {
    const response = await handleReport(request(), {}, () => {});
    expect(String(response.status)).toBe(status);
    expect(await checkResponse(SPEC, PATH, 'post', response)).toEqual([]);
  });
});

describe('the spec covers what the code can answer', () => {
  it('lists every status the cases produce, and no other', () => {
    expect(documentedStatuses(SPEC, PATH, 'post').sort()).toEqual(
      [...new Set(CASES.map(([, , status]) => status))].sort(),
    );
  });

  it('enumerates the page ids the code accepts', () => {
    expect(formEnum(SPEC, PATH, 'page')).toEqual([...PAGE_IDS]);
  });

  it('enumerates the beta locales the code accepts', () => {
    expect(formEnum(SPEC, PATH, 'locale')).toEqual(
      LOCALES.filter(isBetaLocale),
    );
  });
});

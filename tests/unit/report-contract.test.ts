import { describe, expect, it } from 'vitest';
import {
  handleReport,
  reportHealth,
  PAGE_IDS,
  REPORT_COLUMNS,
} from '../../src/lib/report';
import { tableWith } from '../report-fakes';
import { LOCALES, isBetaLocale, getSiteStrings } from '../../src/lib/i18n';
import { floorBreach } from '../floors';
import { searched } from '../source-files';
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

/**
 * Each case's recorded floor, spelled once here so the floor reader can find
 * it (literal-floors.test.ts); a case with no entry fails its own test.
 */
const FLOOR_OF: Readonly<Record<string, string>> = {
  '405 for GET': 'report-contract/405-for-get',
  '403 for a foreign Origin': 'report-contract/403-for-a-foreign-origin',
  '415 for a JSON body': 'report-contract/415-for-a-json-body',
  '413 for a body over 65536 bytes':
    'report-contract/413-for-a-body-over-65536-bytes',
  '400 with no body for an unknown page (form mode)':
    'report-contract/400-with-no-body-for-an-unknown-page-form-mode',
  '400 rejected for an unknown page (JSON mode)':
    'report-contract/400-rejected-for-an-unknown-page-json-mode',
  '303 sent for the honeypot (form mode)':
    'report-contract/303-sent-for-the-honeypot-form-mode',
  '200 sent for the honeypot (JSON mode)':
    'report-contract/200-sent-for-the-honeypot-json-mode',
  '422 not-found for a quote the page does not say (JSON mode)':
    'report-contract/422-not-found-for-a-quote-the-page-does-not-say-json-mode',
  '503 failed with no database (JSON mode)':
    'report-contract/503-failed-with-no-database-json-mode',
  '200 ok:true for the migrated table':
    'report-contract/health-200-ok-true-for-the-migrated-table',
  '503 ok:false with no database':
    'report-contract/health-503-ok-false-with-no-database',
  '405 for POST': 'report-contract/health-405-for-post',
};

/** The floor id of a case, or a failure naming the case that has none. */
const floorOf = (name: string): string => {
  const id = FLOOR_OF[name];
  if (!id) throw new Error(`${name} has no floor in FLOOR_OF`);
  return id;
};

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
  it.each(CASES)('%s', async (name, request, status) => {
    const response = await handleReport(request(), {}, () => {});
    expect(String(response.status)).toBe(status);
    const { findings, checked } = await checkResponse(
      SPEC,
      PATH,
      'post',
      response,
    );
    expect(
      searched(findings, { of: checked, what: `${name}: points checked` }),
    ).toEqual([]);
    expect(floorBreach(floorOf(name), checked.length)).toBeUndefined();
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

const HEALTH_SPEC = loadSpec('openapi/report-health.yaml');
const HEALTH = '/api/report/health';

const HEALTH_CASES: readonly (readonly [
  string,
  () => Promise<Response>,
  string,
])[] = [
  [
    '200 ok:true for the migrated table',
    () =>
      reportHealth(
        new Request(`${ORIGIN}${HEALTH}`),
        { REPORTS: tableWith(REPORT_COLUMNS) },
        () => {},
      ),
    '200',
  ],
  [
    '503 ok:false with no database',
    () => reportHealth(new Request(`${ORIGIN}${HEALTH}`), {}, () => {}),
    '503',
  ],
  [
    '405 for POST',
    () =>
      reportHealth(
        new Request(`${ORIGIN}${HEALTH}`, { method: 'POST' }),
        {},
        () => {},
      ),
    '405',
  ],
];

describe('GET /api/report/health answers as openapi/report-health.yaml says', () => {
  it.each(HEALTH_CASES)('%s', async (name, answer, status) => {
    const response = await answer();
    expect(String(response.status)).toBe(status);
    const { findings, checked } = await checkResponse(
      HEALTH_SPEC,
      HEALTH,
      'get',
      response,
    );
    expect(
      searched(findings, { of: checked, what: `${name}: points checked` }),
    ).toEqual([]);
    expect(floorBreach(floorOf(name), checked.length)).toBeUndefined();
  });

  it('lists every status the cases produce, and no other', () => {
    expect(documentedStatuses(HEALTH_SPEC, HEALTH, 'get').sort()).toEqual(
      [...new Set(HEALTH_CASES.map(([, , status]) => status))].sort(),
    );
  });
});

/**
 * The rows and catalogues the review tests read (#348), shared by the unit
 * suite's stand-ins and the logs suite's real cases (#822), so neither holds
 * a copy of the other's fixtures.
 */
import {
  reportRows,
  type Catalogues,
  type ReportRow,
} from '../src/lib/report-review';

export const ESC = String.fromCharCode(92);
/** LibreTranslate's `GET /languages`, for the locales these tests send. */
export const LANGUAGES = [
  { code: 'en', targets: ['vi', 'th'] },
  { code: 'vi', targets: ['en'] },
  { code: 'th', targets: ['en'] },
];
export const BELL = String.fromCharCode(7);
export const RLO = String.fromCharCode(0x202e);

/** A row as wrangler prints it: every column a string, `keys` JSON-encoded. */
export const stored = (overrides: Record<string, unknown> = {}) => ({
  id: 'a7d1a431-a963-49e4-8b9a-02614a2d3017',
  received_at: '2026-09-26T09:50:40.538Z',
  locale: 'vi',
  page: 'home',
  quote: 'Báo lỗi bản dịch',
  keys: '["site.report.open"]',
  suggestion: '',
  note: '',
  ...overrides,
});

/** wrangler's `--json` answer around some rows, as measured on the dev database. */
export const answer = (results: unknown[]) => [
  { results, success: true, meta: { changes: 0, rows_read: results.length } },
];

export const row = (overrides: Record<string, unknown> = {}): ReportRow =>
  reportRows(answer([stored(overrides)]))[0];

/** Fixture tables: small, and different in every locale that matters here. */
export const fixture: Catalogues = {
  en: {
    strings: { greet: 'Hello', list: ['one', 'two'] },
    site: { nav: { home: 'Home' } },
  },
  id: {
    strings: { greet: 'Halo', list: ['satu', 'dua'] },
    site: { nav: { home: 'Beranda' } },
  },
  zh: {
    strings: { greet: '你好', list: ['一', '二'] },
    site: { nav: { home: '首页' } },
  },
  vi: {
    strings: { greet: 'Xin chào', list: ['một', 'hai'] },
    site: { nav: { home: 'Trang chủ' } },
  },
  th: {
    strings: { greet: 'สวัสดี', list: ['หนึ่ง', 'สอง'] },
    site: { nav: { home: 'หน้าแรก' } },
  },
};

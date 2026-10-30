/**
 * The reports table read back (#348, #822): `npm run reports:review` replays
 * every stored report to the operator, so what it reads, in what order, what
 * it refuses and how it prints what a visitor typed are checks of an audit
 * trail, and run in the logs suite, before every release. The unit suite keeps
 * a stand-in of each (tests/unit/report-review.test.ts).
 */
import { describe, expect, it } from 'vitest';
import { REPORT_COLUMNS } from '../../src/lib/report';
import {
  REVIEW_SELECT,
  escaped,
  reportRows,
  reviewBlock,
  wranglerArgs,
} from '../../src/lib/report-review';
import { searched } from '../source-files';
import {
  BELL,
  ESC,
  answer,
  fixture,
  row,
  stored,
} from '../report-review-shared';

describe('the one command it builds only reads (AC5)', () => {
  it('selects every stored column, oldest first', () => {
    expect(REVIEW_SELECT).toBe(
      `SELECT ${REPORT_COLUMNS.join(', ')} FROM reports ORDER BY received_at, id`,
    );
    expect(REVIEW_SELECT).not.toMatch(
      /;|\b(DELETE|UPDATE|INSERT|DROP|ALTER)\b/i,
    );
  });

  it('is d1 execute, remote, as JSON, with that SELECT and nothing else', () => {
    expect(wranglerArgs('shyden-reports-dev')).toEqual([
      'd1',
      'execute',
      'shyden-reports-dev',
      '--remote',
      '--json',
      '--command',
      REVIEW_SELECT,
    ]);
  });
});

describe('a stored row is checked before it is printed (AC2)', () => {
  it('puts the rows in received order, then by id', () => {
    const rows = reportRows(
      answer([
        stored({ id: 'c', received_at: '2026-09-26T12:00:00.000Z' }),
        stored({ id: 'b', received_at: '2026-09-26T09:00:00.000Z' }),
        stored({ id: 'a', received_at: '2026-09-26T12:00:00.000Z' }),
      ]),
    );
    expect(rows.map(({ id }) => id)).toEqual(['b', 'a', 'c']);
  });

  it('reads an empty table as no reports', () => {
    const statements = answer([]);
    expect(
      searched(reportRows(statements), {
        of: statements,
        what: 'statements in the answer',
      }),
    ).toEqual([]);
  });

  it.each([
    [
      'a failed statement',
      [{ results: [], success: false }],
      /did not succeed/,
    ],
    ['no statement', [], /one statement/],
    ['two statements', [...answer([]), ...answer([])], /one statement/],
    ['not a list', { results: [] }, /one statement/],
    [
      'a missing column',
      answer([{ ...stored(), note: undefined }]),
      /a7d1a431.*note/,
    ],
    [
      'a column that is not text',
      answer([stored({ page: 3 })]),
      /a7d1a431.*page/,
    ],
    [
      'keys that are not JSON',
      answer([stored({ keys: 'site.x' })]),
      /a7d1a431.*keys/,
    ],
    [
      'keys that are not a list of text',
      answer([stored({ keys: '[1]' })]),
      /a7d1a431.*keys/,
    ],
    [
      'a locale the site does not have',
      answer([stored({ locale: 'fr' })]),
      /a7d1a431.*locale "fr"/,
    ],
  ])('refuses %s, naming what is wrong', (_, output, message) => {
    expect(() => reportRows(output)).toThrow(message);
  });
});

describe('the block carries every field (AC2)', () => {
  const block = () =>
    reviewBlock(
      row({ suggestion: 'Báo cáo lỗi dịch', note: 'seen on a phone' }),
      fixture,
      { kind: 'made', text: 'Report a translation error' },
    );

  it('names the report, when, where and in which language', () => {
    const text = block();
    expect(text.split('\n')[0]).toBe(
      '── report a7d1a431-a963-49e4-8b9a-02614a2d3017',
    );
    expect(text).toContain('received    2026-09-26T09:50:40.538Z');
    expect(text).toContain('locale      vi');
    expect(text).toContain('page        home');
    expect(text).toContain('quoted      "Báo lỗi bản dịch"');
  });

  it('gives the suggestion, what it says in English, and the note marked private', () => {
    const text = block();
    expect(text).toContain('suggestion  "Báo cáo lỗi dịch"');
    expect(text).toContain('  in English "Report a translation error"');
    expect(text).toContain('note        "seen on a phone"');
    expect(text).toContain(
      '            private: never copy the note into a public ticket',
    );
  });
});

describe('what a visitor typed prints escaped, never raw (AC6)', () => {
  it('leaves every script the site speaks alone', () => {
    const copy = 'Báo lỗi 报告翻译 รายงานคำแปล Laporkan';
    expect(escaped(copy)).toBe(copy);
  });

  it('escapes the page and an engine failure too, which the row and the engine supply', () => {
    const block = reviewBlock(
      row({ page: `home${BELL}`, suggestion: 'Báo cáo' }),
      fixture,
      {
        kind: 'failed',
        reason: `engine said ${String.fromCharCode(27)}[2J`,
      },
    );
    expect(block).toContain(`page        home${ESC}u{7}`);
    expect(block).toContain(`  in English FAILED: engine said ${ESC}u{1b}[2J`);
  });

  it('never lets a note put a raw control character on the terminal', () => {
    const block = reviewBlock(
      row({
        note: `line one\nline two${BELL}`,
        quote: `x${String.fromCharCode(27)}[2J`,
      }),
      fixture,
      { kind: 'not-needed' },
    );
    expect(block).toContain(`note        "line one${ESC}nline two${ESC}u{7}"`);
    expect(block).toContain(`quoted      "x${ESC}u{1b}[2J"`);
    const body = block.split('\n');
    for (const line of body)
      expect(line, line).not.toMatch(/[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/u);
    expect(body.length).toBeGreaterThan(8);
  });
});

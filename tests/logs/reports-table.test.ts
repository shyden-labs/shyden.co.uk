/**
 * The reports table (#302, #348, #822): the audit trail every report leaves.
 * The endpoint writes it, the health check compares it, the review script
 * reads it back and the runbook selects from it, so the migration, the
 * columns the code names and the runbook's SELECT must agree, and every text
 * column keeps the bound check 7 holds visitors to. Run before every release.
 *
 * The unit suite keeps the stand-in: `REPORT_COLUMNS` pinned to its literal
 * list and the health check's column comparison
 * (tests/unit/report-endpoint.test.ts).
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  COUNT_COLUMNS,
  MAX_FIELD_UNITS,
  REPORT_COLUMNS,
} from '../../src/lib/report';
import { withoutSqlComments } from '../unit/source-text';

describe('the migration', () => {
  // Comments stripped, both forms: the migration's own column notes must not
  // satisfy this. A private `--` replace stood here, and a block comment below
  // the table holding the old `quote` line passed the anchored check while the
  // column itself allowed 100000 characters (#390 F160).
  const sql = () =>
    withoutSqlComments(readFileSync('migrations/0001_reports.sql', 'utf8'));

  it('creates exactly the columns the endpoint writes and the health check expects', () => {
    const body = /CREATE TABLE reports \(([\s\S]*)\);/.exec(sql())?.[1];
    expect(body, 'a CREATE TABLE reports statement').toBeDefined();
    const columns = body!
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => line.split(/\s+/)[0]);
    expect(columns).toEqual([...REPORT_COLUMNS]);
  });

  const countsSql = () =>
    withoutSqlComments(
      readFileSync('migrations/0002_report_counts.sql', 'utf8'),
    );

  it('creates exactly the count columns the endpoint writes, keyed by day and counter (#872)', () => {
    const body = /CREATE TABLE report_counts \(([\s\S]*)\);/.exec(
      countsSql(),
    )?.[1];
    expect(body, 'a CREATE TABLE report_counts statement').toBeDefined();
    const lines = body!
      .split('\n')
      .map((line) => line.trim().replace(/,$/, ''))
      .filter(Boolean);
    expect(lines).toEqual([
      'day     TEXT NOT NULL',
      'counter TEXT NOT NULL',
      'count   INTEGER NOT NULL CHECK (count >= 1)',
      'PRIMARY KEY (day, counter)',
    ]);
    expect(COUNT_COLUMNS).toEqual(['day', 'counter', 'count']);
  });

  it('bounds every text column the way check 7 does', () => {
    // Anchored to each column's own line, so no other text can satisfy them
    // (`anchored-presence.test.ts`). The literal 1000 is tied to check 7 by
    // the pin on MAX_FIELD_UNITS.
    expect(MAX_FIELD_UNITS).toBe(1000);
    const text = sql();
    expect(text).toMatch(
      /^\s*quote\s+TEXT NOT NULL CHECK \(length\(quote\) BETWEEN 1 AND 1000\),\s*$/m,
    );
    expect(text).toMatch(
      /^\s*suggestion\s+TEXT NOT NULL DEFAULT '' CHECK \(length\(suggestion\) <= 1000\),\s*$/m,
    );
    expect(text).toMatch(
      /^\s*note\s+TEXT NOT NULL DEFAULT '' CHECK \(length\(note\) <= 1000\)\s*$/m,
    );
  });
});

describe('the runbook', () => {
  // Anchored to whole lines, so the block's own `--` notes cannot satisfy them.
  const runbook = () =>
    readFileSync('docs/runbooks/translation-reports.md', 'utf8');

  it('lists every stored column, and holds both deletes (AC7)', () => {
    const text = runbook();
    const select = /^SELECT (.+)$/m.exec(text)?.[1];
    expect(select, 'a SELECT line in the runbook').toBeDefined();
    expect(select!.split(', ')).toEqual([...REPORT_COLUMNS]);
    expect(text).toMatch(/^DELETE FROM reports WHERE id = '<id>';$/m);
    expect(text).toMatch(
      /^DELETE FROM reports WHERE note LIKE 'automated dev check %';$/m,
    );
  });
});

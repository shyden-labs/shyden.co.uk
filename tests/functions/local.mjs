/**
 * The functions-runtime tests' local stack (#97, spec 10): `wrangler pages
 * dev` serving dist/ with the real Functions on workerd, over a local D1 that
 * has the real migration applied. One home for the values the server, the
 * config and the specs must agree on.
 */
import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';

export const PORT = 8799;
export const BASE_URL = `http://127.0.0.1:${PORT}`;
/** The dev middleware gates every non-prod host and fails closed without a password. */
export const PASSWORD = 'functions-local';
export const PERSIST = '.wrangler/functions-test';
export const CONFIG = 'tests/functions/wrangler.toml';
export const DATABASE = 'reports-local';
export const DATABASE_ID = '00000000-0000-4000-8000-000000000097';

/**
 * Run wrangler's D1 CLI against the local database, and fail loudly with its own words.
 * @param {readonly string[]} args
 * @returns {string} stdout
 */
export function d1(args) {
  const run = spawnSync(
    'npx',
    [
      'wrangler',
      'd1',
      'execute',
      DATABASE,
      '--local',
      '--persist-to',
      PERSIST,
      '--config',
      CONFIG,
      ...args,
    ],
    { encoding: 'utf8' },
  );
  if (run.status !== 0)
    throw new Error(
      `wrangler d1 execute failed (${run.status}): ${run.stderr || run.stdout}`,
    );
  return run.stdout;
}

/**
 * Every stored report whose note is exactly `note`. Each test writes a note
 * of its own, so tests never read each other's rows. The note travels as
 * a SQL string literal, so single quotes are doubled.
 * @param {string} note
 * @returns {Array<{ locale: string, page: string, quote: string, keys: string, suggestion: string, note: string }>}
 */
export function reportsWithNote(note) {
  const literal = `'${note.replaceAll("'", "''")}'`;
  const out = d1([
    '--json',
    '--command',
    `SELECT locale, page, quote, keys, suggestion, note FROM reports WHERE note = ${literal}`,
  ]);
  return JSON.parse(out)[0].results;
}

/**
 * Every stored report whose note starts with `stem`: the population a test's
 * absence assertion is drawn from (#610). A test whose reports must not be
 * stored writes every note of its own after one stem, plants a control row
 * under it (`plantReport`), and so can show that this reader reaches rows the
 * test put in the table. `instr`, not `LIKE`: D1 refuses a pattern longer
 * than 50 bytes ("LIKE or GLOB pattern too complex"), and a stem is longer.
 * @param {string} stem
 * @returns {Array<{ locale: string, page: string, quote: string, keys: string, suggestion: string, note: string }>}
 */
export function reportsStartingWith(stem) {
  const literal = `'${stem.replaceAll("'", "''")}'`;
  const out = d1([
    '--json',
    '--command',
    `SELECT locale, page, quote, keys, suggestion, note FROM reports WHERE instr(note, ${literal}) = 1`,
  ]);
  return JSON.parse(out)[0].results;
}

/**
 * Put one report row straight into the table, bypassing the endpoint: a
 * control the reader must find if it reads the table at all (#610).
 * @param {string} note
 */
export function plantReport(note) {
  const literal = `'${note.replaceAll("'", "''")}'`;
  d1([
    '--command',
    `INSERT INTO reports (id, received_at, locale, page, quote, keys, suggestion, note) VALUES ('${randomUUID()}', '${new Date().toISOString()}', 'vi', 'home', 'planted control', '[]', '', ${literal})`,
  ]);
}

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
 * The longest a statement waits for the dev server's D1 before the call
 * fails, naming the server it was queued on (#737). Well under Playwright's
 * 30 s default per test, which this suite keeps: at 30 s the test's own limit
 * would fire first, with a generic timeout instead of this call's words.
 */
export const QUERY_CEILING_MS = 10_000;
/**
 * A statement that waited longer than this says so (#737). Measured in CI
 * under a writer posting reports back to back: median 6 ms for a write and
 * 17-18 ms for a read, maximum 648 ms (run 38310742384).
 */
export const WAIT_REPORTED_MS = 250;
const EXPLORER = `${BASE_URL}/cdn-cgi/local/explorer/api/d1/database/${DATABASE_ID}/raw`;

/**
 * Run one statement through the running dev server's own D1 object (#737).
 *
 * `wrangler pages dev` keeps the database open in its own workerd. A second
 * process opening the same file (each `wrangler d1 execute`, as these helpers
 * once did) fails at once with SQLITE_BUSY whenever the server is mid-write,
 * because neither sets a busy handler: reproduced in CI, 1,070 of 1,074 pairs
 * under a concurrent writer, and every lock held by the server. Miniflare's
 * local explorer hands the statement to the same D1 object the server's
 * binding uses, which takes the server's statements and these one at a time,
 * so a statement queues behind the server's instead of meeting its lock: 0 of
 * 139,490 pairs failed under the same writer. Nothing here re-attempts,
 * sleeps or polls.
 *
 * @param {string} sql
 * @param {readonly string[]} [params] bound to the statement's `?`s, never spliced into it
 * @param {{ fetch?: typeof fetch, now?: () => number, log?: (line: string) => void, ceilingMs?: number }} [options]
 *   the network, the clock, the reporter and the ceiling, stood in by unit tests
 * @returns {Promise<Array<Record<string, unknown>>>} each row keyed by its column
 */
export async function query(
  sql,
  params = [],
  {
    fetch: send = fetch,
    now = () => performance.now(),
    log = console.log,
    ceilingMs = QUERY_CEILING_MS,
  } = {},
) {
  const started = now();
  let response;
  try {
    response = await send(EXPLORER, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ sql, params }),
      signal: AbortSignal.timeout(ceilingMs),
    });
  } catch (error) {
    if (error instanceof Error && error.name === 'TimeoutError')
      throw new Error(
        `queued ${ceilingMs} ms on the dev server's D1 at ${BASE_URL} without an answer: ${sql}`,
      );
    throw error;
  }
  const body = await response.text();
  const waited = Math.round(now() - started);
  if (waited > WAIT_REPORTED_MS)
    log(
      `d1: waited ${waited} ms for the dev server's D1 at ${BASE_URL}, queued behind its own statements: ${sql.slice(0, 120)}`,
    );
  /** @type {{ success?: boolean, errors?: Array<{ message?: string }>, result?: Array<{ results?: { columns?: string[], rows?: unknown[][] } }> }} */
  let answer = {};
  try {
    answer = JSON.parse(body);
  } catch {
    // Reported below in the server's own words.
  }
  if (!response.ok || answer.success !== true) {
    const words = (answer.errors ?? [])
      .map(({ message }) => message)
      .filter(Boolean)
      .join('; ');
    throw new Error(
      `the dev server's D1 refused (${response.status}): ${words || body.slice(0, 600)}`,
    );
  }
  const { columns = [], rows = [] } = answer.result?.[0]?.results ?? {};
  return rows.map((row) =>
    Object.fromEntries(columns.map((column, index) => [column, row[index]])),
  );
}

/**
 * Run wrangler's D1 CLI against the local database, and fail loudly with its
 * own words. Only for the migration, which runs before the server starts and
 * so while nothing else holds the file; once the server runs, every statement
 * goes through `query` (#737).
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

/** @typedef {{ locale: string, page: string, quote: string, keys: string, suggestion: string, note: string }} Report */
const COLUMNS = 'locale, page, quote, keys, suggestion, note';

/**
 * Every stored report whose note is exactly `note`. Each test writes a note
 * of its own, so tests never read each other's rows. The note is bound as a
 * parameter, never spliced into the statement.
 * @param {string} note
 * @returns {Promise<Array<Report>>}
 */
export async function reportsWithNote(note) {
  return /** @type {Array<Report>} */ (
    await query(`SELECT ${COLUMNS} FROM reports WHERE note = ?`, [note])
  );
}

/**
 * Every stored report whose note starts with `stem`: the population a test's
 * absence assertion is drawn from (#610). A test whose reports must not be
 * stored writes every note of its own after one stem, plants a control row
 * under it (`plantReport`), and so can show that this reader reaches rows the
 * test put in the table. `instr`, not `LIKE`: D1 refuses a pattern longer
 * than 50 bytes ("LIKE or GLOB pattern too complex"), and a stem is longer.
 * @param {string} stem
 * @returns {Promise<Array<Report>>}
 */
export async function reportsStartingWith(stem) {
  return /** @type {Array<Report>} */ (
    await query(`SELECT ${COLUMNS} FROM reports WHERE instr(note, ?) = 1`, [
      stem,
    ])
  );
}

/**
 * Put one report row straight into the table, bypassing the endpoint: a
 * control the reader must find if it reads the table at all (#610).
 * @param {string} note
 * @returns {Promise<void>}
 */
export async function plantReport(note) {
  await query(
    "INSERT INTO reports (id, received_at, locale, page, quote, keys, suggestion, note) VALUES (?, ?, 'vi', 'home', 'planted control', '[]', '', ?)",
    [randomUUID(), new Date().toISOString(), note],
  );
}

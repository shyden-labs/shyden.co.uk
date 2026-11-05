/**
 * The shared ledger of characters sent to Google, kept safe between runs.
 * #841.
 *
 * Every worktree's read-back counts what it sends in one file under
 * `~/.config/shyden/`. A run used to read that file once, at its start, and
 * write its own copy back after every request, so two runs started together
 * each saw the whole day, each spent it, and the last writer erased the
 * other's spend: a silent under-count. Three repairs live here:
 *
 * - one read-back at a time, machine-wide (`takeLock`): a second run waits
 *   for the first, says whom it waits for, and gives up at a stated ceiling
 *   naming the holder;
 * - the ledger is read again before every request (`spendWithin`), so a
 *   request that would cross the day's limit is never sent, whoever spent it;
 * - every write goes to a file beside the ledger and is renamed over it
 *   (`writeLedger`), so a write cut short leaves the old ledger whole.
 *
 * The file system, the clock and the process check are parameters, so the
 * unit tests run all of it in memory.
 */
import {
  DAILY_CHARACTERS,
  charactersLeft,
  parseLedger,
  spend,
  type Ledger,
} from './read-back.ts';

/** The few file operations the ledger and its lock need. */
export interface LedgerFiles {
  /** The file's text, or `undefined` when there is no such file. */
  read(path: string): string | undefined;
  /** Creates the file only if it is not there; `false` when it was. */
  create(path: string, text: string): boolean;
  write(path: string, text: string): void;
  /** Replaces `to` with `from` in one step. */
  rename(from: string, to: string): void;
  remove(path: string): void;
}

/** The run holding the lock, as its lock file names it. */
export interface Holder {
  pid: number;
  worktree: string;
  started: string;
}

/** Time, and whether a process still runs: stand-ins in the unit tests. */
export interface LockClock {
  now(): number;
  wait(ms: number): Promise<void>;
  alive(pid: number): boolean;
  say(line: string): void;
}

/** What one request to Google came back with. */
export type Answer =
  { ok: true; body: unknown } | { ok: false; quota: boolean; message: string };

/** Where the ledger is, which day it counts, and against which limit. */
export interface LedgerSite {
  files: LedgerFiles;
  path: string;
  day: string;
  limit: number;
  /** Set when the limit is not the usual one: it is written beside the day. */
  raised: boolean;
  pid: number;
}

/**
 * How long a second run waits for the first. A run of the whole day takes
 * seconds, so ten minutes is a run that has hung, and the wait ends there.
 */
export const LOCK_CEILING_MS = 10 * 60_000;
export const LOCK_POLL_MS = 1_000;

const thousands = (count: number): string => count.toLocaleString('en-GB');

const holderText = (holder: Holder): string =>
  `pid ${holder.pid} in ${holder.worktree}, started ${holder.started}`;

/** The holder a lock file names, or `undefined` when it names none. */
function holderOf(text: string): Holder | undefined {
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    return undefined;
  }
  if (!json || typeof json !== 'object') return undefined;
  const { pid, worktree, started } = json as Record<string, unknown>;
  return Number.isInteger(pid) &&
    typeof worktree === 'string' &&
    typeof started === 'string'
    ? { pid: pid as number, worktree, started }
    : undefined;
}

/**
 * Takes the one read-back lock, waiting while a live run holds it, and
 * returns the function that gives it back. A lock left by a run that is no
 * longer running is taken over, and the takeover is said aloud.
 */
export async function takeLock(
  files: LedgerFiles,
  path: string,
  me: Holder,
  clock: LockClock,
  ceiling = LOCK_CEILING_MS,
): Promise<() => void> {
  const mine = `${JSON.stringify(me)}\n`;
  const release = () => {
    // Only this run's own lock: one taken over after it is not ours to drop.
    if (files.read(path) === mine) files.remove(path);
  };
  const began = clock.now();
  let announced = false;
  for (;;) {
    if (files.create(path, mine)) return release;
    const text = files.read(path);
    // Released between the two calls: take it on the next pass.
    if (text === undefined) continue;
    const holder = holderOf(text);
    if (!holder)
      throw new Error(
        `the read-back lock ${path} does not name its holder; remove it by hand once no read-back runs`,
      );
    if (!clock.alive(holder.pid)) {
      clock.say(
        `taking over the lock left by ${holderText(holder)}, which is no longer running`,
      );
      files.remove(path);
      continue;
    }
    if (clock.now() - began >= ceiling)
      throw new Error(
        `another read-back still holds ${path} after ${ceiling / 60_000} minutes: ${holderText(holder)}`,
      );
    if (!announced) {
      clock.say(
        `waiting for the read-back held by ${holderText(holder)} (up to ${ceiling / 60_000} minutes)`,
      );
      announced = true;
    }
    await clock.wait(LOCK_POLL_MS);
  }
}

/** The ledger as it is on disk now; no file is an empty ledger. */
export function readLedger(files: LedgerFiles, path: string): Ledger {
  const text = files.read(path);
  if (text === undefined) return {};
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    throw new Error(`the character ledger ${path} is not JSON`);
  }
  return parseLedger(json);
}

/** Writes the ledger beside itself and renames it over the old one. */
export function writeLedger(
  files: LedgerFiles,
  path: string,
  ledger: Readonly<Ledger>,
  pid: number,
): void {
  const temporary = `${path}.${pid}.tmp`;
  files.write(temporary, `${JSON.stringify(ledger, null, 2)}\n`);
  files.rename(temporary, path);
}

/** The key a day's raised limit is written under, beside the day itself. */
export const limitKey = (day: string): string => `${day} limit`;

/**
 * The day's limit: 16,000, or `GOOGLE_DAILY_CHARACTERS` when the operator
 * has raised it for a run. A raised limit is written into the ledger beside
 * the day's total, so a figure over 16,000 explains itself.
 */
export function dailyLimit(env: Readonly<Record<string, string | undefined>>): {
  limit: number;
  raised: boolean;
} {
  const value = env.GOOGLE_DAILY_CHARACTERS;
  if (value === undefined) return { limit: DAILY_CHARACTERS, raised: false };
  if (!/^[1-9]\d*$/.test(value))
    throw new Error(
      `GOOGLE_DAILY_CHARACTERS must be a positive whole number of characters (got ${JSON.stringify(value)})`,
    );
  return { limit: Number(value), raised: true };
}

/**
 * Sends the requests in order while the ledger, read again before each one,
 * has room for it. A request is counted as soon as Google answers, before its
 * answer is checked, because a reply that fails its checks was still billed;
 * the count is added to the ledger as it is then, not as it was first read.
 * The first refusal stops the run, and nothing is retried.
 */
export async function spendWithin<B>(
  requests: readonly B[],
  charsOf: (request: B) => number,
  site: LedgerSite,
  ask: (request: B) => Promise<Answer>,
  accept: (request: B, body: unknown) => void | Promise<void>,
): Promise<{ spent: number; stop: string }> {
  const { files, path, day, limit, raised, pid } = site;
  const record = (ledger: Ledger): Ledger =>
    raised ? { ...ledger, [limitKey(day)]: limit } : ledger;
  let spent = 0;
  for (const request of requests) {
    const chars = charsOf(request);
    const before = readLedger(files, path);
    if (chars > charactersLeft(before, day, limit))
      return {
        spent,
        stop: `the ledger shows ${thousands(before[day] ?? 0)} of ${thousands(limit)} characters spent on Google's ${day}, and the next request needs ${thousands(chars)}: another run spent the rest`,
      };
    const answer = await ask(request);
    const now = readLedger(files, path);
    if (!answer.ok) {
      // A spent quota closes the day in the ledger too, whatever it counted.
      if (answer.quota)
        writeLedger(
          files,
          path,
          record(spend(now, day, charactersLeft(now, day, limit))),
          pid,
        );
      return { spent, stop: answer.message };
    }
    writeLedger(files, path, record(spend(now, day, chars)), pid);
    spent += chars;
    await accept(request, answer.body);
  }
  return { spent, stop: '' };
}

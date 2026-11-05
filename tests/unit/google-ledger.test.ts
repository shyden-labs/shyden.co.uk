import { describe, expect, it } from 'vitest';
import {
  LOCK_CEILING_MS,
  LOCK_POLL_MS,
  dailyLimit,
  limitKey,
  readLedger,
  spendWithin,
  takeLock,
  writeLedger,
  type Answer,
  type Holder,
  type LedgerFiles,
  type LockClock,
} from '../../src/lib/i18n/google-ledger';
import { charactersLeft } from '../../src/lib/i18n/read-back';

/**
 * #841. Every worktree's read-back shares one ledger of the characters sent
 * to Google today. Two runs that each read it once at the start each saw the
 * whole day, spent it, and wrote their own copy back, so the last writer won
 * and the other run's spend vanished. These tests hold the three repairs: one
 * run at a time machine-wide, the ledger read again before every request, and
 * every write whole or not at all. The files, the clock and the process check
 * are stand-ins: no test here touches the disk or starts anything.
 */

const LEDGER = '/home/.config/shyden/google-translate-ledger.json';
const LOCK = '/home/.config/shyden/google-translate.lock';
const DAY = '2026-10-17';

const ME: Holder = {
  pid: 200,
  worktree: '/repos/shyden.co.uk-841',
  started: '2026-10-17T03:00:00.000Z',
};
const OTHER: Holder = {
  pid: 41,
  worktree: '/repos/shyden.co.uk-754',
  started: '2026-10-17T02:58:00.000Z',
};

/** A file system in a map, with every call it took written down. */
function memoryFiles(initial: Record<string, string> = {}) {
  const files = new Map(Object.entries(initial));
  const calls: string[] = [];
  const port: LedgerFiles = {
    read: (path) => {
      calls.push(`read ${path}`);
      return files.get(path);
    },
    create: (path, text) => {
      calls.push(`create ${path}`);
      if (files.has(path)) return false;
      files.set(path, text);
      return true;
    },
    write: (path, text) => {
      calls.push(`write ${path}`);
      files.set(path, text);
    },
    rename: (from, to) => {
      calls.push(`rename ${from} -> ${to}`);
      const text = files.get(from);
      if (text === undefined) throw new Error(`no such file: ${from}`);
      files.delete(from);
      files.set(to, text);
    },
    remove: (path) => {
      calls.push(`remove ${path}`);
      files.delete(path);
    },
  };
  return { files, calls, port };
}

/** A clock that moves only when the code waits, and a list of what it said. */
function fakeClock(
  alive: ReadonlySet<number>,
  onWait: (waited: number) => void = () => {},
) {
  let at = 0;
  let waits = 0;
  const said: string[] = [];
  const clock: LockClock = {
    now: () => at,
    wait: async (ms) => {
      at += ms;
      waits += 1;
      onWait(waits);
    },
    alive: (pid) => alive.has(pid),
    say: (line) => said.push(line),
  };
  return { clock, said, waits: () => waits };
}

const lockText = (holder: Holder) => `${JSON.stringify(holder)}\n`;

describe('takeLock: one read-back at a time, machine-wide (AC1)', () => {
  it('takes a free lock and writes its holder into it', async () => {
    const disk = memoryFiles();
    await takeLock(disk.port, LOCK, ME, fakeClock(new Set()).clock);
    expect(JSON.parse(disk.files.get(LOCK) ?? 'null')).toEqual(ME);
  });

  it('gives the lock back when released', async () => {
    const disk = memoryFiles();
    const release = await takeLock(
      disk.port,
      LOCK,
      ME,
      fakeClock(new Set()).clock,
    );
    release();
    expect(disk.files.has(LOCK)).toBe(false);
  });

  it('never removes a lock another run took after it', async () => {
    const disk = memoryFiles();
    const release = await takeLock(
      disk.port,
      LOCK,
      ME,
      fakeClock(new Set()).clock,
    );
    disk.files.set(LOCK, lockText(OTHER));
    release();
    expect(disk.files.get(LOCK)).toBe(lockText(OTHER));
  });

  it('waits on a live holder, naming it, and takes the lock once it is given back', async () => {
    const disk = memoryFiles({ [LOCK]: lockText(OTHER) });
    const time = fakeClock(new Set([OTHER.pid]), (waits) => {
      if (waits === 3) disk.files.delete(LOCK);
    });
    await takeLock(disk.port, LOCK, ME, time.clock);
    expect(JSON.parse(disk.files.get(LOCK) ?? 'null')).toEqual(ME);
    expect(time.waits()).toBe(3);
    expect(time.said).toEqual([
      'waiting for the read-back held by pid 41 in /repos/shyden.co.uk-754, started 2026-10-17T02:58:00.000Z (up to 10 minutes)',
    ]);
  });

  it('waits in steps of one second', async () => {
    const disk = memoryFiles({ [LOCK]: lockText(OTHER) });
    const time = fakeClock(new Set([OTHER.pid]), (waits) => {
      if (waits === 1) disk.files.delete(LOCK);
    });
    await takeLock(disk.port, LOCK, ME, time.clock);
    expect(time.clock.now()).toBe(1_000);
  });

  it('fails at its ceiling naming the holder, having waited no longer', async () => {
    const disk = memoryFiles({ [LOCK]: lockText(OTHER) });
    const time = fakeClock(new Set([OTHER.pid]));
    await expect(takeLock(disk.port, LOCK, ME, time.clock)).rejects.toThrow(
      'another read-back still holds /home/.config/shyden/google-translate.lock after 10 minutes: pid 41 in /repos/shyden.co.uk-754, started 2026-10-17T02:58:00.000Z',
    );
    expect(time.clock.now()).toBe(600_000);
    expect(disk.files.get(LOCK)).toBe(lockText(OTHER));
  });

  it('states a ceiling of ten minutes, waited for in one-second steps', () => {
    expect(LOCK_CEILING_MS).toBe(600_000);
    expect(LOCK_POLL_MS).toBe(1_000);
  });

  it('takes over a lock whose holder is no longer running, and says so', async () => {
    const disk = memoryFiles({ [LOCK]: lockText(OTHER) });
    const time = fakeClock(new Set());
    await takeLock(disk.port, LOCK, ME, time.clock);
    expect(JSON.parse(disk.files.get(LOCK) ?? 'null')).toEqual(ME);
    expect(time.waits()).toBe(0);
    expect(time.said).toEqual([
      'taking over the lock left by pid 41 in /repos/shyden.co.uk-754, started 2026-10-17T02:58:00.000Z, which is no longer running',
    ]);
  });

  it('refuses a lock it cannot read, naming the file', async () => {
    const disk = memoryFiles({ [LOCK]: 'half a wri' });
    await expect(
      takeLock(disk.port, LOCK, ME, fakeClock(new Set()).clock),
    ).rejects.toThrow(
      'the read-back lock /home/.config/shyden/google-translate.lock does not name its holder; remove it by hand once no read-back runs',
    );
  });

  it('refuses a lock that names no process', async () => {
    const disk = memoryFiles({
      [LOCK]: JSON.stringify({ ...OTHER, pid: 'forty-one' }),
    });
    await expect(
      takeLock(disk.port, LOCK, ME, fakeClock(new Set()).clock),
    ).rejects.toThrow('does not name its holder');
  });
});

/** Every request asked for, and an answer for each. */
function google(answers: readonly Answer[] = []) {
  const asked: string[] = [];
  return {
    asked,
    ask: async (batch: { id: string; chars: number }) => {
      asked.push(batch.id);
      return answers[asked.length - 1] ?? { ok: true as const, body: 'read' };
    },
  };
}

const at = (ledger: Record<string, number>) => ({
  [LEDGER]: `${JSON.stringify(ledger)}\n`,
});
const ledgerOn = (disk: { files: Map<string, string> }) =>
  JSON.parse(disk.files.get(LEDGER) ?? 'null');
const site = (port: LedgerFiles, limit = 16_000, raised = false) => ({
  files: port,
  path: LEDGER,
  day: DAY,
  limit,
  raised,
  pid: ME.pid,
});
const charsOf = (batch: { chars: number }) => batch.chars;

describe('spendWithin: the ledger is read again before every request (AC2)', () => {
  it('sends nothing another run has made room for no longer', async () => {
    const disk = memoryFiles(at({ [DAY]: 6_000 }));
    const asked = google();
    const result = await spendWithin(
      [
        { id: 'a', chars: 5_000 },
        { id: 'b', chars: 5_000 },
      ],
      charsOf,
      site(disk.port),
      async (batch) => {
        const answer = await asked.ask(batch);
        // Another worktree's run spends 4,000 while this request is out;
        // this one's 5,000 then makes 15,000, and 5,000 more would cross.
        disk.files.set(LEDGER, JSON.stringify({ [DAY]: 10_000 }));
        return answer;
      },
      () => {},
    );
    expect(asked.asked).toEqual(['a']);
    expect(result.spent).toBe(5_000);
    expect(result.stop).toBe(
      "the ledger shows 15,000 of 16,000 characters spent on Google's 2026-10-17, and the next request needs 5,000: another run spent the rest",
    );
  });

  it('adds its spend to the ledger as it is now, not as it was first read', async () => {
    const disk = memoryFiles(at({ [DAY]: 1_000 }));
    const asked = google();
    await spendWithin(
      [{ id: 'a', chars: 300 }],
      charsOf,
      site(disk.port),
      async (batch) => {
        disk.files.set(LEDGER, JSON.stringify({ [DAY]: 2_000 }));
        return asked.ask(batch);
      },
      () => {},
    );
    expect(ledgerOn(disk)).toEqual({ [DAY]: 2_300 });
  });

  it('sends a request that exactly fills the day', async () => {
    const disk = memoryFiles(at({ [DAY]: 15_000 }));
    const asked = google();
    const result = await spendWithin(
      [{ id: 'a', chars: 1_000 }],
      charsOf,
      site(disk.port),
      asked.ask,
      () => {},
    );
    expect(asked.asked).toEqual(['a']);
    expect(result).toEqual({ spent: 1_000, stop: '' });
    expect(ledgerOn(disk)).toEqual({ [DAY]: 16_000 });
  });

  it('starts a day the ledger has not seen', async () => {
    const disk = memoryFiles();
    const asked = google();
    await spendWithin(
      [{ id: 'a', chars: 10 }],
      charsOf,
      site(disk.port),
      asked.ask,
      () => {},
    );
    expect(ledgerOn(disk)).toEqual({ [DAY]: 10 });
  });

  it('hands each answer on once it is counted', async () => {
    const disk = memoryFiles();
    const accepted: string[] = [];
    await spendWithin(
      [
        { id: 'a', chars: 10 },
        { id: 'b', chars: 20 },
      ],
      charsOf,
      site(disk.port),
      google([
        { ok: true, body: 'first' },
        { ok: true, body: 'second' },
      ]).ask,
      (batch, body) => {
        accepted.push(`${batch.id}:${String(body)}:${ledgerOn(disk)[DAY]}`);
      },
    );
    expect(accepted).toEqual(['a:first:10', 'b:second:30']);
  });

  it('counts a request whose answer then fails its checks', async () => {
    const disk = memoryFiles();
    await expect(
      spendWithin(
        [{ id: 'a', chars: 70 }],
        charsOf,
        site(disk.port),
        google().ask,
        () => {
          throw new Error('Google answered 2 texts for 3');
        },
      ),
    ).rejects.toThrow('Google answered 2 texts for 3');
    expect(ledgerOn(disk)).toEqual({ [DAY]: 70 });
  });

  it('stops at a refusal, naming it, and asks nothing more', async () => {
    const disk = memoryFiles();
    const asked = google([
      { ok: false, quota: false, message: 'Google refused the key (403)' },
    ]);
    const result = await spendWithin(
      [
        { id: 'a', chars: 10 },
        { id: 'b', chars: 10 },
      ],
      charsOf,
      site(disk.port),
      asked.ask,
      () => {},
    );
    expect(asked.asked).toEqual(['a']);
    expect(result).toEqual({ spent: 0, stop: 'Google refused the key (403)' });
    expect(disk.files.has(LEDGER)).toBe(false);
  });

  it('closes the day in the ledger when Google says its quota is spent', async () => {
    const disk = memoryFiles(at({ [DAY]: 9_000 }));
    const result = await spendWithin(
      [{ id: 'a', chars: 10 }],
      charsOf,
      site(disk.port),
      google([{ ok: false, quota: true, message: 'quota spent (429)' }]).ask,
      () => {},
    );
    expect(result.stop).toBe('quota spent (429)');
    expect(ledgerOn(disk)).toEqual({ [DAY]: 16_000 });
  });
});

describe('writeLedger: a write is whole or not at all (AC3)', () => {
  it('writes beside the ledger and renames over it', () => {
    const disk = memoryFiles();
    writeLedger(disk.port, LEDGER, { [DAY]: 5 }, ME.pid);
    expect(disk.calls).toEqual([
      `write ${LEDGER}.200.tmp`,
      `rename ${LEDGER}.200.tmp -> ${LEDGER}`,
    ]);
    expect(disk.files.get(LEDGER)).toBe(`{\n  "${DAY}": 5\n}\n`);
  });

  it('leaves the old ledger whole when the write is cut short', () => {
    const disk = memoryFiles(at({ [DAY]: 5 }));
    // A write cut short has written part of its text, not none of it.
    const failing: LedgerFiles = {
      ...disk.port,
      write: (path, text) => {
        disk.files.set(path, text.slice(0, 5));
        throw new Error('disk full');
      },
    };
    expect(() => writeLedger(failing, LEDGER, { [DAY]: 9 }, ME.pid)).toThrow(
      'disk full',
    );
    expect(disk.files.get(LEDGER)).toBe(at({ [DAY]: 5 })[LEDGER]);
  });

  it('reads a ledger that is not there as an empty one', () => {
    expect(readLedger(memoryFiles().port, LEDGER)).toEqual({});
  });

  it('refuses a ledger it cannot parse, naming the file', () => {
    const disk = memoryFiles({ [LEDGER]: '{"2026-10-17": 5' });
    expect(() => readLedger(disk.port, LEDGER)).toThrow(
      `the character ledger ${LEDGER} is not JSON`,
    );
  });
});

describe('dailyLimit: a raised limit is a recorded decision (AC5)', () => {
  it('is 16,000 when nothing raises it', () => {
    expect(dailyLimit({})).toEqual({ limit: 16_000, raised: false });
  });

  it('takes GOOGLE_DAILY_CHARACTERS when it is set', () => {
    expect(dailyLimit({ GOOGLE_DAILY_CHARACTERS: '60000' })).toEqual({
      limit: 60_000,
      raised: true,
    });
  });

  it.each([['0'], ['-5'], ['1.5'], ['60k'], ['']])(
    'refuses a limit that is not a positive whole number: %j',
    (value) => {
      expect(() => dailyLimit({ GOOGLE_DAILY_CHARACTERS: value })).toThrow(
        `GOOGLE_DAILY_CHARACTERS must be a positive whole number of characters (got ${JSON.stringify(value)})`,
      );
    },
  );

  it('names the day a limit belongs to', () => {
    expect(limitKey(DAY)).toBe('2026-10-17 limit');
  });

  it('measures what is left against the limit it is given', () => {
    expect(charactersLeft({ [DAY]: 20_000 }, DAY, 60_000)).toBe(40_000);
  });

  it('writes a raised limit beside the day it was spent on', async () => {
    const disk = memoryFiles(at({ [DAY]: 16_000 }));
    await spendWithin(
      [{ id: 'a', chars: 500 }],
      charsOf,
      site(disk.port, 60_000, true),
      google().ask,
      () => {},
    );
    expect(ledgerOn(disk)).toEqual({
      [DAY]: 16_500,
      '2026-10-17 limit': 60_000,
    });
  });

  it('writes no limit for a day run at the usual one', async () => {
    const disk = memoryFiles();
    await spendWithin(
      [{ id: 'a', chars: 500 }],
      charsOf,
      site(disk.port),
      google().ask,
      () => {},
    );
    expect(Object.keys(ledgerOn(disk))).toEqual([DAY]);
  });
});

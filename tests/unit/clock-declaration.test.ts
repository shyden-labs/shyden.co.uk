import { describe, it, expect } from 'vitest';
import { CLOCK_TAG, refuseUndeclaredClock } from '../device/clock-declaration';

/**
 * The phone has one browser context for the whole run, and Playwright cannot take a clock back
 * out of it: `clock.install()` registers its script on the context, and the protocol has no
 * uninstall. A clock one test installed ran every later page's animation frames as timers until
 * the run ended (#854). So on the phone a test that installs one is tagged, which runs it in a
 * worker of its own, and an untagged call is refused before it reaches Playwright.
 */

/** A stand-in for Playwright's client `Clock`: its methods live on the class, as Playwright's do. */
class StandInClock {
  calls: string[] = [];
  async install(options?: unknown) {
    this.calls.push(`install ${JSON.stringify(options)}`);
    return 'installed';
  }
  async runFor(ticks: number) {
    this.calls.push(`runFor ${ticks}`);
  }
  async pauseAt(time: number) {
    this.calls.push(`pauseAt ${time}`);
  }
}

type Guarded = Record<string, (...args: unknown[]) => Promise<unknown>>;

/** What a guarded call rejected with, or a failure naming that it did not reject. */
const rejection = async (call: Promise<unknown>): Promise<Error> => {
  try {
    await call;
  } catch (error) {
    return error as Error;
  }
  throw new Error('the call resolved; it was meant to be refused');
};

describe('a clock on the phone is used only by a test that declares it (#854)', () => {
  it('names the tag a test carries', () => {
    expect(CLOCK_TAG).toBe('@installs-a-clock');
  });

  it('refuses an undeclared call, naming the method and the tag', async () => {
    const clock = new StandInClock();
    refuseUndeclaredClock(clock, () => false);
    const error = await rejection(clock.install());
    expect(error.message).toContain('clock.install()');
    expect(error.message).toContain("{ tag: '@installs-a-clock' }");
  });

  it('never lets a refused call reach the clock', async () => {
    let declared = false;
    const clock = new StandInClock();
    refuseUndeclaredClock(clock, () => declared);
    await rejection(clock.runFor(1_000));
    // A call let through afterwards proves the log records calls, so the refused one is absent.
    declared = true;
    await clock.runFor(2);
    expect(clock.calls).toEqual(['runFor 2']);
  });

  it('passes a declared call to the clock with its arguments and result', async () => {
    const clock = new StandInClock();
    refuseUndeclaredClock(clock, () => true);
    expect(await clock.install({ time: 5 })).toBe('installed');
    expect(clock.calls).toEqual(['install {"time":5}']);
  });

  it("guards every method the clock's class defines, read off the class", () => {
    expect(refuseUndeclaredClock(new StandInClock(), () => false)).toEqual([
      'install',
      'runFor',
      'pauseAt',
    ]);
  });

  it('refuses each guarded method, not only install', async () => {
    const clock = new StandInClock();
    refuseUndeclaredClock(clock, () => false);
    const error = await rejection(clock.pauseAt(10));
    expect(error.message).toContain('clock.pauseAt()');
  });

  it('reads the declaration when the clock is called, not when it is guarded', async () => {
    let declared = false;
    const clock = new StandInClock();
    refuseUndeclaredClock(clock, () => declared);
    declared = true;
    await clock.runFor(3);
    expect(clock.calls).toEqual(['runFor 3']);
  });

  it('guards a clock once, however often the fixture asks', async () => {
    const clock = new StandInClock();
    refuseUndeclaredClock(clock, () => true);
    expect(refuseUndeclaredClock(clock, () => true)).toEqual([
      'install',
      'runFor',
      'pauseAt',
    ]);
    await clock.runFor(1);
    expect(clock.calls).toEqual(['runFor 1']);
  });

  it('keeps the first declaration a clock was guarded with', async () => {
    let first = false;
    const clock = new StandInClock();
    refuseUndeclaredClock(clock, () => first);
    refuseUndeclaredClock(clock, () => true);
    await rejection((clock as unknown as Guarded).install());
    // Only the first declaration lets the next call through: the second never took over.
    first = true;
    await clock.install({ time: 1 });
    expect(clock.calls).toEqual(['install {"time":1}']);
  });

  it('refuses to guard a clock whose class defines no methods', () => {
    expect(() => refuseUndeclaredClock({}, () => false)).toThrow(
      /no clock methods/,
    );
  });
});

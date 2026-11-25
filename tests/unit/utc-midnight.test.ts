import { describe, expect, it } from 'vitest';
import { waitBeforeSeedingADay } from '../utc-midnight';

/**
 * A test that plants a row for "today" and then asks the server to count
 * against it must not straddle UTC midnight: the server would count against
 * a day the test never planted (#390 F50). Inside the window before
 * midnight it waits for the day to turn; anywhere else it waits for nothing.
 */
const at = (iso: string) => new Date(iso);

describe('waitBeforeSeedingADay', () => {
  it('waits for nothing well before midnight', () => {
    expect(waitBeforeSeedingADay(at('2026-11-09T12:00:00.000Z'))).toBe(0);
    expect(waitBeforeSeedingADay(at('2026-11-09T23:59:44.999Z'))).toBe(0);
  });

  it('waits until just past midnight inside the last 15 seconds', () => {
    expect(waitBeforeSeedingADay(at('2026-11-09T23:59:45.000Z'))).toBe(15_250);
    expect(waitBeforeSeedingADay(at('2026-11-09T23:59:59.900Z'))).toBe(350);
  });

  it('waits for nothing just after midnight', () => {
    expect(waitBeforeSeedingADay(at('2026-11-10T00:00:00.000Z'))).toBe(0);
  });
});

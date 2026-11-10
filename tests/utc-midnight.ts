/**
 * How long a test that plants a row for today must wait so it cannot
 * straddle UTC midnight (#390 F50).
 *
 * The functions suite plants `report_counts` rows for the test's own "today",
 * then the server counts against ITS today. A run crossing UTC midnight
 * (07:00 WIB) between the two seeds one day and counts another. Inside the
 * last `WINDOW_MS` of the day, the answer is the time until just past
 * midnight; anywhere else, nothing. A wait is cheaper than a guess: the
 * window is longer than either test takes, and shorter than its timeout.
 */
const WINDOW_MS = 15_000;
/** Past midnight by this much, so the server's clock has turned too. */
const MARGIN_MS = 250;
const DAY_MS = 86_400_000;

export const waitBeforeSeedingADay = (now: Date): number => {
  const untilMidnight = DAY_MS - (now.getTime() % DAY_MS);
  return untilMidnight <= WINDOW_MS ? untilMidnight + MARGIN_MS : 0;
};

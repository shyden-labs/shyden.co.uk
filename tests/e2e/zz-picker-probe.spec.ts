// PROBE for #1115, never merged: does a press on #cg-import shortly after
// the previous upload open no file chooser, and from what gap does it?
import { test } from './fixtures';
import { rosterOf } from './helpers';

const BAD = 'number,name,sex\n1,Ann,Male\n';
const GAPS = [0, 50, 100, 150, 200, 300, 500, 1000];
const REPS = 4;

test('PROBE #1115: a file chooser per press, by gap since the last upload @emulated-viewport', async ({
  page,
  browserName,
}) => {
  test.setTimeout(600_000);
  // H2: interception never switches off while this listener lives.
  page.on('filechooser', () => {});
  await rosterOf(page, 3);
  await page.locator('#cg-io-toggle').click();
  const press = async () => {
    const waiting = page
      .waitForEvent('filechooser', { timeout: 3_000 })
      .catch(() => null);
    await page.locator('#cg-import').click();
    return waiting;
  };
  // the first press, on a fresh input
  const first = await press();
  if (first === null)
    throw new Error('PROBE: the very first press opened no chooser');
  await first.setFiles({
    name: 'bad.csv',
    mimeType: 'text/csv',
    buffer: Buffer.from(BAD),
  });
  const rows: string[] = [];
  for (const gap of GAPS) {
    let hits = 0;
    let recoveredAfterMiss = 0;
    for (let i = 0; i < REPS; i++) {
      if (gap > 0) await page.waitForTimeout(gap);
      const chooser = await press();
      if (chooser !== null) {
        hits++;
        await chooser.setFiles({
          name: 'bad.csv',
          mimeType: 'text/csv',
          buffer: Buffer.from(BAD),
        });
        continue;
      }
      // a miss: does a press 1 s later get a chooser (transient), or never?
      await page.waitForTimeout(1_000);
      const later = await press();
      if (later !== null) {
        recoveredAfterMiss++;
        await later.setFiles({
          name: 'bad.csv',
          mimeType: 'text/csv',
          buffer: Buffer.from(BAD),
        });
      }
    }
    rows.push(
      `gap ${gap}ms: ${hits}/${REPS} hits, ${recoveredAfterMiss} recovered 1s after a miss`,
    );
  }
  const report = `PROBE-1115 ${browserName}: ${rows.join(' | ')}`;
  console.log(report);
  test.info().annotations.push({ type: 'probe', description: report });
});

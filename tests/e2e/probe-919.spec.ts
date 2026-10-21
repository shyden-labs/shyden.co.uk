// PROBE for #919, never merged: does Playwright's WebKit click stall on a
// minimal page whose button starts animations, as it does on the board?
import { test, expect } from '@playwright/test';

const PAGE = `<!doctype html><meta charset="utf-8">
<style>.dot{position:absolute;width:20px;height:20px;background:#08f;transition:transform 1.5s}
.go .dot{transform:translate(300px,200px)}</style>
<button id="go" style="width:120px;height:44px">Make Groups</button>
<div id="field">${Array.from({ length: 12 }, (_, i) => `<div class="dot" style="left:${i * 24}px;top:80px"></div>`).join('')}</div>
<script>
  window.frames_ = [];
  const tick = (t) => { window.frames_.push(t); requestAnimationFrame(tick); };
  requestAnimationFrame(tick);
  document.getElementById('go').addEventListener('click', () => {
    window.clickAt = performance.now();
    document.getElementById('field').className = 'go';
  });
</script>`;

test('probe 919: click duration on a minimal animating page', async ({
  page,
}) => {
  await page.setContent(PAGE);
  await page.waitForTimeout(200);
  const before = Date.now();
  await page.locator('#go').click();
  const clickMs = Date.now() - before;
  const gap = await page.evaluate(() => {
    const w = window as unknown as { frames_: number[]; clickAt: number };
    const after = w.frames_.filter((t) => t >= w.clickAt - 50);
    let worst = 0;
    for (let i = 1; i < after.length; i += 1)
      worst = Math.max(worst, (after[i] ?? 0) - (after[i - 1] ?? 0));
    return Math.round(worst);
  });
  console.log(
    `PROBE919 click ${clickMs} ms, largest frame gap after click ${gap} ms`,
  );
  expect(clickMs).toBeLessThan(2000);
});

import { test, expect } from './fixtures';
import { recorded, shoot } from './evidence';
import {
  recordRequests,
  requestsEveryEngineMakes,
  urlMatching,
} from './recorders';
import { atLeast44, expectNoHorizontalScroll } from '../viewport';
import { formTextsUnderAA, resolvedColour } from './helpers';
import { floorBreach } from '../floors';
import { searched } from '../source-files';
import {
  PREFIXED_LOCALES,
  getSiteStrings,
  getStrings,
} from '../../src/lib/i18n';
import { FOOTER_PAGE_IDS, pagePath } from '../../src/lib/report';

test.use(recorded);

test('the disclosure opens from the keyboard and walks its fields in order', async ({
  page,
  browserName,
}) => {
  await page.goto(pagePath('home', 'vi'));
  const t = getSiteStrings('vi').report;
  const summary = page.locator('[data-report] summary');
  await summary.focus();
  await page.keyboard.press('Enter');
  await expect(page.locator('[data-report]')).toHaveAttribute('open', '');
  for (const label of [t.quoteLabel, t.suggestionLabel, t.noteLabel]) {
    await page.keyboard.press('Tab');
    await expect(page.getByLabel(label, { exact: true })).toBeFocused();
  }
  const send = page.getByRole('button', { name: t.send });
  if (browserName === 'webkit') {
    // Safari leaves buttons out of the Tab sequence unless the visitor opts
    // in ("Press Tab to highlight each item"), so a Tab here would assert a
    // browser preference, not our markup (skip-link.spec.ts, chrome.spec.ts).
    // The fields above are in its sequence and were walked; the button is
    // held to being focusable.
    await send.focus();
  } else await page.keyboard.press('Tab');
  await expect(send).toBeFocused();
  // The hints are joined by aria-describedby (spec 3.4).
  await expect(
    page.getByLabel(t.quoteLabel, { exact: true }),
  ).toHaveAccessibleDescription(t.quoteHint);
  await expect(
    page.getByLabel(t.noteLabel, { exact: true }),
  ).toHaveAccessibleDescription(t.noteHint);
  // A formatter that re-wraps `<textarea></textarea>` gives it a default
  // value of whitespace, which a visitor would then submit.
  await expect(page.getByLabel(t.suggestionLabel, { exact: true })).toHaveValue(
    '',
  );
  await expect(page.getByLabel(t.noteLabel, { exact: true })).toHaveValue('');
  await shoot(
    page,
    'the open form, walked field by field',
    page.locator('[data-report]'),
  );
});

// Every locale that carries the form (#423): the 44px half measures its
// localised labels, and this read Thai alone.
for (const locale of PREFIXED_LOCALES)
  test(`${locale}: every control is at least 44px, every text meets AA, every field has a 3:1 boundary`, async ({
    page,
  }) => {
    await page.goto(pagePath('yeetalk-calculators', locale));
    const t = getSiteStrings(locale).report;
    await page.locator('[data-report] summary').click();
    for (const target of [
      page.locator('[data-report] summary'),
      page.getByLabel(t.quoteLabel, { exact: true }),
      page.getByLabel(t.suggestionLabel, { exact: true }),
      page.getByLabel(t.noteLabel, { exact: true }),
      page.getByRole('button', { name: t.send }),
    ])
      await atLeast44(target);
    const { failing, read } = await formTextsUnderAA(
      page.locator('[data-report]'),
      page.getByRole('button', { name: t.send }),
    );
    expect(
      searched(failing, { of: read, what: `${locale} form texts` }),
    ).toEqual([]);
    // WCAG 1.4.11: each field's boundary is --border-strong, the token
    // contrast.test.ts scores at 3:1. #133 shipped --border (1.17:1) on every
    // control. Resolved by the browser, so both sides are computed rgb.
    const strong = await resolvedColour(page, 'var(--border-strong)');
    for (const label of [t.quoteLabel, t.suggestionLabel, t.noteLabel])
      await expect(page.getByLabel(label, { exact: true })).toHaveCSS(
        'border-top-color',
        strong,
      );
  });

for (const locale of PREFIXED_LOCALES)
  for (const pageId of FOOTER_PAGE_IDS)
    test(
      `${pagePath(pageId, locale)}: no sideways scroll at 320px with the form open`,
      { tag: '@emulated-viewport' },
      async ({ page }) => {
        await page.setViewportSize({ width: 320, height: 800 });
        await page.goto(pagePath(pageId, locale));
        await page.locator('[data-report] summary').click();
        await expect(page.locator('[data-report]')).toHaveAttribute('open', '');
        await expectNoHorizontalScroll(page);
        // Page-level scrollWidth is not containment (CLAUDE.md): nothing in the
        // form may escape the footer's own column.
        const column = await page.locator('footer .inner').boundingBox();
        expect(column, 'the footer column has a box').not.toBeNull();
        const boxes = await page
          .locator(
            '[data-report] form > *:not(.hp):not(input[type="hidden"]):not(datalist)',
          )
          .evaluateAll((els) =>
            els.map((el) => ({
              right: el.getBoundingClientRect().right,
              name: el.tagName,
            })),
          );
        for (const box of boxes)
          expect(box.right, box.name).toBeLessThanOrEqual(
            column!.x + column!.width + 0.5,
          );
        // Liveness by content, after the invariant: the widest controls were measured.
        expect(boxes.map(({ name }) => name)).toEqual(
          expect.arrayContaining(['INPUT', 'TEXTAREA', 'BUTTON']),
        );
      },
    );

test('/vi/classroom-groups submits in place: failed shows, takes focus, and the roster survives', async ({
  page,
}) => {
  const tool = getStrings('vi');
  const t = getSiteStrings('vi').report;
  await page.goto(pagePath('classroom-groups', 'vi'));
  await page.locator('#cg-students-toggle').click();
  await page.getByRole('button', { name: tool.rosterAddStudent }).click();
  await page
    .locator('.cg-student')
    .first()
    .getByLabel(tool.rosterColName)
    .fill('Lan');
  await page.evaluate(
    () => ((window as unknown as { unreloaded: boolean }).unreloaded = true),
  );

  await page.locator('[data-report] summary').click();
  await page.getByLabel(t.quoteLabel, { exact: true }).fill(t.open);
  await page.getByRole('button', { name: t.send }).click();

  const failed = page.locator('#report-failed');
  await expect(failed).toBeVisible();
  await expect(failed).toHaveText(t.failed);
  await expect(failed).toBeFocused();
  await expect(page.locator('#report-sent')).toBeHidden();
  expect(
    await page.evaluate(
      () => (window as unknown as { unreloaded?: boolean }).unreloaded,
    ),
  ).toBe(true);
  await expect(
    page.locator('.cg-student').first().getByLabel(tool.rosterColName),
  ).toHaveValue('Lan');
  await expect(page.getByLabel(t.quoteLabel, { exact: true })).toHaveValue(
    t.open,
  );
  await shoot(
    page,
    'the failed status, with the roster and the quote kept',
    page.locator('[data-report]'),
  );
});

// #390 RF1/RF2. "One submission at a time" and "Send comes back for the next
// report" were held by nothing: deleting the pending guard, or never
// re-enabling the button, passed every test. The first submit is held at the
// network so a second can try to start beside it. Two `requestSubmit` calls
// reach the script even while the button is disabled, which is the very case
// the guard exists for. The count is read only after a THIRD submission has
// answered, so every earlier request has already been routed: 2 means the
// pair sent one, 3 means it sent two.
test('/vi/classroom-groups: one report at a time, and Send comes back for the next', async ({
  page,
}) => {
  const t = getSiteStrings('vi').report;
  let routed = 0;
  let release!: () => void;
  const held = new Promise<void>((resolve) => (release = resolve));
  await page.route('**/api/report', async (route) => {
    routed += 1;
    if (routed === 1) await held;
    await route.fulfill({
      status: 503,
      contentType: 'application/json',
      body: JSON.stringify({ outcome: 'failed' }),
    });
  });
  await page.goto(pagePath('classroom-groups', 'vi'));
  await page.locator('[data-report] summary').click();
  await page.getByLabel(t.quoteLabel, { exact: true }).fill(t.open);
  const send = page.getByRole('button', { name: t.send });

  await page.locator('[data-report-form]').evaluate((form: HTMLFormElement) => {
    form.requestSubmit();
    form.requestSubmit();
  });
  await expect(send).toBeDisabled();
  release();
  await expect(page.locator('#report-failed')).toBeVisible();
  await expect(send).toBeEnabled();
  await shoot(
    page,
    'Send is back once the answer arrives',
    page.locator('[data-report]'),
  );

  // A predicate, not the `'**/api/report'` glob: waitForResponse resolves a
  // string against baseURL, which the device fixtures do not patch for it
  // (baseurl-guard.spec.ts).
  await Promise.all([
    page.waitForResponse((response) =>
      new URL(response.url()).pathname.endsWith('/api/report'),
    ),
    send.click(),
  ]);
  expect(routed, 'two submissions at once sent more than one report').toBe(2);
});

test('/vi/classroom-groups: sending a report makes no request off the site (AC11)', async ({
  page,
}) => {
  const seen = recordRequests(page);
  const t = getSiteStrings('vi').report;
  await page.goto(pagePath('classroom-groups', 'vi'));
  await page.locator('[data-report] summary').click();
  await page.getByLabel(t.quoteLabel, { exact: true }).fill(t.open);
  await page.getByRole('button', { name: t.send }).click();
  await expect(page.locator('#report-failed')).toBeVisible();
  // Liveness by content: the report itself is among the requests seen.
  await expect
    .poll(() => seen.matching(urlMatching(/\/api\/report$/)).length)
    .toBe(1);
  const origin = new URL(page.url()).origin;
  // Every request is searched, fonts and images included; `heard` only
  // counts, so the floor reads one figure on all five engines.
  const heard = requestsEveryEngineMakes(seen.all);
  expect(
    searched(
      seen.matching((request) => new URL(request.url).origin !== origin),
      { of: heard, what: 'requests the page made' },
    ),
    'AC11: a request left the site',
  ).toEqual([]);
  expect(
    floorBreach('report-form/report-send-requests', heard.length),
  ).toBeUndefined();
});

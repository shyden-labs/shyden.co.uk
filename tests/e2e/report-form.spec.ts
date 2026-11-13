import { tabKey } from '../tab-key';
import { tabTo } from '../tab-to';
import { tapOn } from '../real-touch';
import { typeInto } from '../real-typing';
import { test, expect } from './fixtures';
import { recorded, shoot } from './evidence';
import {
  recordRequests,
  requestsEveryEngineMakes,
  urlMatching,
} from './recorders';
import { searched } from '../source-files';
import { getSiteStrings, getStrings } from '../../src/lib/i18n';
import { pagePath } from '../../src/lib/report';

test.use(recorded);

test('the disclosure opens from the keyboard and walks its fields in order', async ({
  page,
  browserName,
}) => {
  await page.goto(pagePath('home', 'vi'));
  const t = getSiteStrings('vi').report;
  const summary = page.locator('[data-report] summary');
  await tabTo(summary);
  await page.keyboard.press('Enter');
  await expect(page.locator('[data-report]')).toHaveAttribute('open', '');
  for (const label of [t.quoteLabel, t.suggestionLabel, t.noteLabel]) {
    await page.keyboard.press('Tab');
    await expect(page.getByLabel(label, { exact: true })).toBeFocused();
  }
  const send = page.getByRole('button', { name: t.send });
  // Safari leaves buttons out of a plain Tab walk unless the visitor opts in
  // ("Press Tab to highlight each item"); Option+Tab, its own way of reaching
  // every control, takes the next step there (tabKey).
  await page.keyboard.press(tabKey(browserName));
  await expect(send).toBeFocused();
  // The hints are joined by aria-describedby (spec 3.4).
  await expect(
    page.getByLabel(t.quoteLabel, { exact: true }),
  ).toHaveAccessibleDescription(t.quoteHint);
  // One line, above both free-text boxes, says to leave personal details out,
  // and each box announces it (#830, Shyden 2026-10-19: one line above both).
  await expect(
    page.getByLabel(t.suggestionLabel, { exact: true }),
  ).toHaveAccessibleDescription(t.personalDetailsHint);
  await expect(
    page.getByLabel(t.noteLabel, { exact: true }),
  ).toHaveAccessibleDescription(t.personalDetailsHint);
  const form = page.locator('[data-report] form');
  const hint = form.getByText(t.personalDetailsHint, { exact: true });
  await expect(hint).toBeVisible();
  await expect(hint).toHaveCount(1);
  const [quoteHint, between, suggestion] = await Promise.all([
    form.getByText(t.quoteHint, { exact: true }).boundingBox(),
    hint.boundingBox(),
    form.getByText(t.suggestionLabel, { exact: true }).boundingBox(),
  ]);
  expect(between!.y).toBeGreaterThanOrEqual(quoteHint!.y + quoteHint!.height);
  expect(between!.y + between!.height).toBeLessThanOrEqual(suggestion!.y);
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

// The form's targets, contrast and 320px fit, opened by a real tap, are read
// on each footed page's walk: checks/report-form.ts (#1086).

test('/vi/classroom-groups submits in place: failed shows, takes focus, and the roster survives', async ({
  page,
}) => {
  const tool = getStrings('vi');
  const t = getSiteStrings('vi').report;
  await page.goto(pagePath('classroom-groups', 'vi'));
  await tapOn(page.locator('#cg-students-toggle'));
  await tapOn(page.getByRole('button', { name: tool.rosterAddStudent }));
  await typeInto(
    page.locator('.cg-student').first().getByLabel(tool.rosterColName),
    'Lan',
  );
  await page.evaluate(
    () => ((window as unknown as { unreloaded: boolean }).unreloaded = true),
  );

  await tapOn(page.locator('[data-report] summary'));
  await typeInto(page.getByLabel(t.quoteLabel, { exact: true }), t.open);
  await tapOn(page.getByRole('button', { name: t.send }));

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
  await tapOn(page.locator('[data-report] summary'));
  await typeInto(page.getByLabel(t.quoteLabel, { exact: true }), t.open);
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
    tapOn(send),
  ]);
  expect(routed, 'two submissions at once sent more than one report').toBe(2);
});

test('/vi/classroom-groups: sending a report makes no request off the site (AC11)', async ({
  page,
}) => {
  const seen = recordRequests(page);
  const t = getSiteStrings('vi').report;
  await page.goto(pagePath('classroom-groups', 'vi'));
  await tapOn(page.locator('[data-report] summary'));
  await typeInto(page.getByLabel(t.quoteLabel, { exact: true }), t.open);
  await tapOn(page.getByRole('button', { name: t.send }));
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
});

// #872: a daily limit's 429 shows its own message in place, and no other.
// Form mode is report-presence.spec.ts's, per locale.
for (const [outcome, key] of [
  ['form-full', 'formFull'],
  ['connection-full', 'connectionFull'],
] as const)
  test(`/vi/classroom-groups: a 429 ${outcome} shows its message in place`, async ({
    page,
  }) => {
    const t = getSiteStrings('vi').report;
    await page.route('**/api/report', (route) =>
      route.fulfill({
        status: 429,
        contentType: 'application/json',
        body: JSON.stringify({ outcome }),
      }),
    );
    await page.goto(pagePath('classroom-groups', 'vi'));
    await tapOn(page.locator('[data-report] summary'));
    await typeInto(page.getByLabel(t.quoteLabel, { exact: true }), t.open);
    await tapOn(page.getByRole('button', { name: t.send }));
    const shown = page.locator(`#report-${outcome}`);
    await expect(shown).toBeVisible();
    await expect(shown).toHaveText(t[key]);
    await expect(page.locator('[data-report-status]:visible')).toHaveCount(1);
    await shoot(page, `The ${outcome} message, in place`, shown);
  });

test('typing into the report form keeps what was typed (moved from the phone file, #1049)', async ({
  page,
}) => {
  // The phone's datalist crash (#807) showed on exactly this sequence; the Chrome-process half
  // stays in tests/device/real-device.spec.ts. English draws no report form; Indonesian does.
  await page.goto('/id/');
  const report = page.locator('[data-report]');
  const quote = report.locator('#report-quote');
  await tabTo(report.locator('summary'));
  await page.keyboard.press('Enter');
  await page.keyboard.press('Tab');
  await expect(quote).toBeFocused();
  await page.keyboard.type('Tem', { delay: 120 });
  await expect(quote).toHaveValue('Tem');
});

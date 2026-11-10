import { doubleTapOn, tapOn } from '../real-touch';
import { typeInto } from '../real-typing';
import { randomUUID } from 'node:crypto';
import {
  test,
  expect,
  type APIRequestContext,
  type Page,
} from '@playwright/test';
import {
  LOCALES,
  getSiteStrings,
  getStrings,
  isBetaLocale,
} from '../../src/lib/i18n';
import { pagePath } from '../../src/lib/report';
import { REVIEW_SELECT } from '../../src/lib/report-review';
import { COUNT_SQL } from '../../src/lib/waiting-reports';
import { expectReportsBound } from '../report-health';
import { searched } from '../source-files';
import {
  BASE_URL,
  plantReport,
  query,
  reportsStartingWith,
  reportsWithNote,
} from './local.mjs';
import { waitBeforeSeedingADay } from '../utc-midnight';

const vi = getSiteStrings('vi').report;
const tool = getStrings('vi');
const noteFor = (what: string) => `functions test ${what} ${randomUUID()}`;

// Each test starts the day with no counts (#872): the limits are on here,
// so every report below also runs the counting batch on real D1.
test.beforeEach(async () => {
  await query('DELETE FROM report_counts');
});

async function fillReport(page: Page, quote: string, note: string) {
  await tapOn(page.locator('[data-report] summary'));
  await typeInto(page.getByLabel(vi.quoteLabel, { exact: true }), quote);
  await typeInto(page.getByLabel(vi.noteLabel, { exact: true }), note);
}

test('the health check sees the binding and the migrated table', async ({
  request,
}) => {
  await expectReportsBound(request);
});

test.describe('with JavaScript disabled', () => {
  test.use({ javaScriptEnabled: false });

  // The tag is `isolated-context-tagging`'s rule for every spec directory:
  // javaScriptEnabled is inert on the real-device harness. This suite never
  // runs there, and the tag says so rather than leaving it to be noticed.
  test(
    'the homepage posts, lands on #report-sent, and the row is stored',
    { tag: '@javascript-blocked' },
    async ({ page }) => {
      const note = noteFor('homepage');
      await page.goto(pagePath('home', 'vi'));
      await fillReport(page, vi.open, note);
      await tapOn(page.getByRole('button', { name: vi.send }));
      await expect(page).toHaveURL(/\/vi\/#report-sent$/);
      await expect(page.locator('#report-sent')).toBeVisible();
      const rows = await reportsWithNote(note);
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({
        locale: 'vi',
        page: 'home',
        quote: vi.open,
        suggestion: '',
        note,
      });
      expect(JSON.parse(rows[0].keys)).toContain('site.report.open');
    },
  );

  test(
    'a quote on no page lands on #report-not-found and stores nothing',
    { tag: '@javascript-blocked' },
    async ({ page }) => {
      const stem = noteFor('not-found');
      const note = `${stem} refused`;
      await plantReport(`${stem} control`);
      await page.goto(pagePath('home', 'vi'));
      await fillReport(page, 'on no page at all, anywhere', note);
      await tapOn(page.getByRole('button', { name: vi.send }));
      await expect(page).toHaveURL(/#report-not-found$/);
      await expect(page.locator('#report-not-found')).toBeVisible();
      // Drawn from the table's own rows under this test's stem: the planted
      // control, which the endpoint did not write. One row, on every engine.
      const stored = await reportsStartingWith(stem);
      expect(
        searched(await reportsWithNote(note), {
          of: stored,
          what: 'reports stored under this test',
        }),
      ).toEqual([]);
    },
  );

  for (const locale of LOCALES.filter(isBetaLocale))
    test(
      `the 404's ${locale} block stores its own locale and notFound key`,
      { tag: '@javascript-blocked' },
      async ({ page }) => {
        const t = getSiteStrings(locale);
        const note = noteFor(`404 ${locale}`);
        const block = page.locator(`details[data-report][lang="${locale}"]`);
        await page.goto('/404');
        await tapOn(block.locator('summary'));
        await typeInto(
          block.getByLabel(t.report.quoteLabel, { exact: true }),
          t.notFound.heading,
        );
        await typeInto(
          block.getByLabel(t.report.noteLabel, { exact: true }),
          note,
        );
        await tapOn(block.getByRole('button', { name: t.report.send }));
        await expect(page).toHaveURL(new RegExp(`/404#report-${locale}-sent$`));
        await expect(page.locator(`#report-${locale}-sent`)).toBeVisible();
        const rows = await reportsWithNote(note);
        expect(rows).toHaveLength(1);
        expect(rows[0]).toMatchObject({
          locale,
          page: 'not-found',
          quote: t.notFound.heading,
          note,
        });
        expect(JSON.parse(rows[0].keys)).toEqual(['site.notFound.heading']);
      },
    );

  test(
    "another block's words are not found in this one, and nothing is stored",
    { tag: '@javascript-blocked' },
    async ({ page }) => {
      const stem = noteFor('404 cross-block');
      const note = `${stem} refused`;
      await plantReport(`${stem} control`);
      const block = page.locator('details[data-report][lang="vi"]');
      await page.goto('/404');
      await tapOn(block.locator('summary'));
      await typeInto(
        block.getByLabel(vi.quoteLabel, { exact: true }),
        getSiteStrings('zh').notFound.heading,
      );
      await typeInto(block.getByLabel(vi.noteLabel, { exact: true }), note);
      await tapOn(block.getByRole('button', { name: vi.send }));
      await expect(page).toHaveURL(/\/404#report-vi-not-found$/);
      await expect(page.locator('#report-vi-not-found')).toBeVisible();
      // The planted control is the only row under this test's stem.
      const stored = await reportsStartingWith(stem);
      expect(
        searched(await reportsWithNote(note), {
          of: stored,
          what: 'reports stored under this test',
        }),
      ).toEqual([]);
    },
  );
});

test('a cross-origin POST is refused and stores nothing', async ({
  request,
}) => {
  const stem = noteFor('cross-origin');
  const note = `${stem} refused`;
  await plantReport(`${stem} control`);
  const response = await request.post('/api/report', {
    headers: {
      Origin: 'https://evil.example',
      'Content-Type': 'application/x-www-form-urlencoded',
      Accept: 'application/json',
    },
    data: new URLSearchParams({
      locale: 'vi',
      page: 'home',
      quote: vi.open,
      note,
    }).toString(),
  });
  expect(response.status()).toBe(403);
  // The planted control is the only row under this test's stem.
  const stored = await reportsStartingWith(stem);
  expect(
    searched(await reportsWithNote(note), {
      of: stored,
      what: 'reports stored under this test',
    }),
  ).toEqual([]);
});

test.describe('on a tool page', () => {
  async function typeARoster(page: Page) {
    await page.goto(pagePath('classroom-groups', 'vi'));
    await tapOn(page.locator('#cg-students-toggle'));
    await tapOn(page.getByRole('button', { name: tool.rosterAddStudent }));
    await typeInto(
      page.locator('.cg-student').first().getByLabel(tool.rosterColName),
      'Lan',
    );
  }

  test('/vi/classroom-groups sends in place and the roster is still there', async ({
    page,
  }) => {
    const note = noteFor('roster');
    await typeARoster(page);
    await fillReport(page, vi.open, note);
    await tapOn(page.getByRole('button', { name: vi.send }));
    const sent = page.locator('#report-sent');
    await expect(sent).toBeVisible();
    await expect(sent).toBeFocused();
    await expect(
      page.locator('.cg-student').first().getByLabel(tool.rosterColName),
    ).toHaveValue('Lan');
    await expect(page.getByLabel(vi.quoteLabel, { exact: true })).toHaveValue(
      '',
    );
    expect(await reportsWithNote(note)).toHaveLength(1);
  });

  test('a double click stores one report', async ({ page }) => {
    const note = noteFor('double-click');
    await typeARoster(page);
    await fillReport(page, vi.open, note);
    await doubleTapOn(page.getByRole('button', { name: vi.send }));
    await expect(page.locator('#report-sent')).toBeVisible();
    expect(await reportsWithNote(note)).toHaveLength(1);
  });

  test('a later outcome replaces the earlier one', async ({ page }) => {
    const note = noteFor('replace');
    await typeARoster(page);
    await fillReport(page, 'on no page at all, anywhere', note);
    await tapOn(page.getByRole('button', { name: vi.send }));
    await expect(page.locator('#report-not-found')).toBeVisible();
    await typeInto(page.getByLabel(vi.quoteLabel, { exact: true }), vi.open);
    await tapOn(page.getByRole('button', { name: vi.send }));
    await expect(page.locator('#report-sent')).toBeVisible();
    await expect(page.locator('#report-not-found')).toBeHidden();
    await expect(page.locator('.report-status:visible')).toHaveCount(1);
  });

  test('an outcome in place supersedes the one a fragment shows', async ({
    page,
  }) => {
    // A click before the script loads posts the plain form and lands here
    // with a fragment; the next report is sent in place.
    const note = noteFor('fragment');
    await page.goto(`${pagePath('classroom-groups', 'vi')}#report-not-found`);
    await expect(page.locator('#report-not-found')).toBeVisible();
    await fillReport(page, vi.open, note);
    await tapOn(page.getByRole('button', { name: vi.send }));
    await expect(page.locator('#report-sent')).toBeVisible();
    await expect(page.locator('#report-not-found')).toBeHidden();
    await expect(page.locator('.report-status:visible')).toHaveCount(1);
    expect(await reportsWithNote(note)).toHaveLength(1);
  });
});

const today = () => new Date().toISOString().slice(0, 10);
/**
 * Planting a row for today is only safe when today will still be today when
 * the server counts: inside the last seconds before UTC midnight, wait for
 * the day to turn first, and say so (#390 F50).
 */
const awayFromMidnight = async () => {
  const wait = waitBeforeSeedingADay(new Date());
  if (wait === 0) return;
  console.log(
    `waiting ${wait} ms for UTC midnight to pass before seeding today`,
  );
  await new Promise((resolve) => setTimeout(resolve, wait));
};
const send = (request: APIRequestContext, ip: string, note: string) =>
  request.post('/api/report', {
    headers: {
      Origin: BASE_URL,
      Accept: 'application/json',
      'CF-Connecting-IP': ip,
    },
    form: {
      locale: 'vi',
      page: 'home',
      quote: vi.open,
      suggestion: '',
      note,
      website: '',
    },
  });

test.describe('the daily limits on real D1 (#872)', () => {
  test('a 6th report from one address is refused; another address is not', async ({
    request,
  }) => {
    const note = noteFor('connection-limit');
    const five: number[] = [];
    for (let at = 1; at <= 5; at++)
      five.push((await send(request, '203.0.113.9', note)).status());
    expect(five).toEqual([200, 200, 200, 200, 200]);
    const sixth = await send(request, '203.0.113.9', note);
    expect(sixth.status()).toBe(429);
    expect(await sixth.json()).toEqual({ outcome: 'connection-full' });
    expect((await send(request, '203.0.113.10', note)).status()).toBe(200);
    expect(await reportsWithNote(note)).toHaveLength(6);
  });
  test('two addresses in one IPv6 /64 share one count', async ({ request }) => {
    const note = noteFor('ipv6-block');
    const five: number[] = [];
    for (let at = 1; at <= 5; at++)
      five.push((await send(request, `2001:db8:1:2::${at}`, note)).status());
    expect(five).toEqual([200, 200, 200, 200, 200]);
    expect((await send(request, '2001:db8:1:2:ffff::9', note)).status()).toBe(
      429,
    );
    expect((await send(request, '2001:db8:1:3::1', note)).status()).toBe(200);
  });
  test('the 50th report is stored and the 51st refused', async ({
    request,
  }) => {
    await awayFromMidnight();
    await query(
      "INSERT INTO report_counts (day, counter, count) VALUES (?1, 'all', 49)",
      [today()],
    );
    const note = noteFor('total-limit');
    expect((await send(request, '198.51.100.1', note)).status()).toBe(200);
    const last = await send(request, '198.51.100.2', note);
    expect(last.status()).toBe(429);
    expect(await last.json()).toEqual({ outcome: 'form-full' });
    expect(await reportsWithNote(note)).toHaveLength(1);
  });
  test("yesterday's counts are gone after today's first report", async ({
    request,
  }) => {
    await awayFromMidnight();
    await query(
      "INSERT INTO report_counts (day, counter, count) VALUES ('2000-01-01', 'all', 3)",
    );
    expect(
      (await send(request, '198.51.100.3', noteFor('prune'))).status(),
    ).toBe(200);
    // The whole table, read exactly: today's two rows, and so not the planted one.
    expect(
      await query(
        "SELECT day, counter FROM report_counts ORDER BY counter = 'all' DESC",
      ),
    ).toEqual([
      { day: today(), counter: 'all' },
      { day: today(), counter: expect.stringMatching(/^[0-9a-f]{64}$/) },
    ]);
  });
  test('8 reports at once from one address store exactly 5', async ({
    request,
  }) => {
    const note = noteFor('concurrent');
    const statuses = (
      await Promise.all(
        Array.from({ length: 8 }, () => send(request, '203.0.113.50', note)),
      )
    ).map((response) => response.status());
    expect(statuses.filter((status) => status === 200)).toHaveLength(5);
    expect(statuses.filter((status) => status === 429)).toHaveLength(3);
    expect(await reportsWithNote(note)).toHaveLength(5);
  });
  test('no count row holds an address', async ({ request }) => {
    await send(request, '203.0.113.77', noteFor('no-address'));
    const rows = await query('SELECT day, counter, count FROM report_counts');
    expect(rows).toHaveLength(2);
    expect(JSON.stringify(rows)).not.toContain('203.0.113');
    const counters = rows.map(({ counter }) => counter);
    expect(counters).toContain('all');
    expect(counters.filter((counter) => counter !== 'all')).toEqual([
      expect.stringMatching(/^[0-9a-f]{64}$/),
    ]);
  });
});

/**
 * Reports are kept for a year (Shyden, 2026-11-11, #1140). Run on the real
 * table, because what is deleted rests on SQLite comparing an ISO timestamp
 * with a day, which no stand-in performs.
 */
test('a report written deletes the year-old ones; the count and review read what is left (#1140)', async ({
  request,
}) => {
  await awayFromMidnight();
  const daysAgo = (days: number) => {
    const at = new Date(`${today()}T12:00:00.000Z`);
    at.setUTCDate(at.getUTCDate() - days);
    return at.toISOString();
  };
  const plantAged = async (days: number) => {
    const id = randomUUID();
    await query(
      "INSERT INTO reports (id, received_at, locale, page, quote, keys, suggestion, note) VALUES (?, ?, 'vi', 'home', 'planted aged', '[]', '', ?)",
      [id, daysAgo(days), noteFor(`aged ${days}`)],
    );
    return id;
  };
  const count = async () => (await query(COUNT_SQL))[0]!['count(*)'] as number;
  const old = await plantAged(366);
  const recent = await plantAged(364);
  const before = await count();

  expect(
    (await send(request, '198.51.100.40', noteFor('retire'))).status(),
  ).toBe(200);

  const ids = (await query(REVIEW_SELECT)).map(({ id }) => id);
  expect(ids).not.toContain(old);
  expect(ids).toContain(recent);
  // One deleted, one written: the count is unchanged and matches the review.
  expect(await count()).toBe(before);
  expect(ids).toHaveLength(before);
});

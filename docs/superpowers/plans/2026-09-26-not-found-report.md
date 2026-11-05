# The 404's report route (#350) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** each translated `notFound` block on the 404 carries #97's report form, posting its own locale, with no second copy of the form.

**Architecture:** the footer's form moves into `src/components/ReportForm.astro`, which the footer and the 404 both render. `src/lib/report.ts` gains the page id `not-found`, a non-localised path (`/404`), and `reportIdStem`, which gives the four forms on one page distinct ids. The endpoint is unchanged except that it accepts the new id and redirects through the stem.

**Tech Stack:** Astro 6, TypeScript, Vitest, Playwright, Cloudflare Pages Functions under `wrangler pages dev`.

**Spec:** `docs/superpowers/specs/2026-09-23-translation-reports-design.md`, section 14 (#350) on top of sections 3-6 (#97).

## Global Constraints

- `isBetaLocale` decides whether a form is drawn. Never enumerate locales (AC3).
- The 404 ships the inline theme script and nothing else (`theme-script.spec.ts`, AC4).
- One home: the form's markup, its styles and its matching each exist once (AC2, spec 4.2).
- Mobile-first: no horizontal scroll at 320px, targets at least 44px, WCAG AA in both themes and in print (AC6).
- Every changed guard is mutation-verified in both directions. Commit before any mutation.
- Commit messages carry `Refs #350`, never a closing keyword.

## Review Focus

1. **Two forms answering to one id.** A block whose fields reuse `report-quote` would label the wrong field for a screen reader, and `:target` would show the wrong status. Pinned in Task 2 by the status test (one visible, focused, in the block's language) and the per-block label test.
2. **A block posting the page's locale (`en`) instead of its own.** The endpoint would refuse it with a 400. Pinned in Task 2 (hidden-field values per block) and Task 3 (a stored row per locale).
3. **A quote from another block.** The Chinese heading sent from the Vietnamese form must be `not-found`, which proves the locale comes from the block. Pinned in Task 3.
4. **The type-ahead satisfying a copy scan.** Four datalists on the 404 would make "the 404 speaks it" pass for text no block shows. Pinned in Task 2 by counting forms and by the M8 mutation.
5. **The footer pages changing when the markup moves.** Pinned by the existing footer specs, which run unchanged apart from the rename, and by a visual compare of every existing baseline with nothing written (Task 4).

---

### Task 1: The page table knows the 404

**Files:**
- Modify: `src/lib/report.ts` (page table, `pageIdFromPath`, `pagePath`, `reportableStrings`, `outcome`)
- Test: `tests/unit/report.test.ts`, `tests/unit/report-endpoint.test.ts`
- Modify (rename only): `tests/e2e/report-form.spec.ts`, `tests/e2e/report-presence.spec.ts`, `tests/e2e/report-completeness.spec.ts`

**Interfaces:**
- Produces: `FOOTER_PAGE_IDS`, `type FooterPageId`, `PAGE_IDS` (now four ids), `type PageId`, `pageIdFromPath(path): FooterPageId | null`, `pagePath(page, locale): string`, `reportIdStem(page: PageId, locale: Locale): string`.

- [ ] **Step 1: Write the failing unit tests**

In `tests/unit/report.test.ts`, add `FOOTER_PAGE_IDS` and `reportIdStem` to the import from `../../src/lib/report`, and `LOCALES` and `isBetaLocale` to the import from `../../src/lib/i18n`. The locales are derived, never listed (Global Constraints). Replace the first test of `describe('the page table')` with:

```ts
  it('knows the three pages with a footer, and the 404 besides', () => {
    expect(FOOTER_PAGE_IDS).toEqual(['home', 'glory-points', 'classroom-groups']);
    expect(PAGE_IDS).toEqual([
      'home',
      'glory-points',
      'classroom-groups',
      'not-found',
    ]);
    expect(isPageId('home')).toBe(true);
    expect(isPageId('not-found')).toBe(true);
    expect(isPageId('404')).toBe(false);
    expect(isPageId(undefined)).toBe(false);
  });
```

Append to the `builds the path the site links use` test:

```ts
    // The 404 is one file for every locale (spec 14.3).
    expect(pagePath('not-found', 'vi')).toBe('/404');
    expect(pagePath('not-found', 'th')).toBe('/404');
```

Add, inside `describe('the page table')`:

```ts
  it('gives the 404 one id stem per locale, and every other page one', () => {
    expect(reportIdStem('home', 'vi')).toBe('report');
    expect(reportIdStem('classroom-groups', 'th')).toBe('report');
    expect(reportIdStem('not-found', 'vi')).toBe('report-vi');
    expect(reportIdStem('not-found', 'zh')).toBe('report-zh');
  });
```

Replace `no page offers the 404 copy` with:

```ts
  it('no footer page offers the 404 copy', () => {
    for (const page of FOOTER_PAGE_IDS)
      expect(
        [...keysOn(page, 'vi')].filter((key) =>
          key.startsWith('site.notFound.'),
        ),
      ).toEqual([]);
  });

  it.each(LOCALES.filter(isBetaLocale))(
    'the 404 offers the notFound copy its %s block shows, and nothing else',
    (locale) => {
      // No chrome (the 404's is English) and no title or description (a
      // document has one of each, the default locale's): spec 14.2.
      expect(keysOn('not-found', locale)).toEqual(
        new Set([
          'site.notFound.heading',
          'site.notFound.body',
          'site.notFound.backHome',
        ]),
      );
    },
  );
```

In `every page carries every chrome entry…`, change `for (const page of PAGE_IDS)` to `for (const page of FOOTER_PAGE_IDS)`.

In `agrees with label-check about which site sections are chrome`, the 404 now offers `notFound`. label-check calls that section "the 404 page", so the agreement becomes positive. Replace its first two branches with:

```ts
      if (where === CHROME)
        expect(pages, section).toEqual([...FOOTER_PAGE_IDS]);
      else if (where === 'the 404 page')
        expect(pages, section).toEqual(['not-found']);
      else
```

`searched` is then unused in this file, so the import becomes `import { nonEmpty } from '../source-files';`.

In `tests/unit/report-endpoint.test.ts`, add inside `describe('check 5 and the honeypot')`:

```ts
  it('5: accepts the 404 as not-found and answers on /404 with the block stem', async () => {
    const heading = getSiteStrings('th').notFound.heading;
    const response = await answer(
      post(valid({ locale: 'th', page: 'not-found', quote: heading })),
    );
    // No database: the quote matched, so it reached the insert and failed.
    expect(response.status).toBe(303);
    expect(response.headers.get('Location')).toBe('/404#report-th-failed');
  });

  it('8: the 404 matches only its own block, never the footer chrome', async () => {
    const footer = getSiteStrings('vi').report.open;
    const response = await answer(
      post(valid({ page: 'not-found', quote: footer })),
    );
    expect(response.headers.get('Location')).toBe('/404#report-vi-not-found');
  });
```

- [ ] **Step 2: Run them red**

Run: `npx vitest run tests/unit/report.test.ts tests/unit/report-endpoint.test.ts`
Before running, add stubs to `report.ts` so the file compiles and each test fails on its own assertion: `export const FOOTER_PAGE_IDS = PAGE_IDS;`, and an `export const reportIdStem` whose body throws `not implemented`.
Expected: 9 FAIL: the two endpoint tests, the page-table test, the path test, the stem test and the four `the 404 offers…` tests. The renamed `no footer page offers the 404 copy` passes, because its behaviour already holds. Any other test that passes against the stubs is a finding.

- [ ] **Step 3: Implement in `src/lib/report.ts`**

Replace the `PAGE_IDS` and `PageId` declarations with:

```ts
/** The pages whose footer carries the form: one form, the locale in the path. */
export const FOOTER_PAGE_IDS = [
  'home',
  'glory-points',
  'classroom-groups',
] as const;
export type FooterPageId = (typeof FOOTER_PAGE_IDS)[number];

/**
 * Every value the endpoint's `page` field accepts. `not-found` is the 404
 * (#350, spec 14): one path for every locale, one form per translated block.
 */
export const PAGE_IDS = [...FOOTER_PAGE_IDS, 'not-found'] as const;
export type PageId = (typeof PAGE_IDS)[number];
```

Replace `interface PageEntry`, `PAGES` and `NEVER_OFFERED` with:

```ts
interface PageEntry {
  /** The path in the default locale. */
  readonly route: string;
  /**
   * Whether the path names its locale. The 404's does not, so it answers on
   * one path in every locale and carries one form per locale (spec 14.3).
   */
  readonly localised: boolean;
  /** The site-catalogue section only this page reads. */
  readonly siteSection?: keyof SiteStrings;
  /** Whether the page reads the raw tool catalogue (`getStrings`). */
  readonly toolCatalogue: boolean;
  /** Whether the page's chrome speaks the report's locale. The 404's is English. */
  readonly chrome: boolean;
  /** Keys of `siteSection` the page never shows in a report's locale. */
  readonly unshown?: ReadonlySet<string>;
}

/** Spec section 4's table and section 14. The facts: HomePage reads `.home`, GloryPointsPage `.glory`, ClassroomGroupsPage `getStrings`, 404.astro `.notFound`. */
const PAGES: Record<PageId, PageEntry> = {
  home: {
    route: '/',
    localised: true,
    siteSection: 'home',
    toolCatalogue: false,
    chrome: true,
  },
  'glory-points': {
    route: '/glory-points',
    localised: true,
    siteSection: 'glory',
    toolCatalogue: false,
    chrome: true,
  },
  'classroom-groups': {
    route: '/classroom-groups',
    localised: true,
    toolCatalogue: true,
    chrome: true,
  },
  'not-found': {
    route: '/404',
    localised: false,
    siteSection: 'notFound',
    toolCatalogue: false,
    chrome: false,
    // A document has one <title> and one description: the default locale's.
    unshown: new Set(['site.notFound.title', 'site.notFound.description']),
  },
};
```

Replace `pageIdFromPath` and `pagePath`, and add `reportIdStem` after them:

```ts
/** A footer page only: the 404's footer is English and carries no form. */
export function pageIdFromPath(pathname: string): FooterPageId | null {
  const route =
    localisePath(pathname, DEFAULT_LOCALE).replace(/\/+$/, '') || '/';
  return FOOTER_PAGE_IDS.find((page) => PAGES[page].route === route) ?? null;
}

export const pagePath = (page: PageId, locale: Locale): string =>
  PAGES[page].localised
    ? localisePath(PAGES[page].route, locale)
    : PAGES[page].route;

/**
 * The stem of every id a form draws (`<stem>-quote`, `<stem>-sent`). A page
 * whose path names its locale has one form, and keeps `report`. The 404
 * carries one per locale on one path, so each carries its locale (spec 14.3).
 */
export const reportIdStem = (page: PageId, locale: Locale): string =>
  PAGES[page].localised ? 'report' : `report-${locale}`;
```

In `chromeSections`, change the first line to `const owned = new Set<string>();` (the 404 now owns `notFound` through the table, so the loop below adds it).

In `reportableStrings`, replace the body of the `if (!table)` block with:

```ts
    const { siteSection, toolCatalogue, chrome, unshown } = PAGES[page];
    const sections = [
      ...(siteSection ? [siteSection] : []),
      ...(chrome ? chromeSections() : []),
    ];
    table = [
      ...(toolCatalogue ? toolStrings(locale) : []),
      ...siteStrings(locale, sections).filter(({ key }) => !unshown?.has(key)),
    ];
    tables.set(cacheKey, table);
```

In `outcome`, change the `Location` to:

```ts
    : plain(303, {
        Location: `${pagePath(page, locale)}#${reportIdStem(page, locale)}-${result}`,
      });
```

- [ ] **Step 4: Rename the footer loops in the e2e specs**

The three specs loop over "every page with a footer form". In each one, import `FOOTER_PAGE_IDS` in place of `PAGE_IDS` and loop over it:

- `tests/e2e/report-form.spec.ts:11` and `:96`
- `tests/e2e/report-presence.spec.ts:11` and `:52`
- `tests/e2e/report-completeness.spec.ts:12` and `:61`

Then check the rename is complete. `grep -n "PAGE_IDS" tests/e2e/report-*.spec.ts` must show only `FOOTER_PAGE_IDS`.

- [ ] **Step 5: Run green**

Run `npx prettier --write` on every file this task touched first: the code blocks here are not wrapped to prettier's width. Then run: `npx vitest run tests/unit/report.test.ts tests/unit/report-endpoint.test.ts tests/unit/report-review.test.ts && npm run typecheck`
Expected: PASS. `astro check` reports 0 errors, 0 warnings and 0 hints, in three summary lines.

- [ ] **Step 6: Commit**

```bash
git add src/lib/report.ts tests/unit/report.test.ts tests/unit/report-endpoint.test.ts tests/e2e/report-form.spec.ts tests/e2e/report-presence.spec.ts tests/e2e/report-completeness.spec.ts
git commit -m "The report page table knows the 404: one path, a stem per locale, its own notFound keys (Refs #350)"
```

### Task 2: One form component, rendered by the footer and every 404 block

**Files:**
- Create: `src/components/ReportForm.astro`
- Modify: `src/components/Footer.astro`, `src/pages/404.astro`, `src/scripts/report-form.ts` (a comment only)
- Modify: `tests/e2e/copy-reaches-a-page.spec.ts`, `tests/e2e/report-presence.spec.ts`
- Create: `tests/e2e/not-found-report.spec.ts`

**Interfaces:**
- Consumes: `reportIdStem`, `reportOptions`, `MAX_FIELD_UNITS`, `type PageId`, `type Outcome`.
- Produces: `<ReportForm lang={Locale} page={PageId} />`. It draws the disclosure and the four statuses when `isBetaLocale(lang)`, and nothing otherwise. The datalist carries `data-report-strings`.

- [ ] **Step 1: Write the failing e2e spec `tests/e2e/not-found-report.spec.ts`**

```ts
import type { Page } from '@playwright/test';
import { test, expect } from './fixtures';
import { recorded } from './evidence';
import { atLeast44, expectNoHorizontalScroll } from '../viewport';
import { contrastRatio } from './helpers';
import { THEMES } from '../palette';
import {
  DEFAULT_LOCALE,
  LOCALES,
  getSiteStrings,
  isBetaLocale,
} from '../../src/lib/i18n';
import {
  matchingKeys,
  pagePath,
  reportIdStem,
  reportOptions,
} from '../../src/lib/report';

/**
 * The 404's report route (#350, spec 14). One form per translated block,
 * each posting its own locale; read from the built page, so a block added
 * with a new locale is judged the day it is built.
 */
test.use(recorded);

const NOT_FOUND = pagePath('not-found', DEFAULT_LOCALE);
const BETA = LOCALES.filter(isBetaLocale);
const block = (page: Page, locale: string) =>
  page.locator(`details[data-report][lang="${locale}"]`);

test('every beta block carries one form posting its own locale, and English none', async ({
  page,
}) => {
  await page.goto(NOT_FOUND);
  expect(BETA.length).toBeGreaterThan(0);
  await expect(page.locator('details[data-report]')).toHaveCount(BETA.length);
  await expect(
    page.locator(`details[data-report][lang="${DEFAULT_LOCALE}"]`),
  ).toHaveCount(0);
  for (const locale of BETA) {
    const form = block(page, locale).locator('form');
    await expect(form.locator('input[name="locale"]')).toHaveValue(locale);
    await expect(form.locator('input[name="page"]')).toHaveValue('not-found');
    const offered = await form
      .locator('datalist option')
      .evaluateAll((options) =>
        options.map((option) => (option as HTMLOptionElement).value),
      );
    expect(offered, locale).toEqual([...reportOptions('not-found', locale)]);
  }
});

test('each block offers what it shows: its heading, sentence and link match its own keys', async ({
  page,
}) => {
  await page.goto(NOT_FOUND);
  for (const locale of BETA) {
    const heading = page.locator(`h2[lang="${locale}"]`);
    await expect(heading).toBeVisible();
    const link = page.locator(`p[lang="${locale}"] a[hreflang="${locale}"]`);
    const shown = [
      [await heading.innerText(), 'site.notFound.heading'],
      [await link.innerText(), 'site.notFound.backHome'],
      [getSiteStrings(locale).notFound.body, 'site.notFound.body'],
    ] as const;
    for (const [text, key] of shown)
      expect(matchingKeys(text, 'not-found', locale), `${locale} ${key}`).toContain(key);
  }
});

test('a block walks its own fields from the keyboard, each labelled and described in its language', async ({
  page,
  browserName,
}) => {
  await page.goto(NOT_FOUND);
  // The last block: were the ids shared, each label would name the FIRST
  // element with its id, so the first block would pass by accident and the
  // last cannot.
  const locale = BETA[BETA.length - 1];
  const t = getSiteStrings(locale).report;
  const details = block(page, locale);
  await details.locator('summary').focus();
  await page.keyboard.press('Enter');
  await expect(details).toHaveAttribute('open', '');
  for (const label of [t.quoteLabel, t.suggestionLabel, t.noteLabel]) {
    await page.keyboard.press('Tab');
    await expect(details.getByLabel(label, { exact: true })).toBeFocused();
  }
  const send = details.getByRole('button', { name: t.send });
  // Safari keeps buttons out of the Tab order by preference (report-form.spec.ts).
  if (browserName === 'webkit') await send.focus();
  else await page.keyboard.press('Tab');
  await expect(send).toBeFocused();
  await expect(
    details.getByLabel(t.quoteLabel, { exact: true }),
  ).toHaveAccessibleDescription(t.quoteHint);
  await expect(
    details.getByLabel(t.noteLabel, { exact: true }),
  ).toHaveAccessibleDescription(t.noteHint);
});

for (const locale of BETA)
  test(`${locale}: its sent status shows in its language, takes focus, and hides every other`, async ({
    page,
  }) => {
    const stem = reportIdStem('not-found', locale);
    await page.goto(`${NOT_FOUND}#${stem}-sent`);
    const shown = page.locator(`#${stem}-sent`);
    await expect(shown).toBeVisible();
    await expect(shown).toHaveText(getSiteStrings(locale).report.sent);
    await expect(shown).toHaveAttribute('lang', locale);
    await expect(shown).toBeFocused();
    expect(await contrastRatio(shown)).toBeGreaterThanOrEqual(4.5);
    const statuses = page.locator('[data-report-status]');
    await expect(statuses).toHaveCount(BETA.length * 4);
    await expect(page.locator('[data-report-status]:visible')).toHaveCount(1);
  });

for (const theme of THEMES)
  test.describe(`${theme} theme`, () => {
    test.use({ colorScheme: theme });

    test('every control is at least 44px and every text meets AA', async ({
      page,
    }) => {
      await page.goto(NOT_FOUND);
      for (const locale of BETA) {
        const t = getSiteStrings(locale).report;
        const details = block(page, locale);
        await details.locator('summary').click();
        for (const target of [
          details.locator('summary'),
          details.getByLabel(t.quoteLabel, { exact: true }),
          details.getByLabel(t.suggestionLabel, { exact: true }),
          details.getByLabel(t.noteLabel, { exact: true }),
          details.getByRole('button', { name: t.send }),
        ])
          await atLeast44(target);
        // On the 404 the form sits on the page's ground, not the footer's,
        // so its label and hints are measured here too (#97 measured them in
        // the footer).
        const stem = reportIdStem('not-found', locale);
        for (const text of [
          details.locator('summary'),
          details.locator('form > p').first(),
          details.locator(`label[for="${stem}-quote"]`),
          details.locator(`#${stem}-quote-hint`),
          details.locator(`#${stem}-note-hint`),
          details.getByRole('button', { name: t.send }),
        ])
          expect(await contrastRatio(text), locale).toBeGreaterThanOrEqual(4.5);
      }
    });
  });

test('no sideways scroll at 320px with every form open', { tag: '@emulated-viewport' }, async ({
  page,
}) => {
  await page.setViewportSize({ width: 320, height: 800 });
  await page.goto(NOT_FOUND);
  for (const locale of BETA) await block(page, locale).locator('summary').click();
  await expectNoHorizontalScroll(page);
});

test('no form reaches paper', async ({ page }) => {
  await page.goto(NOT_FOUND);
  await expect(page.locator('details[data-report]')).toHaveCount(BETA.length);
  await page.emulateMedia({ media: 'print' });
  for (const locale of BETA) await expect(block(page, locale)).toBeHidden();
});
```

- [ ] **Step 2: Run it red**

Run: `npx playwright test tests/e2e/not-found-report.spec.ts --project=chromium`
Expected: 10 FAIL and 1 PASS. The first test's `toHaveCount(4)` receives 0, and each later test fails on its own locator. The PASS is `each block offers what it shows`, which checks Task 1's keys against copy the 404 already renders. That is legitimate, and M13 is the mutation that reaches it.

- [ ] **Step 3: Create `src/components/ReportForm.astro`**

Move the markup out of `Footer.astro` (the `<details>` and the status paragraphs), with ids from the stem. Move with it the style rules `.report summary` through `@media print`.

```astro
---
import { getSiteStrings, isBetaLocale, type Locale } from '../lib/i18n';
import {
  MAX_FIELD_UNITS,
  reportIdStem,
  reportOptions,
  type Outcome,
  type PageId,
} from '../lib/report';

/**
 * The report form (#97), the one home of its markup and styles: the footer
 * renders it once per page, and the 404 once per translated block (#350,
 * spec 14). It decides whether to draw itself, through `isBetaLocale`, so
 * English never shows it and no caller keeps a list of locales.
 *
 * The disclosure and each status carry `lang` (the fields inherit it),
 * because on the 404 the document's own `lang` is English. The status paragraphs sit outside the `<details>`,
 * because a closed one renders nothing and a status must show either way.
 */
interface Props {
  lang: Locale;
  page: PageId;
}
const { lang, page } = Astro.props;
const t = getSiteStrings(lang).report;
const id = (part: string) => `${reportIdStem(page, lang)}-${part}`;
const statuses: ReadonlyArray<[Outcome, string]> = [
  ['sent', t.sent],
  ['not-found', t.notFound],
  ['rejected', t.rejected],
  ['failed', t.failed],
];
---

{
  isBetaLocale(lang) && (
    <Fragment>
      <details class="report" data-report lang={lang}>
        <summary>{t.open}</summary>
        <form method="post" action="/api/report" data-report-form>
          <p>{t.intro}</p>
          <input type="hidden" name="locale" value={lang} />
          <input type="hidden" name="page" value={page} />
          <label for={id('quote')}>{t.quoteLabel}</label>
          <input
            id={id('quote')}
            name="quote"
            type="text"
            list={id('strings')}
            required
            maxlength={MAX_FIELD_UNITS}
            autocomplete="off"
            aria-describedby={id('quote-hint')}
          />
          <p id={id('quote-hint')} class="hint">
            {t.quoteHint}
          </p>
          <datalist id={id('strings')} data-report-strings>
            {reportOptions(page, lang).map((option) => (
              <option value={option} />
            ))}
          </datalist>
          <label for={id('suggestion')}>{t.suggestionLabel}</label>
          <textarea
            id={id('suggestion')}
            name="suggestion"
            maxlength={MAX_FIELD_UNITS}
          ></textarea>
          <label for={id('note')}>{t.noteLabel}</label>
          <textarea
            id={id('note')}
            name="note"
            maxlength={MAX_FIELD_UNITS}
            aria-describedby={id('note-hint')}
          ></textarea>
          <p id={id('note-hint')} class="hint">
            {t.noteHint}
          </p>
          <div class="hp" aria-hidden="true">
            <label for={id('website')}>{t.honeypotLabel}</label>
            <input
              id={id('website')}
              name="website"
              tabindex="-1"
              autocomplete="off"
            />
          </div>
          <button type="submit">{t.send}</button>
        </form>
      </details>
      {statuses.map(([result, text]) => (
        <p
          id={id(result)}
          class="report-status"
          role="status"
          tabindex="-1"
          lang={lang}
          data-report-status={result}
        >
          {text}
        </p>
      ))}
    </Fragment>
  )
}
<style>
  /* The report form (#97). Tokens only, so the computed-style contrast
     guards apply; every control 44px; inputs take their width from the
     column, because an input's intrinsic width once pinned #cg-form wide at
     320px. */
  /* (the rules from `.report summary` to the closing brace of `@media print`,
     moved verbatim from Footer.astro) */
</style>
```

The `<style>` block receives the Footer's rules verbatim, from `.report summary {` down to the end of `@media print { … }`. The Footer keeps `footer`, `.inner` and `.inner a`.

- [ ] **Step 4: The footer renders the component**

In `Footer.astro`:
- Remove the `report` imports, keeping only `pageIdFromPath`, and add `import ReportForm from './ReportForm.astro';`.
- Replace `reportPage` and `reportStatuses` with:

```ts
// The report form (#97): the page comes from the route, so no page has to
// remember a prop, and ReportForm decides through isBetaLocale whether to
// draw. A path the table does not know renders no form, and the presence
// check in report-presence.spec.ts fails on it rather than letting it go
// quietly.
const reportPage = pageIdFromPath(Astro.url.pathname);
```

- Replace the `{reportPage && (<details …>)}` block and the `{reportPage && reportStatuses.map(…)}` block with `{reportPage && <ReportForm lang={lang} page={reportPage} />}`.
- Delete the moved style rules.

- [ ] **Step 5: The 404 renders the component in every block**

In `404.astro`, add `import ReportForm from '../components/ReportForm.astro';`. After the primary block's `</p>`, add `<ReportForm lang={DEFAULT_LOCALE} page="not-found" />`, which draws nothing in English and says so through `isBetaLocale`. After each block's `</p>`, inside the `Fragment`, add `<ReportForm lang={locale} page="not-found" />`. Then append to the page's doc comment:

```
 *
 * Each block carries the report form (#350, spec 14) in its own language,
 * posting its own locale, because the path names none. ReportForm draws
 * nothing in English, so the default block has none, as on every English page.
```

In `src/scripts/report-form.ts:52`, change `(Footer.astro's CSS)` to `(ReportForm.astro's CSS)`.

- [ ] **Step 6: The guards that read built HTML count forms, not pages**

In `tests/e2e/copy-reaches-a-page.spec.ts`:

```ts
const REPORT_TYPE_AHEAD =
  /<datalist\b[^>]*\bdata-report-strings\b[^>]*>[\s\S]*?<\/datalist>/g;
/** A report form's opening tag: the 404 carries one per translated block. */
const REPORT_FORM = /<form\b[^>]*\bdata-report-form\b/g;
```

Rename the `Corpus` field `withForm` to `forms`, with the doc comment `How many report forms the built pages carry.`. Compute it as `raw.reduce((count, html) => count + (html.match(REPORT_FORM)?.length ?? 0), 0)`. Update its three uses in the test, and change the message to `'every report form had its type-ahead taken out of the scan'`. Replace `RENDERED_404` with:

```ts
/**
 * The 404's own text, type-aheads removed: each translated block carries a
 * form (#350) whose type-ahead lists that block's copy, and would otherwise
 * find a heading the block had stopped showing.
 */
const RENDERED_404 = () =>
  decode(readFileSync(PAGE_404, 'utf8').replace(REPORT_TYPE_AHEAD, ''));
```

In `tests/e2e/report-presence.spec.ts`, judge the footer rather than the page:

```ts
/** The footer's markup: the 404 carries forms in its body, never its footer. */
const footerOf = (html: string) => /<footer\b[\s\S]*?<\/footer>/.exec(html)?.[0] ?? '';
```

In the first test, change `const has = html.includes('data-report-form');` to `const has = footerOf(html).includes('data-report-form');`. Change its closing liveness filter to `footerOf(html).includes('data-report-form')`. Change `.locator('#report-strings option')` to `.locator('footer [data-report-strings] option')`.

- [ ] **Step 7: Run green**

Run: `npm run build && npx playwright test tests/e2e/not-found-report.spec.ts tests/e2e/report-form.spec.ts tests/e2e/report-presence.spec.ts tests/e2e/report-completeness.spec.ts tests/e2e/copy-reaches-a-page.spec.ts tests/e2e/theme-script.spec.ts --project=chromium --project=webkit --project=content`
Expected: PASS, with a total that includes every new test. Then run `npm run test:unit`, `npm run typecheck` and `npx prettier --check .`.

- [ ] **Step 8: Commit**

```bash
git add src/components/ReportForm.astro src/components/Footer.astro src/pages/404.astro src/scripts/report-form.ts tests/e2e/not-found-report.spec.ts tests/e2e/copy-reaches-a-page.spec.ts tests/e2e/report-presence.spec.ts
git commit -m "Every translated 404 block carries the report form, one component shared with the footer (Refs #350)"
```

### Task 3: A real submission from every block, on five engines

**Files:**
- Create: `tests/engines.ts`
- Modify: `playwright.config.ts`, `playwright.functions.config.ts`, `.github/workflows/ci.yml` (the functions job's browser install)
- Test: `tests/functions/report.spec.ts`, `tests/unit/pipeline-wiring.test.ts` (it pins the functions job's steps)

**Interfaces:**
- Produces: `ENGINES` (`readonly { name: string; device: string }[]`), exported from `tests/engines.ts`.

- [ ] **Step 1: Write the failing Functions tests** (append inside `describe('with JavaScript disabled')`)

Add `LOCALES` and `isBetaLocale` to the file's import from `../../src/lib/i18n`.

```ts
  for (const locale of LOCALES.filter(isBetaLocale))
    test(
      `the 404's ${locale} block stores its own locale and notFound key`,
      { tag: '@requires-isolated-context' },
      async ({ page }) => {
        const t = getSiteStrings(locale);
        const note = noteFor(`404 ${locale}`);
        const block = page.locator(`details[data-report][lang="${locale}"]`);
        await page.goto('/404');
        await block.locator('summary').click();
        await block
          .getByLabel(t.report.quoteLabel, { exact: true })
          .fill(t.notFound.heading);
        await block
          .getByLabel(t.report.noteLabel, { exact: true })
          .fill(note);
        await block.getByRole('button', { name: t.report.send }).click();
        await expect(page).toHaveURL(new RegExp(`/404#report-${locale}-sent$`));
        await expect(page.locator(`#report-${locale}-sent`)).toBeVisible();
        const rows = reportsWithNote(note);
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
    { tag: '@requires-isolated-context' },
    async ({ page }) => {
      const note = noteFor('404 cross-block');
      const block = page.locator('details[data-report][lang="vi"]');
      await page.goto('/404');
      await block.locator('summary').click();
      await block
        .getByLabel(vi.quoteLabel, { exact: true })
        .fill(getSiteStrings('zh').notFound.heading);
      await block.getByLabel(vi.noteLabel, { exact: true }).fill(note);
      await block.getByRole('button', { name: vi.send }).click();
      await expect(page).toHaveURL(/\/404#report-vi-not-found$/);
      await expect(page.locator('#report-vi-not-found')).toBeVisible();
      expect(reportsWithNote(note)).toEqual([]);
    },
  );
```

- [ ] **Step 2: Run red with the 404's forms taken out**

Commit first. Then put back the Task 1 version of the page with `git show HEAD~2:src/pages/404.astro > src/pages/404.astro`, and run `npx playwright test --config=playwright.functions.config.ts --project=chromium`. Restore the page with `git checkout -- src/pages/404.astro`.
Expected: 5 FAIL (the four blocks and the cross-block test), because no `details` exists and the `summary` click times out. The 8 existing tests pass.

- [ ] **Step 3: One engine list, and five engines for the Functions suite**

Create `tests/engines.ts`:

```ts
/**
 * The five engines every browser suite renders on: the e2e suite and, since
 * #350, the Functions suite. One list, so a sixth is added once.
 */
export const ENGINES = [
  { name: 'chromium', device: 'Desktop Chrome' },
  { name: 'firefox', device: 'Desktop Firefox' },
  { name: 'webkit', device: 'Desktop Safari' },
  { name: 'mobile-chrome', device: 'Pixel 5' },
  { name: 'mobile-safari', device: 'iPhone 13' },
] as const;
```

In `playwright.config.ts`, delete the local `ENGINES` and add `import { ENGINES } from './tests/engines';` below the `@playwright/test` import. In `playwright.functions.config.ts`, add the same import and set:

```ts
  projects: ENGINES.map(({ name, device }) => ({
    name,
    use: { ...devices[device] },
  })),
```

Also append to its doc comment: `Every engine the e2e suite renders on (#350): a form posted by a real browser is the claim, and each engine posts it its own way.`

In `.github/workflows/ci.yml`, the functions job: change `npx playwright install --with-deps chromium` to `npx playwright install --with-deps`. The same line is pinned in `tests/unit/pipeline-wiring.test.ts` (`the functions job runs the functions-runtime suite`). Change it there, with the comment `// Every engine: the suite posts the 404's forms from all five (#350).` above it.

- [ ] **Step 4: Run green**

Run: `npm run test:functions`, then `npm run test:unit` (`pipeline-wiring` and `browser-matrix` read these files).
Expected: PASS on all five projects, with the total equal to five times the per-project count.

- [ ] **Step 5: Commit**

```bash
git add tests/engines.ts playwright.config.ts playwright.functions.config.ts .github/workflows/ci.yml tests/functions/report.spec.ts tests/unit/pipeline-wiring.test.ts
git commit -m "Every 404 block's report is stored with its own locale, on five engines (Refs #350)"
```

### Task 4: The 404's baselines, the mutation matrix, and the record

**Files:**
- Modify: `tests/e2e/visual.spec.ts` (`PAGES`)
- Create: `tests/e2e/__screenshots__/not-found-{desktop,mobile}{,-light}-linux.png`
- Modify: `docs/superpowers/plans/2026-09-26-not-found-report.md` (this file: the review log and the mutation results)

- [ ] **Step 1: Add the 404 to the visual suite**

In `PAGES` in `tests/e2e/visual.spec.ts`, add `{ name: 'not-found', path: '/404' },`.

- [ ] **Step 2: Capture only the 404, in the pinned container, with nothing else running**

Run: `npm run test:visual:update -- --grep not-found`
Then run `git status --short tests/e2e/__screenshots__`. Expected: exactly four new `not-found-*-linux.png` and nothing modified. View each one: every beta block shows a closed "report" disclosure under its sentence, and the English block shows none.

- [ ] **Step 3: Compare every baseline with nothing written**

Run: `npm run test:visual`
Expected: every test passes, and `git status --short tests/e2e/__screenshots__` shows no change beyond Step 2. This proves the move into the component changed no footer pixels.

- [ ] **Step 4: The mutation matrix, from a clean committed tree**

Each mutation is applied with its anchor count asserted and its diff printed, run against the named suite, and reverted by `git checkout -- <file>` only once the tree is committed. The RED/GREEN column is the prediction, written before the run.

| #   | Mutation                                                                                          | Suite                                                        | Predicted                                              |
| --- | ------------------------------------------------------------------------------------------------- | ------------------------------------------------------------ | ------------------------------------------------------ |
| M1  | `report.ts`: drop `unshown` from `not-found`                                                      | `report.test.ts`                                             | RED: the 404 offers `title` and `description`           |
| M2  | `report.ts`: `reportIdStem` returns `'report'` always                                             | unit + `not-found-report.spec.ts`                            | RED: the stem test, the redirect, the status test       |
| M3  | `report.ts`: `not-found` `localised: true`                                                        | unit                                                         | RED: `pagePath` is `/vi/404`; the stem is `report`      |
| M4  | `report.ts`: `not-found` `chrome: true`                                                           | unit                                                         | RED: the 404 keys test and the chrome-quote endpoint test |
| M5  | `404.astro`: blocks render `<ReportForm lang={DEFAULT_LOCALE} …>`                                 | `not-found-report.spec.ts`                                   | RED: form count 0                                       |
| M6  | `ReportForm.astro`: `isBetaLocale(lang) &&` becomes `true &&`                                     | `not-found-report.spec.ts`, `report-presence.spec.ts`         | RED: English block has a form; English footers have one |
| M7  | `copy-reaches…`: the type-ahead regex back to `id="report-strings"`                               | `copy-reaches-a-page.spec.ts`                                | RED: removed (3 × 4 locales) ≠ forms (+ 4 on the 404)    |
| M8  | `404.astro`: each block's `<h2>` renders `{copy.body}`, with the type-ahead strip left in place   | `copy-reaches-a-page.spec.ts`                                | RED: "the 404 speaks it" misses the heading             |
| M8b | M8, and `RENDERED_404` without the strip                                                          | same                                                         | "the 404 speaks it" GREEN: the datalist satisfies it, which is why the strip exists. The corpus scan stays RED |
| M9  | `report-presence`: `footerOf(html)` becomes `html`                                                | `report-presence.spec.ts`                                    | RED: the 404 (lang=en) carries forms                    |
| M10 | `ReportForm.astro`: hidden `page` becomes `home`                                                  | functions                                                    | RED: `not-found` expected in the row; the quote is not found |
| M11 | `ReportForm.astro`: delete `@media print` rule                                                    | `not-found-report.spec.ts`                                   | RED: "no form reaches paper"                            |
| M12 | `ReportForm.astro`: drop `lang={lang}` from the statuses                                          | `not-found-report.spec.ts`                                   | RED: the status test's `lang` assertion                 |
| M13 | `report.ts`: `unshown` also lists `site.notFound.heading`                                         | unit + `not-found-report.spec.ts`                            | RED: the 404 keys test; "each block offers what it shows" |

Record each run's observed verdict and failing test names under the table. A GREEN where RED was predicted goes through the three-causes check before it is believed.

- [ ] **Step 5: The self-review, then commit and PR**

- Read the whole diff.
- Grep `tests/dev`, `tests/prod` and `tests/device` for every changed fact: `report-strings`, `#report-`, `PAGE_IDS` and `/404`.
- Run the local gates (`npm run test:unit`, `npm run typecheck`, `npx prettier --check .`) and the e2e suite's five projects for the touched specs.
- Commit, push, and open the PR into `develop` with `Refs #350`. Check the body with `node scripts/closing-keywords.mjs`.

## Review log

**Pass 1 (2026-09-26, run in a scratch worktree off `develop` at 24798a5): 6 findings, all fixed above.**

The plan's code blocks were assembled into `../shyden-350-review` and run: tests against throwing stubs, then the implementation, `astro check`, the whole unit suite, the touched e2e specs on chromium, webkit and content, the Functions suite on five engines, and all 14 mutations.

1. `agrees with label-check about which site sections are chrome` went red, and no task mentioned it. The 404 now offers `notFound`, so the test was flipped to say "the 404 alone" (Task 1, Step 1).
2. That flip left `searched` unused in `report.test.ts`, which is an `astro check` hint. It is dropped from the import.
3. `each block offers what it shows` passed before the form existed. It checks Task 1's keys against copy the 404 already renders, so the pass is legitimate, but no mutation reached it. M13 was added, and it goes red.
4. Task 2's red prediction said every test would fail. It is now 10 FAIL and 1 PASS, with the reason given.
5. The code blocks are not wrapped to prettier's width, and Step 5 never said to format them. A `prettier --write` step was added.
6. M8b predicted a whole-file GREEN, and the run was RED. The strip's own test, "the 404 speaks it", did go GREEN, as predicted. The RED came from a second, independent guard: the corpus scan cannot find the heading anywhere either. The row now predicts at the level of the test.

Results with the plan's code, which are the targets for execution:
- Unit: 2665/2665. `astro check`: 0 errors, 0 warnings and 0 hints.
- e2e: 182/182 on chromium, webkit and content.
- Functions: 65/65, which is 13 tests on 5 engines in 1.5 min. The new tests were 5/5 red with the 404's forms reverted.
- Prettier: clean.

Mutations, every one RED as predicted (harness `mut350.py`, tree clean after each):
- M1 (4 unit), M2 (3 unit, then 7 e2e), M3 (4), M4 (6), M5 (10 e2e), M6 (7 e2e).
- M6 again against `report-presence.spec.ts` alone, because the harness prints only four failing names: 1 failed, on the footer-presence test.
- M7: 5 failed, the corpus liveness check in every locale.
- M8: 8 failed (4 "speaks it" and 4 corpus).
- M8b: 4 failed, corpus only. "Speaks it" is green.
- M9: 1. M10: 5 in Functions. M11: 1. M12: 4. M13: 5 unit, then 1 e2e (`each block offers what it shows`).

The dev, prod and device suites mention only the footer's `#report-sent`, and the footer's stem does not change.


**Pass 2 (2026-09-26): 5 findings, all fixed above.**

This pass re-ran the mechanical check: every line of the 20 code blocks exists verbatim in the tree that ran, apart from 9 prettier rewraps and the one style-move note. It re-read the whole document and ran Task 4's visual steps.

1. Task 1, Step 2 said that `FOOTER_PAGE_IDS` was "not exported" and then stubbed only `reportIdStem`. Pass 1 stubbed both and measured 9 failures. The step now says exactly that.
2. The component's doc comment, and spec 14.1, claimed that `lang` sits on every element. It sits on the disclosure and the statuses, and the fields inherit it. Both now say so.
3. The new unit test and the Functions tests listed `['id', 'zh', 'vi', 'th']`, the enumeration the Global Constraints forbid. Both now use `LOCALES.filter(isBetaLocale)`.
4. Task 3's red step ran the whole Functions suite, which would predict 25 failures on five engines. It now names the commands, runs chromium, and expects 5.
5. `pipeline-wiring.test.ts` pins the functions job's `npx playwright install --with-deps chromium`. Task 3 changed the job and never named the pin. Pass 1 missed it because it did not run the unit suite after Task 3. Task 3 now changes the pin and lists the file.

Visual, in the pinned container: `--grep not-found` wrote exactly the four new baselines. Viewed: each beta block shows a closed disclosure in its own language, and the English block shows none. The full comparison then passed 28 of 28 with nothing written, so the footer's pixels are unchanged.

Environment, not the plan: the scratch worktree's `node_modules` was a symlink, and the container's Linux `npm ci` replaced it (memory `a-symlinked-node-modules-meets-the-visual-container`). The execution runs in the main checkout, where `node_modules` is a real directory.

**Pass 3 (2026-09-26): 3 findings, all fixed above.**

This pass ran the mechanical check again: every line of the 20 blocks is present, apart from the same rewraps, and every anchor the prose names is in the tree. It re-read the whole document and executed everything:
- Unit: 2665/2665. `astro check`: 0/0/0. Prettier: clean.
- e2e: the six touched specs on all six projects, 389/389.
- Functions: five engines, 65/65.
- All 14 mutations: RED, with the same counts as pass 1. The tree was clean after the run.

Every result matched. The findings came from reading the new spec:
1. The contrast test measured the summary, the intro and the button, and not the label, the hints or the status. On the 404 the form sits on the page's ground, not the footer's, so #97's footer measurements do not cover it. The test now measures all of them, and the status test measures the shown status.
2. An inline `import('@playwright/test').Page` type is now a top-level `import type`.
3. The keyboard test takes the last block with no reason given. The comment now gives it: were the ids shared, each label would name the first element with its id.

**Pass 4 (2026-09-26): 0 findings.**

This pass ran the mechanical check (every block present, the same rewraps, no placeholder, and every stale phrase only inside this log), re-read the whole document, and executed everything:
- Unit: 2665/2665. `astro check`: 0/0/0. Prettier: clean.
- e2e: 389/389 on all six projects.
- Functions: 65/65 on five engines.
- All 14 mutations: RED, with pass 1's counts. The tree was clean after the run.

**The plan is approved (self-approved after a clean pass, operator rule of 2026-09-24).**

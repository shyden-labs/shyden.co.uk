import { tapOn } from '../real-touch';
import { typeInto } from '../real-typing';
import { test, expect } from './fixtures';
import { makeGroups } from '../make-groups';
import type { Page } from '@playwright/test';
import { recorded, shoot } from './evidence';
import { rosterOf, upload } from './helpers';

test.use(recorded);

/**
 * A live region only reports mutations to something already in the
 * accessibility tree. `hidden` takes an element out of that tree, so writing
 * the text and revealing the element afterwards mutates nothing anyone is
 * listening to — NVDA, JAWS and VoiceOver commonly say nothing at all when a
 * region appears already-populated. The visitor presses the button and hears
 * silence, whether it worked or not.
 *
 * That ordering is invisible in the finished DOM: both sequences end in the
 * same state. So these tests record the operations as the page performs them.
 *
 * Recorded by wrapping the real accessors and calling them, so the page
 * behaves exactly as it ships: `hidden` on each region itself, and every
 * write that lands INSIDE a live region, credited to the nearest one. The
 * obvious alternative, a MutationObserver, is not usable here: its callback
 * is a microtask that runs after every synchronous mutation in the batch, so
 * reading `hidden` inside it reports the END state for every record and a
 * reversed order looks identical. That version of this test passed against
 * the defect it was written for.
 */
const recordOperations = (page: Page) =>
  page.addInitScript(() => {
    (window as Window & { __ops?: string[] }).__ops = [];
    const log = (entry: string) =>
      (window as Window & { __ops?: string[] }).__ops?.push(entry);

    const hidden = Object.getOwnPropertyDescriptor(
      HTMLElement.prototype,
      'hidden',
    )!;
    const text = Object.getOwnPropertyDescriptor(
      Node.prototype,
      'textContent',
    )!;

    document.addEventListener('DOMContentLoaded', () => {
      // Named three, then DERIVED. A hand-written list is the shape that let
      // `#cg-io-toggle` slip past the no-scroll tests for months: a region
      // added later is silently uninstrumented, and an ordering test written
      // for it would assert nothing at all. Every live region declares
      // itself with a role, so that is what this reads. The three stay named
      // explicitly rather than being replaced by the query -- `#cg-results`
      // is not a live region (it is the ancestor whose reveal the summary's
      // write must follow), and dropping any of them would weaken tests that
      // already pass.
      const ids = new Set(['cg-error', 'cg-results', 'cg-summary']);
      for (const live of document.querySelectorAll(
        '[role="alert"], [role="status"]',
      )) {
        if (live.id) ids.add(live.id);
      }
      for (const id of ids) {
        const el = document.getElementById(id);
        if (!el) continue;
        Object.defineProperty(el, 'hidden', {
          configurable: true,
          get() {
            return hidden.get!.call(this);
          },
          set(value: boolean) {
            log(`${id}:${value ? 'hide' : 'show'}`);
            hidden.set!.call(this, value);
          },
        });
      }

      // Writes are recorded wherever they land inside a live region, not
      // only on the region itself: #cg-io-problems and #cg-io-confirm are
      // written through children (a list, a sentence), and a recorder that
      // watched only the region's own textContent saw them revealed and
      // never written (#390 F109). Credited to the NEAREST live region, so
      // the summary's write stays the summary's. textContent is the only
      // write path recorded: wrapping the four insertion methods too was
      // mutated away with every test green (AN5), since each region the page
      // fills through children is cleared through textContent first.
      const liveRegionOf = (node: Node | null): string | null => {
        for (let at = node; at !== null; at = at.parentNode) {
          if (
            at instanceof Element &&
            at.id !== '' &&
            ['alert', 'status'].includes(at.getAttribute('role') ?? '')
          ) {
            return at.id;
          }
        }
        return null;
      };
      Object.defineProperty(Node.prototype, 'textContent', {
        configurable: true,
        get() {
          return text.get!.call(this);
        },
        set(value: string) {
          const id = liveRegionOf(this);
          if (id !== null) log(`${id}:write`);
          text.set!.call(this, value);
        },
      });
    });
  });

const opsFor = async (page: Page, id: string) =>
  (
    await page.evaluate(
      () => (window as Window & { __ops?: string[] }).__ops ?? [],
    )
  )
    .filter((op) => op.startsWith(`${id}:`))
    .map((op) => op.slice(id.length + 1));

test.describe('screen-reader announcements', () => {
  test.beforeEach(async ({ page }) => {
    await recordOperations(page);
  });

  // #188, AC16. A refused number field is a refusal, so it is announced
  // rather than merely shown -- the region has to join the accessibility
  // tree before the sentence is written into it. Instrumented without being
  // named: the recorder above now derives every element carrying a live
  // role, so this region was covered the moment the markup declared one.
  //
  // The LAST two operations, not the whole sequence: every keystroke that
  // leaves the field valid also writes an empty string into the hidden
  // region, so pinning the full array would be brittle for reasons that
  // have nothing to do with the ordering. `slice(-2)` still fails outright
  // if nothing was recorded at all.
  test('a refused number field is announced, not just revealed', async ({
    page,
  }) => {
    await page.goto('/classroom-groups');
    await typeInto(page.locator('#cg-count'), '25');
    await typeInto(page.locator('#cg-numbers-absent'), '26');

    const problem = page.locator('#cg-numbers-problem');
    await expect(problem).toBeVisible();
    await expect(problem).toHaveText(
      'There is no number 26. You have 25 students.',
    );
    expect((await opsFor(page, 'cg-numbers-problem')).slice(-2)).toEqual([
      'show',
      'write',
    ]);
    await shoot(
      page,
      'the refusal, revealed before it was written',
      page.locator('#cg-numbers-problem'),
    );
  });

  // #390 F108. Student details refuses to open above 100 students, and the
  // refusal was written into its hidden region and revealed afterwards: the
  // already-populated appearance screen readers commonly say nothing about.
  // The whole sequence, because nothing before the click touches the region.
  test('the refusal to open Student details is announced, not just revealed', async ({
    page,
  }) => {
    await page.goto('/classroom-groups');
    await typeInto(page.locator('#cg-count'), '300');
    await tapOn(page.locator('#cg-students-toggle'));

    const limit = page.locator('#cg-students-limit');
    await expect(limit).toBeVisible();
    await expect(limit).toHaveText(
      'Student details holds up to 100 students. Lower the number to list this class individually.',
    );
    expect(await opsFor(page, 'cg-students-limit')).toEqual(['show', 'write']);
    await shoot(
      page,
      'the refusal to open Student details, revealed before it was written',
      limit,
    );
  });

  // #390 F109. Both of io-ui's alerts were written, then revealed. A
  // region written through its children is announced only if it is in the
  // accessibility tree when the children land, the same as one written
  // directly. The last write must follow the last reveal; `toContain`
  // first, because a missing reveal would put both at -1.
  test('a refused file is announced, not just revealed', async ({ page }) => {
    await page.goto('/classroom-groups');
    await tapOn(page.locator('#cg-io-toggle'));
    await upload(page, 'bad.csv', 'number\nabc\n');

    const problems = page.locator('#cg-io-problems');
    await expect(problems).toBeVisible();
    await expect(problems).toContainText(
      "Row 1 — number 'abc' is not a whole number.",
    );
    const ops = await opsFor(page, 'cg-io-problems');
    expect(ops).toContain('show');
    expect(ops.lastIndexOf('write'), ops.join(', ')).toBeGreaterThan(
      ops.lastIndexOf('show'),
    );
    await shoot(
      page,
      'a refused file, revealed before it was listed',
      problems,
    );
  });

  test('the warning before an import replaces a roster is announced', async ({
    page,
  }) => {
    await rosterOf(page, 3);
    await tapOn(page.locator('#cg-io-toggle'));
    await upload(page, 'three.csv', 'number\n1\n2\n3\n');

    const confirm = page.locator('#cg-io-confirm');
    await expect(confirm).toBeVisible();
    await expect(confirm).toContainText(
      'This will replace your current class list — 3 students, 0 named.',
    );
    const ops = await opsFor(page, 'cg-io-confirm');
    expect(ops).toContain('show');
    expect(ops.lastIndexOf('write'), ops.join(', ')).toBeGreaterThan(
      ops.lastIndexOf('show'),
    );
    await shoot(
      page,
      'the replace warning, revealed before it was written',
      confirm,
    );
  });

  test('an error joins the page before it is written, so it is announced', async ({
    page,
  }) => {
    await page.goto('/classroom-groups');
    await typeInto(page.locator('#cg-count'), '0');
    await tapOn(page.locator('#cg-go'));
    await expect(page.locator('#cg-error')).toBeVisible();

    // Cleared, revealed, then written. The write is the mutation a live
    // region reports, so it has to come last.
    expect(await opsFor(page, 'cg-error')).toEqual(['hide', 'show', 'write']);
  });

  test('the summary joins the page before it is written', async ({ page }) => {
    await page.goto('/classroom-groups');
    // makeGroups opens Sound & animation, which `recordOperations` above
    // never instruments (it carries no live role and is none of the three
    // named), and only cg-results and cg-summary are read below, so it
    // cannot add a spurious entry to what is compared.
    await makeGroups(page, '8', '4');
    await expect(page.locator('#cg-summary')).toBeVisible();
    await expect(page.locator('#cg-summary')).toHaveText(
      '2 groups from 8 students.',
    );

    const results = await opsFor(page, 'cg-results');
    const summary = await opsFor(page, 'cg-summary');
    expect(results).toEqual(['show']);
    expect(summary).toEqual(['write']);

    // And in that order across the two elements.
    const all = await page.evaluate(
      () => (window as Window & { __ops?: string[] }).__ops ?? [],
    );
    expect(all.indexOf('cg-summary:write')).toBeGreaterThan(
      all.indexOf('cg-results:show'),
    );
  });

  test('the announced region is the summary, not the whole result', async ({
    page,
  }) => {
    // Announcing the section would read every group and every child aloud on
    // every shuffle. The summary says how it turned out; the detail is there
    // to be read at the visitor's own pace.
    await page.goto('/classroom-groups');
    await expect(page.locator('#cg-summary')).toHaveAttribute('role', 'status');
    await expect(page.locator('#cg-results')).not.toHaveAttribute(
      'aria-live',
      /.*/,
    );
  });
});

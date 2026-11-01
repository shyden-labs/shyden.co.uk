import { scrollToOn, tapOn } from '../real-touch';
import { onRealDevice } from '../device/device-downloads';
import { type Page } from '@playwright/test';
import { test, expect } from './fixtures';
import { searched } from '../source-files';
import { THEMES } from '../palette';
import { emulateTheme } from '../themes';
import { MAX_ROSTER } from '../../src/lib/roster';
import { addSeveral, openRoster, setSex } from './helpers';
import { recorded } from './evidence';
import { localePaths } from './locale-sampling';
import { expectNoHorizontalScroll } from '../viewport';

test.use(recorded);

/**
 * What a disabled control looks like and what it affords (#250).
 *
 * This file replaces `disabled-affordance-probe.spec.ts`, whose own docblock
 * said to delete it once AC7 had a real guard. Its measurement is recorded
 * durably on the ticket (issues/250#issuecomment-5753008996) and on PR #258;
 * the two facts that shape everything here are:
 *
 *  - **#250's stated premise is FALSE.** A disabled control DOES receive
 *    hover on all five engines — `hitRelation=self`, `mouseover=true`, 11/11
 *    everywhere, `<button>` included (CI run 35523913132, 55 readings, zero
 *    invalid). No wrapper is needed to carry the cursor.
 *  - **Nine of eleven disabled controls had no cursor treatment at all.**
 *    The lone `cursor: not-allowed` in the repo was scoped to
 *    `.switch input:disabled`, so only the two sex switches showed it.
 *
 * Three things about HOW this measures, each of which a weaker guard gets
 * wrong and stays green for:
 *
 *  - It asserts the POSITIVE cursor value, never `not.toBe('default')`.
 *    WebKit and mobile-Safari report an unstyled cursor as `auto`, Chromium
 *    and Firefox as `default`, so a negative assertion passes on two engines
 *    for free — the precise shape of a guard that is green for the wrong
 *    reason.
 *  - It reads the computed cursor of the element that WINS the hit test at
 *    the pointer's own position, not of the control. `cursor` is inherited,
 *    and what the user sees is what the hit element declares. AC7 says
 *    "proven on a real render ... not by the presence of a CSS rule".
 *  - The fill it requires is RESOLVED from `--disabled-fill` off `:root` at
 *    runtime and compared in computed rgb, the `palette-controls.spec.ts`
 *    idiom: retune the token and this follows, but a control painted some
 *    other grey still fails.
 *
 * The population is derived from the DOM in every scenario (AC1), never
 * hand-listed: this repo shipped 74px of horizontal scroll because the one
 * section nobody added to a hand-written list was the one that broke.
 */

/** Open every disclosure, DERIVED from the DOM (AC1) — never hand-listed. */
const openEveryDisclosure = async (page: Page) => {
  const toggles = page.locator('button[aria-expanded][aria-controls]');
  for (let i = 0; i < (await toggles.count()); i += 1) {
    const toggle = toggles.nth(i);
    if ((await toggle.getAttribute('aria-expanded')) === 'false') {
      await tapOn(toggle);
    }
  }
};

type Affordance = {
  /** Identifies the control in a failure message on its own. */
  readonly label: string;
  /** Computed cursor of whatever wins the hit test at the pointer point. */
  readonly cursor: string;
  /** `self` | `ancestor` | `unrelated` | `none` — `none` is an INVALID read. */
  readonly relation: string;
  /** Computed background of the control itself, in rgb. */
  readonly background: string;
  /** Computed opacity of the control itself. */
  readonly opacity: string;
  /**
   * The colour the control's label is PAINTED in, which is not always
   * `color`.
   *
   * Safari paints a disabled input's text through `-webkit-text-fill-color`,
   * and that property wins over `color` where both are set. Reading `color`
   * alone would report the declared value on every engine and say nothing
   * about what Safari draws — so the effective paint is read, with `color`
   * as the fallback on an engine that does not carry the property.
   */
  readonly ink: string;
  /** The control's own box, from the same rect the hit test is taken at. */
  readonly width: number;
  readonly height: number;
  /**
   * Checkbox, radio and file inputs: the UA draws these, their background is
   * legitimately transparent, and `accent-color` is what governs them. The
   * same carve-out `palette-controls.spec.ts` makes, for the same reason —
   * and it is ASSERTED below rather than assumed, so the set cannot quietly
   * grow.
   */
  readonly uaPainted: boolean;
};

/** An enabled control, with the cursor its own computed style carries. */
type EnabledControl = {
  readonly label: string;
  readonly cursor: string;
};

type Population = {
  /** Every disabled control a pointer can reach. */
  readonly reachable: readonly Affordance[];
  /**
   * Disabled elements deliberately left out, by tag name.
   *
   * AC2's tenth kind: `roster-ui.ts` disables the "—" `<option>` inside a
   * row's sex select once that row has an answer. An `<option>` is drawn by
   * the platform inside a popup this page does not own: it can carry no
   * cursor, no tooltip and no reason paragraph, on any engine. Its "reason"
   * is structural and already permanent — the placeholder means "not
   * answered yet", and once a sex is chosen there is no way back to it
   * (operator, 2026-08-13). So it is excluded DELIBERATELY, and the
   * exclusion is asserted rather than assumed, so a new excluded kind
   * cannot join it in silence.
   */
  readonly excluded: readonly string[];
  /**
   * Every ENABLED form control, with the cursor its computed style carries.
   *
   * AC6 asks that the disabled state be distinguishable from the enabled
   * one, and an assertion made over the disabled set ALONE is structurally
   * unable to see the way that fails: widen `:disabled { cursor:
   * not-allowed }` to `button` and every other guard in this file stays
   * green while the affordance stops telling a teacher anything. A property
   * held by BOTH states distinguishes neither.
   *
   * Computed style is the right instrument for this half. The question is
   * whether the RULE reaches an enabled control, not where a pointer lands
   * — which is what the hit test answers for the disabled half, and what it
   * is needed for there.
   */
  readonly enabled: readonly EnabledControl[];
  /** `--disabled-fill` resolved to computed rgb, so both sides compare. */
  readonly fill: string;
  /** `--ink-soft` resolved the same way, for the same reason. */
  readonly ink: string;
};

/**
 * Every `:disabled` element on the page, partitioned, with the cursor a user
 * would actually see over each reachable one and the paint it carries.
 */
const affordances = async (page: Page): Promise<Population> => {
  // Tag each one so the browser-side read finds the same element this
  // enumerated, without inventing an id scheme on the page itself.
  const { labels, excluded, enabled, fill, ink } = await page.evaluate(() => {
    const labels: string[] = [];
    const excluded: string[] = [];
    const enabled: { label: string; cursor: string }[] = [];
    document.querySelectorAll<HTMLElement>(':disabled').forEach((el, i) => {
      const tag = el.tagName.toLowerCase();
      if (tag === 'option') {
        excluded.push(tag);
        return;
      }
      const cls =
        typeof el.className === 'string'
          ? el.className.trim().split(/\s+/)[0]
          : '';
      const label = el.id || `${tag}${cls ? `.${cls}` : ''}#${i}`;
      el.setAttribute('data-disabled-250', label);
      labels.push(label);
    });

    const inkProbe = document.createElement('span');
    inkProbe.style.color = getComputedStyle(document.documentElement)
      .getPropertyValue('--ink-soft')
      .trim();
    document.body.append(inkProbe);
    const ink = getComputedStyle(inkProbe).color;
    inkProbe.remove();

    // Resolve the token through the renderer, so `#2a323f` and
    // `rgb(42, 50, 63)` are the same value here and no parsing of ours can
    // disagree with the browser.
    const probe = document.createElement('span');
    probe.style.background = getComputedStyle(document.documentElement)
      .getPropertyValue('--disabled-fill')
      .trim();
    document.body.append(probe);
    const fill = getComputedStyle(probe).backgroundColor;
    probe.remove();

    document
      .querySelectorAll<
        | HTMLButtonElement
        | HTMLInputElement
        | HTMLSelectElement
        | HTMLTextAreaElement
      >('button, select, textarea, input')
      .forEach((el) => {
        if (el.disabled) return;
        enabled.push({
          label: el.id || el.tagName.toLowerCase(),
          cursor: getComputedStyle(el).cursor,
        });
      });

    return { labels, excluded, enabled, fill, ink };
  });

  const reachable: Affordance[] = [];
  for (const label of labels) {
    const control = page.locator(`[data-disabled-250="${label}"]`);
    // `page.mouse.move` does NOT scroll, unlike `hover()`, and `block:
    // 'center'` rather than the default because this page has a STICKY
    // header (Header.astro:49): a control scrolled to the top sits under it
    // and the header legitimately wins the hit test. Both were measured
    // artefacts of the first probe (run 35521737392, every reading void).
    // On the phone a real finger drag brings it to the middle (#996), and
    // there is no pointer to move: the reading below needs none.
    if (onRealDevice()) await scrollToOn(control);
    else
      await control.evaluate((el) => el.scrollIntoView({ block: 'center' }));
    const box = await control.boundingBox();
    if (box === null) continue; // not rendered; nothing a pointer can reach

    // Move away first. Two controls can land on the SAME viewport point once
    // each is centred (`.switches` is a flex COLUMN), and a move to the point
    // the pointer already occupies fires nothing.
    if (!onRealDevice()) {
      await page.mouse.move(0, 0);
      await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    }

    reachable.push(
      await page.evaluate((id) => {
        const el = document.querySelector<HTMLElement>(
          `[data-disabled-250="${id}"]`,
        )!;
        const r = el.getBoundingClientRect();
        const hit = document.elementFromPoint(
          r.left + r.width / 2,
          r.top + r.height / 2,
        );
        // `contains` is reflexive, so identity is tested FIRST.
        const relation =
          hit === null
            ? 'none'
            : hit === el
              ? 'self'
              : hit.contains(el)
                ? 'ancestor'
                : 'unrelated';
        const own = getComputedStyle(el);
        const type = el.getAttribute('type');
        return {
          label: id,
          // The hit element's cursor IS the cursor the user sees. A null hit
          // reports '(none)', which can never equal 'not-allowed', so an
          // invalid reading fails the guard rather than passing it.
          cursor: hit === null ? '(none)' : getComputedStyle(hit).cursor,
          relation,
          background: own.backgroundColor,
          ink: own.getPropertyValue('-webkit-text-fill-color') || own.color,
          opacity: own.opacity,
          width: r.width,
          height: r.height,
          uaPainted:
            el.tagName.toLowerCase() === 'input' &&
            (type === 'checkbox' || type === 'radio' || type === 'file'),
        };
      }, label),
    );
  }

  return { reachable, excluded, enabled, fill, ink };
};

/**
 * Assert the no-entry cursor over every reachable disabled control (AC7).
 *
 * The expectation is built from the MEASURED labels with a LITERAL value, so
 * the population cannot be hand-listed and the value cannot drift with the
 * implementation. `searched` is what stops an empty population reading as a
 * clean bill of health.
 */
const expectNoEntryCursor = (
  reachable: readonly Affordance[],
  scenario: string,
) => {
  searched(reachable, {
    of: reachable.map((a) => a.label),
    what: `disabled controls (${scenario})`,
  });
  expect(reachable.map((a) => `${a.label}: ${a.cursor}`)).toEqual(
    reachable.map((a) => `${a.label}: not-allowed`),
  );
  // Ordered AFTER the invariant on purpose. This is a validity check on the
  // reading, and an assertion placed before a weaker one is the only one that
  // ever runs (#156): the cursor is the thing AC7 protects.
  expect(reachable.map((a) => `${a.label}: ${a.relation}`)).toEqual(
    reachable.map((a) => `${a.label}: self`),
  );
};

/**
 * Assert the grey fill, and that it is a FILL and not a dimming (AC3).
 *
 * `opacity` is the treatment this replaces, and the reason is measurable:
 * opacity composites the whole subtree — the control AND its label — with
 * whatever happens to be behind, so the label's contrast depends on the page
 * atmosphere at that spot. The comment already in `ClassroomGroupsPage.astro`
 * records that `opacity: 0.6` dropped `--ink-soft` to roughly 2.67:1, well
 * under AA. An opaque fill is what makes the ratio in `contrast.test.ts`
 * (`--ink-soft` on `--disabled-fill`, 5.19:1) the ratio the user actually
 * receives.
 */
const expectDisabledPaint = (
  reachable: readonly Affordance[],
  fill: string,
  ink: string,
  scenario: string,
) => {
  const painted = reachable.filter((a) => !a.uaPainted);
  searched(painted, {
    of: painted.map((a) => a.label),
    what: `page-painted disabled controls (${scenario})`,
  });
  expect(painted.map((a) => `${a.label}: ${a.background}`)).toEqual(
    painted.map((a) => `${a.label}: ${fill}`),
  );
  expect(painted.map((a) => `${a.label}: ${a.opacity}`)).toEqual(
    painted.map((a) => `${a.label}: 1`),
  );
  // The ratio the contrast suite computes is `--ink-soft` on
  // `--disabled-fill`. This is what makes that pair the one a teacher
  // actually receives: without it the suite would be scoring two tokens
  // against each other while Safari painted the label in the UA's own
  // disabled grey, which is a guard measuring a pixel that does not exist.
  expect(painted.map((a) => `${a.label}: ${a.ink}`)).toEqual(
    painted.map((a) => `${a.label}: ${ink}`),
  );
};

type Reason = {
  readonly label: string;
  /** The ids `aria-describedby` names, or `(none)`. */
  readonly names: string;
  /** How each named element resolves: `visible` | `hidden` | `empty` | `missing`. */
  readonly resolves: string;
};

/**
 * Why each disabled control is disabled, reachable without a pointer.
 *
 * The accessible description and the visible reason cannot disagree here by
 * construction, because they are THE SAME NODES: `aria-describedby` names an
 * element and a screen reader reads that element's text. What CAN diverge —
 * and what AC10 is really about — is visibility: `aria-describedby` still
 * contributes the text of an element that is `hidden`, so a reason a screen
 * reader hears while nobody can see it satisfies a naive check and fails a
 * teacher looking at the page. So each named element is required to be
 * present, non-empty AND visible.
 */
const reasons = async (page: Page): Promise<readonly Reason[]> =>
  page.evaluate(() =>
    [...document.querySelectorAll<HTMLElement>('[data-disabled-250]')].map(
      (el) => {
        const label = el.getAttribute('data-disabled-250')!;
        const ids = (el.getAttribute('aria-describedby') ?? '')
          .split(/\s+/)
          .filter(Boolean);
        if (ids.length === 0) return { label, names: '(none)', resolves: '' };
        return {
          label,
          names: ids.join(' '),
          resolves: ids
            .map((id) => {
              const target = document.getElementById(id);
              if (target === null) return `${id}=missing`;
              // `getClientRects().length` rather than the element's own
              // computed display: `display: none` on an ANCESTOR leaves a
              // descendant's computed display untouched, so a per-element
              // check reports hidden content as rendered (#17).
              if (target.getClientRects().length === 0) return `${id}=hidden`;
              if ((target.textContent ?? '').trim() === '')
                return `${id}=empty`;
              return `${id}=visible`;
            })
            .join(' '),
        };
      },
    ),
  );

/**
 * Assert every disabled control carries a reason a teacher can read without
 * hovering and without a pointer at all (AC8, AC10).
 */
const expectAReasonWithoutHover = (
  seen: readonly Reason[],
  scenario: string,
) => {
  searched(seen, {
    of: seen.map((r) => r.label),
    what: `disabled controls needing a reason (${scenario})`,
  });
  expect(
    seen.map((r) => `${r.label}: ${r.names} → ${r.resolves || '(unwired)'}`),
  ).toEqual(
    seen.map(
      (r) =>
        `${r.label}: ${r.names} → ${r.names
          .split(' ')
          .map((id) => `${id}=visible`)
          .join(' ')}`,
    ),
  );
};

test.describe('a disabled control affords that it is disabled', () => {
  test('default state — every disabled control shows the no-entry cursor', async ({
    page,
  }) => {
    await page.goto('/classroom-groups');
    await openEveryDisclosure(page);

    const { reachable } = await affordances(page);
    expectNoEntryCursor(reachable, 'default');
    // No fill assertion here, and that is a FINDING rather than an omission:
    // with an empty roster the count box and the three number fields are
    // still enabled, so the only disabled controls in this state are the two
    // sex checkboxes — which the UA paints. `searched` refused the fill
    // assertion over that empty population on the first run, which is the
    // liveness control doing exactly its job. Stated positively instead, so
    // a control that STOPS being UA-painted turns this red rather than
    // slipping past an assertion that was never reached.
    // The population inside the verdict (#446): absence-liveness could not
    // see through `const { reachable } = await affordances(page)` until AC6,
    // so this absence went unjudged, held up only by the call above.
    expect(
      searched(
        reachable.filter((a) => !a.uaPainted).map((a) => a.label),
        { of: reachable, what: 'disabled controls in the default state' },
      ),
    ).toEqual([]);

    // `reasons` reads the tags `affordances` just wrote, so it always runs
    // after it — the two share one derivation of the population.
    expectAReasonWithoutHover(await reasons(page), 'default');
  });

  // One test per theme (#419): a hundred-row roster under two themes was one
  // budget.
  for (const theme of THEMES)
    test(`${theme}: roster at the limit — the add buttons and Make groups too`, async ({
      page,
    }) => {
      await openRoster(page);
      // `openRoster` already added one, so this lands exactly ON the limit
      // rather than asking the page to clamp an overshoot.
      await addSeveral(page, MAX_ROSTER - 1);
      await openEveryDisclosure(page);
      await emulateTheme(page, theme);
      const { reachable, fill, ink } = await affordances(page);
      expectNoEntryCursor(reachable, `at-limit, ${theme}`);
      expectDisabledPaint(reachable, fill, ink, `at-limit, ${theme}`);
      // `reasons` reads the tags `affordances` just wrote, so it runs after.
      expectAReasonWithoutHover(await reasons(page), 'at-limit');
    });

  for (const theme of THEMES)
    test(`${theme}: the disabled placeholder option is excluded deliberately, and it exists`, async ({
      page,
    }) => {
      await openRoster(page);
      // Choosing a sex is what disables that row's "—" option (roster-ui.ts).
      // Without this the exclusion branch never fires, and a detector branch
      // that has never matched anything is itself vacuous (#118).
      await setSex(page, 0, 'M');
      await emulateTheme(page, theme);
      const { reachable, excluded, fill, ink } = await affordances(page);
      searched(excluded, {
        of: excluded,
        what: 'disabled placeholder options',
      });
      // Exactly one row, so exactly one placeholder — and nothing BUT an
      // `<option>` may sit in the excluded set.
      expect(excluded).toEqual(['option']);
      expectNoEntryCursor(reachable, `a sex chosen, ${theme}`);
      expectDisabledPaint(reachable, fill, ink, `a sex chosen, ${theme}`);
    });

  test('only checkbox, radio and file inputs are left to the UA to paint', async ({
    page,
  }) => {
    // The fill carve-out, asserted rather than assumed. Without this the
    // `uaPainted` branch could grow to swallow a control that SHOULD be
    // painted, and `expectDisabledPaint` would quietly stop covering it.
    await openRoster(page);
    await addSeveral(page, MAX_ROSTER - 1);
    await openEveryDisclosure(page);

    const { reachable } = await affordances(page);
    const carvedOut = reachable.filter((a) => a.uaPainted).map((a) => a.label);
    searched(carvedOut, {
      of: carvedOut,
      what: 'UA-painted disabled controls',
    });
    expect(carvedOut).toEqual(['cg-sex-mix', 'cg-sex-separate']);
  });

  test('the no-entry cursor marks the disabled controls apart from the enabled ones', async ({
    page,
  }) => {
    await openRoster(page);
    await addSeveral(page, MAX_ROSTER - 1);
    await openEveryDisclosure(page);

    const { reachable, enabled } = await affordances(page);

    // The NEW invariant first. A test stops at its first failed expectation
    // (#156), so an assertion ordered after one this file already makes
    // would only ever be evaluated while that one holds.
    const leaked = enabled
      .filter((control) => control.cursor === 'not-allowed')
      .map((control) => control.label);
    expect(
      searched(leaked, {
        of: enabled.map((control) => control.label),
        what: 'enabled controls',
      }),
    ).toEqual([]);

    // ...and the other half, read from the SAME snapshot, so the contrast is
    // one screen a teacher is looking at rather than two page states.
    expectNoEntryCursor(reachable, 'at-limit, against the enabled controls');
  });

  // Every locale (#390 F135): a fit test, and each language's disabled
  // reasons and labels are its own widths. One test per page, because a
  // hundred-row roster five times over would share one budget.
  for (const path of localePaths('/classroom-groups'))
    test(
      `at 320px every disabled control keeps a 44px target, and the page does not scroll sideways -- ${path}`,
      { tag: '@emulated-viewport' },
      async ({ page }) => {
        await page.setViewportSize({ width: 320, height: 900 });
        await openRoster(page, path);
        await addSeveral(page, MAX_ROSTER - 1);
        await openEveryDisclosure(page);

        const { reachable } = await affordances(page);

        // UA-painted inputs are carved out for the reason the fill carve-out
        // exists: the raw checkbox is not what a finger lands on. `.switch`'s
        // 44px min-height sits on the LABEL, measured by
        // classroom-groups-controls.spec.ts, and a second opinion here would
        // only split the truth in two.
        const measured = reachable.filter((a) => !a.uaPainted);
        // A target is 44px each way: a control 44px tall and 30px wide is still
        // a 30px target for a finger.
        const small = measured
          .filter((a) => a.width < 44 || a.height < 44)
          .map(
            (a) =>
              `${a.label} — ${a.width.toFixed(1)} × ${a.height.toFixed(1)}px`,
          );
        expect(
          searched(small, {
            of: measured.map((a) => a.label),
            what: 'disabled controls at 320px',
          }),
        ).toEqual([]);

        // The instrument classroom-groups-controls.spec.ts already uses, so
        // the second home cannot disagree with the first about what counts.
        await expectNoHorizontalScroll(page);
      },
    );
});

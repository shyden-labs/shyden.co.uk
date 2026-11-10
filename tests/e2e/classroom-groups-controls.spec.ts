import { chooseOption } from '../real-select';
import { scrollToOn, setCheckedOn, tapOn } from '../real-touch';
import { onRealDevice } from '../device/device-downloads';
import { typeInto } from '../real-typing';
import type { Page } from '@playwright/test';
import { test, expect } from './fixtures';
import { makeGroups } from '../make-groups';
import { MAX_STUDENTS } from '../../src/lib/grouping';
import { recordErrors } from './recorders';
import { localePaths, sampledPaths } from './locale-sampling';
import { getStrings, localeFromPath } from '../../src/lib/i18n';
import { searched } from '../source-files';
import {
  addSeveral,
  buildRoster,
  openRoster,
  giveEveryoneASex,
  rosterOf,
} from './helpers';
import { recorded } from './evidence';
import {
  horizontalOverflow,
  expectNoHorizontalScroll,
  rectAtLeast44,
  spillPastCard,
} from '../viewport';
import { atViewport } from '../viewport-at';

test.use(recorded);

/**
 * How `.tool-sections` is laid out now: its grid tracks, the media rules in
 * the page's stylesheets that set its columns, and whether the width matches
 * them. Read in the page, so a breakpoint moved in the CSS moves here too.
 */
const sectionsLayout = (page: Page) =>
  page.evaluate(() => {
    const grid = document.querySelector('.tool-sections');
    if (grid === null) throw new Error('no .tool-sections on the page');
    const tracks = getComputedStyle(grid)
      .gridTemplateColumns.split(' ')
      .filter(Boolean).length;
    const media: string[] = [];
    for (const sheet of Array.from(document.styleSheets)) {
      for (const rule of Array.from(sheet.cssRules)) {
        if (!(rule instanceof CSSMediaRule)) continue;
        const setsColumns = Array.from(rule.cssRules).some(
          (inner) =>
            inner instanceof CSSStyleRule &&
            /^\.tool-sections(\[[^\]]+\])?$/.test(inner.selectorText) &&
            inner.style.gridTemplateColumns !== '',
        );
        if (setsColumns) media.push(rule.media.mediaText);
      }
    }
    const wide = media.length === 1 && matchMedia(media[0]).matches;
    return { tracks, media, wide };
  });

/**
 * The controls the review found reachable from the page and asserted by
 * nothing: the theme picker, the leftovers radios, the sound label, and what
 * happens when the same button is pressed twice or after a refusal.
 *
 * Plus the three checks every other page on this site already has —
 * horizontal scroll, touch targets, console errors — which this page, the
 * only one that ships a script and about ten controls, did not.
 */

test.describe('the controls that had no tests', () => {
  // Stage 3, Task 8 (design spec section 5) removed the theme picker and
  // the naming radio that revealed it -- three tests used to live here
  // exercising them directly ("themed groups are named from the chosen
  // theme, in each language", "the theme picker offers every theme,
  // translated", "numbering past the end of a theme falls back rather than
  // repeating"), deleted in the same commit that removes the feature
  // (design spec section 13's own "tests for a removed feature are deleted
  // in the same stage that removes it"). These two replace them: proving
  // the removal itself, and that the numbered default it leaves behind
  // still works.
  //
  // task-8-brief.md's own given snippet for both has three real bugs, each
  // the SAME recurring shape this stage's own progress ledger already
  // records more than once (task-6/7's reports: a brief-given label or
  // selector that does not exist on the real page) -- found by RUNNING
  // this against the page, not by re-reading the brief harder:
  //   - `page.getByLabel('Animals')` and
  //     `page.getByRole('radio', { name: /Numbered|Themed/ })` both return
  //     ZERO matches on the UNMODIFIED, pre-Task-8 page too -- "Animals" was
  //     never a <label>, only <option> text inside one; the two naming
  //     radios' own accessible names are "Group 1, 2, 3…" / "Use a theme",
  //     neither of which contains the word "Numbered" or "Themed" anywhere.
  //     Both assertions would have passed whether or not the removal ever
  //     happened -- decoration, not proof. Replaced with direct, structural
  //     checks: the naming radio GROUP is gone (`input[name="naming"]`) and
  //     its own legend text no longer renders anywhere on the page.
  //   - `page.getByLabel('How many students?')` -- the real label is
  //     "Number of students" (`studentsLabel`, en.ts). `getByRole('button',
  //     { name: 'Make groups' })` -- the real button text is "Make Groups",
  //     capital G (`makeGroups`, en.ts); Playwright's own case-sensitive
  //     string matching (this file's own `makeGroups` helper reads the
  //     control by id already, sidestepping both).
  //   - count=9/size=4 (the brief's own numbers) produces TWO groups, not
  //     three -- proven by an already-passing sibling test in this suite's
  //     own family (classroom-groups.spec.ts's "a blank class name blocks
  //     nothing": `fill(page, { count: '9', size: '4' })` then
  //     `expect(page.locator('#cg-results .group')).toHaveCount(2)`).
  //     Replaced with count=12/size=4 -- a clean division (three groups of
  //     four, no leftover-redistribution ambiguity) that genuinely yields
  //     three sequentially-numbered groups.
  test('the English page: no theme controls, and the sound section says its state and remembers', async ({
    page,
  }) => {
    await page.goto('/classroom-groups');
    // Read first, before anything is pressed.
    await expect.soft(page.locator('#cg-theme')).toHaveCount(0);
    await expect.soft(page.locator('input[name="naming"]')).toHaveCount(0);
    await expect.soft(page.getByText('Name the groups')).toHaveCount(0);

    // Stage 2, Task 7: the checkbox now lives inside #cg-sound-body, and
    // every visit starts collapsed (design spec section 11 names only the
    // how-to state and a later print panel as UI preferences allowed to
    // persist) -- so it has to be reopened after the reload below too.
    await tapOn(page.locator('#cg-sound-toggle'));
    // Task 8, the locale sweep. sectionSoundHeading ("Sound and animation")
    // had been clicked by id in every file that opens this section, but its
    // own rendered text had never been asserted anywhere -- this is the
    // whole button label, with no `· state` half to join it to (see
    // sections.ts's own doc comment on why sectionState returns three
    // fields, not four).
    await expect
      .soft(page.locator('#cg-sound-toggle'))
      .toHaveText('Sound and animation');
    // Only toBeChecked was asserted -- the visible words were not, so the
    // label could have said the opposite of the control.
    await expect.soft(page.locator('#cg-sound-text')).toHaveText('Sound on');
    // Not a count, since an option whose label went missing renders empty and
    // a count would not notice. speedNormal is genuinely "Normal" in both
    // languages (i18n.test.ts's own ALLOWED_IDENTICAL), so this is the only
    // place that fact is proven against the real page rather than assumed.
    await expect
      .soft(page.locator('#cg-speed option'))
      .toHaveText(['Normal', 'Fast', 'Skip the animation']);
    await setCheckedOn(page.locator('#cg-sound-check'), false);
    await expect.soft(page.locator('#cg-sound-text')).toHaveText('Sound off');
    await page.reload();
    await tapOn(page.locator('#cg-sound-toggle'));
    await expect.soft(page.locator('#cg-sound-check')).not.toBeChecked();
    await expect.soft(page.locator('#cg-sound-text')).toHaveText('Sound off');
  });

  test('groups are numbered, a second press reshuffles, and a refusal and a success clear each other', async ({
    page,
  }) => {
    await page.goto('/classroom-groups');
    await makeGroups(page, '12', '4');
    await expect
      .soft(page.locator('#cg-results .group h3'))
      .toHaveText(['Group 1', 'Group 2', 'Group 3']);
    await expect.soft(page.locator('#cg-results')).toBeVisible();
    await expect.soft(page.locator('#cg-results .student')).toHaveCount(12);

    await tapOn(page.locator('#cg-go'));
    // Not 24. The results are replaced, not added to.
    await expect.soft(page.locator('#cg-results .student')).toHaveCount(12);

    await makeGroups(page, '0', '4');
    await expect.soft(page.locator('#cg-error')).toBeVisible();
    await expect.soft(page.locator('#cg-results')).toBeHidden();

    // And back again: the error must not linger over a fresh result.
    await makeGroups(page, '12', '4');
    await expect.soft(page.locator('#cg-results')).toBeVisible();
    await expect.soft(page.locator('#cg-error')).toBeHidden();
  });

  test('the leftovers choice actually changes the shape', async ({ page }) => {
    // 23 students in groups of 4: spread is 6,6,6,5 — bunch is 7,4,4,4,4.
    await page.goto('/classroom-groups');
    await makeGroups(page, '23', '4');
    const spread = await page.locator('#cg-results .group').count();
    const spreadSizes = await page
      .locator('#cg-results .group')
      .evaluateAll((els) =>
        els.map((e) => e.querySelectorAll('.student').length),
      );

    // Stage 2, Task 4 moved the leftovers radios into #cg-grouping-body,
    // which starts collapsed (`hidden`) -- Playwright's `check` waits for
    // its target to be visible, so a hidden radio times out rather than
    // being checked. Opening the section first is the same thing a teacher
    // has to do; it is not a workaround.
    await tapOn(page.locator('#cg-grouping-toggle'));
    await setCheckedOn(page.locator('input[name="leftovers"][value="bunch"]'));
    await tapOn(page.locator('#cg-go'));
    const bunchSizes = await page
      .locator('#cg-results .group')
      .evaluateAll((els) =>
        els.map((e) => e.querySelectorAll('.student').length),
      );

    expect(spread).toBe(5);
    expect([...spreadSizes].sort((a, b) => b - a)).toEqual([5, 5, 5, 4, 4]);
    expect([...bunchSizes].sort((a, b) => b - a)).toEqual([7, 4, 4, 4, 4]);
  });

  // Task 8, the locale sweep. This whole section (heading, sound label,
  // speed label) had zero Indonesian e2e coverage -- every existing
  // interaction with it goes through an id or a selectOption VALUE
  // ('fast'/'skip'/'normal'), never the page's own words.
  test('the sound section reads in Indonesian, as whole sentences', async ({
    page,
  }) => {
    await page.goto('/id/classroom-groups');
    await tapOn(page.locator('#cg-sound-toggle'));
    await expect
      .soft(page.locator('#cg-sound-toggle'))
      .toHaveText('Suara dan animasi');
    await expect.soft(page.locator('#cg-sound-text')).toHaveText('Suara aktif');
    await setCheckedOn(page.locator('#cg-sound-check'), false);
    await expect.soft(page.locator('#cg-sound-text')).toHaveText('Suara mati');
    // { exact: true }: getByLabel's default match is a substring, not a
    // whole string -- a mutation spot-check on a sibling test in
    // classroom-groups.spec.ts ('the Split by row names its own fields')
    // found this the same way it found getByText's own default.
    await expect
      .soft(page.getByLabel('Kecepatan', { exact: true }))
      .toBeVisible();
    await expect
      .soft(page.locator('#cg-speed option'))
      .toHaveText(['Normal', 'Cepat', 'Lewati animasi']);
  });

  test('a device asking for less motion gets the answer without the show', async ({
    page,
  }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.goto('/classroom-groups');
    // #cg-speed sits inside #cg-sound-body since Stage 2, Task 7.
    await tapOn(page.locator('#cg-sound-toggle'));
    // A default, not a lock — the teacher can still turn it back on.
    await expect(page.locator('#cg-speed')).toHaveValue('skip');
  });
});

test.describe('the results are styled, not just present', () => {
  /**
   * Every other test here counts elements and reads text, and all of them
   * passed while the entire results area rendered unstyled.
   *
   * The script BUILDS the results at runtime, so the elements it creates
   * never carry Astro's `data-astro-cid-…` scope attribute — and every rule
   * in the component's <style> block is compiled to
   * `.avatar[data-astro-cid-vs67owv4]`, which matches none of them. The
   * avatars therefore had no size and filled the width of the card as black
   * circles, and the deal animation never animated. Found on a real phone,
   * where one child's face covered the screen.
   */
  test('the results are styled: a small face, a defined coloured face, a flex row and a card', async ({
    page,
  }) => {
    await page.goto('/classroom-groups');
    await makeGroups(page, '8', '4');
    await expect.soft(page.locator('#cg-results .student')).toHaveCount(8);

    // An avatar is a small face, not a full-width black circle.
    const box = await page.locator('#cg-results .avatar').first().boundingBox();
    expect.soft(box).not.toBeNull();
    expect.soft(box!.width).toBeGreaterThan(20);
    expect.soft(box!.width).toBeLessThan(60);
    expect.soft(Math.abs(box!.width - box!.height)).toBeLessThan(2);

    // Stage 3, Task 8 (design spec section 5) replaced the single grey/hued
    // silhouette this describe block's own header comment was written against
    // with three sex-based faces, hand-authored once each as a `<symbol>` and
    // referenced by `<use>` (src/lib/avatars.ts's own doc comment has the
    // full "one definition however many appear" reasoning). That changes what
    // "coloured, not black" actually has to prove, and where:
    //
    //   - Colour used to arrive as a `--hue` CSS custom property this page's
    //     own scoped styles set per student; now it is baked directly into
    //     each shape's own `fill="…"` attribute inside the `<symbol>`
    //     (src/lib/avatars.ts), so there is no computed style left to read —
    //     `getComputedStyle` is not this fill's source of truth any more,
    //     the attribute is.
    //   - A `<use>`'s referenced content is cloned into a shadow tree that
    //     `document.querySelectorAll`/Playwright locators cannot see inside —
    //     `#cg-results .a-bg` (the old locator) can never resolve to
    //     anything once colour lives inside a `<symbol>` reached only by
    //     `<use>`, no matter how the assertion itself is written. Reading the
    //     DEFINITION's own attribute instead — a real, light-DOM element,
    //     just never painted on its own — sidesteps that entirely rather
    //     than gambling on how any given engine resolves computed style for
    //     content that is never directly rendered.
    // Each rendered avatar references one of the three defined, coloured
    // faces.
    // The sprite: exactly three <symbol>s, each a real fill attribute, none
    // of them black (an unstyled SVG shape with no fill at all defaults to
    // black -- the exact failure mode the old Astro-scoping bug produced,
    // see this describe block's own header comment).
    const defs = await page
      .locator('.cg-avatar-defs symbol')
      .evaluateAll((symbols) =>
        symbols.map((s) => ({
          id: s.id,
          fill: s.querySelector('.a-bg')?.getAttribute('fill') ?? null,
        })),
      );
    expect
      .soft(defs.map((d) => d.id).sort())
      .toEqual(['avatar-f', 'avatar-m', 'avatar-n']);
    for (const { fill } of defs) {
      expect.soft(fill).not.toBeNull();
      expect.soft(fill).not.toBe('#000');
      expect.soft(fill).toMatch(/^hsl\(/);
    }

    // Every rendered instance actually references one of those three --
    // proving the wiring end to end, not just that the definitions exist.
    const hrefs = await page
      .locator('#cg-results .avatar use')
      .evaluateAll((uses) => uses.map((u) => u.getAttribute('href')));
    expect.soft(hrefs).toHaveLength(8);
    const definedIds = new Set(defs.map((d) => `#${d.id}`));
    for (const href of hrefs)
      expect.soft(definedIds.has(href ?? '')).toBe(true);

    // A student row lays out beside its avatar.
    const display = await page
      .locator('#cg-results .student')
      .first()
      .evaluate((el) => getComputedStyle(el).display);
    expect.soft(display).toBe('flex');

    // A group is a card, not bare text.
    const border = await page
      .locator('#cg-results .group')
      .first()
      .evaluate((el) => getComputedStyle(el).borderTopWidth);
    expect.soft(border).not.toBe('0px');
  });
});

test.describe('classroom groups — mobile-first layout', () => {
  // 'a long name does not push the layout sideways' is retired along with
  // the paste-names box it depended on (#cg-names) -- it fed `students:
  // string[]`, an input shape the rewritten engine no longer accepts (see
  // grouping.ts's GroupingInput). The `overflow-wrap: anywhere` rule this
  // test exercised on `.who` in ClassroomGroupsPage.astro's global styles is
  // still in place; a later stage that reintroduces a named roster should
  // also reintroduce this test against it.

  // L-05/L-06 (test traceability matrix). "No horizontal scroll... in any
  // state" was untested for an OPEN section until now: all three sections
  // Task 3 built had empty bodies, and an empty div cannot overflow.
  // #cg-grouping is the first to hold real content (two switches, the
  // why-paragraph, the leftovers radios) -- the first place this claim can
  // actually be checked rather than merely stated. Two widths, not the full
  // four: 320px is the tightest (mobile-first floor) and 768px is where
  // `.tool-sections` switches to two columns, so #cg-grouping's open
  // content sits in a narrower column than the full viewport -- a distinct
  // geometry worth its own check.
  // Stage 2, Task 7: Sound & animation is the SECOND section to hold real
  // content (the sound checkbox and the speed select), so it earns the same
  // check the loop above gave Grouping options, for the same two widths and
  // the same reason (320px is the mobile-first floor; 768px is where
  // `.tool-sections` becomes two columns, a distinct geometry).
  for (const width of [320, 768]) {
    test(`no horizontal scroll with Grouping options, then Sound & animation, open, at ${width}px`, async ({
      page,
    }) => {
      await atViewport(page, { width, height: 900 });
      await page.goto('/classroom-groups');
      await tapOn(page.locator('#cg-grouping-toggle'));
      await expectNoScrollSoft(page, 'Grouping options open');
      // Closed again, so Sound & animation is measured open on its own.
      await tapOn(page.locator('#cg-grouping-toggle'));
      await tapOn(page.locator('#cg-sound-toggle'));
      await expectNoScrollSoft(page, 'Sound & animation open');
    });
  }

  // Every locale (#423): the buttons and labels measured here hold the
  // page's own copy, and a two-character zh label can make a box narrower
  // than an English one.
  const expectTouchTargets = async (page: Page) => {
    // Measured in BOTH states of the mode field, because "students per
    // group" and "how many groups" are never on screen at the same time —
    // and a control that is not displayed measures 0, which is not the
    // same thing as too small. Used to also toggle the naming radio's own
    // conditional theme `<select>` the same way; Stage 3, Task 8 removed
    // that field along with the radio that revealed it (design spec
    // section 5), leaving one conditional field, not two.
    //
    // Stage 2, Task 5 added `#cg-form input[type="text"]` to this selector
    // for the new #cg-class field. Honestly: this could not go red before
    // that field existed, and does not prove much on its own even after --
    // `small` starts and stays `[]` whether or not #cg-class is measured at
    // all, which is exactly what happened when this line was added (a
    // pre-implementation run stayed green, confirmed rather than assumed).
    // What it DOES buy, from here on, is real: a #cg-class CSS rule that
    // dropped below 44px would populate `small` and redden `expect.soft(small).
    // toEqual([])` below, the same as it would for any control this test
    // already covered. `seen`'s own lower bound was left alone rather than
    // bumped to "prove" #cg-class was counted -- the real baseline already
    // includes the three section-toggle buttons inside #cg-form (missed on
    // a first pass), so it sits comfortably above 5 with or without
    // #cg-class, and tightening it to track an exact count would make this
    // test brittle against unrelated future controls for no real gain.
    //
    // Noted on code review, not a hole: `#cg-speed` (and `#cg-sound-check`)
    // moved into `#cg-sound-body` in Stage 2, Task 7, which starts
    // `hidden`, and this test never opens it -- `offsetParent !== null`
    // below correctly drops both from `small` and from `seen`'s count, the
    // same as it would for any control inside a collapsed section. Neither
    // control silently loses coverage overall: classroom-groups.spec.ts's
    // own "every interactive target is at least 44px, collapsed and with
    // every section open" test opens all four sections first and measures
    // everything inside them, `#cg-speed` included. This test's own job is
    // narrower -- the controls already on screen before a teacher opens
    // anything -- and #cg-speed simply is not one of those any more.
    // `[form="cg-form"]`: the form's controls that live outside it. #cg-go
    // has since #384, and `#cg-form button` alone would stop measuring it.
    const measureVisible = () =>
      page
        .locator(
          '#cg-form select, #cg-form button, #cg-form input[type="number"], #cg-form input[type="text"], [form="cg-form"]',
        )
        .evaluateAll((els) =>
          els
            .filter((el) => (el as HTMLElement).offsetParent !== null)
            .map((el) => ({
              id: el.id,
              height: el.getBoundingClientRect().height,
            })),
        );

    // Every control measured, in both states: the population the verdict
    // below is drawn from (#610).
    const measured = [...(await measureVisible())];
    await setCheckedOn(page.locator('input[name="mode"][value="groupCount"]'));
    measured.push(...(await measureVisible()));
    const small = measured.filter((c) => c.height < 44);

    // And prove the measurement actually saw the fields, rather than
    // reporting nothing because it found nothing to look at.
    const seen = await page
      .locator(
        '#cg-form select, #cg-form button, #cg-form input[type="number"], #cg-form input[type="text"], [form="cg-form"]',
      )
      .evaluateAll(
        (els) =>
          els.filter((el) => (el as HTMLElement).offsetParent !== null).length,
      );
    expect.soft(seen).toBeGreaterThanOrEqual(5);
    expect
      .soft(
        searched(small, {
          of: measured,
          what: 'visible controls measured in both modes',
        }),
      )
      .toEqual([]);
  };

  // The same check as expectNoHorizontalScroll, but soft, so one overflow
  // does not hide the checks after it on the same journey.
  const expectNoScrollSoft = async (page: Page, note: string) => {
    const overflow = await horizontalOverflow(page);
    expect
      .soft(overflow, `${note} scrolls sideways by ${overflow}px`)
      .toBeLessThanOrEqual(0);
  };

  // Design spec section 13: "no horizontal page scroll at any of those four
  // widths, in any state" -- "with results shown" was the one reachable
  // state nothing above checked. A hundred students maximises the number of
  // group cards and avatars actually on screen, the real-content analogue
  // of the long-class-name check elsewhere in this file.
  //
  // Every locale (#390 F135): each card's group name and "Student N" labels
  // are the page's own language, and this read English only.
  //
  // And with results actually shown (#390 F136). This asked for 120 students
  // against a ceiling of 100, so the page refused, rendered no results, and
  // the overflow check measured a page without them, since #9. The count is
  // the ceiling itself now, and the cards are counted before anything is
  // measured, so a refusal fails here instead of passing.
  // Each (locale, width) loads the page once. The default page is measured
  // first, before anything is pressed; then, at the widths that name them,
  // the page with a full set of results (320, 768) and every control's touch
  // target (375).
  for (const path of localePaths('/classroom-groups')) {
    for (const width of [320, 375, 768, 1280]) {
      const withResults = width === 320 || width === 768;
      const title =
        `${path}: no horizontal scroll at ${width}px` +
        (withResults ? ', and with results shown' : '') +
        (width === 375
          ? ', and every control meets the 44px touch target'
          : '');
      test(title, async ({ page }) => {
        await atViewport(page, { width, height: 900 });
        await page.goto(path);
        await expectNoScrollSoft(page, page.url());
        if (width === 375) await expectTouchTargets(page);
        if (withResults) {
          await makeGroups(page, String(MAX_STUDENTS), '4');
          await expect
            .soft(page.locator('#cg-results .group'))
            .toHaveCount(Math.ceil(MAX_STUDENTS / 4));
          await expectNoScrollSoft(page, `${path} with results shown`);
        }
      });
    }
  }

  // ── The gap that let a real overflow ship ──────────────────────────────
  //
  // The checks above open `#cg-grouping-toggle` and `#cg-sound-toggle` and
  // nothing else, because each was added when its own section first gained
  // content. `#cg-io-toggle` never got one — and Import / export is the one
  // section holding a native `<input type="file">`, whose intrinsic minimum
  // (~344px in Chromium: the button plus "No file chosen") propagated up
  // `#cg-form`'s grid, whose items default to `min-width: auto`, and pinned
  // the form's only track to 378px regardless of viewport. Result: 5px of
  // horizontal scroll at 390px, 74px at 320px, in both locales, live.
  //
  // A hand-written list of sections is what missed it, so this does not add
  // Import / export to the list — it DERIVES every toggle from the DOM. A
  // section added later is covered the day it appears, with no test edit.
  // One test per (locale, width). This was a single test that looped both,
  // which put ~42 navigations and ~60 clicks inside Playwright's default 30s
  // PER-TEST budget: firefox spent 22.2s of it on an idle machine and blew
  // past 30s under the parallel suite, so the verdict was decided by machine
  // load rather than by the page. Split, it matches the generated-per-width
  // pattern in homepage.spec.ts / site-meta.spec.ts, each case runs ~7
  // navigations, the cases run in parallel, and a failure names its locale
  // and width in the title instead of only in the message.
  for (const path of localePaths('/classroom-groups')) {
    for (const width of [320, 390, 768]) {
      test(`no horizontal scroll at ${width}px with any single section open — ${path}, every section derived`, async ({
        page,
      }) => {
        const failures: string[] = [];
        const took = await atViewport(page, { width, height: 900 });
        await page.goto(path);
        const ids = await page
          .locator('button[aria-expanded][aria-controls]')
          .evaluateAll((els) => els.map((e) => e.id).filter(Boolean));
        // A page with no disclosures would make every assertion below
        // vacuous, so the count is asserted rather than assumed.
        expect(
          ids.length,
          `${path}: no disclosure buttons found`,
        ).toBeGreaterThan(3);
        // runtime population: the disclosure toggles this page rendered,
        // read off the DOM above, so a section added later is covered the
        // day it appears; collection time cannot know them (#417).
        for (const id of ids) {
          await page.goto(path);
          await tapOn(page.locator(`#${id}`));
          const overflow = await horizontalOverflow(page);
          if (overflow > 0)
            failures.push(
              `${path} @${took.width}px with #${id} open: ${overflow}px`,
            );
        }
        // …and every section open at once, which no earlier test did.
        await page.goto(path);
        for (const id of ids) await tapOn(page.locator(`#${id}`));
        const all = await horizontalOverflow(page);
        if (all > 0)
          failures.push(`${path} @${took.width}px with ALL open: ${all}px`);
        expect(
          searched(failures, { of: ids, what: 'disclosure sections' }),
          failures.join('\n'),
        ).toEqual([]);
      });
    }
  }

  // ── Flex ate the whitespace the markup authored ────────────────────────
  //
  // `.tool-section-toggle` and `.howto-toggle` are `display: flex`, which
  // makes the ::before marker and every text node a flex ITEM — and flex
  // discards whitespace BETWEEN items and trims it at an item's edge. The
  // authored space in `content: '▸ '` and the one in
  // `Student details · <span class="state">` were both thrown away, so the
  // page read "▸Student details ·none added" in both locales.
  //
  // This has to be measured, not read: `textContent` still contains both
  // spaces, so every text assertion on this page passed while it looked
  // broken. Geometry is the only witness.
  for (const path of localePaths('/classroom-groups'))
    test(`${path}: a disclosure label keeps a visible gap between marker, label and state, and the page logs no console errors`, async ({
      page,
    }) => {
      const reported = recordErrors(page);
      await page.goto(path);
      const gaps = await page.evaluate(() => {
        const out: {
          id: string;
          markerGap: number;
          stateGap: number | null;
        }[] = [];
        for (const btn of document.querySelectorAll<HTMLElement>(
          '.tool-section-toggle, .howto-toggle',
        )) {
          const text = [...btn.childNodes].find(
            (n) => n.nodeType === 3 && n.textContent?.trim(),
          );
          if (!text) continue;
          const r = document.createRange();
          r.selectNodeContents(text);
          const textBox = r.getBoundingClientRect();
          const markerW =
            parseFloat(getComputedStyle(btn, '::before').width) || 0;
          const btnBox = btn.getBoundingClientRect();
          // marker sits at the button's content start; the gap is whatever
          // lies between its right edge and the label's left edge.
          const markerGap =
            textBox.left -
            (btnBox.left +
              parseFloat(getComputedStyle(btn).paddingLeft) +
              markerW);
          const state = btn.querySelector('.state');
          const stateGap = state
            ? state.getBoundingClientRect().left - textBox.right
            : null;
          out.push({ id: btn.id, markerGap, stateGap });
        }
        return out;
      });
      expect
        .soft(gaps.length, `${path}: no disclosure toggles found`)
        .toBeGreaterThan(3);
      for (const g of gaps) {
        expect
          .soft(
            g.markerGap,
            `${path} #${g.id}: marker is flush against the label`,
          )
          .toBeGreaterThan(1);
        if (g.stateGap !== null)
          expect
            .soft(
              g.stateGap,
              `${path} #${g.id}: state is flush against the label`,
            )
            .toBeGreaterThan(1);
      }

      // Then a deal, with the recorder still listening. This is the page that
      // ships a script, and it was the page without this test. One test per
      // language (#418): each has its own recorder and its own budget, and
      // every language, since a catalogue lookup that throws in one of them is
      // exactly what a sample of two cannot see.
      await makeGroups(page, '12', '4');
      await expect.soft(page.locator('#cg-results .student')).toHaveCount(12);
      await reported.expectNone(path);
    });
});

// Stage 2, Task 2's own RED tests (H-01…H-08, Y-05). The plan's literal
// snippet used `page.getByLabel('How many students?')` -- that does not
// match this page, same correction Task 1's own tests already recorded
// above (classroom-groups.spec.ts): the label reads "Number of students"
// (`studentsLabel` in en.ts), not "How many students?". Corrected to the
// real label here too, rather than reproduced verbatim.
/**
 * One walk of the How to use section (#1086): every check is made on the one
 * journey, softly, so a failure does not hide the checks after it.
 */
const howToJourney = async (
  page: Page,
  copy: {
    path: string;
    toggle: string;
    studentsLabel: string;
    partOne: string;
    partTwo: string;
  },
) => {
  await page.goto(copy.path);
  const howTo = page.locator('#cg-howto');
  const form = page.locator('#cg-form');
  const toggle = page.getByRole('button', { name: copy.toggle });
  const partOne = page.getByText(copy.partOne);
  const partTwo = page.getByText(copy.partTwo);

  // It sits above the form, and it is not one of the tool's collapsible sections.
  const hy = (await howTo.boundingBox())!.y;
  const fy = (await form.boundingBox())!.y;
  expect.soft(hy).toBeLessThan(fy);
  await expect.soft(form.locator('#cg-howto')).toHaveCount(0);

  // The old markup was a real <h2>; the toggle rewrite dropped it to a bare
  // <button>, which a screen reader can no longer find by heading navigation.
  // Assert the role and level a screen-reader user would land on, not a tag
  // count.
  await expect
    .soft(page.getByRole('heading', { name: copy.toggle, level: 2 }))
    .toBeVisible();

  // Reverses design spec section 3's original "open by default" -- section
  // 2's operator ruling 2 (2026-08-08) collapses it, because measurement
  // showed it was ~310px of a phone screen, the single biggest saving
  // toward the tool fitting one. The header stays visible and operable
  // regardless -- a control that hides itself is a trap.
  await expect.soft(toggle).toBeVisible();
  await expect.soft(toggle).toHaveAttribute('aria-expanded', 'false');
  // The whole sentence. Part 1 says WHAT the tool does; WHO it is for and
  // WHY it exists moved to the page's lead (operator, 2026-09-30, #384).
  await expect.soft(partOne).toBeHidden();
  await expect.soft(partTwo).toBeHidden();

  await tapOn(toggle);
  await expect.soft(partOne).toBeVisible();
  await expect.soft(partTwo).toBeVisible();
  await expect.soft(toggle).toBeVisible();
  // The toggle still works with the heading restored, and the heading stays.
  await expect
    .soft(page.getByRole('heading', { name: copy.toggle, level: 2 }))
    .toBeVisible();

  // A control that only ever opens is a trap too. Look for the actual
  // sentences leaving, not just an attribute flipping back.
  await tapOn(toggle);
  await expect.soft(partOne).toBeHidden();
  await expect.soft(partTwo).toBeHidden();
  await expect.soft(toggle).toBeVisible();

  // "Collapse it, reload, still collapsed" would be vacuous -- collapsed is
  // the default, so that would pass even with persistence completely unwired.
  // What proves the state round-trips through localStorage is the other
  // direction: open it, reload, and it must still be open.
  await tapOn(toggle);
  await page.reload();
  await expect.soft(partTwo).toBeVisible();
  await expect.soft(toggle).toHaveAttribute('aria-expanded', 'true');

  // Only the preference is stored, never class data.
  await typeInto(page.getByLabel(copy.studentsLabel), '12');
  await tapOn(toggle);
  const stored = await page.evaluate(() => ({ ...localStorage }));
  expect.soft(Object.values(stored).join(' ')).not.toContain('12');
  expect.soft(Object.keys(stored)).toContain('cg-howto-collapsed');
  // Every key this page writes starts `cg-`, and none of them may carry class
  // data. Asserting the EXACT list here would be a false economy: stage 5 adds
  // four print preferences and would break a test that is not about printing.
  expect.soft(Object.keys(stored).every((k) => k.startsWith('cg-'))).toBe(true);
};

test.describe('How to use', () => {
  // The who-and-why paragraph is the page's lead: read before anything is
  // opened, where How to use now starts with what the tool does (operator,
  // 2026-09-30, #384).
  test('the lead says who it is for and why, and How to use opens, closes and remembers', async ({
    page,
  }) => {
    await page.goto('/classroom-groups');
    const lead = page.locator('.lead');
    await expect.soft(lead).toHaveCount(1);
    await expect.soft(lead).toBeVisible();
    await expect
      .soft(lead)
      .toHaveText(
        'Built for teachers, by Shyden. Splitting a class fairly takes time you do not have, and doing it by hand invites an argument about favourites. This does it in one press — free, with no sign-up, and with nothing about your class ever leaving your browser.',
      );
    await howToJourney(page, {
      path: '/classroom-groups',
      toggle: 'How to use',
      // Not 'How many students?' -- see the comment above this describe block.
      studentsLabel: 'Number of students',
      partOne:
        'Tell it how big your class is and how many students you want per group. It shuffles and deals everyone out, and no group ends up smaller than you asked for unless the whole class is.',
      partTwo: 'Say how many students are in your class.',
    });
  });
});

test.describe('How to use — Indonesian', () => {
  test('How to use opens, closes and remembers', async ({ page }) => {
    await howToJourney(page, {
      path: '/id/classroom-groups',
      toggle: 'Cara menggunakan',
      studentsLabel: 'Jumlah siswa',
      partOne:
        'Masukkan jumlah siswa di kelas Anda dan berapa siswa yang Anda inginkan per kelompok. Alat ini akan mengacak dan membagikan semuanya, dan tidak ada kelompok yang jumlahnya kurang dari yang Anda tentukan, kecuali seluruh kelas memang lebih kecil.',
      partTwo: 'Masukkan jumlah siswa di kelas Anda.',
    });
  });
});

// Stage 2, Task 3's own RED tests (S-01…S-10, L-10, L-11). Same collapsible
// pattern as How to use above, for the same reason recorded there: a bare
// <button> has no heading role, so each toggle is wrapped in an <h2> —
// matching #cg-howto's own level, since these three are its siblings in the
// page's outline, not a level beneath it. Unlike How to use, these start
// COLLAPSED (design spec section 2: the tool is collapsed by default, and
// opening it is a deliberate act) and are never written to localStorage
// (section 11 names only the how-to state and a later print panel as the
// UI preferences allowed to persist).
//
// Only three of the four sections existed when this block was first
// written. Stage 2, Task 7 folded Sound & animation in as the fourth --
// see ClassroomGroupsPage.astro's own comment on how the id collision with
// the existing sound checkbox was resolved (the checkbox is now
// #cg-sound-check; the section wrapper, its toggle and its body hold
// #cg-sound/#cg-sound-toggle/#cg-sound-body) -- but its state string is
// still deliberately absent (sections.ts's own doc comment on why), so it
// is not part of the loops below, which all assert a `.state` span or a
// `label · state` sentence neither of which this section has.
/**
 * One walk of the three collapsible sections (#1086): the default page is
 * read first, before anything is pressed, then each section is opened, shut
 * and opened again, then the leftovers choice is made. Every check is soft, so
 * a failure does not hide the checks after it.
 */
const collapsibleSectionsJourney = async (
  page: Page,
  copy: {
    path: string;
    states: { students: string; grouping: string; io: string };
    headers: { students: string; grouping: string; io: string };
    headings: readonly (readonly [string, string])[];
    reopen: readonly string[];
    bunchHeader: string;
  },
) => {
  await page.goto(copy.path);

  // Every header reports its own state.
  await expect
    .soft(page.locator('#cg-students .state'))
    .toHaveText(copy.states.students);
  await expect
    .soft(page.locator('#cg-grouping .state'))
    .toHaveText(copy.states.grouping);
  await expect.soft(page.locator('#cg-io .state')).toHaveText(copy.states.io);

  // The middot joining the label to the state is a real text node (an Astro
  // expression, `{' · '}`), never template whitespace relying on two nodes
  // sharing a line — so the whole button must read as one sentence, the
  // same promise rendered-text.spec.ts holds every other sentence on this
  // site to. This also covers S-10 (the section is named "Student details",
  // never "Customise students"). Each header is the whole rendered sentence,
  // not just its state fragment.
  await expect
    .soft(page.locator('#cg-students-toggle'))
    .toHaveText(copy.headers.students);
  await expect
    .soft(page.locator('#cg-grouping-toggle'))
    .toHaveText(copy.headers.grouping);
  await expect.soft(page.locator('#cg-io-toggle')).toHaveText(copy.headers.io);

  // Each section is reachable by heading, and starts collapsed.
  for (const [id, label] of copy.headings) {
    // getByRole's name match is a substring by default, so this also
    // matches the full "label · state" text — see the whole-sentence
    // checks above for the exact string pinned.
    await expect
      .soft(page.getByRole('heading', { name: label, level: 2 }))
      .toBeVisible();
    await expect.soft(page.locator(`#${id}-body`)).toBeHidden();
    await expect
      .soft(page.locator(`#${id}-toggle`))
      .toHaveAttribute('aria-expanded', 'false');
  }

  // A control that only ever opens, or only ever closes, is a trap — the
  // same proof the How to use fix round added above, here for each section
  // in turn. `cg-students` and `cg-io` still render nothing at all in the
  // body (see the markup's own comment on why), so for those two "content the
  // user would actually see returning" is the body genuinely re-entering the
  // page's rendered layout — checked with toBeVisible()/toBeHidden(), which
  // read computed layout (the body carries `padding-bottom` only while
  // unhidden, so an empty div still has real, non-zero size to detect), never
  // the aria-expanded STRING alone. `cg-grouping` is no longer one of the
  // empty two: Stage 2, Task 4 moved the two sex switches and the leftovers
  // choice into its body, so its reopen is proven by the same computed-layout
  // check but no longer rests on an empty div's padding alone — the dedicated
  // 'Grouping options' describe block below asserts its actual content
  // directly. Three taps, not two: these sections start CLOSED, so a genuine
  // SECOND opening needs open, close, open again to reach.
  for (const id of copy.reopen) {
    const toggle = page.locator(`#${id}-toggle`);
    const body = page.locator(`#${id}-body`);

    await expect.soft(body).toBeHidden();

    await tapOn(toggle); // open
    await expect.soft(body).toBeVisible();
    await expect.soft(toggle).toHaveAttribute('aria-expanded', 'true');

    await tapOn(toggle); // close
    await expect.soft(body).toBeHidden();
    await expect.soft(toggle).toBeVisible(); // the header itself is never hidden

    await tapOn(toggle); // reopen
    await expect.soft(body).toBeVisible();
    await expect.soft(toggle).toHaveAttribute('aria-expanded', 'true');
  }

  // F-1, task-3-fix-report.md, and Stage 2 Task 4. The header-follows-radio
  // wiring was built BEFORE the radio had a home -- `updateGroupingHeader`
  // in classroom-groups.ts delegates on `#cg-form`'s own `change` event and
  // queries `input[name="leftovers"]:checked` scoped to the whole form, so
  // moving the radios into #cg-grouping-body needed no code change there at
  // all, only this interaction: the radio starts inside a collapsed section,
  // so it must be opened before it can be checked, as any control a teacher
  // reaches by opening the section first (it is open here from the walk
  // above). The guarantee -- the header cannot go on reporting "none" once a
  // teacher has chosen "put them all in one group" -- is unchanged by where
  // the control lives.
  await setCheckedOn(page.locator('input[name="leftovers"][value="bunch"]'));
  await expect
    .soft(page.locator('#cg-grouping-toggle'))
    .toHaveText(copy.bunchHeader);
};

test.describe("the tool's collapsible sections", () => {
  test('the English page: every header reports its state, sections open, shut and reopen, and the header follows the leftovers choice', async ({
    page,
  }) => {
    await collapsibleSectionsJourney(page, {
      path: '/classroom-groups',
      states: {
        students: 'none added',
        grouping: 'none',
        io: 'nothing to save yet',
      },
      headers: {
        students: 'Student details · none added',
        grouping: 'Grouping options · none',
        io: 'Import / export · nothing to save yet',
      },
      headings: [
        ['cg-students', 'Student details'],
        ['cg-grouping', 'Grouping options'],
        ['cg-io', 'Import / export'],
      ],
      reopen: ['cg-students', 'cg-io', 'cg-grouping'],
      bunchHeader: 'Grouping options · leftovers in one group',
    });
  });

  // #390. The form's change handler refreshed the header only for
  // `name="leftovers"`, and the sex switches carry no name. So ticking
  // "Mix boys and girls evenly" left the header reading "none" until a
  // leftovers radio moved, in every locale. It is checked both ways here,
  // and also after a roster edit disables the switches: a new student has no
  // sex yet, `readSexMode` then ignores the ticked box, and the header must
  // drop it too.
  test('the grouping header follows the sex switches, live', async ({
    page,
  }) => {
    await buildRoster(page, [
      ['F', 'Ana'],
      ['M', 'Budi'],
    ]);
    await tapOn(page.locator('#cg-grouping-toggle'));
    const header = page.locator('#cg-grouping-toggle');
    await setCheckedOn(page.locator('#cg-sex-mix'));
    await expect(header).toHaveText('Grouping options · mixed by sex');
    await setCheckedOn(page.locator('#cg-sex-separate'));
    await expect(header).toHaveText('Grouping options · separated by sex');
    await tapOn(
      page.getByRole('button', { name: '+ Add student', exact: true }),
    );
    await expect(page.locator('.cg-student')).toHaveCount(3);
    await expect(page.locator('#cg-sex-separate')).toBeChecked();
    await expect(page.locator('#cg-sex-separate')).toBeDisabled();
    await expect(header).toHaveText('Grouping options · none');
  });

  // Student details no longer shares a row: it holds a seven-column table and
  // now spans the full width on a laptop. This test used to pair it with
  // Grouping options and reddened when that changed — correctly. Squeezed into
  // half a card the roster's `#` column collapsed to a 2px content box at
  // 768px and the student's number could not be drawn at all, so the span is
  // load-bearing, not cosmetic. The two-by-two claim now rests on the three
  // sections that really do sit two-by-two.
  //
  // Every locale (#423): a section's min-content is its copy, and one long
  // label pins a grid track (the #cg-io file input did exactly that).
  //
  // Each target is checked at the width it has (#1046, Shyden 2026-11-07):
  // an emulated target is set to a laptop width and then a phone width, and
  // a real phone is measured as it is. Which layout a width means is read
  // from the page's own stylesheet, so no breakpoint is restated here.
  const expectSectionsFitTheWidth = async (page: Page, width: number) => {
    const { tracks, media, wide } = await sectionsLayout(page);
    expect(
      media,
      'one @media rule gives .tool-sections its columns; the reader found',
    ).toHaveLength(1);
    const a = (await page.locator('#cg-grouping').boundingBox())!;
    const b = (await page.locator('#cg-io').boundingBox())!;
    if (wide) {
      expect(tracks, `${width}px is inside ${media[0]}`).toBe(2);
      expect(b.y).toBeCloseTo(a.y, 0); // same row
      // …and the roster section takes the whole row above them.
      const roster = (await page.locator('#cg-students').boundingBox())!;
      expect(roster.width).toBeGreaterThan(a.width * 1.8);
    } else {
      expect(tracks, `${width}px is outside ${media[0]}`).toBe(1);
      expect(b.y).toBeGreaterThan(a.y); // stacked
    }
  };

  for (const path of localePaths('/classroom-groups'))
    test(`the simple sections sit two-by-two on a wide screen and stacked on a narrow one -- ${path}`, async ({
      page,
    }) => {
      await page.goto(path);
      const laptop = await atViewport(page, { width: 1280, height: 900 });
      await expectSectionsFitTheWidth(page, laptop.width);
      const phone = await atViewport(page, { width: 320, height: 800 });
      await expectSectionsFitTheWidth(page, phone.width);
    });
});

test.describe("the tool's collapsible sections — Indonesian", () => {
  test('the Indonesian page: every header reports its state, the grouping section reopens, and the header follows the leftovers choice', async ({
    page,
  }) => {
    await collapsibleSectionsJourney(page, {
      path: '/id/classroom-groups',
      states: {
        students: 'tidak ada yang ditambahkan',
        grouping: 'tidak ada',
        io: 'belum ada yang perlu disimpan',
      },
      headers: {
        students: 'Detail siswa · tidak ada yang ditambahkan',
        grouping: 'Opsi pengelompokan · tidak ada',
        io: 'Impor / ekspor · belum ada yang perlu disimpan',
      },
      headings: [
        ['cg-students', 'Detail siswa'],
        ['cg-grouping', 'Opsi pengelompokan'],
        ['cg-io', 'Impor / ekspor'],
      ],
      reopen: ['cg-grouping'],
      bunchHeader: 'Opsi pengelompokan · sisa dalam satu kelompok',
    });
  });
});

// Stage 2, Task 4: the two sex switches, and the leftovers control rehomed
// into #cg-grouping-body (task-4-brief.md's Step 3 -- markup, `name`
// attribute and all four locale keys unchanged, only its parent). Design
// spec section 6.
//
// SUPERSEDED by Stage 3, Task 9. This block's own comment used to say the
// page was permanently stuck in ONE of design spec section 6's three
// branches -- "no list at all" -- because no control on the page could give
// a student a sex. That is no longer true: Task 2 built the roster table,
// Task 4 built absence, and Task 9 wires `sexWhy`/`sexWhyReturning`
// (src/lib/sexOptions.ts) to the live roster. All THREE branches are now
// reachable from the page, and the tests below drive each of them through
// real controls rather than citing the unit tests that prove them against
// synthetic rosters.
test.describe('Grouping options', () => {
  test('Grouping options holds both sex switches and the leftovers choice, both off, disabled with a reason, and pointing at the same reason', async ({
    page,
  }) => {
    await page.goto('/classroom-groups');
    // F-1 (review): the headline claim of this task is that these controls
    // live INSIDE Grouping options, not merely that they turn up somewhere
    // on the page after a click. Proven in both directions: hidden BEFORE
    // the section opens (checked against the whole page, not the section
    // body -- a control moved anywhere else on the page would still
    // satisfy a body-scoped hidden check, since a locator matching zero
    // elements passes toBeHidden()), then visible AND scoped to
    // `#cg-grouping-body` once it does. Proven directly, not by citing a
    // session note: temporarily moving this markup back to the top-level
    // "How to split them" fieldset reddens both halves above, with a real
    // hidden/visible mismatch and no crash -- confirmed, then reverted.
    await expect
      .soft(page.getByLabel('Mix boys and girls evenly'))
      .toBeHidden();
    await expect
      .soft(page.getByLabel('Keep boys and girls separate'))
      .toBeHidden();
    await expect.soft(page.getByText('If students are left over')).toBeHidden();

    const body = page.locator('#cg-grouping-body');
    await tapOn(page.locator('#cg-grouping-toggle'));
    await expect
      .soft(body.getByLabel('Mix boys and girls evenly'))
      .toBeVisible();
    await expect
      .soft(body.getByLabel('Keep boys and girls separate'))
      .toBeVisible();
    await expect
      .soft(body.getByText('If students are left over'))
      .toBeVisible();
    await expect.soft(body.getByLabel('Share them out evenly')).toBeChecked();

    // Both switches are off by default.
    await expect
      .soft(body.getByLabel('Mix boys and girls evenly'))
      .not.toBeChecked();
    await expect
      .soft(body.getByLabel('Keep boys and girls separate'))
      .not.toBeChecked();

    // With no list at all, both are disabled and say why.
    await expect
      .soft(body.getByLabel('Mix boys and girls evenly'))
      .toBeDisabled();
    await expect
      .soft(body.getByLabel('Keep boys and girls separate'))
      .toBeDisabled();
    await expect
      .soft(
        body.getByText(
          'Add your students in Student details and set M or F for each to use these.',
        ),
      )
      .toBeVisible();

    // Design spec section 6: "Both are DISABLED unless every student being
    // grouped has M or F" -- ONE condition governing both switches, not two
    // independent ones. Both pointing at the same `aria-describedby` is what
    // would catch a copy-paste that gave each switch its own, silently
    // diverging reason element.
    await expect
      .soft(body.getByLabel('Mix boys and girls evenly'))
      .toHaveAttribute('aria-describedby', 'cg-sex-why');
    await expect
      .soft(body.getByLabel('Keep boys and girls separate'))
      .toHaveAttribute('aria-describedby', 'cg-sex-why');

    // A reload is a fresh visit: the section is shut again, so the controls
    // are hidden again.
    await page.reload();
    await expect
      .soft(page.getByLabel('Mix boys and girls evenly'))
      .toBeHidden();
    await expect
      .soft(page.getByLabel('Keep boys and girls separate'))
      .toBeHidden();
  });

  // The existing 44px sweep ('every control meets the 44px touch target',
  // above) deliberately measures only `select`, `button` and
  // `input[type="number"]` -- it has never covered #cg-sound or these two
  // switches. Scoped here rather than widening that query, so this task's
  // addition cannot change what that test already proves. The LABEL is
  // measured, not the raw checkbox: `.switch`'s 44px min-height is on the
  // label, because the whole row is the tap target, the same as every
  // radio label on this page. The id locator is ALSO scoped to
  // `#cg-grouping-body` (F-1, review): an id selector is unique regardless
  // of parent, so this is the one test in this describe block where
  // scoping is not already implied by getByLabel/getByText -- without it,
  // moving the switches anywhere else on the page would still measure the
  // same two elements and this test would never notice they had left
  // Grouping options.
  //
  // Every locale (#423): each switch's label is the page's own copy.
  for (const path of localePaths('/classroom-groups'))
    test(`the two sex switches meet the 44px touch target once open -- ${path}`, async ({
      page,
    }) => {
      await atViewport(page, { width: 375, height: 900 });
      await page.goto(path);
      await expect(page.locator('#cg-sex-mix')).toBeHidden();

      const body = page.locator('#cg-grouping-body');
      await tapOn(page.locator('#cg-grouping-toggle'));
      const labels = await body
        .locator('#cg-sex-mix, #cg-sex-separate')
        .evaluateAll((els) =>
          els.map((el) => {
            const { width, height } = el
              .closest('label')!
              .getBoundingClientRect();
            return { id: el.id, width, height };
          }),
        );
      expect(labels).toHaveLength(2);
      for (const { id, width, height } of labels)
        rectAtLeast44({ width, height }, `${id} (label)`);
    });

  // Stage 2's `test.fixme('a separate-mode spillover warning renders,
  // naming who')` stood here. DELETED, whole, per this task's own plan step
  // -- not "un-fixme'd": its body was comments only, so stripping the
  // `.fixme` would have produced a real `test()` with zero assertions,
  // which always passes under a name claiming coverage it does not have.
  // Its real replacement is `names who landed in a group of the other sex`
  // below, which drives the message through the page's own controls.
  //
  // The stage-2 comment justifying it also described
  // tests/unit/classroom-groups-script.test.ts as the code-level forcing
  // function that would redden the day `sexMode` stopped being a hard-coded
  // `'off'`. That day is today. It did redden, on purpose, and is deleted
  // too -- its job is done, and a test pinning a literal the product no
  // longer contains is a test pinning the bug as the contract.

  // G-03. Both switches share ONE condition, so both are asserted every
  // time: a fix that enabled only the one the test happened to name would
  // otherwise pass.
  test('enabled once every student being grouped has a sex', async ({
    page,
  }) => {
    await buildRoster(page, [
      ['M', 'Ana'],
      ['F', 'Budi'],
    ]);
    await tapOn(page.locator('#cg-grouping-toggle'));
    await expect(page.getByLabel('Mix boys and girls evenly')).toBeEnabled();
    await expect(page.getByLabel('Keep boys and girls separate')).toBeEnabled();
    // The reason paragraph is not merely blank -- it is gone. A visible
    // empty `.why` box under two enabled switches is its own small defect.
    await expect(page.locator('#cg-sex-why')).toBeHidden();
  });

  // G-04 through the page, then G-07, the third message, and the whole reason
  // `sexWhyReturning` exists. The unit tests already prove `sexWhy` excludes
  // absent students; this proves the page hands it a roster where `absent`
  // is actually set, which is the half a pure-function test cannot reach.
  // The last sentence is asserted as a WHOLE rendered sentence (CLAUDE.md),
  // not a substring: the count message would also contain the word "sex".
  test('an absent student with no sex does not disable them, and unticking that absence disables them again, naming the student', async ({
    page,
  }) => {
    await buildRoster(page, [
      ['M', 'Ana'],
      ['F', 'Budi'],
      [null, 'Dewi'],
    ]);
    const dewi = page.locator('.cg-student').nth(2);
    await setCheckedOn(dewi.getByLabel('Absent'));
    await tapOn(page.locator('#cg-grouping-toggle'));
    await expect
      .soft(page.getByLabel('Mix boys and girls evenly'))
      .toBeEnabled();
    await expect
      .soft(page.getByLabel('Keep boys and girls separate'))
      .toBeEnabled();

    await setCheckedOn(dewi.getByLabel('Absent'), false);
    await expect
      .soft(page.getByLabel('Mix boys and girls evenly'))
      .toBeDisabled();
    await expect
      .soft(page.getByLabel('Keep boys and girls separate'))
      .toBeDisabled();
    await expect
      .soft(
        page.getByText(
          'Dewi is back and has no sex set. These options need one for every ' +
            'student being grouped.',
        ),
      )
      .toBeVisible();

    // Ticking the absence again lifts the lock again: the rule follows the
    // roster in both directions, not only on the first change.
    await setCheckedOn(dewi.getByLabel('Absent'));
    await expect
      .soft(page.getByLabel('Mix boys and girls evenly'))
      .toBeEnabled();
  });

  // The other half of the same rule: a roster that was ALREADY shut gets
  // the count, not a name. Without this, an implementation that always
  // named somebody would pass the test above.
  test('a roster that was already shut gets the count, not a name', async ({
    page,
  }) => {
    await buildRoster(page, [
      ['M', 'Ana'],
      [null, 'Cahya'],
      [null, 'Dewi'],
    ]);
    await setCheckedOn(page.locator('.cg-student').nth(2).getByLabel('Absent'));
    await tapOn(page.locator('#cg-grouping-toggle'));
    // Cahya alone still holds them shut, so this was never open.
    await expect(page.getByLabel('Mix boys and girls evenly')).toBeDisabled();

    await setCheckedOn(
      page.locator('.cg-student').nth(2).getByLabel('Absent'),
      false,
    );
    await expect(
      page.getByText(
        '2 of the 3 students being grouped have no sex set. Open Student ' +
          'details and set M or F for them to use these.',
      ),
    ).toBeVisible();
    await expect(page.getByText(/Dewi is back/)).toHaveCount(0);
  });

  // G-11, and stage 2's fixme discharged. Six boys and two girls, split
  // four to a group: the two girls cannot make a group of their own, so
  // they join one of boys and the engine says so.
  //
  // The plan's own snippet asserted 'Gita and Hadi are in a group of boys.'
  // -- a sentence that exists nowhere in this codebase. The real copy is
  // en.ts's `warnings.SEX_SPILLOVER`, asserted whole below. Its own
  // resolver turns student NUMBERS into names, so this also proves the
  // warning channel resolves them the same way the error channel does.
  test('separate mode names who landed in a group of the other sex, and the warning clears on a shuffle that has nothing to warn about', async ({
    page,
  }) => {
    await buildRoster(page, [
      ['M'],
      ['M'],
      ['M'],
      ['M'],
      ['M'],
      ['M'],
      ['F', 'Gita'],
      ['F', 'Sari'],
    ]);
    await tapOn(page.locator('#cg-grouping-toggle'));
    await setCheckedOn(page.getByLabel('Keep boys and girls separate'));
    await typeInto(page.getByLabel('Students in each group'), '4');
    await giveEveryoneASex(page);
    await tapOn(page.getByRole('button', { name: 'Make Groups' }));
    await expect
      .soft(
        page.getByText(
          'Gita and Sari have joined a group of boys because there were not ' +
            'enough girls to make a group of their own. That is simply how ' +
            'the numbers divided, not a mistake to fix.',
        ),
      )
      .toBeVisible();
    await expect
      .soft(page.getByText(/have joined a group of boys/))
      .toBeVisible();

    // The warning must not outlive the shuffle that produced it. Turning
    // separate mode back off and reshuffling leaves nothing to warn about,
    // and a stale warning under fresh groups is a lie about them.
    await setCheckedOn(page.getByLabel('Keep boys and girls separate'), false);
    await tapOn(page.getByRole('button', { name: 'Shuffle again' }).first());
    await expect
      .soft(page.getByText(/have joined a group of boys/))
      .toHaveCount(0);
  });
});

// The brief's own three tests above were only ever written in English;
// "assert whole rendered sentences, in both locales" (CLAUDE.md) applies
// regardless of what the brief's snippet happened to show.
test.describe('Grouping options — Indonesian', () => {
  test('Grouping options holds both sex switches and the leftovers choice, both off, disabled with a reason', async ({
    page,
  }) => {
    await page.goto('/id/classroom-groups');
    // Same placement proof as the English describe block above (F-1,
    // review): hidden before the section opens, then visible and scoped
    // to `#cg-grouping-body` once it does.
    await expect
      .soft(
        page.getByLabel('Campur siswa laki-laki dan perempuan secara merata'),
      )
      .toBeHidden();
    await expect
      .soft(page.getByLabel('Pisahkan siswa laki-laki dan perempuan'))
      .toBeHidden();
    await expect.soft(page.getByText('Jika ada siswa tersisa')).toBeHidden();

    const body = page.locator('#cg-grouping-body');
    await tapOn(page.locator('#cg-grouping-toggle'));
    await expect
      .soft(
        body.getByLabel('Campur siswa laki-laki dan perempuan secara merata'),
      )
      .toBeVisible();
    await expect
      .soft(body.getByLabel('Pisahkan siswa laki-laki dan perempuan'))
      .toBeVisible();
    await expect.soft(body.getByText('Jika ada siswa tersisa')).toBeVisible();
    await expect.soft(body.getByLabel('Bagikan merata')).toBeChecked();

    // Both switches are off by default.
    await expect
      .soft(
        body.getByLabel('Campur siswa laki-laki dan perempuan secara merata'),
      )
      .not.toBeChecked();
    await expect
      .soft(body.getByLabel('Pisahkan siswa laki-laki dan perempuan'))
      .not.toBeChecked();

    // With no list at all, both are disabled and say why.
    await expect
      .soft(
        body.getByLabel('Campur siswa laki-laki dan perempuan secara merata'),
      )
      .toBeDisabled();
    await expect
      .soft(body.getByLabel('Pisahkan siswa laki-laki dan perempuan'))
      .toBeDisabled();
    await expect
      .soft(
        body.getByText(
          'Tambahkan siswa Anda di bagian Detail siswa dan atur L atau P untuk masing-masing agar bisa memakai opsi ini.',
        ),
      )
      .toBeVisible();

    // A reload is a fresh visit: the section is shut again, so the controls
    // are hidden again.
    await page.reload();
    await expect
      .soft(
        page.getByLabel('Campur siswa laki-laki dan perempuan secara merata'),
      )
      .toBeHidden();
    await expect
      .soft(page.getByLabel('Pisahkan siswa laki-laki dan perempuan'))
      .toBeHidden();
  });
});

// Stage 3, Task 9. The three sex-switch branches, driven through the page in
// Indonesian too -- CLAUDE.md's "assert whole rendered sentences, in both
// locales", and the more so here because the Indonesian copy for
// `sexWhyReturning` is a translation this stage wrote rather than approved
// spec copy. The roster's own controls carry Indonesian accessible names
// (`rosterColSex`/`rosterColAbsent` in id.ts), so this cannot reuse the
// English helpers' label regexes for the parts that differ.
test.describe('Grouping options, live from the roster — Indonesian', () => {
  const openRosterId = async (page: import('@playwright/test').Page) => {
    await page.goto('/id/classroom-groups');
    await tapOn(page.locator('#cg-students-toggle'));
    await tapOn(page.getByRole('button', { name: 'Tambah siswa' }));
  };

  test('enabled once every student being grouped has a sex', async ({
    page,
  }) => {
    await openRosterId(page);
    await addSeveral(page, 1);
    await chooseOption(
      page.locator('.cg-student').nth(0).getByLabel('Jenis kelamin'),
      'M',
    );
    await chooseOption(
      page.locator('.cg-student').nth(1).getByLabel('Jenis kelamin'),
      'F',
    );
    await tapOn(page.locator('#cg-grouping-toggle'));
    // Both switches, as its English twin reads (#426): this read Mix alone,
    // so a Separate switch that never enabled passed in Indonesian.
    await expect(
      page.getByLabel('Campur siswa laki-laki dan perempuan secara merata'),
    ).toBeEnabled();
    await expect(
      page.getByLabel('Pisahkan siswa laki-laki dan perempuan'),
    ).toBeEnabled();
    await expect(page.locator('#cg-sex-why')).toBeHidden();
  });

  test('unticking an absence disables them again, naming the student', async ({
    page,
  }) => {
    await openRosterId(page);
    await addSeveral(page, 2);
    await chooseOption(
      page.locator('.cg-student').nth(0).getByLabel('Jenis kelamin'),
      'M',
    );
    await chooseOption(
      page.locator('.cg-student').nth(1).getByLabel('Jenis kelamin'),
      'F',
    );
    const dewi = page.locator('.cg-student').nth(2);
    await typeInto(dewi.getByLabel('Nama'), 'Dewi');
    await setCheckedOn(dewi.getByLabel('Tidak hadir'));
    await tapOn(page.locator('#cg-grouping-toggle'));
    await expect(
      page.getByLabel('Campur siswa laki-laki dan perempuan secara merata'),
    ).toBeEnabled();

    await setCheckedOn(dewi.getByLabel('Tidak hadir'), false);
    await expect(
      page.getByLabel('Campur siswa laki-laki dan perempuan secara merata'),
    ).toBeDisabled();
    await expect(
      page.getByText(
        'Dewi sudah hadir kembali dan belum memiliki jenis kelamin. Opsi ini ' +
          'memerlukannya untuk setiap siswa yang dikelompokkan.',
      ),
    ).toBeVisible();
  });
});

// ── The four the operator found by looking at the page ─────────────────────
//
// Every one of these was live in production and green in this suite. They are
// grouped together because they share one cause: the checks here asserted DOM
// and text, and all four are things you can only see.
test.describe('classroom groups — what a teacher actually sees', () => {
  for (const path of sampledPaths('/classroom-groups'))
    test(`${path}: the class size starts at 30`, async ({ page }) => {
      await page.goto(path);
      await expect(page.locator('#cg-count')).toHaveValue('30');
    });

  // The Remove button is 76px of min-content in a `table-layout: fixed` cell.
  // At 10% it did not fit and spilled 34.5px past the card's RIGHT BORDER at
  // 1512px, 49.4px at 768px — and never once produced page-level horizontal
  // scroll, which is the only thing the older checks measured.
  // One test PER WIDTH, which is the convention `homepage.spec.ts` already
  // sets. This was a SINGLE test walking seven widths across every sampled
  // locale -- 21 viewport changes, each forcing a full relayout and repaint --
  // all sharing one 30s budget.
  //
  // It was already 16.5s on mobile-safari before Aurora and 11.6s on desktop
  // webkit, so over half the budget was spent before this ticket touched
  // anything. Aurora's atmosphere adds ~5.1s of gradient raster on WebKit
  // (measured in the pinned container: 30.7s with the gradients and failing,
  // 25.6s without them and passing), and that was enough to go over.
  //
  // A shared budget also makes the failure lie about its own cause: the report
  // names whichever click happened to hold the clock when time ran out, so a
  // PAINT cost surfaced as "element not stable" against a button that was
  // perfectly fine. Per-width tests each get their own budget AND say which
  // width actually broke.
  //
  // And per LOCALE since #390 F113. This is a fit test, so it runs on every
  // locale (tests/e2e/locale-sampling.ts), and five locales inside one
  // test would rebuild exactly the shared budget this split took apart.
  const numberWidths = [390, 768, 1024, 1280, 1512];
  for (const width of [320, 390, 600, 768, 1024, 1280, 1512]) {
    for (const path of localePaths('/classroom-groups')) {
      test(`nothing in the roster escapes its card, and a student number has room to be drawn, at ${width}px -- ${path}`, async ({
        page,
      }) => {
        const took = await atViewport(page, { width, height: 950 });
        await openRoster(page, path);

        // The roster's `#` cell is ~40px wide. It used to inherit `select`'s
        // chevron rule — `padding: 0.5rem 2.2rem 0.5rem 0.6rem`, 44.8px of
        // horizontal padding — which with `box-sizing: border-box` left a
        // NEGATIVE content box. The value was in the DOM the whole time, so
        // `toHaveValue` passed while the number could not be seen at all. Only
        // the content box proves it. The cell holds digits, the same width in
        // every language, so it is measured on the widths the number was
        // always measured at, on every page that walks them.
        await tapOn(page.locator('.cg-add-student'));
        if (numberWidths.includes(width)) {
          await expect
            .soft(page.locator('.cg-roster-number').first())
            .toHaveValue('1');
          const box = await page
            .locator('.cg-roster-number')
            .first()
            .evaluate((el) => {
              const cs = getComputedStyle(el);
              return (
                el.getBoundingClientRect().width -
                parseFloat(cs.paddingLeft) -
                parseFloat(cs.paddingRight) -
                parseFloat(cs.borderLeftWidth) -
                parseFloat(cs.borderRightWidth)
              );
            });
          // Two digits at this font need ~16px; a class of 30 has two.
          expect
            .soft(
              box,
              `@${took.width}px the # input has ${box.toFixed(1)}px of content box`,
            )
            .toBeGreaterThan(16);
        }

        // openRoster already adds one and the tap above one more, so two more
        // makes four — enough rows that a wrapping or spilling control shows
        // up.
        for (let i = 0; i < 2; i++)
          await tapOn(page.locator('.cg-add-student'));
        await expect.soft(page.locator('.cg-student')).toHaveCount(4);
        const worst = await spillPastCard(page, 'cg-students');
        expect
          .soft(
            worst.over,
            `${path} @${took.width}px: ${worst.who} is ${worst.over.toFixed(1)}px past the card`,
          )
          .toBeLessThanOrEqual(0.5);
      });
    }
  }

  test('a sex is required and cannot be taken back once given, and number fields have no spinner, including rows built at runtime', async ({
    page,
  }) => {
    await openRoster(page);
    // Blocked while anyone is missing one…
    await expect
      .soft(page.getByRole('button', { name: 'Make groups' }))
      .toBeDisabled();
    const sex = page.locator('.cg-student').first().getByLabel('Sex');
    // …and the placeholder is choosable only while it is still the answer.
    await expect.soft(sex.locator('option[value=""]')).not.toBeDisabled();
    await chooseOption(sex, 'M');
    await expect.soft(sex.locator('option[value=""]')).toBeDisabled();
    await expect
      .soft(page.getByRole('button', { name: 'Make groups' }))
      .toBeEnabled();

    // Two separate mechanisms, both required. The spinner reset MUST live in the
    // global style block: roster rows are built at runtime and carry no Astro
    // scoping attribute, so a scoped rule styles the two static fields and
    // silently misses every row — which is exactly what the first fix did.
    await tapOn(page.locator('.cg-add-student'));
    const appearances = await page.evaluate(() =>
      [...document.querySelectorAll('#cg-form input[type=number]')].map(
        (el) => ({
          id: (el as HTMLElement).id || el.className,
          appearance: getComputedStyle(el).appearance,
        }),
      ),
    );
    expect.soft(appearances.length).toBeGreaterThan(2);
    for (const a of appearances)
      expect
        .soft(a.appearance, `${a.id} still renders a spinner`)
        .toBe('textfield');
    // …and the chevron drawn for `select` must not be on a number field.
    const bg = await page
      .locator('#cg-count')
      .evaluate((el) => getComputedStyle(el).backgroundImage);
    expect
      .soft(bg, '#cg-count wears a dropdown chevron but is not a dropdown')
      .toBe('none');
  });

  // A focused number input treats the wheel as increment/decrement, so
  // scrolling the page silently rewrites the class size. CSS cannot reach it.
  test('scrolling the page does not change a focused number field', async ({
    page,
    isMobile,
  }) => {
    // A touch device has no wheel to guard against, and WebKit's mobile
    // emulation rejects mouse.wheel outright. The behaviour under test only
    // exists where a wheel does.
    test.skip(!!isMobile || onRealDevice(), 'no mouse wheel on a touch device');
    await page.goto('/classroom-groups');
    const count = page.locator('#cg-count');
    await tapOn(count);
    // The starting value is READ, not named. This test is about a wheel
    // leaving it alone; what the page starts at has its own home in "the
    // class size starts at 30", and a second copy of that number here is one
    // more place for it to drift out of step with the markup (#193). The
    // emptiness check keeps the invariance from holding trivially over a
    // value that was never read.
    const before = await count.inputValue();
    expect(before).not.toBe('');
    await scrollToOn(count);
    const box = await count.boundingBox();
    expect(
      box,
      'the number field has a box to hold the pointer over',
    ).not.toBeNull();
    await page.mouse.move(box!.x + box!.width / 2, box!.y + box!.height / 2);
    await page.mouse.wheel(0, 240);
    await expect(count).toHaveValue(before);
    await page.mouse.wheel(0, -240);
    await expect(count).toHaveValue(before);
  });
});

// ── The operator's five, 2026-08-13 ────────────────────────────────────────
test.describe('the five the operator asked for', () => {
  test('the class size ceiling is 100', async ({ page }) => {
    await page.goto('/classroom-groups');
    await expect(page.locator('#cg-count')).toHaveAttribute('max', '100');
    await typeInto(page.locator('#cg-count'), '101');
    await giveEveryoneASex(page);
    await tapOn(page.getByRole('button', { name: 'Make groups' }));
    await expect(page.locator('#cg-error')).toContainText('The most is 100');
  });

  // One test per sampled page (#390 F152): a loop through openRoster
  // navigated on each pass inside one budget, out of the guard's sight while
  // it matched names alone. The header is the page's own word, where
  // /Absent|Tidak hadir/ took either word on either page.
  for (const path of sampledPaths('/classroom-groups'))
    test(`${path}: Absent is the first column and its tick is left-aligned`, async ({
      page,
    }) => {
      await openRoster(page, path);
      const heads = page.locator('#cg-roster thead th');
      await expect(heads.first()).toHaveText(
        getStrings(localeFromPath(path)).rosterColAbsent,
      );
      // A RATIO of the cell, not an absolute pixel offset. A checkbox is a
      // native widget and Firefox, WebKit and Chromium each give it a
      // different intrinsic size and margin, so a `< 4px` threshold passed on
      // Chromium and failed on the others for no product reason. What
      // "left-aligned" means here is "nowhere near the middle" — which is
      // exactly what a centred tick was, and what the header above it is not.
      const ratio = await page.evaluate(() => {
        const cell = document.querySelector(
          '#cg-roster .cg-student > td:nth-child(1)',
        )!;
        const box = cell.querySelector('input[type=checkbox]')!;
        const cs = getComputedStyle(cell);
        const cellBox = cell.getBoundingClientRect();
        const left = cellBox.left + parseFloat(cs.paddingLeft);
        const width =
          cellBox.width -
          parseFloat(cs.paddingLeft) -
          parseFloat(cs.paddingRight);
        const b = box.getBoundingClientRect();
        return (b.left + b.width / 2 - left) / width;
      });
      expect(
        ratio,
        `${path}: the tick's centre sits ${(ratio * 100).toFixed(0)}% across its cell`,
      ).toBeLessThan(0.35);
    });

  test('the deal never disables its own button, and a change ends it at once', async ({
    page,
  }) => {
    await rosterOf(page, 12);
    // By id, not by name: the button relabels itself to "Shuffle again" the
    // moment the first deal starts, so a name-based locator stops resolving
    // exactly when this test needs to read it.
    const go = page.locator('#cg-go');
    await tapOn(go);
    // The button stays live for the whole deal — pressing it again is the
    // documented way to reshuffle, so disabling it contradicted its label.
    await expect(go).toBeEnabled();
    // Editing anything ends the animation immediately rather than leaving a
    // half-dealt sheet: every card is landed.
    await typeInto(page.locator('#cg-class'), 'Year 9');
    await expect(page.locator('#cg-results .student:not(.dealt)')).toHaveCount(
      0,
    );
  });

  // One test per language (#418). This listed English and Indonesian, and
  // found the button by an en-or-id pattern that could not open the field in
  // zh, vi or th. The names come from each page's own catalogue: the copy is
  // the i18n suites' to hold; this holds that a visible label is there.
  for (const path of localePaths('/classroom-groups'))
    test(`${path}: the Add several field says what the number is for`, async ({
      page,
    }) => {
      const t = getStrings(localeFromPath(path));
      await page.goto(path);
      await tapOn(page.locator('#cg-students-toggle'));
      await tapOn(
        page.getByRole('button', { name: t.rosterAddSeveral, exact: true }),
      );
      // A VISIBLE label, not only an aria-label: the field used to appear as
      // a bare number box with nothing on screen saying what it counted.
      await expect(page.locator('label.cg-add-several-label')).toBeVisible();
      await expect(page.locator('label.cg-add-several-label')).toHaveText(
        t.rosterHowMany,
      );
      await expect(
        page.getByLabel(t.rosterHowMany, { exact: true }),
      ).toBeVisible();
    });
});

/**
 * #249 put a word where an em dash used to be. `Together` is materially wider
 * than `—`, and the automatic minimum of a grid item reads its MIN-CONTENT
 * size, which `max-width` does not change -- the exact mechanism that once
 * pinned this page's track to 378px and produced 74px of horizontal scroll at
 * 320px from a single native file input nobody had added to a list.
 *
 * The containment guard above runs four rows, which is enough to catch a
 * control that spills its card. It is not enough to catch a full register: a
 * long roster adds a vertical scrollbar, and the width that steals is only
 * ever felt at the narrow end. So this runs the tightest viewport against a
 * roster of thirty, the size the tool is actually used at.
 */
test.describe('a full roster at the narrow end', () => {
  for (const path of localePaths('/classroom-groups')) {
    test(`${path}: thirty rows produce no horizontal scroll at 320px`, async ({
      page,
    }) => {
      await atViewport(page, { width: 320, height: 900 });
      await openRoster(page, path);
      await addSeveral(page, 29);
      await expect(page.locator('.cg-student')).toHaveCount(30);

      await expectNoHorizontalScroll(page, 'document scrolls sideways');

      // Page-level scrollWidth is not containment (#277): the card is
      // the subject, which is how the Remove button once shipped
      // hanging outside its border at every laptop width.
      const worst = await spillPastCard(page, 'cg-students');
      expect(worst.over, `${worst.who} escapes the card`).toBeLessThanOrEqual(
        0.5,
      );
    });
  }
});

/**
 * Make Groups is the page's primary action, docked to the bottom of the screen
 * at every width. On a phone, the on-screen keyboard took that bottom away:
 * Android Chrome's keyboard covers the page without shrinking it, so the
 * docked bar sat hidden behind the keyboard while a teacher typed the class
 * size (bar at 703 px, 471 px left visible, measured on the test phone, issue
 * 807). The viewport tag's `interactive-widget=resizes-content` shrinks the
 * page above the keyboard instead (operator decision 2026-10-18).
 *
 * Only a device with an on-screen keyboard can answer this: the desktop
 * engines and the emulated phones open none, so the test asks the device
 * whether one opened and skips, saying so, when it did not.
 */
test.describe('the on-screen keyboard', () => {
  test('leaves Make Groups on screen while a teacher types', async ({
    page,
  }) => {
    await page.goto('/classroom-groups');
    const visibleBefore = await page.evaluate(
      () => visualViewport?.height ?? innerHeight,
    );
    // Tapped, as a teacher does: Chrome raises the keyboard only for a field
    // focused by a gesture, never for one a script focuses (measured on the
    // phone: `fill` alone opened none).
    await tapOn(page.locator('#cg-size'));
    await page.keyboard.type('3');
    // A keyboard rises a few hundred milliseconds after the field takes focus
    // (about 300 ms on the test phone); three seconds is the stated ceiling.
    const keyboardOpened = await page
      .waitForFunction(
        (before) => (visualViewport?.height ?? innerHeight) < before,
        visibleBefore,
        { timeout: 3_000 },
      )
      .then(
        () => true,
        () => false,
      );
    test.skip(
      !keyboardOpened,
      'no on-screen keyboard opened on this device, so nothing can cover the bar',
    );

    await expect(page.locator('#cg-size')).toBeFocused();
    await expect
      .poll(() =>
        page.evaluate(() => {
          const bar = document.getElementById('cg-go')!.getBoundingClientRect();
          const view = visualViewport!;
          return (
            bar.top >= view.offsetTop &&
            bar.bottom <= view.offsetTop + view.height
          );
        }),
      )
      .toBe(true);
  });

  /**
   * Issue 853. Safari's keyboard shrinks only the visual viewport, leaving
   * the layout viewport, and so the sticky row's dock, at full height
   * (measured on the iPhone: 746px layout, 423px visible). The real case
   * runs on the iPhone through the test above once the iPhone runs these
   * spec files (issue 840). Until then these STAND-INS give every engine a
   * visual viewport that shrinks the same way: with a field being typed in
   * (a keyboard), the row is lifted to rest on the new bottom edge; with
   * nothing focused (a pinch zoom, which Shyden ruled 2026-10-23 never
   * moves the bar), it stays docked where it was.
   */
  const shrinkingViewport = async (page: Page) => {
    await page.addInitScript(() => {
      const view = new EventTarget();
      let hidden = 0;
      Object.defineProperties(view, {
        offsetTop: { get: () => 0 },
        height: { get: () => innerHeight - hidden },
      });
      // `visualViewport` is a [Replaceable] attribute, so the page script
      // reads this one from its first line.
      Object.defineProperty(window, 'visualViewport', {
        value: view,
        configurable: true,
      });
      Object.assign(window, {
        viewShrinks: (height: number) => {
          hidden = height;
          view.dispatchEvent(new Event('resize'));
        },
      });
    });
    await page.goto('/classroom-groups');
    const rowBottom = () =>
      page.evaluate(
        () =>
          document.querySelector('.actions')!.getBoundingClientRect().bottom,
      );
    const layoutHeight = await page.evaluate(() => innerHeight);
    await expect.poll(rowBottom).toBeCloseTo(layoutHeight, 0);
    const shrink = (height: number) =>
      page.evaluate(
        (by) =>
          (
            window as unknown as { viewShrinks(height: number): void }
          ).viewShrinks(by),
        height,
      );
    return { rowBottom, layoutHeight, shrink };
  };

  test('lifts Make Groups above a keyboard that shrinks only the visual viewport (stand-in)', async ({
    page,
  }) => {
    const { rowBottom, layoutHeight, shrink } = await shrinkingViewport(page);
    await tapOn(page.locator('#cg-size'));
    await shrink(200);
    await expect.poll(rowBottom).toBeCloseTo(layoutHeight - 200, 0);
  });

  test('leaves Make Groups docked when a pinch zoom shrinks the visual viewport (stand-in)', async ({
    page,
  }) => {
    const { rowBottom, layoutHeight, shrink } = await shrinkingViewport(page);
    await shrink(200);
    // The resize has been handled once the page has painted after it.
    await page.evaluate(
      () =>
        new Promise((resolve) => requestAnimationFrame(() => resolve(null))),
    );
    await expect.poll(rowBottom).toBeCloseTo(layoutHeight, 0);
    // Liveness: the view really is 200px short, as a field taking typing shows.
    await tapOn(page.locator('#cg-size'));
    await expect.poll(rowBottom).toBeCloseTo(layoutHeight - 200, 0);
  });
});

test.describe('per-test isolation actually isolates state across back-to-back tests', () => {
  // Moved from tests/device/real-device.spec.ts (#1049). Order matters and a failed setup half
  // makes the isolation half meaningless, so the pair runs serially and proves the write landed.
  test.describe.configure({ mode: 'serial' });

  const PROBE_KEY = 'shyden-isolation-probe';
  const PROBE_VALUE = 'leaked-if-you-can-read-this-in-the-next-test';

  test('writes a distinctive localStorage value and a form field (setup half of the pair)', async ({
    page,
  }) => {
    await page.goto('/classroom-groups');
    await page.evaluate(({ key, value }) => localStorage.setItem(key, value), {
      key: PROBE_KEY,
      value: PROBE_VALUE,
    });
    expect(
      await page.evaluate((key) => localStorage.getItem(key), PROBE_KEY),
      'the probe value is readable in the test that wrote it, before the next test asserts its absence',
    ).toBe(PROBE_VALUE);
    await typeInto(page.locator('#cg-class'), 'ISOLATION-PROBE-CLASS-NAME');
    await expect(page.locator('#cg-class')).toHaveValue(
      'ISOLATION-PROBE-CLASS-NAME',
    );
  });

  test('starts with no trace of the previous test (isolation half of the pair)', async ({
    page,
  }) => {
    await page.goto('/classroom-groups');
    expect(
      await page.evaluate((key) => localStorage.getItem(key), PROBE_KEY),
      "localStorage is empty at the start of this test: the previous test's value did not leak",
    ).toBeNull();
    // #cg-class is never stored, so this is not storage evidence; it is kept as the original had it.
    await expect(page.locator('#cg-class')).toHaveValue('');
  });
});

test.describe('the containment helper', () => {
  // #1103 (#390 F53): spillPastCard measured the right edge alone, so a
  // child pushed past the card's LEFT edge read as contained. A fixture page,
  // because no page here spills left today: the helper must see it the day
  // one does.
  test('spillPastCard reads a spill past either edge of the card', async ({
    page,
  }) => {
    await page.setContent(
      '<div id="fixture-card" style="box-sizing:border-box;width:200px;margin-left:100px;padding:10px;border:1px solid"><div class="pushed-left" style="margin-left:-40px;width:50px;height:10px"></div></div>',
    );
    const worst = await spillPastCard(page, 'fixture-card');
    expect(worst.who).toBe('pushed-left');
    expect(worst.over).toBeCloseTo(40, 1);
    // A screen-reader-only label, clipped to nothing, paints no spill.
    await page.setContent(
      '<div id="fixture-card" style="box-sizing:border-box;width:200px;margin-left:100px;padding:10px;border:1px solid"><span class="visually-hidden" style="position:absolute;width:1px;height:1px;margin:-1px -1px -1px -20px;overflow:hidden;clip-path:inset(50%)">label</span></div>',
    );
    expect((await spillPastCard(page, 'fixture-card')).over).toBe(0);
  });
});

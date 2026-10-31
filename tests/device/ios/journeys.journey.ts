/**
 * Real Safari, on the real iPhone, driven through our own Web Inspector
 * client by the session session.ts builds (#859). See
 * docs/superpowers/specs/2026-08-08-real-device-test-harness-design.md,
 * section 5: Playwright cannot attach to iOS Safari at all, so this is a
 * real driver for the protocol Safari's page speaks -- not a mock of
 * Playwright's API.
 *
 * INTERACTION MODE (design doc s5a). Input is DOM dispatch today -- see
 * tests/device/ios/interaction.ts's own module doc -- until #838 brings
 * WebDriverAgent's real taps. Every journey below calls only
 * `session.interaction.click/type/clear`, never element-level
 * click/sendKeys/clear directly, so it is written once and does not know
 * or care which mode is active. The mode is logged prominently by
 * session.ts when the session starts, and again at the start of every
 * test here (see `logMode` below) -- a DOM-dispatch run must never read as
 * though taps were taps.
 *
 * TASK 3a + 3b SCOPE. The task brief lists 13 journeys, in three groups
 * (happy 1-4, unhappy 5-7, edge 8-10) plus three iOS-only proofs (11-13)
 * that only a real device can exercise at all. Task 3a implemented Journey
 * 1 (happy: 12 students) and Journey 5 (unhappy: 0 students); Task 3b adds
 * the rest on top of the same file, all parameterised over LOCALES inside
 * the one `describe.each` block below -- exactly why it was structured
 * that way in the first place: a later journey drops in with no new
 * plumbing.
 *
 * Journeys 11 and 13 are bounded by the SAME dual-mode limitation this
 * whole file already carries (see INTERACTION MODE, above):
 * dom-dispatch mode does not exercise the touch input path itself, so
 * neither can verify that a real tap actually lands on a control (Journey
 * 13) or that focusing a field via a real tap changes
 * `visualViewport.scale` (Journey 11) -- only the real, computed geometry
 * each one measures (an input's own computed font-size; a control's own
 * real `rect()`) is asserted, and each says so plainly in its own test
 * name. Journey 12 is a measurement, not a threshold -- see
 * docs/superpowers/specs/2026-08-08-real-device-test-harness-design.md,
 * section 5, for why real hardware, not an emulated profile, is the whole
 * point of this file.
 *
 * Imports the real locale table, the real tool-path helper and the real
 * MAX_STUDENTS ceiling rather than restating any of them -- a hardcoded
 * '/classroom-groups' string, a hardcoded '500', or a hand-typed copy of an
 * error sentence here could all drift from their one real source the
 * moment it changes.
 *
 * One phone, one attached page for the WHOLE FILE ("Exactly one session
 * per device" -- the task brief). `beforeAll`/`afterAll` are declared at
 * module scope, not nested inside `describe.each`, so both locale blocks
 * share the one session; vitest.ios.config.ts's `fileParallelism: false` is
 * what keeps this file from ever running alongside another device-touching
 * file.
 */
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import {
  getStrings,
  LOCALES,
  toolPath,
  type Locale,
} from '../../../src/lib/i18n';
import { MAX_STUDENTS } from '../../../src/lib/grouping';
import { FLOOR_PX } from '../../../src/scripts/projector';
import { measureBoardScript, type BoardGeometry } from '../../board-geometry';
import { searched } from '../../source-files';
import {
  IOS_ZOOM_FLOOR_PX,
  measureTypedFields,
  measureTypedFieldsScript,
} from '../../typed-fields';
import { shootDevice } from './evidence';
import { startIosSession, type DeviceSession } from './session';
import { waitFor } from './page-driver';

let session: DeviceSession;

/**
 * The group cards on the page, by their text (#623). Each refused-count
 * journey reads them twice through this one reader: after the refusal, where
 * there must be none, and after a class the page can deal, where there must be
 * some. The second reading is the population the first is judged against, so
 * a reader gone blind (a selector that stopped matching, a card whose text
 * stopped reading) shows as an empty second reading rather than a clean
 * "nothing rendered".
 */
async function groupCardTexts(): Promise<string[]> {
  const cards = await session.driver.findElements('#cg-tables .group');
  return Promise.all(cards.map((card) => card.text()));
}

/**
 * Deals `students` with the rest of the form as the journey left it, and
 * reads the cards that deal rendered through `groupCardTexts`: the positive
 * control after a refusal. The page renders a deal at once (Journey 1 counts
 * every student on the first read), so the first read with any card is all of
 * them.
 */
async function dealtCardTexts(
  students: number,
  locale: Locale,
): Promise<string[]> {
  const count = await session.driver.findElement('#cg-count');
  await session.interaction.click(count);
  await session.interaction.clear(count);
  await session.interaction.type(count, String(students));
  await session.interaction.click(await session.driver.findElement('#cg-go'));
  return waitFor(
    async () => {
      const texts = await groupCardTexts();
      return texts.length > 0 ? texts : undefined;
    },
    {
      timeout: 20_000,
      describe: `${students} students to deal into group cards after the refusal (${locale}, mode: ${session.mode})`,
    },
  );
}

beforeAll(async () => {
  session = await startIosSession();
}, 120_000);

afterAll(async () => {
  // `session` is unset if `startIosSession` itself threw (a failed
  // precondition) -- nothing to tear down in that case, and nothing this
  // file could safely call teardown() on.
  await session?.teardown();
}, 120_000);

/**
 * Design doc s5a's own requirement, restated at the point every reader
 * actually looks: the top of each test's own output, not only once at
 * session start. `session.mode` is read fresh (not captured at module
 * load) because it is only known once `beforeAll` has resolved.
 */
function logMode(journeyName: string): void {
  // eslint-disable-next-line no-console -- the required per-test mode announcement, not incidental debug output
  console.log(`  [mode: ${session.mode}] ${journeyName}`);
}

// The describe name carries a static pointer to the console output rather
// than the mode value itself: Vitest fixes suite/test NAMES at synchronous
// collection time, before `beforeAll` has started the session that reports
// the mode -- so the mode cannot be interpolated into a name string
// without either an unverified top-level-await restructure or a second
// process run ahead of vitest to pre-compute it, neither of which this
// task's scope calls for. `logMode` above and session.ts's own banner are
// where the mode is actually reported, per the design doc's own wording
// ("named in the suite's output").
describe.each(LOCALES)(
  'classroom groups, locale %s (mode: see console output above)',
  (locale: Locale) => {
    const strings = getStrings(locale);
    const path = toolPath(locale);

    test('Journey 1 -- 12 students, default mode: groups render, the count is 12, and the heading matches', async () => {
      logMode(`Journey 1 (${locale})`);
      await session.navigateToPath(path);

      const count = await session.driver.findElement('#cg-count');
      await session.interaction.click(count);
      await session.interaction.clear(count);
      await session.interaction.type(count, '12');

      const go = await session.driver.findElement('#cg-go');
      await session.interaction.click(go);

      const students = await waitFor(
        async () => {
          const found = await session.driver.findElements(
            '#cg-tables .student',
          );
          return found.length > 0 ? found : undefined;
        },
        {
          timeout: 20_000,
          describe: `student cards to render in #cg-tables after submitting 12 students (${locale}, mode: ${session.mode})`,
        },
      );
      expect(students.length).toBe(12);

      const heading = await session.driver.findElement('#cg-results-h');
      expect(await heading.text()).toBe(strings.resultsHeading);

      // The success path really is a success -- not an error shown alongside
      // whatever happened to already be in #cg-tables from a stale state.
      const errorBox = await session.driver.findElement('#cg-error');
      expect(await errorBox.property('hidden')).toBe(true);
    });

    test('Journey 2 -- Number of groups: asking for 3 groups gives exactly 3 groups', async () => {
      logMode(`Journey 2 (${locale})`);
      await session.navigateToPath(path);

      const count = await session.driver.findElement('#cg-count');
      await session.interaction.click(count);
      await session.interaction.clear(count);
      await session.interaction.type(count, '12');

      const groupCountRadio = await session.driver.findElement(
        'input[name="mode"][value="groupCount"]',
      );
      await session.interaction.click(groupCountRadio);

      const groups = await session.driver.findElement('#cg-groups');
      await session.interaction.click(groups);
      await session.interaction.clear(groups);
      await session.interaction.type(groups, '3');

      const go = await session.driver.findElement('#cg-go');
      await session.interaction.click(go);

      const groupCards = await waitFor(
        async () => {
          const found = await session.driver.findElements('#cg-tables .group');
          return found.length > 0 ? found : undefined;
        },
        {
          timeout: 20_000,
          describe: `group cards to render in #cg-tables after asking for 3 groups (${locale}, mode: ${session.mode})`,
        },
      );
      expect(groupCards.length, `group count (${locale})`).toBe(3);

      // Same count invariant Journey 1 checks in the other mode -- switching
      // HOW groups are requested must not drop or duplicate a student.
      const students = await session.driver.findElements('#cg-tables .student');
      expect(
        students.length,
        `total students across the 3 groups (${locale})`,
      ).toBe(12);

      const errorBox = await session.driver.findElement('#cg-error');
      expect(await errorBox.property('hidden')).toBe(true);
    });

    test('Journey 3 -- How to use: opening it persists across a reload, and it still collapses afterwards', async () => {
      logMode(`Journey 3 (${locale})`);
      await session.navigateToPath(path);

      // Force a known starting state before anything else. This is REAL
      // localStorage on a REAL physical device: it persists across
      // separate `npm run test:ios` invocations, and nothing in this
      // harness clears it (see session.ts's own module doc) -- so a bare
      // first click here cannot assume which direction it will toggle,
      // depending on whatever a PREVIOUS run of this exact suite left
      // behind. `localStorage.setItem` is a plain script, not a
      // click/keyboard interaction, so -- like Journey 4's own
      // arrangement read below -- it is unaffected by the interaction
      // mode and does not need to go through `session.interaction`.
      await session.driver.executeScript(
        `localStorage.setItem('cg-howto-collapsed', '1');`,
      );
      await session.navigateToPath(path);

      let toggle = await session.driver.findElement('#cg-howto-toggle');
      let body = await session.driver.findElement('#cg-howto-body');
      expect(
        await toggle.attribute('aria-expanded'),
        `starts collapsed (${locale})`,
      ).toBe('false');
      expect(
        await body.property('hidden'),
        `starts collapsed (${locale})`,
      ).toBe(true);

      // Opens it.
      await session.interaction.click(toggle);
      expect(
        await toggle.attribute('aria-expanded'),
        `opened (${locale})`,
      ).toBe('true');
      expect(await body.property('hidden'), `opened (${locale})`).toBe(false);
      expect(
        await body.text(),
        `the opened body shows the real copy (${locale})`,
      ).toContain(strings.howToWhat);

      // "Collapse it, reload, still collapsed" would be vacuous here --
      // collapsed is the page's own default (ClassroomGroupsPage.astro's
      // own inline script), so that would pass even with persistence
      // completely unwired. The direction that actually proves persistence
      // is open-survives-reload -- the identical reasoning
      // classroom-groups-controls.spec.ts's own "the opened state survives
      // a reload" test already states for the emulated suite.
      await session.navigateToPath(path); // the "reload" -- a fresh navigation, so both handles above are now stale; both are re-found below.
      toggle = await session.driver.findElement('#cg-howto-toggle');
      body = await session.driver.findElement('#cg-howto-body');
      expect(
        await toggle.attribute('aria-expanded'),
        `still open after a reload (${locale})`,
      ).toBe('true');
      expect(
        await body.property('hidden'),
        `still open after a reload (${locale})`,
      ).toBe(false);

      // And the control still works both ways after that reload -- a
      // control that only ever opens is a trap too. This is the literal
      // "collapses" half of this journey's own name.
      await session.interaction.click(toggle);
      expect(
        await toggle.attribute('aria-expanded'),
        `collapses again (${locale})`,
      ).toBe('false');
      expect(await body.property('hidden'), `collapses again (${locale})`).toBe(
        true,
      );
    });

    test('Journey 4 -- Shuffle again: a second shuffle rearranges the class without changing how many students are shown', async () => {
      logMode(`Journey 4 (${locale})`);
      await session.navigateToPath(path);

      const count = await session.driver.findElement('#cg-count');
      await session.interaction.click(count);
      await session.interaction.clear(count);
      await session.interaction.type(count, '20');

      const go = await session.driver.findElement('#cg-go');
      await session.interaction.click(go);

      await waitFor(
        async () => {
          const found = await session.driver.findElements(
            '#cg-tables .student',
          );
          return found.length > 0 ? found : undefined;
        },
        {
          timeout: 20_000,
          describe: `student cards to render after the first shuffle (${locale}, mode: ${session.mode})`,
        },
      );
      // Proves the SECOND click below really does hit the "Shuffle again"
      // affordance (the real, localised label), not merely the same button
      // id by coincidence.
      expect(
        await go.text(),
        `the button reads the real "again" copy after a successful shuffle (${locale})`,
      ).toBe(strings.again);

      // One script round trip rather than one driver call per
      // student -- read-only DOM inspection, exactly like Journey 1's own
      // direct `session.driver.findElement(...).text()` calls, so it does
      // not go through `session.interaction` either.
      const readOrder = () =>
        session.driver.executeScript<string[]>(
          `return Array.from(document.querySelectorAll('#cg-tables .student .who')).map((el) => el.textContent || '');`,
        );
      const before = await readOrder();
      expect(
        before.length,
        `students captured before the second shuffle (${locale})`,
      ).toBe(20);

      // A disabled button's `.click()` is a genuine no-op, not a delayed
      // one. The button once disabled itself for the whole deal, and this
      // test's first real run had its second click swallowed that way. A
      // deal no longer disables it (operator, 2026-08-13: a press mid-deal
      // starts a new deal from the top, superseded by `dealToken`), so this
      // wait now only confirms the roster can still be dealt.
      await waitFor(
        async () => {
          const disabled = await go.property('disabled');
          return disabled === false ? true : undefined;
        },
        {
          timeout: 20_000,
          describe: `#cg-go to be enabled, the roster dealable (${locale}, mode: ${session.mode})`,
        },
      );

      await session.interaction.click(go);

      const after = await waitFor(
        async () => {
          const current = await readOrder();
          return JSON.stringify(current) !== JSON.stringify(before)
            ? current
            : undefined;
        },
        {
          timeout: 20_000,
          describe: `#cg-tables's arrangement to change after clicking "Shuffle again" (${locale}, mode: ${session.mode})`,
        },
      );
      expect(
        after.length,
        `student count unchanged by a reshuffle (${locale})`,
      ).toBe(20);

      const errorBox = await session.driver.findElement('#cg-error');
      expect(await errorBox.property('hidden')).toBe(true);
    });

    test('Journey 5 -- 0 students: the real localised error, no groups', async () => {
      logMode(`Journey 5 (${locale})`);
      await session.navigateToPath(path);

      const count = await session.driver.findElement('#cg-count');
      await session.interaction.click(count);
      await session.interaction.clear(count);
      await session.interaction.type(count, '0');

      const go = await session.driver.findElement('#cg-go');
      await session.interaction.click(go);

      const errorBox = await waitFor(
        async () => {
          const el = await session.driver.findElement('#cg-error');
          const hidden = await el.property('hidden');
          return hidden === false ? el : undefined;
        },
        {
          timeout: 20_000,
          describe: `#cg-error to become visible after submitting 0 students (${locale}, mode: ${session.mode})`,
        },
      );
      expect(await errorBox.text()).toBe(strings.errors.NO_STUDENTS);

      const results = await session.driver.findElement('#cg-results');
      expect(await results.property('hidden')).toBe(true);

      const refused = await groupCardTexts();
      const dealt = await dealtCardTexts(12, locale);
      expect(
        searched(refused, {
          of: dealt,
          what: `group cards 12 students deal into (${locale})`,
        }),
        `group cards after refusing 0 students (${locale})`,
      ).toEqual([]);
    });

    // Brief item 6 reads "a group size larger than the class". The only
    // request shape this engine actually refuses for that reason is
    // `groupCount` mode asking for more GROUPS than there are students to
    // put in them (buildGroups: `mode.count > present.length` ->
    // TOO_MANY_GROUPS) -- `perGroup` mode never refuses an oversized size
    // at all (it just folds down to one group, buildGroups's own
    // `targetSizes`), so that shape has no error to assert here. This is
    // the one real, reachable error matching the brief's description;
    // implemented against it rather than a shape that does not exist.
    test('Journey 6 -- more groups than students: the real localised message, no groups rendered', async () => {
      logMode(`Journey 6 (${locale})`);
      await session.navigateToPath(path);

      const count = await session.driver.findElement('#cg-count');
      await session.interaction.click(count);
      await session.interaction.clear(count);
      await session.interaction.type(count, '5');

      const groupCountRadio = await session.driver.findElement(
        'input[name="mode"][value="groupCount"]',
      );
      await session.interaction.click(groupCountRadio);

      const groups = await session.driver.findElement('#cg-groups');
      await session.interaction.click(groups);
      await session.interaction.clear(groups);
      await session.interaction.type(groups, '10'); // more groups than the 5 students above

      const go = await session.driver.findElement('#cg-go');
      await session.interaction.click(go);

      const errorBox = await waitFor(
        async () => {
          const el = await session.driver.findElement('#cg-error');
          const hidden = await el.property('hidden');
          return hidden === false ? el : undefined;
        },
        {
          timeout: 20_000,
          describe: `#cg-error to become visible after asking for more groups than students (${locale}, mode: ${session.mode})`,
        },
      );
      expect(await errorBox.text()).toBe(
        strings.errors.TOO_MANY_GROUPS({ max: 5 }),
      );

      const results = await session.driver.findElement('#cg-results');
      expect(await results.property('hidden')).toBe(true);

      // 12 students fill the 10 groups still asked for.
      const refused = await groupCardTexts();
      const dealt = await dealtCardTexts(12, locale);
      expect(
        searched(refused, {
          of: dealt,
          what: `group cards 12 students in 10 groups deal into (${locale})`,
        }),
        `group cards after refusing more groups than students (${locale})`,
      ).toEqual([]);
    });

    test('Journey 7 -- changing the student count after a shuffle shows the real localised stale notice', async () => {
      logMode(`Journey 7 (${locale})`);
      await session.navigateToPath(path);

      const count = await session.driver.findElement('#cg-count');
      await session.interaction.click(count);
      await session.interaction.clear(count);
      await session.interaction.type(count, '15');

      const go = await session.driver.findElement('#cg-go');
      await session.interaction.click(go);

      await waitFor(
        async () => {
          const found = await session.driver.findElements(
            '#cg-tables .student',
          );
          return found.length > 0 ? found : undefined;
        },
        {
          timeout: 20_000,
          describe: `student cards to render after the first shuffle (${locale}, mode: ${session.mode})`,
        },
      );

      const staleNoticeBefore = await session.driver.findElement('#cg-stale');
      expect(
        await staleNoticeBefore.property('hidden'),
        `no stale notice before anything changes (${locale})`,
      ).toBe(true);

      // Changing the student count after a shuffle -- the exact trigger the
      // brief names. Drives `readRoster()`'s own snapshot field, the LAST
      // branch staleReason checks, so this exercises the real priority
      // order too, not just the existence of a notice.
      await session.interaction.click(count);
      await session.interaction.clear(count);
      await session.interaction.type(count, '18');

      await waitFor(
        async () => {
          const el = await session.driver.findElement('#cg-stale');
          const hidden = await el.property('hidden');
          return hidden === false ? true : undefined;
        },
        {
          timeout: 20_000,
          describe: `#cg-stale to become visible after changing the student count (${locale}, mode: ${session.mode})`,
        },
      );
      const staleText = await session.driver.findElement('#cg-stale-text');
      expect(await staleText.text()).toBe(strings.staleRoster);

      const results = await session.driver.findElement('#cg-results');
      expect(
        await results.attribute('class'),
        `the old groups are visually marked stale, not merely still present (${locale})`,
      ).toContain('stale');
    });

    test('Journey 8a -- MAX_STUDENTS accepted: the boundary count itself succeeds', async () => {
      logMode(`Journey 8a (${locale})`);
      await session.navigateToPath(path);

      // A real, product-level preference (Skip the animation) -- exactly
      // what a reduced-motion device gets by default, per
      // src/scripts/classroom-groups.ts's own `reduceMotion` branch, which
      // sets this same field the same direct way: no dispatched event,
      // because the submit handler reads `speedSelect.value` fresh at
      // shuffle time and nothing listens for a `change` on this field.
      // Set here purely so MAX_STUDENTS worth of per-card deal animation
      // (otherwise ~110ms EACH, on the phone's one shared main thread) does
      // not still be running when the very next journey issues its own
      // commands against the same page. A plain script, a
      // direct value assignment exactly like the product's own
      // `reduceMotion` branch already performs -- not a synthetic
      // click/keyboard interaction, so this does not go through
      // `session.interaction` either.
      await session.driver.executeScript(
        `document.getElementById('cg-speed').value = 'skip';`,
      );

      const count = await session.driver.findElement('#cg-count');
      await session.interaction.click(count);
      await session.interaction.clear(count);
      await session.interaction.type(count, String(MAX_STUDENTS));

      const go = await session.driver.findElement('#cg-go');
      await session.interaction.click(go);

      const students = await waitFor(
        async () => {
          const found = await session.driver.findElements(
            '#cg-tables .student',
          );
          return found.length > 0 ? found : undefined;
        },
        {
          timeout: 30_000,
          describe: `${MAX_STUDENTS} student cards to render after submitting exactly MAX_STUDENTS (${locale}, mode: ${session.mode})`,
        },
      );
      expect(
        students.length,
        `every MAX_STUDENTS student rendered, none lost or duplicated (${locale})`,
      ).toBe(MAX_STUDENTS);

      const errorBox = await session.driver.findElement('#cg-error');
      expect(
        await errorBox.property('hidden'),
        `MAX_STUDENTS itself is accepted, not refused (${locale})`,
      ).toBe(true);
    });

    test('Journey 8b -- MAX_STUDENTS + 1 refused: the real localised message', async () => {
      logMode(`Journey 8b (${locale})`);
      await session.navigateToPath(path);

      const count = await session.driver.findElement('#cg-count');
      await session.interaction.click(count);
      await session.interaction.clear(count);
      await session.interaction.type(count, String(MAX_STUDENTS + 1));

      const go = await session.driver.findElement('#cg-go');
      await session.interaction.click(go);

      const errorBox = await waitFor(
        async () => {
          const el = await session.driver.findElement('#cg-error');
          const hidden = await el.property('hidden');
          return hidden === false ? el : undefined;
        },
        {
          timeout: 20_000,
          describe: `#cg-error to become visible after submitting MAX_STUDENTS + 1 (${locale}, mode: ${session.mode})`,
        },
      );
      expect(await errorBox.text()).toBe(
        strings.errors.TOO_MANY_STUDENTS({ max: MAX_STUDENTS }),
      );

      const refused = await groupCardTexts();
      const dealt = await dealtCardTexts(12, locale);
      expect(
        searched(refused, {
          of: dealt,
          what: `group cards 12 students deal into (${locale})`,
        }),
        `nothing rendered for a refused count (${locale})`,
      ).toEqual([]);
    });

    test('Journey 9 -- no horizontal scroll at the real device width', async () => {
      logMode(`Journey 9 (${locale})`);
      await session.navigateToPath(path);

      const { scrollWidth, innerWidth } = await session.driver.executeScript<{
        scrollWidth: number;
        innerWidth: number;
      }>(
        `return { scrollWidth: document.documentElement.scrollWidth, innerWidth: window.innerWidth };`,
      );
      expect(
        innerWidth,
        `a real, nonzero viewport width was actually read (${locale})`,
      ).toBeGreaterThan(0);
      expect(
        scrollWidth,
        `no horizontal scroll: scrollWidth (${scrollWidth}) vs innerWidth (${innerWidth}), locale ${locale}`,
      ).toBeLessThanOrEqual(innerWidth);
    });

    test('Journey 10 -- privacy: a class name and a student count never reach localStorage', async () => {
      logMode(`Journey 10 (${locale})`);
      await session.navigateToPath(path);

      const classInput = await session.driver.findElement('#cg-class');
      await session.interaction.click(classInput);
      await session.interaction.clear(classInput);
      const probeClassName = 'ZZQ-IOS-PRIVACY-PROBE-CLASSNAME';
      await session.interaction.type(classInput, probeClassName);

      const count = await session.driver.findElement('#cg-count');
      await session.interaction.click(count);
      await session.interaction.clear(count);
      const probeCount = '173';
      await session.interaction.type(count, probeCount);

      // Neither field's OWN listener ever writes to storage -- the only
      // thing on this page that does is the how-to toggle (and the sound
      // checkbox, untouched here). Clicking it is what proves a REAL write
      // happens and still does not leak either probe value, rather than
      // only proving an untouched store stays empty -- mirrors and extends
      // classroom-groups-controls.spec.ts's own "only the preference is
      // stored, never class data" test, which checks the student count but
      // not the class name field.
      //
      // The key goes first, or the "a real write happened" control below is
      // satisfied by a key Journey 3 wrote earlier in this session, or by any
      // past run: this is the phone's real localStorage, and nothing clears it.
      const keyBefore = await session.driver.executeScript<string | null>(
        `localStorage.removeItem('cg-howto-collapsed'); return localStorage.getItem('cg-howto-collapsed');`,
      );
      expect(keyBefore, `the key is gone before the click (${locale})`).toBe(
        null,
      );
      const howToToggle = await session.driver.findElement('#cg-howto-toggle');
      await session.interaction.click(howToToggle);

      const stored = await session.driver.executeScript<Record<string, string>>(
        `return { ...localStorage };`,
      );
      const values = Object.values(stored).join(' ');
      expect(
        Object.keys(stored),
        `a real write actually happened (${locale})`,
      ).toContain('cg-howto-collapsed');
      expect(
        values,
        `the class name never reaches storage (${locale})`,
      ).not.toContain(probeClassName);
      expect(
        values,
        `the student count never reaches storage (${locale})`,
      ).not.toContain(probeCount);
      // `theme` is the harness's own stamp (navigateToPath pins the palette,
      // #142), not a key this page writes.
      const written = Object.keys(stored).filter((key) => key !== 'theme');
      expect(
        written.every((k) => k.startsWith('cg-')),
        `every key this page writes starts "cg-" (${locale}): ${JSON.stringify(written)}`,
      ).toBe(true);
    });

    // iOS-only proofs (11-13): the reason this whole runner exists. Bounded
    // by the SAME dual-mode limitation as the rest of this file -- see this
    // file's own module doc, and design doc s5a.
    // The fields are the ones `zoom-on-focus.spec.ts` checks in CI, from the
    // one definition in tests/typed-fields.ts. This journey used to check only
    // `input[type=text|number]`, so the one leg on real WebKit skipped every
    // select, textarea and email field (#390).
    test('Journey 11 -- iOS-only, no zoom on focus: every typed field has a real computed font-size >= 16px (tap-triggered focus and scale change are NOT verified in dom-dispatch mode)', async () => {
      logMode(`Journey 11 (${locale})`);
      await session.navigateToPath(path);

      const fields = await session.driver.executeScript<
        ReturnType<typeof measureTypedFields>
      >(measureTypedFieldsScript());
      // Guards against a silently-empty match set making the loop below
      // vacuously true -- a selector typo would otherwise pass having
      // checked nothing at all.
      expect(
        fields.length,
        `at least one typed field was found to check (${locale})`,
      ).toBeGreaterThan(0);

      for (const { field, fontSize } of fields) {
        expect(
          fontSize,
          `${field} computed font-size (${locale})`,
        ).toBeGreaterThanOrEqual(IOS_ZOOM_FLOOR_PX);
      }
    });

    test('Journey 12 -- iOS-only geometry: viewport, device pixel ratio, and the fold position of #cg-go (a measurement, not a threshold)', async () => {
      logMode(`Journey 12 (${locale})`);
      await session.navigateToPath(path);

      const geometry = await session.driver.executeScript<{
        innerWidth: number;
        innerHeight: number;
        devicePixelRatio: number;
        scrollWidth: number;
        goTop: number;
      }>(
        `var r = document.getElementById('cg-go').getBoundingClientRect();
         return {
           innerWidth: window.innerWidth,
           innerHeight: window.innerHeight,
           devicePixelRatio: window.devicePixelRatio,
           scrollWidth: document.documentElement.scrollWidth,
           goTop: r.top + window.scrollY,
         };`,
      );

      // The required report itself (brief step 12: "report the fold
      // measurement in your report"), not incidental debug output --
      // --reporter=verbose (package.json's own test:ios script) is what
      // makes this actually appear in the run's own output; see
      // session.ts's identical reasoning for its own mode banner.
      // eslint-disable-next-line no-console -- see the comment immediately above
      console.log(
        `  [Journey 12 geometry, locale ${locale}] innerWidth=${geometry.innerWidth} innerHeight=${geometry.innerHeight} ` +
          `devicePixelRatio=${geometry.devicePixelRatio} #cg-go top=${geometry.goTop}px`,
      );

      expect(
        geometry.innerWidth,
        `a real, nonzero viewport width was read (${locale})`,
      ).toBeGreaterThan(0);
      expect(
        geometry.innerHeight,
        `a real, nonzero viewport height was read (${locale})`,
      ).toBeGreaterThan(0);
      expect(
        geometry.devicePixelRatio,
        `a real, positive device pixel ratio was read (${locale})`,
      ).toBeGreaterThan(0);
      expect(
        geometry.scrollWidth,
        `no horizontal scroll (${locale})`,
      ).toBeLessThanOrEqual(geometry.innerWidth);
    });

    test('Journey 13 -- iOS-only, 44px touch targets: primary controls meet the minimum at real pixel density (geometry only -- that a tap actually lands is NOT verified)', async () => {
      logMode(`Journey 13 (${locale})`);
      await session.navigateToPath(path);

      // "Primary controls": the ones a teacher taps to operate the tool at
      // all, each with its own stable id and its own `min-height: 44px`
      // rule in ClassroomGroupsPage.astro -- not an audit of every control
      // on the page, which is a different (and much larger) concern than
      // one journey.
      const primaryControlIds = [
        'cg-go',
        'cg-howto-toggle',
        'cg-students-toggle',
        'cg-grouping-toggle',
        'cg-io-toggle',
        'cg-sound-toggle',
      ];

      for (const id of primaryControlIds) {
        const el = await session.driver.findElement(`#${id}`);
        const rect = await el.rect();
        // Rounded for the reason tests/viewport.ts's `rectAtLeast44`
        // rounds: a box declared at 44px can read back as 43.9999. It is
        // asserted here rather than through that one home because this
        // corpus runs under vitest and that module's `expect` is
        // Playwright's, so it cannot be imported from here.
        expect(
          Math.round(rect.width),
          `#${id} width, locale ${locale}`,
        ).toBeGreaterThanOrEqual(44);
        expect(
          Math.round(rect.height),
          `#${id} height, locale ${locale}`,
        ).toBeGreaterThanOrEqual(44);
      }
    });

    /**
     * #189 AC11: the reported case, on the phone it was reported on -- and a
     * second shape, because the reported one cannot fail.
     *
     * The bug was a group card clipped by the projector board when five groups
     * wrapped onto a second row. The desktop suite covers it, but it has to
     * STUB the refused fullscreen grant (`Element.prototype.requestFullscreen`
     * replaced by a rejecting stub in `classroom-groups-projector.spec.ts`),
     * because Chromium headless is the only way it can reach that path. iOS
     * Safari refuses natively -- so this is the same layer, reached honestly,
     * and it is the reason an emulator is not a substitute.
     *
     * The measurement is NOT written here: it is `measureBoard`, the one the
     * desktop leg runs, sent down the wire as text. A second measurement over
     * here would be the one place the two legs could quietly disagree, in the
     * leg nobody watches.
     *
     * WHY TWO SHAPES. Mutation D1 restored the original defect and this journey
     * stayed GREEN on the reported shape -- with the built bundle proving the
     * mutation reached the page (`removeProperty` 2->3, `style.fontSize` 3->2),
     * so not a dead mutation. The reason is the defect's signature: a FALSE
     * FIT. It measures at the root's 16px, concludes the sheet fits, and
     * returns `scrolls false`. At 25 pupils in fives the sheet is 1618px in a
     * 683px stage and fits at NO font, so shrink-to-fit engages either way and
     * lands on the readable floor. The bug had nowhere to show itself.
     *
     * So the shapes were MEASURED on the phone rather than guessed. At 8 pupils
     * in pairs: `available` 683, the sheet 683 at 16px (a fit -- and that exact
     * equality is #189's second defect visible in raw data, since `scrollHeight`
     * on a clipping box can never fall below `clientHeight`) and 1167px at
     * 40px. That is the false-fit condition, with 484px of overflow to show it
     * in. Nine of ten measured shapes qualified; the reported one did not.
     *
     * A guard nobody has watched fail is not a guard, so the reported case
     * proves the fix on the shape it was reported on, and this one proves the
     * journey can still catch the defect that caused it.
     */
    const BOARD_SHAPES = [
      {
        count: '25',
        size: '5',
        groups: 5,
        what: 'the reported case',
      },
      {
        count: '8',
        size: '2',
        groups: 4,
        what: 'the false-fit shape',
      },
    ] as const;

    for (const shape of BOARD_SHAPES) {
      test(`Journey 14 -- iOS-only, ${shape.what}: ${shape.count} pupils in ${shape.size}s on the projector board, with the fullscreen grant refused by the phone itself`, async () => {
        logMode(`Journey 14 (${locale}, ${shape.count}/${shape.size})`);
        await session.navigateToPath(path);

        const project = 'ios-safari-real-device';

        const count = await session.driver.findElement('#cg-count');
        await session.interaction.click(count);
        await session.interaction.clear(count);
        await session.interaction.type(count, shape.count);

        const size = await session.driver.findElement('#cg-size');
        await session.interaction.click(size);
        await session.interaction.clear(size);
        await session.interaction.type(size, shape.size);

        // `#cg-speed` is a <select>, and `Interaction` deliberately offers only
        // click/type/clear -- so this one control goes through the driver. Two
        // things make that safe rather than a shortcut: the value is READ BACK
        // (a set that silently did nothing would leave the shuffle animating
        // while the layout below was measured mid-flight), and JavaScript needs
        // no visibility, so the phone skips expanding the sound section that the
        // desktop leg has to open first.
        const speed = await session.driver.executeScript<string>(
          `var s = document.getElementById('cg-speed');
         s.value = 'skip';
         s.dispatchEvent(new Event('change', { bubbles: true }));
         return s.value;`,
        );
        expect(speed, `the shuffle animation was skipped (${locale})`).toBe(
          'skip',
        );

        const go = await session.driver.findElement('#cg-go');
        await session.interaction.click(go);

        const cards = await waitFor(
          async () => {
            const found =
              await session.driver.findElements('#cg-tables .group');
            return found.length > 0 ? found : undefined;
          },
          {
            timeout: 20_000,
            describe: `${shape.count} students in ${shape.size}s to render as group cards (${locale}, mode: ${session.mode})`,
          },
        );
        expect(
          cards.length,
          `${shape.count} students in ${shape.size}s is ${shape.groups} groups (${locale})`,
        ).toBe(shape.groups);

        const openButton = await waitFor(
          async () => {
            const [button] =
              await session.driver.findElements('#cg-board-open');
            if (!button) return undefined;
            return (await button.property('hidden')) === false
              ? button
              : undefined;
          },
          {
            timeout: 20_000,
            describe: `the Full screen button to be offered once there are results (${locale})`,
          },
        );
        await session.interaction.click(openButton);

        // The overlay MOVES `#cg-results` rather than re-rendering it, so group
        // cards inside the stage are proof the move happened, not merely that
        // the button was pressed.
        await waitFor(
          async () => {
            const found = await session.driver.findElements(
              '#cg-board-stage .group',
            );
            return found.length > 0 ? found : undefined;
          },
          {
            timeout: 20_000,
            describe: `the board to take the results into its stage (${locale})`,
          },
        );

        /**
         * The positive control, and the reason this journey is worth a phone.
         *
         * `projector.ts` calls `requestFullscreen?.()` and swallows the
         * rejection on purpose -- the overlay is showing either way -- so a
         * board that opened proves nothing about WHICH path opened it. Without
         * this, a phone that silently granted fullscreen would run every
         * assertion below against the granted layout and report AC11 met.
         *
         * `apiOffered` is reported rather than asserted: if iOS ever stops
         * exposing the method at all, "not in fullscreen" would still be true
         * for a different reason, and the failure message should say so instead
         * of a later reader assuming a refusal that never happened.
         */
        const grant = await session.driver.executeScript<{
          apiOffered: boolean;
          inFullscreen: boolean;
          boardShown: boolean;
        }>(
          `var board = document.getElementById('cg-board');
         return {
           apiOffered: typeof Element.prototype.requestFullscreen === 'function',
           inFullscreen: document.fullscreenElement != null,
           boardShown: !!board && board.hidden === false,
         };`,
        );

        expect(
          grant.boardShown,
          `the board is showing on a real iPhone (${locale}); fullscreen API ` +
            `offered: ${grant.apiOffered}`,
        ).toBe(true);
        expect(
          grant.inFullscreen,
          `this is the REFUSED-grant path, refused by the phone rather than by ` +
            `a stub (${locale}); fullscreen API offered: ${grant.apiOffered}`,
        ).toBe(false);
        await shootDevice(session.driver, {
          project,
          label: `the board open on a refused grant -- API offered: ${grant.apiOffered}`,
        });

        const seen =
          await session.driver.executeScript<BoardGeometry>(
            measureBoardScript(),
          );
        const where =
          `${seen.rows} row(s) at ${seen.font}: a ${seen.scrollHeight}px sheet ` +
          `in a ${seen.clientHeight}px stage with overflow-y: ${seen.overflowY}`;

        // The measurement itself, reported -- Journey 12's precedent, for the
        // same reason: a number only a real phone can produce is the point of
        // running on one, and `--reporter=verbose` (package.json's own test:ios
        // script) is what puts it in the run's own output rather than nowhere.
        // Read it against FLOOR_PX: a board sitting AT the floor has shrunk as
        // far as it may before scrolling becomes the honest answer.
        // eslint-disable-next-line no-console -- see the comment immediately above
        console.log(
          `  [Journey 14 board, locale ${locale}] ${where}; cards=${seen.cards.length} ` +
            `unreachable=${seen.unreachable.length} scrollable=${seen.scrollable} ` +
            `floor=${FLOOR_PX}px`,
        );

        // THE INVARIANT, first -- an assertion ordered after a brittle proxy is
        // only ever evaluated while the proxy holds (#156). The question that
        // matters is whether a teacher can see every name.
        expect(
          searched(seen.unreachable, {
            of: seen.cards,
            what: `group cards on the real-device board (${locale})`,
          }),
          where,
        ).toEqual([]);
        await shootDevice(session.driver, {
          project,
          label: `nothing out of reach -- ${seen.rows} row(s) at ${seen.font}`,
        });

        // ...and the property behind it: either the sheet fits, or the stage
        // genuinely scrolls. Never how many things there are.
        expect(
          seen.scrollHeight <= seen.clientHeight || seen.scrollable,
          `${where} -- content nobody can reach (${locale})`,
        ).toBe(true);

        // ...and the converse, which is what makes the verdict honest rather
        // than merely safe: a board that offers a scrollbar it does not need
        // would keep every assertion above green.
        if (seen.scrollHeight <= seen.clientHeight) {
          expect(
            seen.scrollable,
            `${where} -- the sheet fits, so the stage must not scroll (${locale})`,
          ).toBe(false);
        }

        // ...and the assertion the desktop mutation sweep was missing: a board
        // may scroll ONLY once it has come down to the readable floor. Anything
        // above the floor that still does not fit had somewhere left to go.
        if (seen.scrollHeight > seen.clientHeight) {
          expect(
            parseFloat(seen.font),
            `${where} -- scrolling at ${seen.font}, above the ${FLOOR_PX}px ` +
              `floor (${locale}): it had further to shrink before scrolling was ` +
              'the honest answer',
          ).toBeLessThanOrEqual(FLOOR_PX + 1);
        }

        await shootDevice(session.driver, {
          project,
          label: `${shape.what} confirmed -- ${seen.rows} row(s), ${seen.cards.length} cards at ${seen.font}`,
        });
      });
    }
  },
);

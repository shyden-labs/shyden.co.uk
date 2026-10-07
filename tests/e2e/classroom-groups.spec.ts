import { test, expect } from './fixtures';
import { chooseSpeed } from '../make-groups';
import { recordErrors, recordRequests, urlMatching } from './recorders';
import type { Page } from '@playwright/test';

import { join, relative, sep, basename } from 'node:path';
import { floorBreach } from '../floors';
import { filesUnder, searched } from '../source-files';
import {
  DEFAULT_LOCALE,
  LOCALES,
  getSiteStrings,
  getStrings,
  localisePath,
} from '../../src/lib/i18n';
import { recorded, shoot } from './evidence';
import { THEMES } from '../palette';
import { THEME_SCRIPT_SOURCE, emulateTheme } from '../themes';
import { atLeast44, expectNoHorizontalScroll } from '../viewport';
import { localePaths } from './locale-sampling';
import {
  openRoster,
  addSeveral,
  buildRoster,
  giveEveryoneASex,
  contrastRatio,
  listedByThisBrowser,
} from './helpers';

test.use(recorded);

/**
 * Every assertion is web-first (auto-retrying). No fixed waits: the tool deals
 * cards on a timer, so a sleep would make these pass or fail on machine speed
 * rather than on the product.
 */

const fill = async (
  page: Page,
  opts: {
    count?: string;
    size?: string;
    /** Switches to "number of groups" mode and sets it. */
    groups?: string;
    speed?: 'normal' | 'fast' | 'skip';
  },
) => {
  if (opts.count !== undefined) await page.fill('#cg-count', opts.count);
  if (opts.size !== undefined) await page.fill('#cg-size', opts.size);
  if (opts.groups !== undefined) {
    await page.check('input[name="mode"][value="groupCount"]');
    await page.fill('#cg-groups', opts.groups);
  }
  // Default to skip so the tests assert the RESULT, not the show. The
  // animation gets its own test below. Idempotent, so `fill()` may run
  // more than once in a test (see chooseSpeed).
  await chooseSpeed(page, opts.speed ?? 'skip');
};

/**
 * Playwright cannot hear a sound effect, so the wiring tests below assert
 * the one thing that IS observable: whether `classroom-groups.ts` created
 * an `AudioContext` at all, and how many. This subclasses the REAL
 * `AudioContext` -- every constructed instance still calls `super(...)`,
 * so the actual Web Audio implementation underneath is exactly what
 * ships; nothing here is a fake standing in for it, only an added counter.
 * Installed via `addInitScript` so it is in place before
 * `classroom-groups.ts`'s module code (which creates its AudioContext
 * lazily, on first effect) ever runs.
 */
const installAudioContextCounter = (page: Page) =>
  page.addInitScript(() => {
    const w = window as Window & {
      __cgAudioContexts?: number;
      webkitAudioContext?: typeof AudioContext;
    };
    w.__cgAudioContexts = 0;
    const RealAudioContext = window.AudioContext ?? w.webkitAudioContext;
    if (!RealAudioContext) return; // no Web Audio support at all -- nothing to count
    class CountingAudioContext extends RealAudioContext {
      constructor(...args: ConstructorParameters<typeof AudioContext>) {
        super(...args);
        w.__cgAudioContexts = (w.__cgAudioContexts ?? 0) + 1;
      }
    }
    window.AudioContext = CountingAudioContext;
    if (w.webkitAudioContext) w.webkitAudioContext = CountingAudioContext;
  });

const audioContextCount = (page: Page) =>
  page.evaluate(
    () => (window as Window & { __cgAudioContexts?: number }).__cgAudioContexts,
  );

/** Every audio request this page could ever legitimately make matches this --
 *  used both to prove "none happened" and to prove "the ones that did are
 *  ours". A trailing query string is tolerated (Vite's own content-hashed
 *  filenames never carry one, but a URL match should not depend on that). */
const AUDIO_URL_PATTERN = /\.m4a(?:\?|$)/;

/** Walks `dist/` (the just-built output `playwright.config.ts`'s own
 *  webServer produces before any test runs) and returns every `.m4a` file
 *  found, as full filesystem paths -- not hardcoded to `dist/_astro/`
 *  specifically, so this stays correct if Vite's own asset directory ever
 *  changes. The recursion it once carried was one of nine private copies (#80). */
const listM4aFiles = (dir: string): string[] =>
  filesUnder(dir, (path) => path.endsWith('.m4a'));

/** A filesystem path under `dist/` -> the URL path the built site actually
 *  serves it at, e.g. `dist/_astro/shuffle.AbC123.m4a` -> `/_astro/shuffle.
 *  AbC123.m4a`. `sep`-split/rejoined so this is correct on any platform,
 *  not just one that happens to use `/` as its own path separator. */
const distPathToUrlPath = (fullPath: string): string =>
  '/' + relative('dist', fullPath).split(sep).join('/');

test.describe('classroom group creator', () => {
  // Stage 2, Task 1's own RED tests. The brief's literal snippet used
  // `getByLabel('How many students?')` and `#cg-groups .group` — neither
  // matches this page: the label reads "Number of students" (`studentsLabel`
  // in en.ts) and `#cg-groups` is the "how many groups" NUMBER INPUT's id,
  // not the results container (that's `#cg-results`, as every other test in
  // this file already uses). Corrected to the real label and the real
  // selector rather than reproduced verbatim.
  test('shuffles anonymous students against the rewritten engine', async ({
    page,
  }) => {
    await page.goto('/classroom-groups');
    await page.getByLabel('Number of students').fill('12');
    await giveEveryoneASex(page);
    await page.getByRole('button', { name: 'Make groups' }).click();
    // 12 students at the default group size (4) => 3 groups.
    await expect(page.locator('#cg-results .group')).toHaveCount(3);
  });

  test('the paste-names box and the keep-apart box are gone', async ({
    page,
  }) => {
    await page.goto('/classroom-groups');
    await expect(page.locator('#cg-names')).toHaveCount(0);
    await expect(page.locator('#cg-apart')).toHaveCount(0);
  });

  // Two more tests retired along with the keep-apart box (#cg-apart) above
  // -- both fed `apart`, free text the rewritten engine no longer accepts
  // (see grouping.ts's GroupingInput). Their SUBJECTS are still alive and
  // worth reinstating once apart-letters are reachable from the page again:
  //
  // - 'explains an impossible keep-apart instead of failing silently':
  //   KEEP_APART_IMPOSSIBLE names the conflicting students and states how
  //   many groups they would need (src/lib/i18n/index.ts:113).
  // - 'an unarrangeable class is explained without accusing anyone':
  //   KEEP_APART_NO_ARRANGEMENT's promise that a refusal names NOBODY --
  //   proving no arrangement exists is not the same as blaming a student,
  //   and a later stage could silently re-break that
  //   (src/lib/i18n/index.ts:118).

  // #188's own required journey, in a real browser: registration is taken,
  // number 7 is away, and the lesson starts in two minutes. The teacher
  // types the class size they know, says who is missing, and gets groups of
  // the children actually in the room -- without opening Student details or
  // hand-building a row per pupil.
  //
  // "Number of groups", not "students per group": 24 children in groups of
  // five would be FOUR groups of six, since no group may be smaller than the
  // size asked for. Five groups is what the teacher wants and what the
  // ticket describes.
  test('leaves a pupil typed absent out of the groups entirely', async ({
    page,
  }) => {
    await page.goto('/classroom-groups');
    await fill(page, { count: '25', groups: '5' });
    await page.fill('#cg-numbers-absent', '7');
    await expect(page.locator('#cg-numbers-absent')).toHaveValue('7');
    await shoot(
      page,
      'number 7 typed into Student numbers',
      page.locator('.number-fields'),
    );
    await page.click('#cg-go');

    const results = page.locator('#cg-results');
    await expect(results.locator('.group')).toHaveCount(5);
    await expect(results.locator('.student')).toHaveCount(24);

    // The absence needs a positive control beside it. If the labels were
    // malformed -- "Student NaN", or a renamed class -- then "no card says
    // Student 7" would pass for a reason that has nothing to do with
    // absence. Number 8 must be on the board, and 7 must not.
    await expect(results.getByText('Student 8', { exact: true })).toHaveCount(
      1,
    );
    await expect(results.getByText('Student 7', { exact: true })).toHaveCount(
      0,
    );

    // And nobody was renumbered to close the gap: 25 is still the last
    // number, not 24 (AC9).
    await expect(results.getByText('Student 25', { exact: true })).toHaveCount(
      1,
    );
    await shoot(
      page,
      'five groups of the 24 present, without number 7',
      results,
    );

    // AC13: the teacher is told, never left to notice a missing child. The
    // note is worded from what was really placed, so it cannot disagree with
    // the board above it. Visible AND worded: `toHaveText` reads
    // `textContent`, which a hidden note still carries.
    const note = page.locator('#cg-grouped-note');
    await expect(note).toBeVisible();
    await expect(note).toHaveText('24 of 25 grouped — number 7 is absent.');
    await shoot(page, 'the note names who is absent', note);
  });

  // #188, AC12: a bad number "re-validates immediately and refuses, rather
  // than failing at Generate". The refusal SENTENCE was asserted in the
  // announcements spec; the refusal ITSELF -- the shuffle being blocked --
  // was not, which a mutation made obvious: `updateGoButton` could have
  // ignored the number fields entirely and every test still passed.
  //
  // The gate has two sources and they live apart. Its roster half is in
  // classroom-groups-roster.spec.ts ('a duplicate number is refused as it is
  // typed', 'a together-and-apart clash is refused as it is typed'); this is
  // the number-field half. They cannot be tested together -- a roster
  // disables these fields outright (AC14) -- so a comment naming the other
  // half is more honest than a describe pretending the fact has one home.
  test('a refused number blocks the shuffle until it is corrected', async ({
    page,
  }) => {
    const go = page.getByRole('button', { name: 'Make groups' });
    await page.goto('/classroom-groups');

    // Enabled FIRST. Disabled is not the default here, but asserting it
    // anyway is what stops "it is disabled" passing against a page where the
    // button never worked at all.
    await expect(go).toBeEnabled();
    await shoot(page, 'Make groups enabled before anything is typed', go);

    await page.fill('#cg-count', '25');
    await page.fill('#cg-numbers-absent', '26');
    await expect(page.locator('#cg-numbers-problem')).toBeVisible();
    await shoot(
      page,
      'number 26 refused in a class of 25',
      page.locator('.number-fields'),
    );
    await expect(go).toBeDisabled();
    await shoot(page, 'Make groups disabled while the refusal stands', go);

    // And the recovery direction, which is the one that proves the gate is
    // not simply stuck shut once it has closed.
    await page.fill('#cg-numbers-absent', '7');
    await expect(page.locator('#cg-numbers-problem')).toBeHidden();
    await shoot(
      page,
      'corrected to 7, the refusal is gone',
      page.locator('.number-fields'),
    );
    await expect(go).toBeEnabled();
    await shoot(page, 'Make groups enabled again', go);
  });

  // #188, AC12, the direction the AC actually names. The guard above types a
  // number the class cannot hold; the AC's subject is the COUNT moving --
  // "lowering the count below a number already typed re-validates immediately
  // and refuses, rather than failing at Generate". Those are different code
  // paths. A refusal on the number field's own keystroke needs only a listener
  // on that field; a refusal when the COUNT changes works solely because the
  // form's `input` listener is delegated and takes no `event.target`
  // (src/scripts/classroom-groups.ts:1098). Keyed to its target, or with
  // `updateNumbersValidation()` dropped from it, the guard above stays green
  // and a teacher learns only at "Make groups" that the number they typed no
  // longer exists. Measured rather than assumed: M18.
  test('lowering the count refuses a number that was valid when it was typed', async ({
    page,
  }) => {
    const go = page.getByRole('button', { name: 'Make groups' });
    const problem = page.locator('#cg-numbers-problem');
    await page.goto('/classroom-groups');

    // Clean FIRST, and by count as well as visibility: `toBeHidden` passes for
    // an element that does not exist, so a renamed id would satisfy this line
    // on its own and leave the refusal below as the only thing asserting.
    await page.fill('#cg-count', '25');
    await page.fill('#cg-numbers-absent', '20');
    await expect(problem).toHaveCount(1);
    await expect(problem).toBeHidden();
    await expect(go).toBeEnabled();
    await shoot(
      page,
      'number 20 absent from a class of 25, accepted',
      page.locator('.number-fields'),
    );

    // The class shrinks underneath it. No click: the refusal has to arrive on
    // the count's own keystroke, which is the whole of AC12.
    await page.fill('#cg-count', '10');
    await expect(problem).toBeVisible();
    await expect(problem).toHaveText(
      'There is no number 20. You have 10 students.',
    );
    await expect(go).toBeDisabled();
    await shoot(
      page,
      'the class shrinks to 10 and number 20 is refused on the keystroke',
      page.locator('.number-fields'),
    );

    // Raising it back clears the refusal, so the gate is not stuck shut once
    // it has closed -- the recovery direction the guard above proves for the
    // other path.
    await page.fill('#cg-count', '25');
    await expect(problem).toBeHidden();
    await expect(go).toBeEnabled();
    await shoot(
      page,
      'raised back to 25, the refusal is gone',
      page.locator('.number-fields'),
    );
  });

  test('splits a class and shows every student exactly once', async ({
    page,
  }) => {
    await page.goto('/classroom-groups');
    await fill(page, { count: '22', size: '4' });
    await page.click('#cg-go');

    // 22 students in groups of 4 => 5 groups.
    await expect(page.locator('#cg-results .group')).toHaveCount(5);
    await expect(page.locator('#cg-results .student')).toHaveCount(22);
    await expect(page.locator('#cg-summary')).toContainText('22');
    await shoot(
      page,
      'five groups holding all 22 students',
      page.locator('#cg-results'),
    );

    // #188, AC13's other half: the note is shown ONLY when fewer were
    // grouped than typed. Counted first, because `toBeHidden` also passes
    // for an element that does not exist at all.
    const note = page.locator('#cg-grouped-note');
    await expect(note).toHaveCount(1);
    await expect(note).toBeHidden();
  });

  test('never makes a group smaller than the size asked for', async ({
    page,
  }) => {
    // The operator's core rule: 7 students in groups of 4 is ONE group of 7,
    // not 4 and 3.
    await page.goto('/classroom-groups');
    await fill(page, { count: '7', size: '4' });
    await page.click('#cg-go');

    await expect(page.locator('#cg-results .group')).toHaveCount(1);
    await expect(page.locator('#cg-results .student')).toHaveCount(7);
    await shoot(
      page,
      'one group of 7, never a 4 and a 3',
      page.locator('#cg-results'),
    );
  });

  test('numbers students since there is no roster to name them from yet', async ({
    page,
  }) => {
    // The paste-names box is gone: it fed `students: string[]`, an input
    // shape the rewritten engine no longer accepts (see grouping.ts's
    // GroupingInput). Numbered students are the only mode there is until a
    // later stage brings a roster back, so this is the default case, not a
    // fallback from something else.
    //
    // Asserts the whole SET of labels, not `.first()`'s: placeBlocks in
    // grouping.ts shuffles block order with the real, unseeded Math.random
    // this page wires in, so which student renders first is never
    // deterministic -- only which four labels appear is. A substring check
    // (`toContainText('Student')`) would also pass for a malformed label
    // like "Student NaN" -- Student.number carries no whole/positive
    // validation on the record path (see the stage-2 ledger) -- so this
    // pins each full sentence, not a fragment of one.
    await page.goto('/classroom-groups');
    await fill(page, { count: '4', size: '2' });
    await page.click('#cg-go');
    const labels = await page.locator('#cg-results .student').allTextContents();
    expect(labels.sort()).toEqual([
      'Student 1',
      'Student 2',
      'Student 3',
      'Student 4',
    ]);
  });

  // Task 8, the locale sweep. studentsHelp used to read "Leave the names box
  // empty to use numbered students." -- the paste-names box it describes was
  // removed by Task 1's engine rewrite (see 'the paste-names box and the
  // keep-apart box are gone' above), so this sentence had been describing a
  // control that no longer exists on the page since stage 2 began. Nothing
  // pinned its literal text before now, so the drift shipped silently.
  // Rewritten to state what is actually true today -- every student this
  // field produces is anonymous and numbered -- matching the exact label
  // 'numbers students since there is no roster to name them from yet' above
  // already proves the results themselves carry ("Student 1", "Student 2",
  // …). Would fail on either the old sentence returning or a typo dropping
  // "numbered"/"anonymous".
  test('the help text under Number of students describes what happens now, not the removed names box', async ({
    page,
  }) => {
    await page.goto('/classroom-groups');
    await expect(page.locator('#cg-count-help')).toHaveText(
      'Students are anonymous and numbered — Student 1, Student 2, and so on.',
    );
  });

  test('results are readable with the animation skipped', async ({ page }) => {
    // The whole accessibility argument: the answer exists as text regardless
    // of whether anyone watched it being dealt.
    await page.goto('/classroom-groups');
    await fill(page, { count: '8', size: '4', speed: 'skip' });
    await page.click('#cg-go');
    await expect(page.locator('#cg-results .student')).toHaveCount(8);
    await expect(page.locator('#cg-results .student').first()).toBeVisible();
  });

  test('the animation deals every card and settles', async ({ page }) => {
    await page.goto('/classroom-groups');
    await fill(page, { count: '6', size: '3', speed: 'fast' });
    await page.click('#cg-go');
    // Auto-retries until the deal finishes — no timing bet.
    await expect(page.locator('#cg-results .student.dealt')).toHaveCount(6);
    await expect(page.locator('#cg-go')).toBeEnabled();
  });

  test('with sound muted, running the animation creates no AudioContext at all', async ({
    page,
  }) => {
    await installAudioContextCounter(page);
    await page.goto('/classroom-groups');
    await fill(page, { count: '6', size: '3', speed: 'fast' });
    // Sound is ON by default (operator decision) -- mute it before the run.
    await page.uncheck('#cg-sound-check');
    await page.click('#cg-go');
    await expect(page.locator('#cg-results .student.dealt')).toHaveCount(6);
    expect(await audioContextCount(page)).toBe(0);
  });

  test('with sound on, two animation runs share exactly one AudioContext', async ({
    page,
  }) => {
    await installAudioContextCounter(page);
    await page.goto('/classroom-groups');
    // Sound stays ON (the default) for this one.
    await fill(page, { count: '4', size: '2', speed: 'fast' });
    await page.click('#cg-go');
    await expect(page.locator('#cg-results .student.dealt')).toHaveCount(4);
    expect(await audioContextCount(page)).toBe(1);

    // Shuffle again -- a second effect run must REUSE the context that
    // already exists, not open a second one.
    await page.click('#cg-go');
    await expect(page.locator('#cg-results .student.dealt')).toHaveCount(4);
    expect(await audioContextCount(page)).toBe(1);
  });

  // Task 9: the operator picked sound set C, six real CC0 files at
  // src/assets/sfx/ (provenance and licence in that directory's own
  // CREDITS.md), imported through Vite in classroom-groups.ts's own "sound"
  // section. The five tests below are what actually protect that: the
  // files really ship and really serve; sound-off and reduced-motion really
  // download nothing (the CLAUDE.md/third-party-requests promise, asserted
  // rather than assumed); sound-on requests really are ours, same-origin;
  // and the tool really keeps working when every one of those requests is
  // blocked -- the one that stands in for a browser that cannot decode AAC.
  // Its own block, and its own fixture. This journey renders NOTHING: it
  // reads bytes out of `dist/` and never navigates, so asking for `page`
  // opened a browser context that recorded ~2 KB of blank frames -- a blank
  // video on a PASSING journey, which a reviewer cannot tell from a capture
  // that failed to start. `request` fetches over an API context and opens no
  // page, so there is no recording to suppress. The block is what lets the
  // evidence page say `not recorded by policy` rather than `recording
  // missing`, since it derives that from the block's own results (#292).
  //
  // NOT `test.use({ video: 'off' })` here: Playwright refuses `video` in a
  // describe outright -- "it forces a new worker" -- and no source-text
  // guard can see that, so a green suite hid it until the spec was run.
  test.describe('the sound assets on disk', () => {
    test('all six sound assets are reachable from the built site and appear in dist/', async ({
      request,
    }) => {
      const files = listM4aFiles(join('dist'));

      for (const role of [
        'shuffle',
        'land-1',
        'land-2',
        'land-3',
        'land-4',
        'done',
      ]) {
        const pattern = new RegExp(`^${role}\\.[\\w-]+\\.m4a$`);
        const matches = files.filter((f) => pattern.test(basename(f)));
        expect(
          matches,
          `expected exactly one built asset for "${role}" in dist/, found: [${matches.join(', ')}]`,
        ).toHaveLength(1);

        const urlPath = distPathToUrlPath(matches[0]);
        const response = await request.get(urlPath);
        expect(
          response.ok(),
          `GET ${urlPath} was not reachable from the built site (status ${response.status()})`,
        ).toBe(true);
        expect((await response.body()).length).toBeGreaterThan(0);
      }
    });
  });

  test('with sound off, a full shuffle fetches no audio at all', async ({
    page,
  }) => {
    await page.goto('/classroom-groups');
    await page.locator('#cg-sound-toggle').click();
    await page.uncheck('#cg-sound-check');

    const seen = recordRequests(page);

    // The reload is what matters: classroom-groups.ts's own "sound asset
    // network prefetch" section reads the REMEMBERED preference at MODULE
    // LOAD time, which only a fresh load (not a same-page uncheck) can
    // exercise -- see that section's own doc comment.
    await page.reload();
    await page.locator('#cg-sound-toggle').click();
    await expect(page.locator('#cg-sound-check')).not.toBeChecked();

    await fill(page, { count: '6', size: '3', speed: 'fast' });
    await page.click('#cg-go');
    await expect(page.locator('#cg-results .student.dealt')).toHaveCount(6);
    seen.expectNone(
      urlMatching(AUDIO_URL_PATTERN),
      'sound off means the assets are never downloaded',
    );
  });

  test('with sound on, the audio requests that happen are exactly ours and same-origin', async ({
    page,
  }) => {
    const seen = recordRequests(page);

    // Sound stays ON (the default) and speed stays 'normal' (not 'skip') --
    // the on-load prefetch trigger fires for all six purely from loading the
    // page, with no form interaction at all.
    await page.goto('/classroom-groups');

    // Polled, not read once. The six `fetch` calls are issued during module
    // evaluation, but their request events reach Node asynchronously over the
    // browser protocol -- reading the array the instant `goto` resolved is
    // exactly what CI caught returning `[]` (run 34391533802). Polling to an
    // exact 6 still fails on five or seven: it waits for the count, it does
    // not accept whatever count has arrived.
    await expect
      .poll(() => seen.matching(urlMatching(AUDIO_URL_PATTERN)).length)
      .toBe(6);
    const pageOrigin = new URL(page.url()).origin;
    for (const url of seen.matching(urlMatching(AUDIO_URL_PATTERN))) {
      // The CLAUDE.md/no-third-party-requests promise, asserted directly --
      // the origin, not just that six requests happened to fire.
      expect(new URL(url).origin).toBe(pageOrigin);
    }
  });

  test.describe('a reduced-motion visitor', () => {
    test('downloads no audio at all', async ({ page }) => {
      const seen = recordRequests(page);

      // `page.emulateMedia`, not `test.use({ reducedMotion: 'reduce' })`:
      // verified by hand that the declarative context option does not
      // reliably reach `window.matchMedia` reads against this project's
      // static, prerendered pages, while this imperative call -- issued
      // before `goto`, same as every other emulateMedia call needs to
      // precede the navigation whose script reads it -- does.
      await page.emulateMedia({ reducedMotion: 'reduce' });
      await page.goto('/classroom-groups');
      // Sound stays ON (untouched, the default) -- speed is forced to
      // 'skip' by classroom-groups.ts's own reduceMotion handling, which
      // predates this task. What is new here: that now also has to mean
      // zero downloads, not just zero sound -- a real bandwidth promise on
      // a phone (see classroom-groups.ts's own "sound asset network
      // prefetch" section).
      await expect(page.locator('#cg-speed')).toHaveValue('skip');
      await page.fill('#cg-count', '6');
      await page.click('#cg-go');
      await expect(page.locator('#cg-results .student')).toHaveCount(6);
      seen.expectNone(
        urlMatching(AUDIO_URL_PATTERN),
        'a reduced-motion visitor downloads no audio at all',
      );
    });

    /**
     * The longest duration in a computed `transition-duration` list, in whole
     * microseconds. Engines write 0.01ms differently (`1e-05s`, `0.00001s`),
     * so it is compared as a number, never as text.
     */
    const longestMicroseconds = (durations: string): number =>
      Math.max(
        ...durations.split(',').map((duration) => {
          const time = /^\s*([\d.e+-]+)(ms|s)\s*$/.exec(duration);
          if (time === null) throw new Error(`not a CSS time: ${duration}`);
          return Math.round(Number(time[1]) * (time[2] === 's' ? 1e6 : 1e3));
        }),
      );

    test('sees every dealt card at rest, with nothing left to move', async ({
      page,
    }) => {
      // The mechanism that works, asserted as itself (#331): tokens.css's
      // reset cuts every transition to 0.01ms, and the script's forced `skip`
      // deals every card at once. The page's scoped <style> once carried a
      // reduced-motion rule for the cards that matched none of them, because
      // the script builds every card and none carries the component's scope.
      await page.emulateMedia({ reducedMotion: 'reduce' });
      await page.goto('/classroom-groups');
      await page.fill('#cg-count', '6');
      await page.click('#cg-go');
      const cards = page.locator('#cg-results .student');
      await expect(cards).toHaveCount(6);
      await expect(page.locator('#cg-results .student.dealt')).toHaveCount(6);

      const atRest = {
        transition: 'at most 0.01ms',
        transform: 'none',
        opacity: '1',
      };
      await expect
        .poll(async () =>
          (
            await cards.evaluateAll((elements) =>
              elements.map((element) => {
                const style = getComputedStyle(element);
                return {
                  duration: style.transitionDuration,
                  transform: style.transform,
                  opacity: style.opacity,
                };
              }),
            )
          ).map(({ duration, transform, opacity }) => ({
            transition:
              longestMicroseconds(duration) <= 10
                ? atRest.transition
                : duration,
            transform,
            opacity,
          })),
        )
        .toEqual(Array(6).fill(atRest));
      await shoot(
        page,
        'every dealt card at rest for a reduced-motion visitor',
        page.locator('#cg-results'),
      );
    });
  });

  test('the fallback plays through a full shuffle when every audio request is blocked', async ({
    page,
  }) => {
    // Simulates both "still downloading" (forever, in this test's case) and
    // "a browser that cannot decode AAC" identically -- classroom-groups.ts's
    // own sampleFor treats a blocked fetch and a rejected decodeAudioData
    // the same way, so proving the fetch-failure branch proves the
    // mechanism both real-world causes fall back through.
    await page.route('**/*.m4a', (route) => route.abort());

    const reported = recordErrors(page);

    await page.goto('/classroom-groups');
    await fill(page, { count: '6', size: '3', speed: 'fast' });
    await page.click('#cg-go');

    // Same assertions "the animation deals every card and settles" already
    // makes for the unblocked case -- the point here is that blocking every
    // audio request changes nothing about this outcome.
    await expect(page.locator('#cg-results .student.dealt')).toHaveCount(6);
    await expect(page.locator('#cg-go')).toBeEnabled();
    // Uncaught only: this test aborts every `.m4a` on purpose, and a blocked
    // request logs to the console by design. What must not happen is a crash.
    await reported.expectNoUncaught(
      'blocking every audio request must not surface as an uncaught error',
    );
  });

  test('splits by number of groups, not just by group size', async ({
    page,
  }) => {
    // The whole second half of the "how to split them" fieldset — reachable
    // from the page, and until now asserted by nothing.
    await page.goto('/classroom-groups');
    await fill(page, { count: '20', groups: '3' });
    await page.click('#cg-go');

    await expect(page.locator('#cg-results .group')).toHaveCount(3);
    await expect(page.locator('#cg-results .student')).toHaveCount(20);
  });

  test('a mis-keyed class size is refused, not attempted', async ({ page }) => {
    // Before the cap this allocated 100 million objects and the tab died —
    // on a phone, taking the browser with it.
    await page.goto('/classroom-groups');
    await fill(page, { count: '100000000', size: '4' });
    await page.click('#cg-go');

    await expect(page.locator('#cg-error')).toHaveText(
      'That is more students than this tool will take. The most is 100.',
    );
    // Still alive and still usable, which is the actual claim.
    await expect(page.locator('#cg-go')).toBeEnabled();
    await expect(page.locator('#cg-results')).toBeHidden();
  });

  test('the summary reads as a sentence, singular included', async ({
    page,
  }) => {
    // The tool's own headline case, and the page has said "1 groups from 7
    // students." since it shipped. The old assertion was toContainText('22')
    // — a bare number, which would also have passed with the arguments the
    // wrong way round.
    await page.goto('/classroom-groups');
    await fill(page, { count: '7', size: '4' });
    await page.click('#cg-go');
    await expect(page.locator('#cg-summary')).toHaveText(
      '1 group from 7 students.',
    );

    await fill(page, { count: '22', size: '4' });
    await page.click('#cg-go');
    await expect(page.locator('#cg-summary')).toHaveText(
      '5 groups from 22 students.',
    );
  });

  test('the error clears the stale "Shuffle again" label', async ({ page }) => {
    await page.goto('/classroom-groups');
    await fill(page, { count: '8', size: '4' });
    await page.click('#cg-go');
    await expect(page.locator('#cg-go')).toHaveText('Shuffle again');

    // Now a refusal. Offering to reshuffle results that are no longer on
    // screen is an offer the page cannot keep.
    await fill(page, { count: '0', size: '4' });
    await page.click('#cg-go');
    await expect(page.locator('#cg-error')).toBeVisible();
    await expect(page.locator('#cg-go')).toHaveText('Make Groups');
  });

  test('the mute choice survives a reload', async ({ page }) => {
    await page.goto('/classroom-groups');
    // Stage 2, Task 7: the checkbox now lives inside #cg-sound-body, and
    // every visit starts with every tool section collapsed (design spec
    // section 11 names only the how-to state and a later print panel as
    // the UI preferences allowed to persist) -- so it has to be reopened
    // after the reload below too, not just before the first check.
    await page.locator('#cg-sound-toggle').click();
    // Sound is ON by default (operator decision).
    await expect(page.locator('#cg-sound-check')).toBeChecked();
    await page.uncheck('#cg-sound-check');
    await page.reload();
    await page.locator('#cg-sound-toggle').click();
    await expect(page.locator('#cg-sound-check')).not.toBeChecked();
  });
});

// Stage 2, Task 5: the class name, and the results heading it optionally
// heads (design spec section 8). "Class name is optional. Blank is fine and
// nothing is blocked... It heads the results: `7B — your groups`... It is
// not repeated on every group card."
test.describe('class name and results heading', () => {
  // Corrected from the uncommitted #9 task brief's own snippet, which located the
  // "not repeated on cards" check at `#cg-groups` -- that id belongs to the
  // "how many groups" NUMBER INPUT on this page, not the results container
  // (`#cg-tables`, where the script actually appends group cards) -- the
  // same class of locator mistake Task 1/Task 2's own ledger entries
  // already record and correct.
  test('the class name heads the results, once', async ({ page }) => {
    await page.goto('/classroom-groups');
    await page.getByLabel('Class (optional)').fill('7B');
    await fill(page, { count: '9', size: '4' });
    await page.click('#cg-go');
    await expect(page.locator('#cg-results-h')).toHaveText('7B — your groups');
    await expect(page.locator('#cg-tables').getByText('7B')).toHaveCount(0);
  });

  // the uncommitted #9 task brief's own count (9 students at the page's default group
  // size, 4) predicted `#cg-groups .group` would have count 3. The engine's
  // own targetSizes (src/lib/grouping.ts) says otherwise: groupCount =
  // floor(9/4) = 2, not ceil -- the same "never smaller than the size you
  // asked for" rule this file already pins above ('never makes a group
  // smaller than the size asked for'). Confirmed against grouping.test.ts's
  // own "Derivation: base = floor(9/4) = 2, remainder = 9 - 8 = 1" comment
  // before writing this, rather than trusting the brief's arithmetic.
  // Honestly: this passes even before #cg-class exists, since it never
  // references the field at all -- confirmed, not assumed, by running it
  // against the untouched page before implementing anything (RED baseline).
  // It is not decoration, though: it pins the exact branch
  // resultsHeadingText takes when nothing was typed, which is the same
  // branch a teacher who never opens the class field exercises on the real
  // page. What would redden it: a bug in that blank check (e.g. reading
  // `classInput.value` before it exists, or comparing against `''` without
  // `.trim()` so a later whitespace-only fix regresses), or the page's own
  // default group size changing out from under the `.toHaveCount(2)` below.
  test('a blank class name blocks nothing', async ({ page }) => {
    await page.goto('/classroom-groups');
    await fill(page, { count: '9', size: '4' });
    await page.click('#cg-go');
    await expect(page.locator('#cg-results-h')).toHaveText('Your groups');
    await expect(page.locator('#cg-results .group')).toHaveCount(2);
    await expect(page.locator('#cg-results .student')).toHaveCount(9);
  });

  // Design spec section 8 says blank "blocks nothing" -- a teacher who
  // fat-fingers the space bar has not typed a name a class would recognise
  // as its own either. Distinct from the never-filled case above: this is
  // the one place the `.trim()` blank-test is proven through the real
  // control, not just the pure function (tests/unit/i18n.test.ts covers
  // resultsHeadingText directly).
  test('a class name of only spaces is treated as no class name', async ({
    page,
  }) => {
    await page.goto('/classroom-groups');
    await page.getByLabel('Class (optional)').fill('   ');
    await fill(page, { count: '9', size: '4' });
    await page.click('#cg-go');
    await expect(page.locator('#cg-results-h')).toHaveText('Your groups');
  });

  // Corrected from the uncommitted #9 task brief's own `#cg-groups .group h3` locator --
  // same mistake as above. Filling the class field first is what makes this
  // a real test of THIS task's own wiring rather than a pin of
  // stage-3-owned behaviour: a naive implementation that broke
  // render()/groupName()'s call order while adding the heading write would
  // show up here. The claim "groups are always numbered" -- i.e. that the
  // theme picker and the naming radio are gone -- was stage 3's own removal
  // (design spec section 3, delivery item 3; landed by Task 8, tested in
  // classroom-groups-controls.spec.ts's "the theme select and the naming
  // radio are gone" / "groups are numbered, always") and is NOT re-tested
  // here; this only pins that setting a class name does not disturb today's
  // numbered DEFAULT.
  test('groups stay numbered when a class name is set', async ({ page }) => {
    await page.goto('/classroom-groups');
    await page.getByLabel('Class (optional)').fill('7B');
    await fill(page, { count: '9', size: '4' });
    await page.click('#cg-go');
    await expect(page.locator('#cg-results .group h3').first()).toHaveText(
      'Group 1',
    );
  });

  // "A teacher's typed text is theirs" -- the class name reaches the DOM
  // through `.textContent`, never `.innerHTML` (classroom-groups.ts), the
  // same rule the results grid already follows for a student's name (see
  // that file's own comment on `who.textContent = label(student)`). Proven
  // by a payload that would look completely different if it were EVER
  // parsed as markup: an `<img>` tag consumed as an element would vanish
  // from the rendered TEXT and its `onerror` would fire (a dialog opening)
  // -- so the exact literal string surviving, with no `<img>` ELEMENT ever
  // created and no dialog raised, is the only way this test can pass.
  test('a class name is rendered literally, HTML metacharacters included', async ({
    page,
  }) => {
    await page.goto('/classroom-groups');
    let dialogFired = false;
    page.on('dialog', (d) => {
      dialogFired = true;
      void d.dismiss();
    });
    const raw = '<img src=x onerror=alert(1)>7B & "Sons"';
    await page.getByLabel('Class (optional)').fill(raw);
    // This test keeps the default class size, so it chooses the speed
    // alone rather than going through fill().
    await chooseSpeed(page, 'skip');
    await page.click('#cg-go');
    await expect(page.locator('#cg-results-h')).toHaveText(
      `${raw} — your groups`,
    );
    await expect(page.locator('#cg-results-h img')).toHaveCount(0);
    expect(dialogFired).toBe(false);
  });

  // Design spec section 9: "The class name is made safe for a filename, and
  // only there... The class name itself is never altered -- not on the
  // page, not in the `# Class:` line, not in the results heading."
  // Filenames are stage 4's own scope, but that line's promise about the
  // results heading is testable now, so it is pinned now rather than left
  // to whichever task builds the filename. A slash is the design doc's own
  // example of a filename-unsafe character (`Year 7 / Set B`).
  test('filename-unsafe characters reach the heading unaltered', async ({
    page,
  }) => {
    await page.goto('/classroom-groups');
    await page.getByLabel('Class (optional)').fill('Year 7 / Set B');
    await chooseSpeed(page, 'skip');
    await page.click('#cg-go');
    await expect(page.locator('#cg-results-h')).toHaveText(
      'Year 7 / Set B — your groups',
    );
  });

  // CLAUDE.md's own rule: no horizontal scroll at >= 320px, in any state. A
  // class name has no length limit (MAX_ROSTER is stage 3's, and governs
  // the roster, not this field), so an unbroken long name is a real input,
  // not a contrived one -- ordinary word-wrapping cannot help a single
  // token with no spaces, which is exactly why this is a genuine check of
  // `#cg-results-h`'s own `overflow-wrap: anywhere` rather than something
  // normal text wrapping would already have covered.
  test(
    'a very long class name does not force the page to scroll sideways',
    { tag: '@emulated-viewport' },
    async ({ page }) => {
      await page.setViewportSize({ width: 320, height: 900 });
      await page.goto('/classroom-groups');
      await page.getByLabel('Class (optional)').fill('x'.repeat(300));
      await chooseSpeed(page, 'skip');
      await page.click('#cg-go');
      await expect(page.locator('#cg-results-h')).toBeVisible();
      await expectNoHorizontalScroll(page);
    },
  );

  // The class name is read fresh at every submit (classroom-groups.ts), not
  // captured once -- a second shuffle with a different name in the field
  // must show the NEW name, not the first one cached. This is about the
  // correctness of THIS task's own wiring, not the staleness/dimming
  // behaviour a later task owns (design spec section 8's "when the class
  // changes after a shuffle") -- nothing here asserts the old groups are
  // marked out of date, only that the heading itself keeps up.
  test('a changed class name is picked up on the next shuffle', async ({
    page,
  }) => {
    await page.goto('/classroom-groups');
    const classField = page.getByLabel('Class (optional)');
    await classField.fill('7B');
    await fill(page, { count: '8', size: '4' });
    await page.click('#cg-go');
    await expect(page.locator('#cg-results-h')).toHaveText('7B — your groups');

    await classField.fill('8C');
    await page.click('#cg-go');
    await expect(page.locator('#cg-results-h')).toHaveText('8C — your groups');
  });
});

// Task 8, the locale sweep. Design spec section 3's "Top row: Class
// (optional) · Students · Split by" -- Stage 2 Tasks 5 and 7 assembled this
// row out of what used to be two separate fieldsets, but every existing
// test that touches the mode radios or #cg-groups does it by CSS `value`
// attribute or by the OTHER field's own label (`groupSizeLabel`), never by
// these fields' own accessible names. modeLabel/modePerGroup/
// modeGroupCount/groupCountLabel had never once been asserted as rendered
// text, in either language -- a wrong or dropped label here would have
// failed nothing.
test.describe('the Split by row names its own fields', () => {
  for (const [path, splitBy, perGroup, groupCountRadio, howMany] of [
    [
      '/classroom-groups',
      'Split by',
      'Students per group',
      'Number of groups',
      'How many groups',
    ],
    [
      '/id/classroom-groups',
      'Bagi berdasarkan',
      'Siswa per kelompok',
      'Jumlah kelompok',
      'Berapa banyak kelompok',
    ],
  ] as const) {
    test(`the fields are correctly labelled (${path})`, async ({ page }) => {
      await page.goto(path);
      // The radiogroup's own name -- an `aria-labelledby` span
      // (`#cg-mode-label`), the same pattern the leftovers radiogroup
      // elsewhere on this page already uses. `#cg-mode-label` targeted
      // directly with `toHaveText` (an EXACT match) rather than
      // `page.getByText(splitBy)`: a mutation spot-check ('Split by' ->
      // 'Split by-ish') proved getByText's default SUBSTRING match cannot
      // catch a suffix tacked onto the real sentence -- it stayed green
      // against the mutant. The sibling leftovers assertions elsewhere in
      // this suite (`getByText('Jika ada siswa tersisa')` and its English
      // counterpart) share that same weakness; out of this task's own
      // scope to rewrite, recorded in task-8-report.md instead.
      await expect(page.locator('#cg-mode-label')).toHaveText(splitBy);
      // { exact: true } on all three: a second mutation spot-check
      // ('Students per group' -> 'Students per group of frogs') proved
      // getByLabel's default match is ALSO substring, not just getByText's
      // -- it resolved the mutated control uniquely and stayed green. Every
      // other getByLabel call in this file (and its siblings) shares that
      // same default; recorded in task-8-report.md rather than swept
      // project-wide, which is well beyond one locale-sweep task.
      await expect(page.getByLabel(perGroup, { exact: true })).toBeVisible();
      // #cg-groups ("How many groups") ships `hidden` until "Number of
      // groups" is chosen -- the same reveal 'splits by number of groups,
      // not just by group size' already exercises by CSS value, exercised
      // here by the radio's own accessible name instead.
      await page.getByLabel(groupCountRadio, { exact: true }).check();
      await expect(page.getByLabel(howMany, { exact: true })).toBeVisible();
    });
  }
});

test.describe('classroom group creator — Bahasa Indonesia', () => {
  test('the Indonesian page is genuinely in Indonesian', async ({ page }) => {
    await page.goto('/id/classroom-groups');
    await expect(page.locator('html')).toHaveAttribute('lang', 'id');
    await expect(page.locator('h1')).toHaveText('Pembuat Kelompok Kelas');
    await expect(page.locator('#cg-go')).toHaveText('Buat Kelompok');
  });

  test('anonymous students are labelled in Indonesian', async ({ page }) => {
    // Same whole-set assertion as the English cover above, for the same
    // reason: render order is genuinely shuffled, and a substring would
    // also pass for a malformed "Siswa NaN".
    await page.goto('/id/classroom-groups');
    await fill(page, { count: '4', size: '2' });
    await page.click('#cg-go');
    const labels = await page.locator('#cg-results .student').allTextContents();
    expect(labels.sort()).toEqual(['Siswa 1', 'Siswa 2', 'Siswa 3', 'Siswa 4']);
    // groupLabel's Indonesian output ("Kelompok N") was only ever proven at
    // the unit level (i18n.test.ts's groupName tests), never against the
    // real page in Indonesian -- the numbered heading every teacher sees
    // (Stage 3, Task 8 made this the ONLY form: the theme picker and the
    // naming radio that used to choose between it and a themed heading are
    // both gone, design spec section 5) had no e2e assertion in Indonesian
    // at all before this test.
    await expect(page.locator('#cg-results .group h3').first()).toHaveText(
      'Kelompok 1',
    );
  });

  test('errors are shown in Indonesian, not English', async ({ page }) => {
    await page.goto('/id/classroom-groups');
    await fill(page, { count: '0', size: '2' });
    await page.click('#cg-go');
    const error = page.locator('#cg-error');
    await expect(error).toBeVisible();
    await expect(error).toContainText('Tambahkan siswa');
  });

  // Task 8, the locale sweep. Mirrors the English 'the help text under
  // Number of students…' test above -- studentsHelp's Indonesian copy
  // described the same removed paste-names box ("Biarkan kotak nama kosong
  // untuk memakai siswa bernomor.") and had no test in either language.
  test('the help text under Jumlah siswa reads in Indonesian, as a whole sentence', async ({
    page,
  }) => {
    await page.goto('/id/classroom-groups');
    await expect(page.locator('#cg-count-help')).toHaveText(
      'Siswa bersifat anonim dan diberi nomor — Siswa 1, Siswa 2, dan seterusnya.',
    );
  });

  // Mirrors the English 'the error clears the stale "Shuffle again" label'
  // test -- `again` ("Acak lagi") had no Indonesian assertion anywhere.
  test('the button relabels to Acak lagi after a shuffle, and back to Buat Kelompok on a refusal', async ({
    page,
  }) => {
    await page.goto('/id/classroom-groups');
    await fill(page, { count: '8', size: '4' });
    await page.click('#cg-go');
    await expect(page.locator('#cg-go')).toHaveText('Acak lagi');

    await fill(page, { count: '0', size: '4' });
    await page.click('#cg-go');
    await expect(page.locator('#cg-error')).toBeVisible();
    await expect(page.locator('#cg-go')).toHaveText('Buat Kelompok');
  });

  // Mirrors the English 'class name and results heading' describe block
  // above -- "assert whole rendered sentences, in both locales" applies
  // regardless of what the uncommitted #9 task brief's own snippet happened to show (it
  // was English-only).
  test('the class name heads the results, once', async ({ page }) => {
    await page.goto('/id/classroom-groups');
    await page.getByLabel('Kelas (opsional)').fill('7B');
    await fill(page, { count: '9', size: '4' });
    await page.click('#cg-go');
    await expect(page.locator('#cg-results-h')).toHaveText(
      '7B — kelompok Anda',
    );
    await expect(page.locator('#cg-tables').getByText('7B')).toHaveCount(0);
  });

  // Same honesty note as the English version above: passes before
  // #cg-class exists too, for the same reason (never references the
  // field), confirmed against the RED baseline rather than assumed.
  test('a blank class name blocks nothing', async ({ page }) => {
    await page.goto('/id/classroom-groups');
    await fill(page, { count: '9', size: '4' });
    await page.click('#cg-go');
    await expect(page.locator('#cg-results-h')).toHaveText('Kelompok Anda');
    await expect(page.locator('#cg-results .group')).toHaveCount(2);
  });
});

// Stage 2, Task 6: staleness (design spec section 8, "When the class
// changes after a shuffle"). task-6-brief.md's own six tests, corrected the
// same way Task 1/Task 2/Task 5's own ledger entries already correct this
// brief's sibling snippets: `getByLabel('How many students?')` matches
// nothing (the real label is "Number of students"), and
// `getByLabel('Students per group')` matches the MODE RADIO ("Students per
// group", `modePerGroup`) rather than the group-size NUMBER FIELD this test
// actually means to change -- that field's own label is "Students in each
// group" (`groupSizeLabel`). Playwright's `.fill()` throws outright on a
// radio input ("Input of type radio cannot be filled"), so the brief's own
// snippet could not have run as written. The leftovers radio also needs its
// section OPENED first: Stage 2, Task 4 rehomed it inside
// `#cg-grouping-body`, which starts collapsed -- the brief's snippet
// predates that move. `#cg-go` is clicked by id throughout, not by
// accessible name: its own label changes to "Shuffle again" after the first
// success (see 'the error clears the stale "Shuffle again" label' above),
// and once results are stale, `#cg-stale`'s own button carries that SAME
// name too -- `getByRole('button', { name: 'Shuffle again' })` would then
// match two elements.
test.describe('out-of-date groups', () => {
  const shuffle = async (page: Page) => {
    await page.getByLabel('Number of students').fill('12');
    await page.click('#cg-go');
    await expect(page.locator('#cg-results .group')).toHaveCount(3);
  };

  test('changing the group size marks them out of date, naming the change', async ({
    page,
  }) => {
    await page.goto('/classroom-groups');
    await shuffle(page);
    await page.getByLabel('Students in each group').fill('3');
    await expect(
      page.getByText('These groups are out of date — the group size changed.'),
    ).toBeVisible();
  });

  test('changing the leftovers choice marks them out of date', async ({
    page,
  }) => {
    await page.goto('/classroom-groups');
    await shuffle(page);
    await page.locator('#cg-grouping-toggle').click();
    await page.getByLabel('Put them all in one group').check();
    await expect(
      page.getByText(
        'These groups are out of date — the leftovers choice changed.',
      ),
    ).toBeVisible();
  });

  // C-1 (review, task 6 fix): #cg-count ("Number of students") is the
  // page's ONLY population control this stage -- there is no roster yet,
  // so changing it is not cosmetic the way the class NAME is (see the very
  // next test): it changes who the groups are actually made FROM. Before
  // this fix, `snapshot()` (classroom-groups.ts) never read it at all, so
  // shuffling 12 into 3 groups and then asking for 30 left the sheet
  // showing three groups built from twelve students with no warning.
  // `readRoster` folds the count into the SAME `roster` field
  // staleness.ts's own Snapshot doc comment reserves for "a student was
  // edited", rather than a parallel mechanism -- reusing `staleRoster`'s
  // existing English ("the class list changed"), which is exactly what
  // changing the count IS at this stage.
  test('changing the number of students marks them out of date, naming the change', async ({
    page,
  }) => {
    await page.goto('/classroom-groups');
    await shuffle(page);
    await page.getByLabel('Number of students').fill('30');
    await expect(
      page.getByText('These groups are out of date — the class list changed.'),
    ).toBeVisible();
  });

  // Pinned in the OTHER direction too, the same reason "undoing the
  // change clears it" exists for group size below: staleness is a
  // comparison against a fresh read of the form, not a flag, so putting
  // the count back needs no code of its own to clear the notice.
  test('undoing the count change clears it', async ({ page }) => {
    await page.goto('/classroom-groups');
    await shuffle(page);
    await page.getByLabel('Number of students').fill('30');
    await page.getByLabel('Number of students').fill('12');
    await expect(page.getByText('out of date')).toHaveCount(0);
  });

  // The brief's own snippet also asserted `#cg-results-h` already read
  // '7B — your groups' at this point. It does not, and confirming that
  // against the RED baseline (before any staleness code existed) is what
  // caught it: the heading is written once, at submit
  // (classroom-groups.ts), and Task 5's own "a changed class name is
  // picked up on the next shuffle" test already covers that timing
  // directly. Typing a class name here does not reshuffle, so asserting a
  // live heading update pins a DIFFERENT, already-false claim that has
  // nothing to do with whether the change also marks the groups stale --
  // which is the one thing this test's own name promises.
  test('the class name does NOT mark them out of date', async ({ page }) => {
    await page.goto('/classroom-groups');
    await shuffle(page);
    await page.getByLabel('Class (optional)').fill('7B');
    await expect(page.getByText('out of date')).toHaveCount(0);
  });

  test('the old groups stay visible while stale', async ({ page }) => {
    await page.goto('/classroom-groups');
    await shuffle(page);
    await page.getByLabel('Students in each group').fill('3');
    await expect(page.locator('#cg-results .group')).toHaveCount(3);
  });

  test('shuffling clears it', async ({ page }) => {
    await page.goto('/classroom-groups');
    await shuffle(page);
    await page.getByLabel('Students in each group').fill('3');
    await page.click('#cg-go');
    await expect(page.getByText('out of date')).toHaveCount(0);
  });

  test('undoing the change clears it', async ({ page }) => {
    await page.goto('/classroom-groups');
    await shuffle(page);
    await page.getByLabel('Students in each group').fill('3');
    await page.getByLabel('Students in each group').fill('4');
    await expect(page.getByText('out of date')).toHaveCount(0);
  });

  // Stage 3, Task 9 (E-05…E-11). Every one of the tests above changes a
  // control in the FORM. These four change the ROSTER, which reaches
  // `Snapshot.roster` by a different path -- `serialiseForCompare`
  // (src/lib/roster.ts) rather than `#cg-count` -- and so is only proven by
  // driving the roster's own controls.
  //
  // Parameterised over the four edits deliberately: each is a separate call
  // site into `setRoster`, and a wiring that forgot one of them would still
  // pass a single hand-picked case. `absent` in particular is the one a
  // reader is most likely to think does not count -- it changes nobody's
  // membership of the list, only who is placed today, which is exactly why
  // it changes who ends up with whom.
  for (const [what, edit] of [
    [
      'marking a student absent',
      (page: Page) =>
        page.locator('.cg-student').first().getByLabel('Absent').check(),
    ],
    [
      'adding a student',
      (page: Page) => page.getByRole('button', { name: 'Add student' }).click(),
    ],
    [
      'removing a student',
      (page: Page) =>
        page
          .locator('.cg-student')
          .first()
          .getByRole('button', { name: 'Remove' })
          .click(),
    ],
    [
      'changing a letter',
      (page: Page) =>
        page
          .locator('.cg-student')
          .first()
          .getByLabel('Together')
          .selectOption('A'),
    ],
  ] as const) {
    test(`${what} marks the groups out of date`, async ({ page }) => {
      await openRoster(page);
      await addSeveral(page, 11);
      await giveEveryoneASex(page);
      await page.getByRole('button', { name: 'Make Groups' }).click();
      await expect(page.locator('#cg-results .group').first()).toBeVisible();
      await edit(page);
      await expect(
        page.getByText(
          'These groups are out of date — the class list changed.',
        ),
      ).toBeVisible();
    });
  }

  // E-07, the MIRROR of "marking a student absent" above, and not a
  // duplicate of it: a wiring that keyed on absence becoming TRUE rather
  // than on the roster changing at all would pass that one and fail this.
  // Who is in today's shuffle changed in both directions.
  test('marking a student present again marks the groups out of date', async ({
    page,
  }) => {
    await openRoster(page);
    await addSeveral(page, 11);
    await page.locator('.cg-student').first().getByLabel('Absent').check();
    await giveEveryoneASex(page);
    await page.getByRole('button', { name: 'Make Groups' }).click();
    await expect(page.locator('#cg-results .group').first()).toBeVisible();
    await page.locator('.cg-student').first().getByLabel('Absent').uncheck();
    await expect(
      page.getByText('These groups are out of date — the class list changed.'),
    ).toBeVisible();
  });

  // E-11. A sex is the one roster field that changes nothing about who can
  // go with whom UNTIL a sex option is on -- but `serialiseForCompare`
  // folds it in unconditionally, so this is stale either way, which is the
  // safe direction. Set up WITH separate mode on, because that is the case
  // the row names and the only one where a reader would expect it to
  // matter.
  test('changing a sex under a sex option marks the groups out of date', async ({
    page,
  }) => {
    await buildRoster(page, [
      ['M'],
      ['M'],
      ['M'],
      ['M'],
      ['F'],
      ['F'],
      ['F'],
      ['F'],
    ]);
    await page.locator('#cg-grouping-toggle').click();
    await page.getByLabel('Keep boys and girls separate').check();
    await giveEveryoneASex(page);
    await page.getByRole('button', { name: 'Make Groups' }).click();
    await expect(page.locator('#cg-results .group').first()).toBeVisible();
    await page
      .locator('.cg-student')
      .first()
      .getByLabel('Sex')
      .selectOption('F');
    await expect(
      page.getByText('These groups are out of date — the class list changed.'),
    ).toBeVisible();
  });

  // The sex SWITCH itself, as opposed to a student's sex: `readSexMode` was
  // a hard-coded `'off'` until Stage 3 Task 9, so `staleReason`'s own
  // `staleSexMode` branch (src/lib/staleness.ts) has existed since stage 2
  // with no way to be reached from the page and no end-to-end test. It is
  // reachable now, and this is that test -- a different SENTENCE from every
  // other case in this block, so a branch that fell through to
  // `staleRoster` would fail it.
  test('turning a sex option on marks the groups out of date, naming the change', async ({
    page,
  }) => {
    await buildRoster(page, [
      ['M'],
      ['M'],
      ['M'],
      ['M'],
      ['F'],
      ['F'],
      ['F'],
      ['F'],
    ]);
    await giveEveryoneASex(page);
    await page.getByRole('button', { name: 'Make Groups' }).click();
    await expect(page.locator('#cg-results .group').first()).toBeVisible();
    await page.locator('#cg-grouping-toggle').click();
    await page.getByLabel('Keep boys and girls separate').check();
    // The literal sentence, not `en.staleSexMode`: importing the locale
    // would make this pass against whatever the table happens to say,
    // including a wrong or untranslated value (CLAUDE.md -- "locale files
    // are a review surface").
    await expect(
      page.getByText(
        'These groups are out of date — how boys and girls are grouped changed.',
      ),
    ).toBeVisible();
  });

  // The counterweight, and the reason `serialiseForCompare` excludes the
  // name at all (see its own doc comment): a teacher typing a name onto a
  // student who was already in the shuffle has not changed who ends up with
  // whom. Asserted in BOTH directions -- no notice, and the new name
  // actually reaching the groups on screen -- because a mutant that simply
  // stopped rendering the roster would satisfy the first half alone.
  test('a rename does not mark the groups out of date', async ({ page }) => {
    await openRoster(page);
    await addSeveral(page, 11);
    await giveEveryoneASex(page);
    await page.getByRole('button', { name: 'Make Groups' }).click();
    await expect(page.locator('#cg-results .group').first()).toBeVisible();
    await page.locator('.cg-student').first().getByLabel('Name').fill('Anna');
    await expect(page.getByText('out of date')).toHaveCount(0);
    // `#cg-results`, NOT `#cg-groups` -- that id belongs to the "number of
    // groups" number input. The same correction this suite has already had
    // to make three times over (see tests/e2e/helpers.ts's own header).
    await expect(page.locator('#cg-results')).toContainText('Anna');
  });

  // None of the six tests above ever has TWO live changes at once -- the
  // whole reason staleReason (src/lib/staleness.ts) is a comparison against
  // a fresh read of the form, rather than a set of flags, is so this stays
  // correct with no extra code: undoing the higher-priority change does not
  // clear the notice, it just changes what the notice SAYS, because the
  // very next recompute finds the leftovers mismatch still live.
  test('when two things change, undoing one still names the other', async ({
    page,
  }) => {
    await page.goto('/classroom-groups');
    await shuffle(page);
    await page.getByLabel('Students in each group').fill('3');
    await page.locator('#cg-grouping-toggle').click();
    await page.getByLabel('Put them all in one group').check();
    await page.getByLabel('Students in each group').fill('4'); // undoes ONLY the size change
    await expect(
      page.getByText(
        'These groups are out of date — the leftovers choice changed.',
      ),
    ).toBeVisible();
    await expect(page.locator('#cg-results')).toHaveClass(/stale/);
  });

  test('when two things change, undoing both clears it', async ({ page }) => {
    await page.goto('/classroom-groups');
    await shuffle(page);
    await page.getByLabel('Students in each group').fill('3');
    await page.locator('#cg-grouping-toggle').click();
    await page.getByLabel('Put them all in one group').check();
    await page.getByLabel('Students in each group').fill('4');
    await page.getByLabel('Share them out evenly').check();
    await expect(page.getByText('out of date')).toHaveCount(0);
    await expect(page.locator('#cg-results')).not.toHaveClass(/stale/);
  });

  // Pins the WHOLE sentence against the notice's own element, not just that
  // SOME element on the page contains this text -- getByText above proves
  // the sentence renders somewhere; this proves it renders exactly here.
  // toHaveText is an EXACT match, unlike getByText's substring default, so
  // a dropped trailing space or a second sentence glued on would fail this
  // without failing the tests above.
  test('the notice element itself carries the exact sentence', async ({
    page,
  }) => {
    await page.goto('/classroom-groups');
    await shuffle(page);
    await page.getByLabel('Students in each group').fill('3');
    await expect(page.locator('#cg-stale-text')).toHaveText(
      'These groups are out of date — the group size changed.',
    );
  });

  // Design spec section 8's own "the way out": the badge is not merely a
  // notice, it is also how a teacher acts on it without scrolling back up
  // to #cg-go. `form="cg-form"` associates the button to the form despite
  // sitting outside it in the DOM -- proven here by getting the SAME
  // reshuffle #cg-go itself would have produced, not by reading the
  // attribute.
  test('the notice offers its own way to reshuffle, without hunting for the main button', async ({
    page,
  }) => {
    await page.goto('/classroom-groups');
    await shuffle(page);
    await page.getByLabel('Students in each group').fill('3');
    await expect(page.locator('#cg-stale')).toBeVisible();
    await page.locator('#cg-stale button').click();
    await expect(page.locator('#cg-stale')).toBeHidden();
    // 12 students at the NEW size (3) => 4 groups. Proves a real reshuffle
    // happened, not merely that the notice hid itself.
    await expect(page.locator('#cg-results .group')).toHaveCount(4);
  });

  // "Dimmed AND badged" (design spec section 8) -- the tests above only
  // ever prove the cards are still PRESENT, never that anything about their
  // appearance actually changed. This is the one that would catch a
  // `.stale` class added to #cg-results with no CSS rule behind it at all.
  test('the old groups are visually dimmed while stale, not merely still present', async ({
    page,
  }) => {
    await page.goto('/classroom-groups');
    await shuffle(page);
    const before = await page
      .locator('#cg-results .group')
      .first()
      .evaluate((el) => getComputedStyle(el).opacity);
    await page.getByLabel('Students in each group').fill('3');
    await expect(page.locator('#cg-results')).toHaveClass(/stale/);
    const after = await page
      .locator('#cg-results .group')
      .first()
      .evaluate((el) => getComputedStyle(el).opacity);
    expect(Number(after)).toBeLessThan(Number(before));
  });

  // C-2 (review, task 6 fix): the test above only proves darker-than-before,
  // which passes at ANY opacity, including one that fails WCAG AA -- it
  // stayed green throughout the bug (opacity: 0.55 measured 3.9:1 against
  // this page's actual background, `--bg`, under the 4.5:1 floor for
  // normal text). This computes the contrast the browser actually PAINTS,
  // from real computed styles read live off the page, using the same
  // relative-luminance formula WCAG 2.1 defines -- not a pinned opacity
  // constant that would drift silently if `--ink`/`--bg` were ever retuned
  // without anyone re-running a contrast checker by hand (tokens.css's own
  // "do NOT lighten past AA" on --accent is why that retuning is a real
  // risk on this page, not a hypothetical one).
  // One test per theme (#419).
  for (const theme of THEMES)
    test(`${theme}: the dim stays above the WCAG AA contrast floor for normal text`, async ({
      page,
    }) => {
      await page.goto('/classroom-groups');
      await shuffle(page);
      await page.getByLabel('Students in each group').fill('3');
      await expect(page.locator('#cg-results')).toHaveClass(/stale/);
      await emulateTheme(page, theme);
      const contrast = await contrastRatio(
        page.locator('#cg-results .group').first(),
      );
      expect(contrast).toBeGreaterThanOrEqual(4.5);
    });

  // #332. The notice paints its own cream ground (#fff6e3) but took its ink
  // from --ink, which Aurora made near-white: 1.05:1, a sentence nobody could
  // read. Scored the way the browser paints it, in the real state, so the
  // ground is the one the sentence actually sits on rather than a token pair.
  for (const theme of THEMES)
    test(`${theme}: the out-of-date sentence meets the WCAG AA contrast floor`, async ({
      page,
    }) => {
      await page.goto('/classroom-groups');
      await shuffle(page);
      await page.getByLabel('Students in each group').fill('3');
      const sentence = page.locator('#cg-stale-text');
      await expect(sentence).toBeVisible();
      await expect(sentence).toHaveText(
        'These groups are out of date — the group size changed.',
      );
      await emulateTheme(page, theme);
      expect(await contrastRatio(sentence)).toBeGreaterThanOrEqual(4.5);
      await shoot(
        page,
        `${theme}: the out-of-date sentence on its cream notice`,
        page.locator('#cg-stale'),
      );
    });

  // CLAUDE.md's binding rules apply to anything this task adds: no
  // horizontal scroll at 320px in any state, and every interactive target
  // is >= 44px. The full sweep across every width and every OTHER state on
  // the page is a later task's own (this task owns staleness, not the
  // no-scroll rule as a whole) -- this defends the one new element this
  // task is actually adding.
  //
  // Every locale (#390 F135): the notice is a sentence naming the change, in
  // each language's own words and widths, and this read English only. The
  // fields go by id, since their labels are each language's own.
  for (const path of localePaths('/classroom-groups'))
    test(
      `the notice fits at 320px with no horizontal scroll, and its button meets the touch-target minimum -- ${path}`,
      { tag: '@emulated-viewport' },
      async ({ page }) => {
        await page.setViewportSize({ width: 320, height: 900 });
        await page.goto(path);
        await page.locator('#cg-count').fill('12');
        await page.click('#cg-go');
        await expect(page.locator('#cg-results .group')).toHaveCount(3);
        await page.locator('#cg-size').fill('3');
        await expect(page.locator('#cg-stale')).toBeVisible();
        await expectNoHorizontalScroll(page, `${path}: the stale notice`);
        await atLeast44(
          page.locator('#cg-stale button'),
          `${path}: the stale notice button`,
        );
      },
    );

  // "Assert whole rendered sentences, in both locales" (CLAUDE.md) -- every
  // test above is English-only, and the reason TEXT itself is
  // locale-varying content (unlike Task 5's own textContent/CSS mechanisms,
  // which are locale-invariant and deliberately not mirrored -- see that
  // task's own note in the 'class name and results heading' describe
  // block above).
  test('the reason reads in Indonesian, as a whole sentence', async ({
    page,
  }) => {
    await page.goto('/id/classroom-groups');
    await page.getByLabel('Jumlah siswa').fill('12');
    await page.click('#cg-go');
    await expect(page.locator('#cg-results .group')).toHaveCount(3);
    await page.getByLabel('Siswa dalam setiap kelompok').fill('3');
    await expect(page.locator('#cg-stale-text')).toHaveText(
      'Kelompok ini sudah tidak berlaku lagi — ukuran kelompok berubah.',
    );
  });

  // Task 8, the locale sweep. Only staleMode (immediately above) had an
  // Indonesian assertion; staleLeftovers and staleRoster are equally
  // reachable today (the leftovers radios and #cg-count both work on this
  // page) but had none. This test also exercises leftoversBunch's own
  // Indonesian LABEL for the first time anywhere in this suite -- every
  // other Indonesian leftovers test reaches the "bunch" radio through its
  // `value` attribute (`input[name="leftovers"][value="bunch"]`), never
  // through `getByLabel`, so a corrupted or deleted
  // "Masukkan semuanya ke satu kelompok" string could not have failed
  // anything before now. `{ exact: true }` because getByLabel's default
  // match is a substring, not a whole string -- see 'the Split by row
  // names its own fields' above for the mutation spot-check that found it.
  test('the leftovers-choice reason reads in Indonesian, as a whole sentence', async ({
    page,
  }) => {
    await page.goto('/id/classroom-groups');
    await page.getByLabel('Jumlah siswa').fill('12');
    await page.click('#cg-go');
    await expect(page.locator('#cg-results .group')).toHaveCount(3);
    await page.locator('#cg-grouping-toggle').click();
    await page
      .getByLabel('Masukkan semuanya ke satu kelompok', { exact: true })
      .check();
    await expect(page.locator('#cg-stale-text')).toHaveText(
      'Kelompok ini sudah tidak berlaku lagi — pilihan siswa tersisa berubah.',
    );
  });

  // Mirrors the English 'changing the number of students marks them out of
  // date' test (C-1 above): the count is this stage's whole roster, so
  // changing it is staleRoster ("the class list changed"), not cosmetic.
  test('the class-list reason reads in Indonesian, as a whole sentence', async ({
    page,
  }) => {
    await page.goto('/id/classroom-groups');
    await page.getByLabel('Jumlah siswa').fill('12');
    await page.click('#cg-go');
    await expect(page.locator('#cg-results .group')).toHaveCount(3);
    await page.getByLabel('Jumlah siswa').fill('30');
    await expect(page.locator('#cg-stale-text')).toHaveText(
      'Kelompok ini sudah tidak berlaku lagi — daftar kelas berubah.',
    );
  });
});

test.describe('site-wide language switching', () => {
  test('the switcher moves between the two versions of the SAME page', async ({
    page,
  }) => {
    // The classic i18n bug is a switcher that dumps you on the homepage.
    // Two steps since #21 Stage 2: the switcher is a <details> dropdown, so the
    // summary opens it and the entry inside is the link.
    const open = () => page.click('header details.lang-switch > summary');
    const choose = () => page.click('header details.lang-switch li a');

    await page.goto('/classroom-groups');
    await open();
    await choose();
    await expect(page).toHaveURL(/\/id\/classroom-groups\/?$/);
    await open();
    await choose();
    await expect(page).toHaveURL(/\/classroom-groups\/?$/);
  });

  // The homepage heading comes from the catalogue, so a headline change
  // (#370) moves this with it; what proves translation is that it is not the
  // English one. The tool's heading is a name, pinned as written.
  for (const [path, heading, english] of [
    [
      '/id/',
      getSiteStrings('id').home.heroHeading,
      getSiteStrings('en').home.heroHeading,
    ],
    ['/id/glory-points', 'Kalkulator Glory Points', 'Glory Points Calculator'],
  ] as const) {
    test(`${path} is translated`, async ({ page }) => {
      expect(heading).not.toBe(english);
      await page.goto(path);
      await expect(page.locator('html')).toHaveAttribute('lang', 'id');
      await expect(page.locator('h1')).toHaveText(heading);
    });
  }

  test('Indonesian nav links stay inside Indonesian — and read as Indonesian', async ({
    page,
  }) => {
    await page.goto('/id/');
    await expect(page.locator('nav a[href="/id/#shytalk"]')).toHaveCount(1);
    // The hrefs were asserted; the WORDS were not. An entirely English nav
    // bar on every Indonesian page passed the whole suite.
    await expect(page.locator('nav a')).toHaveText([
      // "ShyTalk" and "Yawelo Idle" are proper nouns, identical in all five
      // locales by design; 'Alat' and 'Kontak' are what prove this nav is
      // Indonesian.
      'ShyTalk',
      'Yawelo Idle',
      'Alat',
      'Kontak',
    ]);
  });

  // Where the homepage's tool cards link, in every locale, is held by
  // 'exactly two tool cards, each badged and linked in-locale' in
  // homepage.spec.ts (#390 F129).

  test.describe('what each page tells a search engine', () => {
    // Asserted by VALUE. Counting the tags cannot tell the difference between
    // a correct alternate and every page on the site advertising the
    // Indonesian homepage as its translation.
    const SITE = 'https://shyden.co.uk';
    for (const [path, self, other, locale] of [
      ['/', '/', '/id/', 'en_GB'],
      ['/id/', '/id/', '/', 'id_ID'],
      [
        '/classroom-groups',
        '/classroom-groups/',
        '/id/classroom-groups/',
        'en_GB',
      ],
      [
        '/id/classroom-groups',
        '/id/classroom-groups/',
        '/classroom-groups/',
        'id_ID',
      ],
      ['/glory-points', '/glory-points/', '/id/glory-points/', 'en_GB'],
      ['/id/glory-points', '/id/glory-points/', '/glory-points/', 'id_ID'],
    ] as const) {
      test(`${path}`, async ({ page }) => {
        await page.goto(path);
        const isId = locale === 'id_ID';
        await expect(page.locator('link[rel="canonical"]')).toHaveAttribute(
          'href',
          SITE + self,
        );
        await expect(
          page.locator('link[rel="alternate"][hreflang="id"]'),
        ).toHaveAttribute('href', SITE + (isId ? self : other));
        await expect(
          page.locator('link[rel="alternate"][hreflang="en"]'),
        ).toHaveAttribute('href', SITE + (isId ? other : self));
        // English is x-default, the correct convention for the unprefixed
        // locale — and asserted nowhere before this.
        await expect(
          page.locator('link[rel="alternate"][hreflang="x-default"]'),
        ).toHaveAttribute('href', SITE + (isId ? other : self));
        await expect(
          page.locator('meta[property="og:locale"]'),
        ).toHaveAttribute('content', locale);
        await expect(page.locator('meta[property="og:url"]')).toHaveAttribute(
          'content',
          SITE + self,
        );
      });
    }
  });

  // The 404 answering in every language is held by not-found.spec.ts, and its
  // status code by site-meta.spec.ts. An English-and-Indonesian copy titled
  // "in both languages" stood here from before the page served five (#390 F132).
});

// Stage 2, Task 7. Design spec section 2: "The default, collapsed state must
// fit without scrolling on every device, phone included." Section 13: L-01
// through L-09 in docs/superpowers/plans/2026-08-06-classroom-groups-v2-
// test-traceability.md.
//
// L-05 ("no horizontal page scroll at any of those four widths, in any
// state") is NOT re-tested here as a fresh four-width loop -- that would
// duplicate real coverage rather than add any: task-4-brief.md's own Step 3
// already put a "no horizontal scroll at {width}px" sweep (four widths, both
// locales) and a "with Grouping options open" sweep (320/768) into
// classroom-groups-controls.spec.ts's 'classroom groups — mobile-first
// layout' describe block, both explicitly labelled L-05/L-06 in their own
// comment. Two near-identical loops asserting the same fact in two files is
// exactly the shape that lets one drift stale while the other gets fixed
// (the same reasoning this page's own `sectionState`/`resolveStudent`
// functions exist to avoid). This task instead EXTENDS that describe block
// with the two states it does not yet cover -- Sound & animation open (the
// section this task builds) and results on screen (nobody had checked that
// state at all) -- rather than forking a second measurement of the ones it
// already does.
//
// L-06 ("...including with Student details open and a 100-student roster
// loaded") is not testable in this stage: #cg-students-body has no content
// until stage 3 builds the roster table (src/components/pages/
// ClassroomGroupsPage.astro's own comment on why it renders empty).
// Re-homed to stage 3 Task 3, which already opens the roster at 320px --
// recorded here so the traceability row is not silently skipped.
//
// L-07 ("expanding a section is allowed to scroll vertically -- this is not
// a failure") has no dedicated assertion, on purpose: it is the complement
// of L-01..L-04 below, which measure ONLY the collapsed state. Nothing in
// this file asserts vertical fit once a section is open, so opening one and
// getting a taller page cannot redden anything here -- the rule is held by
// what these tests do NOT check, not by a check that would pass no matter
// what happened. Recorded so a reader does not go looking for a test that
// was never meant to exist.
test.describe('the no-scroll rule, measured', () => {
  // Ruling 1 (design spec section 2, "Amended 2026-08-08" -- an operator
  // ruling made after the numbers below were first measured, and corrected
  // again after a code review caught what the first version of this block
  // still got wrong): "fits one screen" means a teacher can see the *Make
  // groups* button without scrolling. That is a POSITION claim, not a
  // height claim. This block used to assert a height instead -- "tool
  // height" (#cg-howto's own top to #cg-go's own bottom) compared to
  // `window.innerHeight` -- and it was wrong in a way that stayed green: at
  // 1280x800 the tool's own height (652px) fits comfortably inside 800px,
  // so the old assertion passed, while `#cg-go` itself rendered at
  // `.bottom === 881`, 81px below the fold. A height number can be
  // satisfied by a tool pushed off-screen; a position cannot. What is
  // asserted below is `#cg-go`'s own `getBoundingClientRect().bottom`
  // against `window.innerHeight`, at scroll 0 -- direct, and it subsumes
  // the old height check rather than replacing it with an unrelated one.
  //
  // Ruling 1 also excludes the site-wide header and footer from the budget
  // this page is judged on -- "a page cannot be held to a budget it does
  // not control", and BaseLayout's <Header>/<Footer> render unconditionally
  // on every page this site has. That exclusion never covered this page's
  // OWN hero: the `h1`/`.lead`/`.privacy` block just above #cg-howto
  // (ClassroomGroupsPage.astro:70-72). This page's own stylesheet sets that
  // block's size and spacing, so it is not page furniture and nothing stops
  // an operator trimming it -- excluding it from the numbers below was
  // never what the ruling said, even though the old "#cg-howto top to
  // #cg-go bottom" span happened to exclude it too, as a side effect of
  // where the span started rather than a decision anyone made about the
  // hero.
  //
  // The position assertion below does not need a "top" to be correct --
  // `#cg-go`'s own bottom, at scroll 0, already reflects everything
  // rendered above it: header, hero and tool alike. But the table further
  // down still reports a page-height figure, for the numbers to mean
  // something to a reader, and that figure now starts at `#main`
  // (BaseLayout.astro) rather than `#cg-howto`. `#main` is the first
  // element below the site header -- it is also the skip-link's own
  // target, BaseLayout.astro's `<a class="skip-link" href="#main">` -- so
  // measuring from it counts the hero and excludes the header, exactly
  // what the ruling asks for. Measured DIRECTLY off real elements' own
  // `getBoundingClientRect()`, never by subtracting an estimated
  // header/footer height from `document.documentElement.scrollHeight` --
  // that subtraction was this block's own earlier approach and left an
  // unexplained ~55-65px residual at every width (see this file's git
  // history); direct measurement is the page's real rendered extent, not a
  // sum of parts chosen by hand.
  //
  // Each width is paired with its OWN real device height (design spec
  // section 2's own measurement table), not a uniform 800px for all four --
  // an iPhone SE is 568px tall, not 800, and a budget that does not exist
  // on the device is not a budget.
  //
  // Ruling 2, same amendment: How to use collapsed by default (reversing
  // section 3's original expanded-by-default) is now the tool's actual
  // landing state for a visitor with JavaScript, so reaching "the collapsed
  // default" needs no click here any more -- the previous version of this
  // loop clicked "How to use" first because collapsing it was the only way
  // to reach a state the page did not start in. (A visitor WITHOUT
  // JavaScript sees it open instead, by design -- ClassroomGroupsPage.astro's
  // own comment on `#cg-howto-body` has that reasoning. It does not change
  // what this block measures: every project this suite runs under has
  // JavaScript enabled.)
  //
  // Measured #main-to-#cg-go, the collapsed landing state, honestly.
  //
  // RE-MEASURED FOR #32, by running the page -- not carried forward. Two of
  // the four rows in the table this replaces were already stale when #32 was
  // picked up: it claimed 707px at both 768 and 1280 where the page actually
  // renders 761px, and "93px to spare" at 1280x800 where the real headroom
  // is 39px. Verified by rebuilding this file's own `git HEAD` version and
  // measuring that, so the difference is the old table's and not the fix's.
  // It is the same failure #32 exists to close -- a hand-maintained table
  // nobody re-executes -- which is why the seam test below re-checks the
  // mechanism on every run instead of trusting prose.
  //
  //   width x height   #cg-form   #cg-go.bottom      budget   vs budget
  //   320x568           769px     1221px -> 556px     568px   653 OVER -> 12 spare
  //   375x667           768px     1191px -> 655px     667px   524 OVER -> 12 spare
  //   768x1024          488px      761px (unchanged) 1024px   263 to spare
  //   1280x800          488px      761px (unchanged)  800px    39 to spare
  //
  // The `#cg-form` column is why this was never a matter of trimming the
  // hero. At 320 the form ALONE measures 769px against a 568px budget, and
  // at 375 it is 768px against 667px -- so deleting the site header, the h1,
  // the lead paragraph and the privacy note outright would STILL have left
  // the submit button below the fold at both phone sizes. Nothing above the
  // form was ever the thing standing in the way.
  //
  // The fix is in ClassroomGroupsPage.astro, under `@media screen`:
  // `.actions` becomes `position: sticky; bottom: 0`, so the submit button
  // rests ON the fold and the form scrolls behind it. The 12px of clearance
  // at both phone sizes is the bar's own bottom padding -- measured, so this
  // is not passing on an exact tie.
  //
  // EVERY WIDTH since #188, not just below 600px. Read the table above
  // again: 1280x800 had THIRTY-NINE pixels to spare, which was a measurement
  // of how much room that size happened to have, never a design decision.
  // #188's three number fields cost 116px, and `#cg-go`'s bottom measured
  // 912 against a budget of 800 -- 112px under the fold. The operator's call
  // (2026-09-16) was to pin the bar at every width rather than squeeze the
  // fields, so one mechanism carries all four sizes instead of two that
  // would have to be kept in step.
  //
  // WHAT THIS ASSERTS, AND WHAT IT DOES NOT. `#cg-go` is REACHABLE without
  // scrolling at all four sizes, which is what the title says. At none of
  // them does the whole tool necessarily fit: the form scrolls behind a
  // pinned action row. A sticky bar makes the action reachable, it does not
  // make the page short. The title changed WITH the fix rather than being
  // left behind to describe a page that no longer exists -- and the "at 768
  // and 1280 the whole tool fits as well" sentence that used to sit here
  // went with it, for exactly the same reason.
  const VIEWPORTS = [
    { width: 320, height: 568 }, // iPhone SE
    { width: 375, height: 667 }, // iPhone 8
    { width: 768, height: 1024 }, // iPad
    { width: 1280, height: 800 }, // laptop
  ];

  const measureFit = async (page: Page, path = '/classroom-groups') => {
    await page.goto(path);
    await page.evaluate(() => document.fonts.ready);
    const { bottom, budget } = await page.evaluate(() => ({
      bottom: document.getElementById('cg-go')!.getBoundingClientRect().bottom,
      budget: window.innerHeight,
    }));
    // Compared RAW and rounded only for the reader: rounding first let a
    // button 0.4px under the fold read as above it (#371, #390 F114).
    expect(
      bottom,
      `#cg-go's bottom at ${bottom.toFixed(1)}px against a ${budget}px fold`,
    ).toBeLessThanOrEqual(budget);
  };

  // No `fits` flag and no if/else any more -- every viewport runs as `test`.
  // The flag existed only to choose `test.fixme` for the sizes that failed,
  // and #32 removed the last two of those; a flag with one possible value is
  // dead weight, and the branch it fed is precisely what made "tracked, not
  // hidden" assertable without being true. `test(` is still written
  // literally, with its title inline as a template literal rather than
  // hoisted to a variable, because tests/unit/viewport-tagging.test.ts scans
  // source text for exactly that shape and is blind to a title passed by
  // reference or reached through an aliased callee.
  for (const { width, height } of VIEWPORTS) {
    test(
      `the primary action is reachable without scrolling at ${width}x${height}`,
      { tag: '@emulated-viewport' },
      async ({ page }) => {
        await page.setViewportSize({ width, height });
        await measureFit(page);
      },
    );
  }

  // EVERY LOCALE, since #384. The loop above only ever measured English, and
  // copy length is exactly what moves the fold: on develop before #384,
  // /id/ put `#cg-go` 27px and /vi/ 111px below the fold at 320x568 with
  // every test green. Swapping the lead for the longer who-and-why paragraph
  // then pushed English (+33px) and Thai (+55px) over too. Derived from
  // LOCALES, so a sixth language is measured the day it is added.
  for (const locale of LOCALES.filter((l) => l !== DEFAULT_LOCALE)) {
    for (const { width, height } of VIEWPORTS) {
      test(
        `/${locale}/: the primary action is reachable without scrolling at ${width}x${height}`,
        { tag: '@emulated-viewport' },
        async ({ page }) => {
          await page.setViewportSize({ width, height });
          await measureFit(page, localisePath('/classroom-groups', locale));
        },
      );
    }
  }

  // ASSERT THE SEAM, not the sides. The four tests above measure PIXELS, and
  // pixels cannot say which mechanism is keeping the button on screen: if the
  // sticky rule were deleted, they would report a number that happens to be
  // too large, never the rule that moved.
  //
  // The contract CHANGED in #188 (operator decision, 2026-09-16). It used to
  // be "sticky below 600px, static above it", on the reasoning that 768 and
  // 1280 fit unaided. Three number fields costing 116px ended that -- 1280x800
  // measured 912 against a budget of 800 -- so the bar is now sticky at every
  // width, by one mechanism rather than two kept in step. This test going red
  // is exactly what it is for: the old expectation was a statement about how
  // much room those sizes had, and the page outgrew it.
  //
  // Still asserted at all four sizes rather than one. A rule that quietly
  // stopped applying somewhere in the middle -- a stray `min-width`, a
  // specificity fight with a later block -- would leave the pixel tests
  // passing wherever the page happened to fit anyway.
  // One test per viewport (#419): this spelled the four sizes out by hand,
  // and the two below looped them, under one budget.
  for (const { width, height } of VIEWPORTS)
    test(
      `the action row is sticky at ${width}x${height}, so the primary action is never below the fold`,
      { tag: '@emulated-viewport' },
      async ({ page }) => {
        await page.setViewportSize({ width, height });
        await page.goto('/classroom-groups');
        const position = await page.evaluate(
          () =>
            getComputedStyle(
              document.getElementById('cg-go')!.closest('.actions')!,
            ).position,
        );
        expect(position).toBe('sticky');
        await shoot(page, `${width}x${height}, the action row is sticky`);
      },
    );

  // The bar's COMPANION rule, which had no test at all until #188.
  // `scroll-padding-bottom` on `html` exists for one reason: to stop the
  // browser scrolling a tabbed-to field, an anchor or a `scrollIntoView`
  // target to a position the pinned action row covers. Both rules were
  // capped at `max-width: 599px`; the bar moved to every width and nothing
  // in this suite would have noticed the padding staying behind, because
  // nothing asserted the padding at all.
  //
  // Asserted as a SEAM, not as a number. What matters is that the padding
  // clears the row as the row ACTUALLY measures, not that it reads `5rem`:
  // pinning the literal would go on passing if the bar grew and the padding
  // did not, which is the one failure this rule exists to prevent, and it
  // would restate a value that already has a home in the stylesheet.
  for (const { width, height } of VIEWPORTS)
    test(
      `the scroll padding clears the pinned action row at ${width}x${height}`,
      { tag: '@emulated-viewport' },
      async ({ page }) => {
        await page.setViewportSize({ width, height });
        await page.goto('/classroom-groups');
        const { padding, bar } = await page.evaluate(() => ({
          padding: parseFloat(
            getComputedStyle(document.documentElement).scrollPaddingBottom,
          ),
          bar: document
            .getElementById('cg-go')!
            .closest('.actions')!
            .getBoundingClientRect().height,
        }));
        // Liveness: a renamed class or a missing row would measure 0, and
        // every padding value would then clear it.
        expect(
          bar,
          'the action row must have a height to clear',
        ).toBeGreaterThan(0);
        expect(
          padding,
          'scroll padding must clear the pinned bar',
        ).toBeGreaterThanOrEqual(bar);
      },
    );

  // #188, operator decision 2026-09-17. Pinned at every width, the row
  // covers the edge of whatever sits above it before any scrolling -- at
  // 1280x900, the bottom of "Sound and animation". A soft shadow cast UP over
  // that edge makes it read as passing under a docked bar rather than as
  // clipped. Asserted as the property that does that work -- visible, soft,
  // offset upward -- because a pinned literal would go on passing with the
  // offset flipped below the row, off the fold where nobody sees it.
  for (const { width, height } of VIEWPORTS)
    test(
      `the pinned action row casts a soft shadow upward at ${width}x${height}`,
      { tag: '@emulated-viewport' },
      async ({ page }) => {
        await page.setViewportSize({ width, height });
        await page.goto('/classroom-groups');
        const shadow = await page.evaluate(
          () =>
            getComputedStyle(
              document.getElementById('cg-go')!.closest('.actions')!,
            ).boxShadow,
        );
        // A computed shadow serialises colour first, then lengths:
        // `rgba(0, 0, 0, 0.55) 0px -12px 24px -8px`.
        const parts =
          /^(rgba?\([^)]*\)) (-?[\d.]+)px (-?[\d.]+)px ([\d.]+)px/.exec(shadow);
        expect(
          parts,
          `${width}x${height}: the pinned row has a shadow (computed: ${shadow})`,
        ).not.toBeNull();
        const [, colour, , offsetY, blur] = parts!;
        expect(Number(offsetY), `${width}x${height}: cast upward`).toBeLessThan(
          0,
        );
        expect(
          Number(blur),
          `${width}x${height}: soft, not a hard line`,
        ).toBeGreaterThan(0);
        expect(colour, `${width}x${height}: not transparent`).not.toMatch(
          /, 0\)$/,
        );
        await shoot(
          page,
          `${width}x${height}, the row casts its shadow upward`,
        );
      },
    );

  // L-08. The brief's own literal query measured only what page LOAD
  // already shows -- nothing inside any of the four sections is on screen
  // until its own toggle is clicked, so a control that shipped at 30px
  // inside a collapsed body could never appear in `small`, no matter how
  // broken it was ("every interactive target" would have meant "every
  // interactive target visible before a teacher does anything"). Opening
  // every section first closes that gap, and makes this test
  // forward-compatible with stage 3/4 filling #cg-students-body/
  // #cg-io-body: whatever they add is already inside the loop that opens
  // every section, with no second sweep to remember to write.
  //
  // This does not replace the narrower 44px tests already in
  // classroom-groups-controls.spec.ts ('every control meets the 44px touch
  // target', 'the two sex switches meet the 44px touch target once open')
  // -- those exist to prove specific controls stay correct in isolation,
  // scoped so a move or a rename would be caught even if this broader sweep
  // somehow was not. This is the comprehensive gate the brief itself asks
  // for, sized to catch anything the narrower ones do not happen to cover.
  //
  // 320px only, not all four widths: every control on this page sizes off
  // `min-height`/`min-width` (fixed rem/px values -- see
  // ClassroomGroupsPage.astro's own styles) or `width: 100%` of its own
  // grid column, never off the viewport directly, and the >=768px grid only
  // changes how many COLUMNS sit side by side, not each column's own
  // min-height. Nothing on this page can be SMALLER at a wider viewport
  // than it is at the narrowest one, so 320px is the one width that can
  // actually catch a regression.
  // A native radio or checkbox on this page is deliberately drawn small
  // (`.radios input, .switch input { width/height: 1.15rem }` in
  // ClassroomGroupsPage.astro's own styles) -- its real tap target is the
  // `<label>` wrapping it, which carries the 44px `min-height`
  // (`.radios label, .switch { min-height: 44px }`), the same
  // whole-row-is-the-target pattern 'the two sex switches meet the 44px
  // touch target once open' (classroom-groups-controls.spec.ts) already
  // measures by calling `.closest('label')` rather than reading the input's
  // own rect. Measuring the bare `<input>` here at first found NINE
  // "failures" -- all six radios (mode/naming/leftovers) plus both sex
  // switches plus the new #cg-sound-check -- none of them a real defect,
  // every one of them a correctly-sized label wrapping a deliberately small
  // glyph. This walk now measures the SAME element a real tap would land
  // on: the label for a radio/checkbox, the element itself for everything
  // else. It can still fail for real: any control whose min-height/padding
  // regresses below 44px, radio/checkbox label included, still shows up.
  //
  // Every locale (#423): every control on the page holds the page's own copy.
  for (const path of localePaths('/classroom-groups'))
    test(
      `every interactive target is at least 44px, collapsed and with every section open -- ${path}`,
      { tag: '@emulated-viewport' },
      async ({ page }) => {
        await page.setViewportSize({ width: 320, height: 900 });
        await page.goto(path);
        for (const id of ['cg-students', 'cg-grouping', 'cg-io', 'cg-sound']) {
          await page.locator(`#${id}-toggle`).click();
        }
        // Every target on screen is measured; the ones too small are the
        // verdict, the ones measured are its population (#610).
        const { measured, small } = await page.evaluate(() => {
          const targets = [
            ...document.querySelectorAll(
              'button, input, select, textarea, summary, a',
            ),
          ]
            // Not the report form's honeypot, which no person is meant to
            // reach: it sits under `aria-hidden` with `tabindex="-1"`, the
            // same exclusion tests/typed-fields.ts makes. It is in every
            // locale but English, so only the per-locale cases met it (#423).
            .filter((el) => !el.closest('[aria-hidden="true"]'))
            .map((el) => {
              const isBoxControl =
                el instanceof HTMLInputElement &&
                (el.type === 'radio' || el.type === 'checkbox');
              const target = isBoxControl ? (el.closest('label') ?? el) : el;
              return {
                tag: el.tagName,
                id: el.id,
                r: target.getBoundingClientRect(),
              };
            })
            .filter(({ r }) => r.width > 0);
          const name = ({ tag, id }: { tag: string; id: string }) =>
            `${tag}#${id}`;
          return {
            measured: targets.map(name),
            small: targets
              .filter(({ r }) => r.height < 44 || r.width < 44)
              .map(name),
          };
        });
        expect(
          searched(small, {
            of: measured,
            what: 'interactive targets on screen with every section open',
          }),
        ).toEqual([]);
        expect(
          floorBreach(
            // English carries one footer link; every beta language also
            // carries the report form's fields, so the two read differently.
            path === '/classroom-groups'
              ? 'classroom-groups/interactive-targets-en'
              : 'classroom-groups/interactive-targets-beta',
            measured.length,
          ),
        ).toBeUndefined();
      },
    );

  // L-09. The accent colour is the AA floor by design ("never lighten
  // without re-checking contrast", CLAUDE.md) -- this computes the REAL
  // painted contrast of the one button styled with it, the same
  // relative-luminance formula the 'the dim stays above the WCAG AA
  // contrast floor for normal text' test above already uses, rather than
  // pinning the hex value. A pinned hex would only prove the STRING did not
  // change, not what it renders as -- it would stay green even if
  // `--accent`/`--bg` in tokens.css were retuned to something that fails
  // AA. What would redden this: those custom properties moving closer
  // together, or `.actions button`'s own background/color rules drifting
  // from the variables entirely.
  for (const theme of THEMES)
    test(`${theme}: the accent colour still meets the WCAG AA contrast floor`, async ({
      page,
    }) => {
      await page.goto('/classroom-groups');
      await emulateTheme(page, theme);
      const contrast = await contrastRatio(page.locator('#cg-go'));
      expect(contrast).toBeGreaterThanOrEqual(4.5);
    });

  // M-11. The one test in this file that never touches /classroom-groups --
  // CLAUDE.md's promise about what the homepage ships (one script, the theme
  // script, since #142) is site-wide, and this task's own work could put it
  // at risk only by accident (a shared layout partial, a global script tag),
  // so it earns a direct check rather than an inference.
  test('the homepage ships the theme script and nothing else', async ({
    page,
  }) => {
    // Rewritten for #142. The promise was "the homepage ships zero JS"; it
    // now ships exactly one script, the inline theme script, so this pins
    // what may exist rather than counting to zero. Two measurements still,
    // because a request recorder cannot see an inline script at all (#79):
    // the DOM says what is on the page, and the recorder that nothing was
    // fetched to run. theme-script.spec.ts pins the same on every page.
    const seen = recordRequests(page);
    await page.goto('/');
    const scripts = await page.evaluate(() =>
      [...document.scripts].map((script) => ({
        src: script.getAttribute('src') ?? '',
        text: script.textContent ?? '',
      })),
    );
    expect(scripts, 'the homepage carries the theme script alone').toEqual([
      { src: '', text: THEME_SCRIPT_SOURCE },
    ]);
    seen.expectNone(
      ({ resourceType }) => resourceType === 'script',
      'the homepage fetches no script',
    );
  });
});

/**
 * Every language the page is served in renders its OWN messages (#136).
 *
 * The ticket's defect, in the medium it was reported in: the 51 parameterised
 * messages were English functions that zh, vi and th took by reference, so a
 * Chinese page numbered its groups "Group 1". The unit guards hold each
 * catalogue to English's structure; only a render proves the page reads the
 * catalogue of the language it is served in. Derived from LOCALES, with every
 * expectation taken from that locale's own table, so a sixth language is
 * covered the day it is added. The Indonesian pins above stay: a pin catches a
 * wrong catalogue value that this comparison would agree with.
 *
 * One of each shape a message takes: a slot (a student's number, a group's),
 * a plural (the summary), a refusal carrying a value, and a list (the roster's
 * missing-sex problem, joined by the browser's own `Intl.ListFormat`).
 */
test.describe('every language renders its own messages', () => {
  for (const locale of LOCALES) {
    test(`${locale}: numbers, groups, a summary, a refusal and a list`, async ({
      page,
    }) => {
      const t = getStrings(locale);
      const english = getStrings(DEFAULT_LOCALE);
      const path = localisePath('/classroom-groups', locale);
      /** What English would have said in its place -- the fallback removed. */
      const notEnglish = (own: string, inEnglish: string) => {
        if (locale !== DEFAULT_LOCALE) expect(own).not.toBe(inEnglish);
      };

      await page.goto(path);
      await fill(page, { count: '4', size: '2' });
      await page.click('#cg-go');
      const labels = await page
        .locator('#cg-results .student')
        .allTextContents();
      expect(labels.sort()).toEqual(
        [1, 2, 3, 4].map((n) => t.studentNumber({ n })).sort(),
      );
      notEnglish(t.studentNumber({ n: 1 }), english.studentNumber({ n: 1 }));
      await expect(page.locator('#cg-results .group h3').first()).toHaveText(
        t.groupLabel({ n: 1 }),
      );
      notEnglish(t.groupLabel({ n: 1 }), english.groupLabel({ n: 1 }));
      await shoot(
        page,
        'students and groups are numbered in the page language',
        page.locator('#cg-results'),
      );

      const summary = t.resultsSummary({ groups: 2, students: 4 });
      await expect(page.locator('#cg-summary')).toHaveText(summary);
      notEnglish(summary, english.resultsSummary({ groups: 2, students: 4 }));
      await shoot(
        page,
        'the summary counts in the page language',
        page.locator('#cg-summary'),
      );

      await fill(page, { count: '100000000', size: '4' });
      await page.click('#cg-go');
      const refusal = t.errors.TOO_MANY_STUDENTS({ max: 100 });
      await expect(page.locator('#cg-error')).toHaveText(refusal);
      notEnglish(refusal, english.errors.TOO_MANY_STUDENTS({ max: 100 }));
      await shoot(
        page,
        'a refusal carries its value in the page language',
        page.locator('#cg-error'),
      );

      await page.goto(path);
      await page.locator('#cg-students-toggle').click();
      const add = page.getByRole('button', {
        name: t.rosterAddStudent.replace(/^[+\s]+/, ''),
      });
      await add.click();
      await add.click();
      await expect(page.locator('.cg-student')).toHaveCount(2);
      const names = [t.studentNumber({ n: 1 }), t.studentNumber({ n: 2 })];
      const problem = await listedByThisBrowser(
        page,
        locale,
        names,
        t.rosterNoSexMessage({ names }),
      );
      await expect(page.locator('#cg-roster-problem')).toHaveText(problem);
      notEnglish(
        problem,
        english.rosterNoSexMessage({
          names: [
            english.studentNumber({ n: 1 }),
            english.studentNumber({ n: 2 }),
          ],
        }),
      );
      await shoot(
        page,
        'a list of students is joined in the page language',
        page.locator('#cg-roster-problem'),
      );
    });
  }
});

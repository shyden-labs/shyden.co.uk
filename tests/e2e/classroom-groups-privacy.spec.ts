import { chooseOption } from '../real-select';
import { setCheckedOn, tapOn } from '../real-touch';
import { typeInto } from '../real-typing';
import { test, expect } from './fixtures';
import { makeGroups } from '../make-groups';
import { LOCALES, getStrings, localisePath } from '../../src/lib/i18n';
import { searched } from '../source-files';
import { recorded, shoot } from './evidence';
import { recordErrors } from './recorders';
import {
  buildRoster,
  buildRosterAtPath,
  expectNothingStored,
  upload,
  downloadName,
  giveEveryoneASex,
  handoverTo,
} from './helpers';

test.use(recorded);

/** The two pupils every probe in this file looks for. */
const ROSTER_NAMES = ['Ana', 'Budi'] as const;

/**
 * The page makes a promise in both languages: "No class list ever leaves this
 * page." These tests are that promise, written down.
 *
 * The threat is not an attacker — it is the form working exactly as HTML says
 * it should. A <form> with no action submits to its OWN url as a GET, so any
 * control carrying a `name` puts its value in the address bar, the browser's
 * history and the server's access log. That happens whenever the submit
 * listener is not attached, which is a real state: JavaScript blocked by a
 * school filter, a 404'd bundle after a partial deploy, or a top-level throw
 * before the listener registers.
 *
 * So the door is closed at the markup: no control holding anything a teacher
 * typed carries a `name` at all. The radio groups keep theirs because `name`
 * is what makes a radio group a group — but "students per group" is not
 * personal data.
 */

/**
 * `name`s that may legitimately appear in a submitted form.
 *
 * Stage 3, Task 8 removed `naming` -- the radio choosing "Group 1, 2, 3…"
 * versus "Use a theme" -- along with the theme picker it revealed (design
 * spec section 5). Groups are always numbered now, so there is nothing
 * left for a radio group of that name to choose between.
 */
const NON_PERSONAL_NAMES = ['mode', 'leftovers'];

// #188, AC19. Absence is a per-day fact: number 7 being away today says
// nothing about tomorrow, so remembering it would quietly group a present
// child out of the lesson. The decision was session-only (operator,
// 2026-09-16), and this is that decision written down.
test.describe('privacy — the number fields are forgotten on reload', () => {
  test('nothing a teacher types into the three fields survives a reload', async ({
    page,
  }) => {
    await page.goto('/classroom-groups');
    await typeInto(page.locator('#cg-count'), '25');
    await typeInto(page.locator('#cg-numbers-absent'), '7, 12');
    await typeInto(page.locator('#cg-numbers-together'), '3,9');
    await typeInto(page.locator('#cg-numbers-apart'), '2,5');

    // THE POSITIVE CONTROL, and the whole reason this test means anything.
    // Empty is the DEFAULT state of these fields, so "reload, then find them
    // empty" passes just as well against a page that never stored anything
    // AND against one where the fill silently failed -- the same vacuity the
    // controls spec calls out for "collapse it, reload, still collapsed".
    // Proving they held the values immediately before the reload is what
    // makes the emptiness afterwards a fact about persistence.
    await expect(page.locator('#cg-numbers-absent')).toHaveValue('7, 12');
    await expect(page.locator('#cg-numbers-together')).toHaveValue('3,9');
    await expect(page.locator('#cg-numbers-apart')).toHaveValue('2,5');
    await shoot(
      page,
      'all three fields hold what was typed',
      page.locator('.number-fields'),
    );

    await page.reload();

    await expect(page.locator('#cg-numbers-absent')).toHaveValue('');
    await expect(page.locator('#cg-numbers-together')).toHaveValue('');
    await expect(page.locator('#cg-numbers-apart')).toHaveValue('');
    await shoot(
      page,
      'all three fields empty after a reload',
      page.locator('.number-fields'),
    );
  });

  test('and nothing about them is written to storage', async ({ page }) => {
    await page.goto('/classroom-groups');
    await typeInto(page.locator('#cg-count'), '25');
    await typeInto(page.locator('#cg-numbers-absent'), '7, 12');
    await expect(page.locator('#cg-numbers-absent')).toHaveValue('7, 12');

    // The positive control has to CREATE something first. This page writes
    // exactly ONE key, and only when the sound toggle changes, so on a fresh
    // load both stores are empty -- and "nothing mentions what was typed"
    // would then pass for the emptiest possible reason, against a page whose
    // script never ran at all. The first version of this test named
    // `cg-sound` as its control in a comment and never asserted it: a
    // comment is not a control.
    await tapOn(page.locator('#cg-sound-toggle'));
    await setCheckedOn(page.locator('#cg-sound-check'), false);

    // The WHOLE of both stores, not a probe for a key name this test
    // invented: a guessed key would pass against any implementation that
    // chose a different one.
    const stored = await page.evaluate(() => {
      const dump = (store: Storage) =>
        Object.keys(store).map((key) => `${key}=${store.getItem(key) ?? ''}`);
      return [...dump(localStorage), ...dump(sessionStorage)];
    });
    expect(
      stored.filter((entry) => entry.startsWith('cg-sound=')),
    ).toHaveLength(1);

    // The population sits INSIDE the assertion (#118), so an empty `stored`
    // cannot make this pass by leaving nothing to search. `absence-liveness`
    // cannot see this site at all -- a value derived from `page.evaluate` is
    // the blind spot #185 is open about -- so the idiom is here by choice,
    // not because a guard insisted.
    // `12` on its own rather than the text as typed: a page that parsed the
    // field and stored `[7,12]` leaks exactly what one storing `7, 12` does,
    // and every serialisation of that absence contains it.
    const leaked = stored.filter((entry) => entry.includes('12'));
    expect(
      searched(leaked, { of: stored, what: 'browser storage entries' }),
    ).toEqual([]);
  });
});

test.describe('privacy — the class list cannot leave the page', () => {
  // Derived from LOCALES, not written out. This was `en` and `id` — correct
  // when those were the only two locales, and silently wrong from #22, which
  // shipped five. The page's own header says the promise is made "in both
  // languages"; it is made in five, and each is a separately generated page
  // off the `[locale]` route, so a template divergence in one is exactly the
  // failure #49 proved can go unnoticed (#73).
  for (const path of LOCALES.map((locale) =>
    localisePath('/classroom-groups', locale),
  )) {
    test(`${path}: no control holding typed text is submittable`, async ({
      page,
    }) => {
      await page.goto(path);

      // Every named control in the form, by tag and type.
      const named = await page.locator('#cg-form [name]').evaluateAll((els) =>
        els.map((el) => ({
          name: el.getAttribute('name'),
          type: (el as HTMLInputElement).type,
        })),
      );

      // A `name` on anything but a radio is a leak waiting for a broken
      // script. This fails the moment someone adds one back.
      //
      // The separate `named.length > 0` this replaces was the convention #84
      // moved away from: a control a call site can forget. The population now
      // sits in the assertion, and `radioNames` below independently fails on
      // an empty form.
      const leaky = named.filter((c) => c.type !== 'radio');
      expect(
        searched(leaky, { of: named, what: 'named form controls' }),
      ).toEqual([]);

      const radioNames = [...new Set(named.map((c) => c.name))].sort();
      expect(radioNames).toEqual([...NON_PERSONAL_NAMES].sort());
    });
  }
});

test.describe('privacy — with JavaScript blocked', () => {
  test.use({ javaScriptEnabled: false });

  for (const [path, notice] of [
    ['/classroom-groups', 'This tool needs JavaScript enabled.'],
    ['/id/classroom-groups', 'Alat ini memerlukan JavaScript yang aktif.'],
  ] as const) {
    test(
      `${path}: says so, in its own language`,
      { tag: '@javascript-blocked' },
      async ({ page }) => {
        await page.goto(path);
        // Not "a noscript tag exists" — the sentence a visitor actually reads.
        await expect(page.locator('#cg-noscript')).toHaveText(notice);
      },
    );
  }

  // Code review on this task (I-3): `#cg-howto-body` used to ship `hidden`
  // in the raw markup, which meant a visitor without JavaScript got the
  // heading, the lead and the privacy line, and a dead `▸ How to use`
  // header — the one paragraph naming WHO this is for and WHY it exists
  // (design spec section 3, part 1) was unreachable. Fixed by shipping that
  // element unhidden and having the JS-only inline script collapse it
  // instead (ClassroomGroupsPage.astro's own comment on `#cg-howto-body`
  // has the full reasoning). `javaScriptEnabled: false` on this describe
  // block means that script never runs, so the raw markup below is exactly
  // what a real script-disabled visitor gets — not a proxy for it.
  //
  // Every locale, derived (#73): each is a separately generated page, and the
  // en/id pair this once listed left zh, vi and th unread from #22 (#390
  // F111). The words come from the catalogue the page renders; the approved
  // wording is pinned where copy is pinned (classroom-groups-controls.spec.ts
  // and classroom-groups-placement.test.ts).
  for (const locale of LOCALES) {
    const path = localisePath('/classroom-groups', locale);
    const t = getStrings(locale);
    test(
      `${path}: the lead and How to use part 1 are reachable without JavaScript`,
      { tag: '@javascript-blocked' },
      async ({ page }) => {
        await page.goto(path);
        await expect(page.locator('#cg-howto-body')).toBeVisible();
        // Since #384 the who-and-why paragraph is the lead, and part 1 of
        // How to use says what the tool does. Both must survive no script,
        // and be SEEN: `toHaveText` reads a hidden element's text too (#188).
        const lead = page.locator('.lead');
        await expect(lead).toBeVisible();
        await expect(lead).toHaveText(t.lead);
        const whatItDoes = page.locator('#cg-howto-body > p');
        await expect(whatItDoes).toBeVisible();
        await expect(whatItDoes).toHaveText(t.howToWhat);
      },
    );
  }

  // M-10 (stage-2 traceability matrix; design spec section 13's own "The
  // no-JS message is unchanged... the new sections do not each need their
  // own"). Stage 2, Task 7 folded Sound & animation into the tool's fourth
  // collapsible section -- proving the SAME single notice still covers it
  // is what keeps this row honestly ticked, rather than assumed true
  // because it was true of the first three. What would redden this: a
  // second `<noscript>` added anywhere on the page, e.g. one guarding the
  // new section specifically -- exactly the mistake this row exists to
  // catch, since without script NONE of the four sections can be opened at
  // all and one notice already says why.
  test(
    'one notice still covers all four sections, not one each',
    { tag: '@javascript-blocked' },
    async ({ page }) => {
      await page.goto('/classroom-groups');
      await expect(page.locator('noscript')).toHaveCount(1);
      // Shown only while script is really blocked: with it on, a <noscript>
      // holds raw text and #cg-noscript is not in the page at all (#1047).
      await expect(page.locator('#cg-noscript')).toBeVisible();
    },
  );

  test(
    'submitting cannot put a class list in the URL',
    { tag: '@javascript-blocked' },
    async ({ page }) => {
      await page.goto('/classroom-groups');

      // A teacher fills the form in and presses the button before noticing the
      // notice. With no listener attached, this is a native GET. The
      // paste-names box that used to carry typed names is gone (it fed
      // `students: string[]`, an input shape the rewritten engine no longer
      // accepts -- see grouping.ts's GroupingInput). What remains general on
      // purpose, rather than naming fields one at a time: the query string a
      // native submit produces may contain ONLY the allow-list, so a `name`
      // added to any future data field fails here the moment it is added,
      // before it carries anything that looks personal.
      //
      // Stage 2, Task 5 gave this page its first typed-text control since
      // that box was removed: #cg-class. It carries no `name` (see that
      // field's own comment in ClassroomGroupsPage.astro), so the structural
      // guarantee above already covers it with no change needed -- an unnamed
      // control cannot be serialised into a form GET at all. Filled here
      // anyway, with a value distinctive enough to be unmistakable, so the
      // proof is concrete rather than resting on that guarantee alone.
      // No script runs on this page, so no tap can report where it landed: each is proved by its
      // effect, the typed value below and the URL the submit writes (#1047).
      await typeInto(page.locator('#cg-count'), '24', { byEffect: true });
      await typeInto(page.locator('#cg-class'), 'PrivacyProbeClassName7B', {
        byEffect: true,
      });
      await expect(page.locator('#cg-class')).toHaveValue(
        'PrivacyProbeClassName7B',
      );
      await tapOn(page.locator('#cg-go'), { byEffect: true });
      // WebKit schedules the form's GET after the click has returned, so the
      // click's own wait for navigations can end before it starts, and the URL
      // read next was the old one (#449, run 37026039545). Wait for the
      // submission's URL itself: no submit at all fails here, by timing out.
      await page.waitForURL((submitted) => submitted.search !== '');

      // Over the keys the submit actually wrote (#424): with no submit at all
      // the URL is empty, and an empty URL passed this as a clean one.
      const url = new URL(page.url());
      const keys = [...url.searchParams.keys()];
      expect(
        searched(
          keys.filter((key) => !NON_PERSONAL_NAMES.includes(key)),
          { of: keys, what: 'query keys a native submit wrote' },
        ),
      ).toEqual([]);
      expect(url.search).not.toContain('PrivacyProbeClassName7B');
    },
  );
});

test.describe('privacy — when the script dies half-way', () => {
  /**
   * The barrier that matters is the one that holds in states nobody
   * enumerated. This breaks the module at a line in the MIDDLE — after setup
   * has begun, before the submit handler is reached — which is the shape of
   * every future bug that has not been written yet.
   *
   * The tool is dead here and that is not what is being asserted. What is
   * asserted is that a dead tool is still a silent one.
   */
  test.beforeEach(async ({ context }) => {
    await context.addInitScript(() => {
      Object.defineProperty(window, 'matchMedia', {
        configurable: true,
        get: () => () => {
          throw new Error('matchMedia unavailable');
        },
      });
    });
  });

  test('a mid-module failure still cannot leak the class list', async ({
    page,
  }) => {
    // Every matchMedia failure the page raised. Counted, not located: the
    // theme script in <head> calls it too, and WebKit reports the module's
    // failure with no frame from the module in its stack.
    const reported = recordErrors(page);
    const failures = () =>
      reported.uncaught.filter((error) =>
        error.includes('matchMedia unavailable'),
      ).length;
    await page.goto('/classroom-groups');
    // The module really did die half-way (#424): one failure from the theme
    // script, one from the module. Had the module stopped calling matchMedia,
    // the tool would work, its own handler would keep the URL clean, and this
    // would pass without any failure having happened.
    await expect.poll(failures).toBe(2);
    await typeInto(page.locator('#cg-count'), '8');
    // Whether the submit was CANCELLED, read from the event itself (#449). The
    // URL alone cannot say: WebKit starts a native submit's navigation after
    // the click returns, so an unchanged URL read straight away passed even
    // when nothing stopped the submit. A listener on window runs after the
    // form's own, so it sees the guard's preventDefault.
    await page.evaluate(() => {
      window.addEventListener('submit', (event) => {
        document.documentElement.dataset.submitPrevented = String(
          event.defaultPrevented,
        );
      });
    });
    await tapOn(page.locator('#cg-go'));
    await expect(page.locator('html')).toHaveAttribute(
      'data-submit-prevented',
      'true',
    );

    // No native submit happened, so no query string exists at all — not even
    // the harmless radio values. That is the unconditional guard registered
    // as the module's first statement, and it does not care what was typed
    // into the form, so filling the count field alone still proves it.
    expect(new URL(page.url()).search).toBe('');
  });
});

test.describe('privacy — when storage is unavailable', () => {
  /**
   * Safari's "Block all cookies", storage-partitioned contexts and some MDM
   * profiles throw SecurityError on localStorage access. The sound preference
   * is decoration; failing to read it must not take the tool down with it,
   * because a dead script is exactly the state that leaks the class list.
   */
  test.beforeEach(async ({ context }) => {
    await context.addInitScript(() => {
      const boom = () => {
        throw new DOMException('denied', 'SecurityError');
      };
      Object.defineProperty(window, 'localStorage', {
        configurable: true,
        get: () => ({ getItem: boom, setItem: boom, removeItem: boom }),
      });
    });
  });

  test('the tool still makes groups', async ({ page }) => {
    await page.goto('/classroom-groups');
    await makeGroups(page, '8', '4');

    await expect(page.locator('#cg-results .student')).toHaveCount(8);
  });

  test('and the sound toggle still works, it just cannot remember', async ({
    page,
  }) => {
    await page.goto('/classroom-groups');
    await tapOn(page.locator('#cg-sound-toggle'));
    await expect(page.locator('#cg-sound-check')).toBeChecked();
    await setCheckedOn(page.locator('#cg-sound-check'), false);
    // The label still tracks the control — the write failed, silently and
    // correctly, without breaking the widget.
    await expect(page.locator('#cg-sound-text')).toHaveText('Sound off');
  });

  // Code review on this task (I-3): the raw markup now ships How to use
  // EXPANDED (see ClassroomGroupsPage.astro's own comment on
  // `#cg-howto-body`), so the synchronous inline script must actively
  // collapse it — including when reading the stored preference throws,
  // this block's own scenario. Checking the state after the page has fully
  // loaded is not enough to prove that on its own: classroom-groups.ts's
  // deferred module reads the identical key the identical way, wrapped in
  // its own try/catch, and would collapse the section a moment later
  // regardless of what the inline script did — a real safety net, but one
  // that would mask a mutant that left the inline script's own throw path
  // doing nothing, at the cost of the exact expanded-then-collapsed flash a
  // JavaScript-enabled visitor would see and a same-final-state test would
  // never catch. Blocking the deferred module's own request removes that
  // net, so what is left standing here is the inline script alone.
  test('the inline script alone collapses How to use on a storage throw', async ({
    page,
  }) => {
    await page.route('**/_astro/ClassroomGroupsPage*.js', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'text/javascript',
        body: '',
      }),
    );
    await page.goto('/classroom-groups');
    await expect(page.locator('#cg-howto-body')).toBeHidden();
    await expect(page.locator('#cg-howto-toggle')).toHaveAttribute(
      'aria-expanded',
      'false',
    );
  });
});

/**
 * Stage 3, Task 10 (Y-01…Y-04, R-12). The blocks above close the door at
 * the MARKUP -- no control carrying typed text is submittable, so a broken
 * script cannot put a class list in the address bar. These close it at
 * RUNTIME: the roster now exists as real, named, editable rows, and the
 * promise the page makes in both languages ("No class list ever leaves this
 * page") has to survive every operation that could have written one
 * somewhere, not just page load.
 *
 * Asserted AFTER each operation rather than once at the end, deliberately:
 * a write that happened during editing and was cleared before the shuffle
 * would pass a single check at the end and still have leaked.
 */
test.describe('privacy — the roster never leaves memory', () => {
  test('nothing about the class is stored, after every operation', async ({
    page,
  }) => {
    // `buildRoster` opens the section itself -- the plan's snippet called
    // `openRoster` first as well, which would have TOGGLED #cg-students
    // shut again and left every later locator waiting on a hidden row.
    await buildRoster(page, [
      ['F', 'Ana'],
      ['M', 'Budi'],
    ]);
    await expectNothingStored(
      page,
      'after building the roster',
      ...ROSTER_NAMES,
    );

    await setCheckedOn(
      page.locator('.cg-student').first().getByLabel('Absent'),
    );
    await expectNothingStored(
      page,
      'after marking a student absent',
      ...ROSTER_NAMES,
    );

    await giveEveryoneASex(page);
    await tapOn(page.getByRole('button', { name: 'Make Groups' }));
    await expect(page.locator('#cg-results .group').first()).toBeVisible();
    await expectNothingStored(page, 'after shuffling', ...ROSTER_NAMES);

    // POSITIVE CONTROL. Everything above passes trivially if storage is
    // simply unreadable in this context, or if `everywhereItCouldHide` is
    // looking in the wrong place -- and a privacy test that cannot fail is
    // worth nothing. So: change the one thing design spec section 11 DOES
    // allow this page to remember, and prove the same read sees it land.
    //
    // Note the shape of what appears -- `cg-sound: "off"`. A preference,
    // under a fixed key, with a value from a fixed set. That is the whole
    // of what this tool is permitted to persist, and it is why the
    // assertions above can be as blunt as "the word Ana is nowhere".
    await tapOn(page.locator('#cg-sound-toggle'));
    await setCheckedOn(page.locator('#cg-sound-check'), false);
    await expect
      .poll(() => page.evaluate(() => localStorage.getItem('cg-sound')))
      .toBe('off');
    await expectNothingStored(
      page,
      'after a preference was written',
      ...ROSTER_NAMES,
    );
  });

  test('a reload loses the roster', async ({ page }) => {
    await buildRoster(page, [['F', 'Ana']]);
    await page.reload();
    await tapOn(page.locator('#cg-students-toggle'));
    await expect(page.locator('.cg-student')).toHaveCount(0);
  });

  /**
   * R-12, and the defect this whole stage exists to fix: identity is the
   * NUMBER, never the name. Two children called Ana are two children.
   *
   * The plan's own assertion here was `expect(#cg-groups).toContainText
   * ('Ana')` -- wrong selector (that id is the "how many groups" number
   * input; the results container is `#cg-results`, the fifth time this
   * stage has had to make that correction) and, more importantly, an
   * assertion that passes as long as the word "Ana" appears ANYWHERE. It
   * would pass just as well under the name-collapsing engine it is meant
   * to rule out. Replaced with the two facts that actually distinguish
   * them: BOTH Anas are placed, and the apart letter constrains only the
   * one row that carries it.
   */
  test('two children called Ana are separated independently', async ({
    page,
  }) => {
    await buildRoster(page, [
      ['F', 'Ana'],
      ['F', 'Ana'],
      ['M', 'Budi'],
      ['M', 'Eko'],
    ]);
    // Student 1 (the first Ana) and student 3 (Budi) must not meet.
    //
    // 'A', not the plan's 'X': the Apart dropdown offers only the letters
    // in use plus ONE more (`availableLetters`, src/lib/roster.ts -- the
    // list grows as letters are taken, so a fresh roster offers exactly
    // "A"). Selecting 'X' waits forever on an option the page has no
    // reason to render. Found by running it.
    await chooseOption(
      page.locator('.cg-student').nth(0).getByLabel('Apart'),
      'A',
    );
    await chooseOption(
      page.locator('.cg-student').nth(2).getByLabel('Apart'),
      'A',
    );
    await setCheckedOn(page.getByLabel('Number of groups'));
    await typeInto(page.getByLabel('How many groups'), '2');
    await giveEveryoneASex(page);
    await tapOn(page.getByRole('button', { name: 'Make Groups' }));
    await expect(page.locator('#cg-results .group').first()).toBeVisible();

    // Both Anas are on the sheet. Under a name-matching engine the second
    // would have been folded into the first and only one would appear.
    await expect(
      page.locator('#cg-results .student').getByText('Ana'),
    ).toHaveCount(2);
    await expect(page.locator('#cg-results .student')).toHaveCount(4);

    // `data-number` (Stage 3, Task 9) is the identity, on the element --
    // so which group each student landed in is readable without going
    // through their name, which is the whole point being proven.
    const groupOf = (n: number) =>
      page
        .locator('#cg-results .group')
        .filter({ has: page.locator(`.student[data-number="${n}"]`) });
    // The two rows carrying X are in different groups -- identified by
    // each card's own heading ("Group 1"/"Group 2"), which is the only
    // per-group identity the rendered sheet actually carries.
    const [anaGroup, budiGroup] = await Promise.all([
      groupOf(1).locator('h3').textContent(),
      groupOf(3).locator('h3').textContent(),
    ]);
    expect(anaGroup).toMatch(/^Group \d+$/);
    expect(anaGroup).not.toBe(budiGroup);
    // ...and the SECOND Ana carries no letter, so she is placed freely.
    // Asserted as "she is placed at all, in exactly one group" rather than
    // "she is with Budi", which the shuffle is free to decide either way.
    await expect(groupOf(2)).toHaveCount(1);
  });
});

/**
 * Stage 4, Task 7. Y-01…Y-04 re-asserted after the paths stage 4 added.
 *
 * Import, export and the handover are three new opportunities to write
 * something somewhere. The invariant is re-checked after each rather than
 * assumed to hold because it held before them -- which is the whole reason
 * the stage-3 block above checks after EACH operation rather than once at
 * the end.
 */
test.describe('privacy — the roster still never persists, after the new paths', () => {
  test('an import writes nothing', async ({ page }) => {
    await page.goto('/classroom-groups');
    await tapOn(page.locator('#cg-io-toggle'));
    await upload(page, 'ok.csv', 'number,name\n1,Ana\n2,Budi\n');
    await expect(page.getByText('Imported 2 students.')).toBeVisible();
    await expectNothingStored(page, 'after an import', ...ROSTER_NAMES);
  });

  test('an export writes nothing, and leaves no object URL behind', async ({
    page,
  }) => {
    await buildRoster(page, [
      ['F', 'Ana'],
      ['M', 'Budi'],
    ]);
    await tapOn(page.locator('#cg-io-toggle'));
    await downloadName(page, 'Export class list');
    await expectNothingStored(page, 'after an export', ...ROSTER_NAMES);
    // The blob URL is revoked the moment the click is dispatched, so no
    // <a> holding the file's bytes is left in the document -- see
    // io-ui.ts's own `download` for why that matters here.
    expect(
      await page.evaluate(
        () => document.querySelectorAll('a[href^="blob:"]').length,
      ),
    ).toBe(0);
  });

  test('the handover writes nothing in either tab', async ({
    page,
    context,
  }) => {
    await buildRosterAtPath(page, '/classroom-groups', [
      ['F', 'Ana'],
      ['M', 'Budi'],
    ]);
    await tapOn(page.locator('#cg-io-toggle'));
    const [, newPage] = await Promise.all([
      page.waitForEvent('download'),
      context.waitForEvent('page'),
      handoverTo(page, 'Bahasa Indonesia'),
    ]);
    await newPage.waitForLoadState();
    await tapOn(newPage.locator('#cg-students-toggle'));
    await expect(newPage.locator('.cg-student')).toHaveCount(2);
    await expectNothingStored(
      page,
      'source tab after the handover',
      ...ROSTER_NAMES,
    );
    await expectNothingStored(
      newPage,
      'receiving tab after the handover',
      ...ROSTER_NAMES,
    );
  });

  test('a reload after an import still loses the roster', async ({ page }) => {
    await page.goto('/classroom-groups');
    await tapOn(page.locator('#cg-io-toggle'));
    await upload(page, 'ok.csv', 'number,name\n1,Ana\n');
    await expect(page.getByText('Imported 1 student.')).toBeVisible();
    await page.reload();
    await tapOn(page.locator('#cg-students-toggle'));
    await expect(page.locator('.cg-student')).toHaveCount(0);
  });
});

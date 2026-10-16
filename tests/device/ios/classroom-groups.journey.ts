/**
 * Classroom Groups on the real iPhone: the tests tests/e2e/classroom-groups.spec.ts
 * runs on the real Android phone, under the same titles with an
 * `iOS mirror:` prefix (#813; global rule 2026-10-15, every test mirrored, no
 * exceptions). The starting states come from classroom-groups.ts, the one home
 * of the roster helpers on this platform, and every input goes through
 * `session.interaction`.
 *
 * Tests that need what Safari's WebDriver lacks (a script run before the
 * page's first script, the network recorded or blocked, the device's colour
 * scheme) wait for #811; each is listed in `.superpowers/sdd/813/plan.md`,
 * none exempt.
 */
import { basename, relative, sep } from 'node:path';
import { describe, expect, test } from 'vitest';
import {
  DEFAULT_LOCALE,
  getSiteStrings,
  getStrings,
  LOCALES,
  localisePath,
  type Locale,
} from '../../../src/lib/i18n';
import { LOCALE_METADATA } from '../../../src/lib/i18n/metadata';
import { floorBreach } from '../../floors';
import { THEME_SCRIPT_SOURCE, THEMES } from '../../palette';
import { filesUnder, searched } from '../../source-files';
import { paintedContrast } from '../../wcag';
import {
  attributesOf,
  countOf,
  enabledOf,
  expectEventually,
  hiddenOf,
  isEnabled,
  isShown,
  paintedTextOf,
  rawTextsOf,
  textCount,
  textMatchesOf,
  textsOf,
  visibilityOf,
} from './dom';
import {
  addSeveral,
  buildRoster,
  chooseSpeed,
  fill as fillField,
  giveEveryoneASex,
  openRoster,
  rowScope,
  setSex,
} from './classroom-groups';
import { shootDevice } from './evidence';
import { holdIosSession } from './held-session';
import { byLabel, byRole, type NameMatch } from './roles';
import { announceMode } from './session';
import type { WebElement } from './webdriver';

const phone = holdIosSession();

/** The form, filled as the Android spec's own `fill` fills it. */
const fill = async (opts: {
  count?: string;
  size?: string;
  groups?: string;
  speed?: 'normal' | 'fast' | 'skip';
}): Promise<void> => {
  if (opts.count !== undefined)
    await fillField(phone(), '#cg-count', opts.count);
  if (opts.size !== undefined) await fillField(phone(), '#cg-size', opts.size);
  if (opts.groups !== undefined) {
    const mode = await phone().driver.findElement(
      'input[name="mode"][value="groupCount"]',
    );
    await phone().interaction.setChecked(mode, true);
    await fillField(phone(), '#cg-groups', opts.groups);
  }
  await chooseSpeed(phone(), opts.speed ?? 'skip');
};

const go = async (): Promise<void> =>
  phone().interaction.click(await phone().driver.findElement('#cg-go'));

const value = (selector: string): Promise<string> =>
  phone().driver.executeScript<string>(
    'return document.querySelector(arguments[0]).value;',
    [selector],
  );

/** Android's `shoot`: evidence only, written when the run asks for it. */
const shoot = (label: string): Promise<string | null> =>
  shootDevice(phone().driver, { project: 'ios-safari-real-device', label });

/** `getByRole('button', { name: 'Make groups' })`, resolved afresh each time as a locator is. */
const makeGroupsButton = (): Promise<WebElement> =>
  byRole(phone().driver, 'button', 'Make groups', { exact: false });

const goEnabled = async (): Promise<boolean> =>
  isEnabled(phone().driver, await makeGroupsButton());

describe('iOS mirror: classroom group creator', () => {
  test('iOS mirror: shuffles anonymous students against the rewritten engine', async () => {
    // NOT YET THE SAME as Android (#811): its controls are found by the
    // name roles.ts computes, a part of the ARIA naming rules, where
    // Android's getByRole and getByLabel run Playwright's own. Kept, never
    // deleted (Shyden 2026-10-16), until #811 runs Playwright's own code
    // in Safari.
    announceMode(phone(), 'anonymous shuffle');
    await phone().navigateToPath('/classroom-groups');
    await phone().interaction.fill(
      await byLabel(phone().driver, 'Number of students', { exact: false }),
      '12',
    );
    await giveEveryoneASex(phone());
    await phone().interaction.click(
      await byRole(phone().driver, 'button', 'Make groups', { exact: false }),
    );
    await expectEventually(
      () => countOf(phone().driver, '#cg-results .group'),
      3,
      'three groups',
    );
  });

  test('iOS mirror: the paste-names box and the keep-apart box are gone', async () => {
    announceMode(phone(), 'removed boxes');
    await phone().navigateToPath('/classroom-groups');
    await expectEventually(
      async () => countOf(phone().driver, '#cg-names'),
      0,
      "countOf(phone().driver, '#cg-names')",
    );
    await expectEventually(
      async () => countOf(phone().driver, '#cg-apart'),
      0,
      "countOf(phone().driver, '#cg-apart')",
    );
  });

  test('iOS mirror: leaves a pupil typed absent out of the groups entirely', async () => {
    // NOT YET THE SAME as Android (#811): getByText is read by
    // textMatchesOf, a restatement of Playwright's text engine. Kept,
    // never deleted (Shyden 2026-10-16), until #811 runs Playwright's own
    // code in Safari.
    announceMode(phone(), 'absent by number');
    await phone().navigateToPath('/classroom-groups');
    await fill({ count: '25', groups: '5' });
    await fillField(phone(), '#cg-numbers-absent', '7');
    await expectEventually(
      () => value('#cg-numbers-absent'),
      '7',
      'the field holds 7',
    );
    await shoot('number 7 typed into Student numbers');
    await go();

    await expectEventually(
      () => countOf(phone().driver, '#cg-results .group'),
      5,
      'five groups',
    );
    await expectEventually(
      () => countOf(phone().driver, '#cg-results .student'),
      24,
      '24 students',
    );
    const count = (text: string): Promise<number> =>
      textCount(phone().driver, '#cg-results', text, { exact: true });
    await expectEventually(() => count('Student 8'), 1, 'Student 8 once');
    await expectEventually(() => count('Student 7'), 0, 'no Student 7');
    await expectEventually(() => count('Student 25'), 1, 'Student 25 once');
    await shoot('five groups of the 24 present, without number 7');

    await expectEventually(
      () => visibilityOf(phone().driver, '#cg-grouped-note'),
      [true],
      'the note shows',
    );
    await expectEventually(
      () => textsOf(phone().driver, '#cg-grouped-note'),
      ['24 of 25 grouped — number 7 is absent.'],
      'the note text',
    );
    await shoot('the note names who is absent');
  });

  test('iOS mirror: a refused number blocks the shuffle until it is corrected', async () => {
    // NOT YET THE SAME as Android (#811): its controls are found by the
    // name roles.ts computes, a part of the ARIA naming rules, where
    // Android's getByRole and getByLabel run Playwright's own. Kept, never
    // deleted (Shyden 2026-10-16), until #811 runs Playwright's own code
    // in Safari.
    announceMode(phone(), 'refused absent number');
    await phone().navigateToPath('/classroom-groups');

    await expectEventually(goEnabled, true, 'Make groups enabled');
    await shoot('Make groups enabled before anything is typed');

    await fillField(phone(), '#cg-count', '25');
    await fillField(phone(), '#cg-numbers-absent', '26');
    await expectEventually(
      () => visibilityOf(phone().driver, '#cg-numbers-problem'),
      [true],
      'the refusal shows',
    );
    await shoot('number 26 refused in a class of 25');
    await expectEventually(goEnabled, false, 'Make groups disabled');
    await shoot('Make groups disabled while the refusal stands');

    await fillField(phone(), '#cg-numbers-absent', '7');
    await expectEventually(
      () => hiddenOf(phone().driver, '#cg-numbers-problem'),
      true,
      'the refusal hides',
    );
    await shoot('corrected to 7, the refusal is gone');
    await expectEventually(goEnabled, true, 'Make groups enabled again');
    await shoot('Make groups enabled again');
  });

  test('iOS mirror: lowering the count refuses a number that was valid when it was typed', async () => {
    // NOT YET THE SAME as Android (#811): its controls are found by the
    // name roles.ts computes, a part of the ARIA naming rules, where
    // Android's getByRole and getByLabel run Playwright's own. Kept, never
    // deleted (Shyden 2026-10-16), until #811 runs Playwright's own code
    // in Safari.
    announceMode(phone(), 'count lowered under an absent number');
    const problem = '#cg-numbers-problem';
    await phone().navigateToPath('/classroom-groups');

    await fillField(phone(), '#cg-count', '25');
    await fillField(phone(), '#cg-numbers-absent', '20');
    await expectEventually(
      () => countOf(phone().driver, problem),
      1,
      'one problem line',
    );
    await expectEventually(
      () => hiddenOf(phone().driver, problem),
      true,
      'hidden',
    );
    await expectEventually(goEnabled, true, 'Make groups enabled');
    await shoot('number 20 absent from a class of 25, accepted');

    await fillField(phone(), '#cg-count', '10');
    await expectEventually(
      () => visibilityOf(phone().driver, problem),
      [true],
      'the refusal shows',
    );
    await expectEventually(
      () => textsOf(phone().driver, problem),
      ['There is no number 20. You have 10 students.'],
      'the refusal text',
    );
    await expectEventually(goEnabled, false, 'Make groups disabled');
    await shoot(
      'the class shrinks to 10 and number 20 is refused on the keystroke',
    );

    await fillField(phone(), '#cg-count', '25');
    await expectEventually(
      () => hiddenOf(phone().driver, problem),
      true,
      'hidden again',
    );
    await expectEventually(goEnabled, true, 'Make groups enabled again');
    await shoot('raised back to 25, the refusal is gone');
  });

  test('iOS mirror: splits a class and shows every student exactly once', async () => {
    announceMode(phone(), 'split 22 into 4s');
    await phone().navigateToPath('/classroom-groups');
    await fill({ count: '22', size: '4' });
    await go();

    await expectEventually(
      () => countOf(phone().driver, '#cg-results .group'),
      5,
      'five groups',
    );
    await expectEventually(
      () => countOf(phone().driver, '#cg-results .student'),
      22,
      '22 students',
    );
    await expectEventually(
      async () =>
        (await textsOf(phone().driver, '#cg-summary')).map((t) =>
          t.includes('22'),
        ),
      [true],
      'the summary names 22',
    );
    await shoot('five groups holding all 22 students');

    await expectEventually(
      async () => countOf(phone().driver, '#cg-grouped-note'),
      1,
      "countOf(phone().driver, '#cg-grouped-note')",
    );
    await expectEventually(
      () => hiddenOf(phone().driver, '#cg-grouped-note'),
      true,
      'the note is hidden',
    );
  });

  test('iOS mirror: never makes a group smaller than the size asked for', async () => {
    announceMode(phone(), 'no undersized group');
    await phone().navigateToPath('/classroom-groups');
    await fill({ count: '7', size: '4' });
    await go();
    await expectEventually(
      () => countOf(phone().driver, '#cg-results .group'),
      1,
      'one group',
    );
    await expectEventually(
      () => countOf(phone().driver, '#cg-results .student'),
      7,
      'seven students',
    );
    await shoot('one group of 7, never a 4 and a 3');
  });

  test('iOS mirror: numbers students since there is no roster to name them from yet', async () => {
    announceMode(phone(), 'numbered students');
    await phone().navigateToPath('/classroom-groups');
    await fill({ count: '4', size: '2' });
    await go();
    // allTextContents() reads once, without retrying: as here.
    const labels = await rawTextsOf(phone().driver, '#cg-results .student');
    expect(labels.sort()).toEqual([
      'Student 1',
      'Student 2',
      'Student 3',
      'Student 4',
    ]);
  });

  test('iOS mirror: the help text under Number of students describes what happens now, not the removed names box', async () => {
    announceMode(phone(), 'count help text');
    await phone().navigateToPath('/classroom-groups');
    await expectEventually(
      () => textsOf(phone().driver, '#cg-count-help'),
      [
        'Students are anonymous and numbered — Student 1, Student 2, and so on.',
      ],
      'the help text',
    );
  });

  test('iOS mirror: results are readable with the animation skipped', async () => {
    announceMode(phone(), 'skipped animation');
    await phone().navigateToPath('/classroom-groups');
    await fill({ count: '8', size: '4', speed: 'skip' });
    await go();
    await expectEventually(
      () => countOf(phone().driver, '#cg-results .student'),
      8,
      'eight students',
    );
    await expectEventually(
      async () =>
        (await visibilityOf(phone().driver, '#cg-results .student'))[0],
      true,
      'the first student shows',
    );
  });

  test('iOS mirror: the animation deals every card and settles', async () => {
    announceMode(phone(), 'animated deal');
    await phone().navigateToPath('/classroom-groups');
    await fill({ count: '6', size: '3', speed: 'fast' });
    await go();
    await expectEventually(
      () => countOf(phone().driver, '#cg-results .student.dealt'),
      6,
      'six dealt cards',
    );
    await expectEventually(
      () => enabledOf(phone().driver, '#cg-go'),
      true,
      '#cg-go enabled',
    );
  });

  test('iOS mirror: splits by number of groups, not just by group size', async () => {
    announceMode(phone(), 'split into 3 groups');
    await phone().navigateToPath('/classroom-groups');
    await fill({ count: '20', groups: '3' });
    await go();
    await expectEventually(
      () => countOf(phone().driver, '#cg-results .group'),
      3,
      'three groups',
    );
    await expectEventually(
      () => countOf(phone().driver, '#cg-results .student'),
      20,
      '20 students',
    );
  });

  test('iOS mirror: a mis-keyed class size is refused, not attempted', async () => {
    announceMode(phone(), 'mis-keyed class size');
    await phone().navigateToPath('/classroom-groups');
    await fill({ count: '100000000', size: '4' });
    await go();
    await expectEventually(
      () => textsOf(phone().driver, '#cg-error'),
      ['That is more students than this tool will take. The most is 100.'],
      'the refusal',
    );
    await expectEventually(
      () => enabledOf(phone().driver, '#cg-go'),
      true,
      '#cg-go enabled',
    );
    await expectEventually(
      () => hiddenOf(phone().driver, '#cg-results'),
      true,
      'no results',
    );
  });

  test('iOS mirror: the summary reads as a sentence, singular included', async () => {
    announceMode(phone(), 'summary sentence');
    await phone().navigateToPath('/classroom-groups');
    await fill({ count: '7', size: '4' });
    await go();
    await expectEventually(
      () => textsOf(phone().driver, '#cg-summary'),
      ['1 group from 7 students.'],
      'the singular summary',
    );
    await fill({ count: '22', size: '4' });
    await go();
    await expectEventually(
      () => textsOf(phone().driver, '#cg-summary'),
      ['5 groups from 22 students.'],
      'the plural summary',
    );
  });

  test('iOS mirror: the error clears the stale "Shuffle again" label', async () => {
    announceMode(phone(), 'error clears Shuffle again');
    await phone().navigateToPath('/classroom-groups');
    await fill({ count: '8', size: '4' });
    await go();
    await expectEventually(
      () => textsOf(phone().driver, '#cg-go'),
      ['Shuffle again'],
      'Shuffle again',
    );
    await fill({ count: '0', size: '4' });
    await go();
    await expectEventually(
      () => visibilityOf(phone().driver, '#cg-error'),
      [true],
      'the error shows',
    );
    await expectEventually(
      () => textsOf(phone().driver, '#cg-go'),
      ['Make Groups'],
      'Make Groups',
    );
  });

  test('iOS mirror: the mute choice survives a reload', async () => {
    announceMode(phone(), 'mute survives reload');
    await phone().navigateToPath('/classroom-groups');
    const checked = async (): Promise<unknown> =>
      (await phone().driver.findElement('#cg-sound-check')).property('checked');
    await phone().interaction.click(
      await phone().driver.findElement('#cg-sound-toggle'),
    );
    await expectEventually(checked, true, 'sound starts on');
    await phone().interaction.setChecked(
      await phone().driver.findElement('#cg-sound-check'),
      false,
    );
    await phone().reload();
    await phone().interaction.click(
      await phone().driver.findElement('#cg-sound-toggle'),
    );
    await expectEventually(checked, false, 'sound stays off');
  });
});

/** Types `name` into the class-name field, found by its label as Android finds it. */
const className = async (name: string): Promise<void> => {
  const field = await byLabel(phone().driver, 'Class (optional)', {
    exact: false,
  });
  await phone().interaction.fill(field, name);
};

const heading = (): Promise<string[]> =>
  textsOf(phone().driver, '#cg-results-h');

describe('iOS mirror: class name and results heading', () => {
  test('iOS mirror: the class name heads the results, once', async () => {
    // NOT YET THE SAME as Android (#811): its controls are found by the
    // name roles.ts computes, a part of the ARIA naming rules, where
    // Android's getByRole and getByLabel run Playwright's own; getByText
    // is read by textMatchesOf, a restatement of Playwright's text engine.
    // Kept, never deleted (Shyden 2026-10-16), until #811 runs
    // Playwright's own code in Safari.
    announceMode(phone(), 'class name heads results');
    await phone().navigateToPath('/classroom-groups');
    await className('7B');
    await fill({ count: '9', size: '4' });
    await go();
    await expectEventually(heading, ['7B — your groups'], 'the heading');
    await expectEventually(
      async () =>
        textCount(phone().driver, '#cg-tables', '7B', { exact: false }),
      0,
      "textCount(phone().driver, '#cg-tables', '7B', { exact: false })",
    );
  });

  test('iOS mirror: a blank class name blocks nothing', async () => {
    announceMode(phone(), 'blank class name');
    await phone().navigateToPath('/classroom-groups');
    await fill({ count: '9', size: '4' });
    await go();
    await expectEventually(heading, ['Your groups'], 'the heading');
    await expectEventually(
      async () => countOf(phone().driver, '#cg-results .group'),
      2,
      "countOf(phone().driver, '#cg-results .group')",
    );
    await expectEventually(
      async () => countOf(phone().driver, '#cg-results .student'),
      9,
      "countOf(phone().driver, '#cg-results .student')",
    );
  });

  test('iOS mirror: a class name of only spaces is treated as no class name', async () => {
    // NOT YET THE SAME as Android (#811): its controls are found by the
    // name roles.ts computes, a part of the ARIA naming rules, where
    // Android's getByRole and getByLabel run Playwright's own. Kept, never
    // deleted (Shyden 2026-10-16), until #811 runs Playwright's own code
    // in Safari.
    announceMode(phone(), 'spaces-only class name');
    await phone().navigateToPath('/classroom-groups');
    await className('   ');
    await fill({ count: '9', size: '4' });
    await go();
    await expectEventually(heading, ['Your groups'], 'the heading');
  });

  test('iOS mirror: groups stay numbered when a class name is set', async () => {
    // NOT YET THE SAME as Android (#811): its controls are found by the
    // name roles.ts computes, a part of the ARIA naming rules, where
    // Android's getByRole and getByLabel run Playwright's own. Kept, never
    // deleted (Shyden 2026-10-16), until #811 runs Playwright's own code
    // in Safari.
    announceMode(phone(), 'groups numbered under a class name');
    await phone().navigateToPath('/classroom-groups');
    await className('7B');
    await fill({ count: '9', size: '4' });
    await go();
    await expectEventually(
      async () => (await textsOf(phone().driver, '#cg-results .group h3'))[0],
      'Group 1',
      'the first group heading',
    );
  });

  test('iOS mirror: a class name is rendered literally, HTML metacharacters included', async () => {
    // NOT YET THE SAME as Android (#811): its controls are found by the
    // name roles.ts computes, a part of the ARIA naming rules, where
    // Android's getByRole and getByLabel run Playwright's own. Kept, never
    // deleted (Shyden 2026-10-16), until #811 runs Playwright's own code
    // in Safari.
    announceMode(phone(), 'class name rendered literally');
    await phone().navigateToPath('/classroom-groups');
    // NOT YET THE SAME as Android (#811): Android listens for any dialog the
    // page opens; this stubs `window.alert`, the one the payload calls, so a
    // confirm or prompt would go unseen. Kept, never deleted (Shyden
    // 2026-10-16), until the harness reads WebDriver's user prompts.
    await phone().driver.executeScript(
      'window.__iosAlerted = false; window.alert = () => { window.__iosAlerted = true; };',
    );
    const raw = '<img src=x onerror=alert(1)>7B & "Sons"';
    await className(raw);
    await chooseSpeed(phone(), 'skip');
    await go();
    await expectEventually(heading, [`${raw} — your groups`], 'the heading');
    await expectEventually(
      async () => countOf(phone().driver, '#cg-results-h img'),
      0,
      "countOf(phone().driver, '#cg-results-h img')",
    );
    expect(
      await phone().driver.executeScript<boolean>(
        'return window.__iosAlerted;',
      ),
      'no dialog fired',
    ).toBe(false);
  });

  test('iOS mirror: filename-unsafe characters reach the heading unaltered', async () => {
    // NOT YET THE SAME as Android (#811): its controls are found by the
    // name roles.ts computes, a part of the ARIA naming rules, where
    // Android's getByRole and getByLabel run Playwright's own. Kept, never
    // deleted (Shyden 2026-10-16), until #811 runs Playwright's own code
    // in Safari.
    announceMode(phone(), 'filename-unsafe class name');
    await phone().navigateToPath('/classroom-groups');
    await className('Year 7 / Set B');
    await chooseSpeed(phone(), 'skip');
    await go();
    await expectEventually(
      heading,
      ['Year 7 / Set B — your groups'],
      'the heading',
    );
  });

  test('iOS mirror: a changed class name is picked up on the next shuffle', async () => {
    // NOT YET THE SAME as Android (#811): its controls are found by the
    // name roles.ts computes, a part of the ARIA naming rules, where
    // Android's getByRole and getByLabel run Playwright's own. Kept, never
    // deleted (Shyden 2026-10-16), until #811 runs Playwright's own code
    // in Safari.
    announceMode(phone(), 'class name changed between shuffles');
    await phone().navigateToPath('/classroom-groups');
    await className('7B');
    await fill({ count: '8', size: '4' });
    await go();
    await expectEventually(heading, ['7B — your groups'], 'the first heading');
    await className('8C');
    await go();
    await expectEventually(heading, ['8C — your groups'], 'the second heading');
  });
});

/**
 * The requests the page has made since it loaded, read from Safari itself
 * (Resource Timing), as Android's `recordRequests` reads them off the wire:
 * `heard` is the population every engine makes (the document, stylesheets,
 * scripts and fetches), `audio` the ones for a sound asset.
 */
const requestsSoFar = (): Promise<{ heard: string[]; audio: string[] }> =>
  phone().driver.executeScript(
    `const entries = performance.getEntriesByType('resource');
     const heard = [location.href, ...entries
       .filter((e) => ['link', 'script', 'fetch', 'xmlhttprequest', 'css'].includes(e.initiatorType))
       .map((e) => e.name)];
     return { heard, audio: entries.map((e) => e.name).filter((name) => /\\.m4a(?:\\?|$)/.test(name)) };`,
  );

const soundCheck = async (wantOn: boolean): Promise<void> =>
  phone().interaction.setChecked(
    await phone().driver.findElement('#cg-sound-check'),
    wantOn,
  );

describe('iOS mirror: the sound assets', () => {
  test('iOS mirror: all six sound assets are reachable from the built site and appear in dist/', async () => {
    announceMode(phone(), 'sound assets');
    // Android's `request.get` is Playwright's API client: a request from the
    // test process to the server the phone is served by, never the page's
    // own fetch. This is the same request, from the same side.
    const files = filesUnder('dist', (path) => path.endsWith('.m4a'));
    for (const role of [
      'shuffle',
      'land-1',
      'land-2',
      'land-3',
      'land-4',
      'done',
    ]) {
      const pattern = new RegExp(`^${role}\\.[\\w-]+\\.m4a$`);
      const matches = files.filter((file) => pattern.test(basename(file)));
      expect(
        matches,
        `expected exactly one built asset for "${role}" in dist/, found: [${matches.join(', ')}]`,
      ).toHaveLength(1);
      const urlPath = '/' + relative('dist', matches[0]).split(sep).join('/');
      const response = await fetch(new URL(urlPath, phone().baseUrl));
      expect(
        response.ok,
        `GET ${urlPath} was not reachable from the built site (status ${response.status})`,
      ).toBe(true);
      expect((await response.arrayBuffer()).byteLength).toBeGreaterThan(0);
    }
  });
  test('iOS mirror: with sound off, a full shuffle fetches no audio at all', async () => {
    announceMode(phone(), 'sound off, no audio fetched');
    // NOT YET THE SAME as Android (#811): Android records the network; Safari's
    // WebDriver has none, so this reads Resource Timing. Kept, never deleted
    // (Shyden 2026-10-16), until #811 gives it Android's own mechanism.
    await phone().navigateToPath('/classroom-groups');
    await phone().interaction.click(
      await phone().driver.findElement('#cg-sound-toggle'),
    );
    await soundCheck(false);
    await phone().reload();
    await phone().interaction.click(
      await phone().driver.findElement('#cg-sound-toggle'),
    );
    const box = await phone().driver.findElement('#cg-sound-check');
    await expectEventually(
      async () => box.property('checked'),
      false,
      'sound stays off',
    );
    await fill({ count: '6', size: '3', speed: 'fast' });
    await go();
    await expectEventually(
      () => countOf(phone().driver, '#cg-results .student.dealt'),
      6,
      'six dealt cards',
    );
    const { heard, audio } = await requestsSoFar();
    expect(
      searched(audio, { of: heard, what: 'requests the page made' }),
      'sound off means the assets are never downloaded',
    ).toEqual([]);
    expect(
      floorBreach('ios-classroom-groups/sound-off-requests', heard.length),
    ).toBeUndefined();
  });

  test('iOS mirror: with sound on, the audio requests that happen are exactly ours and same-origin', async () => {
    announceMode(phone(), 'sound on, same-origin audio');
    // NOT YET THE SAME as Android (#811): Android records the network; Safari's
    // WebDriver has none, so this reads Resource Timing. Kept, never deleted
    // (Shyden 2026-10-16), until #811 gives it Android's own mechanism.
    await phone().navigateToPath('/classroom-groups');
    await expectEventually(
      async () => (await requestsSoFar()).audio.length,
      6,
      'six sound assets requested',
    );
    const origin = await phone().driver.executeScript<string>(
      'return location.origin;',
    );
    for (const url of (await requestsSoFar()).audio)
      expect(new URL(url).origin, url).toBe(origin);
  });
});

describe('iOS mirror: the Split by row names its own fields', () => {
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
    test(`iOS mirror: the fields are correctly labelled (${path})`, async () => {
      // NOT YET THE SAME as Android (#811): its controls are found by the
      // name roles.ts computes, a part of the ARIA naming rules, where
      // Android's getByRole and getByLabel run Playwright's own. Kept, never
      // deleted (Shyden 2026-10-16), until #811 runs Playwright's own code
      // in Safari.
      announceMode(phone(), `Split by labels on ${path}`);
      await phone().navigateToPath(path);
      await expectEventually(
        async () => textsOf(phone().driver, '#cg-mode-label'),
        [splitBy],
        "textsOf(phone().driver, '#cg-mode-label')",
      );
      const driver = phone().driver;
      await expectEventually(
        async () =>
          isShown(driver, await byLabel(driver, perGroup, { exact: true })),
        true,
        'isShown(driver, await byLabel(driver, perGroup, { exact: true }))',
      );
      const radio = await byLabel(driver, groupCountRadio, { exact: true });
      await phone().interaction.setChecked(radio, true);
      await expectEventually(
        async () =>
          isShown(driver, await byLabel(driver, howMany, { exact: true })),
        true,
        `${howMany} is shown`,
      );
    });
  }
});

describe('iOS mirror: classroom group creator — Bahasa Indonesia', () => {
  test('iOS mirror: the Indonesian page is genuinely in Indonesian', async () => {
    announceMode(phone(), 'Indonesian page');
    await phone().navigateToPath('/id/classroom-groups');
    await expectEventually(
      async () => attributesOf(phone().driver, 'html', 'lang'),
      ['id'],
      "attributesOf(phone().driver, 'html', 'lang')",
    );
    await expectEventually(
      async () => textsOf(phone().driver, 'h1'),
      ['Pembuat Kelompok Kelas'],
      "textsOf(phone().driver, 'h1')",
    );
    await expectEventually(
      async () => textsOf(phone().driver, '#cg-go'),
      ['Buat Kelompok'],
      "textsOf(phone().driver, '#cg-go')",
    );
  });

  test('iOS mirror: anonymous students are labelled in Indonesian', async () => {
    announceMode(phone(), 'Indonesian student labels');
    await phone().navigateToPath('/id/classroom-groups');
    await fill({ count: '4', size: '2' });
    await go();
    // `allTextContents()`: read once, raw, as Android reads it.
    const labels = await rawTextsOf(phone().driver, '#cg-results .student');
    expect(labels.sort()).toEqual(['Siswa 1', 'Siswa 2', 'Siswa 3', 'Siswa 4']);
    // `.first()` toHaveText, retried.
    await expectEventually(
      async () => (await textsOf(phone().driver, '#cg-results .group h3'))[0],
      'Kelompok 1',
      'the first group heading',
    );
  });

  test('iOS mirror: errors are shown in Indonesian, not English', async () => {
    announceMode(phone(), 'Indonesian error');
    await phone().navigateToPath('/id/classroom-groups');
    await fill({ count: '0', size: '2' });
    await go();
    await expectEventually(
      () => visibilityOf(phone().driver, '#cg-error'),
      [true],
      'the error shows',
    );
    // `toContainText`, retried, on the one error.
    await expectEventually(
      async () =>
        (await textsOf(phone().driver, '#cg-error')).map((t) =>
          t.includes('Tambahkan siswa'),
        ),
      [true],
      'the error names Tambahkan siswa',
    );
  });

  test('iOS mirror: the help text under Jumlah siswa reads in Indonesian, as a whole sentence', async () => {
    announceMode(phone(), 'Indonesian count help');
    await phone().navigateToPath('/id/classroom-groups');
    await expectEventually(
      async () => textsOf(phone().driver, '#cg-count-help'),
      [
        'Siswa bersifat anonim dan diberi nomor — Siswa 1, Siswa 2, dan seterusnya.',
      ],
      "textsOf(phone().driver, '#cg-count-help')",
    );
  });

  test('iOS mirror: the button relabels to Acak lagi after a shuffle, and back to Buat Kelompok on a refusal', async () => {
    announceMode(phone(), 'Indonesian button labels');
    await phone().navigateToPath('/id/classroom-groups');
    await fill({ count: '8', size: '4' });
    await go();
    await expectEventually(
      () => textsOf(phone().driver, '#cg-go'),
      ['Acak lagi'],
      'Acak lagi',
    );
    await fill({ count: '0', size: '4' });
    await go();
    await expectEventually(
      () => visibilityOf(phone().driver, '#cg-error'),
      [true],
      'the error shows',
    );
    await expectEventually(
      async () => textsOf(phone().driver, '#cg-go'),
      ['Buat Kelompok'],
      "textsOf(phone().driver, '#cg-go')",
    );
  });

  test('iOS mirror: the class name heads the results, once', async () => {
    // NOT YET THE SAME as Android (#811): its controls are found by the
    // name roles.ts computes, a part of the ARIA naming rules, where
    // Android's getByRole and getByLabel run Playwright's own; getByText
    // is read by textMatchesOf, a restatement of Playwright's text engine.
    // Kept, never deleted (Shyden 2026-10-16), until #811 runs
    // Playwright's own code in Safari.
    announceMode(phone(), 'Indonesian class name heading');
    await phone().navigateToPath('/id/classroom-groups');
    const field = await byLabel(phone().driver, 'Kelas (opsional)', {
      exact: false,
    });
    await phone().interaction.fill(field, '7B');
    await fill({ count: '9', size: '4' });
    await go();
    await expectEventually(heading, ['7B — kelompok Anda'], 'the heading');
    await expectEventually(
      async () =>
        textCount(phone().driver, '#cg-tables', '7B', { exact: false }),
      0,
      "textCount(phone().driver, '#cg-tables', '7B', { exact: false })",
    );
  });

  test('iOS mirror: a blank class name blocks nothing', async () => {
    announceMode(phone(), 'Indonesian blank class name');
    await phone().navigateToPath('/id/classroom-groups');
    await fill({ count: '9', size: '4' });
    await go();
    await expectEventually(heading, ['Kelompok Anda'], 'the heading');
    await expectEventually(
      async () => countOf(phone().driver, '#cg-results .group'),
      2,
      "countOf(phone().driver, '#cg-results .group')",
    );
  });
});

/** Types `value` into the control labelled `label`, as `getByLabel(label, { exact }).fill` does. */
const typeLabelled = async (
  label: string,
  value: string,
  match: NameMatch,
): Promise<void> => {
  const field = await byLabel(phone().driver, label, match);
  await phone().interaction.fill(field, value);
};

/** Sets the checkbox or radio labelled `label` in `scope` to `on`, as `check()`/`uncheck()` do. */
const setChecked = async (
  label: string,
  on: boolean,
  match: NameMatch,
): Promise<void> => {
  const box = await byLabel(phone().driver, label, match);
  await phone().interaction.setChecked(box, on);
};

const openGrouping = async (): Promise<void> =>
  phone().interaction.click(
    await phone().driver.findElement('#cg-grouping-toggle'),
  );

const makeGroups = async (): Promise<void> =>
  phone().interaction.click(
    await byRole(phone().driver, 'button', 'Make Groups', { exact: false }),
  );

const resultsStale = (): Promise<boolean> =>
  phone().driver.executeScript<boolean>(
    "return document.querySelector('#cg-results').classList.contains('stale');",
  );

const firstGroupShown = (): Promise<void> =>
  expectEventually(
    async () => (await visibilityOf(phone().driver, '#cg-results .group'))[0],
    true,
    'the first group shows',
  );

const outOfDateShown = (sentence: string): Promise<void> =>
  expectEventually(
    () => textMatchesOf(phone().driver, 'body', sentence, { exact: false }),
    [true],
    `"${sentence}" shows`,
  );

const noOutOfDate = (): Promise<void> =>
  expectEventually(
    async () =>
      (
        await textMatchesOf(phone().driver, 'body', 'out of date', {
          exact: false,
        })
      ).length,
    0,
    'no "out of date" text',
  );

/** The Android block's own `shuffle`: twelve students, three groups. */
const shuffleTwelve = async (): Promise<void> => {
  await typeLabelled('Number of students', '12', { exact: false });
  await go();
  await expectEventually(
    () => countOf(phone().driver, '#cg-results .group'),
    3,
    'three groups',
  );
};

const CLASS_LIST_CHANGED =
  'These groups are out of date — the class list changed.';
const SIZE_CHANGED = 'These groups are out of date — the group size changed.';
const LEFTOVERS_CHANGED =
  'These groups are out of date — the leftovers choice changed.';

describe('iOS mirror: out-of-date groups', () => {
  test('iOS mirror: changing the group size marks them out of date, naming the change', async () => {
    // NOT YET THE SAME as Android (#811): its controls are found by the
    // name roles.ts computes, a part of the ARIA naming rules, where
    // Android's getByRole and getByLabel run Playwright's own; getByText
    // is read by textMatchesOf, a restatement of Playwright's text engine.
    // Kept, never deleted (Shyden 2026-10-16), until #811 runs
    // Playwright's own code in Safari.
    announceMode(phone(), 'stale: group size');
    await phone().navigateToPath('/classroom-groups');
    await shuffleTwelve();
    await typeLabelled('Students in each group', '3', { exact: false });
    await outOfDateShown(SIZE_CHANGED);
  });

  test('iOS mirror: changing the leftovers choice marks them out of date', async () => {
    // NOT YET THE SAME as Android (#811): its controls are found by the
    // name roles.ts computes, a part of the ARIA naming rules, where
    // Android's getByRole and getByLabel run Playwright's own; getByText
    // is read by textMatchesOf, a restatement of Playwright's text engine.
    // Kept, never deleted (Shyden 2026-10-16), until #811 runs
    // Playwright's own code in Safari.
    announceMode(phone(), 'stale: leftovers choice');
    await phone().navigateToPath('/classroom-groups');
    await shuffleTwelve();
    await openGrouping();
    await setChecked('Put them all in one group', true, { exact: false });
    await outOfDateShown(LEFTOVERS_CHANGED);
  });

  test('iOS mirror: changing the number of students marks them out of date, naming the change', async () => {
    // NOT YET THE SAME as Android (#811): its controls are found by the
    // name roles.ts computes, a part of the ARIA naming rules, where
    // Android's getByRole and getByLabel run Playwright's own; getByText
    // is read by textMatchesOf, a restatement of Playwright's text engine.
    // Kept, never deleted (Shyden 2026-10-16), until #811 runs
    // Playwright's own code in Safari.
    announceMode(phone(), 'stale: student count');
    await phone().navigateToPath('/classroom-groups');
    await shuffleTwelve();
    await typeLabelled('Number of students', '30', { exact: false });
    await outOfDateShown(CLASS_LIST_CHANGED);
  });

  test('iOS mirror: undoing the count change clears it', async () => {
    // NOT YET THE SAME as Android (#811): its controls are found by the
    // name roles.ts computes, a part of the ARIA naming rules, where
    // Android's getByRole and getByLabel run Playwright's own; getByText
    // is read by textMatchesOf, a restatement of Playwright's text engine.
    // Kept, never deleted (Shyden 2026-10-16), until #811 runs
    // Playwright's own code in Safari.
    announceMode(phone(), 'stale: count undone');
    await phone().navigateToPath('/classroom-groups');
    await shuffleTwelve();
    await typeLabelled('Number of students', '30', { exact: false });
    await typeLabelled('Number of students', '12', { exact: false });
    await noOutOfDate();
  });

  test('iOS mirror: the class name does NOT mark them out of date', async () => {
    // NOT YET THE SAME as Android (#811): its controls are found by the
    // name roles.ts computes, a part of the ARIA naming rules, where
    // Android's getByRole and getByLabel run Playwright's own; getByText
    // is read by textMatchesOf, a restatement of Playwright's text engine.
    // Kept, never deleted (Shyden 2026-10-16), until #811 runs
    // Playwright's own code in Safari.
    announceMode(phone(), 'stale: class name ignored');
    await phone().navigateToPath('/classroom-groups');
    await shuffleTwelve();
    await typeLabelled('Class (optional)', '7B', { exact: false });
    await noOutOfDate();
  });

  test('iOS mirror: the old groups stay visible while stale', async () => {
    // NOT YET THE SAME as Android (#811): its controls are found by the
    // name roles.ts computes, a part of the ARIA naming rules, where
    // Android's getByRole and getByLabel run Playwright's own. Kept, never
    // deleted (Shyden 2026-10-16), until #811 runs Playwright's own code
    // in Safari.
    announceMode(phone(), 'stale: old groups kept');
    await phone().navigateToPath('/classroom-groups');
    await shuffleTwelve();
    await typeLabelled('Students in each group', '3', { exact: false });
    await expectEventually(
      async () => countOf(phone().driver, '#cg-results .group'),
      3,
      "countOf(phone().driver, '#cg-results .group')",
    );
  });

  test('iOS mirror: shuffling clears it', async () => {
    // NOT YET THE SAME as Android (#811): its controls are found by the
    // name roles.ts computes, a part of the ARIA naming rules, where
    // Android's getByRole and getByLabel run Playwright's own; getByText
    // is read by textMatchesOf, a restatement of Playwright's text engine.
    // Kept, never deleted (Shyden 2026-10-16), until #811 runs
    // Playwright's own code in Safari.
    announceMode(phone(), 'stale: cleared by shuffle');
    await phone().navigateToPath('/classroom-groups');
    await shuffleTwelve();
    await typeLabelled('Students in each group', '3', { exact: false });
    await go();
    await noOutOfDate();
  });

  test('iOS mirror: undoing the change clears it', async () => {
    // NOT YET THE SAME as Android (#811): its controls are found by the
    // name roles.ts computes, a part of the ARIA naming rules, where
    // Android's getByRole and getByLabel run Playwright's own; getByText
    // is read by textMatchesOf, a restatement of Playwright's text engine.
    // Kept, never deleted (Shyden 2026-10-16), until #811 runs
    // Playwright's own code in Safari.
    announceMode(phone(), 'stale: size undone');
    await phone().navigateToPath('/classroom-groups');
    await shuffleTwelve();
    await typeLabelled('Students in each group', '3', { exact: false });
    await typeLabelled('Students in each group', '4', { exact: false });
    await noOutOfDate();
  });

  for (const [what, edit] of [
    [
      'marking a student absent',
      async () =>
        setChecked('Absent', true, {
          exact: false,
          scope: await rowScope(phone(), 0),
        }),
    ],
    [
      'adding a student',
      async () =>
        phone().interaction.click(
          await byRole(phone().driver, 'button', 'Add student', {
            exact: false,
          }),
        ),
    ],
    [
      'removing a student',
      async () =>
        phone().interaction.click(
          await byRole(phone().driver, 'button', 'Remove', {
            exact: false,
            scope: await rowScope(phone(), 0),
          }),
        ),
    ],
    [
      'changing a letter',
      async () =>
        phone().interaction.select(
          await byLabel(phone().driver, 'Together', {
            exact: false,
            scope: await rowScope(phone(), 0),
          }),
          'A',
        ),
    ],
  ] as const) {
    test(`iOS mirror: ${what} marks the groups out of date`, async () => {
      // NOT YET THE SAME as Android (#811): its controls are found by the
      // name roles.ts computes, a part of the ARIA naming rules, where
      // Android's getByRole and getByLabel run Playwright's own; getByText
      // is read by textMatchesOf, a restatement of Playwright's text engine.
      // Kept, never deleted (Shyden 2026-10-16), until #811 runs
      // Playwright's own code in Safari.
      announceMode(phone(), `stale: ${what}`);
      await openRoster(phone());
      await addSeveral(phone(), 11);
      await giveEveryoneASex(phone());
      await makeGroups();
      await firstGroupShown();
      await edit();
      await outOfDateShown(CLASS_LIST_CHANGED);
    });
  }

  test('iOS mirror: marking a student present again marks the groups out of date', async () => {
    // NOT YET THE SAME as Android (#811): its controls are found by the
    // name roles.ts computes, a part of the ARIA naming rules, where
    // Android's getByRole and getByLabel run Playwright's own; getByText
    // is read by textMatchesOf, a restatement of Playwright's text engine.
    // Kept, never deleted (Shyden 2026-10-16), until #811 runs
    // Playwright's own code in Safari.
    announceMode(phone(), 'stale: present again');
    await openRoster(phone());
    await addSeveral(phone(), 11);
    await setChecked('Absent', true, {
      exact: false,
      scope: await rowScope(phone(), 0),
    });
    await giveEveryoneASex(phone());
    await makeGroups();
    await firstGroupShown();
    await setChecked('Absent', false, {
      exact: false,
      scope: await rowScope(phone(), 0),
    });
    await outOfDateShown(CLASS_LIST_CHANGED);
  });

  test('iOS mirror: changing a sex under a sex option marks the groups out of date', async () => {
    // NOT YET THE SAME as Android (#811): its controls are found by the
    // name roles.ts computes, a part of the ARIA naming rules, where
    // Android's getByRole and getByLabel run Playwright's own; getByText
    // is read by textMatchesOf, a restatement of Playwright's text engine.
    // Kept, never deleted (Shyden 2026-10-16), until #811 runs
    // Playwright's own code in Safari.
    announceMode(phone(), 'stale: sex changed');
    await buildRoster(phone(), [
      ['M'],
      ['M'],
      ['M'],
      ['M'],
      ['F'],
      ['F'],
      ['F'],
      ['F'],
    ]);
    await openGrouping();
    await setChecked('Keep boys and girls separate', true, { exact: false });
    await giveEveryoneASex(phone());
    await makeGroups();
    await firstGroupShown();
    await setSex(phone(), 0, 'F');
    await outOfDateShown(CLASS_LIST_CHANGED);
  });

  test('iOS mirror: turning a sex option on marks the groups out of date, naming the change', async () => {
    // NOT YET THE SAME as Android (#811): its controls are found by the
    // name roles.ts computes, a part of the ARIA naming rules, where
    // Android's getByRole and getByLabel run Playwright's own; getByText
    // is read by textMatchesOf, a restatement of Playwright's text engine.
    // Kept, never deleted (Shyden 2026-10-16), until #811 runs
    // Playwright's own code in Safari.
    announceMode(phone(), 'stale: sex option on');
    await buildRoster(phone(), [
      ['M'],
      ['M'],
      ['M'],
      ['M'],
      ['F'],
      ['F'],
      ['F'],
      ['F'],
    ]);
    await giveEveryoneASex(phone());
    await makeGroups();
    await firstGroupShown();
    await openGrouping();
    await setChecked('Keep boys and girls separate', true, { exact: false });
    await outOfDateShown(
      'These groups are out of date — how boys and girls are grouped changed.',
    );
  });

  test('iOS mirror: a rename does not mark the groups out of date', async () => {
    // NOT YET THE SAME as Android (#811): its controls are found by the
    // name roles.ts computes, a part of the ARIA naming rules, where
    // Android's getByRole and getByLabel run Playwright's own; getByText
    // is read by textMatchesOf, a restatement of Playwright's text engine.
    // Kept, never deleted (Shyden 2026-10-16), until #811 runs
    // Playwright's own code in Safari.
    announceMode(phone(), 'stale: rename ignored');
    await openRoster(phone());
    await addSeveral(phone(), 11);
    await giveEveryoneASex(phone());
    await makeGroups();
    await firstGroupShown();
    const name = await byLabel(phone().driver, 'Name', {
      exact: false,
      scope: await rowScope(phone(), 0),
    });
    await phone().interaction.fill(name, 'Anna');
    await noOutOfDate();
    await expectEventually(
      async () =>
        (await textsOf(phone().driver, '#cg-results'))[0].includes('Anna'),
      true,
      'the results show Anna',
    );
  });

  test('iOS mirror: when two things change, undoing one still names the other', async () => {
    // NOT YET THE SAME as Android (#811): its controls are found by the
    // name roles.ts computes, a part of the ARIA naming rules, where
    // Android's getByRole and getByLabel run Playwright's own; getByText
    // is read by textMatchesOf, a restatement of Playwright's text engine.
    // Kept, never deleted (Shyden 2026-10-16), until #811 runs
    // Playwright's own code in Safari.
    announceMode(phone(), 'stale: one of two undone');
    await phone().navigateToPath('/classroom-groups');
    await shuffleTwelve();
    await typeLabelled('Students in each group', '3', { exact: false });
    await openGrouping();
    await setChecked('Put them all in one group', true, { exact: false });
    await typeLabelled('Students in each group', '4', { exact: false });
    await outOfDateShown(LEFTOVERS_CHANGED);
    await expectEventually(async () => resultsStale(), true, 'resultsStale()');
  });

  test('iOS mirror: when two things change, undoing both clears it', async () => {
    // NOT YET THE SAME as Android (#811): its controls are found by the
    // name roles.ts computes, a part of the ARIA naming rules, where
    // Android's getByRole and getByLabel run Playwright's own; getByText
    // is read by textMatchesOf, a restatement of Playwright's text engine.
    // Kept, never deleted (Shyden 2026-10-16), until #811 runs
    // Playwright's own code in Safari.
    announceMode(phone(), 'stale: both undone');
    await phone().navigateToPath('/classroom-groups');
    await shuffleTwelve();
    await typeLabelled('Students in each group', '3', { exact: false });
    await openGrouping();
    await setChecked('Put them all in one group', true, { exact: false });
    await typeLabelled('Students in each group', '4', { exact: false });
    await setChecked('Share them out evenly', true, { exact: false });
    await noOutOfDate();
    await expectEventually(async () => resultsStale(), false, 'resultsStale()');
  });

  test('iOS mirror: the notice element itself carries the exact sentence', async () => {
    // NOT YET THE SAME as Android (#811): its controls are found by the
    // name roles.ts computes, a part of the ARIA naming rules, where
    // Android's getByRole and getByLabel run Playwright's own. Kept, never
    // deleted (Shyden 2026-10-16), until #811 runs Playwright's own code
    // in Safari.
    announceMode(phone(), 'stale: exact sentence');
    await phone().navigateToPath('/classroom-groups');
    await shuffleTwelve();
    await typeLabelled('Students in each group', '3', { exact: false });
    await expectEventually(
      () => textsOf(phone().driver, '#cg-stale-text'),
      [SIZE_CHANGED],
      'the notice sentence',
    );
  });

  test('iOS mirror: the notice offers its own way to reshuffle, without hunting for the main button', async () => {
    // NOT YET THE SAME as Android (#811): its controls are found by the
    // name roles.ts computes, a part of the ARIA naming rules, where
    // Android's getByRole and getByLabel run Playwright's own. Kept, never
    // deleted (Shyden 2026-10-16), until #811 runs Playwright's own code
    // in Safari.
    announceMode(phone(), 'stale: notice reshuffle');
    await phone().navigateToPath('/classroom-groups');
    await shuffleTwelve();
    await typeLabelled('Students in each group', '3', { exact: false });
    await expectEventually(
      () => visibilityOf(phone().driver, '#cg-stale'),
      [true],
      'the notice shows',
    );
    await phone().interaction.click(
      await phone().driver.findElement('#cg-stale button'),
    );
    await expectEventually(
      () => visibilityOf(phone().driver, '#cg-stale'),
      [false],
      'the notice hides',
    );
    await expectEventually(
      () => countOf(phone().driver, '#cg-results .group'),
      4,
      'four groups',
    );
  });

  test('iOS mirror: the old groups are visually dimmed while stale, not merely still present', async () => {
    // NOT YET THE SAME as Android (#811): its controls are found by the
    // name roles.ts computes, a part of the ARIA naming rules, where
    // Android's getByRole and getByLabel run Playwright's own. Kept, never
    // deleted (Shyden 2026-10-16), until #811 runs Playwright's own code
    // in Safari.
    announceMode(phone(), 'stale: dimmed');
    await phone().navigateToPath('/classroom-groups');
    await shuffleTwelve();
    const opacity = (): Promise<string> =>
      phone().driver.executeScript<string>(
        "return getComputedStyle(document.querySelector('#cg-results .group')).opacity;",
      );
    const before = await opacity();
    await typeLabelled('Students in each group', '3', { exact: false });
    await expectEventually(resultsStale, true, 'the results are stale');
    expect(Number(await opacity())).toBeLessThan(Number(before));
  });

  for (const theme of THEMES)
    test(`iOS mirror: ${theme}, saved: the dim stays above the WCAG AA contrast floor for normal text`, async () => {
      announceMode(phone(), `stale: dim contrast (${theme})`);
      // NOT YET THE SAME as Android (#811): Android emulates the device colour
      // scheme; WebDriver cannot, so the theme is the SAVED choice. Kept, never
      // deleted (Shyden 2026-10-16), until #811 sets the phone's appearance.
      await phone().navigateToPath('/classroom-groups', '#cg-go', theme);
      await shuffleTwelve();
      await typeLabelled('Students in each group', '3', { exact: false });
      await expectEventually(resultsStale, true, 'the results are stale');
      const [group] = await paintedTextOf(phone().driver, '#cg-results .group');
      expect(paintedContrast(group)).toBeGreaterThanOrEqual(4.5);
    });

  for (const theme of THEMES)
    test(`iOS mirror: ${theme}, saved: the out-of-date sentence meets the WCAG AA contrast floor`, async () => {
      announceMode(phone(), `stale: sentence contrast (${theme})`);
      // NOT YET THE SAME as Android (#811): Android emulates the device colour
      // scheme; WebDriver cannot, so the theme is the SAVED choice. Kept, never
      // deleted (Shyden 2026-10-16), until #811 sets the phone's appearance.
      await phone().navigateToPath('/classroom-groups', '#cg-go', theme);
      await shuffleTwelve();
      await typeLabelled('Students in each group', '3', { exact: false });
      await expectEventually(
        () => visibilityOf(phone().driver, '#cg-stale-text'),
        [true],
        'the sentence shows',
      );
      await expectEventually(
        async () => textsOf(phone().driver, '#cg-stale-text'),
        [SIZE_CHANGED],
        "textsOf(phone().driver, '#cg-stale-text')",
      );
      const [sentence] = await paintedTextOf(phone().driver, '#cg-stale-text');
      expect(paintedContrast(sentence)).toBeGreaterThanOrEqual(4.5);
      await shootDevice(phone().driver, {
        project: 'ios-safari-real-device',
        label: `${theme}: the out-of-date sentence on its cream notice`,
      });
    });

  test('iOS mirror: the reason reads in Indonesian, as a whole sentence', async () => {
    // NOT YET THE SAME as Android (#811): its controls are found by the
    // name roles.ts computes, a part of the ARIA naming rules, where
    // Android's getByRole and getByLabel run Playwright's own. Kept, never
    // deleted (Shyden 2026-10-16), until #811 runs Playwright's own code
    // in Safari.
    announceMode(phone(), 'stale: Indonesian size reason');
    await phone().navigateToPath('/id/classroom-groups');
    await typeLabelled('Jumlah siswa', '12', { exact: false });
    await go();
    await expectEventually(
      () => countOf(phone().driver, '#cg-results .group'),
      3,
      'three groups',
    );
    await typeLabelled('Siswa dalam setiap kelompok', '3', { exact: false });
    await expectEventually(
      () => textsOf(phone().driver, '#cg-stale-text'),
      ['Kelompok ini sudah tidak berlaku lagi — ukuran kelompok berubah.'],
      'the Indonesian size reason',
    );
  });

  test('iOS mirror: the leftovers-choice reason reads in Indonesian, as a whole sentence', async () => {
    // NOT YET THE SAME as Android (#811): its controls are found by the
    // name roles.ts computes, a part of the ARIA naming rules, where
    // Android's getByRole and getByLabel run Playwright's own. Kept, never
    // deleted (Shyden 2026-10-16), until #811 runs Playwright's own code
    // in Safari.
    announceMode(phone(), 'stale: Indonesian leftovers reason');
    await phone().navigateToPath('/id/classroom-groups');
    await typeLabelled('Jumlah siswa', '12', { exact: false });
    await go();
    await expectEventually(
      () => countOf(phone().driver, '#cg-results .group'),
      3,
      'three groups',
    );
    await openGrouping();
    await setChecked('Masukkan semuanya ke satu kelompok', true, {
      exact: true,
    });
    await expectEventually(
      () => textsOf(phone().driver, '#cg-stale-text'),
      [
        'Kelompok ini sudah tidak berlaku lagi — pilihan siswa tersisa berubah.',
      ],
      'the Indonesian leftovers reason',
    );
  });

  test('iOS mirror: the class-list reason reads in Indonesian, as a whole sentence', async () => {
    // NOT YET THE SAME as Android (#811): its controls are found by the
    // name roles.ts computes, a part of the ARIA naming rules, where
    // Android's getByRole and getByLabel run Playwright's own. Kept, never
    // deleted (Shyden 2026-10-16), until #811 runs Playwright's own code
    // in Safari.
    announceMode(phone(), 'stale: Indonesian class-list reason');
    await phone().navigateToPath('/id/classroom-groups');
    await typeLabelled('Jumlah siswa', '12', { exact: false });
    await go();
    await expectEventually(
      () => countOf(phone().driver, '#cg-results .group'),
      3,
      'three groups',
    );
    await typeLabelled('Jumlah siswa', '30', { exact: false });
    await expectEventually(
      () => textsOf(phone().driver, '#cg-stale-text'),
      ['Kelompok ini sudah tidak berlaku lagi — daftar kelas berubah.'],
      'the Indonesian class-list reason',
    );
  });
});

const pathname = (): Promise<string> =>
  phone().driver.executeScript<string>('return location.pathname;');

describe('iOS mirror: site-wide language switching', () => {
  test('iOS mirror: the switcher moves between the two versions of the SAME page', async () => {
    announceMode(phone(), 'language switcher');
    const open = async (): Promise<void> =>
      phone().interaction.click(
        await phone().driver.findElement(
          'header details.lang-switch > summary',
        ),
      );
    const choose = async (): Promise<void> =>
      phone().interaction.click(
        await phone().driver.findElement('header details.lang-switch li a'),
      );
    await phone().navigateToPath('/classroom-groups');
    await open();
    await choose();
    await expectEventually(
      async () => /\/id\/classroom-groups\/?$/.test(await pathname()),
      true,
      'on the Indonesian page',
    );
    await open();
    await choose();
    await expectEventually(
      async () => /^\/classroom-groups\/?$/.test(await pathname()),
      true,
      'back on the English page',
    );
  });

  for (const [path, heading, english] of [
    [
      '/id/',
      getSiteStrings('id').home.heroHeading,
      getSiteStrings('en').home.heroHeading,
    ],
    [
      '/id/yeetalk-calculators',
      getSiteStrings('id').calculators.heading,
      getSiteStrings('en').calculators.heading,
    ],
  ] as const) {
    test(`iOS mirror: ${path} is translated`, async () => {
      announceMode(phone(), `${path} translated`);
      expect(heading).not.toBe(english);
      await phone().navigateToPath(path, 'h1');
      await expectEventually(
        async () => attributesOf(phone().driver, 'html', 'lang'),
        ['id'],
        "attributesOf(phone().driver, 'html', 'lang')",
      );
      await expectEventually(
        async () => textsOf(phone().driver, 'h1'),
        [heading],
        "textsOf(phone().driver, 'h1')",
      );
    });
  }

  test('iOS mirror: Indonesian nav links stay inside Indonesian — and read as Indonesian', async () => {
    announceMode(phone(), 'Indonesian nav');
    await phone().navigateToPath('/id/', 'nav');
    await expectEventually(
      async () => countOf(phone().driver, 'nav a[href="/id/#shytalk"]'),
      1,
      'countOf(phone().driver, \'nav a[href="/id/#shytalk"]\')',
    );
    await expectEventually(
      async () => textsOf(phone().driver, 'nav a'),
      ['ShyTalk', 'Yawelo Idle', 'Alat', 'Kontak'],
      "textsOf(phone().driver, 'nav a')",
    );
  });

  describe('iOS mirror: what each page tells a search engine', () => {
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
      [
        '/yeetalk-calculators',
        '/yeetalk-calculators/',
        '/id/yeetalk-calculators/',
        'en_GB',
      ],
      [
        '/id/yeetalk-calculators',
        '/id/yeetalk-calculators/',
        '/yeetalk-calculators/',
        'id_ID',
      ],
    ] as const) {
      test(`iOS mirror: ${path}`, async () => {
        announceMode(phone(), `search-engine tags on ${path}`);
        await phone().navigateToPath(path, 'h1');
        const isId = locale === 'id_ID';
        const read = (selector: string, name: string) =>
          attributesOf(phone().driver, selector, name);
        await expectEventually(
          async () => read('link[rel="canonical"]', 'href'),
          [SITE + self],
          "read('link[rel=\"canonical\"]', 'href')",
        );
        await expectEventually(
          async () => read('link[rel="alternate"][hreflang="id"]', 'href'),
          [SITE + (isId ? self : other)],
          'read(\'link[rel="alternate"][hreflang="id"]\', \'href\')',
        );
        await expectEventually(
          async () => read('link[rel="alternate"][hreflang="en"]', 'href'),
          [SITE + (isId ? other : self)],
          'read(\'link[rel="alternate"][hreflang="en"]\', \'href\')',
        );
        await expectEventually(
          async () =>
            read('link[rel="alternate"][hreflang="x-default"]', 'href'),
          [SITE + (isId ? other : self)],
          'read(\'link[rel="alternate"][hreflang="x-default"]\', \'href\')',
        );
        await expectEventually(
          async () => read('meta[property="og:locale"]', 'content'),
          [locale],
          "read('meta[property=\"og:locale\"]', 'content')",
        );
        await expectEventually(
          async () => read('meta[property="og:url"]', 'content'),
          [SITE + self],
          "read('meta[property=\"og:url\"]', 'content')",
        );
      });
    }
  });
});

describe('iOS mirror: the no-scroll rule, measured', () => {
  for (const theme of THEMES)
    test(`iOS mirror: ${theme}, saved: the accent colour still meets the WCAG AA contrast floor`, async () => {
      announceMode(phone(), `accent contrast (${theme})`);
      // NOT YET THE SAME as Android (#811): Android emulates the device colour
      // scheme; WebDriver cannot, so the theme is the SAVED choice. Kept, never
      // deleted (Shyden 2026-10-16), until #811 sets the phone's appearance.
      await phone().navigateToPath('/classroom-groups', '#cg-go', theme);
      const [button] = await paintedTextOf(phone().driver, '#cg-go');
      expect(paintedContrast(button)).toBeGreaterThanOrEqual(4.5);
    });

  test('iOS mirror: the homepage ships the theme script and nothing else', async () => {
    announceMode(phone(), 'homepage scripts');
    // NOT YET THE SAME as Android (#811): Android records the network; Safari's
    // WebDriver has none, so this reads Resource Timing. Kept, never deleted
    // (Shyden 2026-10-16), until #811 gives it Android's own mechanism.
    await phone().navigateToPath('/', 'h1');
    const scripts = await phone().driver.executeScript<
      { src: string; text: string }[]
    >(
      `return Array.from(document.scripts, (script) => ({
         src: script.getAttribute('src') ?? '',
         text: script.textContent ?? '',
       }));`,
    );
    expect(scripts, 'the homepage carries the theme script alone').toEqual([
      { src: '', text: THEME_SCRIPT_SOURCE },
    ]);
    // Resource Timing, as requestsSoFar reads it: Safari's WebDriver has no
    // network log (#811), and the page's own record names each fetch's kind.
    const { heard, scriptsFetched } = await phone().driver.executeScript<{
      heard: { url: string; kind: string }[];
      scriptsFetched: { url: string; kind: string }[];
    }>(
      `const entries = performance.getEntriesByType('resource')
         .filter((e) => ['link', 'script', 'fetch', 'xmlhttprequest', 'css'].includes(e.initiatorType))
         .map((e) => ({ url: e.name, kind: e.initiatorType }));
       const heard = [{ url: location.href, kind: 'document' }, ...entries];
       return { heard, scriptsFetched: heard.filter((e) => e.kind === 'script') };`,
    );
    expect(
      searched(scriptsFetched, {
        of: heard,
        what: 'requests the homepage made',
      }),
      'the homepage fetches no script',
    ).toEqual([]);
    expect(
      floorBreach('ios-classroom-groups/homepage-requests', heard.length),
    ).toBeUndefined();
  });
});

/**
 * Android's `listedByThisBrowser`, asked of Safari: the expected sentence
 * with Node's list of `names` replaced by the one this browser's own
 * `Intl.ListFormat` writes, which is the one the page renders.
 */
const listedBySafari = async (
  locale: Locale,
  names: readonly string[],
  expected: string,
): Promise<string> => {
  const { numberLocale } = LOCALE_METADATA[locale];
  const inNode = new Intl.ListFormat(numberLocale, {
    type: 'conjunction',
  }).format(names);
  const inSafari = await phone().driver.executeScript<string>(
    "return new Intl.ListFormat(arguments[0], { type: 'conjunction' }).format(arguments[1]);",
    [numberLocale, [...names]],
  );
  expect(expected.split(inNode), `the list "${inNode}", once`).toHaveLength(2);
  return expected.replace(inNode, () => inSafari);
};

describe('iOS mirror: every language renders its own messages', () => {
  for (const locale of LOCALES) {
    test(`iOS mirror: ${locale}: numbers, groups, a summary, a refusal and a list`, async () => {
      // NOT YET THE SAME as Android (#811): its controls are found by the
      // name roles.ts computes, a part of the ARIA naming rules, where
      // Android's getByRole and getByLabel run Playwright's own. Kept, never
      // deleted (Shyden 2026-10-16), until #811 runs Playwright's own code
      // in Safari.
      announceMode(phone(), `own messages (${locale})`);
      const t = getStrings(locale);
      const english = getStrings(DEFAULT_LOCALE);
      const path = localisePath('/classroom-groups', locale);
      const notEnglish = (own: string, inEnglish: string): void => {
        if (locale !== DEFAULT_LOCALE) expect(own).not.toBe(inEnglish);
      };
      const shoot = (label: string): Promise<string | null> =>
        shootDevice(phone().driver, {
          project: 'ios-safari-real-device',
          label,
        });

      await phone().navigateToPath(path);
      await fill({ count: '4', size: '2' });
      await go();
      await expectEventually(
        async () =>
          (await textsOf(phone().driver, '#cg-results .student')).sort(),
        [1, 2, 3, 4].map((n) => t.studentNumber({ n })).sort(),
        'four numbered students',
      );
      notEnglish(t.studentNumber({ n: 1 }), english.studentNumber({ n: 1 }));
      expect((await textsOf(phone().driver, '#cg-results .group h3'))[0]).toBe(
        t.groupLabel({ n: 1 }),
      );
      notEnglish(t.groupLabel({ n: 1 }), english.groupLabel({ n: 1 }));
      await shoot('students and groups are numbered in the page language');

      const summary = t.resultsSummary({ groups: 2, students: 4 });
      await expectEventually(
        async () => textsOf(phone().driver, '#cg-summary'),
        [summary],
        "textsOf(phone().driver, '#cg-summary')",
      );
      notEnglish(summary, english.resultsSummary({ groups: 2, students: 4 }));
      await shoot('the summary counts in the page language');

      await fill({ count: '100000000', size: '4' });
      await go();
      const refusal = t.errors.TOO_MANY_STUDENTS({ max: 100 });
      await expectEventually(
        () => textsOf(phone().driver, '#cg-error'),
        [refusal],
        'the refusal',
      );
      notEnglish(refusal, english.errors.TOO_MANY_STUDENTS({ max: 100 }));
      await shoot('a refusal carries its value in the page language');

      await phone().navigateToPath(path);
      await phone().interaction.click(
        await phone().driver.findElement('#cg-students-toggle'),
      );
      const add = await byRole(
        phone().driver,
        'button',
        t.rosterAddStudent.replace(/^[+\s]+/, ''),
        { exact: false },
      );
      await phone().interaction.click(add);
      await phone().interaction.click(add);
      await expectEventually(
        () => countOf(phone().driver, '.cg-student'),
        2,
        'two roster rows',
      );
      const names = [t.studentNumber({ n: 1 }), t.studentNumber({ n: 2 })];
      const problem = await listedBySafari(
        locale,
        names,
        t.rosterNoSexMessage({ names }),
      );
      await expectEventually(
        async () => textsOf(phone().driver, '#cg-roster-problem'),
        [problem],
        "textsOf(phone().driver, '#cg-roster-problem')",
      );
      notEnglish(
        problem,
        english.rosterNoSexMessage({
          names: [
            english.studentNumber({ n: 1 }),
            english.studentNumber({ n: 2 }),
          ],
        }),
      );
      await shoot('a list of students is joined in the page language');
    });
  }
});

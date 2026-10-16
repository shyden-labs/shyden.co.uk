/**
 * Classroom Groups' privacy promises on the real iPhone: the tests
 * tests/e2e/classroom-groups-privacy.spec.ts runs on the real Android phone,
 * under the same titles with an `iOS mirror:` prefix (#813; global rule
 * 2026-10-15, every test mirrored, no exceptions).
 *
 * Tests that need what Safari's WebDriver lacks (a script run before the
 * page's first script, a request stubbed, a download or a second tab
 * observed) wait for #811; each is listed in `.superpowers/sdd/813/plan.md`,
 * none exempt.
 */
import { describe, expect, test } from 'vitest';
import { LOCALES, localisePath } from '../../../src/lib/i18n';
import { floorBreach } from '../../floors';
import { searched } from '../../source-files';
import {
  buildRoster,
  expectNothingStored,
  fill,
  giveEveryoneASex,
  rowScope,
  upload,
} from './classroom-groups';
import { countOf, expectEventually, textCount, textMatchesOf } from './dom';
import { shootDevice } from './evidence';
import { holdIosSession } from './held-session';
import { byLabel, byRole } from './roles';
import { announceMode } from './session';

const phone = holdIosSession();

const ROSTER_NAMES = ['Ana', 'Budi'] as const;

/** The only named controls the form may carry: two radio groups, neither personal. */
const NON_PERSONAL_NAMES = ['mode', 'leftovers'];

const value = (selector: string): Promise<string> =>
  phone().driver.executeScript<string>(
    'return document.querySelector(arguments[0]).value;',
    [selector],
  );

const shoot = (label: string): Promise<string | null> =>
  shootDevice(phone().driver, { project: 'ios-safari-real-device', label });

const makeGroups = async (): Promise<void> => {
  await phone().interaction.click(
    await byRole(phone().driver, 'button', 'Make Groups', { exact: false }),
  );
  await expectEventually(
    async () => (await countOf(phone().driver, '#cg-results .group')) > 0,
    true,
    'the first group shows',
  );
};

const openImport = async (): Promise<void> =>
  phone().interaction.click(await phone().driver.findElement('#cg-io-toggle'));

const rosterRowsAfterOpening = async (): Promise<number> => {
  await phone().interaction.click(
    await phone().driver.findElement('#cg-students-toggle'),
  );
  return countOf(phone().driver, '.cg-student');
};

describe('iOS mirror: privacy — the number fields are forgotten on reload', () => {
  test('iOS mirror: nothing a teacher types into the three fields survives a reload', async () => {
    announceMode(phone(), 'number fields forgotten');
    await phone().navigateToPath('/classroom-groups');
    await fill(phone(), '#cg-count', '25');
    await fill(phone(), '#cg-numbers-absent', '7, 12');
    await fill(phone(), '#cg-numbers-together', '3,9');
    await fill(phone(), '#cg-numbers-apart', '2,5');
    await expectEventually(
      async () => value('#cg-numbers-absent'),
      '7, 12',
      "value('#cg-numbers-absent')",
    );
    await expectEventually(
      async () => value('#cg-numbers-together'),
      '3,9',
      "value('#cg-numbers-together')",
    );
    await expectEventually(
      async () => value('#cg-numbers-apart'),
      '2,5',
      "value('#cg-numbers-apart')",
    );
    await shoot('all three fields hold what was typed');

    await phone().reload();
    await expectEventually(
      async () => value('#cg-numbers-absent'),
      '',
      "value('#cg-numbers-absent')",
    );
    await expectEventually(
      async () => value('#cg-numbers-together'),
      '',
      "value('#cg-numbers-together')",
    );
    await expectEventually(
      async () => value('#cg-numbers-apart'),
      '',
      "value('#cg-numbers-apart')",
    );
    await shoot('all three fields empty after a reload');
  });

  test('iOS mirror: and nothing about them is written to storage', async () => {
    announceMode(phone(), 'number fields not stored');
    await phone().navigateToPath('/classroom-groups');
    await fill(phone(), '#cg-count', '25');
    await fill(phone(), '#cg-numbers-absent', '7, 12');
    await expectEventually(
      async () => value('#cg-numbers-absent'),
      '7, 12',
      "value('#cg-numbers-absent')",
    );
    await phone().interaction.click(
      await phone().driver.findElement('#cg-sound-toggle'),
    );
    const sound = await phone().driver.findElement('#cg-sound-check');
    await phone().interaction.setChecked(sound, false);

    const stored = await phone().driver.executeScript<string[]>(
      `const dump = (store) =>
         Object.keys(store).map((key) => key + '=' + (store.getItem(key) ?? ''));
       return [...dump(localStorage), ...dump(sessionStorage)];`,
    );
    expect(
      stored.filter((entry) => entry.startsWith('cg-sound=')),
    ).toHaveLength(1);
    const leaked = stored.filter((entry) => entry.includes('12'));
    expect(
      searched(leaked, { of: stored, what: 'browser storage entries' }),
    ).toEqual([]);
    expect(
      floorBreach(
        'ios-classroom-groups-privacy/storage-entries',
        stored.length,
      ),
    ).toBeUndefined();
  });
});

describe('iOS mirror: privacy — the class list cannot leave the page', () => {
  /** One recorded floor per page: each counts its own named controls. */
  const NAMED_CONTROL_FLOORS: Record<string, string> = {
    '/classroom-groups': 'ios-classroom-groups-privacy/named-controls-en',
    '/id/classroom-groups': 'ios-classroom-groups-privacy/named-controls-id',
    '/zh/classroom-groups': 'ios-classroom-groups-privacy/named-controls-zh',
    '/vi/classroom-groups': 'ios-classroom-groups-privacy/named-controls-vi',
    '/th/classroom-groups': 'ios-classroom-groups-privacy/named-controls-th',
  };

  for (const path of LOCALES.map((locale) =>
    localisePath('/classroom-groups', locale),
  ))
    test(`iOS mirror: ${path}: no control holding typed text is submittable`, async () => {
      announceMode(phone(), `named controls on ${path}`);
      await phone().navigateToPath(path);
      const named = await phone().driver.executeScript<
        { name: string | null; type: string }[]
      >(
        `return Array.from(document.querySelectorAll('#cg-form [name]'), (el) => ({
           name: el.getAttribute('name'),
           type: el.type,
         }));`,
      );
      const leaky = named.filter((control) => control.type !== 'radio');
      expect(
        searched(leaky, { of: named, what: 'named form controls' }),
      ).toEqual([]);
      expect(
        floorBreach(NAMED_CONTROL_FLOORS[path], named.length),
      ).toBeUndefined();
      const radioNames = [...new Set(named.map((c) => c.name))].sort();
      expect(radioNames).toEqual([...NON_PERSONAL_NAMES].sort());
    });
});

describe('iOS mirror: privacy — the roster never leaves memory', () => {
  test('iOS mirror: nothing about the class is stored, after every operation', async () => {
    // NOT YET THE SAME as Android (#811): its controls are found by the
    // name roles.ts computes, a part of the ARIA naming rules, where
    // Android's getByRole and getByLabel run Playwright's own. Kept, never
    // deleted (Shyden 2026-10-16), until #811 runs Playwright's own code
    // in Safari.
    announceMode(phone(), 'roster never stored');
    await buildRoster(phone(), [
      ['F', 'Ana'],
      ['M', 'Budi'],
    ]);
    await expectNothingStored(
      phone(),
      'after building the roster',
      ...ROSTER_NAMES,
    );

    const absent = await byLabel(phone().driver, 'Absent', {
      exact: false,
      scope: await rowScope(phone(), 0),
    });
    await phone().interaction.setChecked(absent, true);
    await expectNothingStored(
      phone(),
      'after marking a student absent',
      ...ROSTER_NAMES,
    );

    await giveEveryoneASex(phone());
    await makeGroups();
    await expectNothingStored(phone(), 'after shuffling', ...ROSTER_NAMES);

    await phone().interaction.click(
      await phone().driver.findElement('#cg-sound-toggle'),
    );
    const sound = await phone().driver.findElement('#cg-sound-check');
    await phone().interaction.setChecked(sound, false);
    await expectEventually(
      () =>
        phone().driver.executeScript<string | null>(
          "return localStorage.getItem('cg-sound');",
        ),
      'off',
      'the sound preference is written',
    );
    await expectNothingStored(
      phone(),
      'after a preference was written',
      ...ROSTER_NAMES,
    );
  });

  test('iOS mirror: a reload loses the roster', async () => {
    // NOT YET THE SAME as Android (#811): its controls are found by the
    // name roles.ts computes, a part of the ARIA naming rules, where
    // Android's getByRole and getByLabel run Playwright's own. Kept, never
    // deleted (Shyden 2026-10-16), until #811 runs Playwright's own code
    // in Safari.
    announceMode(phone(), 'reload loses roster');
    await buildRoster(phone(), [['F', 'Ana']]);
    await phone().reload();
    await expectEventually(
      async () => rosterRowsAfterOpening(),
      0,
      'rosterRowsAfterOpening()',
    );
  });

  test('iOS mirror: two children called Ana are separated independently', async () => {
    // NOT YET THE SAME as Android (#811): its controls are found by the
    // name roles.ts computes, a part of the ARIA naming rules, where
    // Android's getByRole and getByLabel run Playwright's own; getByText
    // is read by textMatchesOf, a restatement of Playwright's text engine.
    // Kept, never deleted (Shyden 2026-10-16), until #811 runs
    // Playwright's own code in Safari.
    announceMode(phone(), 'two Anas');
    await buildRoster(phone(), [
      ['F', 'Ana'],
      ['F', 'Ana'],
      ['M', 'Budi'],
      ['M', 'Eko'],
    ]);
    for (const row of [0, 2])
      await phone().interaction.select(
        await byLabel(phone().driver, 'Apart', {
          exact: false,
          scope: await rowScope(phone(), row),
        }),
        'A',
      );
    const byGroups = await byLabel(phone().driver, 'Number of groups', {
      exact: false,
    });
    await phone().interaction.setChecked(byGroups, true);
    const howMany = await byLabel(phone().driver, 'How many groups', {
      exact: false,
    });
    await phone().interaction.fill(howMany, '2');
    await giveEveryoneASex(phone());
    await makeGroups();

    await expectEventually(
      async () =>
        textCount(phone().driver, '#cg-results .student', 'Ana', {
          exact: false,
        }),
      2,
      "textCount(phone().driver, '#cg-results .student', 'Ana', { exact: fals",
    );
    await expectEventually(
      async () => countOf(phone().driver, '#cg-results .student'),
      4,
      "countOf(phone().driver, '#cg-results .student')",
    );

    const groupsOf = (n: number): Promise<string[]> =>
      phone().driver.executeScript<string[]>(
        `return Array.from(document.querySelectorAll('#cg-results .group'))
           .filter((group) => group.querySelector('.student[data-number="' + arguments[0] + '"]'))
           .map((group) => group.querySelector('h3')?.textContent ?? '');`,
        [n],
      );
    const [anaGroup] = await groupsOf(1);
    const [budiGroup] = await groupsOf(3);
    expect(anaGroup).toMatch(/^Group \d+$/);
    expect(anaGroup).not.toBe(budiGroup);
    await expectEventually(
      async () => (await groupsOf(2)).length,
      1,
      'the group of student 2, once',
    );
  });
});

describe('iOS mirror: privacy — the roster still never persists, after the new paths', () => {
  test('iOS mirror: an import writes nothing', async () => {
    // NOT YET THE SAME as Android (#811): getByText is read by
    // textMatchesOf, a restatement of Playwright's text engine. Kept,
    // never deleted (Shyden 2026-10-16), until #811 runs Playwright's own
    // code in Safari.
    announceMode(phone(), 'import writes nothing');
    await phone().navigateToPath('/classroom-groups');
    await openImport();
    await upload(phone(), 'ok.csv', 'number,name\n1,Ana\n2,Budi\n');
    await expectEventually(
      () =>
        textMatchesOf(phone().driver, 'body', 'Imported 2 students.', {
          exact: false,
        }),
      [true],
      'the import is reported',
    );
    await expectNothingStored(phone(), 'after an import', ...ROSTER_NAMES);
  });

  test('iOS mirror: a reload after an import still loses the roster', async () => {
    // NOT YET THE SAME as Android (#811): getByText is read by
    // textMatchesOf, a restatement of Playwright's text engine. Kept,
    // never deleted (Shyden 2026-10-16), until #811 runs Playwright's own
    // code in Safari.
    announceMode(phone(), 'reload after import');
    await phone().navigateToPath('/classroom-groups');
    await openImport();
    await upload(phone(), 'ok.csv', 'number,name\n1,Ana\n');
    await expectEventually(
      () =>
        textMatchesOf(phone().driver, 'body', 'Imported 1 student.', {
          exact: false,
        }),
      [true],
      'the import is reported',
    );
    await phone().reload();
    await expectEventually(
      async () => rosterRowsAfterOpening(),
      0,
      'rosterRowsAfterOpening()',
    );
  });
});

/**
 * The Classroom Groups starting states on the real iPhone, the same ones
 * tests/e2e/helpers.ts and tests/make-groups.ts build on Android (#813):
 * `openRoster`, `addSeveral`, `buildRoster`, `giveEveryoneASex`, `setSex`,
 * `markAbsent`, `chooseSpeed` and `openWaitingBoard`, each the same clicks in
 * the same order, found by the same accessible names (roles.ts), and driven
 * through `session.interaction`, so the canary's mode decides every input.
 * One home here, as helpers.ts is the one home on Android: two versions of
 * `openRoster` that differ by one click would be two different starting
 * states.
 */
import { expect } from 'vitest';
import {
  getStrings,
  localeFromPath,
  type Strings,
} from '../../../src/lib/i18n';
import { countOf, visibilityOf } from './dom';
import { byLabel, byRole } from './roles';
import type { DeviceSession } from './session';
import { waitFor } from './webdriver';

/** The tool's strings for the page the phone is on. */
export const stringsOn = async (phone: DeviceSession): Promise<Strings> =>
  getStrings(
    localeFromPath(
      await phone.driver.executeScript<string>('return location.pathname;'),
    ),
  );

/** Types `value` into `selector` as `page.fill` does: cleared, then typed. */
export const fill = async (
  phone: DeviceSession,
  selector: string,
  value: string,
): Promise<void> => {
  const field = await phone.driver.findElement(selector);
  await phone.interaction.fill(field, value);
};

export const openRoster = async (
  phone: DeviceSession,
  path = '/classroom-groups',
): Promise<void> => {
  await phone.navigateToPath(path);
  await phone.interaction.click(
    await phone.driver.findElement('#cg-students-toggle'),
  );
  const t = await stringsOn(phone);
  await phone.interaction.click(
    await byRole(phone.driver, 'button', t.rosterAddStudent, { exact: true }),
  );
};

export const addSeveral = async (
  phone: DeviceSession,
  howMany: number,
): Promise<void> => {
  const t = await stringsOn(phone);
  await phone.interaction.click(
    await byRole(phone.driver, 'button', t.rosterAddSeveral, { exact: true }),
  );
  const field = await byLabel(phone.driver, t.rosterHowMany, { exact: true });
  await phone.interaction.fill(field, String(howMany));
  await phone.interaction.click(
    await byRole(phone.driver, 'button', t.rosterAddConfirm, { exact: true }),
  );
};

/**
 * The `n`th match of `selector` (0-based), as Playwright's `.nth(n)` counts,
 * returned as a selector scope: the element is tagged in the page, since
 * `:nth-of-type` counts siblings by tag and would not be the same element.
 */
const nthScope = async (
  phone: DeviceSession,
  selector: string,
  n: number,
): Promise<string> => {
  const tagged = await phone.driver.executeScript<boolean>(
    `const el = document.querySelectorAll(arguments[0])[arguments[1]];
     if (!el) return false;
     el.setAttribute('data-ios-nth', arguments[2]);
     return true;`,
    [selector, n, `${selector}#${n}`],
  );
  if (!tagged) throw new Error(`no match ${n} of ${selector}`);
  return `[data-ios-nth=${JSON.stringify(`${selector}#${n}`)}]`;
};

/** Roster row `row` (0-based) as a selector scope, as `.cg-student`.nth(row) picks it. */
export const rowScope = (phone: DeviceSession, row: number): Promise<string> =>
  nthScope(phone, '.cg-student', row);

export const setSex = async (
  phone: DeviceSession,
  row: number,
  sex: 'M' | 'F',
): Promise<void> => {
  const t = await stringsOn(phone);
  await phone.interaction.select(
    await byLabel(phone.driver, t.rosterColSex, {
      exact: true,
      scope: await rowScope(phone, row),
    }),
    sex,
  );
};

export const giveEveryoneASex = async (
  phone: DeviceSession,
  sex: 'M' | 'F' = 'M',
): Promise<void> => {
  const rows = await countOf(phone.driver, '#cg-roster tbody tr');
  const t = await stringsOn(phone);
  for (let i = 0; i < rows; i++) {
    const select = await byLabel(phone.driver, t.rosterColSex, {
      exact: true,
      scope: await nthScope(phone, '#cg-roster tbody tr', i),
    });
    const value = await select.property('value');
    if (value === '') await phone.interaction.select(select, sex);
  }
};

export const markAbsent = async (
  phone: DeviceSession,
  path = '/classroom-groups',
): Promise<void> => {
  await openRoster(phone, path);
  const t = await stringsOn(phone);
  const box = await byLabel(phone.driver, t.rosterColAbsent, {
    exact: false,
    scope: await rowScope(phone, 0),
  });
  await phone.interaction.setChecked(box, true);
};

export const buildRoster = async (
  phone: DeviceSession,
  students: Array<['M' | 'F' | null, string?]>,
  path = '/classroom-groups',
): Promise<void> => {
  await openRoster(phone, path);
  if (students.length > 1) await addSeveral(phone, students.length - 1);
  const t = await stringsOn(phone);
  for (const [i, [sex, name]] of students.entries()) {
    if (name) {
      const field = await byLabel(phone.driver, t.rosterColName, {
        exact: true,
        scope: await rowScope(phone, i),
      });
      await phone.interaction.fill(field, name);
    }
    if (sex)
      await phone.interaction.select(
        await byLabel(phone.driver, t.rosterColSex, {
          exact: true,
          scope: await rowScope(phone, i),
        }),
        sex,
      );
  }
  expect(await countOf(phone.driver, '.cg-student')).toBe(students.length);
};

export const chooseSpeed = async (
  phone: DeviceSession,
  speed: 'normal' | 'fast' | 'skip' = 'skip',
): Promise<void> => {
  const [soundShown] = await visibilityOf(phone.driver, '#cg-sound-body');
  if (!soundShown)
    await phone.interaction.click(
      await phone.driver.findElement('#cg-sound-toggle'),
    );
  await phone.interaction.select(
    await phone.driver.findElement('#cg-speed'),
    speed,
  );
};

export const openWaitingBoard = async (
  phone: DeviceSession,
  count: string,
  size: string,
  speed?: 'normal' | 'fast' | 'skip',
): Promise<void> => {
  await phone.navigateToPath('/classroom-groups');
  await fill(phone, '#cg-count', count);
  await fill(phone, '#cg-size', size);
  if (speed) await chooseSpeed(phone, speed);
  await phone.interaction.click(
    await byRole(phone.driver, 'button', 'Full screen', { exact: false }),
  );
  await waitFor(
    async () =>
      (await phone.driver.executeScript<boolean>(
        "return !document.querySelector('#cg-board').hasAttribute('hidden');",
      ))
        ? true
        : undefined,
    { timeout: 5_000, describe: 'the board to open' },
  );
  expect(await countOf(phone.driver, '#cg-board .waiting-student')).toBe(
    Number(count),
  );
};

/**
 * Android's `upload`, on Safari: Playwright's `setInputFiles` bypasses the
 * native picker, and so does this. The file is made in the page and handed
 * to `#cg-import` through a `DataTransfer`, then `change` fires as a pick
 * would fire it.
 */
export const upload = async (
  phone: DeviceSession,
  name: string,
  body: string,
): Promise<void> => {
  const handed = await phone.driver.executeScript<number>(
    `const input = document.querySelector('#cg-import');
     const files = new DataTransfer();
     files.items.add(new File([arguments[1]], arguments[0], { type: 'text/csv' }));
     input.files = files.files;
     input.dispatchEvent(new Event('change', { bubbles: true }));
     return input.files.length;`,
    [name, body],
  );
  expect(handed, `${name} reached #cg-import`).toBe(1);
};

/**
 * Android's `expectNothingStored`: none of `names` in local or session
 * storage, the URL or the cookies, with the same two liveness controls (a
 * name to look for, and all four places read).
 */
export const expectNothingStored = async (
  phone: DeviceSession,
  when: string,
  ...names: readonly string[]
): Promise<void> => {
  expect(names.length, `${when}: no name to look for`).toBeGreaterThan(0);
  const stored = await phone.driver.executeScript<Record<string, string>>(
    `return {
       local: JSON.stringify({ ...localStorage }),
       session: JSON.stringify({ ...sessionStorage }),
       url: location.href,
       cookies: document.cookie,
     };`,
  );
  expect(
    Object.keys(stored),
    `${when}: the probe stopped reading somewhere a name could hide`,
  ).toEqual(['local', 'session', 'url', 'cookies']);
  for (const [where, value] of Object.entries(stored))
    for (const name of names)
      expect(value, `${where} — ${when}`).not.toContain(name);
};

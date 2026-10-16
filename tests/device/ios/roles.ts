/**
 * Controls found the way Playwright's `getByRole` and `getByLabel` find them,
 * by role and accessible name, on the real iPhone (#813). The Android specs
 * name controls ("Make Groups", the roster's "Sex" select) rather than
 * selecting them by id; the mirrors find the same control the same way, and
 * get a real `WebElement` back, so every click and keystroke still goes
 * through `session.interaction` and the canary's mode.
 *
 * The accessible name is the part of the ARIA name computation these pages
 * use: `aria-labelledby`, then `aria-label`, then the control's `<label>`s,
 * then its own text for buttons, links and summaries. Names match by
 * Playwright's rule, never a looser or stricter one (#821): whitespace
 * collapsed, then with `exact: true` the whole name, case included, and
 * without it any part of the name, ignoring case. `exact` is a REQUIRED
 * argument, so each call states the choice its Android call made.
 * `byRole` skips hidden controls as Playwright's role engine does (hidden by
 * `display`, `visibility` or an `aria-hidden` ancestor); `byLabel` does not,
 * as `getByLabel` does not. A name that matches no control, or more than
 * one, is refused, naming the count, as Playwright's strict mode refuses it.
 */
import { NAME_MATCHES_SOURCE, NORMALISE_SOURCE } from './playwright-rules';
import { expectEventually } from './dom';
import type { WebDriver, WebElement } from './webdriver';

/** The role selectors the specs use. */
const ROLE: Record<string, string> = {
  button: 'button, [role="button"], input[type="button"], input[type="submit"]',
  link: 'a[href]',
  checkbox: 'input[type="checkbox"], [role="checkbox"]',
  radio: 'input[type="radio"], [role="radio"]',
  textbox:
    'input:not([type]), input[type="text"], input[type="number"], input[type="search"], input[type="email"], textarea',
  combobox: 'select',
  heading: 'h1, h2, h3, h4, h5, h6',
  list: 'ul, ol',
};

/** In-page: the accessible name of `el`, as described above. */
const NAME_OF = `
  const norm = ${NORMALISE_SOURCE};
  const text = (el) => norm(el.textContent);
  const nameOf = (el) => {
    const by = el.getAttribute('aria-labelledby');
    if (by)
      return norm(by.split(/\\s+/).map((id) => {
        const target = document.getElementById(id);
        return target ? text(target) : '';
      }).join(' '));
    const aria = el.getAttribute('aria-label');
    if (aria) return norm(aria);
    if (el.labels && el.labels.length)
      return norm(Array.from(el.labels, text).join(' '));
    if (el.matches('input[type="submit"], input[type="button"]')) return norm(el.value);
    if (el.matches('button, a, summary, [role="button"], h1, h2, h3, h4, h5, h6')) return text(el);
    return norm(el.getAttribute('title'));
  };
`;

const FIND = `${NAME_OF}
  const matchesName = ${NAME_MATCHES_SOURCE};
  const [selector, name, scope, what, exact, skipHidden] = arguments;
  const root = document.querySelector(scope);
  if (!root) return 'no scope ' + scope;
  const wanted = norm(name);
  const named = (el) => matchesName(nameOf(el), wanted, exact);
  const hidden = (el) =>
    !el.checkVisibility({ visibilityProperty: true }) || el.closest('[aria-hidden="true"]') !== null;
  const matches = Array.from(root.querySelectorAll(selector))
    .filter((el) => !(skipHidden && hidden(el)))
    .filter(named);
  if (matches.length !== 1) return matches.length + ' ' + what + ' named ' + JSON.stringify(name);
  return matches[0];
`;

/** How a name is matched, and where: `exact` as the Android call has it. */
export interface NameMatch {
  exact: boolean;
  scope?: string;
  /** `getByRole('heading', { level })`: only headings of this level. */
  level?: number;
}

/** The selector for `role`, narrowed to a heading `level` when one is asked for. */
const roleSelector = (role: keyof typeof ROLE, level?: number): string => {
  if (level !== undefined) {
    if (role !== 'heading')
      throw new Error(`level is a heading option, not ${role}'s`);
    return `h${level}, [role="heading"][aria-level="${level}"]`;
  }
  const selector = ROLE[role];
  if (selector === undefined) throw new Error(`no role selector for ${role}`);
  return selector;
};

/**
 * One round trip: the script returns the element, or a sentence counting what
 * it matched instead, which `findByScript`'s refusal then prints.
 */
const find = (
  driver: WebDriver,
  selector: string,
  name: string,
  { exact, scope = 'body' }: NameMatch,
  what: string,
  skipHidden: boolean,
): Promise<WebElement> =>
  driver.findByScript(
    FIND,
    [selector, name, scope, what, exact, skipHidden],
    `exactly one ${what} named ${JSON.stringify(name)} (exact: ${exact}) in ${scope}`,
  );

/** The one shown control of `role` named `name` inside `scope`: `getByRole(role, { name, exact })`. */
export const byRole = (
  driver: WebDriver,
  role: keyof typeof ROLE,
  name: string,
  match: NameMatch,
): Promise<WebElement> =>
  find(driver, roleSelector(role, match.level), name, match, role, true);

/** The one form control labelled `label` inside `scope`: `getByLabel(label, { exact })`. */
export const byLabel = (
  driver: WebDriver,
  label: string,
  match: NameMatch,
): Promise<WebElement> =>
  find(
    driver,
    'input, select, textarea, [role="checkbox"]',
    label,
    match,
    'control',
    false,
  );

/**
 * `expect(getByRole(role, { name, exact })).toHaveAttribute(attribute, value)`
 * (#821): retried for 5 s as Playwright retries it, the control found afresh
 * on every read, as a locator is re-resolved, so a control that appears late
 * passes and one never found fails naming why.
 */
export const expectRoleAttribute = (
  driver: WebDriver,
  role: keyof typeof ROLE,
  name: string,
  match: NameMatch,
  attribute: string,
  value: string,
): Promise<void> =>
  expectEventually(
    async () => {
      try {
        const control = await byRole(driver, role, name, match);
        return await driver.executeScript<string | null>(
          'return arguments[0].getAttribute(arguments[1]);',
          [driver.elementRef(control.elementId), attribute],
        );
      } catch (error) {
        return error instanceof Error ? error.message : String(error);
      }
    },
    value,
    `${role} named ${JSON.stringify(name)} ${attribute}`,
  );

/** In-page: every shown control of a role whose name matches, as its visible and checked state. */
const STATES = `${NAME_OF}
  const matchesName = ${NAME_MATCHES_SOURCE};
  const [selector, name, scope, , exact] = arguments;
  const root = document.querySelector(scope);
  if (!root) return [];
  const wanted = norm(name);
  const hidden = (el) =>
    !el.checkVisibility({ visibilityProperty: true }) || el.closest('[aria-hidden="true"]') !== null;
  return Array.from(root.querySelectorAll(selector))
    .filter((el) => !hidden(el) && matchesName(nameOf(el), wanted, exact))
    .map((el) => ({
      visible: el.getClientRects().length > 0 && getComputedStyle(el).visibility === 'visible',
      checked: el.checked === true || el.getAttribute('aria-checked') === 'true',
    }));
`;

/**
 * `expect(getByRole(role, { name, exact }))` (#821): every matching control
 * re-found on each read and retried for 5 s, as a Playwright locator is.
 * `toBeVisible` and `toBeChecked` expect exactly one match, as strict mode
 * does; `toBeChecked(false)` is `not.toBeChecked()`.
 */
export const expectRole = (
  driver: WebDriver,
  role: keyof typeof ROLE,
  name: string,
  { exact, scope = 'body', level }: NameMatch,
) => {
  const selector = roleSelector(role, level);
  const states = (): Promise<{ visible: boolean; checked: boolean }[]> =>
    driver.executeScript(STATES, [selector, name, scope, role, exact]);
  const named = `${role} named ${JSON.stringify(name)}`;
  return {
    toHaveCount: (count: number): Promise<void> =>
      expectEventually(
        async () => (await states()).length,
        count,
        `${named} count`,
      ),
    toBeVisible: (): Promise<void> =>
      expectEventually(
        async () => (await states()).map((s) => s.visible),
        [true],
        `${named} visible`,
      ),
    toBeChecked: (on: boolean): Promise<void> =>
      expectEventually(
        async () => (await states()).map((s) => s.checked),
        [on],
        `${named} checked`,
      ),
  };
};

/**
 * `expect(page.locator(selector)).toHaveAccessibleName(name)` (#821): the
 * name computed in the page as `nameOf` computes it, for the one match, and a
 * string name matched whole, as Playwright matches it; retried for 5 s.
 */
export const expectAccessibleName = (
  driver: WebDriver,
  selector: string,
  name: string,
): Promise<void> =>
  expectEventually(
    () =>
      driver.executeScript<string[]>(
        `${NAME_OF}
         return Array.from(document.querySelectorAll(arguments[0]), nameOf);`,
        [selector],
      ),
    [name],
    `${selector} accessible name`,
  );

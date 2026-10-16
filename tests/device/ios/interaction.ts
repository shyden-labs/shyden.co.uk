/**
 * The dual-mode interaction layer -- design doc
 * docs/superpowers/specs/2026-08-08-real-device-test-harness-design.md,
 * section 5a.
 *
 * Measured on this device (iPhone Air, iOS 27.0, build 24A5390f):
 * `element/click`, `element/value` and W3C `actions` all return SUCCESS
 * while having NO effect -- no on-screen change, no keyboard, no form
 * submission, confirmed across multiple elements and an unrelated site.
 * Ruled out by direct measurement (not assumed): the device is unlocked
 * (no passcode), awake (launching Safari via `devicectl` changes nothing),
 * and the page is visible/focused throughout. A WebDriver screenshot is
 * NOT evidence of an awake device -- it captures the page viewport, which
 * renders regardless.
 *
 * The fallback, verified working: driving interaction through
 * `execute/sync` by DOM dispatch -- calling `el.click()` in-page, and
 * setting `.value` then firing `input`/`change`. This still runs the
 * page's real handlers inside real WebKit, so it still catches real
 * rendering/logic defects on real Safari -- it does NOT exercise the
 * touch input path itself: taps actually reaching targets, focus-zoom,
 * momentum scroll are unverified in this mode. See `InteractionMode`.
 *
 * Nothing here is assumed for a given run: `detectInteractionMode` is a
 * canary that measures which mode this session actually needs, every
 * time, so if a future OS build restores real input injection the suite
 * notices and upgrades itself -- and says so (see session.ts, which logs
 * the outcome prominently).
 */
import type { WebDriver, WebElement } from './webdriver';
import { waitFor } from './webdriver';

export type InteractionMode = 'synthetic-touch' | 'dom-dispatch';

/**
 * One small interface, two implementations. Journeys are written once
 * against this and never branch on which mode is active -- see
 * journeys.journey.ts, which only ever calls `session.interaction.*`.
 */
export interface Interaction {
  readonly mode: InteractionMode;
  click(element: WebElement): Promise<void>;
  /** Appends `text` to whatever the element currently holds -- real keyboard semantics, not an overwrite. */
  type(element: WebElement, text: string): Promise<void>;
  clear(element: WebElement): Promise<void>;
  /** Chooses the `<select>`'s option whose value is `value`, as `selectOption` does (#813). */
  select(element: WebElement, value: string): Promise<void>;
  /**
   * Replaces the field's value as Playwright's `fill` does (#821): focus,
   * the whole value in one edit, ONE `input` event, no `change` (that waits
   * for blur), and a refusal on a disabled or read-only field. Not
   * `clear` + `type`, which fires two rounds of `input` and `change` with
   * an empty value between them, which Android's `page.fill` never does.
   */
  fill(element: WebElement, value: string): Promise<void>;
  /**
   * Playwright's `check()` (`on`) and `uncheck()` (`!on`): nothing if the
   * box already reads `on`, else one click, then a refusal if the click did
   * not leave it reading `on`, as Playwright refuses (#821).
   */
  setChecked(element: WebElement, on: boolean): Promise<void>;
}

/**
 * Playwright's actionability wait before a click (#821): the element is
 * attached, visible and enabled (not `:disabled`, no `aria-disabled`
 * ancestor), or the action fails naming what it waited for. Without it a
 * DOM-dispatched click on a disabled button does nothing and passes.
 */
const ACTIONABLE = `
  const el = arguments[0];
  if (!el.isConnected) return 'detached';
  if (!(el.checkVisibility({ visibilityProperty: true }) && el.getClientRects().length > 0)) return 'not visible';
  if (el.matches(':disabled') || el.closest('[aria-disabled="true"]') !== null) return 'not enabled';
  return 'ok';
`;

const waitActionable = async (
  driver: WebDriver,
  element: WebElement,
): Promise<void> => {
  const deadline = Date.now() + 5_000;
  let state = await driver.executeScript<string>(ACTIONABLE, [
    driver.elementRef(element.elementId),
  ]);
  while (state !== 'ok' && Date.now() < deadline) {
    await new Promise((settle) => setTimeout(settle, 100));
    state = await driver.executeScript<string>(ACTIONABLE, [
      driver.elementRef(element.elementId),
    ]);
  }
  if (state !== 'ok')
    throw new Error(`click: the element stayed ${state} for 5 s`);
};

/** In-page: Playwright's `fill`, as described on `Interaction.fill`. */
const FILL = `
  const el = arguments[0], value = arguments[1];
  if (el.disabled) throw new Error('fill: the field is disabled');
  if (el.readOnly) throw new Error('fill: the field is read-only');
  el.focus();
  const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, value);
  el.dispatchEvent(new InputEvent('input', {
    bubbles: true,
    inputType: value ? 'insertText' : 'deleteContentBackward',
    data: value || null,
  }));
`;

/**
 * Playwright's `check()` (`on`) and `uncheck()` (`!on`), for both modes:
 * nothing if the box already reads `on`, else one `click`, then a refusal if
 * the click did not leave it reading `on`, as Playwright refuses (#821).
 */
const setCheckedBy = async (
  click: (element: WebElement) => Promise<void>,
  element: WebElement,
  on: boolean,
): Promise<void> => {
  if ((await element.property('checked')) === on) return;
  await click(element);
  if ((await element.property('checked')) !== on)
    throw new Error(
      `Clicking the checkbox did not change its state to ${on ? 'checked' : 'unchecked'}`,
    );
};

/** The real WebDriver primitives -- used when the canary confirms they actually work. */
export class SyntheticTouchInteraction implements Interaction {
  readonly mode: InteractionMode = 'synthetic-touch';

  constructor(private readonly driver: WebDriver) {}

  async click(element: WebElement): Promise<void> {
    await waitActionable(this.driver, element);
    await element.click();
  }

  async type(element: WebElement, text: string): Promise<void> {
    await element.sendKeys(text);
  }

  async clear(element: WebElement): Promise<void> {
    await element.clear();
  }

  async select(element: WebElement, value: string): Promise<void> {
    // W3C WebDriver selects an option by clicking the <option> itself.
    const option = await this.driver.findByScript(
      `return Array.from(arguments[0].options).find((o) => o.value === arguments[1]) ?? null;`,
      [this.driver.elementRef(element.elementId), value],
      `the option ${JSON.stringify(value)}`,
    );
    await option.click();
  }

  async fill(element: WebElement, value: string): Promise<void> {
    await this.driver.executeScript(FILL, [
      this.driver.elementRef(element.elementId),
      value,
    ]);
  }

  async setChecked(element: WebElement, on: boolean): Promise<void> {
    await setCheckedBy((e) => this.click(e), element, on);
  }
}

/**
 * The fallback -- real DOM events, dispatched via `execute/sync` rather
 * than synthesized touch/keyboard hardware events. Still exercises the
 * page's actual `click`/`input`/`change` listeners in real WebKit; does
 * not exercise the touch/keyboard input PATH itself (see this file's own
 * module doc).
 */
export class DomDispatchInteraction implements Interaction {
  readonly mode: InteractionMode = 'dom-dispatch';

  constructor(private readonly driver: WebDriver) {}

  async click(element: WebElement): Promise<void> {
    await waitActionable(this.driver, element);
    await this.driver.executeScript(`arguments[0].click();`, [
      this.driver.elementRef(element.elementId),
    ]);
  }

  async type(element: WebElement, text: string): Promise<void> {
    await this.driver.executeScript(
      `var el = arguments[0];
       el.value = el.value + arguments[1];
       el.dispatchEvent(new Event('input', { bubbles: true }));
       el.dispatchEvent(new Event('change', { bubbles: true }));`,
      [this.driver.elementRef(element.elementId), text],
    );
  }

  async clear(element: WebElement): Promise<void> {
    await this.driver.executeScript(
      `var el = arguments[0];
       el.value = '';
       el.dispatchEvent(new Event('input', { bubbles: true }));
       el.dispatchEvent(new Event('change', { bubbles: true }));`,
      [this.driver.elementRef(element.elementId)],
    );
  }

  async select(element: WebElement, value: string): Promise<void> {
    const chosen = await this.driver.executeScript<boolean>(
      `var el = arguments[0], want = arguments[1];
       if (!Array.from(el.options).some(function (o) { return o.value === want; })) return false;
       el.value = want;
       el.dispatchEvent(new Event('input', { bubbles: true }));
       el.dispatchEvent(new Event('change', { bubbles: true }));
       return true;`,
      [this.driver.elementRef(element.elementId), value],
    );
    if (!chosen)
      throw new Error(`no option ${JSON.stringify(value)} to select`);
  }

  async fill(element: WebElement, value: string): Promise<void> {
    await this.driver.executeScript(FILL, [
      this.driver.elementRef(element.elementId),
      value,
    ]);
  }

  async setChecked(element: WebElement, on: boolean): Promise<void> {
    await setCheckedBy((e) => this.click(e), element, on);
  }
}

/**
 * The canary's fixture. A `data:` URL, not a new file shipped with the
 * site -- the canary needs zero product-page surface area, and must work
 * even if the dev server were down (it is a question about the DEVICE,
 * not about this project's pages). One button, one output node, one
 * listener: clicking the button is the only way `#out` ever changes.
 */
const CANARY_FIXTURE_HTML = `<!doctype html><html><body>
<button id="btn" type="button">canary</button>
<div id="out">UNCLICKED</div>
<script>
document.getElementById('btn').addEventListener('click', function () {
  document.getElementById('out').textContent = 'CLICKED';
});
</script>
</body></html>`;

const CANARY_URL = `data:text/html,${encodeURIComponent(CANARY_FIXTURE_HTML)}`;

/**
 * Navigates to the canary fixture, performs a click via `performClick`,
 * and reports whether the click's real effect (the listener actually
 * running) was observed within a bounded wait.
 *
 * Deliberately takes `performClick` as a parameter rather than hardcoding
 * a real `element/click` call: `detectInteractionMode` below calls this
 * with the real WebDriver click (what the canary actually decides the
 * session's mode from), but the SAME observe-and-wait logic can be, and
 * was, exercised with a DOM-dispatch click too -- proving this function
 * correctly reports `true` when a click genuinely lands and `false` when
 * it does not, in both directions, on this real device. See
 * task-3a-report.md, "Proving the canary both ways" for that proof's
 * real output; nothing about the device itself is faked here in either
 * case -- both are real clicks via real (if different) mechanisms against
 * a real fixture in real WebKit.
 */
export async function observeClickEffect(
  driver: WebDriver,
  performClick: (button: WebElement) => Promise<void>,
): Promise<boolean> {
  await driver.navigate(CANARY_URL);
  const button = await driver.findElement('#btn');
  await performClick(button);

  try {
    await waitFor(
      async () => {
        const out = await driver.findElement('#out');
        const text = await out.text();
        return text === 'CLICKED' ? true : undefined;
      },
      {
        timeout: 3_000,
        interval: 150,
        describe: 'canary #out to read CLICKED after a click',
      },
    );
    return true;
  } catch {
    return false;
  }
}

/**
 * The canary itself (design doc s5a): attempts a REAL `element/click` and
 * decides the session's interaction mode from whether it had any effect.
 * Nothing about the mode is assumed anywhere else in this harness -- see
 * session.ts, which calls this exactly once per run, before any journey,
 * and refuses to guess.
 */
export async function detectInteractionMode(
  driver: WebDriver,
): Promise<InteractionMode> {
  const clicked = await observeClickEffect(driver, (button) => button.click());
  return clicked ? 'synthetic-touch' : 'dom-dispatch';
}

export function createInteraction(
  driver: WebDriver,
  mode: InteractionMode,
): Interaction {
  return mode === 'synthetic-touch'
    ? new SyntheticTouchInteraction(driver)
    : new DomDispatchInteraction(driver);
}

/**
 * The exact, unmissable line this project's standard requires: "the mode
 * is named in the suite's output... a DOM-dispatch run is never reported
 * as though taps were taps." Called once, by session.ts, the moment the
 * mode is known.
 */
export function describeInteractionMode(mode: InteractionMode): string {
  const banner = `[iOS interaction mode] ${mode}`;
  return mode === 'synthetic-touch'
    ? `${banner} -- real synthetic touch/keyboard input confirmed working this run; the full interaction path, including touch delivery, is exercised.`
    : `${banner} -- real synthetic touch/keyboard input is NOT landing on this device right now (canary observed no effect from a real click). ` +
        'Interaction is driven by DOM dispatch instead (execute/sync: el.click(), and .value + input/change events) -- this still exercises real ' +
        'page logic and rendering in real WebKit, but the touch input PATH ITSELF is NOT covered by this run: taps actually reaching their ' +
        'targets, focus-triggered zoom, and momentum scroll are unverified.';
}

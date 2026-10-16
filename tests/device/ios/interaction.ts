/**
 * How the iPhone journeys tap and type -- design doc
 * docs/superpowers/specs/2026-08-08-real-device-test-harness-design.md,
 * section 5a, as changed by #838.
 *
 * Measured 2026-10-16 on the iPhone Air, iOS 27.0.1 (build 24A446), with a
 * fixture logging every event and its `isTrusted` (#838's comment): Safari's
 * own WebDriver delivers the PRESS of `element/click`, or of one W3C action
 * sequence holding press and release, and drops the RELEASE, so no click ever
 * fires. Press and release sent as two separate `POST /actions` calls, then
 * `DELETE /actions`, deliver the whole trusted tap a finger makes --
 * pointerdown, touchstart, pointerup, touchend, mousedown, mouseup, click --
 * 20 of 20 with taps 500 ms apart. (Back to back, one in 20 fell inside iOS's
 * double-tap window, which a person's finger meets too.) That split tap is
 * `realTap`, and every journey click goes through it.
 *
 * Before #838 the canary fell back to `el.click()` inside the page when a
 * real click had no effect, and every iPhone run since August ran that way:
 * the page's handlers were exercised, a finger's tap was not. That fallback
 * is gone for taps. The canary now measures the real tap, and a tap that does
 * not land fails the run by name (#838 AC2), never a quieter mode.
 *
 * Typing has no real path yet: `element/value` and W3C key actions, in one
 * call or one per key, leave a field focused by a real tap empty (measured
 * the same day). Text entry is therefore a MARKED STAND-IN -- the value is set
 * in the page and `input`/`change` fired -- and `describeInteractionMode`
 * says so in every run's output until a real path is found (#838).
 */
import type { WebDriver, WebElement } from './webdriver';
import { waitFor } from './webdriver';

/** The one mode a run may be in: real taps, with text entry a stand-in. */
export type InteractionMode = 'real-tap';

/** The W3C element-reference key safaridriver reads in an action's origin. */
const ELEMENT_KEY = 'element-6066-11e4-a52e-4f735466cecf';

/** A pointer input source; `mouse` is the type iOS turns into a touch. */
const finger = (actions: readonly unknown[]) => ({
  type: 'pointer',
  id: 'finger',
  parameters: { pointerType: 'mouse' },
  actions,
});

/**
 * A real tap at the centre of an element: press in one W3C action call,
 * release in a second, then release everything. One call holding both drops
 * the release on iOS 27.0.1 (#838), so the split is the mechanism, not style.
 */
export async function realTap(
  driver: WebDriver,
  elementId: string,
): Promise<void> {
  // A W3C action cannot press outside the viewport ("move target out of
  // bounds", measured on the iPhone). Playwright's click on the Android
  // scrolls into view and waits for the box to stop moving before it
  // presses, so this does the same: scroll, then resolve once the element's
  // box reads the same on two animation frames in a row.
  await driver.executeAsyncScript(
    `var el = arguments[0], done = arguments[arguments.length - 1];
     el.scrollIntoView({ block: 'center', inline: 'center', behavior: 'instant' });
     var last = '';
     (function settle() {
       var r = el.getBoundingClientRect(), now = [r.x, r.y, r.width, r.height].join();
       if (now === last) return done(true);
       last = now;
       requestAnimationFrame(settle);
     })();`,
    [driver.elementRef(elementId)],
  );
  await driver.performActions([
    finger([
      {
        type: 'pointerMove',
        duration: 0,
        origin: { [ELEMENT_KEY]: elementId },
        x: 0,
        y: 0,
      },
      { type: 'pointerDown', button: 0 },
    ]),
  ]);
  await driver.performActions([finger([{ type: 'pointerUp', button: 0 }])]);
  await driver.releaseActions();
}

/**
 * One small interface the journeys are written against; they never branch on
 * the mode -- see journeys.journey.ts, which only calls `session.interaction.*`.
 */
export interface Interaction {
  readonly mode: InteractionMode;
  click(element: WebElement): Promise<void>;
  /** Appends `text` to whatever the element currently holds -- real keyboard semantics, not an overwrite. */
  type(element: WebElement, text: string): Promise<void>;
  clear(element: WebElement): Promise<void>;
}

/**
 * Taps are real touches; text entry is the marked stand-in (no real typing
 * path on iOS 27.0.1 yet, #838): the value is set in the page and the
 * `input`/`change` listeners run in real WebKit.
 */
export class RealTapInteraction implements Interaction {
  readonly mode: InteractionMode = 'real-tap';

  constructor(private readonly driver: WebDriver) {}

  async click(element: WebElement): Promise<void> {
    await realTap(this.driver, element.elementId);
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
 * Navigates to the canary fixture, performs a click via `performClick`, and
 * reports whether the click's real effect (the listener actually running)
 * was observed within `timeoutMs`.
 */
export async function observeClickEffect(
  driver: WebDriver,
  performClick: (button: WebElement) => Promise<void>,
  timeoutMs = 3_000,
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
        timeout: timeoutMs,
        interval: Math.min(150, timeoutMs / 4),
        describe: 'canary #out to read CLICKED after a real tap',
      },
    );
    return true;
  } catch {
    return false;
  }
}

/**
 * The canary (design doc s5a, as changed by #838): one real tap on the
 * fixture. It lands, and the run is in `real-tap`; it does not, and the run
 * fails here, naming the cause -- there is no quieter mode to fall back to.
 * session.ts calls this exactly once per run, before any journey.
 */
export async function detectInteractionMode(
  driver: WebDriver,
  { timeoutMs = 3_000 }: { timeoutMs?: number } = {},
): Promise<InteractionMode> {
  const landed = await observeClickEffect(
    driver,
    (button) => realTap(driver, button.elementId),
    timeoutMs,
  );
  if (!landed)
    throw new Error(
      `a real tap did not land on the iPhone (#838): the canary's button saw no click within ${timeoutMs} ms of a ` +
        'press and a release sent as separate W3C actions. Check the phone is unlocked and Safari is in front; ' +
        'the run stops here rather than fake taps inside the page.',
    );
  return 'real-tap';
}

export function createInteraction(
  driver: WebDriver,
  mode: InteractionMode,
): Interaction {
  void mode;
  return new RealTapInteraction(driver);
}

/**
 * The line every run prints, and the dashboard shows: what this run's taps
 * and typing were. Text entry is named as a stand-in until #838 finds a real
 * path, so a run is never reported as though typing were typing.
 */
export function describeInteractionMode(mode: InteractionMode): string {
  return (
    `[iOS interaction mode] ${mode} -- taps are real touches (press and release as separate W3C actions, #838); ` +
    'text entry is a marked stand-in (the value is set in the page and input/change fired), because no real typing ' +
    'path works on this iOS build yet (#838).'
  );
}

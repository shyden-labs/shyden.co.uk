/**
 * How the iPhone run's journeys act on the page -- design doc
 * docs/superpowers/specs/2026-08-08-real-device-test-harness-design.md,
 * section 5a.
 *
 * One mode today: DOM dispatch, through the page driver (#859) --
 * `el.click()` in the page, and `.value` set then `input`/`change` fired.
 * This runs the page's real handlers inside real WebKit, so it still catches
 * real rendering and logic defects on real Safari; it does NOT exercise the
 * touch input path itself: taps reaching their targets, focus-zoom and
 * momentum scroll are unverified in this mode. #838 adds WebDriverAgent's
 * real taps as a second mode.
 *
 * (Safari's WebDriver input commands, which an earlier canary measured
 * returning success with no effect on iOS 27.0, went with safaridriver in
 * #859.)
 */
import type { PageElement } from './page-driver';

export type InteractionMode = 'dom-dispatch';

export interface Interaction {
  readonly mode: InteractionMode;
  click(element: PageElement): Promise<void>;
  type(element: PageElement, text: string): Promise<void>;
  clear(element: PageElement): Promise<void>;
}

export class DomDispatchInteraction implements Interaction {
  readonly mode: InteractionMode = 'dom-dispatch';

  async click(element: PageElement): Promise<void> {
    await element.click();
  }

  async type(element: PageElement, text: string): Promise<void> {
    await element.sendKeys(text);
  }

  async clear(element: PageElement): Promise<void> {
    await element.clear();
  }
}

/**
 * The exact, unmissable line this project's standard requires: "the mode
 * is named in the suite's output... a DOM-dispatch run is never reported
 * as though taps were taps." Called once, by session.ts, the moment the
 * session starts.
 */
export function describeInteractionMode(mode: InteractionMode): string {
  return (
    `[iOS interaction mode] ${mode} -- interaction is driven by DOM dispatch (el.click(), and .value + input/change events) ` +
    'until #838 brings real taps. This still exercises real page logic and rendering in real WebKit, but the touch input PATH ITSELF ' +
    'is NOT covered by this run: taps actually reaching their targets, focus-triggered zoom, and momentum scroll are unverified.'
  );
}

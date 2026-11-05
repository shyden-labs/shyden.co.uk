import type { BrowserContext, Page } from '@playwright/test';
import { adb } from '../../scripts/adb.mjs';
import { messageOf } from '../../scripts/errors.mjs';
import { CHROME_PACKAGE } from './chrome-foreground';

/**
 * Every tab the real Android leg uses is one Chrome opened for a VIEW intent, the way a visitor's
 * link opens one, adopted by Playwright when it appears (#807).
 *
 * A tab made over DevTools instead (`context.newPage()`, which is `Target.createTarget`) crashes
 * the whole of Chrome 155 the moment a `<datalist>` field shows its suggestions:
 * `AutofillProvider.showDatalistPopup`, then a null view in `ViewAndroidDelegate.setViewPosition`.
 * Measured on the test phone, keyboard focus then typing into the report form's quote field:
 * 5 of 5 such tabs crashed, 0 of 5 adopted intent tabs did, 0 of 5 intent tabs that Playwright
 * then navigated did, and 0 of 10 visitor visits did (no DevTools attached at all). Every tab
 * read `visible` and focused first, so it is how the tab was made, not which tab is in front.
 * Once Chrome dies, every later test in the run fails to connect: the end-of-run loss on
 * 2026-10-16 (results 964-1141 of 1141).
 */

export const VISITOR_TAB_TIMEOUT_MS = 5_000;

/**
 * Android kills an app whose activities launch too fast (AOSP
 * `WindowProcessController.updateRapidActivityLaunch`, read 2026-10-18): a launch within 500 ms of
 * the previous one adds 1 to the process's count, a gap of 1,500 ms or more resets it, and above
 * 200 the task is removed and the process killed (`am_kill … rapidActivityLaunch`). Each intent
 * launches Chrome's trampoline (`IntentDispatcher`) and then its tabbed activity, so the harness
 * counts 2 per intent, the most one can add. Unpaced, a run of fast tests reached 200 and the phone
 * killed Chrome at test 216 of 1,141; every later test failed to connect.
 */
export const INTENT_LAUNCH_BUDGET = 150;

/** Android's 1,500 ms reset, plus room for the trampoline's second launch after the intent. */
export const INTENT_RESET_GAP_MS = 2_000;

const LAUNCHES_PER_INTENT = 2;

/**
 * Keeps the launches the harness causes under Android's limit: before an intent that would take
 * the count past {@link INTENT_LAUNCH_BUDGET}, it waits out what is left of
 * {@link INTENT_RESET_GAP_MS} since the last intent, which Android reads as a reset. The wait is
 * bounded by that gap, so it never holds a test longer than 2 s.
 */
export class IntentPacer {
  private launches = 0;
  private lastIntentAt = Number.NEGATIVE_INFINITY;

  constructor(
    private readonly now: () => number,
    private readonly wait: (ms: number) => Promise<void>,
  ) {}

  async beforeIntent(): Promise<void> {
    const sinceLast = this.now() - this.lastIntentAt;
    if (sinceLast >= INTENT_RESET_GAP_MS) {
      this.launches = 0;
    } else if (this.launches + LAUNCHES_PER_INTENT > INTENT_LAUNCH_BUDGET) {
      await this.wait(INTENT_RESET_GAP_MS - sinceLast);
      this.launches = 0;
    }
    this.launches += LAUNCHES_PER_INTENT;
    this.lastIntentAt = this.now();
  }
}

/** The one pacer for the run's one Chrome process. */
const runPacer = new IntentPacer(
  () => Date.now(),
  (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
);

/** Marks a context whose `newPage` already opens visitor tabs. */
const PATCHED = Symbol('shyden-visitor-tab-patch');

/**
 * Opens one about:blank tab through a VIEW intent and returns it once Playwright sees it. The
 * listener starts before the intent is sent, so a tab that appears at once is not missed. Fails
 * at {@link VISITOR_TAB_TIMEOUT_MS}, naming the wait and how many tabs were open.
 */
export async function openVisitorTab(
  context: BrowserContext,
  pacer: IntentPacer = runPacer,
): Promise<Page> {
  await pacer.beforeIntent();
  const opened = context.waitForEvent('page', {
    timeout: VISITOR_TAB_TIMEOUT_MS,
    predicate: (page) => page.url() === 'about:blank',
  });
  adb([
    'shell',
    'am',
    'start',
    '-a',
    'android.intent.action.VIEW',
    '-d',
    'about:blank',
    CHROME_PACKAGE,
  ]);
  try {
    return await opened;
  } catch (error) {
    throw new Error(
      `Chrome opened no tab within ${VISITOR_TAB_TIMEOUT_MS}ms of the about:blank VIEW intent ` +
        `(#807); tabs open: ${context.pages().length}; Playwright said: ` +
        messageOf(error),
    );
  }
}

/**
 * Points the phone's one context's `newPage` at {@link openVisitorTab}, once, so the fixtures and
 * any test that opens a second tab all get a visitor tab without knowing it.
 */
export function openTabsAsAVisitor(context: BrowserContext): void {
  const patchable = context as BrowserContext & { [PATCHED]?: true };
  if (patchable[PATCHED]) return;
  context.newPage = () => openVisitorTab(context);
  patchable[PATCHED] = true;
}

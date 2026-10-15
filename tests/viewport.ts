import { expect, type Locator, type Page } from '@playwright/test';

/**
 * The page-level horizontal-overflow measurement, in one place (#277).
 *
 * It had TWENTY-ONE copies across twelve spec files in three suites
 * (`tests/e2e/`, `tests/prod/`, and the same shape again in the iOS journey
 * corpus, which cannot import this and is left alone). The duplication scan
 * flagged eleven of those twenty-one: the rest sit under its 120-character
 * floor or below its 0.85 ratio, which is the working agreement's own lesson
 * running once more -- "a hand-written list of things to check will miss the
 * one that breaks". The population here was DERIVED, by grepping every
 * `documentElement.scrollWidth` in `tests/`, not taken from the ticket.
 *
 * The copies had already drifted in the one place a reader looks when a test
 * goes red: sixteen asserted with no message at all, three named the page,
 * one named the page and the width, and only `prod-sanity.spec.ts` printed
 * the measured overflow. A failure reading `expected 34.5 to be less than or
 * equal to 0` names the symptom and not the page, which is a twenty-minute
 * diagnosis for a one-second fact. Every caller now gets the number.
 *
 * NOT CONTAINMENT. `document.documentElement` answers "does the PAGE scroll
 * sideways", and content can overflow a card by 34.5px while the document
 * stays still -- which is exactly how the Remove button shipped hanging out
 * of the Student details border at every laptop width. A claim about an
 * element inside the page is measured against that element's own container;
 * see 'nothing in the roster escapes its card'.
 */

/**
 * How many pixels the document scrolls sideways. Zero or less is healthy; a
 * fractional positive value is a real overflow, not a rounding artefact.
 *
 * Exported beside the assertion because two callers in
 * `classroom-groups-controls.spec.ts` measure every disclosure section in a
 * loop and COLLECT the failures, so that one red names all of them rather
 * than stopping at the first. They need the number, not a verdict.
 */
export const horizontalOverflow = (page: Page): Promise<number> =>
  page.evaluate(
    () =>
      document.documentElement.scrollWidth -
      document.documentElement.clientWidth,
  );

/**
 * Assert the document does not scroll sideways.
 *
 * `note` says which page and which state, since the test name is not in the
 * assertion's own message; the measured overflow is appended for you.
 * Omitted, the page's URL stands in -- which is right for a test whose title
 * already carries the state.
 *
 * Returns what it measured, because three callers put that number in an
 * evidence-page caption. The alternative -- assert here, measure again for
 * the caption -- is two reads of a live page that can disagree, and a
 * caption that disagrees with the guard beside it is worse than no caption.
 */
export const expectNoHorizontalScroll = async (
  page: Page,
  note?: string,
): Promise<number> => {
  const overflow = await horizontalOverflow(page);
  expect(
    overflow,
    `${note ?? page.url()} scrolls sideways by ${overflow}px`,
  ).toBeLessThanOrEqual(0);
  return overflow;
};

/**
 * The element inside `#cardId` reaching furthest past the card's padding
 * edge, and by how much: the containment question `horizontalOverflow`
 * cannot answer, since content can overflow a card by 34.5px while the
 * document stays still. Two copies in `classroom-groups-controls.spec.ts`
 * disagreed about what counts as rendered (#390 F110).
 *
 * Rendered is `getClientRects().length > 0`: `display: none` on an ANCESTOR
 * leaves a descendant's own computed display untouched (#17). Unrounded,
 * because callers allow 0.5px and that is the whole tolerance (#371).
 */
export const spillPastCard = (
  page: Page,
  cardId: string,
): Promise<{ over: number; who: string }> =>
  page.evaluate((id) => {
    const card = document.getElementById(id);
    if (card === null) throw new Error(`no #${id} to measure against`);
    const box = card.getBoundingClientRect();
    const style = getComputedStyle(card);
    const inner =
      box.right -
      parseFloat(style.paddingRight) -
      parseFloat(style.borderRightWidth);
    let over = 0;
    let who = '';
    for (const el of card.querySelectorAll('*')) {
      if (el.getClientRects().length === 0) continue;
      const spill = el.getBoundingClientRect().right - inner;
      if (spill > over) {
        over = spill;
        who = String(el.className).split(' ')[0] || el.tagName;
      }
    }
    return { over, who };
  }, cardId);

/**
 * A control is at least 44x44 CSS pixels -- the working agreement's touch
 * target floor, and WCAG 2.2 SC 2.5.8's.
 *
 * Two byte-identical copies before #277 (`chrome.spec.ts` and
 * `yeetalk-calculators.spec.ts`), and a THIRD in `homepage.spec.ts` that stays where
 * it is on purpose: it sits inline inside a `.all()` loop because the
 * unproved-loop scanner in `event-collectors.test.ts` matches that exact
 * shape, and hoisting it out would make the loop invisible to a guard that
 * would then silently stop asking for a liveness proof. Its comment says so;
 * this is the cross-reference.
 *
 * TEN further sites asserted the height alone, unrounded -- a strictly
 * WEAKER claim that a 20px-wide button passes -- and #294 widened every one
 * of them to this one. TEN, not the nine that ticket was filed with: the
 * pair in `classroom-groups-controls.spec.ts` was collapsed into
 * `heights.every((h) => h >= 44)`, which a hand-written list missed and a
 * scan derived from disk did not.
 *
 * Four of those sites hold a measured rect rather than a `Locator` -- two
 * measure the `<label>` wrapping a deliberately small checkbox through an
 * in-page `evaluate`, and two more are the iOS journey corpus's WebDriver
 * rects. `rectAtLeast44` is the home they share, so the floor, the rounding
 * and the both-dimensions policy are decided in exactly one place whatever
 * did the measuring. The journey corpus still cannot import it -- that
 * corpus runs under vitest and this module's `expect` is Playwright's -- so
 * it rounds inline and cross-references here.
 */
export const rectAtLeast44 = (
  rect: { readonly width: number; readonly height: number },
  what: string,
): void => {
  // Round to the nearest device pixel: engines can report a sub-pixel value
  // like 43.9999 for a declared `min-height: 44px` (fixed-point layout math).
  expect(Math.round(rect.width), `${what} width`).toBeGreaterThanOrEqual(44);
  expect(Math.round(rect.height), `${what} height`).toBeGreaterThanOrEqual(44);
};

export const atLeast44 = async (
  locator: Locator,
  what = locator.toString(),
): Promise<void> => {
  const box = await locator.boundingBox();
  expect(box, `${what} has a box`).not.toBeNull();
  rectAtLeast44(box!, what);
};

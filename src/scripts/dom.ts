/**
 * The DOM-building this page's sections share.
 *
 * `roster-ui.ts` and `io-ui.ts` each held a character-identical `button`
 * helper, and `projector.ts` built two more by hand with the same three
 * properties (#277). All four carried the same reason for `type = 'button'`,
 * one of them spelling it out in a comment and the others not — four places
 * to remember a rule that only has to be wrong once.
 */

/**
 * A button with its text and class, never a submit.
 *
 * `type` matters and is the whole reason this is a helper rather than three
 * lines at each call site: the roster's and the import section's controls
 * sit inside `#cg-form`, and a `<button>` with no type IS a submit button —
 * clicking "Download template" would shuffle the class. The board's two sit
 * in `#cg-board`, outside any form today, and get the same type so that
 * moving one inside a form can never turn it into a shuffle.
 *
 * `doc` is a parameter because `renderProjector` takes the document it
 * builds into rather than reaching for the global, and a helper that reached
 * for the global would quietly remove that.
 */
export const button = (
  text: string,
  className: string,
  doc: Document = document,
): HTMLButtonElement => {
  const el = doc.createElement('button');
  el.type = 'button';
  el.className = className;
  el.textContent = text;
  return el;
};

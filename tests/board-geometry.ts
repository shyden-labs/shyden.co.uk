/**
 * What the projector board is actually showing, measured -- in ONE place.
 *
 * Two legs now ask this question and they must not answer it differently. The
 * desktop suite runs it through `page.evaluate` (Playwright); the iOS journeys
 * run it through `executeScript` on a real phone over WebDriver, where
 * Playwright does not exist. #189 AC11 exists precisely because the phone is
 * the case the desktop suite cannot reach -- so a second, hand-copied
 * measurement over there would be the one place a divergence could hide, in
 * the exact leg nobody can watch.
 *
 * SELF-CONTAINED ON PURPOSE. It closes over nothing in module scope, because
 * both callers serialise it: Playwright ships the function source into the
 * page, and the iOS leg sends `(${measureBoard})()` down the wire. A reference
 * to an import would survive type-checking here and be `undefined` in the
 * browser -- which is why `tests/guards/board-geometry.test.ts` asserts the
 * serialised text still carries the real selectors.
 *
 * Visibility is judged by `getClientRects().length`, never by an element's own
 * computed `display`: `display: none` on an ANCESTOR leaves a descendant's
 * computed display untouched, so a per-element check reports hidden content as
 * rendered -- a bug in the guard that reads exactly like a bug in the page.
 */
export const measureBoard = () => {
  const stage = document.getElementById('cg-board-stage');
  if (!stage)
    throw new Error(
      'measureBoard: #cg-board-stage is not in the document. The board never ' +
        'opened, so a measurement of it would describe nothing.',
    );

  const cs = getComputedStyle(stage);
  const box = stage.getBoundingClientRect();
  const scrollable = /auto|scroll|overlay/.test(cs.overflowY);
  const groups = Array.from(stage.querySelectorAll<HTMLElement>('.group'));

  const targets: { label: string; el: Element }[] = [];
  groups.forEach((group, i) => {
    targets.push({ label: `group ${i + 1}`, el: group });
    Array.from(group.querySelectorAll('.who')).forEach((who) => {
      targets.push({
        label: `"${(who.textContent || '').trim()}" in group ${i + 1}`,
        el: who,
      });
    });
  });

  // Half a pixel of tolerance: a fractional layout box is not a clipped
  // name, and an exact comparison would red on sub-pixel rounding alone.
  const escapes = (el: Element) => {
    const r = el.getBoundingClientRect();
    return r.bottom > box.bottom + 0.5 || r.top < box.top - 0.5;
  };

  return {
    unreachable: scrollable
      ? []
      : targets
          .filter((t) => t.el.getClientRects().length > 0 && escapes(t.el))
          .map((t) => t.label),
    // The population, by CONTENT: a card's own text, so an emptied board is
    // not mistaken for a board that was searched. Counting entries is not
    // counting content (#112).
    cards: groups.map((g) => (g.textContent || '').trim()),
    rows: new Set(groups.map((g) => Math.round(g.getBoundingClientRect().top)))
      .size,
    scrollable,
    scrollHeight: stage.scrollHeight,
    clientHeight: stage.clientHeight,
    font: cs.fontSize,
    overflowY: cs.overflowY,
  };
};

/** What one board measurement reports, for callers that cannot infer it. */
export type BoardGeometry = ReturnType<typeof measureBoard>;

/**
 * The same measurement, as a string a WebDriver session can run.
 *
 * `executeScript` takes source, not a function, so the iOS leg cannot pass
 * `measureBoard` itself. Built here rather than at the call site so there is
 * one spelling of the wrapper too, and so the serialisation has somewhere to
 * be asserted.
 */
export const measureBoardScript = (): string => `return (${measureBoard})();`;

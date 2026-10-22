/**
 * How much of the layout viewport's bottom an on-screen keyboard hides, in
 * CSS px: the distance from the visual viewport's bottom edge down to the
 * layout viewport's (issue 853).
 *
 * Make Groups docks to the bottom of the layout viewport (`position:
 * sticky; bottom`). Android Chrome shrinks that viewport above its keyboard
 * when the viewport tag asks it to (`interactive-widget=resizes-content`,
 * issue 807), so there this is 0 and the bar never moves. Safari ignores
 * that key: its keyboard leaves the layout viewport at full height and
 * shrinks only the visual one, so the docked bar sat behind the number pad
 * (measured on the iPhone: 746px layout, 423px visible from 122px down,
 * 201px hidden). Lifting the bar by this amount puts it back above the keys.
 *
 * A visual viewport smaller than the layout one for another reason, a pinch
 * zoom, gives an overlap too, and the bar then rests on the zoomed view's
 * bottom edge rather than below it, out of sight.
 *
 * PURE so the arithmetic is unit-tested; `classroom-groups.ts` only reads
 * the two viewports and writes the result. Every input is a live reading,
 * so anything that is not a finite number, or that would lift the bar
 * below the bottom (a rubber-band scroll past it), gives 0: the bar stays
 * docked where the stylesheet puts it.
 */
export function keyboardOverlap(
  layoutHeight: number,
  view: { offsetTop: number; height: number },
): number {
  const overlap = layoutHeight - (view.offsetTop + view.height);
  return Number.isFinite(overlap) && overlap > 0 ? overlap : 0;
}

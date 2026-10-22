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
 * A pinch zoom shrinks the visual viewport too, which is why the page asks
 * `liftFor` below rather than this alone.
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

/** What `takesTyping` reads of the focused element. */
export interface Focused {
  tagName: string;
  type?: string;
  isContentEditable?: boolean;
}

/** Input types that take no typing, so open no keyboard. */
const UNTYPED = new Set([
  'button',
  'checkbox',
  'color',
  'file',
  'hidden',
  'image',
  'radio',
  'range',
  'reset',
  'submit',
]);

/**
 * Whether the focused element takes typing, so a phone opens its keyboard
 * for it: a text area, editable content, or an input of any type but those
 * that are pressed or picked.
 */
export function takesTyping(field: Focused | null): boolean {
  if (field === null) return false;
  if (field.isContentEditable) return true;
  if (field.tagName === 'TEXTAREA') return true;
  return (
    field.tagName === 'INPUT' &&
    !UNTYPED.has((field.type ?? 'text').toLowerCase())
  );
}

/**
 * How far to lift the docked row: `keyboardOverlap` while a field that takes
 * typing has focus, otherwise 0. Shyden ruled 2026-10-23 that a pinch zoom
 * never moves the bar; Chrome keeps `innerHeight` at the layout height while
 * zoomed, so the overlap alone would lift it there (measured on the Android
 * at 2.5x: 720px layout, 288px visible from 180px down).
 */
export function liftFor(
  layoutHeight: number,
  view: { offsetTop: number; height: number },
  focused: Focused | null,
): number {
  return takesTyping(focused) ? keyboardOverlap(layoutHeight, view) : 0;
}

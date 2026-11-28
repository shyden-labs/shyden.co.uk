/**
 * The projected board's own pieces (#1338), built from `boardMarks`' pure
 * rules. Each builder takes the document it builds with, so the unit suite
 * checks them against a stand-in without a DOM.
 */
import { groupMark, numbersOnly } from '../lib/boardMarks';

/**
 * A group's mark for the board's coloured bar: its shape, then its number.
 * Decorative: the localised "Group n" heading stays the accessible name.
 */
export function groupMarkElement(doc: Document, index: number): HTMLElement {
  const mark = groupMark(index);
  const markEl = doc.createElement('div');
  markEl.className = 'group-mark';
  markEl.setAttribute('aria-hidden', 'true');
  const shapeEl = doc.createElement('span');
  shapeEl.className = 'group-shape';
  shapeEl.textContent = mark.shape;
  const noEl = doc.createElement('span');
  noEl.className = 'group-no';
  noEl.textContent = String(mark.number);
  markEl.append(shapeEl, noEl);
  return markEl;
}

/**
 * Dresses a group's card for the board: its tone on the card, the heading
 * marked as the label the board hides visually, and the mark returned for
 * the card's bar.
 */
export function dressGroupCard(
  doc: Document,
  card: HTMLElement,
  heading: HTMLElement,
  index: number,
): HTMLElement {
  card.dataset.tone = String(groupMark(index).tone);
  heading.className = 'group-label';
  return groupMarkElement(doc, index);
}

/**
 * A student's number: beside a name on the board, or alone and large when
 * no dealt student has a name. Decorative: the name, or "Student n", beside
 * it is what a screen reader reads.
 */
export function studentNumberElement(
  doc: Document,
  number: number,
): HTMLElement {
  const no = doc.createElement('span');
  no.className = 'student-no';
  no.setAttribute('aria-hidden', 'true');
  no.textContent = String(number);
  return no;
}

/**
 * Marks `tables` to show numbers first when no dealt student has a name.
 * Read from the dealt rows, so a name typed after the shuffle switches the
 * board back to names.
 */
export function markNumbersOnly(
  tables: HTMLElement,
  names: ReadonlyMap<number, string>,
): void {
  const numbers = Array.from(
    tables.querySelectorAll<HTMLElement>('.student'),
    (el) => Number(el.dataset.number),
  );
  tables.toggleAttribute(
    'data-numbers-only',
    numbers.length > 0 && numbersOnly(numbers, names),
  );
}

import { describe, expect, it } from 'vitest';
import {
  groupMarkElement,
  markNumbersOnly,
  studentNumberElement,
} from '../../src/scripts/board-dom';

/**
 * A stand-in for the few DOM calls the board's builders make (#1338): no
 * DOM runs in the unit suite, so each element is a plain record of what was
 * set on it.
 */
interface FakeElement {
  tagName: string;
  className: string;
  textContent: string;
  attributes: Map<string, string>;
  children: FakeElement[];
  setAttribute(name: string, value: string): void;
  append(...nodes: FakeElement[]): void;
}

const fakeDocument = {
  createElement(tagName: string): FakeElement {
    return {
      tagName: tagName.toUpperCase(),
      className: '',
      textContent: '',
      attributes: new Map(),
      children: [],
      setAttribute(name, value) {
        this.attributes.set(name, value);
      },
      append(...nodes) {
        this.children.push(...nodes);
      },
    };
  },
};

const build = <T>(builder: (doc: Document) => T) =>
  builder(fakeDocument as unknown as Document) as unknown as FakeElement;

describe('the projected board builds its pieces (#1338)', () => {
  it("builds a group's mark: decorative, its shape then its number", () => {
    const mark = build((doc) => groupMarkElement(doc, 0));
    expect(mark.tagName).toBe('DIV');
    expect(mark.className).toBe('group-mark');
    expect(mark.attributes.get('aria-hidden')).toBe('true');
    expect(
      mark.children.map((child) => [child.className, child.textContent]),
    ).toEqual([
      ['group-shape', '●'],
      ['group-no', '1'],
    ]);
  });

  it('numbers the seventh group 7 under the first shape again', () => {
    const mark = build((doc) => groupMarkElement(doc, 6));
    expect(mark.children.map((child) => child.textContent)).toEqual(['●', '7']);
  });

  it("builds a student's number: decorative, the number alone", () => {
    const no = build((doc) => studentNumberElement(doc, 12));
    expect(no.tagName).toBe('SPAN');
    expect(no.className).toBe('student-no');
    expect(no.attributes.get('aria-hidden')).toBe('true');
    expect(no.textContent).toBe('12');
  });
});

/** The dealt rows and the attribute `markNumbersOnly` toggles. */
const tablesOf = (numbers: number[]) => {
  const toggled: Array<[string, boolean]> = [];
  return {
    toggled,
    tables: {
      querySelectorAll: (selector: string) => {
        expect(selector).toBe('.student');
        return numbers.map((n) => ({ dataset: { number: String(n) } }));
      },
      toggleAttribute: (name: string, force: boolean) => {
        toggled.push([name, force]);
        return force;
      },
    } as unknown as HTMLElement,
  };
};

describe('the board shows numbers first only when no dealt student has a name (#1338)', () => {
  it('marks a deal with no names', () => {
    const { tables, toggled } = tablesOf([1, 2]);
    markNumbersOnly(tables, new Map([[1, '  ']]));
    expect(toggled).toEqual([['data-numbers-only', true]]);
  });

  it('clears the mark when one dealt student has a name', () => {
    const { tables, toggled } = tablesOf([1, 2]);
    markNumbersOnly(tables, new Map([[2, 'Ayu']]));
    expect(toggled).toEqual([['data-numbers-only', false]]);
  });

  it('marks nothing while nothing is dealt', () => {
    const { tables, toggled } = tablesOf([]);
    markNumbersOnly(tables, new Map());
    expect(toggled).toEqual([['data-numbers-only', false]]);
  });
});

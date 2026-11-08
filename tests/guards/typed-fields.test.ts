import { describe, expect, it } from 'vitest';
import { searched } from '../source-files';
import {
  IOS_ZOOM_FLOOR_PX,
  measureTypedFields,
  measureTypedFieldsScript,
} from '../typed-fields';
import { expectClosesOverNothing } from '../unit/closes-over-nothing';

/**
 * The typed-field measurement is serialised into two runtimes, the emulated
 * suite's page and a real iPhone's Safari, so it is guarded here (#390).
 *
 * Measuring a font-size needs a layout, and no DOM is installed in this suite
 * (jsdom would be a new dependency, an operator decision): the emulated
 * `zoom-on-focus.spec.ts` runs the function. What this file proves is the part
 * that breaks silently: that the function arrives at the far end naming every
 * kind of field it is about, that it closes over nothing, and that there is
 * one definition, so the phone can no longer check a narrower set than CI.
 */
describe('typed fields are defined once, and survive being sent to a phone', () => {
  it('is the floor iOS zooms below', () => {
    expect(IOS_ZOOM_FLOOR_PX).toBe(16);
  });

  it('still names every kind of field once serialised', () => {
    const source = measureTypedFields.toString();

    // The kinds of control a visitor types into, the input types that open no
    // keyboard (left out), the honeypot rule, and the property measured. A
    // function that lost any of these still serialises and measures less.
    const needles = [
      'input',
      'textarea',
      'select',
      'contenteditable',
      'aria-hidden',
      'getComputedStyle',
      'fontSize',
      ...[
        'hidden',
        'checkbox',
        'radio',
        'button',
        'submit',
        'reset',
        'file',
        'image',
        'range',
        'color',
      ].map((type) => `"${type}"`),
    ];
    // A transpiler prints string literals in its own quotes (esbuild uses
    // double), and a bare `hidden` would be met by `aria-hidden`: so each
    // input type must appear as a quoted literal, in either quote.
    const present = (needle: string) =>
      needle.startsWith('"')
        ? [needle, `'${needle.slice(1, -1)}'`].some((form) =>
            source.includes(form),
          )
        : source.includes(needle);
    const missing = needles.filter((needle) => !present(needle));

    expect(
      searched(missing, { of: needles, what: 'serialised field rules' }),
      `the serialised measurement lost: ${missing.join(', ')}`,
    ).toEqual([]);
  });

  it('closes over nothing, because anything it closed over would be undefined at the far end', () => {
    expectClosesOverNothing(
      'tests/typed-fields.ts',
      'export const measureTypedFields',
    );
  });

  it('has one spelling of the wrapper the device leg sends', () => {
    expect(measureTypedFieldsScript()).toBe(
      `return (${measureTypedFields})();`,
    );
  });
});

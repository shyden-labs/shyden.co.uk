import { describe, expect, it } from 'vitest';
import { arrowKeysFor, whyNoOption, whyNotChosen } from '../real-select';

/**
 * The messages chooseOption fails with (#1027). Pure strings: no browser, no
 * phone. The choosing itself is real input and runs in the e2e suite.
 */
describe('chooseOption failures', () => {
  it('names the select and the option when real input missed', () => {
    expect(whyNotChosen("locator('#s')", 'F', 'M')).toBe(
      `locator('#s'): real input chose "M", not the wanted option "F"`,
    );
  });

  it('is null when real input chose the wanted option', () => {
    expect(whyNotChosen("locator('#s')", 'F', 'F')).toBeNull();
  });

  it('says a missing option cannot be reached', () => {
    expect(whyNoOption('sel', 'Z')).toMatch(/no option with the value "Z"/);
  });

  it('counts arrow presses between reachable options', () => {
    const o = [
      { value: '', disabled: false },
      { value: 'M', disabled: false },
      { value: 'F', disabled: false },
    ];
    expect(arrowKeysFor(o, '', 'F')).toEqual(['End']);
    expect(arrowKeysFor(o, 'F', '')).toEqual(['Home']);
    expect(arrowKeysFor(o, '', 'M')).toEqual(['ArrowDown']);
    expect(arrowKeysFor(o, 'F', 'M')).toEqual(['ArrowUp']);
    expect(arrowKeysFor(o, 'M', 'M')).toEqual([]);
  });

  it('walks by arrows when the target is not an end', () => {
    const o = ['a', 'b', 'c', 'd'].map((value) => ({ value, disabled: false }));
    expect(arrowKeysFor(o, 'a', 'c')).toEqual(['ArrowDown', 'ArrowDown']);
  });

  it('skips a disabled option and refuses to choose one', () => {
    const o = [
      { value: '', disabled: true },
      { value: 'M', disabled: false },
      { value: 'F', disabled: false },
    ];
    expect(arrowKeysFor(o, 'M', 'F')).toEqual(['ArrowDown']);
    expect(arrowKeysFor(o, 'M', '')).toBeNull();
    expect(arrowKeysFor(o, 'M', 'Z')).toBeNull();
  });
});
